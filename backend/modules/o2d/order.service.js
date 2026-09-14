/**
 * Order intake and the order header.
 *
 * ---------------------------------------------------------------------------
 * WHAT LIVES HERE AND WHAT LIVES IN THE ENGINE
 * ---------------------------------------------------------------------------
 *
 * This file owns the ORDER: creating it, its lines, its header fields, reading
 * it back. It owns no transitions. The moment an order needs to move, it calls
 * the stage engine, which is the only thing permitted to write a stage row
 * (§53).
 *
 * The one place that looks like an exception is `decideAdvance`, which writes
 * `advanceRequired` on the header and then completes stage 4 — and, when the
 * answer is no, skips stage 5. Both of those go through the engine; what this
 * function adds is the header field and the ORDERING, which is the part that is
 * easy to get wrong: skipping 5 before completing 4 leaves stage 5 skipped while
 * stage 4 is still the current stage.
 */

import mongoose from 'mongoose';

import { O2dOrder, o2dKey } from '../../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import { O2dOrderItem } from '../../models/o2d/O2dOrderItem.js';
import { O2dStageMaster } from '../../models/o2d/O2dStageMaster.js';
// Imported for its SIDE EFFECT as well as nothing else: `getOrder` populates
// `customer` and `salesPerson`, which are refs to 'User'. Mongoose resolves a
// ref by name at query time, so the model must have been registered by SOMEBODY
// first. Leaving that to whichever other import happened to pull it in works
// under the server (app.js imports the user routes) and fails in a migration
// script or a test that imports only this service.
import '../../models/User.js';
import { recordAudit } from '../../utils/auditLog.js';
import { isSuperAdmin } from '../../middlewares/rbac.js';
import {
  STAGES,
  STAGE_STATUS,
  ORDER_STATUS,
  TERMINAL_STAGE_STATUSES,
  O2D_AUDIT_ACTIONS,
  DUE_SOON_THRESHOLD,
} from '../../shared/constants/o2d.js';
import {
  createStagesForOrder,
  completeStage,
  skipStage,
  O2dWorkflowError,
} from './stage.engine.js';
import { resolveBookingForIntake } from './booking.service.js';

/** Statuses that make an order "live" for the purposes of §26's uniqueness. */
const LIVE_STATUSES = [ORDER_STATUS.OPEN, ORDER_STATUS.ON_HOLD, ORDER_STATUS.CLOSED];

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/**
 * Is there already a live order with this PO number for this customer?
 *
 * §26 asks for a duplicate CHECK at entry. Returning the offending order rather
 * than a boolean is the point: "PO-4471 already exists" is not actionable, and
 * "PO-4471 was entered on 3 September by Ramesh and is at stage 7" tells Sales
 * immediately whether they are looking at a genuine reissue or their own
 * double-entry.
 *
 * Children of a split parent are excluded — they share a PO number by design.
 */
export async function findDuplicateOrder(poNumber, customerName) {
  return O2dOrder.findOne({
    poNumberKey: o2dKey(poNumber),
    customerKey: o2dKey(customerName),
    parentOrder: null,
    status: { $in: LIVE_STATUSES },
  })
    .select('poNumber poDate customerName currentStage status createdAt createdBy')
    .lean();
}

/**
 * Roll the line quantities up onto the header.
 *
 * The header carries totals so the tracker need not aggregate items for every
 * one of a thousand rows. Recomputed from the lines rather than incremented, so
 * it cannot drift after an edit that replaces them.
 */
async function recomputeTotals(orderId) {
  const [totals] = await O2dOrderItem.aggregate([
    { $match: { order: new mongoose.Types.ObjectId(String(orderId)) } },
    {
      $group: {
        _id: null,
        totalOrderedQty: { $sum: '$orderedQty' },
        totalDispatchedQty: { $sum: '$dispatchedQty' },
      },
    },
  ]);

  await O2dOrder.updateOne(
    { _id: orderId },
    {
      $set: {
        totalOrderedQty: totals?.totalOrderedQty ?? 0,
        totalDispatchedQty: totals?.totalDispatchedQty ?? 0,
      },
    },
  );
}

/**
 * Create an order, its lines and its twelve stages.
 *
 * @param {object} input     validated by `createO2dOrderSchema`
 * @param {object} actor     the user keying it in
 * @param {object} [ctx]     `{ req }`, for the audit entry
 */
