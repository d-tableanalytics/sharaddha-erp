/**
 * FMS analytics (§38-41).
 *
 * ---------------------------------------------------------------------------
 * 🔴 THE CONSTRAINT THAT SHAPES THIS ENTIRE FILE
 * ---------------------------------------------------------------------------
 *
 * The 2,315 historical orders being migrated from the Google Sheet carry ACTUAL
 * dates only. They have no per-stage PLANNED dates, and §48 forbids inventing
 * them — a deadline reconstructed today from today's SLA master would judge work
 * done last year against rules that did not exist then, and would do it
 * invisibly.
 *
 * An on-time percentage needs both halves. A cycle time needs only actuals. So
 * the two families of metric have DIFFERENT DENOMINATORS, and conflating them is
 * the single most misleading thing this module could do:
 *
 *   SLA COMPLIANCE   planned vs actual   -> migrated orders EXCLUDED
 *   CYCLE TIME       actual to actual    -> migrated orders INCLUDED
 *   VOLUME / STATUS  counting            -> migrated orders INCLUDED
 *
 * The exclusion is expressed as `plannedCompletion: { $ne: null }` rather than
 * as a `migrated` flag, because that IS the question being asked — "can this
 * stage be scored at all" — and it stays correct for any other row that lacks a
 * deadline, however it got that way.
 *
 * ---------------------------------------------------------------------------
 * EVERY SLA FIGURE CARRIES ITS COVERAGE
 * ---------------------------------------------------------------------------
 *
 * "94% on-time" computed over 300 of 2,615 orders is not a true statement with a
 * caveat; without the caveat it is a false one. So every function that excludes
 * anything returns a `coverage` block — how many rows it scored, how many it
 * could not, and why — and the screens render it beside the number rather than
 * in a footnote. A caller cannot get the figure without also getting the reason
 * it is partial.
 */

import mongoose from 'mongoose';

import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import { O2dExitRegister } from '../../models/o2d/O2dExitRegister.js';
import {
  ORDER_STATUS,
  STAGE_STATUS,
  KPI_COUNTED_STATUSES,
  TERMINAL_STAGE_STATUSES,
  STAGES,
} from '../../shared/constants/o2d.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** A `poDate` window, as a mongo match fragment. */
function dateWindow(from, to, field = 'poDate') {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) range.$lte = new Date(to);
  return { [field]: range };
}

/**
 * The orders in scope, and how many of them can be SLA-scored.
 *
 * Returned together because no caller wants one without the other — see the
 * coverage note above.
 */
async function scope({ from = null, to = null, customerKey = null } = {}) {
  const match = { ...dateWindow(from, to) };
  if (customerKey) match.customerKey = customerKey;

  const [total, migrated] = await Promise.all([
    O2dOrder.countDocuments(match),
    // The rows that carry actuals but no deadlines. Counted so the coverage
    // block can name them rather than leaving a gap the reader must infer.
    O2dOrder.countDocuments({ ...match, migrated: true }),
  ]);

  const ids = await O2dOrder.distinct('_id', match);
  return { match, ids, total, migrated, scorable: total - migrated };
}

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

/**
 * The headline figures (§38).
 *
 * Volume and status counts include migrated orders: they were real orders and
 * the business shipped them, so leaving them out would understate the year.
 */
export async function dashboardSummary({ from = null, to = null } = {}) {
  const match = dateWindow(from, to);

  const [byStatus, overdueStages, dispatched, exits] = await Promise.all([
    O2dOrder.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    // Open stages past their deadline, on live orders only.
    O2dOrderStage.aggregate([
      {
        $match: {
          status: { $nin: TERMINAL_STAGE_STATUSES },
          plannedCompletion: { $ne: null, $lt: new Date() },
        },
      },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]),
    O2dOrder.countDocuments({ ...match, dispatchedAt: { $ne: null } }),
    O2dExitRegister.countDocuments({ revivedAt: null }),
  ]);

  const statuses = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));

  return {
    open: statuses[ORDER_STATUS.OPEN] ?? 0,
    onHold: statuses[ORDER_STATUS.ON_HOLD] ?? 0,
    closed: statuses[ORDER_STATUS.CLOSED] ?? 0,
    cancelled: statuses[ORDER_STATUS.CANCELLED] ?? 0,
    void: statuses[ORDER_STATUS.VOID] ?? 0,
    dispatched,
    overdueStages: overdueStages[0]?.count ?? 0,
    exits,
    total: Object.values(statuses).reduce((a, b) => a + b, 0),
  };
}

