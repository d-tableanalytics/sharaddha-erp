/**
 * The exit register — orders that left the workflow without being completed.
 *
 * §29: "Do not delete business records permanently." A cancelled PO is not an
 * absence; it is an event with a reason, an owner and a moment, and it is
 * usually the most interesting thing that happened to that order. Deleting the
 * row would destroy the only evidence of why a customer's order never shipped.
 *
 * Its own collection rather than a status on the order, for two reasons:
 *
 *   - an order can be revived and exit AGAIN, and a single set of fields on the
 *     order document would overwrite the first reason with the second;
 *   - "every cancellation this quarter, and who approved them" is a question
 *     about exits, not about orders, and it should not scan every order to
 *     answer.
 *
 * Holds are NOT here. A hold is a pause inside the workflow and lives on the
 * order as history the SLA engine reads; an exit is a departure from it.
 */

import mongoose from 'mongoose';

import { EXIT_TYPES, STAGE_NUMBERS } from '../../shared/constants/o2d.js';

const o2dExitRegisterSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', required: true, index: true },

    /** Denormalised so the register reads without joining every order. */
    poNumber: { type: String, required: true, trim: true, maxlength: 80 },
    customerName: { type: String, default: null, trim: true, maxlength: 200 },

    exitType: { type: String, required: true, enum: EXIT_TYPES },

    /**
     * Where the order had reached when it exited.
     *
     * The analytically valuable field in this collection: "most cancellations
     * happen at stage 5" is a finding about advance payments, and it cannot be
     * recovered later because the order stops moving the moment it exits.
     */
    stageAtExit: { type: Number, required: true, enum: STAGE_NUMBERS },
    stageNameAtExit: { type: String, default: null, trim: true, maxlength: 120 },

    reason: { type: String, required: true, trim: true, maxlength: 300 },
    remarks: { type: String, default: null, trim: true, maxlength: 2000 },

    exitedAt: { type: Date, required: true },
    exitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    exitedByName: { type: String, default: null, trim: true, maxlength: 200 },

    /** Cancelling a dispatched order is a decision someone should own. */
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // ── Revival ────────────────────────────────────────────────────────────
    /**
     * An exit can be undone. Recorded ON the exit row rather than by deleting
     * it, so the register still shows that the order once left — which is the
     * fact an auditor is looking for.
     */
    revivedAt: { type: Date, default: null },
    revivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    revivalReason: { type: String, default: null, trim: true, maxlength: 300 },
  },
  { timestamps: true, collection: 'o2d_exit_register' },
);

/** The register's own view: most recent exits first, filterable by type. */
o2dExitRegisterSchema.index({ exitType: 1, exitedAt: -1 });
/** "Where do orders die?" — the stage-at-exit analysis. */
o2dExitRegisterSchema.index({ stageAtExit: 1, exitedAt: -1 });

export const O2dExitRegister =
  mongoose.models.O2dExitRegister || mongoose.model('O2dExitRegister', o2dExitRegisterSchema);
export default O2dExitRegister;
