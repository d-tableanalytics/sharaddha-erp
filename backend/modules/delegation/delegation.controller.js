import mongoose from 'mongoose';
import { Delegation, DELEGATION_REASSIGNED_AWAY } from '../../models/Delegation.js';
import User from '../../models/User.js';
import { isSuperAdmin, can } from '../../middlewares/rbac.js';
import { logActivity } from '../activities/activity.controller.js';
import { completeMirroredTask } from '../o2d/o2dDelegationSync.service.js';
import { startOfOfficeDay, endOfOfficeDay, officeDayKey } from '../../utils/officeDay.js';
import {
  resolveBuddyChain, resolveActiveAssignee, sameChain, splitName, assignmentEvent, runBuddySweep, BuddyChainError,
} from '../workqueue/buddy.service.js';
import { notifyUsers } from '../hrms/inbox/notifier.service.js';
import { INBOX_TYPES } from '../../shared/constants/inbox.js';
import { recordAudit } from '../../utils/auditLog.js';

const ADMIN_ROLES = ['Super Admin', 'Admin', 'Management', 'HR'];
const isManager = (user) => isSuperAdmin(user) || ADMIN_ROLES.includes(user?.role);

// Office-day boundaries (IST), not the server's own midnight.
const startOfDay = startOfOfficeDay;
const endOfDay = endOfOfficeDay;

/** Search text is matched literally — `(` or `C++` is a title, not a pattern. */
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchRegex = (text) => new RegExp(escapeRegex(text), 'i');

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * How the caller stands to ONE task.
 *
 *   owner  the assigner, or a manager — may change the task, verify it,
 *          move its date, delete it
 *   doer   the person doing it — may move it through the work, never verify
 *          their own work or move their own deadline
 *   sees   anybody on it at all, in-loop included — may read it and remark
 *
 * The permission matrix says what KIND of thing a person may do anywhere in
 * the Work Queue; this says WHICH tasks. Without it every `:id` route acted on
 * any task in the company for anybody holding the cell — and the baseline
 * gives every staff role the cell.
 */
function relationTo(task, user) {
  const manager = isManager(user);
  const assigner = sameId(task.assignerId, user._id);
  const doer = sameId(task.doerId, user._id);
  const inLoop = (task.inLoop ?? []).some((p) => sameId(p?.userId, user._id));
  // A backup in a buddy chain may read the task they may be handed tomorrow.
  // Only the doer of the day may work it.
  const buddy = task.assignmentType === 'buddy' && (task.buddyChain ?? []).some((m) => sameId(m?.userId, user._id));
  return { owner: manager || assigner, assigner, doer, sees: manager || assigner || doer || inLoop || buddy };
}

const NEEDS = {
  sees: (rel) => rel.sees,
  participant: (rel) => rel.owner || rel.doer,
  owner: (rel) => rel.owner,
};

/**
 * Load `req.params.id` for an action that needs `need` of the caller, or answer
 * the request and return null. A task the caller cannot see at all is a 404,
 * not a 403, so ids cannot be probed for existence.
 */
async function loadTaskFor(req, res, need = 'sees', { includeDeleted = false, lean = false } = {}) {
  const notFound = () => res.status(404).json({ success: false, message: 'Delegated task not found' });
  if (!mongoose.isValidObjectId(req.params.id)) { notFound(); return null; }

  const query = Delegation.findById(req.params.id);
  const task = lean ? await query.lean() : await query;
  if (!task || (!includeDeleted && task.isDeleted)) { notFound(); return null; }

  const rel = relationTo(task, req.user);
  if (!rel.sees) { notFound(); return null; }
  if (!NEEDS[need](rel)) {
    res.status(403).json({
      success: false,
      message: need === 'owner'
        ? 'Only the person who assigned this task (or a manager) can do that.'
        : 'Only the assigner or the doer of this task can do that.',
    });
    return null;
  }
  return { task, rel };
}

/** The owner-scoped clause for bulk writes: a manager owns everything. */
const ownedBy = (user) => (isManager(user) ? {} : { assignerId: user._id });

const hasEvidence = (t) => Boolean(String(t.evidenceUrl ?? '').trim() || String(t.evidenceNotes ?? '').trim());

/**
 * An evidence link is rendered as an `href`, so only web links (and the
 * `uploaded://` placeholder My Day writes for an attached file) are accepted —
 * a `javascript:` URL stored here would run in whoever opens the task.
 */
const SAFE_EVIDENCE_URL = /^(https?:\/\/|uploaded:\/\/)/i;
const isSafeEvidenceUrl = (url) => !String(url ?? '').trim() || SAFE_EVIDENCE_URL.test(String(url).trim());

/**
 * Put `task` into `next`, keeping the completion stamps honest.
 *
 * `completedAt` is when the DOER finished — stamped on submit for verification
 * or on completion, kept through verification, and cleared the moment the
 * task goes back to being work. A reopened task used to keep its old stamp,
 * and the scoreboard counts any stamped row as done.
 */
function applyStatus(task, next, actor, now = new Date()) {
  task.status = next;
  if (next === 'Completed') {
    task.completedAt = task.completedAt ?? now;
    task.verifiedAt = now;
    task.verifiedBy = actor._id;
  } else if (next === 'Awaiting Verification') {
    task.completedAt = task.completedAt ?? now;
    task.verifiedAt = null;
    task.verifiedBy = null;
  } else {
    task.completedAt = null;
    task.verifiedAt = null;
    task.verifiedBy = null;
  }
}

/** The statuses a person may set by hand. `Reassigned` is the system's alone. */
const SETTABLE_STATUSES = ['Pending', 'In Progress', 'Awaiting Verification', 'Completed', 'Need Revision'];

/** What a doer who is not also the owner may move their own task to. */
const DOER_STATUSES = ['In Progress', 'Awaiting Verification', 'Completed'];

/** Fields only the owner may change. A doer moves the work, not its terms. */
const OWNER_FIELDS = [
  'taskTitle', 'description', 'priority', 'category', 'categoryColor', 'tags',
  'dueDate', 'recurrence', 'evidenceRequired', 'verificationRequired',
  'assignmentType', 'buddyChain',
];

/** A chain error is the caller's mistake — answer 400 with its message. */
const chainErrorResponse = (res, err) => res.status(err.status ?? 400).json({ success: false, message: err.message });