export async function createOrder(input, actor, { req = null, now = new Date() } = {}) {
  const {
    poNumber,
    poDate,
    customer = null,
    customerName,
    sourceBookingId = null,
    salesPerson = null,
    promiseDate = null,
    promiseDateOverrideReason = null,
    stockStatus = null,
    remarks = null,
    items = [],
  } = input;

  // §27. A missing promise date is allowed only as a deliberate, attributed
  // exception — the reason is stored ON the order, so the gap is visible on the
  // tracker rather than inferred from a null six weeks later.
  if (!promiseDate && !promiseDateOverrideReason?.trim()) {
    throw new O2dWorkflowError(
      'A promise date is required. If this order genuinely has none, give a reason and it will be recorded against the order.',
      { status: 400, code: 'O2D_PROMISE_DATE_REQUIRED' },
    );
  }

  const poAt = new Date(poDate);
  if (poAt > now) {
    throw new O2dWorkflowError('A PO cannot be dated in the future.', {
      status: 400,
      code: 'O2D_FUTURE_PO_DATE',
    });
  }
  if (promiseDate && new Date(promiseDate) < poAt) {
    throw new O2dWorkflowError('The promise date is before the PO date.', {
      status: 400,
      code: 'O2D_PROMISE_BEFORE_PO',
    });
  }

  /**
   * §26: one live order per (PO number, customer).
   *
   * ⚠ A BAN, NOT A WARNING — and the ambiguity is worth stating. §26 asks for a
   * "duplicate PO check", which could mean a warning Sales may click past. It is
   * enforced as a refusal because the O2dOrder collection carries a PARTIAL
   * UNIQUE INDEX on (poNumberKey, customerKey) over live orders: a warning would
   * be a lie, since the database rejects the insert either way. Offering an
   * override that cannot work is worse than not offering one.
   *
   * The escape hatch is real and already correct: a cancelled or void order
   * frees the number, so a customer who genuinely reissues "PO-4471" is handled
   * by cancelling the superseded order — which leaves a reason in the exit
   * register instead of two live orders nobody can tell apart.
   */
  const duplicate = await findDuplicateOrder(poNumber, customerName);
  if (duplicate) {
    const error = new O2dWorkflowError(
      `${duplicate.poNumber} is already open for ${duplicate.customerName} — entered on `
        + `${new Date(duplicate.poDate).toISOString().slice(0, 10)} and currently at stage `
        + `${duplicate.currentStage}. If that order has been superseded, cancel it first; `
        + 'the PO number is then free to use again.',
      { status: 409, code: 'O2D_DUPLICATE_PO' },
    );
    // The UI needs the offender to render "view the existing order".
    error.duplicate = duplicate;
    throw error;
  }

  /**
   * The Customer Portal booking, resolved BEFORE the write (§3, §28).
   *
   * Deliberately after the duplicate-PO check and before `O2dOrder.create`, so
   * a request that fails either rule writes nothing at all. `resolveBookingForIntake`
   * refuses a booking that is missing, already converted, or filed under a
   * different customer — see that function for why each is a refusal rather
   * than a warning.
   *
   * `sourceBookingId` absent is the ordinary case, not an error: a PO that
   * arrives by email has no portal booking behind it.
   */
  const bookingLink = sourceBookingId
    ? (await resolveBookingForIntake(sourceBookingId, { customerName })).link
    : null;

  const order = await O2dOrder.create({
    poNumber: String(poNumber).trim(),
    poNumberKey: o2dKey(poNumber),
    poDate: poAt,
    // The booking's customer wins when Sales did not name one: it came from the
    // customer's own portal account, and is therefore better evidence than a
    // field left blank on the intake form.
    customer: customer ?? bookingLink?.customer ?? null,
    customerName: String(customerName).trim(),
    customerKey: o2dKey(customerName),
    sourceBooking: bookingLink
      ? { ...bookingLink, linkedAt: now, linkedBy: actor?._id ?? null }
      : null,
    salesPerson: salesPerson ?? actor?._id ?? null,
    salesPersonName: salesPerson ? null : (actor?.user ?? actor?.email ?? null),
    promiseDate: promiseDate ? new Date(promiseDate) : null,
    // Stamped only when the exception was actually used, so a normal order does
    // not carry an empty override that reads as one.
    promiseDateOverrideBy: promiseDate ? null : (actor?._id ?? null),
    promiseDateOverrideReason: promiseDate ? null : promiseDateOverrideReason.trim(),
    stockStatus,
    remarks,
    createdBy: actor?._id ?? null,
    updatedBy: actor?._id ?? null,
  });

  if (items.length > 0) {
    await O2dOrderItem.insertMany(
      items.map((item, i) => ({
        order: order._id,
        skuCode: String(item.skuCode).trim(),
        productName: item.productName ?? null,
        // Default to the order they were entered in — the customer's PO order.
        lineSeq: item.lineSeq ?? i + 1,
        orderedQty: item.orderedQty,
        stockStatus: item.stockStatus ?? null,
        remarks: item.remarks ?? null,
      })),
    );
    await recomputeTotals(order._id);
  }

  // Creating the order IS stage 1, and completing it unlocks stage 2.
  const { events } = await createStagesForOrder(order, { actor, now });

  await recordAudit(
    actor ?? null,
    O2D_AUDIT_ACTIONS.ORDER_CREATED,
    `${order.poNumber} created for ${order.customerName}`
      ,
    req,
    {
      meta: {
        orderId: String(order._id),
        poNumber: order.poNumber,
        customerName: order.customerName,
        poDate: order.poDate,
        promiseDate: order.promiseDate,
        // The override, recorded where an auditor will look for it.
        promiseDateOverridden: !order.promiseDate,
        promiseDateOverrideReason: order.promiseDateOverrideReason,
        // §25: the booking this order was raised from, recorded at creation so
        // the audit answers "where did this come from" without reading the
        // order document as it stands today.
        sourceBookingId: bookingLink?.bookingId ?? null,
        itemCount: items.length,
      },
    },
  );

  return { order: await O2dOrder.findById(order._id), events };
}

