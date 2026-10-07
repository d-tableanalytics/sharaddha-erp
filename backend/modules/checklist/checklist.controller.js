/**
 * Checklist controller — HTTP handlers.
 *
 * Follows the portal pattern: thin handlers that parse → query → envelope.
 * Every response uses `{ success: true, data }`.
 *
 * Admin/manager detection uses the same `isSuperAdmin` from rbac.js — which
 * answers true for Super Admin, Admin, and any role holding the wildcard '*'.
 * The sidebar already gates the Work Queue group on `view_o2d`, so every user
 * who reaches these routes has that permission.
 */

import mongoose from 'mongoose';
import {
  ChecklistRoutine, ChecklistOccurrence, OCCURRENCE_REASSIGNED_AWAY,
} from '../../models/Checklist.js';
import User from '../../models/User.js';
import { WorkQueueSeen } from '../../models/WorkQueueSeen.js';
import { isSuperAdmin, hasPermission, PERMISSIONS } from '../../middlewares/rbac.js';
import { completeMirroredTask } from '../o2d/o2dDelegationSync.service.js';
import { roleStageMap } from '../o2d/task.service.js';
import { startOfOfficeDay, endOfOfficeDay, officeDaySchedule, officeDayKey } from '../../utils/officeDay.js';
import {
  resolveBuddyChain, resolveActiveAssignee, sameChain, splitName, assignmentEvent, runBuddySweep, BuddyChainError,
} from '../workqueue/buddy.service.js';
import { recordAudit } from '../../utils/auditLog.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['Super Admin', 'Admin', 'Management', 'HR'];

const isManager = (user) =>
  isSuperAdmin(user) || ADMIN_ROLES.includes(user?.role);

/**
 * What this user may do with O2D stage tasks — the same answer O2D's own My
 * Tasks gives, read from the live stage master rather than copied here.
 *
 *   actionable   stages the user's role completes (its team tasks are theirs)
 *   supervising  stages the role covers as a senior — seen even when named
 *                to somebody else, like an admin
 */
async function o2dAbilityFor(user) {
  const works = hasPermission(user, PERMISSIONS.VIEW_O2D) && hasPermission(user, PERMISSIONS.WORK_O2D_STAGE);
  if (!works) return { works: false, all: false, actionable: [], supervising: [] };
  if (isSuperAdmin(user)) return { works: true, all: true, actionable: [], supervising: [] };
  const { actionable, supervising } = await roleStageMap(user?.role);
  return { works: true, all: false, actionable, supervising };
}

/**
 * A person's own queue: their rows, plus the OPEN O2D tasks they can act on —
 * their role's team tasks, the stages they cover, or every stage for an admin.
 *
 * Open only, beyond their own rows: somebody else's finished O2D task is that
 * person's credit, and counting it here would inflate this viewer's Done tile.
 *
 * A manager's default view is unscoped (`null`, every row); `mine` asks for
 * the personal queue instead, which is what My Work shows.
 */
function visibilityScope(user, ability, { mine = false } = {}) {
  if (isManager(user) && !mine) return null;
  const branches = [{ doer: user._id }];
  const openO2d = { sourceType: 'o2d_stage', status: { $in: ['pending', 'overdue'] } };
  if (ability.all) {
    branches.push(openO2d);
  } else {
    if (ability.actionable.length > 0) {
      branches.push({ ...openO2d, doer: null, sourceStageNumber: { $in: ability.actionable } });
    }
    if (ability.supervising.length > 0) {
      branches.push({ ...openO2d, sourceStageNumber: { $in: ability.supervising } });
    }
  }
  return { $or: branches };
}

// ── "New" tasks ──────────────────────────────────────────────────────────────

/** Somebody who has never opened the Checklist sees the last day's arrivals as new. */
const FIRST_VISIT_WINDOW_MS = 24 * 60 * 60 * 1000;

async function seenAtFor(userId) {
  const marker = await WorkQueueSeen.findOne({ user: userId, list: 'checklist' }).select('seenAt').lean();
  return marker?.seenAt ?? new Date(Date.now() - FIRST_VISIT_WINDOW_MS);
}

/**
 * The open tasks that reached this person's own queue since `seenAt`.
 *
 * "Reached" is `assignedAt` (a reassignment) or else `createdAt`. A recurring
 * routine generates all its dates at once, so it counts ONCE — its next open
 * occurrence — rather than a month of daily rows appearing as thirty new tasks.
 */
async function newTaskIdsFor(user, ability, seenAt) {
  const rows = await ChecklistOccurrence.find({
    $and: [
      visibilityScope(user, ability, { mine: true }),
      { status: { $in: ['pending', 'overdue'] }, heldAt: null },
      { $expr: { $gt: [{ $ifNull: ['$assignedAt', '$createdAt'] }, seenAt] } },
    ],
  })
    .select('_id routine frequency plannedDate')
    .lean();

  const byTask = new Map();
  for (const row of rows) {
    const recurring = row.frequency && row.frequency !== 'once';
    const key = recurring ? `r:${row.routine}` : String(row._id);
    const current = byTask.get(key);
    if (!current || new Date(row.plannedDate) < new Date(current.plannedDate)) byTask.set(key, row);
  }
  return new Set([...byTask.values()].map((row) => String(row._id)));
}

/**
 * May this viewer complete this O2D row? Answered here, per row, because it is
 * O2D's permission and stage master that decide — not the Checklist's own.
 */
