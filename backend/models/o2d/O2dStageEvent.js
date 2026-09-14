/**
 * Every status change a stage has ever made.
 *
 * ---------------------------------------------------------------------------
 * WHY A COLLECTION AND NOT A FIELD ON THE STAGE
 * ---------------------------------------------------------------------------
 *
 * `O2dOrderStage` carries where a stage stands NOW. It has never carried how it
 * got there, and the fields that look like history are not: `actualCompletion`
 * is overwritten by a re-completion, and a stage that went PENDING -> OVERDUE ->
 * DONE_LATE leaves a row that says only DONE_LATE. The hours it spent overdue —
 * which is the fact anybody investigating a late order actually wants — were
 * simply gone.
 *
 * An embedded array would grow unbounded inside a document that is read on
 * every board refresh, and Mongo would load the whole history to answer "what
 * is stage 7 doing". A separate collection is read only when somebody asks.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT THE AUDIT LOG, AND DOES NOT REPLACE IT
 * ---------------------------------------------------------------------------
 *
 * `AuditLog` records what a PERSON did: completed a stage, skipped one,
 * overrode a prerequisite. It is deliberately actor-centric and it is what an
 * investigation into conduct reads.
 *
 * This records what a STAGE did, including the transitions no person performed —
 * the sweep moving PENDING to DUE_SOON at 80% of the window, a hold freezing
 * every open stage, the resume thawing them. Those are most of the timeline and
 * none of them appear in an audit log, because nobody did them.
 *
 * Both are needed. Reconstructing one from the other is not possible in either
 * direction.
 *
 * ---------------------------------------------------------------------------
 * APPEND ONLY
 * ---------------------------------------------------------------------------
 *
 * Nothing updates or deletes a row here. A correction is a NEW row saying the
 * status moved again, which is why `TIMESTAMP_CORRECTED` exists as a source: a
 * history that can be edited answers no question worth asking.
 */

import mongoose from 'mongoose';

import { STAGE_STATUS_LIST, STAGE_NUMBERS } from '../../shared/constants/o2d.js';

/**
 * Who or what caused the move.
 *
 * Kept separate from `actor` because the absence of an actor is ambiguous on
 * its own — a null could mean "the sweep did it" or "we failed to record who
 * did". Naming the source removes the guess.
 */
export const STAGE_EVENT_SOURCES = Object.freeze({
  /** A person, through the API. */
  USER: 'USER',
  /** The workflow itself — unlocking the next stage after one closes. */
  WORKFLOW: 'WORKFLOW',
  /** The escalation sweep moving a deadline on. */
  SWEEP: 'SWEEP',
  /** An order-level action reaching down into its stages: hold, resume, exit. */
  ORDER: 'ORDER',
});

export const STAGE_EVENT_SOURCE_LIST = Object.freeze(Object.values(STAGE_EVENT_SOURCES));

const schema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', required: true, index: true },

    /**
     * The PO number, denormalised.
     *
     * So a history can be read, exported or investigated without joining back
     * to an order that may since have been cancelled — and so the one query an
     * investigator actually types ("everything that happened to PO-4471") does
     * not need the order's id first.
     */
    poNumber: { type: String, default: null, trim: true, maxlength: 120 },

    stageNumber: { type: Number, required: true, enum: STAGE_NUMBERS },
    /** Snapshotted: §37 lets an administrator rename a stage, and a history
     *  that silently adopts the new name misdescribes what happened. */
    stageName: { type: String, required: true, trim: true, maxlength: 120 },

    /** Null on the very first row — a stage coming into existence has no prior. */
    from: { type: String, default: null, enum: [...STAGE_STATUS_LIST, null] },
    to: { type: String, required: true, enum: STAGE_STATUS_LIST },

    at: { type: Date, required: true, default: Date.now },

    source: { type: String, required: true, enum: STAGE_EVENT_SOURCE_LIST },

    /** Null for anything the system did on its own. */
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** Snapshotted for the same reason stageName is: people leave, and a
     *  history that renders "unknown user" for last year is not a history. */
    actorName: { type: String, default: null, trim: true, maxlength: 160 },
    actorRole: { type: String, default: null, trim: true, maxlength: 60 },

    /** The skip reason, the hold reason, the override justification. */
    reason: { type: String, default: null, trim: true, maxlength: 1000 },

    /** Delay in working minutes on a completion, the deadline in force, etc. */
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'o2d_stage_events' },
);

/** The timeline for one stage, and for one order. Both are read oldest first. */
schema.index({ order: 1, stageNumber: 1, at: 1 });
schema.index({ order: 1, at: 1 });
schema.index({ poNumber: 1, at: 1 });

schema.set('toJSON', {
  transform(doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export const O2dStageEvent = mongoose.model('O2dStageEvent', schema);

export default O2dStageEvent;
