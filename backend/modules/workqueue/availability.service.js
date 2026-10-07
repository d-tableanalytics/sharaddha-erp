/**
 * Is this person available to work on this office day?
 *
 * There is no availability model in this codebase and this file does not add
 * one. It reads the answer out of what HRMS already records:
 *
 *   the login        `User.status` must be Active — a Suspended or Inactive
 *                    account cannot sign in to do the work
 *   the employee     `Employee.status` must be a working state. Exited,
 *                    suspended, inactive and not-yet-joined people are away
 *                    for good; HRMS already suspends the login for most of them
 *   approved leave   a full day of approved leave covering the day. Half-day
 *                    and hourly leave leave the person on duty for part of it,
 *                    which is enough to own a task, so they do not count
 *   attendance       an explicit `absent` / `on_leave` / `weekly_off` /
 *                    `holiday` mark on that person's row for the day
 *
 * ---------------------------------------------------------------------------
 * WHY "NO PUNCH" IS NOT "ABSENT" BY DEFAULT
 * ---------------------------------------------------------------------------
 * Nothing in HRMS writes an `absent` row: absence is implied by the ABSENCE of
 * a row, which at 09:00 describes every employee in the company. Treating that
 * as absent would hand every buddy task to a backup each morning and back
 * again on the first punch. So a missing row only counts once the office day
 * is past `WORK_QUEUE_BUDDY_NO_SHOW_AFTER` (e.g. `11:00`, IST) — and that is
 * off unless it is set, because not every login here punches at all.
 *
 * Someone with a login but no HRMS employee record (some admin accounts) has
 * no leave or attendance to read, so only their login status applies.
 */

import mongoose from 'mongoose';
import User from '../../models/User.js';
import Employee from '../../models/hrms/Employee.js';
import AttendanceRecord from '../../models/hrms/AttendanceRecord.js';
import { LeaveRequest } from '../../models/hrms/LeaveRequest.js';
import { holidayDateSet } from '../hrms/leave/holiday.service.js';
import { officeDayKey } from '../../utils/officeDay.js';

/** Employee states in which a person is expected at work — Attendance's own list. */
const WORKING_EMPLOYEE_STATUSES = ['active', 'probation', 'notice'];

/** Attendance marks that mean "not here today". `half_day` is here, for half of it. */
const AWAY_ATTENDANCE = {
  absent: 'marked absent',
  on_leave: 'on leave',
  weekly_off: 'on weekly off',
  holiday: 'on holiday',
};

/** A row of `mixed` leave lists each day's kind; only a `full` day is away. */
function leaveCoversWholeDay(leave, day) {
  if (leave.durationUnit === 'half_day' || leave.durationUnit === 'hour') return false;
  if (leave.durationUnit === 'mixed') {
    const entry = (leave.dayBreakdown ?? []).find((d) => d.date === day);
    return entry?.kind === 'full';
  }
  return true;
}

/** `HH:MM` → minutes past midnight, or null when unset or malformed. */
function parseCutoff(raw) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? '').trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

/** Minutes past midnight IST of `now`, if `now` falls on `day`; otherwise null. */
function officeMinutesOn(day, now) {
  if (officeDayKey(now) !== day) return null;
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

const idOf = (v) => String(v?._id ?? v);
const displayName = (u) => u?.user || u?.email || 'Unknown user';

/**
 * Availability of every user in `userIds` on office day `day` (`YYYY-MM-DD`).
 *
 * @returns {Promise<Map<string, { available: boolean, reason: string|null, name: string }>>}
 *          keyed by user id string. A user id that does not exist is unavailable.
 */
export async function availabilityOn(userIds, day, { now = new Date() } = {}) {
  const ids = [...new Set((userIds ?? []).map(idOf))].filter((id) => mongoose.isValidObjectId(id));
  const result = new Map();
  if (ids.length === 0) return result;

  const [users, employees] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('user email status').lean(),
    Employee.find({ userId: { $in: ids }, deletedAt: null }).select('userId status').lean(),
  ]);

  const userById = new Map(users.map((u) => [idOf(u), u]));
  const employeeByUser = new Map(employees.map((e) => [idOf(e.userId), e]));
  const employeeIds = employees.map((e) => e._id);

  const [leaves, attendance] = employeeIds.length === 0 ? [[], []] : await Promise.all([
    LeaveRequest.find({
      employeeId: { $in: employeeIds },
      status: 'approved',
      startDate: { $lte: day },
      endDate: { $gte: day },
    }).select('employeeId durationUnit dayBreakdown').lean(),
    AttendanceRecord.find({
      employeeId: { $in: employeeIds },
      // Attendance stores midnight UTC of the calendar day — the same stamp
      // `dayStamp` writes on Work Queue rows.
      date: new Date(`${day}T00:00:00.000Z`),
    }).select('employeeId status').lean(),
  ]);

  const onLeave = new Set(leaves.filter((l) => leaveCoversWholeDay(l, day)).map((l) => idOf(l.employeeId)));
  const attendanceByEmployee = new Map(attendance.map((a) => [idOf(a.employeeId), a]));

  const cutoff = parseCutoff(process.env.WORK_QUEUE_BUDDY_NO_SHOW_AFTER);
  const minutesNow = officeMinutesOn(day, now);
  const pastNoShowCutoff = cutoff != null && minutesNow != null && minutesNow >= cutoff;

  for (const id of ids) {
    const user = userById.get(id);
    const name = displayName(user);
    const away = (reason) => result.set(id, { available: false, reason, name });

    if (!user) { away('no longer exists'); continue; }
    if (user.status && user.status !== 'Active') { away(`account is ${user.status.toLowerCase()}`); continue; }

    const employee = employeeByUser.get(id);
    if (employee) {
      const empId = idOf(employee._id);
      if (!WORKING_EMPLOYEE_STATUSES.includes(employee.status)) { away(`employee status is ${employee.status}`); continue; }
      if (onLeave.has(empId)) { away('on approved leave'); continue; }

      const mark = attendanceByEmployee.get(empId);
      if (mark && AWAY_ATTENDANCE[mark.status]) { away(AWAY_ATTENDANCE[mark.status]); continue; }
      if (!mark && pastNoShowCutoff) { away('has not checked in today'); continue; }
    }

    result.set(id, { available: true, reason: null, name });
  }

  return result;
}

/**
 * Is `day` a company holiday? On one, the rotation does not run: the whole
 * office is away, so "nobody available" would be true of every task and say
 * nothing. Optional holidays are excluded, the same as Leave excludes them.
 *
 * There is no weekly-off configuration anywhere in this codebase (Leave
 * assumes Sat–Sun, O2D assumes Sunday only), so weekly offs are not applied
 * here; a person-level `weekly_off` attendance mark still is, above.
 */
export async function isCompanyHoliday(day) {
  const holidays = await holidayDateSet([Number(day.slice(0, 4))]);
  return holidays.has(day);
}

export default { availabilityOn, isCompanyHoliday };
