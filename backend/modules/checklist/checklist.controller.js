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

import { ChecklistRoutine, ChecklistOccurrence } from '../../models/Checklist.js';
import User from '../../models/User.js';
import { isSuperAdmin } from '../../middlewares/rbac.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['Super Admin', 'Admin', 'Management', 'HR'];

const isManager = (user) =>
  isSuperAdmin(user) || ADMIN_ROLES.includes(user?.role);

const startOfDay = (d) => {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
};

const endOfDay = (d) => {
  const dt = new Date(d);
  dt.setHours(23, 59, 59, 999);
  return dt;
};

/**
 * Generate all planned dates between start and end for a given frequency.
 */
function generateDates(startDate, endDate, frequency) {
  const dates = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    dates.push(new Date(current));
    switch (frequency) {
      case 'daily':       current.setDate(current.getDate() + 1); break;
      case 'weekly':      current.setDate(current.getDate() + 7); break;
      case 'fortnightly': current.setDate(current.getDate() + 14); break;
      case 'monthly':     current.setMonth(current.getMonth() + 1); break;
      case 'quarterly':   current.setMonth(current.getMonth() + 3); break;
      case 'yearly':      current.setFullYear(current.getFullYear() + 1); break;
      default:            current.setDate(current.getDate() + 1);
    }
  }
  return dates;
}

/**
 * Build the base filter for occurrence queries.
 * Enriches pending tasks whose plannedDate is past as 'overdue'.
 */
