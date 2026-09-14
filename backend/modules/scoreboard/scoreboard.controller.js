import mongoose from 'mongoose';
import User from '../../models/User.js';
import Delegation from '../../models/Delegation.js';
import { ChecklistOccurrence } from '../../models/Checklist.js';
import ScoreboardGoal from '../../models/ScoreboardGoal.js';
import Employee from '../../models/hrms/Employee.js';
import { isSuperAdmin } from '../../middlewares/rbac.js';

/**
 * Format a Date object to YYYY-MM-DD
 */
function toDateStr(d) {
  const dt = new Date(d);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if the user is authorized to edit Next Goals and MD Adjustments.
 * Allowed: CEO, Managing Director (MD), Admins, Super Admins, Management.
 */
async function canUserEditScoreboard(user) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;

  const role = String(user.role || '').toUpperCase();
  if (['ADMIN', 'SUPERADMIN', 'SUPER ADMIN', 'MANAGEMENT'].includes(role)) {
    return true;
  }

  // Check designation on user or employee record
  const designationRegex = /\b(ceo|managing director|md)\b/i;
  if (user.designation && designationRegex.test(user.designation)) {
    return true;
  }

  // Check HRMS Employee master record
  try {
    const employee = await Employee.findOne({
      $or: [{ userId: user._id }, { workEmail: user.email?.toLowerCase() }],
    }).select('designation').lean();
    if (employee?.designation && designationRegex.test(employee.designation)) {
      return true;
    }
  } catch (err) {
    // Ignore employee lookup errors
  }

  return false;
}

/**
 * Compute the date ranges for current, previous, and next periods.
 */
