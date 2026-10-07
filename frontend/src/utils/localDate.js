/**
 * Today's date as `YYYY-MM-DD` on the viewer's own calendar.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which in India is
 * still YESTERDAY until 05:30 — a task created at 01:00 defaulted to starting
 * the day before and was born overdue.
 */
export function localDateKey(d = new Date()) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
