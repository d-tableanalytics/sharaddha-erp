/**
 * The twelve stages, as configuration rather than as code.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A COLLECTION AND NOT A CONSTANT
 * ---------------------------------------------------------------------------
 *
 * §37 is explicit: "Changing an SLA should NOT require code changes." A business
 * that decides the SOR+PI window is four hours rather than three must be able to
 * say so in an admin screen. So the SLA value, its type, the owning role and
 * whether the stage is enabled all live here, editable.
 *
 * The stage NUMBERS do not. They are in `shared/constants/o2d.js`, because the
 * engine reasons about "the dispatch stage" and "the advance-decision stage" by
 * identity, and a number that could be edited in an admin screen is not an
 * identity. Configuration changes what a stage COSTS; it cannot change what a
 * stage IS.
 *
 * ---------------------------------------------------------------------------
 * EDITING THIS DOES NOT RE-JUDGE FINISHED WORK
 * ---------------------------------------------------------------------------
 *
 * Each `O2dOrderStage` copies the SLA it was given at the moment it unlocked,
 * and the SLA engine prefers that stored copy over anything here. §48 requires
 * historical planned values to stay exactly as they were, and an admin
 * shortening an SLA next March must not retrospectively make last week's work
 * late. This collection governs stages that have not started yet.
 */

import mongoose from 'mongoose';

import {
  STAGE_NUMBERS,
  SLA_TYPE_LIST,
  SLA_TYPES,
} from '../../shared/constants/o2d.js';

const stageMasterSchema = new mongoose.Schema(
  {
    /** 1–12. The stable identity; unique, and not editable through the UI. */
    stageNumber: {
      type: Number,
      required: true,
      unique: true,
      enum: STAGE_NUMBERS,
    },

    /** Short machine key, for translations and for reading a log entry. */
    key: { type: String, required: true, unique: true, trim: true, maxlength: 60 },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: null, trim: true, maxlength: 500 },

    /**
     * The portal ROLE that owns the stage — `Billing`, `Warehouse User`, and so
     * on. A role name rather than a person: ownership is a function of the job,
     * and an order must not stall because one named employee is on leave.
     */
    ownerRole: { type: String, required: true, trim: true, maxlength: 60 },

    /**
     * Who else may complete it. Sales and PC both work stage 1; the sales desk
     * and billing both touch the handover. Kept as a list rather than widening
     * `ownerRole`, so "who is accountable" stays a single answer for KPIs while
     * "who may act" can be broader.
     */
    alsoAllowedRoles: { type: [String], default: [] },

    /** The escalation target once a stage is overdue by more than a day. */
    escalationRole: { type: String, default: null, trim: true, maxlength: 60 },

    // ── SLA ────────────────────────────────────────────────────────────────
    slaType: { type: String, required: true, enum: SLA_TYPE_LIST },

    /** Duration, for the four duration types. Null for the deadline types. */
    slaValue: { type: Number, default: null, min: 0 },

    /**
     * Minutes from midnight, for SAME_DAY_BY / NEXT_WORKING_DAY_BY.
     * 17:00 → 1020, 11:45 → 705, 18:30 → 1110.
     */
    slaByMinute: { type: Number, default: null, min: 0, max: 24 * 60 },

    /**
     * Whether the ACTUAL completion is recorded by someone other than the owner.
     *
     * Stage 7 is the case §10 calls out in capitals: Billing pushes the picking
     * request, but the WAREHOUSE acknowledgement is the actual timestamp. Using
     * Billing's push would credit the warehouse with work it had not yet seen.
     */
    completedByRole: { type: String, default: null, trim: true, maxlength: 60 },

    /**
     * A stage that may legitimately not apply.
     *
     * Only stage 5 today — the advance payment, skipped when stage 4 says the
     * order is not an advance order. Flagged rather than special-cased in the
     * engine so a future optional stage needs no new code.
     */
    skippable: { type: Boolean, default: false },

    /** Turned off entirely. Disabled stages are skipped when an order is created. */
    enabled: { type: Boolean, default: true },

    /** Display order. Normally the stage number, but kept separate. */
    order: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'o2d_stage_master' },
);

stageMasterSchema.index({ enabled: 1, stageNumber: 1 });

/**
 * The SLA rule in the shape the engine expects.
 *
 * A method rather than three lookups at every call site, so the mapping between
 * the stored columns and `{ type, value, byMinute }` exists once.
 */
stageMasterSchema.methods.slaRule = function slaRule() {
  return {
    type: this.slaType,
    value: this.slaValue ?? undefined,
    byMinute: this.slaByMinute ?? undefined,
  };
};

/** Does this rule shape make sense for its type? Used by the admin screen. */
export const validateSlaShape = ({ slaType, slaValue, slaByMinute }) => {
  const needsValue = [
    SLA_TYPES.WORKING_MINUTES,
    SLA_TYPES.WORKING_HOURS,
    SLA_TYPES.WORKING_DAYS,
    SLA_TYPES.CALENDAR_DAYS,
  ];
  const needsMinute = [SLA_TYPES.SAME_DAY_BY, SLA_TYPES.NEXT_WORKING_DAY_BY];

  if (needsValue.includes(slaType) && !Number.isFinite(slaValue)) {
    return `${slaType} needs a duration in slaValue.`;
  }
  if (needsMinute.includes(slaType) && !Number.isFinite(slaByMinute)) {
    return `${slaType} needs a clock time in slaByMinute (minutes from midnight).`;
  }
  return null;
};

export const O2dStageMaster =
  mongoose.models.O2dStageMaster || mongoose.model('O2dStageMaster', stageMasterSchema);

export default O2dStageMaster;
