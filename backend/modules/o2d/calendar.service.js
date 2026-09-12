/**
 * The working calendar — the only place in O2D that knows when the office is open.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `date + 12 hours`
 * ---------------------------------------------------------------------------
 *
 * §17 of the brief names the failure directly: twelve working hours from Monday
 * 5:00 PM must not become Tuesday 5:00 AM. Plain date arithmetic counts the
 * eighteen hours the building is locked, so every deadline computed that way is
 * wrong in the direction that blames an employee for the night.
 *
 * So time here is measured in OPEN MINUTES. Adding a working duration means
 * walking forward through the calendar consuming only minutes inside the window,
 * skipping closed days entirely, and landing on a real moment someone could have
 * been at their desk.
 *
 * ---------------------------------------------------------------------------
 * TIMEZONE
 * ---------------------------------------------------------------------------
 *
 * A `Date` is an instant; "10:30" is a wall-clock reading in a place. The office
 * is in Asia/Kolkata, and the server may not be, so every conversion goes
 * through `Intl.DateTimeFormat` with an explicit zone rather than through
 * `getHours()`, which silently answers in the server's own zone. A deployment
 * moved to a UTC host would otherwise shift every deadline by five and a half
 * hours without a single line changing.
 *
 * ---------------------------------------------------------------------------
 * HOLIDAYS COME FROM HRMS
 * ---------------------------------------------------------------------------
 *
 * There is already a holiday calendar in this repository — `models/hrms/Holiday.js`,
 * maintained through the HRMS leave module, with `holidayDateSet(years)` ready
 * to hand. O2D reads it rather than growing a second list, because two holiday
 * calendars in one company is a guarantee that one of them is wrong on
 * Independence Day.
 */

import { holidayDateSet } from '../hrms/leave/holiday.service.js';
import { DEFAULT_TIME_ZONE } from '../../shared/constants/timezones.js';
import {
  DEFAULT_WORKDAY_START_MINUTE,
  DEFAULT_WORKDAY_END_MINUTE,
  DEFAULT_WORKING_WEEKDAYS,
} from '../../shared/constants/o2d.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// ---------------------------------------------------------------------------
// Timezone-safe conversions
// ---------------------------------------------------------------------------

/**
 * The wall-clock parts of an instant, in the office's timezone.
 *
 * `formatToParts` rather than `toLocaleString` + parsing: the parts are typed
 * and locale-independent, so no format string has to be reverse-engineered.
 */
const partsIn = (date, timeZone) => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const out = {};
  for (const { type, value } of fmt.formatToParts(date)) {
    if (type !== 'literal') out[type] = value;
  }
  return {
    day: `${out.year}-${out.month}-${out.day}`,
    minute: Number(out.hour) * 60 + Number(out.minute),
    second: Number(out.second),
  };
};

/**
 * The instant at which a given wall-clock day and minute occur in a timezone.
 *
 * Solved by correction rather than by a timezone library: guess the instant as
 * though the zone were UTC, read back what wall clock that guess actually lands
 * on, and shift by the difference. One correction is enough for every fixed
 * offset; the second pass covers a guess that lands on the far side of a DST
 * boundary. India has no DST, so the second pass is belt-and-braces for a
 * deployment that later configures another zone.
 */
const instantAt = (dayIso, minuteOfDay, timeZone) => {
  const [y, m, d] = dayIso.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);

  for (let pass = 0; pass < 2; pass += 1) {
    const seen = partsIn(new Date(guess), timeZone);
    const wantedMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + minuteOfDay * MINUTE_MS;
    const [sy, sm, sd] = seen.day.split('-').map(Number);
    const seenMs = Date.UTC(sy, sm - 1, sd, 0, 0, 0, 0) + seen.minute * MINUTE_MS;
    const drift = wantedMs - seenMs;
    if (drift === 0) break;
    guess += drift;
  }
  return new Date(guess);
};

/** `YYYY-MM-DD` for an instant, in the office's timezone. */
export const dayOf = (date, timeZone = DEFAULT_TIME_ZONE) => partsIn(date, timeZone).day;

/** Minutes since local midnight for an instant. */
export const minuteOf = (date, timeZone = DEFAULT_TIME_ZONE) => partsIn(date, timeZone).minute;

/** The next calendar day, as `YYYY-MM-DD`. Pure string/UTC maths, no zone. */
export const nextDay = (dayIso) => {
  const [y, m, d] = dayIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + DAY_MS).toISOString().slice(0, 10);
};

