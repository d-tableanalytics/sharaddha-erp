/**
 * The SLA engine — deadlines, status and delay, in one place.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY SLA QUESTION IS ANSWERED HERE
 * ---------------------------------------------------------------------------
 *
 * §17: "All calendar calculations must happen in one centralized SLA/Calendar
 * service. Do not duplicate SLA calculations throughout controllers/components."
 *
 * That is not tidiness. A deadline computed in a controller and a deadline
 * computed in a dashboard will eventually disagree, and when they do, the
 * employee is told one thing and judged by another. The engine below is the only
 * thing that may decide whether a stage is late.
 *
 * It is also PURE. It takes a stage record, a calendar and a clock, and returns
 * values; it reads no database and writes nothing. That is what makes the
 * boundary cases testable without a mongod, and what lets the tracker recompute
 * a hundred rows without a hundred queries.
 *
 * ---------------------------------------------------------------------------
 * HOLD TIME IS NOT THE OWNER'S DELAY
 * ---------------------------------------------------------------------------
 *
 * §19: when an order is on hold the SLA clock pauses. Held time is therefore
 * subtracted from the elapsed figure before anything is judged — an order parked
 * for three days at the customer's request must not make the billing team look
 * three days slow. The deadline itself is pushed out by the same amount, so a
 * resumed order gets back exactly the working time it had left.
 */

import {
  addWorkingMinutes,
  workingMinutesBetween,
  addWorkingDays,
  addCalendarDays,
  sameDayAt,
  nextWorkingDayAt,
  alignToWorkingTime,
} from './calendar.service.js';
import {
  SLA_TYPES,
  STAGE_STATUS,
  TERMINAL_STAGE_STATUSES,
  DUE_SOON_THRESHOLD,
  WORKING_SLA_TYPES,
} from '../../shared/constants/o2d.js';

/**
 * @typedef {object} SlaRule
 * @property {string} type    one of SLA_TYPES
 * @property {number} [value] duration, for the duration types
 * @property {number} [byMinute] minutes from midnight, for the deadline types
 */

/**
 * When a stage started with this rule is due.
 *
 * The two families behave differently and the difference is the whole point of
 * having six types rather than one number:
 *
 *   DURATION   ("5 working minutes", "7 calendar days") — measured FROM the
 *              start, so a stage that starts late is due late. The owner gets
 *              their full allowance however late the handover reached them.
 *   DEADLINE   ("same day by 5:00 PM") — a clock time, so a stage that starts
 *              late has LESS time. That is intended: the 5:00 PM order-list cut
 *              exists because of what happens after 5:00 PM, not because the
 *              task takes all afternoon.
 *
 * @param {Date} start
 * @param {SlaRule} rule
 * @param {object} calendar
 * @returns {Date}
 */
export function plannedCompletion(start, rule, calendar) {
  if (!rule?.type) throw new TypeError('plannedCompletion: an SLA rule with a type is required');
  const { type, value, byMinute } = rule;

  switch (type) {
    case SLA_TYPES.WORKING_MINUTES:
      return addWorkingMinutes(start, num(value, type), calendar);

    case SLA_TYPES.WORKING_HOURS:
      return addWorkingMinutes(start, num(value, type) * 60, calendar);

    case SLA_TYPES.WORKING_DAYS:
      return addWorkingDays(start, num(value, type), calendar);

    case SLA_TYPES.CALENDAR_DAYS:
      return addCalendarDays(start, num(value, type), calendar);

    case SLA_TYPES.SAME_DAY_BY:
      return sameDayAt(start, num(byMinute, type), calendar);

    case SLA_TYPES.NEXT_WORKING_DAY_BY:
      return nextWorkingDayAt(start, num(byMinute, type), calendar);

    default:
      throw new TypeError(`plannedCompletion: unknown SLA type "${type}"`);
  }
}

const num = (v, type) => {
  if (!Number.isFinite(v) || v < 0) {
    throw new TypeError(`SLA type ${type} needs a non-negative number, received ${v}`);
  }
  return v;
};

/**
 * Push a deadline out by the working time an order spent on hold.
 *
 * A hold pauses the clock, so the deadline moves by exactly the open minutes
 * that were frozen — not by the wall-clock duration of the hold, which would
 * over-credit a hold placed on a Friday evening.
 *
 * CALENDAR_DAYS deadlines are NOT extended: a seven-day advance window is a
 * promise to a customer about their own bank, and pausing our internal clock
 * does not give them more time. Only working-time SLAs are the owner's to be
 * protected from.
 */
export function applyHold(planned, rule, heldWorkingMinutes, calendar) {
  if (!heldWorkingMinutes) return planned;
  if (!WORKING_SLA_TYPES.includes(rule?.type)) return planned;
  return addWorkingMinutes(planned, heldWorkingMinutes, calendar);
}

/**
 * Total working minutes an order spent on hold, from its hold history.
 *
 * An OPEN hold (no resume yet) is counted up to `now`, so a stage sitting under
 * a live hold does not silently accrue delay while it waits.
 */
export function heldWorkingMinutes(holds = [], calendar, now = new Date()) {
  let total = 0;
  for (const hold of holds) {
    if (!hold?.startedAt) continue;
    const from = new Date(hold.startedAt);
    const to = hold.resumedAt ? new Date(hold.resumedAt) : now;
    total += workingMinutesBetween(from, to, calendar);
  }
  return total;
}

