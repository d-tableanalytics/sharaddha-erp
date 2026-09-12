import { Delegation } from '../../models/Delegation.js';
import User from '../../models/User.js';
import { isSuperAdmin } from '../../middlewares/rbac.js';

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

// Seed sample delegations if the collection is empty
async function seedInitialDelegations(currentUserId, currentUserName) {
  const count = await Delegation.countDocuments();
  if (count > 0) return;

  const users = await User.find({ status: 'Active' }).limit(5).lean();
  const doer1 = users[0] || { _id: currentUserId, user: 'Amit Kumar' };
  const doer2 = users[1] || { _id: currentUserId, user: 'Rahul Verma' };
  const doer3 = users[2] || { _id: currentUserId, user: 'Priya Sharma' };

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const pastThreeDays = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const sampleTasks = [
    {
      taskTitle: 'Quarterly Tax Filing Audit & Reconciliation',
      description: '<p>Please reconcile the Q4 invoices against GST portal filings. Check for mismatch in ITC claimed versus GSTR-2B before final tax ledger credit.</p>',
      assignerId: currentUserId,
      assignerName: currentUserName || 'Operations Lead',
      doerId: doer1._id,
      doerFirstName: (doer1.user || 'Amit').split(' ')[0],
      doerLastName: (doer1.user || 'Amit Kumar').split(' ')[1] || 'Kumar',
      assigneeHierarchy: `${doer1.user || 'Amit Kumar'} → Head Ops`,
      status: 'Awaiting Verification',
      priority: 'Urgent',
      category: 'Finance',
      categoryColor: '#0284c7',
      tags: [
        { name: 'Tax', color: '#0284c7' },
        { name: 'Audit', color: '#dc2626' },
        { name: 'Compliance', color: '#16a34a' },
      ],
      startDate: yesterday,
      dueDate: tomorrow,
      recurrence: 'Weekly',
      verificationRequired: true,
      evidenceRequired: true,
      evidenceUrl: 'https://gst.gov.in/reconciliation-q4.pdf',
      evidenceNotes: 'Reconciliation spreadsheet uploaded with GSTR-2B cross check.',
      subtasks: [
        { title: 'Download GSTR-2B summary', completed: true, completedAt: yesterday },
        { title: 'Match sales invoice register', completed: true, completedAt: now },
        { title: 'Flag variance above ₹500', completed: true, completedAt: now },
      ],
      remarks: [
        { text: 'Completed the reconciliation and uploaded the summary sheet. Awaiting signoff.', by: doer1._id, byName: doer1.user || 'Amit Kumar', createdAt: now },
      ],
    },
    {
      taskTitle: 'Biometric Attendance Device Sync Verification',
      description: '<p>Ensure HO and Plant biometric logs are synchronized with the attendance module without time drift.</p>',
      assignerId: currentUserId,
      assignerName: currentUserName || 'Operations Lead',
      doerId: doer2._id,
      doerFirstName: (doer2.user || 'Rahul').split(' ')[0],
      doerLastName: (doer2.user || 'Rahul Verma').split(' ')[1] || 'Verma',
      assigneeHierarchy: `${doer2.user || 'Rahul Verma'} → IT Support`,
      status: 'In Progress',
      priority: 'High',
      category: 'Operations',
      categoryColor: '#ea580c',
      tags: [
        { name: 'IT', color: '#7c3aed' },
        { name: 'Attendance', color: '#ea580c' },
      ],
      startDate: now,
      dueDate: nextWeek,
      recurrence: 'Daily',
      verificationRequired: true,
      subtasks: [
        { title: 'Ping check all 4 terminal IPs', completed: true, completedAt: now },
        { title: 'Verify webhook receiver logs', completed: false },
        { title: 'Confirm push synchronization', completed: false },
      ],
      remarks: [],
    },
    {
      taskTitle: 'Vendor Contract Annual Renewal - Transport & Logistics',
      description: '<p>Review rates per MT with primary fleet operators and finalize service level agreements for the next fiscal year.</p>',
      assignerId: currentUserId,
      assignerName: currentUserName || 'Operations Lead',
      doerId: doer3._id,
      doerFirstName: (doer3.user || 'Priya').split(' ')[0],
      doerLastName: (doer3.user || 'Priya Sharma').split(' ')[1] || 'Sharma',
      assigneeHierarchy: `${doer3.user || 'Priya Sharma'} → Logistics Manager`,
      status: 'Pending',
      priority: 'Medium',
      category: 'Logistics',
      categoryColor: '#d97706',
      tags: [
        { name: 'Vendor', color: '#059669' },
        { name: 'Contracts', color: '#2563eb' },
      ],
      startDate: now,
      dueDate: nextWeek,
      recurrence: 'none',
      verificationRequired: false,
      subtasks: [
        { title: 'Obtain rate quotations', completed: false },
        { title: 'Compare historical freight charges', completed: false },
      ],
      remarks: [],
    },
    {
      taskTitle: 'Safety Equipment Audit & Fire Extinguisher Refill',
      description: '<p>Audit all floor safety stations, test alarm sirens, and verify inspection stickers on fire extinguishers.</p>',
      assignerId: currentUserId,
      assignerName: currentUserName || 'Operations Lead',
      doerId: doer1._id,
      doerFirstName: (doer1.user || 'Amit').split(' ')[0],
      doerLastName: (doer1.user || 'Amit Kumar').split(' ')[1] || 'Kumar',
      assigneeHierarchy: `${doer1.user || 'Amit Kumar'} → Head Ops`,
      status: 'Pending',
      priority: 'Urgent',
      category: 'Operations',
      categoryColor: '#ea580c',
      tags: [
        { name: 'Safety', color: '#dc2626' },
        { name: 'Plant', color: '#4b5563' },
      ],
      startDate: pastThreeDays,
      dueDate: yesterday, // Overdue!
      recurrence: 'Monthly',
      verificationRequired: true,
      subtasks: [
        { title: 'Floor walkthrough with safety officer', completed: true, completedAt: pastThreeDays },
        { title: 'Compile refill vendor order list', completed: false },
      ],
      remarks: [
        { text: 'Waiting for vendor quote response since yesterday.', by: doer1._id, byName: doer1.user || 'Amit Kumar', createdAt: yesterday },
      ],
    },
    {
      taskTitle: 'Client Dispatch Documentation Sign-off (Order #4912)',
      description: '<p>Generate final packing list, inspect e-way bill accuracy, and obtain gate pass clearance from customs desk.</p>',
      assignerId: currentUserId,
      assignerName: currentUserName || 'Operations Lead',
      doerId: doer3._id,
      doerFirstName: (doer3.user || 'Priya').split(' ')[0],
      doerLastName: (doer3.user || 'Priya Sharma').split(' ')[1] || 'Sharma',
      assigneeHierarchy: `${doer3.user || 'Priya Sharma'} → Logistics Manager`,
      status: 'Completed',
      priority: 'Low',
      category: 'Dispatch',
      categoryColor: '#16a34a',
      tags: [
        { name: 'Client', color: '#16a34a' },
        { name: 'Dispatch', color: '#0891b2' },
      ],
      startDate: pastThreeDays,
      dueDate: yesterday,
      completedAt: yesterday,
      verifiedAt: now,
      verifiedBy: currentUserId,
      recurrence: 'none',
      subtasks: [
        { title: 'Prepare packing list', completed: true, completedAt: pastThreeDays },
        { title: 'Validate GST E-way bill', completed: true, completedAt: pastThreeDays },
        { title: 'Security gate stamping', completed: true, completedAt: yesterday },
      ],
      remarks: [],
    },
  ];

  await Delegation.insertMany(sampleTasks);
}

