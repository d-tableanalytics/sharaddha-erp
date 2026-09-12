/**
 * The sweep: reminders, overdue alerts and escalation (§42).
 *
 * ---------------------------------------------------------------------------
 * WHY A SWEEP AND NOT A TIMER PER STAGE
 * ---------------------------------------------------------------------------
 *
 * A deadline passing is not an event anything emits — nothing happens at 5:00 PM
 * except that 5:00 PM arrives. Scheduling a timer per open stage would mean
 * thousands of live timers that vanish on restart and double up when two
 * instances run. A periodic query over the stages that are actually open is
 * cheap (it is one indexed read), survives restarts, and is idempotent.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCE, TWICE OVER
 * ---------------------------------------------------------------------------
 *
 * The sweep runs every few minutes and must not re-send on every pass. Two
 * independent mechanisms, deliberately:
 *
 *   1. `dueSoonNotifiedAt` / `overdueNotifiedAt` / `escalatedAt` on the stage —
 *      stamped when the notification is raised, and part of the query, so the
 *      sweep does not even find a stage it has already handled.
 *   2. The unique `dedupeKey` on the notification itself.
 *
 * Belt and braces because they fail differently: the stamp can be lost to a
 * crash between notify and save, and the key cannot express "notify again
 * tomorrow" if that is ever wanted. Either alone would be adequate most days.
 *
 * ---------------------------------------------------------------------------
 * ESCALATION IS ABOUT THE PERSON, NOT THE DEADLINE
 * ---------------------------------------------------------------------------
 *
 * An overdue alert goes to whoever must do the work. An ESCALATION goes to their
 * escalation role, and only after a grace period during which they could have
 * acted on the alert. Escalating at the same instant as the overdue notice would
 * tell a manager about every deadline the moment it slips, which is how managers
 * learn to filter the alerts into a folder.
 */

import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dNotification } from '../../models/o2d/O2dNotification.js';
import { dispatchEvent } from './notification.service.js';
import { loadCalendar, workingMinutesBetween } from './calendar.service.js';
import {
  O2D_EVENTS,
  ORDER_STATUS,
  TERMINAL_STAGE_STATUSES,
  STAGE_STATUS,
  DUE_SOON_THRESHOLD,
} from '../../shared/constants/o2d.js';

/**
 * How long after a deadline before the escalation role is told.
 *
 * WORKING minutes, not wall-clock. A stage that goes overdue at 6:00 PM should
 * escalate mid-morning, not at 8:00 PM when nobody can act on it — which is what
 * a plain "two hours later" would do.
 *
 * Configurable because the right number is a business judgement that will be
 * tuned once people live with it.
 */
const escalateAfterWorkingMinutes = () =>
  Number(process.env.O2D_ESCALATE_AFTER_WORKING_MINUTES ?? 120);

/** Stage statuses that are still work. Excludes locked, held and terminal. */
const OPEN_STATUSES = [STAGE_STATUS.PENDING, STAGE_STATUS.DUE_SOON, STAGE_STATUS.OVERDUE];

/**
 * Every open stage on a live order.
 *
 * An order ON_HOLD is excluded, and that is the whole reason §19 freezes its
 * SLA: chasing somebody about a deadline on an order they have been told to stop
 * working is worse than not chasing at all.
 */
async function openStages() {
  const liveOrderIds = await O2dOrder.distinct('_id', { status: ORDER_STATUS.OPEN });
  return O2dOrderStage.find({
    order: { $in: liveOrderIds },
    status: { $in: OPEN_STATUSES, $nin: TERMINAL_STAGE_STATUSES },
    plannedCompletion: { $ne: null },
  }).lean();
}

/**
 * One pass.
 *
 * @param {Date} [now]  injectable, so the tests do not depend on the wall clock
 * @returns {Promise<{dueSoon: number, overdue: number, escalated: number, scanned: number}>}
 */
