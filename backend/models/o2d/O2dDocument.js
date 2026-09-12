/**
 * A file attached to an O2D order — the PO copy, the PI, the AWB, the proof.
 *
 * ---------------------------------------------------------------------------
 * A ROW, NOT A FIELD ON THE ORDER
 * ---------------------------------------------------------------------------
 *
 * §30 lists six document types across the twelve stages, and several can occur
 * more than once: a PO revised by the customer, two payment proofs for a split
 * advance, an AWB per box on a partial dispatch. Fields on the order
 * (`poFileKey`, `awbFileKey`, ...) would overwrite the first with the second and
 * lose the fact that there was a first.
 *
 * The row also carries WHICH STAGE it belongs to, which is what lets Order 360
 * show a document beside the step it evidences rather than in an undifferentiated
 * attachments list.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS STORED HERE AND WHAT IS NOT
 * ---------------------------------------------------------------------------
 *
 * The BYTES are not here. This holds the storage key, and the object lives in S3
 * (or on local disk in development) behind a short-lived presigned URL. The key
 * is unguessable by construction — see `buildStorageKey` — so a leaked key is
 * the only way to reach an object without passing the permission check.
 */

import mongoose from 'mongoose';

import { O2D_DOCUMENT_TYPES, STAGE_NUMBERS } from '../../shared/constants/o2d.js';

const o2dDocumentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', required: true, index: true },

    /** Denormalised so the document list reads without joining the order. */
    poNumber: { type: String, required: true, trim: true, maxlength: 80 },

    docType: { type: String, required: true, enum: O2D_DOCUMENT_TYPES },

    /**
     * The stage this document evidences, when it belongs to one.
     *
     * Nullable: a customer email attached mid-order belongs to the order rather
     * than to a step, and forcing a stage would mean inventing one.
     */
    stageNumber: { type: Number, default: null, enum: [...STAGE_NUMBERS, null] },

    // ── The object ─────────────────────────────────────────────────────────
    storageKey: { type: String, required: true, trim: true, maxlength: 500 },
    /** What the user called it. Display only — never used to build a path. */
    originalName: { type: String, default: null, trim: true, maxlength: 260 },
    /**
     * The type decided by the LEADING BYTES, not by what the client declared.
     * See `sniffDocument`: a client-supplied type is how an uploaded `.html`
     * becomes script execution against a live session.
     */
    contentType: { type: String, required: true, trim: true, maxlength: 120 },
    sizeBytes: { type: Number, default: null, min: 0 },

    remarks: { type: String, default: null, trim: true, maxlength: 500 },

    uploadedAt: { type: Date, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedByName: { type: String, default: null, trim: true, maxlength: 200 },

    /**
     * Soft delete. §29 — "do not delete business records permanently".
     *
     * A wrongly attached document is removed from view, not from history: the
     * fact that somebody uploaded the wrong customer's PO to this order is
     * itself worth being able to find later.
     */
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deleteReason: { type: String, default: null, trim: true, maxlength: 300 },
  },
  { timestamps: true, collection: 'o2d_documents' },
);

/** Order 360's attachment panel: live documents, newest first. */
o2dDocumentSchema.index({ order: 1, deletedAt: 1, uploadedAt: -1 });
/** The storage key is how an access check finds the row from a URL request. */
o2dDocumentSchema.index({ storageKey: 1 }, { unique: true });

export const O2dDocument =
  mongoose.models.O2dDocument || mongoose.model('O2dDocument', o2dDocumentSchema);
export default O2dDocument;