/**
 * Edit header fields. Never touches stages, status or position.
 *
 * Changing the promise date is the interesting one: §27's override applies to
 * CLEARING it too, so the same rule is enforced on update rather than only at
 * intake — otherwise the requirement is satisfied by creating an order with a
 * date and immediately removing it.
 */
export async function updateOrder(orderId, patch, actor, { req = null } = {}) {
  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  if (order.status === ORDER_STATUS.CANCELLED || order.status === ORDER_STATUS.VOID) {
    throw new O2dWorkflowError(
      `This order was ${order.status.toLowerCase()} and cannot be edited.`,
      { code: 'O2D_ORDER_EXITED' },
    );
  }

  const before = {
    promiseDate: order.promiseDate,
    customerName: order.customerName,
    stockStatus: order.stockStatus,
  };

  if ('promiseDate' in patch) {
    const next = patch.promiseDate ? new Date(patch.promiseDate) : null;
    if (!next && !patch.promiseDateOverrideReason?.trim()) {
      throw new O2dWorkflowError(
        'Removing the promise date needs a reason, which is recorded against the order.',
        { status: 400, code: 'O2D_PROMISE_DATE_REQUIRED' },
      );
    }
    if (next && next < order.poDate) {
      throw new O2dWorkflowError('The promise date is before the PO date.', {
        status: 400,
        code: 'O2D_PROMISE_BEFORE_PO',
      });
    }
    order.promiseDate = next;
    order.promiseDateOverrideBy = next ? null : (actor?._id ?? null);
    order.promiseDateOverrideReason = next ? null : patch.promiseDateOverrideReason.trim();
  }

  // The customer is part of the order's identity (§26), so a rename has to keep
  // the index key in step or the duplicate check silently stops matching.
  if (patch.customerName !== undefined) {
    order.customerName = String(patch.customerName).trim();
    order.customerKey = o2dKey(patch.customerName);
  }
  if (patch.customer !== undefined) order.customer = patch.customer;
  if (patch.salesPerson !== undefined) order.salesPerson = patch.salesPerson;
  if (patch.stockStatus !== undefined) order.stockStatus = patch.stockStatus;
  if (patch.remarks !== undefined) order.remarks = patch.remarks;

  order.updatedBy = actor?._id ?? null;
  await order.save();

  await recordAudit(actor ?? null, O2D_AUDIT_ACTIONS.ORDER_UPDATED,
    `${order.poNumber} header updated`, req,
    {
      meta: {
        orderId: String(order._id),
        poNumber: order.poNumber,
        from: before,
        to: {
          promiseDate: order.promiseDate,
          customerName: order.customerName,
          stockStatus: order.stockStatus,
        },
      },
    });

  return order;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * Replace every line on the order.
 *
 * A wholesale replace rather than per-line edits, because that is how the intake
 * screen works: a grid the user edits and saves. The guard is that lines cannot
 * be replaced once the warehouse has acted on them — reprinting a picklist
 * against different lines than were picked is how the wrong goods ship.
 */
export async function replaceItems(orderId, items, actor, { req = null } = {}) {
  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  const picking = await O2dOrderStage.findOne({
    order: order._id,
    stageNumber: STAGES.WAREHOUSE_PICKING,
    status: { $in: TERMINAL_STAGE_STATUSES },
  }).lean();

  if (picking) {
    throw new O2dWorkflowError(
      'The warehouse has already acknowledged the picking request, so the lines are fixed. '
        + 'Raise a revision instead.',
      { code: 'O2D_ITEMS_LOCKED' },
    );
  }

  const previousCount = await O2dOrderItem.countDocuments({ order: order._id });

  await O2dOrderItem.deleteMany({ order: order._id });
  await O2dOrderItem.insertMany(
    items.map((item, i) => ({
      order: order._id,
      skuCode: String(item.skuCode).trim(),
      productName: item.productName ?? null,
      lineSeq: item.lineSeq ?? i + 1,
      orderedQty: item.orderedQty,
      stockStatus: item.stockStatus ?? null,
      remarks: item.remarks ?? null,
    })),
  );
  await recomputeTotals(order._id);

  await recordAudit(actor ?? null, O2D_AUDIT_ACTIONS.ORDER_UPDATED,
    `${order.poNumber} lines replaced — ${previousCount} line(s) became ${items.length}`, req,
    {
      meta: {
        orderId: String(order._id),
        poNumber: order.poNumber,
        from: { lineCount: previousCount },
        to: { lineCount: items.length },
      },
    });

  return listItems(order._id);
}

/**
 * The order's lines, in the customer's PO sequence.
 *
 * `remainingQty` is added HERE rather than left to the schema virtual, because
 * a `.lean()` read does not run virtuals — mongoose needs the lean-virtuals
 * plugin for that, and it is not installed. Relying on the virtual would return
 * `undefined` to every screen while the model still looked correct.
 */
export const listItems = async (orderId) => {
  const rows = await O2dOrderItem.find({ order: orderId })
    .sort({ lineSeq: 1, createdAt: 1 })
    .lean();
  return rows.map((r) => ({
    ...r,
    remainingQty: Math.max(0, (r.orderedQty ?? 0) - (r.dispatchedQty ?? 0)),
  }));
};

// ---------------------------------------------------------------------------
// Stage 4 — the advance decision
// ---------------------------------------------------------------------------

/**
 * Answer stage 4, and deal with stage 5 accordingly.
 *
 * §8–9: "yes" leaves stage 5 to be completed by Accounts when the money lands;
 * "no" skips it, which is the ONLY skip the workflow defines today.
 *
 * ORDER MATTERS. Stage 4 is completed FIRST so that the order's cursor is past
 * it before stage 5 is skipped; skipping first would leave the cursor sitting on
 * a stage 4 that is complete, because the engine advances the cursor from the
 * stage it just closed.
 */
export async function decideAdvance(orderId, { advanceRequired, actualCompletion = null, remarks = null },
  actor, { req = null, now = new Date() } = {}) {
  const order = await O2dOrder.findById(orderId);
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  const decidedAt = actualCompletion ? new Date(actualCompletion) : now;

  const { events } = await completeStage({
    orderId: order._id,
    stageNumber: STAGES.ADVANCE_DECISION,
    actor,
    actualCompletion,
    now,
    remarks,
    evidence: { advanceRequired },
  });

  // Stamped after the engine accepted the transition, so a refused completion
  // does not leave a decision recorded on the header.
  await O2dOrder.updateOne(
    { _id: order._id },
    {
      $set: {
        advanceRequired,
        advanceDecidedAt: decidedAt,
        advanceDecidedBy: actor?._id ?? null,
        updatedBy: actor?._id ?? null,
      },
    },
  );

  const all = [...events];

  if (advanceRequired === false) {
    const skipped = await skipStage({
      orderId: order._id,
      stageNumber: STAGES.RECEIVE_ADVANCE,
      actor,
      reason: 'Not an advance-payment order — decided at stage 4.',
      now,
    });
    all.push(...skipped.events);
  }

  await recordAudit(actor ?? null, O2D_AUDIT_ACTIONS.ORDER_UPDATED,
    `${order.poNumber} — advance payment ${advanceRequired ? 'REQUIRED' : 'not required'}`, req,
    {
      meta: {
        orderId: String(order._id),
        poNumber: order.poNumber,
        from: { advanceRequired: order.advanceRequired },
        to: { advanceRequired },
        // The consequence, recorded explicitly: a skipped stage 5 leaves the
        // KPI, and the trail should say why it did.
        stage5Skipped: advanceRequired === false,
      },
    });

  return { order: await O2dOrder.findById(order._id), events: all };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The first stage from which the Imports team may see an order.
 *
 * §20: "Imports - View orders from Stage 06". Stage 6 is where the order list is
 * created, which is the first moment procurement has anything to plan against.
 */
export const IMPORTS_VISIBLE_FROM_STAGE = STAGES.CREATE_ORDER_LIST;

/**
 * Extra filter narrowing what a role may see. `null` means no narrowing.
 *
 * THIS IS A VISIBILITY SCOPE, NOT A PERMISSION, and the difference is why it
 * lives here rather than in `config/permissions.js`. `VIEW_O2D` answers "may
 * this role open the tracker at all"; it cannot answer "which rows", because the
 * answer depends on each order's current position - a fact about data, not about
 * the role.
 *
 * Enforced in the SERVICE rather than the controller so that every read path
 * inherits it: the tracker, Order 360, an export, and any future screen that
 * calls `listOrders`. A check in one controller is a check the next screen
 * forgets.
 */
export function viewScopeFor(user) {
  if (!user?.role) return null;
  if (isSuperAdmin(user)) return null;

  // Named explicitly rather than derived from "holds only VIEW_O2D": several
  // roles hold view-only O2D access, and only Imports is scoped by stage.
  if (user.role === 'Import Team') {
    return { minStage: IMPORTS_VISIBLE_FROM_STAGE };
  }

  return null;
}


/**
 * The tracker's list.
 *
 * `overdueOnly` is the one filter that cannot be answered from the header: being
 * late is a property of the OPEN STAGE's deadline, not of the order. It is
 * resolved by finding the overdue stages first and filtering orders to those —
 * which is indexed (`ownerRole, status, plannedCompletion`) and bounded, where
 * the alternative (a $lookup per order) is neither.
 */
/**
 * Add an id restriction that INTERSECTS any already present.
 *
 * `stageReached` and `overdueOnly` both narrow by id, and assigning
 * `filter._id` twice would silently drop the first — so asking for "overdue
 * orders that have passed stage 7" would quietly return every overdue order.
 */
const narrowById = (filter, ids) => {
  const next = ids.map(String);
  if (!filter._id) {
    filter._id = { $in: ids };
    return;
  }
  const already = new Set(filter._id.$in.map(String));
  filter._id = { $in: ids.filter((id) => already.has(String(id))) };
};

export async function listOrders(query = {}, viewer = null) {
  const {
    page = 1, pageSize = 50, search, status, currentStage, customerKey, salesPerson,
    from, to, overdueOnly = false, sortBy = 'poDate', sortDir = 'desc',
    /**
     * Orders that have REACHED this stage, whether or not they are still in it.
     *
     * `currentStage` answers "what is sitting here now"; this answers "what has
     * passed through here". They are different questions and the second one was
     * previously unanswerable: an order completed at stage 2 left the stage-2
     * board entirely, so the stage screen could never show its own history.
     *
     * Each returned order carries `stageStatus` — its status AT THIS STAGE —
     * so a row can read Completed, In Progress or Not started without the
     * caller fetching twelve stage rows per order to work it out.
     */
    stageReached,
  } = query;

  const filter = {};
  if (status?.length) filter.status = { $in: status };
  else filter.status = { $in: [ORDER_STATUS.OPEN, ORDER_STATUS.ON_HOLD] };

  if (currentStage) filter.currentStage = currentStage;

  /**
   * Reached, not merely LOCKED.
   *
   * A stage row exists for all twelve from the moment the order is created, so
   * "has a stage-7 row" is true of every order ever. What marks arrival is the
   * row no longer being LOCKED — it has been unlocked, worked, held, skipped or
   * finished.
   */
  let stageStatusByOrder = null;
  if (stageReached) {
    const reached = await O2dOrderStage.find({
      stageNumber: Number(stageReached),
      status: { $ne: STAGE_STATUS.LOCKED },
    }).select('order status actualCompletion completedByName').lean();

    if (reached.length === 0) return { data: [], total: 0, page, pageSize };

    stageStatusByOrder = new Map(
      reached.map((r) => [String(r.order), {
        status: r.status,
        actualCompletion: r.actualCompletion ?? null,
        completedByName: r.completedByName ?? null,
      }]),
    );
    narrowById(filter, reached.map((r) => r.order));
  }
  if (customerKey) filter.customerKey = o2dKey(customerKey);
  if (salesPerson) filter.salesPerson = salesPerson;

  if (from || to) {
    filter.poDate = {};
    if (from) filter.poDate.$gte = new Date(from);
    if (to) filter.poDate.$lte = new Date(to);
  }

  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ poNumber: rx }, { customerName: rx }, { invoiceNumber: rx }];
  }

  // Role scope last, so nothing above can widen it. A caller who filters to a
  // stage below their floor gets nothing, rather than having the filter quietly
  // replaced by the floor.
  const scope = viewScopeFor(viewer);
  if (scope?.minStage) {
    if (currentStage && currentStage < scope.minStage) {
      return { data: [], total: 0, page, pageSize };
    }
    if (!currentStage) filter.currentStage = { $gte: scope.minStage };
  }

  if (overdueOnly) {
    const lateStageOrderIds = await O2dOrderStage.distinct('order', {
      status: { $nin: TERMINAL_STAGE_STATUSES },
      plannedCompletion: { $lt: new Date() },
    });
    narrowById(filter, lateStageOrderIds);
  }

  const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };
  const skip = (page - 1) * pageSize;

  const [rows, total] = await Promise.all([
    O2dOrder.find(filter).sort(sort).skip(skip).limit(pageSize).lean(),
    O2dOrder.countDocuments(filter),
  ]);

  return {
    // `stageStatus` rides along ONLY when the caller asked about a stage, so a
    // plain tracker row is unchanged and nothing has to guess which stage a
    // bare status would refer to.
    data: stageStatusByOrder
      ? rows.map((r) => ({ ...r, stageStatus: stageStatusByOrder.get(String(r._id)) ?? null }))
      : rows,
    total,
    page,
    pageSize,
  };
}

