import { Delegation } from '../../models/Delegation.js';
import User from '../../models/User.js';
import { isSuperAdmin } from '../../middlewares/rbac.js';
import { logActivity } from '../activities/activity.controller.js';

const ADMIN_ROLES = ['Super Admin', 'Admin', 'Management', 'HR'];
const isManager = (user) => isSuperAdmin(user) || ADMIN_ROLES.includes(user?.role);

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
      const regex = new RegExp(search, 'i');
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
        filter.status = { $nin: ['Completed', 'Awaiting Verification'] };
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
    const task = await Delegation.findById(req.params.id).lean();
    if (!task) {
      return res.status(404).json({ success: false, message: 'Delegated task not found' });
    }
    res.json({ success: true, data: task });
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
    } = req.body;

    if (!taskTitle || !doerId || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Task title, doer assignee, and due date are required.',
      });
    }

    // Lookup doer details if not provided
    let finalDoerFirstName = doerFirstName;
    let finalDoerLastName = doerLastName;
    let finalHierarchy = assigneeHierarchy;

    if (!finalDoerFirstName || !finalHierarchy) {
      const doerUser = await User.findById(doerId).lean();
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
      doerId,
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
    const task = await Delegation.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Delegated task not found' });
    }

    const updates = req.body;
    // Status update handling
    if (updates.status && updates.status !== task.status) {
      task.status = updates.status;
      if (updates.status === 'Completed') {
        task.completedAt = task.completedAt || new Date();
        task.verifiedAt = new Date();
        task.verifiedBy = req.user._id;
      }
    }

    if (updates.taskTitle) task.taskTitle = updates.taskTitle;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.priority) task.priority = updates.priority;
    if (updates.category) task.category = updates.category;
    if (updates.categoryColor) task.categoryColor = updates.categoryColor;
    if (updates.tags) task.tags = updates.tags;
    if (updates.dueDate) task.dueDate = new Date(updates.dueDate);
    if (updates.recurrence) task.recurrence = updates.recurrence;
    if (updates.evidenceRequired !== undefined) task.evidenceRequired = updates.evidenceRequired;
    if (updates.verificationRequired !== undefined) task.verificationRequired = updates.verificationRequired;
    if (updates.evidenceUrl !== undefined) task.evidenceUrl = updates.evidenceUrl;
    if (updates.evidenceNotes !== undefined) task.evidenceNotes = updates.evidenceNotes;

    await task.save();
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
    const task = await Delegation.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Delegated task not found' });
    }

    task.status = 'Completed';
    task.completedAt = new Date();
    task.verifiedAt = new Date();
    task.verifiedBy = req.user._id;

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
    const task = await Delegation.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Delegated task not found' });
    }

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
    const task = await Delegation.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Delegated task not found' });
    }

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
    const task = await Delegation.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Delegated task not found' });
    }

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
    const task = await Delegation.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Delegated task not found' });
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
    const task = await Delegation.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Delegated task not found' });
    }

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
    const task = await Delegation.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Delegated task not found' });
    }

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

    // Search
    if (search) {
      const regex = new RegExp(search, 'i');
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
          status: { $nin: ['Completed', 'Awaiting Verification'] },
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
          { assignerId: assignedBy },
          { assignerName: new RegExp(assignedBy, 'i') },
        ],
      });
    }

    // Tag filter
    if (tagFilter && tagFilter !== 'All') {
      conditions.push({ 'tags.name': tagFilter });
    }

    // Date range filter against deletedAt || createdAt
    const now = new Date();
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
    const task = await Delegation.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

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
    const task = await Delegation.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
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

    const validStatuses = ['Pending', 'In Progress', 'Awaiting Verification', 'Completed', 'Need Revision'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status: ${status}` });
    }

    const updateFields = { status };
    if (status === 'Completed') {
      updateFields.completedAt = new Date();
      updateFields.verifiedAt = new Date();
      updateFields.verifiedBy = req.user._id;
    }

    const result = await Delegation.updateMany(
      { _id: { $in: ids }, isDeleted: false },
      { $set: updateFields }
    );

    // Asynchronously log activities for each task
    for (const id of ids) {
      logActivity({
        type: 'status_change',
        title: 'Status Updated',
        description: `Status changed to ${status} via bulk update`,
        userId: req.user._id,
        relatedId: id,
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: `Updated status for ${result.modifiedCount} task(s)`,
      modifiedCount: result.modifiedCount,
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

    const result = await Delegation.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: req.user._id,
          deletedByFirstName: nameParts[0] || 'Admin',
          deletedByLastName: nameParts.slice(1).join(' ') || '',
        },
      }
    );

    for (const id of ids) {
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
      message: `Deleted ${result.modifiedCount} task(s)`,
      deletedCount: result.modifiedCount,
    });
  } catch (err) {
    next(err);
  }
}