/**
 * Where a stage stands right now.
 *
 * Order of the checks is deliberate and load-bearing:
 *
 *   1. SKIPPED and completed states are FINAL. A completed stage's status must
 *      never drift because time passed — a stage done on time in March is still
 *      done on time in December, and a KPI that changes when nobody touched
 *      anything is not a KPI.
 *   2. LOCKED beats everything unfinished: a stage whose predecessor is not done
 *      cannot be overdue, because its owner has not been given the work yet.
 *      Marking it overdue would blame them for someone else's delay.
 *   3. ON_HOLD beats OVERDUE, for the same reason.
 *
 * @returns {{status: string, dueAt: Date|null, remainingMinutes: number|null,
 *           delayMinutes: number, consumed: number|null}}
 */
export function evaluateStage(stage, { calendar, now = new Date(), holds = [] } = {}) {
  const rule = stage.sla;

  // 1. Finished, and therefore frozen.
  if (stage.status === STAGE_STATUS.SKIPPED) {
    return frozen(STAGE_STATUS.SKIPPED);
  }
  if (stage.actualCompletion) {
    const held = heldWorkingMinutes(holds, calendar, now);
    const dueAt = dueFor(stage, rule, calendar, held);
    const actual = new Date(stage.actualCompletion);
    const late = dueAt ? workingMinutesBetween(dueAt, actual, calendar) : 0;
    return {
      status: late > 0 ? STAGE_STATUS.DONE_LATE : STAGE_STATUS.DONE_ON_TIME,
      dueAt,
      remainingMinutes: null,
      delayMinutes: late,
      consumed: null,
    };
  }

  // 2. Not yet this owner's problem.
  if (stage.status === STAGE_STATUS.LOCKED || !stage.plannedStart) {
    return frozen(STAGE_STATUS.LOCKED);
  }

  // 3. The clock is paused.
  if (stage.status === STAGE_STATUS.ON_HOLD) {
    const dueAt = dueFor(stage, rule, calendar, heldWorkingMinutes(holds, calendar, now));
    return { status: STAGE_STATUS.ON_HOLD, dueAt, remainingMinutes: null, delayMinutes: 0, consumed: null };
  }

  // Open, and the clock is running.
  const held = heldWorkingMinutes(holds, calendar, now);
  const dueAt = dueFor(stage, rule, calendar, held);
  if (!dueAt) return frozen(STAGE_STATUS.PENDING);

  const overdueBy = workingMinutesBetween(dueAt, now, calendar);
  if (overdueBy > 0) {
    return {
      status: STAGE_STATUS.OVERDUE,
      dueAt,
      remainingMinutes: 0,
      delayMinutes: overdueBy,
      consumed: 1,
    };
  }

  const start = alignToWorkingTime(new Date(stage.plannedStart), calendar);
  const budget = workingMinutesBetween(start, dueAt, calendar);
  const used = workingMinutesBetween(start, now, calendar);
  const consumed = budget > 0 ? used / budget : 1;

  return {
    status: consumed >= DUE_SOON_THRESHOLD ? STAGE_STATUS.DUE_SOON : STAGE_STATUS.PENDING,
    dueAt,
    remainingMinutes: Math.max(0, budget - used),
    delayMinutes: 0,
    consumed,
  };
}

const frozen = (status) => ({
  status,
  dueAt: null,
  remainingMinutes: null,
  delayMinutes: 0,
  consumed: null,
});

/**
 * The effective deadline: the stored plan, or one computed from the start.
 *
 * A STORED `plannedCompletion` wins. It is written once when the stage unlocks
 * and is what the owner was told, so recomputing it on every read would let a
 * later change to the SLA master silently re-judge work already done — and §48
 * is explicit that historical planned values must not move.
 */
function dueFor(stage, rule, calendar, heldMinutes) {
  const base = stage.plannedCompletion
    ? new Date(stage.plannedCompletion)
    : stage.plannedStart && rule
      ? plannedCompletion(new Date(stage.plannedStart), rule, calendar)
      : null;
  if (!base) return null;
  return applyHold(base, rule, heldMinutes, calendar);
}

/**
 * On-time percentage across a set of stages.
 *
 * §32: SKIPPED stages are excluded from BOTH halves of the fraction. A stage
 * that was never required is not a success and not a failure, and counting it
 * either way would let a department move its score by changing how many advance
 * orders it takes.
 *
 * Returns null rather than 0 when nothing qualifies — "no completed stages yet"
 * and "everything was late" are different facts, and a dashboard showing 0%
 * for a brand-new month is simply wrong.
 */
export function onTimePercentage(stages = []) {
  const counted = stages.filter(
    (s) => s.status === STAGE_STATUS.DONE_ON_TIME || s.status === STAGE_STATUS.DONE_LATE,
  );
  if (counted.length === 0) return null;
  const onTime = counted.filter((s) => s.status === STAGE_STATUS.DONE_ON_TIME).length;
  return Math.round((onTime / counted.length) * 1000) / 10;
}

/** Is this stage finished, by any route? */
export const isTerminal = (stage) => TERMINAL_STAGE_STATUSES.includes(stage?.status);

export default {
  plannedCompletion,
  applyHold,
  heldWorkingMinutes,
  evaluateStage,
  onTimePercentage,
  isTerminal,
};
