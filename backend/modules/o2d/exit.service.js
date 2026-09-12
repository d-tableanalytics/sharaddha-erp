/**
 * Leaving the workflow: cancel, void, and revive.
 *
 * ---------------------------------------------------------------------------
 * CANCEL vs VOID — NOT SYNONYMS
 * ---------------------------------------------------------------------------
 *
 *   CANCELLED  the order was real and stopped. The customer withdrew it, the
 *              stock never came, the terms fell through. It HAPPENED, and it
 *              belongs in the denominator when someone asks how many orders
 *              were lost at stage 5.
 *   VOID       the order should never have existed: keyed twice, keyed against
 *              the wrong customer, a test row. It is an ENTRY ERROR, and
 *              counting it as a lost order would make the business look like it
 *              is failing at something it never attempted.
 *
 * Both are recorded; neither deletes anything (§29). The distinction exists so
 * analytics can exclude data-entry noise without also hiding real losses — which
 * is exactly what a single "cancelled" status forces you to choose between.
 *
 * ---------------------------------------------------------------------------
 * ⚠ ON_HOLD IS AN EXIT TYPE IN THE CONSTANTS, AND A DERIVED ROW HERE
 * ---------------------------------------------------------------------------
 *
 * `EXIT_TYPES` lists ON_HOLD alongside CANCELLED and VOID, so the register the
 * business asked for is a register of EXCEPTIONS — everything not moving —
 * rather than only of departures. But a hold already lives on the order, with
 * its reason, its owner and its frozen minutes, and the SLA engine reads it
 * there. Writing a second copy into this collection would create two records of
 * one fact, and they would disagree the first time a hold was resumed.
 *
 * So: the register's VIEW includes held orders, DERIVED from the order's own
 * hold history. The collection stores only genuine departures. Nothing is
 * double-written, and the screen still shows what was asked for.
 */

import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import { O2dExitRegister } from '../../models/o2d/O2dExitRegister.js';
import { recordAudit } from '../../utils/auditLog.js';
import {
  ORDER_STATUS,
  STAGE_STATUS,
  TERMINAL_STAGE_STATUSES,
  O2D_AUDIT_ACTIONS,
  O2D_EVENTS,
  DISPATCH_STAGE,
} from '../../shared/constants/o2d.js';
import { O2dWorkflowError } from './stage.engine.js';

const EXITED = [ORDER_STATUS.CANCELLED, ORDER_STATUS.VOID];

/**
 * Take an order out of the workflow.
 *
 * @param {'CANCELLED'|'VOID'} exitType
 * @param {object} [opts.approvedBy]  required when the order has dispatched
 */
async function exitOrder(orderId, exitType, { reason, remarks = null, approvedBy = null },
  actor, { req = null, now = new Date() } = {}) {
  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  if (EXITED.includes(order.status)) {
    throw new O2dWorkflowError(
      `This order is already ${order.status.toLowerCase()}. Revive it first if that was a mistake.`,
      { code: 'O2D_ALREADY_EXITED' },
    );
  }
  if (!reason?.trim()) {
    throw new O2dWorkflowError(
      'Taking an order out of the workflow needs a reason — it is the only record of why the customer never received it.',
      { status: 400, code: 'O2D_EXIT_REASON_REQUIRED' },
    );
  }

  /**
   * §29: cancelling AFTER dispatch is a different act from cancelling before.
   *
   * Goods have physically left the building and an invoice exists. Somebody has
   * to own the decision, so a second name is required — not merely recorded if
   * offered. Before dispatch, no approval is needed and demanding one would put
   * a manager in the path of an ordinary correction.
   */
  const dispatched = Boolean(order.dispatchedAt);
  if (dispatched && exitType === ORDER_STATUS.CANCELLED && !approvedBy) {
    throw new O2dWorkflowError(
      'This order has already dispatched. Cancelling it needs an approver, because goods have left and an invoice exists.',
      { status: 400, code: 'O2D_EXIT_APPROVAL_REQUIRED' },
    );
  }

  const stageAtExit = order.currentStage;
  const openStage = await O2dOrderStage.findOne({
    order: order._id,
    stageNumber: stageAtExit,
  }).lean();

  const previousStatus = order.status;
  order.status = exitType;
  order.updatedBy = actor?._id ?? null;
  await order.save();

  /**
   * Open stages are parked, not completed and not deleted.
   *
   * ON_HOLD rather than a new "cancelled" stage status: the row must stop
   * appearing in My Tasks and stop accruing against an SLA, and ON_HOLD already
   * means exactly that. Inventing a status would mean auditing every list that
   * filters on TERMINAL_STAGE_STATUSES to see which ones now under-count.
   */
  await O2dOrderStage.updateMany(
    { order: order._id, status: { $nin: TERMINAL_STAGE_STATUSES } },
    { $set: { status: STAGE_STATUS.ON_HOLD } },
  );

  const entry = await O2dExitRegister.create({
    order: order._id,
    poNumber: order.poNumber,
    customerName: order.customerName,
    exitType,
    stageAtExit,
    stageNameAtExit: openStage?.stageName ?? null,
    reason: reason.trim(),
    remarks,
    exitedAt: now,
    exitedBy: actor?._id ?? null,
    exitedByName: actor?.user ?? actor?.email ?? null,
    approvedBy,
  });

  await recordAudit(actor ?? null,
    exitType === ORDER_STATUS.VOID ? O2D_AUDIT_ACTIONS.ORDER_VOIDED : O2D_AUDIT_ACTIONS.ORDER_CANCELLED,
    `${order.poNumber} ${exitType.toLowerCase()} at ${openStage?.stageName ?? `stage ${stageAtExit}`} — ${reason.trim()}`,
    req,
    {
      meta: {
        orderId: String(order._id),
        poNumber: order.poNumber,
        from: previousStatus,
        to: exitType,
        stageAtExit,
        reason: reason.trim(),
        // Recorded because it changes what the cancellation MEANS: after
        // dispatch there is an invoice and a shipment to unwind.
        afterDispatch: dispatched,
        approvedBy: approvedBy ? String(approvedBy) : null,
        exitRegisterId: String(entry._id),
      },
    });

  return {
    order: await O2dOrder.findById(order._id),
    entry: entry.toObject(),
    events: [{
      type: O2D_EVENTS.ORDER_CANCELLED,
      payload: { orderId: order._id, exitType, stageAtExit, reason: reason.trim() },
    }],
  };
}

