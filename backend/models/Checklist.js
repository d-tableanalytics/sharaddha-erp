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

const routineSchema = new mongoose.Schema({
  taskName:      { type: String, required: true, trim: true },
  taskCode:      { type: String, required: true, unique: true, uppercase: true, trim: true },
  frequency:     { type: String, enum: ['once', 'daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'], required: true },
  doer:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doerFirstName: { type: String, default: '' },
  doerLastName:  { type: String, default: '' },
  department:    { type: String, default: '' },
  site:          { type: String, default: 'HO' },
  startDate:     { type: Date, required: true },
  endDate:       { type: Date, required: true },
  proofRequired: { type: Boolean, default: false },
  isActive:      { type: Boolean, default: true },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

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
  doer:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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
  status:        { type: String, enum: ['pending', 'completed', 'overdue', 'non-functional'], default: 'pending' },
  completedDate: { type: Date, default: null },
  completedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  proofRequired: { type: Boolean, default: false },
  proofUrl:      { type: String, default: null },
  proofFileName: { type: String, default: null },
  remarks:       [remarkSchema],
  reassignedTo:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reassignedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reassigned:    { type: Boolean, default: false },
  nonFunctionalReason: { type: String, default: null },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

occurrenceSchema.index({ site: 1, status: 1, plannedDate: -1 });
occurrenceSchema.index({ doer: 1, status: 1 });
occurrenceSchema.index({ routine: 1 });
occurrenceSchema.index({ department: 1 });
occurrenceSchema.index({ plannedDate: 1, status: 1 });

export const ChecklistOccurrence = mongoose.model('ChecklistOccurrence', occurrenceSchema);
