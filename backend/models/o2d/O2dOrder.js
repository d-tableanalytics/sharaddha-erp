/**
 * An O2D order — one customer purchase order moving through the twelve stages.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY ITS OWN COLLECTION
 * ---------------------------------------------------------------------------
 *
 * The Customer Portal has an `Order` model with many of the same fields. This is
 * NOT that, by explicit decision: O2D tracks a PO that arrives by email and is
 * keyed into the ERP by Sales, whereas `Order` is a booking a customer placed in
 * the portal. Keeping them apart means the Employee Portal needs no cross-domain
 * read, and the domain boundary built in `portal-boundary.test.js` holds.
 *
 * The cost is honest and worth stating: a booking that becomes a PO exists in
 * both places, and nothing reconciles them today. If that turns out to matter,
 * the link is `poNumber` + customer, and it belongs in a reconciliation service
 * rather than in either model.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOCUMENT IS, AND IS NOT
 * ---------------------------------------------------------------------------
 *
 * It is the HEADER: identity, parties, dates, current position, status. It is
 * not the stages (`O2dOrderStage`, twelve rows) and not the lines
 * (`O2dOrderItem`). §35 asks for that split explicitly — "do not create one
 * giant O2D table" — and it earns itself immediately: the tracker reads headers
 * only, and My Tasks reads stages only.
 */

import mongoose from 'mongoose';

import {
  ORDER_STATUS,
  ORDER_STATUS_LIST,
  HOLD_REASONS,
  STAGE_NUMBERS,
} from '../../shared/constants/o2d.js';

/**
 * One hold, and its resume.
 *
 * Embedded rather than a collection: holds are few, always read with their
 * order, and never queried across orders. The SLA engine needs the whole history
 * to compute frozen time, so keeping it on the document avoids a join on every
 * deadline calculation.
 */
const holdSchema = new mongoose.Schema(
  {
    reason: { type: String, required: true, enum: HOLD_REASONS },
    /** Free text, mandatory at the service layer — §19 requires a reason. */
    note: { type: String, default: null, trim: true, maxlength: 500 },

    startedAt: { type: Date, required: true },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    resumedAt: { type: Date, default: null },
    resumedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * Working minutes frozen, stamped at resume.
     *
     * Computed once and stored rather than derived on every read: the holiday
     * calendar can change, and a hold's cost must not move because someone later
     * declared a holiday in the middle of it.
     */
    heldWorkingMinutes: { type: Number, default: null },

    /** Which stage was open when the hold was placed — for the timeline. */
    stageNumber: { type: Number, default: null, enum: [...STAGE_NUMBERS, null] },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: true },
);

