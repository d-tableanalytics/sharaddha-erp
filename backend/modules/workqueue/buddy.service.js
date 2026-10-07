/**
 * Buddy System — who holds a buddy task today.
 *
 * A buddy task has an ordered chain: the primary first, then backups in
 * priority order. On every office day the task belongs to the FIRST person in
 * the chain who is available that day (see `availability.service.js`). It is
 * still one task — the row's own doer field moves, and the move is written to
 * `assignmentHistory` on the same row.
 *
 * ---------------------------------------------------------------------------
 * THE RULES
 * ---------------------------------------------------------------------------
 *   A new day starts from the top. Yesterday's backup does not keep the task
 *   just because they had it: if the primary is back, it goes back.
 *
 *   Within a day, the holder keeps it while they stay available. A primary
 *   whose leave is cancelled at 15:00 does not snatch back work their backup
 *   has been doing since 10:00.
 *
 *   Nobody available: the task keeps its last doer — never silently unowned —
 *   and is flagged `noAssigneeDay`, and whoever assigned it is told, once.
 *
 *   A manual assignment pins the row (`assignmentSource: 'manual'`). The
 *   scheduler does not touch a pinned row. Checklist pins one occurrence, i.e.
 *   one day; Delegation pins the task until a manager resumes the rotation.
 *
 *   It runs only while the work is live: a delegation between its start and
 *   due days and still being worked (not submitted, completed, held or
 *   deleted); a checklist occurrence on its own day, still pending, on an
 *   active routine. Past days are history and are never rewritten.
 *
 *   Company holidays are skipped — the whole office is away.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENT BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 * Every write is a compare-and-set: it only lands if the row still has the
 * doer, `buddyDay` and `noAssigneeDay` it was read with. A second sweep finds
 * nothing to change; two overlapping sweeps race on the same filter and only
 * one wins. Notifications and audit entries are sent only by the winner, so
 * nobody is told twice about one event.
 */

import mongoose from 'mongoose';
import { Delegation } from '../../models/Delegation.js';
import { ChecklistRoutine, ChecklistOccurrence } from '../../models/Checklist.js';
import User from '../../models/User.js';
import Employee from '../../models/hrms/Employee.js';
import { BUDDY_CHAIN_MIN, BUDDY_CHAIN_MAX } from '../../models/workQueueBuddy.js';
import { availabilityOn, isCompanyHoliday } from './availability.service.js';
import { notifyUsers } from '../hrms/inbox/notifier.service.js';
import { INBOX_TYPES } from '../../shared/constants/inbox.js';
import { recordSystemAudit } from '../../utils/auditLog.js';
import { logActivity } from '../activities/activity.controller.js';
import { officeDayKey, startOfOfficeDay, endOfOfficeDay } from '../../utils/officeDay.js';

const idOf = (v) => (v == null ? null : String(v?._id ?? v));

