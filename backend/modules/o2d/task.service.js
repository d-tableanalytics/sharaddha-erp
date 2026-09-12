/**
 * My Tasks — the queue an employee actually works from (§14).
 *
 * ---------------------------------------------------------------------------
 * WHOSE TASK IS IT? — AND A ROLE DISTINCTION THE BRIEF MAKES DELIBERATELY
 * ---------------------------------------------------------------------------
 *
 * A stage names up to three kinds of role, and they are not interchangeable:
 *
 *   ownerRole        who is ACCOUNTABLE. The KPI is attributed here.
 *   completedByRole  who records the ACTUAL, when that is somebody else. §5 and
 *                    §10 both insist on this: Billing acknowledges the stage-2
 *                    handover, the WAREHOUSE acknowledges the stage-7 picking
 *                    request. Crediting the pusher would record work as done at
 *                    the moment it was requested rather than received.
 *   alsoAllowedRoles who may also act — cover, seniors, admins.
 *
 * So "who can close this" and "whose number is it" are different questions, and
 * this module answers both rather than collapsing them:
 *
 *   ACTIONABLE  the caller may complete the stage now. That is
 *               `completedByRole` when the stage names one, otherwise
 *               `ownerRole` — plus `alsoAllowedRoles`, plus the unrestricted.
 *   WATCHING    the caller is the owner but somebody else must record it. Stage
 *               2 for Sales: they have to send the PO, and Billing closes it.
 *
 * ⚠ AMBIGUITY, FLAGGED RATHER THAN DECIDED SILENTLY. The brief does not say
 * whether the owner of a stage with a separate `completedByRole` should see it
 * in their own task list. Hiding it would mean a salesperson has no screen
 * telling them a PO is waiting to be handed over; showing it as actionable
 * would let them close a stage the brief says Billing closes. This returns it
 * as a WATCHING row — visible, not closeable — which loses no information
 * either way. If the business wants stage 2 to vanish from the Sales queue once
 * sent, that is a one-line change to `visibilityFilter` below.
 */

import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dStageMaster } from '../../models/o2d/O2dStageMaster.js';
import { isSuperAdmin } from '../../middlewares/rbac.js';
import { STAGE_STATUS, TERMINAL_STAGE_STATUSES, ORDER_STATUS } from '../../shared/constants/o2d.js';
import { bucketFor } from './order.service.js';

/**
 * The stage numbers a role may CLOSE, and those it merely owns.
 *
 * Read from the stage master rather than a constant, because §37 lets an
 * administrator reassign a stage's owner without a deploy — and a hardcoded map
 * here would keep routing tasks to the old role while the master said otherwise.
 */
export async function roleStageMap(role) {
  const masters = await O2dStageMaster.find({ enabled: true })
    .select('stageNumber ownerRole alsoAllowedRoles completedByRole skippable')
    .lean();

  const actionable = [];
  const watching = [];

  for (const m of masters) {
    const closer = m.completedByRole || m.ownerRole;
    const allowed = [closer, ...(m.alsoAllowedRoles ?? [])];

    if (allowed.includes(role)) actionable.push(m.stageNumber);
    // Owner, but not the one who records it — see the note above.
    else if (m.ownerRole === role) watching.push(m.stageNumber);
  }

  return { actionable, watching, masters };
}

/**
 * The stages this caller should see.
 *
 * A Super Admin holds the wildcard and sees everything — the same rule every
 * other permission check in the portal follows, rather than a special case that
 * would leave the most privileged account with an empty task list.
 */
async function visibilityFilter(user) {
  if (isSuperAdmin(user)) return { all: true, actionable: null, watching: null };
  const { actionable, watching } = await roleStageMap(user?.role);
  return { all: false, actionable, watching };
}

/**
 * My Tasks.
 *
 * Only NON-TERMINAL stages, and only on live orders. A stage on a cancelled
 * order is not work, and an order on hold is explicitly not the assignee's
 * problem — §19 freezes its SLA, and leaving it in the queue would have people
 * chasing orders they have been told to stop working.
 */