export const cancelOrder = (orderId, input, actor, ctx) =>
  exitOrder(orderId, ORDER_STATUS.CANCELLED, input, actor, ctx);

export const voidOrder = (orderId, input, actor, ctx) =>
  exitOrder(orderId, ORDER_STATUS.VOID, input, actor, ctx);

/**
 * Put a cancelled or void order back into the workflow.
 *
 * The exit row is KEPT and stamped as revived rather than deleted — the fact
 * that an order once left is what an auditor is looking for, and the second exit
 * of a twice-cancelled order must not overwrite the first.
 *
 * The order returns to OPEN at the stage it left, with its parked stages
 * unparked. Deadlines are NOT recomputed: the stored planned dates are what the
 * work was judged against (§48), and silently moving them would turn a revived
 * order into one that had never been late.
 */
export async function reviveOrder(orderId, { reason }, actor, { req = null, now = new Date() } = {}) {
  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  if (!EXITED.includes(order.status)) {
    throw new O2dWorkflowError('That order is already in the workflow.', {
      code: 'O2D_NOT_EXITED',
    });
  }
  if (!reason?.trim()) {
    throw new O2dWorkflowError('Reviving an order needs a reason.', {
      status: 400,
      code: 'O2D_REVIVE_REASON_REQUIRED',
    });
  }

  /**
   * §26 again, and the reason revival can fail.
   *
   * Cancelling frees the PO number, so somebody may have keyed a replacement
   * order in the meantime. Reviving this one would then put two live orders on
   * the same (PO, customer) — which the partial unique index refuses anyway, as
   * an E11000 nobody can act on. Checking here produces a sentence instead.
   */
  const clash = await O2dOrder.findOne({
    _id: { $ne: order._id },
    poNumberKey: order.poNumberKey,
    customerKey: order.customerKey,
    parentOrder: null,
    status: { $in: [ORDER_STATUS.OPEN, ORDER_STATUS.ON_HOLD, ORDER_STATUS.CLOSED] },
  }).select('poNumber currentStage').lean();

  if (clash) {
    throw new O2dWorkflowError(
      `${order.poNumber} was re-entered as a new order after this one was ${order.status.toLowerCase()}, `
        + 'and two live orders cannot share a PO number. Cancel the replacement first if this one is the real order.',
      { status: 409, code: 'O2D_REVIVE_WOULD_DUPLICATE' },
    );
  }

  const previousStatus = order.status;
  order.status = ORDER_STATUS.OPEN;
  order.updatedBy = actor?._id ?? null;
  await order.save();

  // Unpark exactly the stages the exit parked: the open one becomes workable
  // again, and the ones after it stay locked behind it.
  await O2dOrderStage.updateMany(
    { order: order._id, status: STAGE_STATUS.ON_HOLD, stageNumber: { $lt: order.currentStage } },
    { $set: { status: STAGE_STATUS.LOCKED } },
  );
  await O2dOrderStage.updateOne(
    { order: order._id, stageNumber: order.currentStage, status: STAGE_STATUS.ON_HOLD },
    { $set: { status: STAGE_STATUS.PENDING } },
  );
  await O2dOrderStage.updateMany(
    { order: order._id, status: STAGE_STATUS.ON_HOLD, stageNumber: { $gt: order.currentStage } },
    { $set: { status: STAGE_STATUS.LOCKED } },
  );

  // Stamped on the most recent un-revived exit, so a twice-exited order reads
  // in the right order.
  const entry = await O2dExitRegister.findOne({ order: order._id, revivedAt: null })
    .sort({ exitedAt: -1 });
  if (entry) {
    entry.revivedAt = now;
    entry.revivedBy = actor?._id ?? null;
    entry.revivalReason = reason.trim();
    await entry.save();
  }

  await recordAudit(actor ?? null, O2D_AUDIT_ACTIONS.ORDER_REOPENED,
    `${order.poNumber} revived from ${previousStatus.toLowerCase()} — ${reason.trim()}`, req,
    {
      meta: {
        orderId: String(order._id),
        poNumber: order.poNumber,
        from: previousStatus,
        to: ORDER_STATUS.OPEN,
        resumedAtStage: order.currentStage,
        reason: reason.trim(),
        // Stated explicitly because it is the surprising part: a revived order
        // keeps the deadlines it already missed.
        deadlinesRecomputed: false,
      },
    });

  return { order: await O2dOrder.findById(order._id), entry: entry?.toObject() ?? null };
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/**
 * Everything not moving: departures from the collection, holds from the orders.
 *
 * See the note at the top for why holds are derived rather than stored. The two
 * sources are unioned into one shape so the screen renders a single table.
 */
export async function listExitRegister(query = {}) {
  const { exitType, from, to, includeRevived = false, page = 1, pageSize = 50 } = query;

  const wantHeld = !exitType || exitType === ORDER_STATUS.ON_HOLD;
  const wantExits = !exitType || EXITED.includes(exitType);

  let exits = [];
  if (wantExits) {
    const filter = {};
    if (exitType) filter.exitType = exitType;
    if (!includeRevived) filter.revivedAt = null;
    if (from || to) {
      filter.exitedAt = {};
      if (from) filter.exitedAt.$gte = new Date(from);
      if (to) filter.exitedAt.$lte = new Date(to);
    }
    exits = (await O2dExitRegister.find(filter).sort({ exitedAt: -1 }).lean()).map((e) => ({
      kind: 'EXIT',
      exitType: e.exitType,
      orderId: e.order,
      poNumber: e.poNumber,
      customerName: e.customerName,
      stageAtExit: e.stageAtExit,
      stageNameAtExit: e.stageNameAtExit,
      reason: e.reason,
      remarks: e.remarks,
      at: e.exitedAt,
      byName: e.exitedByName,
      revivedAt: e.revivedAt ?? null,
      registerId: e._id,
    }));
  }

  let held = [];
  if (wantHeld) {
    const heldOrders = await O2dOrder.find({ status: ORDER_STATUS.ON_HOLD })
      .select('poNumber customerName currentStage holds')
      .lean();

    held = heldOrders.map((o) => {
      const active = (o.holds ?? []).find((h) => !h.resumedAt) ?? null;
      return {
        kind: 'HOLD',
        exitType: ORDER_STATUS.ON_HOLD,
        orderId: o._id,
        poNumber: o.poNumber,
        customerName: o.customerName,
        stageAtExit: active?.stageNumber ?? o.currentStage,
        stageNameAtExit: null,
        reason: active?.reason ?? null,
        remarks: active?.note ?? null,
        at: active?.startedAt ?? null,
        byName: null,
        revivedAt: null,
        registerId: null,
      };
    });

    if (from || to) {
      held = held.filter((h) => {
        if (!h.at) return false;
        if (from && new Date(h.at) < new Date(from)) return false;
        if (to && new Date(h.at) > new Date(to)) return false;
        return true;
      });
    }
  }

  const all = [...exits, ...held].sort(
    (a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0),
  );
  const start = (page - 1) * pageSize;

  return { data: all.slice(start, start + pageSize), total: all.length, page, pageSize };
}

/**
 * "Where do orders die?" — the count by stage, which is the register's whole
 * analytical point (§29). Revived exits are excluded: an order that came back
 * did not die there.
 */
export async function exitsByStage({ from = null, to = null } = {}) {
  const match = { revivedAt: null };
  if (from || to) {
    match.exitedAt = {};
    if (from) match.exitedAt.$gte = new Date(from);
    if (to) match.exitedAt.$lte = new Date(to);
  }

  return O2dExitRegister.aggregate([
    { $match: match },
    {
      $group: {
        _id: { stageAtExit: '$stageAtExit', exitType: '$exitType' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        stageAtExit: '$_id.stageAtExit',
        exitType: '$_id.exitType',
        count: 1,
      },
    },
    { $sort: { stageAtExit: 1, exitType: 1 } },
  ]);
}

export default { cancelOrder, voidOrder, reviveOrder, listExitRegister, exitsByStage, DISPATCH_STAGE };
