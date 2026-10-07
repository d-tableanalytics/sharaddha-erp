import { isSuperAdmin } from '../../utils/permissions';

/**
 * Is this delegated task overdue — the ONE answer every Delegation view uses.
 *
 * The page tabs, the list badge, the Kanban card and the drawer each used to
 * carry their own copy, and they disagreed: the Overdue tab listed rows the
 * list did not badge, Kanban counted work awaiting verification as late.
 *
 *   - Done, submitted for verification, or handed to somebody else: never.
 *   - An O2D stage still LOCKED behind an earlier one has a placeholder date
 *     (`scheduleTbd`), not a deadline: never.
 *   - An O2D stage's deadline is a real moment, and passes at that moment.
 *   - A hand-made task is due on a DAY. Its date is stored as 00:00 UTC (05:30
 *     in the office), so comparing with that instant called it late by
 *     breakfast on the day it was due. It is late once that day is over.
 */
const CLOSED = ['Completed', 'Awaiting Verification', 'Reassigned'];

export function endOfDueDay(due) {
  const d = new Date(due);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function isTaskOverdue(task, now = Date.now()) {
  if (!task?.dueDate) return false;
  if (CLOSED.includes(task.status)) return false;
  if (task.scheduleTbd) return false;
  const deadline = task.sourceType === 'o2d_stage' ? new Date(task.dueDate) : endOfDueDay(task.dueDate);
  return deadline.getTime() < now;
}

/** An evidence link is rendered as a link only if it is a web address. */
export const isWebUrl = (url) => /^https?:\/\//i.test(String(url ?? '').trim());

/**
 * How the viewer stands to this task — the same three questions the server
 * asks (`relationTo` in delegation.controller.js), so the drawer offers only
 * what the server will accept.
 */
const MANAGER_ROLES = ['Super Admin', 'Admin', 'Management', 'HR'];
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export function relationTo(task, user) {
  const userId = user?._id ?? user?.id;
  const manager = MANAGER_ROLES.includes(user?.role) || isSuperAdmin(user);
  const assigner = sameId(task?.assignerId, userId);
  const doer = sameId(task?.doerId, userId);
  return { owner: manager || assigner, assigner, doer };
}
