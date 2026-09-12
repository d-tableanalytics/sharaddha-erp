/**
 * The record of what this portal has asked Zoho to do about an order (§43).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS COLLECTION EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * The order already has an `invoiceNumber`, so a row here might look redundant.
 * It is not, and the difference matters on exactly the day something breaks:
 *
 *   - The order's field says WHAT the invoice is.
 *   - This row says WHETHER WE ASKED, whether it worked, how many times we
 *     tried, and what Zoho said when it refused.
 *
 * Without it, an invoice that failed to create is indistinguishable from one
 * nobody has attempted — both are simply an order with a null field — and a
 * retry sweep has nothing to sweep.
 *
 * It also closes a real gap: if the process dies between Zoho issuing an
 * invoice and this portal writing the number onto the order, the row survives
 * and the next attempt recovers the number instead of buying a second invoice.
 */

import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', required: true, index: true },

    /** `CREATE` today. Credit notes get their own action rather than a flag. */
    action: { type: String, enum: ['CREATE', 'CREDIT_MEMO'], default: 'CREATE', index: true },

    /** Zoho's number, once it has issued one. Null while an attempt is failing. */
    invoiceNumber: { type: String, default: null, trim: true, maxlength: 80 },

    status: {
      type: String,
      enum: ['CREATED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED', 'FAILED'],
      required: true,
      index: true,
    },

    /**
     * The key sent to Zoho, stored so a human debugging a duplicate can prove
     * which requests were meant to be the same one.
     */
    idempotencyKey: { type: String, default: null, trim: true, maxlength: 200 },

    /** Bounded by the retry sweep, so a permanently broken invoice stops. */
    attempts: { type: Number, default: 0, min: 0 },

    errorMessage: { type: String, default: null, trim: true, maxlength: 1000 },

    /** When a Zoho webhook last told us about this invoice. */
    syncedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'o2d_zoho_invoices' },
);

/**
 * One attempt row per order per action.
 *
 * The database's own refusal to hold two CREATE rows for one order — not merely
 * an `if` in the service, which two concurrent requests can both pass before
 * either writes.
 */
schema.index({ order: 1, action: 1 }, { unique: true });

/**
 * Sparse, because a failed attempt has no number and several may coexist.
 * A non-sparse unique index here would let the FIRST null block every
 * subsequent failure row from being written at all.
 */
schema.index({ invoiceNumber: 1 }, { sparse: true });

/** The retry sweep's query. */
schema.index({ status: 1, attempts: 1, createdAt: 1 });

schema.set('toJSON', {
  transform(doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export const ZohoInvoice = mongoose.model('ZohoInvoice', schema);

export default ZohoInvoice;