export async function runEscalationSweep({ now = new Date() } = {}) {
  const result = { scanned: 0, dueSoon: 0, overdue: 0, escalated: 0 };

  const stages = await openStages();
  result.scanned = stages.length;
  if (stages.length === 0) return result;

  const calendar = await loadCalendar({
    years: [...new Set(stages.map((s) => new Date(s.plannedCompletion).getUTCFullYear()))],
  });

  const escalateAfter = escalateAfterWorkingMinutes();

  for (const stage of stages) {
    const due = new Date(stage.plannedCompletion);
    const isOverdue = now > due;

    // ── overdue ──────────────────────────────────────────────────────────
    if (isOverdue) {
      if (!stage.overdueNotifiedAt) {
        await dispatchEvent(O2D_EVENTS.STAGE_OVERDUE, {
          orderId: stage.order,
          stageNumber: stage.stageNumber,
        });
        await O2dOrderStage.updateOne(
          { _id: stage._id },
          { $set: { overdueNotifiedAt: now, status: STAGE_STATUS.OVERDUE } },
        );
        result.overdue += 1;
        // Not escalated in the same pass: the grace period below is measured
        // from the deadline, and a stage that just went overdue has had none.
        continue;
      }

      // ── escalation ─────────────────────────────────────────────────────
      if (!stage.escalatedAt) {
        const lateBy = workingMinutesBetween(due, now, calendar);
        if (lateBy >= escalateAfter) {
          await dispatchEvent(
            O2D_EVENTS.STAGE_ESCALATED,
            { orderId: stage.order, stageNumber: stage.stageNumber, lateByWorkingMinutes: lateBy },
            // Routes to the stage's escalationRole rather than its owner.
            { escalate: true },
          );
          await O2dOrderStage.updateOne({ _id: stage._id }, { $set: { escalatedAt: now } });
          result.escalated += 1;
        }
      }
      continue;
    }

    // ── due soon ─────────────────────────────────────────────────────────
    if (!stage.dueSoonNotifiedAt && stage.plannedStart) {
      const start = new Date(stage.plannedStart).getTime();
      const span = due.getTime() - start;
      // A zero-length or inverted window cannot be "80% elapsed" in any
      // meaningful sense; treating it as due-soon would fire on every stage 1.
      if (span > 0 && (now.getTime() - start) / span >= DUE_SOON_THRESHOLD) {
        await dispatchEvent(O2D_EVENTS.STAGE_DUE_SOON, {
          orderId: stage.order,
          stageNumber: stage.stageNumber,
        });
        await O2dOrderStage.updateOne(
          { _id: stage._id },
          { $set: { dueSoonNotifiedAt: now, status: STAGE_STATUS.DUE_SOON } },
        );
        result.dueSoon += 1;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// The daily summary
// ---------------------------------------------------------------------------

/**
 * What the business looks like right now, in numbers.
 *
 * Exported separately from the send so a dashboard can call it, and so the
 * numbers in an email are the same numbers the screen shows rather than a
 * second, subtly different calculation.
 */
export async function summaryFigures({ now = new Date() } = {}) {
  const liveOrderIds = await O2dOrder.distinct('_id', { status: ORDER_STATUS.OPEN });

  const [openOrders, heldOrders, stages, dispatchedToday] = await Promise.all([
    O2dOrder.countDocuments({ status: ORDER_STATUS.OPEN }),
    O2dOrder.countDocuments({ status: ORDER_STATUS.ON_HOLD }),
    O2dOrderStage.find({
      order: { $in: liveOrderIds },
      status: { $in: OPEN_STATUSES },
      plannedCompletion: { $ne: null },
    })
      .select('stageNumber stageName ownerRole plannedCompletion')
      .lean(),
    O2dOrder.countDocuments({
      dispatchedAt: { $gte: startOfDay(now), $lte: now },
    }),
  ]);

  const overdue = stages.filter((s) => now > new Date(s.plannedCompletion));

  // "Which team is behind?" — the one question a daily summary should answer
  // that a count of overdue stages cannot.
  const byRole = overdue.reduce((acc, s) => {
    acc[s.ownerRole] = (acc[s.ownerRole] ?? 0) + 1;
    return acc;
  }, {});

  return {
    at: now,
    openOrders,
    heldOrders,
    openStages: stages.length,
    overdueStages: overdue.length,
    dispatchedToday,
    overdueByRole: byRole,
  };
}

/** Midnight IST — the business's day, not the server's. */
function startOfDay(at) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return new Date(`${parts}T00:00:00+05:30`);
}

/**
 * Send the daily summary.
 *
 * Goes to Management and Billing Head only — it is an oversight digest, and
 * sending it to everyone who works a stage would be a daily email about work
 * that is not theirs.
 *
 * A summary with nothing to report is NOT sent. A digest that arrives every day
 * saying "nothing is overdue" is one people stop opening, and then miss the day
 * it says something.
 */
export async function sendDailySummary({ now = new Date(), force = false } = {}) {
  const figures = await summaryFigures({ now });

  const worthSending =
    force || figures.overdueStages > 0 || figures.heldOrders > 0 || figures.dispatchedToday > 0;
  if (!worthSending) return { sent: false, reason: 'nothing to report', figures };

  const lines = [
    `${figures.openOrders} open order(s), ${figures.openStages} stage(s) in progress.`,
    figures.overdueStages > 0 ? `${figures.overdueStages} stage(s) overdue.` : null,
    figures.heldOrders > 0 ? `${figures.heldOrders} order(s) on hold.` : null,
    `${figures.dispatchedToday} order(s) dispatched today.`,
    Object.keys(figures.overdueByRole).length > 0
      ? `Overdue by team: ${Object.entries(figures.overdueByRole)
          .map(([role, n]) => `${role} ${n}`)
          .join(', ')}.`
      : null,
  ].filter(Boolean);

  const tally = await dispatchEvent(O2D_EVENTS.DAILY_SUMMARY, {
    // Dated, so a second run on the same day is deduped but tomorrow's is not.
    poNumber: `Summary ${startOfDay(now).toISOString().slice(0, 10)}`,
    summaryDate: startOfDay(now).toISOString().slice(0, 10),
    lines,
  });

  return { sent: tally.sent > 0, figures, lines, tally };
}

/**
 * Retry notifications that failed.
 *
 * Bounded by attempts, so a permanently bad address is tried a few times and
 * then left alone rather than retried forever. SKIPPED rows are NOT retried —
 * a disabled channel has not failed, and retrying it would mean every
 * notification is reattempted on every sweep for as long as email stays off.
 */
export async function retryFailed({ maxAttempts = 3, limit = 100 } = {}) {
  const rows = await O2dNotification.find({
    status: 'FAILED',
    attempts: { $lt: maxAttempts },
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  let sent = 0;
  for (const row of rows) {
    const { channelFor } = await import('./channels/index.js');
    const channel = channelFor(row.channel);
    if (!channel) continue;

    const result = await channel.send(row);
    row.attempts += 1;
    if (result.ok) {
      row.status = 'SENT';
      row.sentAt = new Date();
      sent += 1;
    } else {
      row.status = result.skipped ? 'SKIPPED' : 'FAILED';
      row.failureReason = result.detail ?? null;
    }
    await row.save();
  }

  return { attempted: rows.length, sent };
}

export default { runEscalationSweep, sendDailySummary, summaryFigures, retryFailed };