const canCompleteO2dRow = (row, user, ability) =>
  ability.works && (
    ability.all
    || String(row.doer ?? '') === String(user._id)
    || ability.actionable.includes(Number(row.sourceStageNumber))
  );

/**
 * Is this row a mirror of an O2D stage rather than a checklist item of its own?
 *
 * A mirror is a VIEW of work that lives somewhere else. It shows up here so the
 * assignee sees everything they owe in one place — not so this screen can
 * decide the work's fate. Completion is forwarded to the real stage; the other
 * lifecycle verbs below are refused outright, because there is no way to honour
 * them here that leaves the two sides agreeing.
 */
const isO2dMirror = (row) => row?.sourceType === 'o2d_stage';

/** Refuse an edit that only Order Tracker can make, and say where to make it. */
const refuseMirrorEdit = (res, what) =>
  res.status(400).json({
    success: false,
    message: `This task mirrors an O2D stage, so it cannot be ${what} here. `
      + 'Open the order in Order Tracker — the change will flow back to this list.',
    code: 'O2D_MIRROR_READ_ONLY',
  });

// Office-day boundaries (IST), not the server's own midnight — see utils/officeDay.js.
const startOfDay = startOfOfficeDay;
const endOfDay = endOfOfficeDay;

/** Search text is matched literally — `(` or `C++` is a name, not a pattern. */
const searchRegex = (text) => new RegExp(String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/** The most occurrences one routine generates; the response says when it was hit. */
const MAX_OCCURRENCES = 1000;

/**
 * Overdue: open, and its day is over. A LOCKED O2D stage's placeholder date is
 * not a deadline, so `scheduleTbd` rows never are.
 */
const overdueClause = (now = new Date()) => ({
  scheduleTbd: { $ne: true },
  $or: [
    { status: 'overdue' },
    { status: 'pending', plannedDate: { $lt: startOfDay(now) } },
  ],
});

/**
 * The rows a compliance rate is measured over: what has fallen due by today,
 * plus anything already done early. A year of pre-generated future rows in
 * the denominator read a routine done perfectly so far as ~0%, and a
 * non-functional row (the work turned out not to be needed) is not a miss.
 */
const complianceBaseClause = (now = new Date()) => ({
  status: { $ne: 'non-functional' },
  scheduleTbd: { $ne: true },
  $or: [{ plannedDate: { $lte: endOfDay(now) } }, { status: 'completed' }],
});

/**
 * Build the base filter for occurrence queries.
 * Enriches pending tasks whose plannedDate is past as 'overdue'.
 */
function buildOccurrenceFilter(query, user, scope = null) {
  const filter = {};

  if (query.site) filter.site = query.site;
  if (query.department) filter.department = query.department;
  if (query.frequency) filter.frequency = query.frequency;

  // Every `$or` goes through `$and`: search, overdue and the scope are each an
  // `$or` of their own, and assigning `filter.$or` twice kept only the last —
  // searching inside Overdue returned every overdue row.
  const and = [];

  // Search
  if (query.search) {
    const re = searchRegex(query.search);
    and.push({ $or: [{ taskName: re }, { taskCode: re }] });
  }

  // Doer filter (admin only, on the unscoped view). Everyone else is limited by
  // `scope`: their own rows plus the O2D tasks they can act on.
  if (isManager(user) && !scope && query.doer) filter.doer = query.doer;

  /**
   * A PERSONAL list drops an occurrence whose O2D order is parked.
   *
   * O2D's own My Tasks already stops showing the stage the moment its order
   * goes on hold or is cancelled, so a mirror left live here would have the
   * two screens disagreeing about what this person owes today — which is the
   * one thing the mirror exists to make impossible.
   *
   * Only when the list is scoped to a doer. An unscoped manager view is a
   * compliance surface, and silently dropping rows from a compliance count is
   * how a report starts under-reporting. `null` matches a MISSING field, so
   * manual occurrences and everything written before this flag existed are
   * untouched.
   */
  if ((filter.doer || scope) && query.includeHeld !== 'true') filter.heldAt = null;

  // Status
  const now = new Date();
  if (query.status === 'overdue') {
    and.push(overdueClause(now));
  } else if (query.status === 'pending') {
    filter.status = 'pending';
    filter.plannedDate = { $gte: startOfDay(now) };
  } else if (query.status) {
    filter.status = query.status;
  }

  // Date filters
  if (query.specificDate) {
    filter.plannedDate = {
      $gte: startOfDay(query.specificDate),
      $lte: endOfDay(query.specificDate),
    };
  } else {
    if (query.fromDate) {
      filter.plannedDate = { ...filter.plannedDate, $gte: startOfDay(query.fromDate) };
    }
    if (query.toDate) {
      filter.plannedDate = { ...filter.plannedDate, $lte: endOfDay(query.toDate) };
    }
  }

  /**
   * And a row this doer no longer owns never appears as their work.
   *
   * Applied to EVERY list, not only the doer-scoped ones: a reassigned-away
   * occurrence is the historical shadow of a task that is live somewhere else
   * on the same screen, so leaving it in a manager's unscoped list would show
   * one piece of work twice, once under each person. The trail is on the row
   * itself — `reassigned`, `reassignedTo`, `reassignedBy` and the remark — and
   * `?includeHeld=true` brings the parked and handed-away rows back for anybody
   * who needs them.
   *
   * LAST, and through `$and` rather than `filter.status`, because every branch
   * above is free to assign `filter.status` or `filter.$or` outright. Written
   * as a plain field it would be silently overwritten by `?status=pending`,
   * which is exactly the sort of filter that looks applied and is not.
   */
  if (query.includeHeld !== 'true') and.push({ status: { $ne: OCCURRENCE_REASSIGNED_AWAY } });

  if (scope) and.push(scope);

  if (and.length > 0) filter.$and = and;
  return filter;
}

/**
 * Enrich tasks: mark pending tasks with past plannedDate as 'overdue' in the
 * response (computed, not stored).
 */
function enrichStatus(task) {
  const now = new Date();
  if (task.status === 'pending' && !task.scheduleTbd && new Date(task.plannedDate) < startOfDay(now)) {
    return { ...task, status: 'overdue' };
  }
  return task;
}


/**
 * One page of `filter`, in the order a person works through it:
 *
 *   0  open and due by today (overdue first, oldest first)
 *   1  open, due later (soonest first)
 *   2  closed — completed, non-functional (most recent first)
 *
 * Sorting on `plannedDate` alone, newest first, put a routine's LAST date on
 * page one: a daily routine running to December opened on December 31st, and
 * today's and the overdue rows were pages away from anybody looking.
 */
async function findActionableFirst(filter, { skip, limit }, now = new Date()) {
  // An aggregate does not cast the way `find` does — a doer id arriving as a
  // string would match nothing — so cast through the model first.
  const match = ChecklistOccurrence.find(filter).cast(ChecklistOccurrence);
  const open = { $in: ['$status', ['pending', 'overdue']] };
  const datedMs = { $toLong: '$plannedDate' };

  return ChecklistOccurrence.aggregate([
    { $match: match },
    {
      $addFields: {
        _rank: {
          $switch: {
            branches: [
              {
                case: {
                  $and: [open, { $ne: ['$scheduleTbd', true] }, { $lte: ['$plannedDate', endOfDay(now)] }],
                },
                then: 0,
              },
              { case: open, then: 1 },
            ],
            default: 2,
          },
        },
      },
    },
    { $addFields: { _when: { $cond: [{ $lt: ['$_rank', 2] }, datedMs, { $multiply: [datedMs, -1] }] } } },
    { $sort: { _rank: 1, _when: 1, _id: 1 } },
    { $skip: skip },
    { $limit: limit },
    { $project: { _rank: 0, _when: 0 } },
  ]);
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * GET /checklist/tasks
 * Paginated, filtered task list.
 */
export async function getTasks(req, res, next) {
  try {
    const ability = await o2dAbilityFor(req.user);
    const scope = visibilityScope(req.user, ability, { mine: req.query.mine === 'true' });
    const filter = buildOccurrenceFilter(req.query, req.user, scope);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const skip = (page - 1) * limit;

    const [tasks, total, newIds] = await Promise.all([
      findActionableFirst(filter, { skip, limit }),
      ChecklistOccurrence.countDocuments(filter),
      seenAtFor(req.user._id).then((seenAt) => newTaskIdsFor(req.user, ability, seenAt)),
    ]);

    // The chain lives on the routine; the row needs it to show the backup order.
    const buddyRoutines = await ChecklistRoutine.find({
      _id: { $in: [...new Set(tasks.map((t) => String(t.routine)))] },
      assignmentType: 'buddy',
    }).select('buddyChain').lean();
    const chainByRoutine = new Map(buddyRoutines.map((r) => [String(r._id), r.buddyChain]));

    res.json({
      success: true,
      data: {
        tasks: tasks.map((t) => {
          const chain = chainByRoutine.get(String(t.routine));
          const row = {
            ...enrichStatus(t),
            isNew: newIds.has(String(t._id)),
            ...(chain ? { assignmentType: 'buddy', buddyChain: chain } : {}),
          };
          return isO2dMirror(row) ? { ...row, canComplete: canCompleteO2dRow(row, req.user, ability) } : row;
        }),
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /checklist/summary
 * KPI counts for the stat tiles.
 */
export async function getSummary(req, res, next) {
  try {
    const baseFilter = { status: { $ne: OCCURRENCE_REASSIGNED_AWAY } };
    if (req.query.site) baseFilter.site = req.query.site;
    const scope = visibilityScope(req.user, await o2dAbilityFor(req.user));
    // In `$and`, because the overdue counts below add an `$or` of their own.
    if (scope) baseFilter.$and = [scope];
    // The tiles sit directly above the list, and must count exactly what the
    // list shows — `buildOccurrenceFilter` drops a parked mirror from a
    // personal view, so a tile that still counted it would read "5 pending"
    // over four rows. A handed-away row is excluded above for the same reason,
    // and additionally because `total` is the compliance DENOMINATOR: counting
    // work somebody no longer owns drags their rate down for a hand-off.
    if (scope) baseFilter.heldAt = null;

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    // Each extra condition is AND-ed onto the base, never spread over it: the
    // base's `status` and `$and` must survive every count.
    const withBase = (extra) => ({ $and: [baseFilter, extra] });

    const [total, pendingToday, overdue, completed, complianceBase] = await Promise.all([
      ChecklistOccurrence.countDocuments(baseFilter),
      ChecklistOccurrence.countDocuments(withBase({ status: 'pending', plannedDate: { $gte: todayStart, $lte: todayEnd } })),
      ChecklistOccurrence.countDocuments(withBase(overdueClause(now))),
      ChecklistOccurrence.countDocuments(withBase({ status: 'completed' })),
      ChecklistOccurrence.countDocuments(withBase(complianceBaseClause(now))),
    ]);

    // Measured over what has fallen due so far — see `complianceBaseClause`.
    const complianceRate = complianceBase > 0 ? Math.round((completed / complianceBase) * 100) : 0;
    const pendingCarriedOver = overdue;

    res.json({
      success: true,
      data: {
        total,
        pendingToday,
        overdue,
        completed,
        complianceRate,
        complianceBase,
        carriedOver: pendingCarriedOver,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /checklist/routines
 * Master routine list (admin/manager only).
 */
export async function getRoutines(req, res, next) {
  try {
    if (!isManager(req.user)) {
      return res.status(403).json({ success: false, message: 'Only managers can view the routine catalogue.' });
    }

    const filter = {};
    if (req.query.site) filter.site = req.query.site;
    if (req.query.search) {
      const re = searchRegex(req.query.search);
      filter.$or = [{ taskName: re }, { taskCode: re }];
    }

    const routines = await ChecklistRoutine.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    // Attach progress for each routine
    const routineIds = routines.map((r) => r._id);
    const progress = await ChecklistOccurrence.aggregate([
      { $match: { routine: { $in: routineIds } } },
      {
        $group: {
          _id: '$routine',
          total: { $sum: 1 },
          done: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        },
      },
    ]);

    const progressMap = {};
    progress.forEach((p) => { progressMap[p._id.toString()] = { total: p.total, done: p.done }; });

    const enriched = routines.map((r) => ({
      ...r,
      progress: progressMap[r._id.toString()] || { total: 0, done: 0 },
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /checklist/departments
 * Department scoreboard (admin/manager only).
 */
export async function getDepartmentReport(req, res, next) {
  try {
    if (!isManager(req.user)) {
      return res.status(403).json({ success: false, message: 'Only managers can view department scoreboards.' });
    }

    // A handed-away row is not this doer's `total` and not their `completed`.
    // It is the other person's row now, and they have their own.
    const matchFilter = { status: { $ne: OCCURRENCE_REASSIGNED_AWAY } };
    if (req.query.site) matchFilter.site = req.query.site;

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const placeholder = { $eq: ['$scheduleTbd', true] };

    const pipeline = [
      { $match: matchFilter },
      {
        $addFields: {
          computedStatus: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'pending'] },
                  { $lt: ['$plannedDate', todayStart] },
                  { $not: [placeholder] },
                ],
              },
              'overdue',
              '$status',
            ],
          },
          // The compliance denominator — see `complianceBaseClause`.
          countable: {
            $and: [
              { $ne: ['$status', 'non-functional'] },
              { $not: [placeholder] },
              { $or: [{ $lte: ['$plannedDate', todayEnd] }, { $eq: ['$status', 'completed'] }] },
            ],
          },
        },
      },
      {
        $group: {
          _id: { department: '$department', doer: '$doer', doerFirstName: '$doerFirstName', doerLastName: '$doerLastName' },
          total: { $sum: { $cond: ['$countable', 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$computedStatus', 'completed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$computedStatus', 'pending'] }, 1, 0] } },
          missed: { $sum: { $cond: [{ $eq: ['$computedStatus', 'overdue'] }, 1, 0] } },
        },
      },
      {
        $group: {
          _id: '$_id.department',
          people: {
            $push: {
              doer: '$_id.doer',
              doerFirstName: '$_id.doerFirstName',
              doerLastName: '$_id.doerLastName',
              total: '$total',
              completed: '$completed',
              pending: '$pending',
              missed: '$missed',
              complianceRate: {
                $cond: [{ $gt: ['$total', 0] }, { $round: [{ $multiply: [{ $divide: ['$completed', '$total'] }, 100] }, 0] }, 0],
              },
            },
          },
          totalTasks: { $sum: '$total' },
          totalCompleted: { $sum: '$completed' },
          totalPending: { $sum: '$pending' },
          totalMissed: { $sum: '$missed' },
          peopleCount: { $sum: 1 },
        },
      },
      {
        $addFields: {
          complianceRate: {
            $cond: [{ $gt: ['$totalTasks', 0] }, { $round: [{ $multiply: [{ $divide: ['$totalCompleted', '$totalTasks'] }, 100] }, 0] }, 0],
          },
        },
      },
      { $sort: { complianceRate: -1 } },
    ];

    const departments = await ChecklistOccurrence.aggregate(pipeline);

    // Overall summary
    const overall = departments.reduce(
      (acc, d) => ({
        completed: acc.completed + d.totalCompleted,
        pending: acc.pending + d.totalPending,
        missed: acc.missed + d.totalMissed,
        total: acc.total + d.totalTasks,
      }),
      { completed: 0, pending: 0, missed: 0, total: 0 },
    );
    overall.complianceRate = overall.total > 0 ? Math.round((overall.completed / overall.total) * 100) : 0;

    res.json({ success: true, data: { departments, overall } });
  } catch (err) {
    next(err);
  }
}

/** One occurrence of `routine` on `plannedDate`, carrying the routine's current terms. */
const occurrenceFor = (routine, plannedDate, actor, extra = {}) => ({
  routine: routine._id,
  taskName: routine.taskName,
  taskCode: routine.taskCode,
  doer: routine.doer,
  doerFirstName: routine.doerFirstName,
  doerLastName: routine.doerLastName,
  department: routine.department,
  site: routine.site,
  frequency: routine.frequency,
  plannedDate,
  proofRequired: routine.proofRequired,
  createdBy: actor._id,
  ...extra,
});

/**
 * The occurrences an edit or a stop may still change: not worked, and not yet
 * past. Completed, non-functional and overdue rows are the record of what
 * happened and are never rewritten.
 */
const unworkedFrom = (routineId, from) => ({ routine: routineId, status: 'pending', plannedDate: { $gte: from } });

/**
 * POST /checklist/routines
 * Create a routine and generate all occurrences.
 */
export async function createRoutine(req, res, next) {
  try {
    const {
      taskName, taskCode, frequency, department, site, startDate, endDate, proofRequired, assignmentType, buddyChain,
    } = req.body;

    /**
     * Buddy System: the chain's first person is the doer every occurrence is
     * created for; on each occurrence's own day the rotation hands it to the
     * first available person. Putting other people on the hook as backups is
     * assigning them work, so it is a manager's call.
     */
    let chain = [];
    if (assignmentType === 'buddy') {
      if (!isManager(req.user)) {
        return res.status(403).json({ success: false, message: 'Only managers can set up a buddy chain.' });
      }
      try {
        chain = await resolveBuddyChain(buddyChain);
      } catch (err) {
        if (err instanceof BuddyChainError) return res.status(400).json({ success: false, message: err.message });
        throw err;
      }
    }
    const doer = chain[0]?.userId ?? req.body.doer;

    if (!taskName || !taskCode || !doer || !startDate) {
      return res.status(400).json({ success: false, message: 'Task name, task code, assignee, and start date are required.' });
    }

    if (!isManager(req.user) && String(doer) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Non-managers can only create checklist tasks for themselves.' });
    }

    // Look up the doer's name
    const doerUser = chain[0] ? { user: chain[0].name } : await User.findById(doer).select('user email').lean();
    const nameParts = (doerUser?.user || doerUser?.email || '').split(' ');
    const doerFirstName = nameParts[0] || '';
    const doerLastName = nameParts.slice(1).join(' ') || '';

    const resolvedEndDate = (frequency === 'once' && !endDate) ? startDate : (endDate || startDate);
    const resolvedFrequency = frequency || 'daily';

    if (startOfDay(resolvedEndDate) < startOfDay(startDate)) {
      return res.status(400).json({ success: false, message: 'The end date cannot be before the start date.' });
    }

    const routine = await ChecklistRoutine.create({
      taskName,
      taskCode,
      frequency: resolvedFrequency,
      doer,
      doerFirstName,
      doerLastName,
      department: department || '',
      site: site || 'HO',
      startDate,
      endDate: resolvedEndDate,
      proofRequired: proofRequired || false,
      createdBy: req.user._id,
      assignmentType: chain.length ? 'buddy' : 'single',
      buddyChain: chain,
    });

    // Generate occurrences, one per office day the routine falls due.
    const { dates, truncated } = officeDaySchedule(startDate, resolvedEndDate, resolvedFrequency, { limit: MAX_OCCURRENCES });
    const occurrences = dates.map((plannedDate) => occurrenceFor(routine, plannedDate, req.user));

    if (occurrences.length > 0) {
      await ChecklistOccurrence.insertMany(occurrences);
    }

    // Today's occurrence goes to a backup now if the primary is already away.
    if (chain.length) await runBuddySweep({ routineIds: [routine._id] });

    res.status(201).json({
      success: true,
      data: { routine, occurrencesCreated: occurrences.length, truncated },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /checklist/routines/:id
 * Edit a routine.
 */
export async function updateRoutine(req, res, next) {
  try {
    if (!isManager(req.user)) {
      return res.status(403).json({ success: false, message: 'Only managers can update routines.' });
    }

    const routine = await ChecklistRoutine.findById(req.params.id);
    if (!routine) return res.status(404).json({ success: false, message: 'Routine not found.' });

    // Every editable field below — the name, the doer, the dates — is one the
    // stage owns and re-writes on its next sync. Accepting the edit would look
    // like it worked until the stage moved and silently undid it.
    if (isO2dMirror(routine)) return refuseMirrorEdit(res, 'edited');

    const before = {
      doer: String(routine.doer ?? ''),
      frequency: routine.frequency,
      start: startOfDay(routine.startDate).getTime(),
      end: startOfDay(routine.endDate ?? routine.startDate).getTime(),
    };

    let chainChange = null;
    try {
      chainChange = await applyRoutineChainEdit(routine, req.body);
    } catch (err) {
      if (err instanceof BuddyChainError) return res.status(400).json({ success: false, message: err.message });
      throw err;
    }
    const isBuddy = routine.assignmentType === 'buddy';

    // On a buddy routine the doer IS the chain's first person; edit the chain.
    const allowed = ['taskName', 'frequency', 'department', 'site', 'startDate', 'endDate', 'proofRequired'];
    if (!isBuddy) allowed.push('doer');
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) routine[key] = req.body[key];
    });

    if (startOfDay(routine.endDate ?? routine.startDate) < startOfDay(routine.startDate)) {
      return res.status(400).json({ success: false, message: 'The end date cannot be before the start date.' });
    }

    // Re-resolve doer name if doer changed
    if (req.body.doer && !isBuddy) {
      const doerUser = await User.findById(req.body.doer).select('user email').lean();
      if (!doerUser) return res.status(400).json({ success: false, message: 'That assignee does not exist.' });
      const nameParts = (doerUser?.user || doerUser?.email || '').split(' ');
      routine.doerFirstName = nameParts[0] || '';
      routine.doerLastName = nameParts.slice(1).join(' ') || '';
    }

    await routine.save();
    const cascade = await cascadeRoutineEdit(routine, before, req.user);
    if (chainChange === 'on') await applyChainToOccurrences(routine, req.user);
    else if (isBuddy && cascade.regenerated > 0) await runBuddySweep({ routineIds: [routine._id] });
    res.json({ success: true, data: routine, ...cascade });
  } catch (err) {
    next(err);
  }
}

/**
 * Carry a routine edit onto the work it describes.
 *
 * Saving the routine alone changed nothing anybody saw: every generated row
 * kept the old name, doer and dates. Only rows not yet worked and not yet past
 * move — today onwards, still pending — and never a row a manager placed by
 * hand (`assignmentSource: 'manual'`). If the SCHEDULE changed, those rows are
 * regenerated from the new one; a day already worked or pinned is kept and
 * not generated twice.
 *
 * A buddy routine's doer is the chain's to decide (`applyChainToOccurrences`
 * and the sweep), so only a single-assignee routine pushes `doer` here.
 */
async function cascadeRoutineEdit(routine, before, actor, now = new Date()) {
  const from = startOfDay(now);
  const movable = { ...unworkedFrom(routine._id, from), assignmentSource: { $ne: 'manual' } };
  const isBuddy = routine.assignmentType === 'buddy';
  const doerChanged = !isBuddy && String(routine.doer ?? '') !== before.doer;
  const scheduleChanged = routine.frequency !== before.frequency
    || startOfDay(routine.startDate).getTime() !== before.start
    || startOfDay(routine.endDate ?? routine.startDate).getTime() !== before.end;
  const handedOver = doerChanged
    ? { assignedAt: now, reassigned: true, reassignedTo: routine.doer, reassignedBy: actor._id }
    : {};

  if (scheduleChanged) {
    const removed = await ChecklistOccurrence.deleteMany(movable);
    const kept = await ChecklistOccurrence.find({ routine: routine._id }).select('plannedDate').lean();
    const taken = new Set(kept.map((o) => startOfDay(o.plannedDate).getTime()));
    const { dates, truncated } = officeDaySchedule(
      routine.startDate, routine.endDate ?? routine.startDate, routine.frequency, { limit: MAX_OCCURRENCES },
    );
    const fresh = dates
      .filter((d) => d >= from && !taken.has(startOfDay(d).getTime()))
      .map((d) => occurrenceFor(routine, d, actor, handedOver));
    if (fresh.length > 0) await ChecklistOccurrence.insertMany(fresh);
    return { futureUpdated: removed.deletedCount, regenerated: fresh.length, truncated };
  }

  const result = await ChecklistOccurrence.updateMany(movable, {
    $set: {
      taskName: routine.taskName,
      department: routine.department,
      site: routine.site,
      proofRequired: routine.proofRequired,
      ...(doerChanged
        ? { doer: routine.doer, doerFirstName: routine.doerFirstName, doerLastName: routine.doerLastName, ...handedOver }
        : {}),
    },
  });
  return { futureUpdated: result.modifiedCount, regenerated: 0, truncated: false };
}

/**
 * Apply a Buddy System edit to `routine` (unsaved). Returns 'on' when the
 * routine now has a new chain, 'off' when the chain was dropped, else null.
 */
async function applyRoutineChainEdit(routine, body) {
  if (body.assignmentType === undefined && body.buddyChain === undefined) return null;
  const nextType = body.assignmentType ?? routine.assignmentType ?? 'single';

  if (nextType === 'single') {
    if (routine.assignmentType !== 'buddy') return null;
    routine.assignmentType = 'single';
    routine.buddyChain = [];
    return 'off';
  }
  if (nextType !== 'buddy') throw new BuddyChainError(`Unknown assignment type "${nextType}".`);

  const chain = await resolveBuddyChain(body.buddyChain ?? routine.buddyChain);
  if (routine.assignmentType === 'buddy' && sameChain(chain, routine.buddyChain)) return null;

  const { first, last } = splitName(chain[0].name);
  routine.assignmentType = 'buddy';
  routine.buddyChain = chain;
  routine.doer = chain[0].userId;
  routine.doerFirstName = first;
  routine.doerLastName = last;
  return 'on';
}

/**
 * A new chain applies from today on.
 *
 * Future, unworked occurrences go back to the new primary — on their own day
 * the rotation starts from them. Today's is re-decided now, from the top of
 * the new chain, so a removed backup who was holding it loses it and a
 * reordered chain takes effect at once. Past days, finished work and
 * occurrences a manager assigned by hand are left as they are.
 */
async function applyChainToOccurrences(routine, actor) {
  const now = new Date();
  const notManual = { routine: routine._id, status: 'pending', assignmentSource: { $ne: 'manual' } };
  const primary = routine.buddyChain[0];
  const { first, last } = splitName(primary.name);

  await ChecklistOccurrence.updateMany(
    { ...notManual, plannedDate: { $gt: endOfDay(now) } },
    {
      $set: {
        doer: primary.userId,
        doerFirstName: first,
        doerLastName: last,
        assignmentSource: 'primary',
        assignmentReason: '',
        buddyDay: null,
        noAssigneeDay: null,
      },
    },
  );

  const day = officeDayKey(now);
  await ChecklistOccurrence.updateMany(
    { ...notManual, plannedDate: { $gte: startOfDay(now), $lte: endOfDay(now) } },
    {
      $set: { buddyDay: null, noAssigneeDay: null },
      $push: {
        assignmentHistory: assignmentEvent({
          day,
          event: 'chain_changed',
          source: 'manual',
          reason: `Buddy chain set to ${routine.buddyChain.map((m, i) => `${i + 1}. ${m.name}`).join(', ')}`,
          by: actor,
        }),
      },
    },
  );

  await runBuddySweep({ routineIds: [routine._id], now });
}

/**
 * PATCH /checklist/routines/:id/stop
 * Deactivate a routine.
 */
export async function stopRoutine(req, res, next) {
  try {
    if (!isManager(req.user)) {
      return res.status(403).json({ success: false, message: 'Only managers can stop routines.' });
    }

    const existing = await ChecklistRoutine.findById(req.params.id).select('sourceType').lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Routine not found.' });

    // Stopping the routine would not stop the WORK — the stage stays open and
    // the occurrence stays on the assignee's list. Unassign the stage instead.
    if (isO2dMirror(existing)) return refuseMirrorEdit(res, 'stopped');

    const routine = await ChecklistRoutine.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true },
    );

    /**
     * Stopping ends the work, not just the label. Nothing reads `isActive` for
     * the rows, so every pre-generated future row used to stay pending, go
     * overdue a day at a time and drag the doer's compliance down for a
     * routine that no longer existed. Rows from tomorrow on that nobody worked
     * are removed; today's stays due, and the past is the record.
     */
    const tomorrow = new Date(endOfDay(new Date()).getTime() + 1);
    const removed = await ChecklistOccurrence.deleteMany(unworkedFrom(routine._id, tomorrow));

    res.json({ success: true, data: routine, futureRemoved: removed.deletedCount });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /checklist/tasks/:id/complete
 * Mark a task as completed.
 */
export async function completeTask(req, res, next) {
  try {
    const task = await ChecklistOccurrence.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

    // An O2D row is authorised by O2D (`completeMirroredTask` → `canWorkStage`),
    // which also admits a team task's whole role — it has no doer to compare.
    if (!isO2dMirror(task) && !isManager(req.user) && String(task.doer) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to complete this task.' });
    }

    if (task.status === 'completed') return res.status(400).json({ success: false, message: 'Task already completed.' });
    // A row taken off its doer is history; the work is live on somebody else's row.
    if (task.status === OCCURRENCE_REASSIGNED_AWAY) {
      return res.status(409).json({ success: false, message: 'This task was moved to somebody else and can no longer be completed here.' });
    }

    /**
     * A MIRRORED task is completed by completing the STAGE, never by writing
     * 'completed' here.
     *
     * `completeStage` runs the ordering checks, the required-evidence rules and
     * the SLA math, and its own hook then updates THIS SAME document (see
     * `markChecklistMirrorDone`). Setting the status directly would let a stage
     * that O2D would have refused — a missing invoice number, an unfinished
     * predecessor — read as done on one screen and open on the other.
     *
     * Any proof file the user attached is kept afterwards, once the completion
     * has actually been accepted. It is extra, not the gate: the stage's own
     * required fields are the gate, which is why the mirror is created with
     * `proofRequired: false`.
     */
    if (isO2dMirror(task)) {
      await completeMirroredTask(task, {
        actor: req.user,
        evidence: req.body.evidence ?? null,
        remarks: req.body.remarks ?? null,
        req,
      });

      if (req.body.proofUrl) {
        await ChecklistOccurrence.updateOne(
          { _id: task._id },
          {
            $set: {
              proofUrl: req.body.proofUrl,
              ...(req.body.proofFileName ? { proofFileName: req.body.proofFileName } : {}),
            },
          },
        );
      }

      const refreshed = await ChecklistOccurrence.findById(task._id);
      return res.json({ success: true, data: refreshed });
    }

    if (task.proofRequired && !req.body.proofUrl) {
      return res.status(400).json({ success: false, message: 'Proof document URL is required to complete this task.' });
    }

    task.status = 'completed';
    task.completedDate = new Date();
    task.completedBy = req.user._id;

    if (req.body.proofUrl) task.proofUrl = req.body.proofUrl;
    if (req.body.proofFileName) task.proofFileName = req.body.proofFileName;

    await task.save();
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /checklist/tasks/:id/non-functional
 * Mark a task as non-functional.
 */
export async function markNonFunctional(req, res, next) {
  try {
    const task = await ChecklistOccurrence.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

    /**
     * "Not needed" on a mirrored task is an O2D SKIP, and skipping a stage is
     * a decision O2D guards with its own authority check and a mandatory
     * reason (§7). Closing the mirror here would leave the real stage sitting
     * open forever with nobody looking at it.
     */
    if (isO2dMirror(task)) return refuseMirrorEdit(res, 'marked non-functional');

    if (!isManager(req.user) && String(task.doer) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this task.' });
    }

    task.status = 'non-functional';
    task.nonFunctionalReason = req.body.reason || '';
    await task.save();

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /checklist/tasks/:id/reassign
 * Reassign a task to another user.
 */
export async function reassignTask(req, res, next) {
  try {
    if (!isManager(req.user)) {
      return res.status(403).json({ success: false, message: 'Only managers can reassign tasks.' });
    }

    const task = await ChecklistOccurrence.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

    /**
     * Reassigning here would move the doer on the mirror while the stage still
     * named the old person — and `stage.assignedTo` is what decides who may
     * actually complete it. The new doer would be looking at a task they are
     * not permitted to finish. Order Tracker's own assign control moves both.
     */
    if (isO2dMirror(task)) return refuseMirrorEdit(res, 'reassigned');

    let newDoer;
    try {
      newDoer = await resolveActiveAssignee(req.body.newDoer);
    } catch (err) {
      if (err instanceof BuddyChainError) return res.status(400).json({ success: false, message: err.message });
      throw err;
    }

    const from = { userId: task.doer, name: [task.doerFirstName, task.doerLastName].filter(Boolean).join(' ') };
    const nameParts = splitName(newDoer.name);
    task.doer = newDoer.userId;
    task.doerFirstName = nameParts.first;
    task.doerLastName = nameParts.last;
    task.reassigned = true;
    task.reassignedTo = newDoer.userId;
    task.reassignedBy = req.user._id;
    task.assignedAt = new Date();

    /**
     * A manual assignment PINS this occurrence: the buddy rotation leaves a
     * row a manager placed by hand alone. It is one day's row, so the pin
     * lasts exactly that day — the next occurrence follows the chain again.
     */
    const reason = `Assigned manually by ${req.user.user || req.user.email || 'a manager'}`;
    task.assignmentSource = 'manual';
    task.assignmentReason = reason;
    task.noAssigneeDay = null;
    task.assignmentHistory.push(assignmentEvent({
      day: officeDayKey(task.plannedDate),
      event: 'manual_override',
      source: 'manual',
      from,
      to: newDoer,
      reason,
      by: req.user,
    }));
    await task.save();

    await recordAudit(req.user, 'Work Queue Checklist: Manual Reassign', `${task.taskName}: ${from.name} → ${newDoer.name}`, req, {
      meta: { occurrenceId: String(task._id), from: String(from.userId), to: String(newDoer.userId) },
    });

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /checklist/tasks/remark
 * Add a remark to one or more tasks (single or bulk).
 */
export async function addRemark(req, res, next) {
  try {
    const { taskIds, text } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0 || !text) {
      return res.status(400).json({ success: false, message: 'taskIds and text are required.' });
    }

    const remark = {
      text,
      by: req.user._id,
      byName: req.user.user || req.user.email || 'Unknown',
      createdAt: new Date(),
    };

    /*
     * Only rows this person may see — their own and the O2D tasks they work,
     * or any for a manager — the same scope their list is built from. Before,
     * any id in the company took the remark.
     */
    const ids = taskIds.filter((id) => mongoose.isValidObjectId(id));
    const filter = isManager(req.user)
      ? { _id: { $in: ids } }
      : { $and: [{ _id: { $in: ids } }, visibilityScope(req.user, await o2dAbilityFor(req.user), { mine: true })] };

    const result = await ChecklistOccurrence.updateMany(filter, { $push: { remarks: remark } });

    if (result.modifiedCount === 0) {
      return res.status(403).json({ success: false, message: 'None of those tasks are yours to remark on.' });
    }
    res.json({
      success: true,
      data: { updated: result.modifiedCount, skipped: taskIds.length - result.modifiedCount },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /checklist/tasks/drilldown
 * KPI drilldown — tasks filtered by a specific KPI bucket.
 */
export async function drilldown(req, res, next) {
  try {
    const { kpi, site } = req.query;
    // Drill-down opens the rows BEHIND a tile, so it has to exclude exactly
    // what the tile excluded or the list will not add up to the number clicked.
    const filter = { status: { $ne: OCCURRENCE_REASSIGNED_AWAY } };
    if (site) filter.site = site;
    const scope = visibilityScope(req.user, await o2dAbilityFor(req.user));
    if (scope) {
      filter.$and = [scope];
      filter.heldAt = null;
    }

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    switch (kpi) {
      case 'total':
        // all tasks
        break;
      case 'pendingToday':
        filter.status = 'pending';
        filter.plannedDate = { $gte: todayStart, $lte: todayEnd };
        break;
      case 'overdue':
        filter.$and = [...(filter.$and ?? []), overdueClause(now)];
        break;
      case 'completed':
        filter.status = 'completed';
        break;
      default:
        break;
    }

    const tasks = await ChecklistOccurrence.find(filter)
      .sort({ plannedDate: -1 })
      .limit(100)
      .lean();

    res.json({ success: true, data: tasks.map(enrichStatus) });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /checklist/tasks/new-count
 * How many tasks reached the caller's own queue since they last opened the
 * Checklist — the sidebar badge.
 */
export async function getNewCount(req, res, next) {
  try {
    const ability = await o2dAbilityFor(req.user);
    const seenAt = await seenAtFor(req.user._id);
    const ids = await newTaskIdsFor(req.user, ability, seenAt);
    res.json({ success: true, data: { count: ids.size, seenAt } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /checklist/seen
 * The caller opened their Checklist: everything that has arrived so far is no
 * longer new for them. Only their own marker moves.
 */
export async function markSeen(req, res, next) {
  try {
    const seenAt = new Date();
    await WorkQueueSeen.updateOne(
      { user: req.user._id, list: 'checklist' },
      { $set: { seenAt } },
      { upsert: true },
    );
    res.json({ success: true, data: { seenAt } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /checklist/users
 * List users for the doer dropdown (admin/manager only).
 */
export async function getUsers(req, res, next) {
  try {
    const users = await User.find({ status: 'Active' })
      .select('user email role')
      .sort({ user: 1 })
      .lean();

    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /checklist/locations
 * List distinct sites from existing data.
 */
export async function getLocations(req, res, next) {
  try {
    const sites = await ChecklistOccurrence.distinct('site');
    // Always include 'HO' if not present
    if (!sites.includes('HO')) sites.unshift('HO');
    res.json({ success: true, data: sites });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /checklist/departments-list
 * List distinct departments from existing data.
 */
export async function getDepartmentsList(req, res, next) {
  try {
    const departments = await ChecklistOccurrence.distinct('department');
    res.json({ success: true, data: departments.filter(Boolean) });
  } catch (err) {
    next(err);
  }
}
