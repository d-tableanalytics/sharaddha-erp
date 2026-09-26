import mongoose from 'mongoose';

/**
 * Checklist Routine — the master rule.
 *
 * A routine defines what task must be done, how often, by whom, and in which
 * window. Creating a routine generates one ChecklistOccurrence for every
 * scheduled date between startDate and endDate. Editing the routine does NOT
 * regenerate past occurrences — it only edits its own fields and any future
 * occurrences that have not been worked.
 */
const remarkSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  by:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName:    { type: String },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

/**
 * A doer is required, except on an O2D TEAM task: an active stage nobody has
 * been named on belongs to the whole responsible role until someone completes
 * it (they then become its doer) or is assigned it.
 */
const doerRequired = function () { return this.sourceType !== 'o2d_stage'; };

const routineSchema = new mongoose.Schema({
  taskName:      { type: String, required: true, trim: true },
  taskCode:      { type: String, required: true, unique: true, uppercase: true, trim: true },
  frequency:     { type: String, enum: ['once', 'daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'], required: true },
  doer:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: doerRequired, default: null },
  doerFirstName: { type: String, default: '' },
  doerLastName:  { type: String, default: '' },
  department:    { type: String, default: '' },
  site:          { type: String, default: 'HO' },
  startDate:     { type: Date, required: true },
  endDate:       { type: Date, required: true },
  proofRequired: { type: Boolean, default: false },
  isActive:      { type: Boolean, default: true },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  /**
   * Set when this routine exists only to carry an O2D stage — see
   * `modules/o2d/checklistMirror.service.js`.
   *
   * ONE routine per stage, reused across reassignments so its `taskCode`
   * (which is unique) stays stable and meaningful: `O2D-PO-4471-S8` is the
   * same piece of work whoever is holding it this week. The OCCURRENCE is what
   * gets closed and recreated when the stage changes hands.
   */
  sourceType:        { type: String, enum: ['manual', 'o2d_stage'], default: 'manual', index: true },
  sourceOrderId:     { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', default: null },
  sourceStageId:     { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrderStage', default: null },
  sourceStageNumber: { type: Number, default: null },
  sourcePoNumber:    { type: String, default: null, trim: true },
}, { timestamps: true });

/** One routine per O2D stage. Partial, so manual routines are unaffected. */
routineSchema.index(
  { sourceStageId: 1 },
  { unique: true, partialFilterExpression: { sourceStageId: { $type: 'objectId' } } },
);

routineSchema.index({ site: 1, isActive: 1 });
routineSchema.index({ doer: 1 });
routineSchema.index({ department: 1 });

export const ChecklistRoutine = mongoose.model('ChecklistRoutine', routineSchema);

/**
 * Checklist Occurrence — a single task instance generated from a routine.
 *
 * Each occurrence represents one scheduled date the doer must complete the
 * task. Status transitions: pending → completed | overdue | non-functional.
 * Overdue is computed at query time for any pending task whose plannedDate is
 * in the past.
 */
const occurrenceSchema = new mongoose.Schema({
  routine:       { type: mongoose.Schema.Types.ObjectId, ref: 'ChecklistRoutine', required: true },
  taskName:      { type: String, required: true },
  taskCode:      { type: String, required: true },
  doer:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: doerRequired, default: null },
  doerFirstName: { type: String, default: '' },
  doerLastName:  { type: String, default: '' },
  department:    { type: String, default: '' },
  site:          { type: String, default: 'HO' },
  frequency:     { type: String, enum: ['once', 'daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'] },
  plannedDate:   { type: Date, required: true },
  /**
   * Status stored on disk. 'pending' is the initial state. 'overdue' is
   * computed at query time by checking if a pending task's plannedDate < now,
   * but can also be stamped explicitly by a nightly job.
   */
  /*
   * `reassigned` is the counterpart of Delegation's `Reassigned` — the work was
   * taken off this doer and given to somebody else, which is neither done nor
   * still owed BY THEM. See DELEGATION_REASSIGNED_AWAY for why it cannot be
   * `completed` (it would score a completion for the wrong person) and why it
   * is not `non-functional` either: that means the work did not need doing, and
   * this work very much does — just not by this doer.
   *
   * Written only by the O2D mirror detach. Checklist's OWN reassign endpoint
   * moves the doer on the row in place and never produces one of these.
   */
  status:        { type: String, enum: ['pending', 'completed', 'overdue', 'non-functional', 'reassigned'], default: 'pending' },
  completedDate: { type: Date, default: null },
  completedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  proofRequired: { type: Boolean, default: false },
  proofUrl:      { type: String, default: null },
  proofFileName: { type: String, default: null },
  remarks:       [remarkSchema],
  reassignedTo:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reassignedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reassigned:    { type: Boolean, default: false },
  /**
   * When the row reached its current doer, if that was after it was created —
   * set by a reassignment. "New" is measured from this, falling back to
   * `createdAt`, so a task handed to somebody is new for them.
   */
  assignedAt:    { type: Date, default: null },
  nonFunctionalReason: { type: String, default: null },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  /**
   * ── The live task of one active O2D stage ───────────────────────────────
   *
   * Created the moment the stage becomes active: for the named person if one
   * is assigned, otherwise as a TEAM task (`doer: null`) that every member of
   * the responsible role sees — the same people who see it in O2D My Tasks.
   * Stages whose completion is a bare decision (stage 4) go to Delegation
   * instead, and only once a person is named. See `stageMirror.service.js`.
   *
   * Completing this occurrence does NOT just flip a status word: it runs the
   * real stage completion, with the real evidence rules. See the interception
   * in `checklist.controller.js#completeTask`.
   */
  sourceType:        { type: String, enum: ['manual', 'o2d_stage'], default: 'manual', index: true },
  sourceOrderId:     { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', default: null },
  sourceStageId:     { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrderStage', default: null },
  sourceStageNumber: { type: Number, default: null },
  sourcePoNumber:    { type: String, default: null, trim: true },

  /**
   * ── Parked, because the work behind it was parked ───────────────────────
   *
   * Set when the O2D order behind this occurrence goes on hold, or is
   * cancelled or voided — the same moment `task.service.js` stops showing the
   * stage in My Tasks. See the matching field on `Delegation` for why this is
   * a flag rather than a fifth `status` value.
   */
  heldAt:     { type: Date, default: null },
  holdReason: { type: String, default: null },
}, { timestamps: true });

/**
 * One LIVE occurrence per stage. Cleared (not deleted) when the stage is
 * reassigned, so the next assignee's occurrence can claim the link while the
 * previous one survives as history — the same shape the Delegation mirror uses.
 */
occurrenceSchema.index(
  { sourceStageId: 1 },
  { unique: true, partialFilterExpression: { sourceStageId: { $type: 'objectId' } } },
);

occurrenceSchema.index({ site: 1, status: 1, plannedDate: -1 });
occurrenceSchema.index({ doer: 1, status: 1 });
occurrenceSchema.index({ routine: 1 });
occurrenceSchema.index({ department: 1 });
occurrenceSchema.index({ plannedDate: 1, status: 1 });

/** The occurrence status meaning "handed to somebody else" — see the enum above. */
export const OCCURRENCE_REASSIGNED_AWAY = 'reassigned';

export const ChecklistOccurrence = mongoose.model('ChecklistOccurrence', occurrenceSchema);
