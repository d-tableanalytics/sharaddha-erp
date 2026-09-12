/**
 * The O2D working calendar.
 *
 * §17 of the brief names the failure this file exists to prevent: twelve working
 * hours from Monday 5:00 PM must NOT become Tuesday 5:00 AM. Every case below is
 * either that trap or one of the boundaries §50 asks for by name — the 10:30
 * open, the 18:30 close, Saturday, Sunday, holidays.
 *
 * Pure: no database, no mongod. The calendar takes its holidays as a Set, which
 * is what makes it testable without one.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCalendar,
  isWorkingDay,
  nextWorkingDay,
  alignToWorkingTime,
  addWorkingMinutes,
  workingMinutesBetween,
  addWorkingDays,
  addCalendarDays,
  sameDayAt,
  nextWorkingDayAt,
  dayOf,
  minuteOf,
  weekdayOf,
} from '../modules/o2d/calendar.service.js';

/** The office: 10:30–18:30 IST, Mon–Sat, with two holidays. */
const cal = buildCalendar({
  holidays: new Set(['2026-09-17', '2026-10-02']),
});

/** An IST wall clock reading as an instant. 2026-09-14 is a Monday. */
const ist = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  // IST is UTC+5:30 and has no DST, so the offset is a constant here. The
  // calendar itself never assumes that — see instantAt() — but a test fixture
  // may, and it keeps these readable.
  return new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`);
};

/** Render an instant back to IST wall clock, for readable assertions. */
const show = (d) => `${dayOf(d, cal.timeZone)} ${String(Math.floor(minuteOf(d, cal.timeZone) / 60)).padStart(2, '0')}:${String(minuteOf(d, cal.timeZone) % 60).padStart(2, '0')}`;

// ===========================================================================

describe('which days the office is open', () => {
  test('Monday to Saturday are open, Sunday is not', () => {
    assert.equal(weekdayOf('2026-09-14'), 1, '2026-09-14 must be a Monday');
    assert.equal(isWorkingDay('2026-09-14', cal), true);  // Mon
    assert.equal(isWorkingDay('2026-09-19', cal), true);  // Sat — OPEN here
    assert.equal(isWorkingDay('2026-09-20', cal), false); // Sun
  });

  test('Saturday being open is an O2D rule, not the HRMS weekend rule', () => {
    // shared/leave/dates.js treats Saturday as a weekend, because that is a
    // LEAVE entitlement question. Dispatch works Saturdays. The two must not be
    // collapsed into one helper.
    assert.equal(isWorkingDay('2026-09-19', cal), true);
  });

  test('a configured holiday closes the office even on a weekday', () => {
    assert.equal(weekdayOf('2026-09-17'), 4, 'the fixture holiday must be a Thursday');
    assert.equal(isWorkingDay('2026-09-17', cal), false);
  });

  test('nextWorkingDay steps over Sunday, and over a holiday', () => {
    assert.equal(nextWorkingDay('2026-09-20', cal), '2026-09-21'); // Sun -> Mon
    assert.equal(nextWorkingDay('2026-09-17', cal), '2026-09-18'); // holiday -> Fri
    assert.equal(nextWorkingDay('2026-09-14', cal), '2026-09-14'); // already open
  });
});

describe('aligning an instant into working time', () => {
  test('before opening moves to 10:30 the same day', () => {
    assert.equal(show(alignToWorkingTime(ist('2026-09-14', '07:00'), cal)), '2026-09-14 10:30');
  });

  test('inside the window is left exactly alone', () => {
    const mid = ist('2026-09-14', '14:20');
    assert.equal(alignToWorkingTime(mid, cal).getTime(), mid.getTime());
  });

  test('after closing moves to the next open morning, not later the same night', () => {
    assert.equal(show(alignToWorkingTime(ist('2026-09-14', '19:30'), cal)), '2026-09-15 10:30');
  });

  test('exactly at close counts as closed', () => {
    // 18:30 is the end of the window, not a moment inside it.
    assert.equal(show(alignToWorkingTime(ist('2026-09-14', '18:30'), cal)), '2026-09-15 10:30');
  });

  test('Sunday moves to Monday morning', () => {
    assert.equal(show(alignToWorkingTime(ist('2026-09-20', '12:00'), cal)), '2026-09-21 10:30');
  });

  test('Saturday evening moves to MONDAY, stepping over Sunday', () => {
    assert.equal(show(alignToWorkingTime(ist('2026-09-19', '20:00'), cal)), '2026-09-21 10:30');
  });
});

describe('adding working minutes — the §17 trap', () => {
  test('THE named case: Monday 17:00 + 12 working hours is NOT Tuesday 05:00', () => {
    const out = addWorkingMinutes(ist('2026-09-14', '17:00'), 12 * 60, cal);
    // 90 min left Monday, 480 Tuesday, 150 into Wednesday -> 13:00.
    assert.equal(show(out), '2026-09-16 13:00');
    assert.notEqual(show(out), '2026-09-15 05:00', 'plain date addition would land here');
  });

  test('a 5-minute SLA inside the day is just five minutes later', () => {
    assert.equal(show(addWorkingMinutes(ist('2026-09-14', '11:00'), 5, cal)), '2026-09-14 11:05');
  });

  test('5 minutes started at 18:28 spills to the next morning', () => {
    // Two minutes left today; the remaining three are tomorrow's.
    assert.equal(show(addWorkingMinutes(ist('2026-09-14', '18:28'), 5, cal)), '2026-09-15 10:33');
  });

  test('landing exactly on closing time stays at closing time', () => {
    // 18:30 is a deadline the owner could meet; reporting 10:30 tomorrow would
    // mark work done at 18:29 as early against the wrong day.
    assert.equal(show(addWorkingMinutes(ist('2026-09-14', '17:30'), 60, cal)), '2026-09-14 18:30');
  });

  test('3 working hours from a Saturday afternoon lands on Monday', () => {
    // Sat 17:00: 90 min left, then Sunday is skipped, 90 min into Monday.
    assert.equal(show(addWorkingMinutes(ist('2026-09-19', '17:00'), 3 * 60, cal)), '2026-09-21 12:00');
  });

  test('a holiday is skipped like a Sunday', () => {
    // Wed 2026-09-16 18:00, +2h. 30 min left Wed; Thu 17th is a holiday; the
    // remaining 90 min fall on Friday.
    assert.equal(show(addWorkingMinutes(ist('2026-09-16', '18:00'), 120, cal)), '2026-09-18 12:00');
  });

  test('a start before opening is not credited with the morning it missed', () => {
    // 08:00 is not working time; the clock starts at 10:30.
    assert.equal(show(addWorkingMinutes(ist('2026-09-14', '08:00'), 60, cal)), '2026-09-14 11:30');
  });

  test('zero minutes resolves to the start, not the end of the day', () => {
    assert.equal(show(addWorkingMinutes(ist('2026-09-14', '11:00'), 0, cal)), '2026-09-14 11:00');
  });

  test('a long SLA crosses several weeks correctly', () => {
    // 10 working days of 480 minutes, from Monday 10:30.
    const out = addWorkingMinutes(ist('2026-09-14', '10:30'), 10 * 480, cal);
    // Mon 14 → Sat 19 is 6 days, Sun skipped, Mon 21 → Thu 24 is 4 more. The
    // 17th is a holiday, so one extra day is consumed: lands Fri 25th.
    assert.equal(show(out), '2026-09-25 18:30');
  });

  test('a negative SLA is refused rather than silently walked backwards', () => {
    assert.throws(() => addWorkingMinutes(ist('2026-09-14', '11:00'), -5, cal), TypeError);
  });
});

describe('measuring working minutes between two instants', () => {
  test('within one day it is the plain difference', () => {
    assert.equal(workingMinutesBetween(ist('2026-09-14', '11:00'), ist('2026-09-14', '11:45'), cal), 45);
  });

  test('overnight counts only the open minutes', () => {
    // 18:00 Mon -> 11:00 Tue: 30 min Monday + 30 min Tuesday = 60, not 17 hours.
    assert.equal(workingMinutesBetween(ist('2026-09-14', '18:00'), ist('2026-09-15', '11:00'), cal), 60);
  });

  test('a weekend contributes nothing', () => {
    // Sat 18:00 -> Mon 11:00: 30 min Saturday + 30 min Monday.
    assert.equal(workingMinutesBetween(ist('2026-09-19', '18:00'), ist('2026-09-21', '11:00'), cal), 60);
  });

  test('it is the exact inverse of adding', () => {
    const start = ist('2026-09-14', '17:00');
    for (const mins of [5, 60, 200, 720, 1500]) {
      const end = addWorkingMinutes(start, mins, cal);
      assert.equal(workingMinutesBetween(start, end, cal), mins, `round trip failed at ${mins}`);
    }
  });

  test('a backwards span is zero, never negative', () => {
    assert.equal(workingMinutesBetween(ist('2026-09-15', '11:00'), ist('2026-09-14', '11:00'), cal), 0);
  });

  test('time entirely outside the window is zero', () => {
    assert.equal(workingMinutesBetween(ist('2026-09-20', '09:00'), ist('2026-09-20', '23:00'), cal), 0);
  });
});

describe('the other SLA shapes', () => {
  test('calendar days include the weekend — a bank does not keep our hours', () => {
    // Mon 14th + 7 calendar days = Mon 21st, not two weeks later.
    assert.equal(show(addCalendarDays(ist('2026-09-14', '11:00'), 7, cal)), '2026-09-21 11:00');
  });

  test('a calendar deadline landing on a Sunday is pulled to Monday morning', () => {
    // Sun 20th cannot be met, and must not mark the owner late for it.
    assert.equal(show(addCalendarDays(ist('2026-09-13', '11:00'), 7, cal)), '2026-09-21 10:30');
  });

  test('working days land at the same clock time on a later open day', () => {
    assert.equal(show(addWorkingDays(ist('2026-09-14', '14:00'), 2, cal)), '2026-09-16 14:00');
  });

  test('same-day-by gives a clock time today', () => {
    assert.equal(show(sameDayAt(ist('2026-09-14', '11:00'), 17 * 60, cal)), '2026-09-14 17:00');
  });

  test('same-day-by on a closed day moves to the next open day', () => {
    assert.equal(show(sameDayAt(ist('2026-09-20', '11:00'), 17 * 60, cal)), '2026-09-21 17:00');
  });

  test('next-working-day-by steps over Sunday', () => {
    // Saturday's "next working day" is Monday.
    assert.equal(show(nextWorkingDayAt(ist('2026-09-19', '15:00'), 11 * 60 + 45, cal)), '2026-09-21 11:45');
  });

  test('next-working-day-by steps over a holiday', () => {
    // Wed 16th -> Thu 17th is a holiday -> Friday.
    assert.equal(show(nextWorkingDayAt(ist('2026-09-16', '15:00'), 11 * 60 + 45, cal)), '2026-09-18 11:45');
  });
});

describe('timezone safety', () => {
  test('the same instant expressed in UTC yields the same IST deadline', () => {
    // 2026-09-14 17:00 IST is 11:30 UTC. A server running in UTC must compute
    // the identical answer, or every deadline shifts by 5h30 on deployment.
    const viaIst = addWorkingMinutes(ist('2026-09-14', '17:00'), 720, cal);
    const viaUtc = addWorkingMinutes(new Date('2026-09-14T11:30:00Z'), 720, cal);
    assert.equal(viaUtc.getTime(), viaIst.getTime());
  });

  test('an office in another timezone keeps its own window', () => {
    const london = buildCalendar({ timeZone: 'Europe/London' });
    // 09:00 UTC on 2026-09-14 is 10:00 BST — before a 10:30 open.
    assert.equal(
      dayOf(alignToWorkingTime(new Date('2026-09-14T09:00:00Z'), london), 'Europe/London'),
      '2026-09-14',
    );
    assert.equal(minuteOf(alignToWorkingTime(new Date('2026-09-14T09:00:00Z'), london), 'Europe/London'), 630);
  });
});

describe('configuration guards', () => {
  test('a window that closes before it opens is refused', () => {
    assert.throws(() => buildCalendar({ startMinute: 1110, endMinute: 630 }), /close after it opens/);
  });

  test('a calendar with no open weekday raises rather than hanging', () => {
    const shut = buildCalendar({ workingWeekdays: [] });
    assert.throws(() => nextWorkingDay('2026-09-14', shut), /no working day/);
  });
});