/** Day of week for a `YYYY-MM-DD`, Sunday = 0. */
export const weekdayOf = (dayIso) => {
  const [y, m, d] = dayIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

// ---------------------------------------------------------------------------
// Calendar configuration
// ---------------------------------------------------------------------------

/**
 * @typedef {object} WorkingCalendar
 * @property {string}   timeZone
 * @property {number}   startMinute     minutes from midnight the office opens
 * @property {number}   endMinute       minutes from midnight it closes
 * @property {number[]} workingWeekdays JS weekday numbers that are open
 * @property {Set<string>} holidays     `YYYY-MM-DD` closures
 */

/**
 * Build a calendar, reading holidays from the HRMS holiday master.
 *
 * `years` is explicit rather than inferred so a caller computing a deadline in
 * December does not silently miss January's holidays. Callers pass the span they
 * are about to walk.
 */
export async function loadCalendar({ years = [], overrides = {} } = {}) {
  const wanted = years.length ? years : [new Date().getUTCFullYear()];
  // Always include the following year: a 7-calendar-day SLA started in late
  // December lands in January, and a holiday there must still close the office.
  const span = [...new Set(wanted.flatMap((y) => [y, y + 1]))];

  let holidays = new Set();
  try {
    holidays = await holidayDateSet(span);
  } catch (err) {
    // A holiday lookup failing must not stop an order being worked. The window
    // and the weekend still apply, so the deadline is merely optimistic rather
    // than absent — and the failure is loud in the log.
    console.error('[O2D] holiday lookup failed; continuing without holidays:', err.message);
  }

  return buildCalendar({ holidays, ...overrides });
}

/** Assemble a calendar from explicit parts. Pure — the unit-testable half. */
export function buildCalendar({
  timeZone = DEFAULT_TIME_ZONE,
  startMinute = DEFAULT_WORKDAY_START_MINUTE,
  endMinute = DEFAULT_WORKDAY_END_MINUTE,
  workingWeekdays = DEFAULT_WORKING_WEEKDAYS,
  holidays = new Set(),
} = {}) {
  if (endMinute <= startMinute) {
    throw new Error('O2D calendar: the office must close after it opens.');
  }
  return {
    timeZone,
    startMinute,
    endMinute,
    workingWeekdays: [...workingWeekdays],
    holidays: holidays instanceof Set ? holidays : new Set(holidays),
    minutesPerDay: endMinute - startMinute,
  };
}

/** Is the office open at all on this calendar day? */
export const isWorkingDay = (dayIso, cal) =>
  cal.workingWeekdays.includes(weekdayOf(dayIso)) && !cal.holidays.has(dayIso);

/** The first open day on or after `dayIso`. */
export function nextWorkingDay(dayIso, cal, { inclusive = true } = {}) {
  let day = inclusive ? dayIso : nextDay(dayIso);
  // A guard rather than `while (true)`: a misconfiguration with no open weekdays
  // would otherwise hang the request thread rather than raising.
  for (let i = 0; i < 370; i += 1) {
    if (isWorkingDay(day, cal)) return day;
    day = nextDay(day);
  }
  throw new Error('O2D calendar: no working day found within a year — is the calendar configured?');
}

// ---------------------------------------------------------------------------
// Working-time arithmetic
// ---------------------------------------------------------------------------

/**
 * Move an instant to the next moment the office is actually open.
 *
 * Three cases, and the middle one is the one that matters:
 *   - before opening on an open day  → this morning's opening bell
 *   - inside the window              → unchanged
 *   - at or after closing            → the NEXT open day's opening bell, which
 *                                      is what stops a 5:00 PM start consuming
 *                                      the night
 */
export function alignToWorkingTime(date, cal) {
  const { day, minute } = partsIn(date, cal.timeZone);

  if (isWorkingDay(day, cal)) {
    if (minute < cal.startMinute) return instantAt(day, cal.startMinute, cal.timeZone);
    if (minute < cal.endMinute) return date;
  }
  const open = nextWorkingDay(nextDay(day), cal);
  return instantAt(open, cal.startMinute, cal.timeZone);
}

/**
 * Add working minutes to an instant.
 *
 * Walks day by day, consuming only what each day has left. A 12-working-hour SLA
 * (720 minutes) starting at 5:00 PM on a Monday takes the 90 minutes left that
 * day, then 480 on Tuesday, then finishes 150 minutes into Wednesday — at
 * 1:00 PM, which is a time a person could have done the work.
 */
export function addWorkingMinutes(start, minutes, cal) {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new TypeError('addWorkingMinutes: minutes must be a non-negative number');
  }

  let cursor = alignToWorkingTime(start, cal);
  let remaining = minutes;
  // A zero-length SLA resolves to the start itself rather than to the end of the
  // day — "immediately" is a legitimate deadline.
  if (remaining === 0) return cursor;

  for (let guard = 0; guard < 3700; guard += 1) {
    const { day, minute } = partsIn(cursor, cal.timeZone);
    const leftToday = cal.endMinute - minute;

    if (remaining < leftToday) {
      return instantAt(day, minute + remaining, cal.timeZone);
    }
    // Landing exactly on closing time is the end of THIS day's work, not the
    // start of tomorrow's — returning the next morning would report a deadline
    // the owner had already met.
    if (remaining === leftToday) {
      return instantAt(day, cal.endMinute, cal.timeZone);
    }

    remaining -= leftToday;
    const open = nextWorkingDay(nextDay(day), cal);
    cursor = instantAt(open, cal.startMinute, cal.timeZone);
  }
  throw new Error('addWorkingMinutes: exceeded ten years of calendar — SLA value looks wrong.');
}

