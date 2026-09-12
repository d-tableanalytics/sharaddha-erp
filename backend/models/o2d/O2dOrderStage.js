/**
 * One stage of one order — twelve rows per order, created when the order is.
 *
 * ---------------------------------------------------------------------------
 * THE SLA IS COPIED, NOT REFERENCED
 * ---------------------------------------------------------------------------
 *
 * `sla` below is a snapshot of the stage master's rule, taken when this row was
 * created. The SLA engine prefers `plannedCompletion` when it is set, and falls
 * back to recomputing from this copy — never from the live master.
 *
 * §48 is the reason: historical planned values must not move. An administrator
 * shortening the invoice SLA next March must not retrospectively make last
 * week's invoices late, and a KPI that changes when nobody touched an order is
 * not a KPI. The master governs stages that have not started.
 *
 * ---------------------------------------------------------------------------
 * TWO DIFFERENT TRUTHS ABOUT WHEN SOMETHING HAPPENED
 * ---------------------------------------------------------------------------
 *
 *   actualCompletion  when the WORK happened
 *   recordedAt        when the SYSTEM was told
 *
 * §33 asks for back-fill tracking, and it needs both. A warehouse that dispatches
 * at 4pm and records it at 9am the next morning met its deadline and kept bad
 * records; those are different problems with different fixes, and one timestamp
 * cannot tell them apart. For an ordinary completion the two are equal.
 */

import mongoose from 'mongoose';

import {
  STAGE_NUMBERS,
  STAGE_STATUS,
  STAGE_STATUS_LIST,
  SLA_TYPE_LIST,
} from '../../shared/constants/o2d.js';

/** The SLA rule, frozen at creation. Mirrors `O2dStageMaster.slaRule()`. */
const slaSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: SLA_TYPE_LIST },
    value: { type: Number, default: null },
    byMinute: { type: Number, default: null },
  },
  { _id: false },
);

const o2dOrderStageSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', required: true, index: true },
    stageNumber: { type: Number, required: true, enum: STAGE_NUMBERS },

    /** Denormalised from the master so the tracker renders without a join. */
    stageKey: { type: String, required: true, trim: true, maxlength: 60 },
    stageName: { type: String, required: true, trim: true, maxlength: 120 },
    ownerRole: { type: String, required: true, trim: true, maxlength: 60 },

    status: {
      type: String,
      enum: STAGE_STATUS_LIST,
      default: STAGE_STATUS.LOCKED,
      index: true,
    },

    sla: { type: slaSchema, required: true },

    // ── Plan ───────────────────────────────────────────────────────────────
    /** When the stage became this owner's to do — set on unlock. */
    plannedStart: { type: Date, default: null },
    /** The deadline the owner was told. Written once, then authoritative. */
    plannedCompletion: { type: Date, default: null },

    // ── Reality ────────────────────────────────────────────────────────────
    actualStart: { type: Date, default: null },
    actualCompletion: { type: Date, default: null },
    /** When the system was told — see the note on back-fill above. */
    recordedAt: { type: Date, default: null },

    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedByName: { type: String, default: null, trim: true, maxlength: 200 },
    completedByRole: { type: String, default: null, trim: true, maxlength: 60 },

    /**
     * Working minutes past the deadline, stamped at completion.
     *
     * Stored rather than derived, for the same reason a hold's cost is: the
     * holiday calendar can change, and a delay already reported to a manager
     * must not silently become a different number.
     */
    delayMinutes: { type: Number, default: null },

    // ── Skip ───────────────────────────────────────────────────────────────
    skipReason: { type: String, default: null, trim: true, maxlength: 300 },
    skippedAt: { type: Date, default: null },

    // ── Override (§28) ─────────────────────────────────────────────────────
    /** Completed out of order by an authorised user, with a reason. */
    overridden: { type: Boolean, default: false },
    overrideReason: { type: String, default: null, trim: true, maxlength: 500 },
    overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * Whatever proves the stage was done: an acknowledgement, an invoice number,
     * a UTR, a box count. Free-form because each stage's evidence differs, and a
     * column per stage would be eleven nulls on every row.
     */
    evidence: { type: mongoose.Schema.Types.Mixed, default: null },

    remarks: { type: String, default: null, trim: true, maxlength: 2000 },

    /** Reminder bookkeeping, so §30's notifications cannot fire twice. */
    dueSoonNotifiedAt: { type: Date, default: null },
    overdueNotifiedAt: { type: Date, default: null },
    escalatedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'o2d_order_stages' },
);

/** One row per stage per order. */
o2dOrderStageSchema.index({ order: 1, stageNumber: 1 }, { unique: true });

/**
 * My Tasks: "every open stage my role owns, soonest deadline first."
 *
 * The compound order matters — role and status narrow, then the index supplies
 * the sort, so the query neither scans nor sorts in memory.
 */
o2dOrderStageSchema.index({ ownerRole: 1, status: 1, plannedCompletion: 1 });

/** Stage-performance analytics: "how did stage 8 do across the month?" */
o2dOrderStageSchema.index({ stageNumber: 1, status: 1, actualCompletion: -1 });

export const O2dOrderStage =
  mongoose.models.O2dOrderStage || mongoose.model('O2dOrderStage', o2dOrderStageSchema);
export default O2dOrderStage;