/**
 * GET /api/v1/delegation
 * List delegated tasks.
 */
export async function getDelegations(req, res, next) {
  try {
    const currentUserId = req.user._id;
    const currentUserName = req.user.user || req.user.email;

    const {
      search,
      status,
      priority,
      category,
      assignedTo,
      tagFilter,
      dateRange,
      customStartDate,
      customEndDate,
      verification,
      detailed,
    } = req.query;

    const filter = { isDeleted: { $ne: true } };

    const conditions = [];

    // In-Loop perspective vs My Work perspective (doer or in loop) vs Delegator perspective (assigner)
    if (req.query.scope === 'inLoop' || req.query.inLoop === 'true') {
      const targetUserId = (isManager(req.user) && (req.query.inLoopUserId || req.query.viewingId))
        ? (req.query.inLoopUserId || req.query.viewingId)
        : currentUserId;
      conditions.push({
        'inLoop.userId': targetUserId,
      });
    } else if (req.query.myWork === 'true' || req.query.scope === 'myWork') {
      conditions.push({
        $or: [
          { doerId: currentUserId },
          { 'inLoop.userId': currentUserId },
        ],
      });
      /**
       * A mirrored task whose O2D order is parked is not this person's work
       * today, and O2D's own My Tasks already stops showing it — see the
       * ON_HOLD note in `o2d/task.service.js`. This is the Work Queue saying
       * the same thing, so the two screens cannot disagree about what is owed.
       *
       * `null` matches a MISSING field too, so every task written before this
       * flag existed — and every manual one, which never sets it — is
       * unaffected. Scoped to this branch on purpose: All Tasks and the
       * delegator's own view are audit surfaces and keep showing everything.
       */
      conditions.push({ heldAt: null });
      /**
       * …and neither is a task that was taken off this person. It is live in
       * somebody else's queue now; this row survives only as the record of
       * where it went (`reassignedTo`, `reassignedBy`, and the remark), which
       * All Tasks below still shows.
       */
      conditions.push({ status: { $ne: DELEGATION_REASSIGNED_AWAY } });
    } else if (req.query.scope === 'allTasks' || req.query.scope === 'all') {
      if (!isManager(req.user)) {
        conditions.push({
          $or: [
            { assignerId: currentUserId },
            { doerId: currentUserId },
            { 'inLoop.userId': currentUserId },
            { inLoopIds: currentUserId },
          ],
        });
      }
    } else if (req.query.viewAll === 'true') {
      if (!isManager(req.user)) {
        filter.assignerId = currentUserId;
      }
    } else if (!req.query.viewAll || !isManager(req.user)) {
      filter.assignerId = currentUserId;
    }

    // Search
    if (search) {
      const regex = searchRegex(search);
      conditions.push({
        $or: [
          { taskTitle: regex },
          { description: regex },
          { doerFirstName: regex },
          { doerLastName: regex },
          { assigneeHierarchy: regex },
        ],
      });
    }

    if (conditions.length > 0) {
      filter.$and = conditions;
    }

    const now = new Date();

    // Status filter
    if (status) {
      if (status === 'Overdue') {
        filter.dueDate = { $lt: startOfDay(now) };
        // A handed-away task is nobody's overdue work — the person who no
        // longer has it cannot finish it, and the person who does has their own
        // row with its own deadline.
        filter.status = { $nin: ['Completed', 'Awaiting Verification', DELEGATION_REASSIGNED_AWAY] };
        // A locked O2D stage's placeholder date is not a deadline.
        filter.scheduleTbd = { $ne: true };
      } else {
        filter.status = status;
      }
    }

    // Priority filter
    if (priority && priority !== 'All') {
      filter.priority = priority;
    }

    // Category filter
    if (category && category !== 'All') {
      filter.category = category;
    }

    // Assignee filter
    if (assignedTo && assignedTo !== 'All') {
      filter.doerId = assignedTo;
    }

    // Tag filter
    if (tagFilter && tagFilter !== 'All') {
      filter['tags.name'] = tagFilter;
    }

    // Verification filter
    if (verification) {
      if (verification === 'Verification Required') {
        filter.verificationRequired = true;
      } else if (verification === 'None') {
        filter.verificationRequired = false;
      }
    }

    // Date range filter
    if (dateRange === 'Today') {
      filter.dueDate = { $gte: startOfDay(now), $lte: endOfDay(now) };
    } else if (dateRange === 'Yesterday') {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      filter.dueDate = { $gte: startOfDay(y), $lte: endOfDay(y) };
    } else if (dateRange === 'This Week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(new Date(now).setDate(diff));
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      filter.dueDate = { $gte: startOfDay(monday), $lte: endOfDay(sunday) };
    } else if (dateRange === 'Last Week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1) - 7;
      const monday = new Date(new Date(now).setDate(diff));
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      filter.dueDate = { $gte: startOfDay(monday), $lte: endOfDay(sunday) };
    } else if (dateRange === 'This Month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      filter.dueDate = { $gte: startOfDay(firstDay), $lte: endOfDay(lastDay) };
    } else if (dateRange === 'Last Month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      filter.dueDate = { $gte: startOfDay(firstDay), $lte: endOfDay(lastDay) };
    } else if (dateRange === 'This Year') {
      const firstDay = new Date(now.getFullYear(), 0, 1);
      const lastDay = new Date(now.getFullYear(), 11, 31);
      filter.dueDate = { $gte: startOfDay(firstDay), $lte: endOfDay(lastDay) };
    } else if (dateRange === 'Custom' && customStartDate && customEndDate) {
      filter.dueDate = {
        $gte: startOfDay(customStartDate),
        $lte: endOfDay(customEndDate),
      };
    }

    const tasks = await Delegation.find(filter)
      .sort({ updatedAt: -1, dueDate: 1 })
      .lean();

    res.json({ success: true, data: tasks });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/delegation/:id
 */
export async function getDelegationById(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'sees', { lean: true });
    if (!loaded) return;
    res.json({ success: true, data: loaded.task });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/delegation
 * Create a new delegated task.
 */
export async function createDelegation(req, res, next) {
  try {
    const currentUserId = req.user._id;
    const currentUserName = req.user.user || req.user.email;

    const {
      taskTitle,
      description,
      doerId,
      doerFirstName,
      doerLastName,
      assigneeHierarchy,
      inLoop,
      priority,
      category,
      categoryColor,
      tags,
      dueDate,
      startDate,
      recurrence,
      verificationRequired,
      evidenceRequired,
      subtasks,
      assignmentType,
      buddyChain,
    } = req.body;

    /**
     * Buddy System: the chain decides the doer. Its first person is the
     * primary and the task starts with them; the rotation below hands it on
     * at once if they are already away.
     */
    let chain = [];
    if (assignmentType === 'buddy') {
      try {
        chain = await resolveBuddyChain(buddyChain);
      } catch (err) {
        if (err instanceof BuddyChainError) return chainErrorResponse(res, err);
        throw err;
      }
    }
    const primary = chain[0] ?? null;
    const resolvedDoerId = primary ? primary.userId : doerId;

    if (!taskTitle || !resolvedDoerId || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Task title, doer assignee, and due date are required.',
      });
    }

    // Lookup doer details if not provided
    let finalDoerFirstName = primary ? splitName(primary.name).first : doerFirstName;
    let finalDoerLastName = primary ? splitName(primary.name).last : doerLastName;
    let finalHierarchy = primary ? null : assigneeHierarchy;

    if (!finalDoerFirstName || !finalHierarchy) {
      const doerUser = await User.findById(resolvedDoerId).lean();
      if (doerUser) {
        const parts = (doerUser.user || 'User').split(' ');
        finalDoerFirstName = finalDoerFirstName || parts[0];
        finalDoerLastName = finalDoerLastName || parts.slice(1).join(' ') || '';
        finalHierarchy = finalHierarchy || `${doerUser.user || 'User'} → ${doerUser.role || 'Member'}`;
      }
    }

    const doc = new Delegation({
      taskTitle,
      description: description || '',
      assignerId: currentUserId,
      assignerName: currentUserName,
      doerId: resolvedDoerId,
      doerFirstName: finalDoerFirstName || 'Team',
      doerLastName: finalDoerLastName || 'Member',
      assigneeHierarchy: finalHierarchy || `${finalDoerFirstName} ${finalDoerLastName}`,
      inLoop: inLoop || [],
      status: 'Pending',
      priority: priority || 'Medium',
      category: category || 'Operations',
      categoryColor: categoryColor || '#1E4C92',
      tags: tags || [],
      startDate: startDate ? new Date(startDate) : new Date(),
      dueDate: new Date(dueDate),
      recurrence: recurrence || 'none',
      verificationRequired: verificationRequired !== undefined ? verificationRequired : true,
      evidenceRequired: !!evidenceRequired,
      subtasks: (subtasks || []).map((s) => (typeof s === 'string' ? { title: s } : s)),
      remarks: [],
      dateRevisions: [],
      assignmentType: primary ? 'buddy' : 'single',
      buddyChain: chain,
    });

    await doc.save();

    logActivity({
      type: 'task_created',
      title: doc.taskTitle,
      description: doc.description || `Task delegated to ${doc.doerFirstName || 'assignee'}`,
      userId: req.user._id,
      relatedId: doc._id,
      metadata: { taskUid: `DEL-${String(doc._id).slice(-4).toUpperCase()}` },
    });

    // A task that starts while its primary is already away goes to the first
    // available backup now, not on the scheduler's next tick.
    if (primary) {
      await runBuddySweep({ delegationIds: [doc._id] });
      const rotated = await Delegation.findById(doc._id);
      return res.status(201).json({ success: true, data: rotated });
    }

    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/delegation/:id
 * Update delegated task fields.
 */
export async function updateDelegation(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'participant');
    if (!loaded) return;
    const { task, rel } = loaded;

    const updates = req.body ?? {};
    const isMirrored = task.sourceType === 'o2d_stage';

    if (updates.evidenceUrl !== undefined && !isSafeEvidenceUrl(updates.evidenceUrl)) {
      return res.status(400).json({ success: false, message: 'Evidence must be a web link (http:// or https://).' });
    }

    // The doer moves the work; the terms of it — title, deadline, whether it
    // needs verifying — are the assigner's.
    if (!rel.owner && OWNER_FIELDS.some((key) => updates[key] !== undefined)) {
      return res.status(403).json({
        success: false,
        message: 'Only the person who assigned this task (or a manager) can change its details.',
      });
    }

    /**
     * A MIRRORED task's status is not this screen's to set.
     *
     * "Completed" runs the real O2D stage completion — evidence, SLA, ordering,
     * the lot — through `completeMirroredTask`, which updates THIS SAME
     * document as a side effect of that succeeding (see `markMirrorDone` in
     * `delegationMirror.service.js`). Any other requested status change for a
     * mirrored task is silently a no-op below: the mirror's status only ever
     * moves because the stage did, never because somebody dragged a card.
     */
    if (updates.status === 'Completed' && isMirrored) {
      await completeMirroredTask(task, {
        actor: req.user,
        evidence: updates.evidence ?? null,
        remarks: updates.remarks ?? null,
        req,
      });
      const refreshed = await Delegation.findById(task._id);
      return res.json({ success: true, data: refreshed });
    }

    // Status update handling
    if (updates.status && updates.status !== task.status && !isMirrored) {
      const next = updates.status;

      // `Reassigned` drops a row out of My Work and out of the scoreboard's
      // denominator, so a doer setting it on their own task ducked it entirely.
      if (!SETTABLE_STATUSES.includes(next)) {
        return res.status(400).json({ success: false, message: `Status "${next}" cannot be set by hand.` });
      }

      if (!rel.owner) {
        if (task.status === 'Completed') {
          return res.status(403).json({ success: false, message: 'This task is already completed. Ask the assigner to reopen it.' });
        }
        if (!DOER_STATUSES.includes(next)) {
          return res.status(403).json({ success: false, message: `Only the assigner can move this task to "${next}".` });
        }
        // Verification exists so somebody OTHER than the doer signs it off.
        if (next === 'Completed' && task.verificationRequired) {
          return res.status(403).json({
            success: false,
            message: 'This task needs verification. Submit it for verification and the assigner will complete it.',
            code: 'VERIFICATION_REQUIRED',
          });
        }
      }

      // Marking a task Completed straight from this endpoint is the same act
      // /:id/verify performs one click at a time, so it needs the same grant.
      if (next === 'Completed' && !can(req.user, 'work_queue', 'completion', 'edit')) {
        return res.status(403).json({ success: false, message: 'Forbidden. Insufficient permissions.' });
      }

      if (['Awaiting Verification', 'Completed'].includes(next) && task.evidenceRequired) {
        const evidence = {
          evidenceUrl: updates.evidenceUrl ?? task.evidenceUrl,
          evidenceNotes: updates.evidenceNotes ?? task.evidenceNotes,
        };
        if (!hasEvidence(evidence)) {
          return res.status(400).json({
            success: false,
            message: 'This task requires evidence. Attach a link or notes before submitting it.',
            code: 'EVIDENCE_REQUIRED',
          });
        }
      }

      applyStatus(task, next, req.user);
    }

    /**
     * Identity fields on a mirrored task are the O2D stage's to own.
     *
     * `taskTitle` and `dueDate` are kept in step by
     * `resyncMirrorSchedule`/`createMirrorDelegation` whenever the real stage's
     * name or deadline changes — accepting an edit here would let this screen
     * and Order Tracker disagree about which order and stage this even is.
     */
    if (updates.taskTitle && !isMirrored) task.taskTitle = updates.taskTitle;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.priority) task.priority = updates.priority;
    if (updates.category) task.category = updates.category;
    if (updates.categoryColor) task.categoryColor = updates.categoryColor;
    if (updates.tags) task.tags = updates.tags;
    if (updates.dueDate && !isMirrored) task.dueDate = new Date(updates.dueDate);
    if (updates.recurrence) task.recurrence = updates.recurrence;
    if (updates.evidenceRequired !== undefined) task.evidenceRequired = updates.evidenceRequired;
    if (updates.verificationRequired !== undefined) task.verificationRequired = updates.verificationRequired;
    if (updates.evidenceUrl !== undefined) task.evidenceUrl = updates.evidenceUrl;
    if (updates.evidenceNotes !== undefined) task.evidenceNotes = updates.evidenceNotes;

    let chainChanged = false;
    if (updates.assignmentType !== undefined || updates.buddyChain !== undefined) {
      if (isMirrored) {
        return res.status(400).json({ success: false, message: 'A task mirrored from an O2D stage cannot use the Buddy System.' });
      }
      // Changing who is in the chain changes who does the work — that is
      // assigning, the same cell creating a task with a doer requires.
      if (!can(req.user, 'work_queue', 'assignment', 'edit')) {
        return res.status(403).json({ success: false, message: 'Forbidden. Insufficient permissions.' });
      }
      try {
        chainChanged = await applyChainEdit(task, updates, req.user);
      } catch (err) {
        if (err instanceof BuddyChainError) return chainErrorResponse(res, err);
        throw err;
      }
    }

    await task.save();

    // A new chain starts from its top today, unless a manager has pinned the doer.
    if (chainChanged && task.assignmentType === 'buddy' && task.assignmentSource !== 'manual') {
      await runBuddySweep({ delegationIds: [task._id] });
      const rotated = await Delegation.findById(task._id);
      return res.json({ success: true, data: rotated });
    }
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * Apply a Buddy System edit from `updateDelegation` to `task` (unsaved).
 * Returns whether anything changed.
 *
 *   → single   the chain is dropped; whoever holds the task today keeps it.
 *   → buddy    the new chain is stored and the day's decision is reset, so
 *              the rotation re-walks it from the top — a removed backup who
 *              was holding the task loses it, a reordered chain takes effect
 *              today. A manually pinned doer stays pinned.
 */
async function applyChainEdit(task, updates, actor) {
  const nextType = updates.assignmentType ?? task.assignmentType ?? 'single';
  const day = officeDayKey();

  if (nextType === 'single') {
    if (task.assignmentType !== 'buddy') return false;
    task.assignmentType = 'single';
    task.buddyChain = [];
    task.assignmentSource = 'primary';
    task.assignmentReason = '';
    task.buddyDay = null;
    task.noAssigneeDay = null;
    task.assignmentHistory.push(assignmentEvent({
      day, event: 'chain_changed', source: 'manual', reason: 'Buddy System turned off', by: actor,
    }));
    return true;
  }

  if (nextType !== 'buddy') throw new BuddyChainError(`Unknown assignment type "${nextType}".`);
  const chain = await resolveBuddyChain(updates.buddyChain ?? task.buddyChain);
  if (task.assignmentType === 'buddy' && sameChain(chain, task.buddyChain)) return false;

  task.assignmentType = 'buddy';
  task.buddyChain = chain;
  task.buddyDay = null;
  task.noAssigneeDay = null;
  task.assignmentHistory.push(assignmentEvent({
    day,
    event: 'chain_changed',
    source: 'manual',
    reason: `Buddy chain set to ${chain.map((m, i) => `${i + 1}. ${m.name}`).join(', ')}`,
    by: actor,
  }));
  return true;
}

/**
 * PATCH /api/v1/delegation/:id/assignee
 *
 * Manual override for a Buddy System task.
 *
 *   { doerId, reason? }  assign it to this person — any active employee, in
 *                        the chain or not — and pin it there. The rotation
 *                        stops for this task until it is resumed.
 *   { resume: true }     unpin, and let the rotation decide again from the
 *                        top of the chain, today.
 *
 * Recorded as `manual_override` / `resumed`, separately from what the
 * scheduler writes.
 */
export async function overrideAssignee(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'owner');
    if (!loaded) return;
    const { task } = loaded;

    if (task.sourceType === 'o2d_stage') {
      return res.status(400).json({ success: false, message: 'Reassign this O2D task from Order Tracker.' });
    }
    if (task.assignmentType !== 'buddy') {
      return res.status(400).json({ success: false, message: 'Manual override applies to Buddy System tasks.' });
    }
    if (['Completed', DELEGATION_REASSIGNED_AWAY].includes(task.status)) {
      return res.status(400).json({ success: false, message: 'This task is already closed.' });
    }

    const day = officeDayKey();
    const current = {
      userId: task.doerId,
      name: [task.doerFirstName, task.doerLastName].filter(Boolean).join(' '),
    };

    if (req.body?.resume) {
      if (task.assignmentSource !== 'manual') {
        return res.status(400).json({ success: false, message: 'This task is already following its buddy chain.' });
      }
      const holdsPrimary = sameId(task.doerId, task.buddyChain[0]?.userId);
      task.assignmentSource = holdsPrimary ? 'primary' : 'automatic';
      task.assignmentReason = '';
      task.buddyDay = null;
      task.noAssigneeDay = null;
      task.assignmentHistory.push(assignmentEvent({
        day, event: 'resumed', source: 'manual', from: current, to: current,
        reason: 'Automatic buddy rotation resumed', by: req.user,
      }));
      await task.save();
      await recordAudit(req.user, 'Work Queue Buddy: Rotation Resumed', task.taskTitle, req, { meta: { taskId: String(task._id) } });
      await runBuddySweep({ delegationIds: [task._id] });
      return res.json({ success: true, data: await Delegation.findById(task._id) });
    }

    let target;
    try {
      target = await resolveActiveAssignee(req.body?.doerId);
    } catch (err) {
      if (err instanceof BuddyChainError) return chainErrorResponse(res, err);
      throw err;
    }

    const note = String(req.body?.reason ?? '').trim().slice(0, 300);
    const actorName = req.user.user || req.user.email || 'a manager';
    const reason = `Assigned manually by ${actorName}${note ? ` — ${note}` : ''}`;
    const moved = !sameId(target.userId, task.doerId);
    const { first, last } = splitName(target.name);

    task.doerId = target.userId;
    task.doerFirstName = first;
    task.doerLastName = last;
    task.assignmentSource = 'manual';
    task.assignmentReason = reason;
    task.buddyDay = day;
    task.noAssigneeDay = null;
    task.assignmentHistory.push(assignmentEvent({
      day, event: 'manual_override', source: 'manual', from: current, to: target, reason, by: req.user,
    }));
    await task.save();

    await recordAudit(req.user, 'Work Queue Buddy: Manual Override', `${task.taskTitle}: ${current.name} → ${target.name}`, req, {
      meta: { taskId: String(task._id), from: String(current.userId), to: String(target.userId) },
    });
    if (moved) {
      await notifyUsers({
        toUserIds: [String(target.userId)],
        type: INBOX_TYPES.WORK_QUEUE_BUDDY_ASSIGNED,
        title: `You have been assigned "${task.taskTitle}"`,
        body: reason,
        entity: 'delegation',
        entityId: String(task._id),
      });
    }

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/delegation/:id/verify
 * One-click Verify & Complete action.
 */
export async function verifyAndComplete(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'sees');
    if (!loaded) return;
    const { task, rel } = loaded;

    // Same door as `updateDelegation`'s status→Completed path: a mirrored
    // task's one-click "Verify & Complete" has to run the real stage
    // completion, or clicking it would tell the assignee they are done while
    // Order Tracker still shows the stage open.
    if (task.sourceType === 'o2d_stage') {
      await completeMirroredTask(task, {
        actor: req.user,
        remarks: req.body.notes ?? null,
        req,
      });
      const refreshed = await Delegation.findById(task._id);
      return res.json({ success: true, data: refreshed });
    }

    if (!rel.owner) {
      return res.status(403).json({ success: false, message: 'Only the person who assigned this task (or a manager) can verify it.' });
    }
    // Nobody signs off their own work — unless they also set it themselves.
    if (rel.doer && !rel.assigner && task.verificationRequired) {
      return res.status(403).json({ success: false, message: 'You cannot verify a task assigned to you.' });
    }
    if (task.status === 'Completed') {
      return res.status(400).json({ success: false, message: 'Task already completed.' });
    }
    if (task.evidenceRequired && !hasEvidence(task)) {
      return res.status(400).json({
        success: false,
        message: 'This task requires evidence, and none has been submitted yet.',
        code: 'EVIDENCE_REQUIRED',
      });
    }

    // Keeps the doer's own `completedAt` from their submission, so verifying a
    // day later does not make on-time work look late (or the reverse).
    applyStatus(task, 'Completed', req.user);

    if (req.body.notes) {
      task.remarks.push({
        text: `Verified & Completed: ${req.body.notes}`,
        by: req.user._id,
        byName: req.user.user || req.user.email,
        createdAt: new Date(),
      });
    }

    await task.save();

    logActivity({
      type: 'status_change',
      title: 'Task Status Updated: Completed',
      description: req.body.notes || 'Task marked as verified and completed',
      userId: req.user._id,
      relatedId: task._id,
      metadata: { newStatus: 'Completed' },
    });

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/delegation/:id/subtasks
 * Add subtask.
 */
export async function addSubtask(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'participant');
    if (!loaded) return;
    const { task } = loaded;

    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: 'Subtask title is required' });
    }

    task.subtasks.push({ title, completed: false });
    await task.save();

    logActivity({
      type: 'subtask_created',
      title: 'Subtask Created',
      description: title,
      userId: req.user._id,
      relatedId: task._id,
    });

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/delegation/:id/subtasks/:subtaskId/toggle
 * Toggle subtask completed status.
 */
