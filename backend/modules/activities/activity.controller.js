import mongoose from 'mongoose';
import Activity from '../../models/Activity.js';
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
 * GET /api/v1/activities
 * Fetches the centralized administrative forensic audit timeline.
 */
export async function getActivities(req, res, next) {
  try {

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