/** First word / the rest — the same split every Work Queue screen already uses. */
export function splitName(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

// ── The chain ────────────────────────────────────────────────────────────────

export class BuddyChainError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const WORKING_EMPLOYEE_STATUSES = ['active', 'probation', 'notice'];

/**
 * Validate a chain from a request — user ids (or `{ userId }`) in priority
 * order — and return it as stored: `[{ userId, name }]`.
 *
 * Refuses blanks, duplicates, too few or too many people, and anyone who does
 * not exist or cannot work: an inactive login, or an employee who has exited.
 * Somebody merely on leave TODAY is fine — that is what backups are for.
 */
export async function resolveBuddyChain(raw) {
  if (!Array.isArray(raw)) throw new BuddyChainError('Buddy System needs an ordered list of assignees.');

  const ids = raw.map((entry) => String(entry?.userId ?? entry ?? '').trim());
  if (ids.some((id) => !id)) throw new BuddyChainError('Select an employee for every position in the buddy chain.');
  if (ids.length < BUDDY_CHAIN_MIN) throw new BuddyChainError('Buddy System needs a primary assignee and at least one backup.');
  if (ids.length > BUDDY_CHAIN_MAX) throw new BuddyChainError(`A buddy chain can have at most ${BUDDY_CHAIN_MAX} people.`);
  if (new Set(ids).size !== ids.length) throw new BuddyChainError('The same employee cannot appear twice in the buddy chain.');
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new BuddyChainError('One of the selected employees does not exist.');

  const [users, employees] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('user email status').lean(),
    Employee.find({ userId: { $in: ids }, deletedAt: null }).select('userId status').lean(),
  ]);
  const userById = new Map(users.map((u) => [idOf(u), u]));
  const employeeByUser = new Map(employees.map((e) => [idOf(e.userId), e]));

  return ids.map((id) => {
    const user = userById.get(id);
    if (!user) throw new BuddyChainError('One of the selected employees does not exist.');
    const name = user.user || user.email || '';
    if (user.status && user.status !== 'Active') {
      throw new BuddyChainError(`${name} is not an active user and cannot be in a buddy chain.`);
    }
    const employee = employeeByUser.get(id);
    if (employee && !WORKING_EMPLOYEE_STATUSES.includes(employee.status)) {
      throw new BuddyChainError(`${name} is ${employee.status} and cannot be in a buddy chain.`);
    }
    return { userId: user._id, name };
  });
}

/**
 * One person for a manual assignment, held to the same bar as a chain member:
 * they must exist and be able to work. Returns `{ userId, name }`.
 */
export async function resolveActiveAssignee(rawId) {
  const id = String(rawId ?? '').trim();
  if (!id || !mongoose.isValidObjectId(id)) throw new BuddyChainError('Select the employee to assign this task to.');

  const [user, employee] = await Promise.all([
    User.findById(id).select('user email status').lean(),
    Employee.findOne({ userId: id, deletedAt: null }).select('status').lean(),
  ]);
  if (!user) throw new BuddyChainError('The selected employee does not exist.');
  const name = user.user || user.email || '';
  if (user.status && user.status !== 'Active') throw new BuddyChainError(`${name} is not an active user.`);
  if (employee && !WORKING_EMPLOYEE_STATUSES.includes(employee.status)) {
    throw new BuddyChainError(`${name} is ${employee.status} and cannot be assigned work.`);
  }
  return { userId: user._id, name };
}

/** Do two chains name the same people in the same order? */
export const sameChain = (a = [], b = []) =>
  a.length === b.length && a.every((m, i) => idOf(m.userId) === idOf(b[i]?.userId));

// ── Choosing ─────────────────────────────────────────────────────────────────

/**
 * Who should hold the task, given everybody's availability for the day.
 *
 * Pure. `sameDay` means the rotation already decided for this day, so the
 * current holder keeps it while they are still available; otherwise the chain
 * is walked from the top.
 *
 * @returns {{ chosen: object|null, skipped: Array<{userId, name, reason}>, kept: boolean }}
 *          `skipped` is everyone passed over above `chosen` (all of them, when
 *          nobody is available).
 */
export function pickAssignee(chain, availability, { currentId = null, sameDay = false } = {}) {
  const isAvailable = (id) => availability.get(idOf(id))?.available === true;
  const current = currentId ? chain.find((m) => idOf(m.userId) === idOf(currentId)) : null;

  if (sameDay && current && isAvailable(current.userId)) {
    return { chosen: current, skipped: [], kept: true };
  }

  const skipped = [];
  for (const member of chain) {
    if (isAvailable(member.userId)) return { chosen: member, skipped, kept: false };
    const info = availability.get(idOf(member.userId));
    skipped.push({ userId: member.userId, name: info?.name || member.name, reason: info?.reason || 'unavailable' });
  }
  return { chosen: null, skipped, kept: false };
}

const describeAway = (people) => people.map((p) => `${p.name} is ${p.reason}`).join('; ');

