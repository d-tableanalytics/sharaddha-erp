import mongoose from 'mongoose';
import Activity from '../../models/Activity.js';
import Delegation from '../../models/Delegation.js';
import User from '../../models/User.js';

/**
 * Strip HTML tags from rich text descriptions for clean preview
 */
function cleanText(html = '') {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '').trim();
}

/**
 * Split a full name into firstName and lastName
 */
function splitName(name = '') {
  const parts = String(name || '').trim().split(/\s+/);
  const firstName = parts[0] || 'Staff';
  const lastName = parts.slice(1).join(' ') || '';
  return { firstName, lastName };
}

/**
 * Helper to record an activity event asynchronously
 */
export async function logActivity({
  type,
  title,
  description,
  userId,
  relatedId = null,
  relatedType = 'task',
  metadata = {},
  createdAt = new Date(),
}) {
  try {
    if (!userId || !title) return;
    await Activity.create({
      type,
      title,
      description: cleanText(description),
      userId,
      relatedId,
      relatedType,
      metadata,
      createdAt,
    });
  } catch (err) {
    console.error('Failed to log activity event:', err.message);
  }
}

/**
 * Auto-synthesize historical activities from existing Delegations if Activity is empty
 */
async function syncHistoricalDelegationActivities() {
  const count = await Activity.countDocuments();
  if (count > 0) return;

  const tasks = await Delegation.find().lean();
  if (!tasks.length) return;

  const activitiesToInsert = [];

  for (const task of tasks) {
    const taskUid = `DEL-${String(task._id).slice(-4).toUpperCase()}`;

    // 1. Task Created
    if (task.assignerId) {
      activitiesToInsert.push({
        type: 'task_created',
        title: task.taskTitle,
        description: cleanText(task.description) || `Task delegated to ${task.doerFirstName || 'assignee'}`,
        userId: task.assignerId,
        relatedId: task._id,
        relatedType: 'task',
        metadata: { taskUid, category: task.category, priority: task.priority },
        createdAt: task.createdAt || new Date(),
      });
    }

    // 2. Subtasks
    if (Array.isArray(task.subtasks)) {
      for (const st of task.subtasks) {
        activitiesToInsert.push({
          type: 'subtask_created',
          title: 'Subtask Created',
          description: st.title || 'Checklist item added',
          userId: task.assignerId || task.doerId,
          relatedId: task._id,
          relatedType: 'task',
          metadata: { taskUid, subtaskId: st._id, completed: st.completed },
          createdAt: st.completedAt || task.createdAt || new Date(),
        });
      }
    }

    // 3. Remarks
    if (Array.isArray(task.remarks)) {
      for (const rm of task.remarks) {
        activitiesToInsert.push({
          type: 'remark',
          title: 'Remark Added',
          description: rm.text || 'Remark posted on task',
          userId: rm.by || task.doerId || task.assignerId,
          relatedId: task._id,
          relatedType: 'task',
          metadata: { taskUid, byName: rm.byName },
          createdAt: rm.createdAt || new Date(),
        });
      }
    }

    // 4. Date revisions
    if (Array.isArray(task.dateRevisions)) {
      for (const dr of task.dateRevisions) {
        activitiesToInsert.push({
          type: 'date_revision',
          title: 'Due Date Revised',
          description: dr.reason || 'Timeline schedule revised',
          userId: dr.revisedBy || task.assignerId,
          relatedId: task._id,
          relatedType: 'task',
          metadata: { taskUid, oldDate: dr.oldDate, newDate: dr.newDate },
          createdAt: dr.createdAt || new Date(),
        });
      }
    }

    // 5. Status Completed or Status Transitions
    if (task.status === 'Completed' || task.status === 'Awaiting Verification') {
      activitiesToInsert.push({
        type: 'status_change',
        title: `Task Status Updated: ${task.status}`,
        description: `Status changed to ${task.status}`,
        userId: task.verifiedBy || task.doerId || task.assignerId,
        relatedId: task._id,
        relatedType: 'task',
        metadata: { taskUid, newStatus: task.status },
        createdAt: task.verifiedAt || task.completedAt || task.updatedAt || new Date(),
      });
    }

    // 6. Deleted
    if (task.isDeleted && task.deletedBy) {
      activitiesToInsert.push({
        type: 'deleted',
        title: 'Task Deleted',
        description: `Task moved to trash bin`,
        userId: task.deletedBy,
        relatedId: task._id,
        relatedType: 'task',
        metadata: { taskUid },
        createdAt: task.deletedAt || new Date(),
      });
    }
  }

  if (activitiesToInsert.length > 0) {
    // Sort descending by date
    activitiesToInsert.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    await Activity.insertMany(activitiesToInsert);
  }
}

/**
 * GET /api/v1/activities
 * Fetches the centralized administrative forensic audit timeline.
 */
export async function getActivities(req, res, next) {
  try {
    await syncHistoricalDelegationActivities();

    const {
      startDate,
      endDate,
      userId,
      type,
      search,
      limit = 100,
    } = req.query;

    const query = {};

    // Temporal Filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // User Filter
    if (userId && userId !== 'All' && userId !== 'Updated By') {
      if (mongoose.Types.ObjectId.isValid(userId)) {
        query.userId = new mongoose.Types.ObjectId(userId);
      }
    }

    // Type Filter
    if (type && type !== 'All') {
      query.type = type;
    }

    // Search Query (title or description)
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { title: searchRegex },
        { description: searchRegex },
      ];
    }

    const rawActivities = await Activity.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10) || 100)
      .populate('userId', 'user email role designation avatar')
      .lean();

    // Map into standard response projection defined in ACTIVITIES-UI.md
    const activities = rawActivities.map((act) => {
      const userDoc = act.userId || {};
      const { firstName, lastName } = splitName(userDoc.user || userDoc.email || 'Staff Member');

      return {
        id: act._id,
        _id: act._id,
        type: act.type,
        title: act.title,
        description: act.description,
        userId: userDoc._id || act.userId,
        relatedId: act.relatedId,
        relatedType: act.relatedType || 'task',
        metadata: act.metadata || {},
        createdAt: act.createdAt,
        user: {
          userId: userDoc._id || act.userId,
          _id: userDoc._id || act.userId,
          firstName,
          lastName,
          designation: userDoc.designation || userDoc.role || 'Staff',
          profilePhotoUrl: userDoc.avatar || null,
        },
      };
    });

    // If search term was provided, also allow matching on author full name
    let filteredActivities = activities;
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      filteredActivities = activities.filter((act) => {
        const titleMatch = (act.title || '').toLowerCase().includes(term);
        const descMatch = (act.description || '').toLowerCase().includes(term);
        const authorMatch = `${act.user?.firstName || ''} ${act.user?.lastName || ''}`.toLowerCase().includes(term);
        return titleMatch || descMatch || authorMatch;
      });
    }

    res.json({
      success: true,
      data: filteredActivities,
    });
  } catch (err) {
    next(err);
  }
}