/**
 * GET /api/v1/delegation
 * List delegated tasks.
 */
export async function getDelegations(req, res, next) {
  try {
    const currentUserId = req.user._id;
    const currentUserName = req.user.user || req.user.email;

    // Seed if empty
    await seedInitialDelegations(currentUserId, currentUserName);

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

    const filter = {};

    const conditions = [];

    // My Work perspective (doer or in loop) vs Delegator perspective (assigner)
    if (req.query.myWork === 'true' || req.query.scope === 'myWork') {
      conditions.push({
        $or: [
          { doerId: currentUserId },
          { 'inLoop.userId': currentUserId },
        ],
      });
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

    // Status filter
    if (status) {
      if (status === 'Overdue') {
        filter.dueDate = { $lt: new Date() };
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
    const now = new Date();
    if (dateRange === 'Today') {
      filter.dueDate = { $gte: startOfDay(now), $lte: endOfDay(now) };
    } else if (dateRange === 'Yesterday') {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      filter.dueDate = { $gte: startOfDay(y), $lte: endOfDay(y) };
    } else if (dateRange === 'This Week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now.setDate(diff));
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      filter.dueDate = { $gte: startOfDay(monday), $lte: endOfDay(sunday) };
    } else if (dateRange === 'This Month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
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
    const users = await User.find({ status: 'Active' })
      .select('user email role')
      .sort({ user: 1 })
      .lean();

    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}