/** The one-line reason shown on the task for a backup holding it. */
function backupReason(chain, skipped) {
  const primaryId = idOf(chain[0]?.userId);
  const primary = skipped.find((p) => idOf(p.userId) === primaryId);
  const others = skipped.filter((p) => idOf(p.userId) !== primaryId);
  const parts = [];
  if (primary) parts.push(`Primary assignee ${primary.name} is ${primary.reason} today`);
  if (others.length) parts.push(describeAway(others));
  return parts.join('; ') || 'Activated by the buddy rotation';
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** A history entry. `from`/`to` are `{ userId, name }` or null. */
export function assignmentEvent({ day, event, source, from = null, to = null, reason = '', unavailable = [], by = null, at = new Date() }) {
  return {
    day,
    at,
    event,
    source,
    fromUserId: from?.userId ?? null,
    fromName: from?.name ?? '',
    toUserId: to?.userId ?? null,
    toName: to?.name ?? '',
    reason,
    unavailable: unavailable.map((p) => ({ userId: p.userId, name: p.name, reason: p.reason })),
    byUserId: by?._id ?? null,
    byName: by ? (by.user || by.email || '') : '',
  };
}

/**
 * The two kinds of row the rotation drives. Everything that differs between
 * a delegation and a checklist occurrence is here; the rotation itself below
 * is the same code for both.
 */
const DELEGATION_OPEN_STATUSES = ['Pending', 'In Progress', 'Need Revision'];

const KINDS = {
  delegation: {
    model: Delegation,
    doerField: 'doerId',
    live: { status: { $in: DELEGATION_OPEN_STATUSES }, isDeleted: { $ne: true }, heldAt: null },
    title: (row) => row.taskTitle,
    entity: 'delegation',
    noAssigneeType: INBOX_TYPES.WORK_QUEUE_NO_ASSIGNEE,
    extraSet: () => ({}),
  },
  occurrence: {
    model: ChecklistOccurrence,
    doerField: 'doer',
    live: { status: 'pending', heldAt: null },
    title: (row) => row.taskName,
    entity: 'checklist_occurrence',
    noAssigneeType: INBOX_TYPES.WORK_QUEUE_CHECKLIST_NO_ASSIGNEE,
    // A task handed to somebody is "new" for them — see `assignedAt`.
    extraSet: (now) => ({ assignedAt: now }),
  },
};

/**
 * Bring one row in line with today's availability. Returns what happened:
 * 'activated' | 'restored' | 'no_assignee' | 'recovered' | 'unchanged' | 'lost_race'.
 */
async function rotateRow(kind, row, { chain, availability, day, now, managerId }) {
  const K = KINDS[kind];
  const currentId = idOf(row[K.doerField]);
  const current = {
    userId: row[K.doerField],
    name: [row.doerFirstName, row.doerLastName].filter(Boolean).join(' ') || availability.get(currentId)?.name || '',
  };
  const sameDay = row.buddyDay === day;
  const { chosen, skipped } = pickAssignee(chain, availability, { currentId, sameDay });

  // Compare-and-set: only if nobody has moved this row since it was read.
  const guard = {
    _id: row._id,
    [K.doerField]: row[K.doerField],
    buddyDay: row.buddyDay ?? null,
    noAssigneeDay: row.noAssigneeDay ?? null,
    assignmentSource: { $ne: 'manual' },
    ...K.live,
  };
  const title = K.title(row);

  // ── Nobody in the chain is available ──
  if (!chosen) {
    if (row.noAssigneeDay === day) return 'unchanged';
    const reason = `Nobody in the buddy chain is available today — ${describeAway(skipped)}`;
    const res = await K.model.updateOne(guard, {
      $set: { buddyDay: day, noAssigneeDay: day, assignmentReason: reason },
      $push: { assignmentHistory: assignmentEvent({
        day, event: 'no_assignee', source: 'automatic', from: current, to: null, reason, unavailable: skipped, at: now,
      }) },
    });
    if (res.matchedCount !== 1) return 'lost_race';

    if (managerId) {
      await notifyUsers({
        toUserIds: [idOf(managerId)],
        type: K.noAssigneeType,
        title: `No one is available for "${title}" today`,
        body: `${describeAway(skipped)}. It stays with ${current.name || 'its last assignee'} until someone is available or you reassign it.`,
        entity: K.entity,
        entityId: idOf(row._id),
      });
    }
    await recordSystemAudit('Work Queue Buddy: No Available Assignee', `${title} (${day}): ${reason}`, {
      kind, taskId: idOf(row._id), day,
    });
    return 'no_assignee';
  }

  const isPrimary = idOf(chosen.userId) === idOf(chain[0]?.userId);
  const source = isPrimary ? 'primary' : 'automatic';

  // ── The current holder keeps it ──
  if (idOf(chosen.userId) === currentId) {
    const recovering = row.noAssigneeDay === day;
    const reason = isPrimary ? '' : (sameDay ? row.assignmentReason : backupReason(chain, skipped));
    const settled = sameDay && !recovering && row.assignmentSource === source
      && (row.assignmentReason ?? '') === (reason ?? '');
    if (settled) return 'unchanged';

    const update = { $set: { buddyDay: day, noAssigneeDay: null, assignmentSource: source, assignmentReason: reason } };
    if (recovering) {
      update.$push = { assignmentHistory: assignmentEvent({
        day, event: isPrimary ? 'primary_restored' : 'buddy_activated', source: 'automatic',
        from: current, to: chosen, reason: `${chosen.name} is available again`, at: now,
      }) };
    }
    const res = await K.model.updateOne(guard, update);
    if (res.matchedCount !== 1) return 'lost_race';
    return recovering ? 'recovered' : 'unchanged';
  }

  // ── Somebody else takes it ──
  const event = isPrimary ? 'primary_restored' : 'buddy_activated';
  const reason = isPrimary ? `Primary assignee ${chosen.name} is available` : backupReason(chain, skipped);
  const { first, last } = splitName(chosen.name);

  const res = await K.model.updateOne(guard, {
    $set: {
      [K.doerField]: chosen.userId,
      doerFirstName: first,
      doerLastName: last,
      assignmentSource: source,
      assignmentReason: isPrimary ? '' : reason,
      buddyDay: day,
      noAssigneeDay: null,
      ...K.extraSet(now),
    },
    $push: { assignmentHistory: assignmentEvent({
      day, event, source: 'automatic', from: current, to: chosen, reason, unavailable: skipped, at: now,
    }) },
  });
  if (res.matchedCount !== 1) return 'lost_race';

  await notifyUsers({
    toUserIds: [idOf(chosen.userId)],
    type: INBOX_TYPES.WORK_QUEUE_BUDDY_ASSIGNED,
    title: isPrimary
      ? `"${title}" is back with you`
      : `You have been automatically assigned "${title}"`,
    body: isPrimary
      ? 'You are its primary assignee and are available today.'
      : `The primary assignee is unavailable today. ${reason}.`,
    entity: K.entity,
    entityId: idOf(row._id),
  });
  await recordSystemAudit(
    isPrimary ? 'Work Queue Buddy: Primary Restored' : 'Work Queue Buddy: Backup Activated',
    `${title} (${day}): ${current.name || 'previous assignee'} → ${chosen.name}. ${reason}`,
    { kind, taskId: idOf(row._id), day, from: currentId, to: idOf(chosen.userId) },
  );
  if (kind === 'delegation') {
    logActivity({
      type: 'general',
      title,
      description: `${isPrimary ? 'Returned to' : 'Automatically assigned to'} ${chosen.name}. ${reason}`,
      userId: chosen.userId,
      relatedId: row._id,
      metadata: { buddyEvent: event, day },
    });
  }
  return isPrimary ? 'restored' : 'activated';
}

// ── The sweep ────────────────────────────────────────────────────────────────

/**
 * Bring every live buddy task in line with today. Safe to run as often as you
 * like (see the header).
 *
 * `delegationIds` / `routineIds` narrow it to just those rows — used right
 * after a task is created or its chain edited, so a task that starts while its
 * primary is already away is handed over at once rather than on the next tick.
 */
export async function runBuddySweep({ now = new Date(), delegationIds = null, routineIds = null } = {}) {
  const day = officeDayKey(now);
  const summary = { day, holiday: false, evaluated: 0, activated: 0, restored: 0, noAssignee: 0, recovered: 0, failed: 0 };

  if (await isCompanyHoliday(day)) {
    summary.holiday = true;
    return summary;
  }

  const targeted = delegationIds != null || routineIds != null;
  const dayStart = startOfOfficeDay(now);
  const dayEnd = endOfOfficeDay(now);

  const delegations = (!targeted || delegationIds) ? await Delegation.find({
    assignmentType: 'buddy',
    assignmentSource: { $ne: 'manual' },
    sourceType: { $ne: 'o2d_stage' },
    ...KINDS.delegation.live,
    // Live today: started, and not yet past its due day.
    startDate: { $lte: dayEnd },
    dueDate: { $gte: dayStart },
    ...(delegationIds ? { _id: { $in: delegationIds } } : {}),
  }).select('taskTitle doerId doerFirstName doerLastName assignerId buddyChain buddyDay noAssigneeDay assignmentSource assignmentReason').lean() : [];

  const routines = (!targeted || routineIds) ? await ChecklistRoutine.find({
    assignmentType: 'buddy',
    isActive: true,
    sourceType: { $ne: 'o2d_stage' },
    ...(routineIds ? { _id: { $in: routineIds } } : {}),
  }).select('buddyChain createdBy').lean() : [];

  const routineById = new Map(routines.map((r) => [idOf(r), r]));
  const occurrences = routines.length === 0 ? [] : await ChecklistOccurrence.find({
    routine: { $in: routines.map((r) => r._id) },
    plannedDate: { $gte: dayStart, $lte: dayEnd },
    assignmentSource: { $ne: 'manual' },
    ...KINDS.occurrence.live,
  }).select('routine taskName doer doerFirstName doerLastName buddyDay noAssigneeDay assignmentSource assignmentReason').lean();

  // Everybody in every chain, in one availability read.
  const people = new Set();
  delegations.forEach((d) => d.buddyChain.forEach((m) => people.add(idOf(m.userId))));
  routines.forEach((r) => r.buddyChain.forEach((m) => people.add(idOf(m.userId))));
  occurrences.forEach((o) => o.doer && people.add(idOf(o.doer)));
  delegations.forEach((d) => people.add(idOf(d.doerId)));
  const availability = await availabilityOn([...people], day, { now });

  const tally = (outcome) => {
    summary.evaluated += 1;
    if (outcome === 'activated') summary.activated += 1;
    else if (outcome === 'restored') summary.restored += 1;
    else if (outcome === 'no_assignee') summary.noAssignee += 1;
    else if (outcome === 'recovered') summary.recovered += 1;
  };

  // One bad row must not stop the rest of the sweep.
  const attempt = async (fn) => {
    try { tally(await fn()); } catch (err) {
      summary.failed += 1;
      console.error('[WorkQueue] Buddy rotation failed for one task:', err?.message ?? err);
    }
  };

  for (const task of delegations) {
    if ((task.buddyChain ?? []).length === 0) continue;
    await attempt(() => rotateRow('delegation', task, {
      chain: task.buddyChain, availability, day, now, managerId: task.assignerId,
    }));
  }

  for (const occ of occurrences) {
    const routine = routineById.get(idOf(occ.routine));
    if (!routine || (routine.buddyChain ?? []).length === 0) continue;
    await attempt(() => rotateRow('occurrence', occ, {
      chain: routine.buddyChain, availability, day, now, managerId: routine.createdBy,
    }));
  }

  return summary;
}

/**
 * The cron entry point: one sweep at a time per process, so a slow sweep is
 * not stacked on by the next tick (the compare-and-set would keep it correct
 * anyway; this just avoids the wasted work).
 */
let sweeping = false;
export async function runScheduledBuddySweep(options) {
  if (sweeping) return { skipped: true };
  sweeping = true;
  try {
    return await runBuddySweep(options);
  } finally {
    sweeping = false;
  }
}

export default { runBuddySweep, runScheduledBuddySweep, resolveBuddyChain, pickAssignee };
