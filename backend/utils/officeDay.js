/**
 * The office's calendar day — Asia/Kolkata — for the Work Queue.
 *
 * `setHours(0, 0, 0, 0)` answers in the SERVER's zone, and a date-only string
 * such as `2026-10-01` is parsed by `new Date()` as UTC midnight, which is
 * 05:30 in the office. Between them, a UTC host thought "today" ended at 05:30
 * IST and a task due on the 1st was already late by breakfast on the 1st.
 *
 * India keeps one offset all year (no DST), so a fixed +05:30 is exact — the
 * O2D calendar uses `Intl` because its zone is configurable; this one is not.
 */

const OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` of the office day an instant falls on. */
export function officeDayKey(d = new Date()) {
  return new Date(new Date(d).getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant an office day (a `YYYY-MM-DD` key) begins. */
const keyStart = (key) => new Date(`${key}T00:00:00+05:30`);

/** 00:00 IST of the office day `d` falls on. A date-only string is that day. */
export function startOfOfficeDay(d = new Date()) {
  if (typeof d === 'string' && DATE_ONLY.test(d)) return keyStart(d);
  return keyStart(officeDayKey(d));
}

/** 23:59:59.999 IST of the office day `d` falls on. */
export function endOfOfficeDay(d = new Date()) {
  return new Date(startOfOfficeDay(d).getTime() + DAY_MS - 1);
}

/**
 * Add whole months to an office day, clamping to the month's last day, and
 * always measured from the ANCHOR day of month so a 31st stays a month-end:
 * Jan 31 → Feb 28 → Mar 31, never Jan 31 → Mar 3 → Apr 3.
 */
function addMonthsKey(anchorKey, months) {
  const [y, m, day] = anchorKey.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function addDaysKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * How a calendar day is STORED on a Work Queue row: 00:00 UTC of that date,
 * which is 05:30 IST — inside the same office day. Every row written before
 * this file existed uses the same form, and so does every screen that prints
 * one, so it is kept; only the day BOUNDARIES above changed to IST.
 */
export const dayStamp = (key) => new Date(`${key}T00:00:00.000Z`);

const MONTH_STEPS = { monthly: 1, quarterly: 3, yearly: 12 };
const DAY_STEPS = { daily: 1, weekly: 7, fortnightly: 14 };

/**
 * Every office day a routine falls due between `startDate` and `endDate`
 * inclusive, as stored day stamps (see `dayStamp`). Capped at `limit`; `truncated` says so.
 */
export function officeDaySchedule(startDate, endDate, frequency, { limit = 1000 } = {}) {
  const startKey = officeDayKey(startOfOfficeDay(startDate));
  if (frequency === 'once') return { dates: [dayStamp(startKey)], truncated: false };

  const endKey = officeDayKey(startOfOfficeDay(endDate || startDate));
  const dates = [];
  for (let i = 0; ; i += 1) {
    const key = MONTH_STEPS[frequency]
      ? addMonthsKey(startKey, i * MONTH_STEPS[frequency])
      : addDaysKey(startKey, i * (DAY_STEPS[frequency] ?? 1));
    if (key > endKey) return { dates, truncated: false };
    if (dates.length >= limit) return { dates, truncated: true };
    dates.push(dayStamp(key));
  }
}