export async function toggleSubtask(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'participant');
    if (!loaded) return;
    const { task } = loaded;

    const sub = task.subtasks.id(req.params.subtaskId);
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Subtask not found' });
    }

    sub.completed = req.body.completed !== undefined ? req.body.completed : !sub.completed;
    sub.completedAt = sub.completed ? new Date() : null;

    await task.save();
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/delegation/:id/remarks
 * Threaded remark / activity.
 */
export async function addRemark(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'sees');
    if (!loaded) return;
    const { task } = loaded;

    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, message: 'Remark text is required' });
    }

    task.remarks.push({
      text,
      by: req.user._id,
      byName: req.user.user || req.user.email,
      createdAt: new Date(),
    });

    await task.save();

    logActivity({
      type: 'remark',
      title: 'Remark Added',
      description: text,
      userId: req.user._id,
      relatedId: task._id,
    });

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/delegation/:id/revise-date
 * Revise due date with audit reason.
 */
export async function reviseDueDate(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'owner');
    if (!loaded) return;
    const { task } = loaded;

    // A mirror's deadline is the O2D stage's, kept in step by the stage itself.
    if (task.sourceType === 'o2d_stage') {
      return res.status(400).json({
        success: false,
        message: 'This task is linked to an O2D stage — its deadline belongs to the order.',
        code: 'O2D_MIRROR_READ_ONLY',
      });
    }
    // Moving the deadline of finished work only rewrites whether it was late.
    if (task.status === 'Completed') {
      return res.status(400).json({ success: false, message: 'A completed task\'s due date cannot be revised.' });
    }

    const { newDate, reason } = req.body;
    if (!newDate || !reason) {
      return res.status(400).json({
        success: false,
        message: 'New date and justification reason are required.',
      });
    }

    task.dateRevisions.push({
      oldDate: task.dueDate,
      newDate: new Date(newDate),
      reason,
      revisedBy: req.user._id,
      revisedByName: req.user.user || req.user.email,
      createdAt: new Date(),
    });

    task.dueDate = new Date(newDate);
    await task.save();

    logActivity({
      type: 'date_revision',
      title: 'Due Date Revised',
      description: reason,
      userId: req.user._id,
      relatedId: task._id,
    });

    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/delegation/:id/reminders
 * Add a reminder.
 */
