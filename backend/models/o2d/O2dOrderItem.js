/**
 * One SKU line on an O2D order.
 *
 * ---------------------------------------------------------------------------
 * FIVE QUANTITIES, NOT ONE
 * ---------------------------------------------------------------------------
 *
 * §24 requires ordered, reserved, picked, invoiced and dispatched to be tracked
 * separately, and they genuinely differ: stock can be reserved but not picked,
 * picked but not invoiced, invoiced but still held on the dock. Collapsing them
 * into "quantity + status" is what makes a partial dispatch impossible to answer
 * questions about — and §24's whole point is that one PO may ship in batches.
 *
 * `remainingQty` is DERIVED (ordered − dispatched) rather than stored, so it
 * cannot drift out of step with the two figures it comes from.
 */

import mongoose from 'mongoose';

const o2dOrderItemSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', required: true, index: true },

    /**
     * The SKU as a STRING, not a reference.
     *
     * The product master lives in the Customer Portal, and this module is
     * deliberately self-contained (see the note on O2dOrder). A PO may also name
     * a SKU that has not been catalogued yet, which a hard reference would
     * refuse — and refusing to record what the customer actually ordered is the
     * wrong failure. Validating against the catalogue belongs in the service
     * layer, as a warning rather than a rejection.
     */
    skuCode: { type: String, required: true, trim: true, maxlength: 80, index: true },
    productName: { type: String, default: null, trim: true, maxlength: 200 },

    /** Position in the customer's PO, so the picklist reads in their order. */
    lineSeq: { type: Number, default: null },

    orderedQty: { type: Number, required: true, min: 0 },
    reservedQty: { type: Number, default: 0, min: 0 },
    pickedQty: { type: Number, default: 0, min: 0 },
    invoicedQty: { type: Number, default: 0, min: 0 },
    dispatchedQty: { type: Number, default: 0, min: 0 },

    /** Free text from Sales at intake: in stock, awaiting import, partial. */
    stockStatus: { type: String, default: null, trim: true, maxlength: 80 },

    remarks: { type: String, default: null, trim: true, maxlength: 500 },
  },
  {
    timestamps: true,
    collection: 'o2d_order_items',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

/** Still to go. Derived so it cannot disagree with its own inputs. */
o2dOrderItemSchema.virtual('remainingQty').get(function remainingQty() {
  return Math.max(0, (this.orderedQty ?? 0) - (this.dispatchedQty ?? 0));
});

o2dOrderItemSchema.index({ order: 1, lineSeq: 1 });

export const O2dOrderItem =
  mongoose.models.O2dOrderItem || mongoose.model('O2dOrderItem', o2dOrderItemSchema);
export default O2dOrderItem;