function buildOccurrenceFilter(query, user) {
  const filter = {};

  if (query.site) filter.site = query.site;
  if (query.department) filter.department = query.department;
  if (query.frequency) filter.frequency = query.frequency;

  // Search
  if (query.search) {
    const re = new RegExp(query.search, 'i');
    filter.$or = [{ taskName: re }, { taskCode: re }];
  }

  // Doer filter (admin only — regular users always see only their own)
  if (!isManager(user)) {
    filter.doer = user._id;
  } else if (query.doer) {
    filter.doer = query.doer;
  }

  // Status
  const now = new Date();
  if (query.status === 'overdue') {
    filter.status = 'pending';
    filter.plannedDate = { $lt: startOfDay(now) };
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

  return filter;
}

/**
 * Enrich tasks: mark pending tasks with past plannedDate as 'overdue' in the
 * response (computed, not stored).
 */
function enrichStatus(task) {
  const now = new Date();
  if (task.status === 'pending' && new Date(task.plannedDate) < startOfDay(now)) {
    return { ...task, status: 'overdue' };
  }
  return task;
}


// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * GET /checklist/tasks
 * Paginated, filtered task list.
 */
export async function getTasks(req, res, next) {
  try {
    const filter = buildOccurrenceFilter(req.query, req.user);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const skip = (page - 1) * limit;

    const [tasks, total] = await Promise.all([
      ChecklistOccurrence.find(filter)
        .sort({ plannedDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ChecklistOccurrence.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        tasks: tasks.map(enrichStatus),
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
    const baseFilter = {};
    if (req.query.site) baseFilter.site = req.query.site;
    if (!isManager(req.user)) baseFilter.doer = req.user._id;

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const [total, pendingToday, overdue, completed, pendingCarriedOver] = await Promise.all([
      ChecklistOccurrence.countDocuments(baseFilter),
      ChecklistOccurrence.countDocuments({ ...baseFilter, status: 'pending', plannedDate: { $gte: todayStart, $lte: todayEnd } }),
      ChecklistOccurrence.countDocuments({ ...baseFilter, status: 'pending', plannedDate: { $lt: todayStart } }),
      ChecklistOccurrence.countDocuments({ ...baseFilter, status: 'completed' }),
      ChecklistOccurrence.countDocuments({ ...baseFilter, status: 'pending', plannedDate: { $lt: todayStart } }),
    ]);

    const complianceRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    res.json({
      success: true,
      data: {
        total,
        pendingToday,
        overdue,
        completed,
        complianceRate,
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
    const filter = {};
    if (req.query.site) filter.site = req.query.site;
    if (req.query.search) {
      const re = new RegExp(req.query.search, 'i');
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
    const matchFilter = {};
    if (req.query.site) matchFilter.site = req.query.site;

    const now = new Date();
    const todayStart = startOfDay(now);

    const pipeline = [
      { $match: matchFilter },
      {
        $addFields: {
          computedStatus: {
            $cond: [
              { $and: [{ $eq: ['$status', 'pending'] }, { $lt: ['$plannedDate', todayStart] }] },
              'overdue',
              '$status',
            ],
          },
        },
      },
      {
        $group: {
          _id: { department: '$department', doer: '$doer', doerFirstName: '$doerFirstName', doerLastName: '$doerLastName' },
          total: { $sum: 1 },
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

/**
 * POST /checklist/routines
 * Create a routine and generate all occurrences.
 */
export async function createRoutine(req, res, next) {
  try {
    const { taskName, taskCode, frequency, doer, department, site, startDate, endDate, proofRequired } = req.body;

    // Look up the doer's name
    const doerUser = await User.findById(doer).select('user email').lean();
    const nameParts = (doerUser?.user || doerUser?.email || '').split(' ');
    const doerFirstName = nameParts[0] || '';
    const doerLastName = nameParts.slice(1).join(' ') || '';

    const routine = await ChecklistRoutine.create({
      taskName,
      taskCode,
      frequency,
      doer,
      doerFirstName,
      doerLastName,
      department: department || '',
      site: site || 'HO',
      startDate,
      endDate,
      proofRequired: proofRequired || false,
      createdBy: req.user._id,
    });

    // Generate occurrences
    const dates = generateDates(startDate, endDate, frequency);
    const occurrences = dates.map((plannedDate) => ({
      routine: routine._id,
      taskName,
      taskCode,
      doer,
      doerFirstName,
      doerLastName,
      department: department || '',
      site: site || 'HO',
      frequency,
      plannedDate,
      proofRequired: proofRequired || false,
      createdBy: req.user._id,
    }));

    if (occurrences.length > 0) {
      await ChecklistOccurrence.insertMany(occurrences);
    }

    res.status(201).json({
      success: true,
      data: { routine, occurrencesCreated: occurrences.length },
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
    const routine = await ChecklistRoutine.findById(req.params.id);
    if (!routine) return res.status(404).json({ success: false, message: 'Routine not found.' });

    const allowed = ['taskName', 'frequency', 'doer', 'department', 'site', 'startDate', 'endDate', 'proofRequired'];
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) routine[key] = req.body[key];
    });

    // Re-resolve doer name if doer changed
    if (req.body.doer) {
      const doerUser = await User.findById(req.body.doer).select('user email').lean();
      const nameParts = (doerUser?.user || doerUser?.email || '').split(' ');
      routine.doerFirstName = nameParts[0] || '';
      routine.doerLastName = nameParts.slice(1).join(' ') || '';
    }

    await routine.save();
    res.json({ success: true, data: routine });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /checklist/routines/:id/stop
 * Deactivate a routine.
 */
export async function stopRoutine(req, res, next) {
  try {
    const routine = await ChecklistRoutine.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true },
    );
    if (!routine) return res.status(404).json({ success: false, message: 'Routine not found.' });
    res.json({ success: true, data: routine });
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
    if (task.status === 'completed') return res.status(400).json({ success: false, message: 'Task already completed.' });

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
    const task = await ChecklistOccurrence.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

    const newDoer = await User.findById(req.body.newDoer).select('user email').lean();
    if (!newDoer) return res.status(400).json({ success: false, message: 'New doer not found.' });

    const nameParts = (newDoer.user || newDoer.email || '').split(' ');
    task.doer = newDoer._id;
    task.doerFirstName = nameParts[0] || '';
    task.doerLastName = nameParts.slice(1).join(' ') || '';
    task.reassigned = true;
    task.reassignedTo = newDoer._id;
    task.reassignedBy = req.user._id;
    await task.save();

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
    if (!taskIds?.length || !text) {
      return res.status(400).json({ success: false, message: 'taskIds and text are required.' });
    }

    const remark = {
      text,
      by: req.user._id,
      byName: req.user.user || req.user.email || 'Unknown',
      createdAt: new Date(),
    };

    await ChecklistOccurrence.updateMany(
      { _id: { $in: taskIds } },
      { $push: { remarks: remark } },
    );

    res.json({ success: true, data: { updated: taskIds.length } });
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
    const filter = {};
    if (site) filter.site = site;
    if (!isManager(req.user)) filter.doer = req.user._id;

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
        filter.status = 'pending';
        filter.plannedDate = { $lt: todayStart };
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