/**
 * One order, with everything Order 360 renders (§22).
 *
 * Stages, items and holds in a single call rather than three round trips —
 * the screen shows them together and there is no view that wants one without
 * the others.
 */
export async function getOrder(orderId, viewer = null) {
  const order = await O2dOrder.findById(orderId)
    .populate('customer', 'user email')
    .populate('salesPerson', 'user email')
    .lean();
  if (!order) throw new O2dWorkflowError('That order no longer exists.', { status: 404 });

  // 404 rather than 403, for the same reason the portal fence answers 404:
  // telling a scoped viewer that an order exists but is too early for them
  // leaks both its existence and its position.
  const scope = viewScopeFor(viewer);
  if (scope?.minStage && order.currentStage < scope.minStage) {
    throw new O2dWorkflowError('That order no longer exists.', { status: 404 });
  }

  const [stages, items] = await Promise.all([
    O2dOrderStage.find({ order: orderId }).sort({ stageNumber: 1 }).lean(),
    listItems(orderId),
  ]);

  return { order, stages, items };
}

/**
 * Which bucket is this stage in — overdue, due soon, or on track?
 *
 * Shared by My Tasks and the tracker so the two cannot disagree about what
 * "due soon" means. §14 defines it as the last 20% of the allowance, which is
 * `DUE_SOON_THRESHOLD` — a proportion rather than a fixed number of minutes,
 * because 20% of a 5-minute SLA and 20% of a 12-hour one are different warnings
 * and both are wanted.
 */