// ---------------------------------------------------------------------------
// SLA compliance — migrated orders excluded
// ---------------------------------------------------------------------------

/**
 * On-time percentage, overall and per stage (§39).
 *
 * `onTimePercentage` is `null`, never 0, when nothing could be scored. Zero
 * means "everything was late", which is a catastrophic finding; null means "we
 * cannot say", which is a completely different one. A dashboard that renders 0%
 * for an empty month invents a crisis.
 */
export async function slaCompliance({ from = null, to = null, customerKey = null } = {}) {
  const { ids, total, migrated, scorable } = await scope({ from, to, customerKey });

  const rows = await O2dOrderStage.aggregate([
    {
      $match: {
        order: { $in: ids.map((i) => oid(i)) },
        status: { $in: [...KPI_COUNTED_STATUSES] },
        // The line that excludes migrated history. See the header.
        plannedCompletion: { $ne: null },
      },
    },
    {
      $group: {
        _id: { stageNumber: '$stageNumber', stageName: '$stageName', ownerRole: '$ownerRole' },
        completed: { $sum: 1 },
        onTime: { $sum: { $cond: [{ $eq: ['$status', STAGE_STATUS.DONE_ON_TIME] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', STAGE_STATUS.DONE_LATE] }, 1, 0] } },
        totalDelay: { $sum: { $ifNull: ['$delayMinutes', 0] } },
        worstDelay: { $max: { $ifNull: ['$delayMinutes', 0] } },
      },
    },
    { $sort: { '_id.stageNumber': 1 } },
  ]);

  const byStage = rows.map((r) => ({
    stageNumber: r._id.stageNumber,
    stageName: r._id.stageName,
    ownerRole: r._id.ownerRole,
    completed: r.completed,
    onTime: r.onTime,
    late: r.late,
    onTimePercentage: r.completed > 0 ? Number(((r.onTime / r.completed) * 100).toFixed(1)) : null,
    // Averaged over LATE stages only, not over all of them. Averaging in the
    // zeros of every on-time stage produces a number that falls when the team
    // improves and tells nobody how bad the late ones actually are.
    averageDelayMinutes: r.late > 0 ? Math.round(r.totalDelay / r.late) : null,
    worstDelayMinutes: r.worstDelay || null,
  }));

  const completed = byStage.reduce((a, s) => a + s.completed, 0);
  const onTime = byStage.reduce((a, s) => a + s.onTime, 0);

  // Skipped stages are excluded by KPI_COUNTED_STATUSES; counted here so the
  // coverage block can say so, since a skip is a legitimate way to leave the KPI
  // and a reader should be able to see it was not abused.
  const skipped = await O2dOrderStage.countDocuments({
    order: { $in: ids.map((i) => oid(i)) },
    status: STAGE_STATUS.SKIPPED,
  });

  return {
    onTimePercentage: completed > 0 ? Number(((onTime / completed) * 100).toFixed(1)) : null,
    completed,
    onTime,
    late: completed - onTime,
    byStage,
    coverage: coverageBlock({ total, migrated, scorable, skipped }),
  };
}

/**
 * The coverage caveat, in a shape a screen can render without interpreting.
 *
 * `note` is a sentence rather than a code, because it ends up under a percentage
 * on a manager's dashboard and must be readable there without a legend.
 */
function coverageBlock({ total, migrated, scorable, skipped = 0 }) {
  return {
    ordersInRange: total,
    ordersScored: scorable,
    ordersExcluded: migrated,
    stagesSkipped: skipped,
    complete: migrated === 0,
    note:
      migrated > 0
        ? `${migrated} of ${total} order(s) are migrated history and carry actual dates only. `
          + 'They have no recorded deadlines, so they cannot be scored for on-time performance '
          + 'and are excluded from this figure. They ARE included in cycle-time and volume.'
        : null,
  };
}

// ---------------------------------------------------------------------------
// Delay analysis
// ---------------------------------------------------------------------------

/**
 * Where the time actually goes (§40).
 *
 * Ordered by TOTAL delay contributed rather than by average, because that is the
 * question a manager is asking: fixing the stage that loses 400 hours across 200
 * orders beats fixing the one that loses 20 hours twice, even though the second
 * has the worse average.
 */
export async function delayAnalysis({ from = null, to = null, limit = 12 } = {}) {
  const { ids, total, migrated, scorable } = await scope({ from, to });

  const rows = await O2dOrderStage.aggregate([
    {
      $match: {
        order: { $in: ids.map((i) => oid(i)) },
        status: STAGE_STATUS.DONE_LATE,
        plannedCompletion: { $ne: null },
        delayMinutes: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: { stageNumber: '$stageNumber', stageName: '$stageName', ownerRole: '$ownerRole' },
        lateCount: { $sum: 1 },
        totalDelayMinutes: { $sum: '$delayMinutes' },
        averageDelayMinutes: { $avg: '$delayMinutes' },
        worstDelayMinutes: { $max: '$delayMinutes' },
      },
    },
    { $sort: { totalDelayMinutes: -1 } },
    { $limit: limit },
  ]);

  return {
    data: rows.map((r) => ({
      stageNumber: r._id.stageNumber,
      stageName: r._id.stageName,
      ownerRole: r._id.ownerRole,
      lateCount: r.lateCount,
      totalDelayMinutes: r.totalDelayMinutes,
      averageDelayMinutes: Math.round(r.averageDelayMinutes),
      worstDelayMinutes: r.worstDelayMinutes,
    })),
    coverage: coverageBlock({ total, migrated, scorable }),
  };
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

/**
 * Per-person and per-role performance (§41).
 *
 * ⚠ A CAUTION WORTH WRITING DOWN. These numbers attribute a stage's lateness to
 * whoever RECORDED its completion, because that is the only name the data
 * carries. That person is often not the cause: a stage-8 invoice is late because
 * the warehouse finished picking at 5:55 PM, and the person who raised the
 * invoice at 6:10 PM gets the mark. The per-STAGE figures above are the
 * trustworthy ones; these are a starting point for a conversation, not a
 * ranking. Presenting them as a league table would be actively harmful.
 */
export async function performanceByPerson({ from = null, to = null, limit = 50 } = {}) {
  const { ids, total, migrated, scorable } = await scope({ from, to });

  const rows = await O2dOrderStage.aggregate([
    {
      $match: {
        order: { $in: ids.map((i) => oid(i)) },
        status: { $in: [...KPI_COUNTED_STATUSES] },
        plannedCompletion: { $ne: null },
        completedBy: { $ne: null },
      },
    },
    {
      $group: {
        _id: { user: '$completedBy', name: '$completedByName', role: '$completedByRole' },
        completed: { $sum: 1 },
        onTime: { $sum: { $cond: [{ $eq: ['$status', STAGE_STATUS.DONE_ON_TIME] }, 1, 0] } },
        totalDelay: { $sum: { $ifNull: ['$delayMinutes', 0] } },
      },
    },
    { $sort: { completed: -1 } },
    { $limit: limit },
  ]);

  return {
    data: rows.map((r) => ({
      userId: r._id.user,
      name: r._id.name,
      role: r._id.role,
      completed: r.completed,
      onTime: r.onTime,
      late: r.completed - r.onTime,
      onTimePercentage: Number(((r.onTime / r.completed) * 100).toFixed(1)),
      averageDelayMinutes:
        r.completed - r.onTime > 0 ? Math.round(r.totalDelay / (r.completed - r.onTime)) : null,
    })),
    coverage: coverageBlock({ total, migrated, scorable }),
    caution:
      'Lateness is attributed to whoever recorded the completion, who is often not the cause. '
      + 'Use the per-stage figures to find process problems; use these to start a conversation.',
  };
}

/** The same, grouped by role — which IS a fair comparison, unlike by person. */
export async function performanceByRole({ from = null, to = null } = {}) {
  const { ids, total, migrated, scorable } = await scope({ from, to });

  const rows = await O2dOrderStage.aggregate([
    {
      $match: {
        order: { $in: ids.map((i) => oid(i)) },
        status: { $in: [...KPI_COUNTED_STATUSES] },
        plannedCompletion: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$ownerRole',
        completed: { $sum: 1 },
        onTime: { $sum: { $cond: [{ $eq: ['$status', STAGE_STATUS.DONE_ON_TIME] }, 1, 0] } },
        totalDelay: { $sum: { $ifNull: ['$delayMinutes', 0] } },
      },
    },
    { $sort: { completed: -1 } },
  ]);

  return {
    data: rows.map((r) => ({
      role: r._id,
      completed: r.completed,
      onTime: r.onTime,
      late: r.completed - r.onTime,
      onTimePercentage: Number(((r.onTime / r.completed) * 100).toFixed(1)),
      averageDelayMinutes:
        r.completed - r.onTime > 0 ? Math.round(r.totalDelay / (r.completed - r.onTime)) : null,
    })),
    coverage: coverageBlock({ total, migrated, scorable }),
  };
}

// ---------------------------------------------------------------------------
// Cycle time — migrated orders INCLUDED
// ---------------------------------------------------------------------------

/**
 * PO to dispatch, the headline business KPI.
 *
 * The one family of metric the migrated history CAN answer, because it needs
 * only two actual dates. Including it is the whole point of migrating those rows
 * — a year of cycle-time history is worth having even though none of it can be
 * scored against an SLA.
 *
 * Reported as a MEDIAN alongside the mean. A handful of orders that sat for
 * three months waiting on an import drags a mean somewhere no real order lives;
 * the median says what a typical order actually did.
 */
export async function cycleTime({ from = null, to = null, customerKey = null } = {}) {
  const match = { ...dateWindow(from, to), dispatchedAt: { $ne: null } };
  if (customerKey) match.customerKey = customerKey;

  const rows = await O2dOrder.aggregate([
    { $match: match },
    {
      $project: {
        migrated: 1,
        poNumber: 1,
        customerName: 1,
        // Whole hours: sub-hour precision on a multi-day figure is noise.
        hours: {
          $divide: [{ $subtract: ['$dispatchedAt', '$poDate'] }, 1000 * 60 * 60],
        },
      },
    },
    { $sort: { hours: 1 } },
  ]);

  if (rows.length === 0) {
    return { count: 0, medianHours: null, averageHours: null, fastest: null, slowest: null, includesMigrated: false };
  }

  const hours = rows.map((r) => r.hours);
  const mid = Math.floor(hours.length / 2);
  const median =
    hours.length % 2 === 0 ? (hours[mid - 1] + hours[mid]) / 2 : hours[mid];

  return {
    count: rows.length,
    medianHours: Number(median.toFixed(1)),
    averageHours: Number((hours.reduce((a, b) => a + b, 0) / hours.length).toFixed(1)),
    fastest: { poNumber: rows[0].poNumber, hours: Number(rows[0].hours.toFixed(1)) },
    slowest: {
      poNumber: rows[rows.length - 1].poNumber,
      hours: Number(rows[rows.length - 1].hours.toFixed(1)),
    },
    // Stated explicitly, because the SLA figures next to it exclude them and a
    // reader comparing the two denominators deserves to know why they differ.
    includesMigrated: rows.some((r) => r.migrated),
    migratedCount: rows.filter((r) => r.migrated).length,
  };
}

/**
 * Per-customer performance.
 *
 * Cycle time rather than on-time percentage, deliberately: a customer's
 * experience is how long their order took, not whether an internal deadline was
 * met — and for migrated history the internal deadline does not exist.
 */
export async function performanceByCustomer({ from = null, to = null, limit = 25 } = {}) {
  const rows = await O2dOrder.aggregate([
    { $match: { ...dateWindow(from, to), dispatchedAt: { $ne: null } } },
    {
      $group: {
        _id: { key: '$customerKey', name: '$customerName' },
        orders: { $sum: 1 },
        totalHours: {
          $sum: { $divide: [{ $subtract: ['$dispatchedAt', '$poDate'] }, 1000 * 60 * 60] },
        },
        slowestHours: {
          $max: { $divide: [{ $subtract: ['$dispatchedAt', '$poDate'] }, 1000 * 60 * 60] },
        },
      },
    },
    { $sort: { orders: -1 } },
    { $limit: limit },
  ]);

  return {
    data: rows.map((r) => ({
      customerKey: r._id.key,
      customerName: r._id.name,
      orders: r.orders,
      averageHours: Number((r.totalHours / r.orders).toFixed(1)),
      slowestHours: Number(r.slowestHours.toFixed(1)),
    })),
  };
}

// ---------------------------------------------------------------------------
// Everything, for one screen
// ---------------------------------------------------------------------------

/** One call, so the dashboard is one round trip rather than six. */
export async function fullDashboard({ from = null, to = null } = {}) {
  const [summary, sla, delays, roles, cycle, customers] = await Promise.all([
    dashboardSummary({ from, to }),
    slaCompliance({ from, to }),
    delayAnalysis({ from, to }),
    performanceByRole({ from, to }),
    cycleTime({ from, to }),
    performanceByCustomer({ from, to }),
  ]);

  return { summary, sla, delays, roles, cycle, customers, generatedAt: new Date() };
}

export default {
  dashboardSummary,
  slaCompliance,
  delayAnalysis,
  performanceByPerson,
  performanceByRole,
  cycleTime,
  performanceByCustomer,
  fullDashboard,
};