export async function addReminder(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'participant');
    if (!loaded) return;
    const { task } = loaded;

    const { date, note } = req.body;
    task.reminders.push({
      date: new Date(date),
      note: note || '',
      createdAt: new Date(),
    });

    await task.save();
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/delegation/:id/follow-ups
 * Log a follow up.
 */
export async function addFollowUp(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'participant');
    if (!loaded) return;
    const { task } = loaded;

    const { notes, contactedVia } = req.body;
    task.followUps.push({
      notes,
      contactedVia: contactedVia || 'Call',
      recordedBy: req.user._id,
      recordedByName: req.user.user || req.user.email,
      date: new Date(),
    });

    await task.save();
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/delegation/meta/categories
 */
export async function getCategories(req, res, next) {
  try {
    const categories = await Delegation.distinct('category');
    const defaults = ['Operations', 'Finance', 'Logistics', 'Compliance', 'HR', 'IT', 'Marketing', 'Sales'];
    const merged = Array.from(new Set([...defaults, ...categories.filter(Boolean)]));
    res.json({ success: true, data: merged });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/delegation/meta/users
 */
export async function getUsers(req, res, next) {
  try {
    const users = await User.find({
      status: 'Active',
      role: { $nin: ['Customer', 'MSIL', 'customer', 'msil'] },
    })
      .select('user email role')
      .sort({ user: 1 })
      .lean();

    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

// Seed sample deleted tasks for demo/audit testing if none exist
async function seedInitialDeletedDelegations(currentUserId, currentUserName) {
  const deletedCount = await Delegation.countDocuments({ isDeleted: true });
  if (deletedCount > 0) return;

  const users = await User.find({ status: 'Active' }).limit(5).lean();
  const doer1 = users[0] || { _id: currentUserId, user: 'Rahul Sharma' };
  const doer2 = users[1] || { _id: currentUserId, user: 'Priya Sharma' };
  const doer3 = users[2] || { _id: currentUserId, user: 'Amit Kumar' };

  const sampleDeleted = [
    // {
    //   taskTitle: 'HVAC Duct Pressure Test - Tower B',
    //   description: 'Perform static pressure boundary leak testing along risers 4 through 7 on Tower B mechanical floor.',
    //   assignerId: currentUserId,
    //   assignerName: 'Amit Kumar',
    //   doerId: doer1._id,
    //   doerFirstName: 'Rahul',
    //   doerLastName: 'Sharma',
    //   assigneeHierarchy: 'Rahul Sharma → MEP Lead',
    //   status: 'In Progress',
    //   priority: 'High',
    //   category: 'MEP',
    //   categoryColor: '#ef4444',
    //   tags: [{ name: 'Safety', color: '#dc2626' }, { name: 'MEP', color: '#3b82f6' }],
    //   startDate: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    //   dueDate: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000),
    //   isDeleted: true,
    //   deletedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    //   deletedBy: currentUserId,
    //   deletedByFirstName: 'Admin',
    //   deletedByLastName: 'User',
    // },
    // {
    //   taskTitle: 'Procurement PO Approval for Substation Switchgear',
    //   description: 'Review quote variances with vendor engineering team and clear high-priority payment approval milestone.',
    //   assignerId: currentUserId,
    //   assignerName: 'Priya Sharma',
    //   doerId: doer2._id,
    //   doerFirstName: 'Priya',
    //   doerLastName: 'Sharma',
    //   assigneeHierarchy: 'Priya Sharma → Electrical Head',
    //   status: 'Pending',
    //   priority: 'Urgent',
    //   category: 'Procurement',
    //   categoryColor: '#f97316',
    //   tags: [{ name: 'PO', color: '#f59e0b' }, { name: 'Urgent', color: '#ef4444' }],
    //   startDate: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
    //   dueDate: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // Overdue
    //   isDeleted: true,
    //   deletedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    //   deletedBy: currentUserId,
    //   deletedByFirstName: 'Admin',
    //   deletedByLastName: 'User',
    // },
    // {
    //   taskTitle: 'Basement Water Retention Wall Waterproofing Audit',
    //   description: 'Physical inspection of membrane barrier curing and sign-off on third-party QA certificate.',
    //   assignerId: currentUserId,
    //   assignerName: 'Amit Kumar',
    //   doerId: doer3._id,
    //   doerFirstName: 'Amit',
    //   doerLastName: 'Kumar',
    //   assigneeHierarchy: 'Amit Kumar → Site Supervisor',
    //   status: 'Completed',
    //   priority: 'Medium',
    //   category: 'Civil',
    //   categoryColor: '#10b981',
    //   tags: [{ name: 'Civil', color: '#10b981' }, { name: 'QA', color: '#6366f1' }],
    //   startDate: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
    //   dueDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    //   completedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    //   isDeleted: true,
    //   deletedAt: new Date(now.getTime() - 36 * 60 * 60 * 1000),
    //   deletedBy: currentUserId,
    //   deletedByFirstName: 'Admin',
    //   deletedByLastName: 'User',
    // }
  ];
  await Delegation.insertMany(sampleDeleted);
}

/**
 * GET /api/v1/delegation/deleted
 * Get soft-deleted tasks for admin trash bin.
 */
export async function getDeletedDelegations(req, res, next) {
  try {
    const currentUserId = req.user._id;
    const currentUserName = req.user.user || req.user.email;

    await seedInitialDeletedDelegations(currentUserId, currentUserName);

    const {
      search,
      status,
      priority,
      category,
      assignedBy,
      tagFilter,
      dateRange,
      customStartDate,
      customEndDate,
      sortBy = 'deletedAt',
      sortOrder = 'desc',
    } = req.query;

    const filter = { isDeleted: true };
    const conditions = [];
    // Declared before the status filter, which reads it for "Overdue".
    const now = new Date();

    // Search
    if (search) {
      const regex = searchRegex(search);
      conditions.push({
        $or: [
          { taskTitle: regex },
          { description: regex },
          { doerFirstName: regex },
          { doerLastName: regex },
          { assignerName: regex },
        ],
      });
    }

    // Status filter
    if (status && status !== 'All') {
      if (status === 'OverDue' || status === 'Overdue') {
        conditions.push({
          dueDate: { $lt: startOfDay(now) },
          status: { $nin: ['Completed', 'Awaiting Verification', DELEGATION_REASSIGNED_AWAY] },
        });
      } else {
        conditions.push({ status });
      }
    }

    // Priority filter
    if (priority && priority !== 'All') {
      conditions.push({ priority });
    }

    // Category filter
    if (category && category !== 'All') {
      conditions.push({ category });
    }

    // Assigned By filter
    if (assignedBy && assignedBy !== 'All') {
      conditions.push({
        $or: [
          // A name is not an ObjectId; casting one threw a 500.
          ...(mongoose.isValidObjectId(assignedBy) ? [{ assignerId: assignedBy }] : []),
          { assignerName: searchRegex(assignedBy) },
        ],
      });
    }

    // Tag filter
    if (tagFilter && tagFilter !== 'All') {
      conditions.push({ 'tags.name': tagFilter });
    }

    // Date range filter against deletedAt || createdAt
    if (dateRange === 'Today') {
      conditions.push({
        $or: [
          { deletedAt: { $gte: startOfDay(now), $lte: endOfDay(now) } },
          { deletedAt: null, createdAt: { $gte: startOfDay(now), $lte: endOfDay(now) } },
        ]
      });
    } else if (dateRange === 'Yesterday') {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      conditions.push({
        $or: [
          { deletedAt: { $gte: startOfDay(y), $lte: endOfDay(y) } },
          { deletedAt: null, createdAt: { $gte: startOfDay(y), $lte: endOfDay(y) } },
        ]
      });
    } else if (dateRange === 'This Week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(new Date().setDate(diff));
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      conditions.push({
        $or: [
          { deletedAt: { $gte: startOfDay(monday), $lte: endOfDay(sunday) } },
          { deletedAt: null, createdAt: { $gte: startOfDay(monday), $lte: endOfDay(sunday) } },
        ]
      });
    } else if (dateRange === 'Next Week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1) + 7;
      const monday = new Date(new Date().setDate(diff));
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      conditions.push({
        $or: [
          { deletedAt: { $gte: startOfDay(monday), $lte: endOfDay(sunday) } },
          { deletedAt: null, createdAt: { $gte: startOfDay(monday), $lte: endOfDay(sunday) } },
        ]
      });
    } else if (dateRange === 'This Month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      conditions.push({
        $or: [
          { deletedAt: { $gte: startOfDay(firstDay), $lte: endOfDay(lastDay) } },
          { deletedAt: null, createdAt: { $gte: startOfDay(firstDay), $lte: endOfDay(lastDay) } },
        ]
      });
    } else if (dateRange === 'Next Month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      conditions.push({
        $or: [
          { deletedAt: { $gte: startOfDay(firstDay), $lte: endOfDay(lastDay) } },
          { deletedAt: null, createdAt: { $gte: startOfDay(firstDay), $lte: endOfDay(lastDay) } },
        ]
      });
    } else if (dateRange === 'Custom' && customStartDate && customEndDate) {
      conditions.push({
        $or: [
          { deletedAt: { $gte: startOfDay(customStartDate), $lte: endOfDay(customEndDate) } },
          { deletedAt: null, createdAt: { $gte: startOfDay(customStartDate), $lte: endOfDay(customEndDate) } },
        ]
      });
    }

    if (conditions.length > 0) {
      filter.$and = conditions;
    }

    const sortFieldMap = {
      'Deleted At': 'deletedAt',
      'deletedAt': 'deletedAt',
      'Due Date': 'dueDate',
      'dueDate': 'dueDate',
      'Created At': 'createdAt',
      'createdAt': 'createdAt',
      'Title': 'taskTitle',
      'title': 'taskTitle',
    };
    const sortKey = sortFieldMap[sortBy] || 'deletedAt';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    const tasks = await Delegation.find(filter)
      .sort({ [sortKey]: sortDirection })
      .lean();

    res.json({ success: true, data: tasks });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH or POST /api/v1/delegation/:id/restore
 * Restore soft-deleted task to active workflow.
 */
export async function restoreDelegation(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'owner', { includeDeleted: true });
    if (!loaded) return;
    const { task } = loaded;

    task.isDeleted = false;
    task.deletedAt = null;
    task.deletedBy = null;
    task.deletedByFirstName = '';
    task.deletedByLastName = '';

    await task.save();

    logActivity({
      type: 'restored',
      title: 'Task Restored',
      description: 'Task restored from trash bin',
      userId: req.user._id,
      relatedId: task._id,
    });

    res.json({ success: true, message: 'Task restored successfully', data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/delegation/:id
 * Soft-delete a task and move to trash bin.
 */
export async function deleteDelegation(req, res, next) {
  try {
    const loaded = await loadTaskFor(req, res, 'owner');
    if (!loaded) return;
    const { task } = loaded;

    /**
     * A mirrored task cannot be deleted from here.
     *
     * Deleting the mirror would not touch the real O2D stage at all — it would
     * still be sitting there, assigned, waiting — so the assignee would simply
     * lose their only visible reminder of work Order Tracker still expects.
     * Unassigning it on Order Tracker closes it out properly on both sides.
     */
    if (task.sourceType === 'o2d_stage') {
      return res.status(400).json({
        success: false,
        message: 'This task is linked to an O2D stage. Unassign the stage from Order Tracker instead of deleting it here.',
        code: 'O2D_MIRROR_NOT_DELETABLE',
      });
    }

    const userName = req.user.user || req.user.name || 'Admin';
    const nameParts = userName.trim().split(' ');

    task.isDeleted = true;
    task.deletedAt = new Date();
    task.deletedBy = req.user._id;
    task.deletedByFirstName = nameParts[0] || 'Admin';
    task.deletedByLastName = nameParts.slice(1).join(' ') || '';

    await task.save();

    logActivity({
      type: 'deleted',
      title: 'Task Deleted',
      description: 'Task moved to trash bin',
      userId: req.user._id,
      relatedId: task._id,
    });

    res.json({ success: true, message: 'Task deleted successfully', data: task });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/delegation/bulk-status
 * Bulk update status for multiple delegated tasks.
 */
export async function bulkUpdateStatus(req, res, next) {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !status) {
      return res.status(400).json({ success: false, message: 'Task IDs array and status are required' });
    }

    if (!SETTABLE_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status: ${status}` });
    }

    const validIds = ids.filter((id) => mongoose.isValidObjectId(id));

    /**
     * Bulk status is a direct write — it does not go through `updateDelegation`
     * — so it has to exclude mirrored tasks itself. A bulk "Completed" over a
     * mixed selection would otherwise flip an O2D-linked task's status without
     * ever running the real stage completion, exactly the lying-UI state the
     * single-task path exists to prevent. Manual tasks in the selection still
     * update normally; mirrored ones are skipped and reported, so a bulk action
     * against a filtered list never fails silently for part of it.
     *
     * And only the caller's OWN tasks — the ones they assigned, or any for a
     * manager — the same rule `loadTaskFor` applies one task at a time.
     */
    const live = { _id: { $in: validIds }, isDeleted: false };
    const skipped = await Delegation.countDocuments({ ...live, sourceType: 'o2d_stage' });
    const candidates = await Delegation.find({ ...live, sourceType: { $ne: 'o2d_stage' } })
      .select('_id assignerId status completedAt evidenceRequired evidenceUrl evidenceNotes')
      .lean();
    const owned = candidates.filter((t) => relationTo(t, req.user).owner);
    const notPermitted = candidates.length - owned.length;

    // Nothing to do for a task already in that status, and an evidence-gated
    // task cannot be closed out in bulk without its evidence.
    const needsEvidence = ['Awaiting Verification', 'Completed'].includes(status);
    const changing = owned.filter((t) => t.status !== status);
    const missingEvidence = needsEvidence ? changing.filter((t) => t.evidenceRequired && !hasEvidence(t)) : [];
    const toUpdate = changing.filter((t) => !missingEvidence.includes(t));

    const now = new Date();
    const ops = toUpdate.map((t) => {
      const doc = { ...t };
      applyStatus(doc, status, req.user, now);
      return {
        updateOne: {
          filter: { _id: t._id },
          update: { $set: { status, completedAt: doc.completedAt, verifiedAt: doc.verifiedAt, verifiedBy: doc.verifiedBy } },
        },
      };
    });
    const result = ops.length ? await Delegation.bulkWrite(ops) : { modifiedCount: 0 };

    // Logged for the tasks that actually changed, not for every id submitted.
    for (const t of toUpdate) {
      logActivity({
        type: 'status_change',
        title: 'Status Updated',
        description: `Status changed to ${status} via bulk update`,
        userId: req.user._id,
        relatedId: t._id,
      }).catch(() => {});
    }

    const notes = [
      skipped ? `${skipped} linked to O2D stage(s) were skipped — complete those from Order Tracker or their own task card.` : null,
      notPermitted ? `${notPermitted} you did not assign were skipped.` : null,
      missingEvidence.length ? `${missingEvidence.length} still need their evidence and were skipped.` : null,
    ].filter(Boolean);

    res.json({
      success: true,
      message: `Updated status for ${result.modifiedCount} task(s)${notes.length ? `. ${notes.join(' ')}` : ''}`,
      modifiedCount: result.modifiedCount,
      skipped,
      notPermitted,
      missingEvidence: missingEvidence.length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/delegation/bulk-delete
 * Bulk soft-delete multiple delegated tasks.
 */
export async function bulkDeleteDelegations(req, res, next) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Task IDs array is required' });
    }

    const userName = req.user.user || req.user.name || 'Admin';
    const nameParts = userName.trim().split(' ');
    const validIds = ids.filter((id) => mongoose.isValidObjectId(id));

    // Same exclusion as bulk-status, and for the same reason: deleting a
    // mirror here leaves the real O2D stage untouched, still assigned, still
    // waiting — see the single-task guard in `deleteDelegation`. Already
    // binned rows are left alone so their original deletion is kept.
    const live = { _id: { $in: validIds }, isDeleted: false };
    const skipped = await Delegation.countDocuments({ ...live, sourceType: 'o2d_stage' });
    const candidates = await Delegation.find({ ...live, sourceType: { $ne: 'o2d_stage' } })
      .select('_id assignerId')
      .lean();
    const ownedIds = candidates.filter((t) => relationTo(t, req.user).owner).map((t) => t._id);
    const notPermitted = candidates.length - ownedIds.length;

    const result = ownedIds.length
      ? await Delegation.updateMany(
        { _id: { $in: ownedIds }, isDeleted: false },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: req.user._id,
            deletedByFirstName: nameParts[0] || 'Admin',
            deletedByLastName: nameParts.slice(1).join(' ') || '',
          },
        },
      )
      : { modifiedCount: 0 };

    for (const id of ownedIds) {
      logActivity({
        type: 'deleted',
        title: 'Task Deleted',
        description: 'Task moved to trash bin via bulk delete',
        userId: req.user._id,
        relatedId: id,
      }).catch(() => {});
    }

    res.json({
      success: true,
      skipped,
      notPermitted,
      message: `Deleted ${result.modifiedCount} task(s)${notPermitted ? `. ${notPermitted} you did not assign were skipped.` : ''}`,
      deletedCount: result.modifiedCount,
    });
  } catch (err) {
    next(err);
  }
}