export async function myTasks(user, query = {}) {
  const {
    page = 1, pageSize = 50, status, stageNumber, bucket, search,
    sortBy = 'plannedCompletion', sortDir = 'asc',
  } = query;

  const vis = await visibilityFilter(user);
  const mine = vis.all ? null : [...vis.actionable, ...vis.watching];

  if (mine && mine.length === 0) {
    return { data: [], total: 0, page, pageSize, actionable: [], watching: [] };
  }

  // Live orders only. Resolved first so the stage query stays a single indexed
  // read rather than a lookup per row. An order ON_HOLD is deliberately absent:
  // §19 freezes its SLA, and leaving it here would have people chasing work they
  // have been told to stop.
  const liveOrderIds = await O2dOrder.distinct('_id', { status: ORDER_STATUS.OPEN });

  const filter = { order: { $in: liveOrderIds } };

  // A LOCKED stage is not yet work — it is waiting on a predecessor. Excluding
  // it is what keeps My Tasks a to-do list rather than a copy of the tracker.
  const notWork = [...TERMINAL_STAGE_STATUSES, STAGE_STATUS.LOCKED, STAGE_STATUS.ON_HOLD];
  filter.status = status?.length
    ? { $in: status.filter((s) => !notWork.includes(s)) }
    : { $nin: notWork };

  // The stage filter NARROWS the caller's own stages; it never replaces them.
  // Assigning `filter.stageNumber` from the query directly would turn My Tasks
  // into "any task" for anyone who guessed a stage number.
  let visible = mine;
  if (stageNumber) {
    visible = mine ? mine.filter((n) => n === Number(stageNumber)) : [Number(stageNumber)];
    if (visible.length === 0) {
      return { data: [], total: 0, page, pageSize, actionable: vis.actionable ?? [], watching: vis.watching ?? [] };
    }
  }
  if (visible) filter.stageNumber = { $in: visible };

  const rows = await O2dOrderStage.find(filter)
    .sort({ [sortBy === 'poDate' ? 'plannedCompletion' : sortBy]: sortDir === 'desc' ? -1 : 1 })
    .lean();

  // The order header, for the PO number and customer every row displays.
  const orderIds = [...new Set(rows.map((r) => String(r.order)))];
  const orders = await O2dOrder.find({ _id: { $in: orderIds } })
    .select('poNumber poDate customerName promiseDate currentStage status')
    .lean();
  const byId = new Map(orders.map((o) => [String(o._id), o]));

  const now = new Date();
  let enriched = rows.map((stage) => {
    const order = byId.get(String(stage.order)) ?? null;
    return {
      ...stage,
      order,
      bucket: bucketFor(stage, now),
      // The flag the UI needs to decide between a "Complete" button and a
      // "waiting on Billing" label.
      actionable: vis.all || vis.actionable.includes(stage.stageNumber),
    };
  });

  if (search) {
    const needle = String(search).toLowerCase();
    enriched = enriched.filter(
      (r) =>
        r.order?.poNumber?.toLowerCase().includes(needle)
        || r.order?.customerName?.toLowerCase().includes(needle),
    );
  }
  if (bucket) enriched = enriched.filter((r) => r.bucket === bucket);

  const total = enriched.length;
  const start = (page - 1) * pageSize;

  return {
    data: enriched.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    actionable: vis.actionable,
    watching: vis.watching,
  };
}

/**
 * The three counts the task screen shows above the list.
 *
 * Computed over the caller's whole queue, not the current page — a badge saying
 * "2 overdue" because only two were on this page would be worse than no badge.
 */
export async function myTaskCounts(user) {
  const { data } = await myTasks(user, { page: 1, pageSize: 10_000 });
  return {
    total: data.length,
    overdue: data.filter((r) => r.bucket === 'overdue').length,
    dueSoon: data.filter((r) => r.bucket === 'due_soon').length,
    onTrack: data.filter((r) => r.bucket === 'on_track').length,
    actionable: data.filter((r) => r.actionable).length,
  };
}

/**
 * May this user complete this particular stage?
 *
 * The authorisation the routes cannot express. `WORK_O2D_STAGE` says the caller
 * works O2D stages at all; it cannot say WHICH, because that mapping lives in
 * the stage master and an administrator can change it (§37). Without this check
 * anyone holding the permission could close anyone else's stage.
 */
export async function canWorkStage(user, stageNumber) {
  if (isSuperAdmin(user)) return true;
  const { actionable } = await roleStageMap(user?.role);
  return actionable.includes(Number(stageNumber));
}

export default { myTasks, myTaskCounts, canWorkStage, roleStageMap };