const o2dOrderSchema = new mongoose.Schema(
  {
    // ── Identity ───────────────────────────────────────────────────────────
    /**
     * The customer's PO number, as written on their document.
     *
     * Not unique on its own: two customers may each have a "PO-001". §26 makes
     * the pair the identity, and the partial index below enforces it over live
     * orders only, so a cancelled PO number can be reissued.
     */
    poNumber: { type: String, required: true, trim: true, maxlength: 80 },

    /** Uppercased, whitespace-collapsed `poNumber`, for the uniqueness index. */
    poNumberKey: { type: String, required: true, index: true },

    poDate: { type: Date, required: true },

    /**
     * A child of a partially dispatched parent — `PO-123/1`, `PO-123/2`.
     *
     * §24: one PO may ship in batches. The early stages stay on the parent; each
     * child carries its own dispatch-side stages and its own quantities.
     */
    parentOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', default: null },
    splitIndex: { type: Number, default: null },

    // ── Parties ────────────────────────────────────────────────────────────
    /**
     * The customer account, in the SHARED users collection.
     *
     * A reference rather than a copied name, because `users` is genuinely shared
     * between the two portals and is the one customer master. `customerName` is
     * stamped alongside it for the tracker, which renders thousands of rows and
     * must not populate for each.
     */
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    customerName: { type: String, required: true, trim: true, maxlength: 200 },
    customerKey: { type: String, required: true, index: true },

    salesPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    salesPersonName: { type: String, default: null, trim: true, maxlength: 200 },

    /**
     * The Customer Portal booking this order was raised from (§3, §28).
     *
     * The header comment above says O2D and the customer `Order` collection are
     * deliberately separate, and that "the link is `poNumber` + customer, and it
     * belongs in a reconciliation service". This is that link, made explicit and
     * stored rather than inferred — `poNumber` + customer turned out to be the
     * wrong key, because Sales keys the PO number in by hand AFTER the booking
     * exists, and a typo there would silently break the reconciliation.
     *
     * NULLABLE, and that is a real case rather than a migration artefact: a PO
     * that arrives by email without a portal booking behind it is ordinary, and
     * §3 asks for the relationship to be maintained where one exists, not for
     * one to be invented where it does not.
     *
     * The booking's own line data is NOT copied here — §28 forbids duplicating
     * customer data. Only the id, the key, and the facts that were true at the
     * moment of linking are stamped, so Order 360 can name the source without a
     * join and still read through for anything live.
     */
    sourceBooking: {
      type: new mongoose.Schema(
        {
          /** `BO-`/`SO-YYYY-######`, as the customer portal issued it. */
          bookingId: { type: String, required: true, trim: true, maxlength: 80 },
          /** Uppercased, whitespace-collapsed, for the uniqueness index. */
          bookingKey: { type: String, required: true },

          /** The booking's own customer, kept to detect later divergence. */
          customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          customerName: { type: String, default: null, trim: true, maxlength: 200 },

          bookedAt: { type: Date, default: null },

          /**
           * The booking's status WHEN IT WAS LINKED, not now.
           *
           * A point-in-time copy on purpose: the customer side keeps moving that
           * field, and an auditor asking "what was this when Sales converted it"
           * cannot get an answer from a value that tracks the present.
           */
          bookingStatusAtLink: { type: String, default: null, trim: true, maxlength: 60 },

          linkedAt: { type: Date, default: null },
          linkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        },
        { _id: false },
      ),
      default: null,
    },

    // ── Commitment ─────────────────────────────────────────────────────────
    /**
     * What the customer was promised. §27 requires it, or an authorised override.
     * Stored with the override so the exception is visible rather than inferred
     * from a null.
     */
    promiseDate: { type: Date, default: null },
    promiseDateOverrideBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    promiseDateOverrideReason: { type: String, default: null, trim: true, maxlength: 300 },

    /** Free text from Sales: in stock, partial, awaiting import. */
    stockStatus: { type: String, default: null, trim: true, maxlength: 80 },

    // ── Position ───────────────────────────────────────────────────────────
    /**
     * The lowest stage still open — the tracker's "where is this order".
     *
     * DENORMALISED on purpose. Deriving it would mean reading twelve stage rows
     * for every row of a thousand-row tracker. The stage engine is the only
     * writer, so it cannot drift from a controller that forgot.
     */
    currentStage: { type: Number, default: 1, enum: STAGE_NUMBERS },

    status: { type: String, enum: ORDER_STATUS_LIST, default: ORDER_STATUS.OPEN, index: true },

    // ── Advance ────────────────────────────────────────────────────────────
    /**
     * Stage 4's answer. `null` means undecided — distinct from `false`, which is
     * a decision that stage 5 does not apply and causes it to be SKIPPED.
     */
    advanceRequired: { type: Boolean, default: null },
    advanceDecidedAt: { type: Date, default: null },
    advanceDecidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // ── Rolled-up quantities ───────────────────────────────────────────────
    // Maintained by the item service so the tracker need not aggregate lines.
    totalOrderedQty: { type: Number, default: 0 },
    totalDispatchedQty: { type: Number, default: 0 },

    // ── Milestones, copied for querying and KPIs ───────────────────────────
    /**
     * Stage 9's actual. The headline KPI is `poDate → dispatchedAt`, and a
     * dashboard filtering on it must not join twelve stage rows to find it.
     */
    dispatchedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closingRemarks: { type: String, default: null, trim: true, maxlength: 1000 },

    invoiceNumber: { type: String, default: null, trim: true, maxlength: 80 },
    awbNumber: { type: String, default: null, trim: true, maxlength: 80 },
    transporter: { type: String, default: null, trim: true, maxlength: 120 },

    // ── Hold ───────────────────────────────────────────────────────────────
    holds: { type: [holdSchema], default: [] },

    remarks: { type: String, default: null, trim: true, maxlength: 2000 },

    /**
     * Imported from the Google Sheet rather than created here.
     *
     * §48: historical planned and actual values must NOT be recalculated. The
     * flag lets the engine leave those rows alone, and lets analytics separate
     * measured history from history that was merely recorded.
     */
    migrated: { type: Boolean, default: false },
    migrationSource: { type: String, default: null, trim: true, maxlength: 120 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'o2d_orders' },
);

/**
 * §26: one live order per (PO number, customer).
 *
 * PARTIAL, over live orders only. A cancelled or void order must not block the
 * number being used again — a customer who cancels and reissues "PO-001" is
 * doing something ordinary, and a plain unique index would refuse it forever.
 *
 * Children of a split parent are excluded: `PO-123/1` and `PO-123/2` share a
 * `poNumberKey` by design.
 */
o2dOrderSchema.index(
  { poNumberKey: 1, customerKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      parentOrder: null,
      status: { $in: [ORDER_STATUS.OPEN, ORDER_STATUS.ON_HOLD, ORDER_STATUS.CLOSED] },
    },
  },
);

/**
 * §28: one live O2D order per customer booking.
 *
 * PARTIAL twice over, and both halves are load-bearing:
 *
 *   - over LIVE orders only, so cancelling an O2D order frees its booking to be
 *     converted again — the same escape hatch the PO-number rule gives;
 *   - over documents that HAVE a `sourceBooking.bookingKey`, because most orders
 *     legitimately have none. Without the `$exists` clause every unlinked order
 *     would collide on a null key and only the first could ever be saved.
 */
o2dOrderSchema.index(
  { 'sourceBooking.bookingKey': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'sourceBooking.bookingKey': { $exists: true },
      status: { $in: [ORDER_STATUS.OPEN, ORDER_STATUS.ON_HOLD, ORDER_STATUS.CLOSED] },
    },
  },
);

// The tracker's default view: open orders, newest PO first.
o2dOrderSchema.index({ status: 1, currentStage: 1, poDate: -1 });
// Dispatch KPIs and the management dashboard.
o2dOrderSchema.index({ dispatchedAt: -1 });
// "All orders for this customer", and the duplicate-check lookup.
o2dOrderSchema.index({ customerKey: 1, poDate: -1 });

/** Normalise a PO number or customer name into its index key. */
export const o2dKey = (value) =>
  String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

/** The hold that is currently open, if any. */
o2dOrderSchema.methods.activeHold = function activeHold() {
  return this.holds.find((h) => !h.resumedAt) ?? null;
};

export const O2dOrder = mongoose.models.O2dOrder || mongoose.model('O2dOrder', o2dOrderSchema);
export default O2dOrder;
