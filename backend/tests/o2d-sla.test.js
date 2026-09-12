/**
 * The O2D SLA engine — deadlines, stage status, delay, holds and on-time %.
 *
 * Pure, like the calendar it sits on: the engine takes a stage record, a
 * calendar and a clock, so every boundary in §16, §18, §19 and §32 can be
 * exercised without a database.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildCalendar, dayOf, minuteOf } from '../modules/o2d/calendar.service.js';
import {
  plannedCompletion,
  applyHold,
  heldWorkingMinutes,
  evaluateStage,
  onTimePercentage,
} from '../modules/o2d/sla.service.js';
import { SLA_TYPES, STAGE_STATUS } from '../shared/constants/o2d.js';

const cal = buildCalendar({ holidays: new Set(['2026-09-17']) });

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
const show = (d) =>
  `${dayOf(d, cal.timeZone)} ${String(Math.floor(minuteOf(d, cal.timeZone) / 60)).padStart(2, '0')}:${String(minuteOf(d, cal.timeZone) % 60).padStart(2, '0')}`;

// ===========================================================================

describe('planned completion, per SLA type', () => {
  const start = ist('2026-09-14', '10:30'); // Monday, opening

  test('working minutes — the 5-minute PO handover', () => {
    const rule = { type: SLA_TYPES.WORKING_MINUTES, value: 5 };
    assert.equal(show(plannedCompletion(start, rule, cal)), '2026-09-14 10:35');
  });

  test('working hours — the 3-hour SOR+PI', () => {
    const rule = { type: SLA_TYPES.WORKING_HOURS, value: 3 };
    assert.equal(show(plannedCompletion(start, rule, cal)), '2026-09-14 13:30');
  });

  test('working hours that cross a night — the 12-hour invoice', () => {
    const rule = { type: SLA_TYPES.WORKING_HOURS, value: 12 };
    // 480 min Monday, 240 into Tuesday -> 14:30.
    assert.equal(show(plannedCompletion(start, rule, cal)), '2026-09-15 14:30');
  });

  test('calendar days — the 7-day advance window includes the weekend', () => {
    const rule = { type: SLA_TYPES.CALENDAR_DAYS, value: 7 };
    assert.equal(show(plannedCompletion(start, rule, cal)), '2026-09-21 10:30');
  });

  test('same day by — the 5:00 PM order-list cut', () => {
    const rule = { type: SLA_TYPES.SAME_DAY_BY, byMinute: 17 * 60 };
    assert.equal(show(plannedCompletion(start, rule, cal)), '2026-09-14 17:00');
  });

  test('same day by 6:30 PM — the dispatch cut', () => {
    const rule = { type: SLA_TYPES.SAME_DAY_BY, byMinute: 18 * 60 + 30 };
    assert.equal(show(plannedCompletion(start, rule, cal)), '2026-09-14 18:30');
  });

  test('next working day by — the 11:45 AM dispatch details', () => {
    const rule = { type: SLA_TYPES.NEXT_WORKING_DAY_BY, byMinute: 11 * 60 + 45 };
    assert.equal(show(plannedCompletion(start, rule, cal)), '2026-09-15 11:45');
  });

  test('a deadline type gives LESS time to a late start; a duration type does not', () => {
    // This is the reason both families exist, so it is asserted rather than
    // left to be rediscovered.
    const late = ist('2026-09-14', '16:30');
    const deadline = plannedCompletion(late, { type: SLA_TYPES.SAME_DAY_BY, byMinute: 17 * 60 }, cal);
    const duration = plannedCompletion(late, { type: SLA_TYPES.WORKING_HOURS, value: 3 }, cal);
    assert.equal(show(deadline), '2026-09-14 17:00', 'the 5pm cut does not move');
    assert.equal(show(duration), '2026-09-15 11:30', 'the 3-hour allowance follows the start');
  });

  test('an unknown or malformed rule is refused, not guessed at', () => {
    assert.throws(() => plannedCompletion(start, { type: 'WHENEVER' }, cal), /unknown SLA type/);
    assert.throws(() => plannedCompletion(start, { type: SLA_TYPES.WORKING_HOURS }, cal), TypeError);
    assert.throws(() => plannedCompletion(start, null, cal), TypeError);
  });
});

describe('stage status', () => {
  const rule = { type: SLA_TYPES.WORKING_HOURS, value: 4 };
  const open = {
    status: STAGE_STATUS.PENDING,
    sla: rule,
    plannedStart: ist('2026-09-14', '10:30'),
    plannedCompletion: ist('2026-09-14', '14:30'),
  };

  test('PENDING while comfortably inside the budget', () => {
    const r = evaluateStage(open, { calendar: cal, now: ist('2026-09-14', '11:00') });
    assert.equal(r.status, STAGE_STATUS.PENDING);
    assert.equal(r.delayMinutes, 0);
    assert.equal(r.remainingMinutes, 210);
  });

  test('DUE_SOON once 80% of the budget is consumed', () => {
    // 4h budget; 80% is 3h12m, i.e. 13:42.
    assert.equal(
      evaluateStage(open, { calendar: cal, now: ist('2026-09-14', '13:41') }).status,
      STAGE_STATUS.PENDING,
    );
    assert.equal(
      evaluateStage(open, { calendar: cal, now: ist('2026-09-14', '13:42') }).status,
      STAGE_STATUS.DUE_SOON,
    );
  });

  test('OVERDUE past the deadline, with the delay in WORKING minutes', () => {
    // Due 14:30 Monday; measured at 11:00 Tuesday. Wall clock is 20h30;
    // working time is 4h (14:30–18:30) + 30m (10:30–11:00) = 270.
    const r = evaluateStage(open, { calendar: cal, now: ist('2026-09-15', '11:00') });
    assert.equal(r.status, STAGE_STATUS.OVERDUE);
    assert.equal(r.delayMinutes, 270, 'the night must not count as delay');
  });

  test('DONE_ON_TIME when completed before the deadline', () => {
    const done = { ...open, actualCompletion: ist('2026-09-14', '14:00') };
    const r = evaluateStage(done, { calendar: cal, now: ist('2026-09-30', '10:00') });
    assert.equal(r.status, STAGE_STATUS.DONE_ON_TIME);
    assert.equal(r.delayMinutes, 0);
  });

  test('exactly on the deadline is ON TIME, not late', () => {
    const done = { ...open, actualCompletion: ist('2026-09-14', '14:30') };
    assert.equal(
      evaluateStage(done, { calendar: cal, now: ist('2026-09-14', '15:00') }).status,
      STAGE_STATUS.DONE_ON_TIME,
    );
  });

  test('DONE_LATE carries the working-minute delay', () => {
    const done = { ...open, actualCompletion: ist('2026-09-14', '14:33') };
    const r = evaluateStage(done, { calendar: cal, now: ist('2026-09-14', '15:00') });
    assert.equal(r.status, STAGE_STATUS.DONE_LATE);
    assert.equal(r.delayMinutes, 3);
  });

  test('a completed stage never changes status as time passes', () => {
    // The KPI must not drift because nobody touched anything.
    const done = { ...open, actualCompletion: ist('2026-09-14', '14:00') };
    const soon = evaluateStage(done, { calendar: cal, now: ist('2026-09-14', '15:00') });
    const later = evaluateStage(done, { calendar: cal, now: ist('2027-01-01', '15:00') });
    assert.equal(soon.status, later.status);
    assert.equal(soon.delayMinutes, later.delayMinutes);
  });

  test('a LOCKED stage is never overdue — it is not its owner\'s problem yet', () => {
    const locked = { ...open, status: STAGE_STATUS.LOCKED };
    const r = evaluateStage(locked, { calendar: cal, now: ist('2026-09-30', '10:00') });
    assert.equal(r.status, STAGE_STATUS.LOCKED);
    assert.equal(r.delayMinutes, 0);
  });

  test('a SKIPPED stage stays skipped and carries no delay', () => {
    const skipped = { ...open, status: STAGE_STATUS.SKIPPED };
    const r = evaluateStage(skipped, { calendar: cal, now: ist('2026-12-31', '10:00') });
    assert.equal(r.status, STAGE_STATUS.SKIPPED);
    assert.equal(r.delayMinutes, 0);
  });
});

describe('holds pause the clock', () => {
  const rule = { type: SLA_TYPES.WORKING_HOURS, value: 4 };
  const open = {
    status: STAGE_STATUS.PENDING,
    sla: rule,
    plannedStart: ist('2026-09-14', '10:30'),
    plannedCompletion: ist('2026-09-14', '14:30'),
  };

  test('held working minutes count only open time', () => {
    // Friday 18:00 -> Monday 11:00: 30 min Friday + 480 Saturday + 30 Monday.
    const holds = [{ startedAt: ist('2026-09-18', '18:00'), resumedAt: ist('2026-09-21', '11:00') }];
    assert.equal(heldWorkingMinutes(holds, cal), 540);
  });

  test('an open hold is counted up to now', () => {
    const holds = [{ startedAt: ist('2026-09-14', '11:00'), resumedAt: null }];
    assert.equal(heldWorkingMinutes(holds, cal, ist('2026-09-14', '12:00')), 60);
  });

  test('a hold pushes the deadline out by the frozen working time', () => {
    const holds = [{ startedAt: ist('2026-09-14', '11:00'), resumedAt: ist('2026-09-14', '13:00') }];
    const r = evaluateStage(open, { calendar: cal, now: ist('2026-09-14', '15:00'), holds });
    // 2 held hours move a 14:30 deadline to 16:30, so 15:00 is not late.
    assert.equal(show(r.dueAt), '2026-09-14 16:30');
    assert.notEqual(r.status, STAGE_STATUS.OVERDUE);
  });

  test('without the hold, that same moment WOULD be overdue', () => {
    const r = evaluateStage(open, { calendar: cal, now: ist('2026-09-14', '15:00') });
    assert.equal(r.status, STAGE_STATUS.OVERDUE);
  });

  test('a held stage reports ON_HOLD rather than accruing delay', () => {
    const held = { ...open, status: STAGE_STATUS.ON_HOLD };
    const r = evaluateStage(held, { calendar: cal, now: ist('2026-09-30', '10:00') });
    assert.equal(r.status, STAGE_STATUS.ON_HOLD);
    assert.equal(r.delayMinutes, 0);
  });

  test('a hold does NOT extend a calendar-day SLA', () => {
    // The 7-day advance window is a promise about the customer's bank. Our
    // internal pause does not give them more time.
    const advance = {
      status: STAGE_STATUS.PENDING,
      sla: { type: SLA_TYPES.CALENDAR_DAYS, value: 7 },
      plannedStart: ist('2026-09-14', '10:30'),
      plannedCompletion: ist('2026-09-21', '10:30'),
    };
    const holds = [{ startedAt: ist('2026-09-15', '11:00'), resumedAt: ist('2026-09-16', '11:00') }];
    const r = evaluateStage(advance, { calendar: cal, now: ist('2026-09-18', '12:00'), holds });
    assert.equal(show(r.dueAt), '2026-09-21 10:30', 'the customer deadline must not move');
  });

  test('applyHold leaves a deadline alone when nothing was held', () => {
    const due = ist('2026-09-14', '14:30');
    assert.equal(applyHold(due, { type: SLA_TYPES.WORKING_HOURS }, 0, cal).getTime(), due.getTime());
  });
});

describe('the stored plan is authoritative', () => {
  test('a stored plannedCompletion is used, not recomputed', () => {
    // §48: historical planned values must not move. A later change to the SLA
    // master must not re-judge work already done.
    const stage = {
      status: STAGE_STATUS.PENDING,
      sla: { type: SLA_TYPES.WORKING_HOURS, value: 99 }, // would give a far later date
      plannedStart: ist('2026-09-14', '10:30'),
      plannedCompletion: ist('2026-09-14', '12:00'),     // what the owner was told
    };
    const r = evaluateStage(stage, { calendar: cal, now: ist('2026-09-14', '11:00') });
    assert.equal(show(r.dueAt), '2026-09-14 12:00');
  });

  test('with no stored plan it falls back to computing one', () => {
    const stage = {
      status: STAGE_STATUS.PENDING,
      sla: { type: SLA_TYPES.WORKING_HOURS, value: 2 },
      plannedStart: ist('2026-09-14', '10:30'),
    };
    const r = evaluateStage(stage, { calendar: cal, now: ist('2026-09-14', '11:00') });
    assert.equal(show(r.dueAt), '2026-09-14 12:30');
  });
});

describe('on-time percentage', () => {
  const s = (status) => ({ status });

  test('skipped stages are excluded from BOTH halves of the fraction', () => {
    // 3 on time, 1 late, 4 skipped -> 75%, not 37.5% and not 87.5%.
    const stages = [
      s(STAGE_STATUS.DONE_ON_TIME), s(STAGE_STATUS.DONE_ON_TIME),
      s(STAGE_STATUS.DONE_ON_TIME), s(STAGE_STATUS.DONE_LATE),
      s(STAGE_STATUS.SKIPPED), s(STAGE_STATUS.SKIPPED),
      s(STAGE_STATUS.SKIPPED), s(STAGE_STATUS.SKIPPED),
    ];
    assert.equal(onTimePercentage(stages), 75);
  });

  test('open stages do not count either — they have no completion to judge', () => {
    const stages = [
      s(STAGE_STATUS.DONE_ON_TIME),
      s(STAGE_STATUS.OVERDUE), s(STAGE_STATUS.PENDING), s(STAGE_STATUS.LOCKED),
    ];
    assert.equal(onTimePercentage(stages), 100);
  });

  test('nothing completed yields null, not zero', () => {
    // "No data yet" and "everything was late" are different facts.
    assert.equal(onTimePercentage([s(STAGE_STATUS.PENDING), s(STAGE_STATUS.SKIPPED)]), null);
    assert.equal(onTimePercentage([]), null);
  });

  test('all late is 0, and that is distinct from null', () => {
    assert.equal(onTimePercentage([s(STAGE_STATUS.DONE_LATE)]), 0);
  });
});