export function bucketFor(stage, at = new Date()) {
  if (!stage?.plannedCompletion) return 'on_track';
  const due = new Date(stage.plannedCompletion).getTime();
  const now = at.getTime();
  if (now > due) return 'overdue';

  const start = stage.plannedStart ? new Date(stage.plannedStart).getTime() : null;
  if (!start || due <= start) return 'on_track';

  return (now - start) / (due - start) >= DUE_SOON_THRESHOLD ? 'due_soon' : 'on_track';
}

/**
 * Stage statuses that mean the stage is OPEN — being worked right now.
 *
 * Not simply "not terminal": LOCKED is not terminal either, and a locked stage
 * is a stage nobody is working. The board counts work in progress, so both ends
 * of the lifecycle are excluded.
 */
const OPEN_STAGE_STATUSES = [
  STAGE_STATUS.PENDING,
  STAGE_STATUS.DUE_SOON,
  STAGE_STATUS.OVERDUE,
  STAGE_STATUS.ON_HOLD,
];

/**
 * The stage board — how many live orders sit at each of the twelve stages,
 * and how many of those are late (§27: "stage-wise pending orders").
 *
 * ---------------------------------------------------------------------------
 * WHY THE BUCKETS ARE COMPUTED IN NODE AND NOT IN THE AGGREGATION
 * ---------------------------------------------------------------------------
 *
 * "Overdue" and "due soon" are defined by `bucketFor`, which reads
 * `plannedStart` and `plannedCompletion` and applies `DUE_SOON_THRESHOLD`.
 * Re-expressing that formula as a `$expr` would be a SECOND definition of the
 * same rule, and the failure it invites is silent: the board would report a
 * different number of overdue orders than My Tasks and the tracker show for the
 * same data, and nobody could say which was right.
 *
 * So the open stage rows are read and bucketed by the very function the other
 * two screens use. The cost is bounded — one open stage per live order — and it
 * buys the property that actually matters, which is that all three screens
 * cannot disagree.
 *
 * The TOTALS still come from an aggregate on `currentStage`, which is indexed
 * and does not need the stage rows at all.
 *
 * Role scope is applied, so this is not a back door: an Import Team account
 * sees counts only from `IMPORTS_VISIBLE_FROM_STAGE` upward, exactly as the
 * tracker shows them.
 */