/**
 * Working minutes BETWEEN two instants.
 *
 * The inverse of the above, and the function every delay figure is built from:
 * a stage finished after its deadline is late by the open minutes in between,
 * not by the wall-clock gap. Finishing at 9:00 AM against a 6:30 PM deadline the
 * previous evening is thirty minutes late, not fifteen hours.
 *
 * Returns 0 when `to` is before `from`.
 */
export function workingMinutesBetween(from, to, cal) {
  if (to <= from) return 0;

  let cursor = alignToWorkingTime(from, cal);
  if (cursor >= to) return 0;

  let total = 0;
  for (let guard = 0; guard < 3700; guard += 1) {
    const { day, minute } = partsIn(cursor, cal.timeZone);
    const endToday = instantAt(day, cal.endMinute, cal.timeZone);

    if (to <= endToday) {
      return total + Math.max(0, Math.round((to - cursor) / MINUTE_MS));
    }
    total += cal.endMinute - minute;
    const open = nextWorkingDay(nextDay(day), cal);
    cursor = instantAt(open, cal.startMinute, cal.timeZone);
  }
  throw new Error('workingMinutesBetween: span exceeded ten years.');
}

/** Add whole open days, landing at the same clock time on the target day. */
export function addWorkingDays(start, days, cal) {
  const { day, minute } = partsIn(alignToWorkingTime(start, cal), cal.timeZone);
  let cursor = day;
  for (let i = 0; i < days; i += 1) cursor = nextWorkingDay(nextDay(cursor), cal);
  // Clamp into the window: the same clock time on a later day is still subject
  // to the office being open at it.
  const clamped = Math.min(Math.max(minute, cal.startMinute), cal.endMinute);
  return instantAt(cursor, clamped, cal.timeZone);
}

/**
 * Add calendar days — weekends and holidays included.
 *
 * Used for the seven-day advance-payment window. A customer's bank does not
 * observe our office hours, so counting only open days would give them nine or
 * ten real days to pay and call it seven.
 *
 * The result is still pulled INTO working time, because a deadline that falls on
 * a Sunday cannot be met and would mark an owner late for the building being
 * shut.
 */
export function addCalendarDays(start, days, cal) {
  const moved = new Date(start.getTime() + days * DAY_MS);
  return alignToWorkingTime(moved, cal);
}

/** A clock time on the same day, or the next open day if today is closed. */
export function sameDayAt(start, minuteOfDay, cal) {
  const { day } = partsIn(start, cal.timeZone);
  const target = isWorkingDay(day, cal) ? day : nextWorkingDay(day, cal);
  return instantAt(target, minuteOfDay, cal.timeZone);
}

/** A clock time on the next open day after this one. */
export function nextWorkingDayAt(start, minuteOfDay, cal) {
  const { day } = partsIn(start, cal.timeZone);
  return instantAt(nextWorkingDay(nextDay(day), cal), minuteOfDay, cal.timeZone);
}

export default {
  loadCalendar,
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
  nextDay,
  weekdayOf,
};