function computePeriodWindows(period = 'week', refDate = new Date()) {
  const now = new Date(refDate);

  let periodStart;
  let periodEnd;
  let lastPeriodStart;
  let lastPeriodEnd;
  let nextPeriodStart;
  let nextPeriodEnd;

  if (period === 'month') {
    // 1st of month 00:00:00 to 1st of next month 00:00:00
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

    lastPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    lastPeriodEnd = new Date(periodStart);

    nextPeriodStart = new Date(periodEnd);
    nextPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 2, 1, 0, 0, 0, 0);
  } else if (period === 'year') {
    // Jan 1st 00:00:00 to Jan 1st of next year 00:00:00
    periodStart = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    periodEnd = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);

    lastPeriodStart = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
    lastPeriodEnd = new Date(periodStart);

    nextPeriodStart = new Date(periodEnd);
    nextPeriodEnd = new Date(now.getFullYear() + 2, 0, 1, 0, 0, 0, 0);
  } else {
    // Standard Week: Monday 00:00:00 to next Monday 00:00:00
    const day = now.getDay();
    const mondayOffset = (day + 6) % 7; // Monday = 0, Sunday = 6
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset, 0, 0, 0, 0);
    periodEnd = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    lastPeriodStart = new Date(periodStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    lastPeriodEnd = new Date(periodStart);

    nextPeriodStart = new Date(periodEnd);
    nextPeriodEnd = new Date(periodEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  // In-Progress Cutoff: if current date is inside periodStart..periodEnd,
  // limit execution deadline check to end of today to prevent false misses on future tasks
  const actualNow = new Date();
  let calcPeriodEnd = periodEnd;
  if (periodStart <= actualNow && actualNow < periodEnd) {
    calcPeriodEnd = new Date(actualNow.getFullYear(), actualNow.getMonth(), actualNow.getDate(), 23, 59, 59, 999);
  }

  // Display boundary end date (inclusive for label)
  const displayEnd = new Date(periodEnd.getTime() - 1000);

  const periodKey = `${toDateStr(periodStart)}_${toDateStr(displayEnd)}`;

  return {
    periodStart,
    periodEnd,
    calcPeriodEnd,
    displayEnd,
    lastPeriodStart,
    lastPeriodEnd,
    nextPeriodStart,
    nextPeriodEnd,
    periodKey,
  };
}

/**
 * GET /api/v1/scoreboard
 * Retrieves Executive Scoreboard data.
 */
export async function getScoreboard(req, res, next) {
  try {
    const period = ['week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'week';
    const scope = ['all', 'HO', 'Bhandup'].includes(req.query.scope) ? req.query.scope : 'all';
    const refDate = req.query.date ? new Date(req.query.date) : new Date();

    const {
      periodStart,
      periodEnd,
      calcPeriodEnd,
      displayEnd,
      lastPeriodStart,
      lastPeriodEnd,
      nextPeriodStart,
      nextPeriodEnd,
      periodKey,
    } = computePeriodWindows(period, refDate);

    // 1. Fetch active users as the universal doer foundation
    const activeUsers = await User.find({ status: 'Active' })
      .select('_id user email role location')
      .lean();

    // Map by user ID and by normalized name
    const doerMap = new Map();

    activeUsers.forEach((u) => {
      const name = (u.user || u.email || 'Unknown').trim();
      if (!name) return;
      doerMap.set(name.toLowerCase(), {
        userId: u._id,
        doer: name,
        location: u.location || '',
        nowPlanned: 0,
        nowDone: 0,
        nowOnTime: 0,
        lastPlanned: 0,
        lastDone: 0,
        lastOnTime: 0,
        nextPlanned: 0,
        nextGoal: null,
        mdAdjustment: 0,
      });
    });

    const getOrCreateDoer = (name, userId = null, location = '') => {
      const trimmed = (name || 'Unknown').trim();
      const key = trimmed.toLowerCase();
      if (!doerMap.has(key)) {
        doerMap.set(key, {
          userId,
          doer: trimmed,
          location,
          nowPlanned: 0,
          nowDone: 0,
          nowOnTime: 0,
          lastPlanned: 0,
          lastDone: 0,
          lastOnTime: 0,
          nextPlanned: 0,
          nextGoal: null,
          mdAdjustment: 0,
        });
      }
      return doerMap.get(key);
    };

    // 2. Query Delegations
    // Check site scope if scope is not 'all'
    const delegationQuery = { isDeleted: { $ne: true } };

    const delegations = await Delegation.find(delegationQuery)
      .select('doerId doerFirstName doerLastName dueDate completedAt status')
      .lean();

    delegations.forEach((d) => {
      const doerName = `${d.doerFirstName || ''} ${d.doerLastName || ''}`.trim() || 'Unknown';
      const item = getOrCreateDoer(doerName, d.doerId);

      // If scope filtering is active and user location doesn't match, skip
      if (scope !== 'all' && item.location && !item.location.toLowerCase().includes(scope.toLowerCase())) {
        return;
      }

      const due = d.dueDate ? new Date(d.dueDate) : null;
      if (!due) return;

      const isCompleted = d.status === 'Completed' || d.status === 'Awaiting Verification' || !!d.completedAt;
      const completedAt = d.completedAt ? new Date(d.completedAt) : (isCompleted ? due : null);
      const isOnTime = isCompleted && completedAt && completedAt <= due;

      // Current period
      if (due >= periodStart && due <= calcPeriodEnd) {
        item.nowPlanned += 1;
        if (isCompleted) item.nowDone += 1;
        if (isOnTime) item.nowOnTime += 1;
      }

      // Last period
      if (due >= lastPeriodStart && due < lastPeriodEnd) {
        item.lastPlanned += 1;
        if (isCompleted) item.lastDone += 1;
        if (isOnTime) item.lastOnTime += 1;
      }

      // Next period
      if (due >= nextPeriodStart && due < nextPeriodEnd) {
        if (!isCompleted) {
          item.nextPlanned += 1;
        }
      }
    });

    // 3. Query Checklist Occurrences
    const occurrenceQuery = {};
    if (scope !== 'all') {
      occurrenceQuery.site = new RegExp(`^${scope}$`, 'i');
    }

    const occurrences = await ChecklistOccurrence.find(occurrenceQuery)
      .select('doer doerFirstName doerLastName plannedDate completedDate status site')
      .lean();

    occurrences.forEach((o) => {
      const doerName = `${o.doerFirstName || ''} ${o.doerLastName || ''}`.trim() || 'Unknown';
      const item = getOrCreateDoer(doerName, o.doer);

      const planned = o.plannedDate ? new Date(o.plannedDate) : null;
      if (!planned) return;

      const isCompleted = o.status === 'completed' || !!o.completedDate;
      const completedDate = o.completedDate ? new Date(o.completedDate) : (isCompleted ? planned : null);
      const isOnTime = isCompleted && completedDate && completedDate <= planned;

      // Current period
      if (planned >= periodStart && planned <= calcPeriodEnd) {
        item.nowPlanned += 1;
        if (isCompleted) item.nowDone += 1;
        if (isOnTime) item.nowOnTime += 1;
      }

      // Last period
      if (planned >= lastPeriodStart && planned < lastPeriodEnd) {
        item.lastPlanned += 1;
        if (isCompleted) item.lastDone += 1;
        if (isOnTime) item.lastOnTime += 1;
      }

      // Next period
      if (planned >= nextPeriodStart && planned < nextPeriodEnd) {
        if (!isCompleted) {
          item.nextPlanned += 1;
        }
      }
    });

    // 4. Fetch stored goals & adjustments for this period window
    const storedGoals = await ScoreboardGoal.find({
      period,
      periodKey,
    }).lean();

    const goalsMap = new Map();
    storedGoals.forEach((g) => {
      goalsMap.set(g.doerName.toLowerCase(), g);
    });

    // 5. Calculate KRA/KPI metrics for each doer
    const rows = Array.from(doerMap.values()).map((entry) => {
      const goalDoc = goalsMap.get(entry.doer.toLowerCase());
      const nextGoal = goalDoc?.nextGoal !== undefined ? goalDoc.nextGoal : null;
      const mdAdjustment = goalDoc?.mdAdjustment !== undefined ? goalDoc.mdAdjustment : 0;

      const hasWork = entry.nowPlanned > 0;

      // KRA 1: All work should be done -> % work not done
      const kra1MissPct = hasWork
        ? Math.round(((entry.nowPlanned - entry.nowDone) / entry.nowPlanned) * 100)
        : null;

      const kra1LastMissPct = entry.lastPlanned > 0
        ? Math.round(((entry.lastPlanned - entry.lastDone) / entry.lastPlanned) * 100)
        : null;

      // KRA 2: All work should be done on time -> % work not on time
      const kra2MissPct = hasWork
        ? Math.round(((entry.nowPlanned - entry.nowOnTime) / entry.nowPlanned) * 100)
        : null;

      const kra2LastMissPct = entry.lastPlanned > 0
        ? Math.round(((entry.lastPlanned - entry.lastOnTime) / entry.lastPlanned) * 100)
        : null;

      // Inverted Mean baseline score: mean(100 - Miss%)
      let baselineScore = null;
      let finalScore = null;

      if (hasWork && kra1MissPct !== null && kra2MissPct !== null) {
        const score1 = Math.max(0, 100 - kra1MissPct);
        const score2 = Math.max(0, 100 - kra2MissPct);
        baselineScore = Math.round((score1 + score2) / 2);
        finalScore = Math.max(0, baselineScore + mdAdjustment);
      }

      return {
        userId: entry.userId,
        doer: entry.doer,
        hasWork,
        baselineScore,
        mdAdjustment,
        finalScore,
        nextPlanned: entry.nextPlanned,
        nextGoal,
        kras: [
          {
            key: 'done',
            kra: 'All work should be done',
            kpi: '% work not done',
            benchmark: 0,
            lastPct: kra1LastMissPct,
            planned: entry.nowPlanned,
            actual: entry.nowDone,
            actualPct: kra1MissPct,
          },
          {
            key: 'onTime',
            kra: 'All work should be done on time',
            kpi: '% work not on time',
            benchmark: 0,
            lastPct: kra2LastMissPct,
            planned: entry.nowPlanned,
            actual: entry.nowOnTime,
            actualPct: kra2MissPct,
          },
        ],
      };
    });

    // 6. Strict 3-level comparator sorting:
    // 1) Activity Precedence (hasWork === true sorts above false)
    // 2) Final Score Descending
    // 3) Alphabetical Tie-Break
    rows.sort((a, b) => {
      if (a.hasWork !== b.hasWork) {
        return a.hasWork ? -1 : 1;
      }
      const scoreA = a.finalScore !== null ? a.finalScore : -999;
      const scoreB = b.finalScore !== null ? b.finalScore : -999;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return a.doer.localeCompare(b.doer);
    });

    // Assign Rank 1..N
    rows.forEach((r, idx) => {
      r.rank = idx + 1;
    });

    // 7. Top 3 Podium performers (from those with active work)
    const top = rows.filter((r) => r.hasWork && r.finalScore !== null).slice(0, 3);

    // 8. Permission determination
    const canEdit = await canUserEditScoreboard(req.user);

    const totalDoers = rows.length;
    const activeDoers = rows.filter((r) => r.hasWork).length;

    res.json({
      success: true,
      data: {
        rows,
        top,
        period,
        scope,
        periodStart: toDateStr(periodStart),
        periodEnd: toDateStr(displayEnd),
        periodKey,
        totalDoers,
        activeDoers,
        canEdit,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/scoreboard/goals
 * Set Next Goal and/or MD Adjustment inline for a doer.
 */
export async function updateGoalOrAdjustment(req, res, next) {
  try {
    const canEdit = await canUserEditScoreboard(req.user);
    if (!canEdit) {
      return res.status(403).json({
        success: false,
        message: 'Only CEO, MD, or Administrators are authorized to modify goals and adjustments.',
      });
    }

    const { doerName, period = 'week', periodKey, nextGoal, mdAdjustment, userId } = req.body;

    if (!doerName || !periodKey) {
      return res.status(400).json({
        success: false,
        message: 'doerName and periodKey are required.',
      });
    }

    const updateFields = {
      updatedBy: req.user._id,
      updatedAt: new Date(),
    };

    if (nextGoal !== undefined) {
      updateFields.nextGoal = nextGoal === '' || nextGoal === null ? null : Number(nextGoal);
    }

    if (mdAdjustment !== undefined) {
      updateFields.mdAdjustment = Number(mdAdjustment) || 0;
    }

    if (userId) {
      updateFields.userId = userId;
    }

    const updated = await ScoreboardGoal.findOneAndUpdate(
      { doerName: doerName.trim(), period, periodKey },
      { $set: updateFields },
      { new: true, upsert: true }
    );

    res.json({
      success: true,
      data: updated,
      message: 'Goal and adjustment updated successfully.',
    });
  } catch (err) {
    next(err);
  }
}