export async function stageBoard(viewer = null, { now = new Date() } = {}) {
  const liveFilter = { status: { $in: [ORDER_STATUS.OPEN, ORDER_STATUS.ON_HOLD] } };

  const scope = viewScopeFor(viewer);
  if (scope?.minStage) liveFilter.currentStage = { $gte: scope.minStage };

  const [masters, byStage, liveOrders] = await Promise.all([
    O2dStageMaster.find({ enabled: true })
      .select('stageNumber key name ownerRole')
      .sort({ stageNumber: 1 })
      .lean(),
    O2dOrder.aggregate([
      { $match: liveFilter },
      {
        $group: {
          _id: '$currentStage',
          total: { $sum: 1 },
          onHold: {
            $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.ON_HOLD] }, 1, 0] },
          },
        },
      },
    ]),
    O2dOrder.find(liveFilter).select('_id').lean(),
  ]);

  const openStages = await O2dOrderStage.find({
    order: { $in: liveOrders.map((o) => o._id) },
    status: { $in: OPEN_STAGE_STATUSES },
  })
    .select('stageNumber plannedStart plannedCompletion')
    .lean();

  const buckets = new Map();
  for (const stage of openStages) {
    const row = buckets.get(stage.stageNumber) ?? { overdue: 0, dueSoon: 0 };
    const bucket = bucketFor(stage, now);
    if (bucket === 'overdue') row.overdue += 1;
    else if (bucket === 'due_soon') row.dueSoon += 1;
    buckets.set(stage.stageNumber, row);
  }

  const totals = new Map(byStage.map((r) => [r._id, r]));

  // Driven by the stage MASTER, not by the orders: a stage with nothing in it
  // must still appear, as an empty column. Omitting it would make "no orders at
  // stage 7" indistinguishable from "stage 7 does not exist", and the board's
  // main job is showing where work has piled up — including where it has not.
  return masters.map((master) => {
    const total = totals.get(master.stageNumber);
    const bucket = buckets.get(master.stageNumber) ?? { overdue: 0, dueSoon: 0 };
    return {
      stageNumber: master.stageNumber,
      key: master.key,
      name: master.name,
      ownerRole: master.ownerRole,
      total: total?.total ?? 0,
      onHold: total?.onHold ?? 0,
      overdue: bucket.overdue,
      dueSoon: bucket.dueSoon,
    };
  });
}

export default {
  createOrder,
  updateOrder,
  replaceItems,
  listItems,
  decideAdvance,
  listOrders,
  getOrder,
  findDuplicateOrder,
  bucketFor,
  viewScopeFor,
  stageBoard,
};
