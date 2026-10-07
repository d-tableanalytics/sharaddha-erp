import mongoose from 'mongoose';
import {
  ASSIGNMENT_TYPES, ASSIGNMENT_SOURCES, buddyMemberSchema, assignmentEventSchema,
} from './workQueueBuddy.js';

/**
 * Delegated Task Model — records tasks delegated by one user to another.
 *
 * Supports the complete lifecycle:
 * Assignment → In Progress → Awaiting Verification → Completed / Need Revision
 * Includes subtasks, threaded remarks, reminders, follow-ups, and date revision audit trail.
 */

const subtaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
}, { _id: true });

const remarkSchema = new mongoose.Schema({
  text: { type: String, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const reminderSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const followUpSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  notes: { type: String, required: true },
  contactedVia: { type: String, default: 'Call' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  recordedByName: { type: String, default: '' },
}, { _id: true });

const dateRevisionSchema = new mongoose.Schema({
  oldDate: { type: Date },
  newDate: { type: Date, required: true },
  reason: { type: String, required: true },
  revisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  revisedByName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const tagSchema = new mongoose.Schema({
  name: { type: String, required: true },
  color: { type: String, default: '#1E4C92' },
}, { _id: false });

/**
 * The work was taken off this person and given to somebody else.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `Completed`
 * ---------------------------------------------------------------------------
 * A reassigned O2D stage closes the old assignee's mirror and opens a fresh one
 * for the new assignee — the unique index allows exactly one live mirror per
 * stage, so the old row has to let go before the new one can claim it. That
 * closing USED to write `status: 'Completed'` and a `completedAt`, on the
 * reasoning that the row was finished with.
 *
 * It is finished with. It was not COMPLETED, and the difference is somebody's
 * performance review: the Executive Scoreboard counts
 * `status === 'Completed' || !!completedAt` per doer, so handing a task from A
 * to B scored a completed, on-time task for A — for work B went on to do. The
 * same row also has to stay out of the OTHER bucket: counting it as planned and
 * unfinished would punish A for a hand-off they may not have chosen either.
 *
 * So it is its own terminal state, excluded from both numerator and
 * denominator wherever completion is measured, and `reassignedTo`/
 * `reassignedBy` below keep the trail of who it went to and who moved it.
 */
export const DELEGATION_REASSIGNED_AWAY = 'Reassigned';

const delegationSchema = new mongoose.Schema({
  taskTitle: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  
  // Delegator (Assigner)
  assignerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignerName: { type: String, default: '' },
  
  // Doer (Assignee)
  doerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doerFirstName: { type: String, default: '' },
  doerLastName: { type: String, default: '' },
  assigneeHierarchy: { type: String, default: '' }, // e.g. "Amit Kumar → Head Ops"
  
  // Collaborators
  inLoop: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String },
    email: { type: String },
  }],

  // Status & Priority
  status: {
    type: String,
    // `Reassigned` is written by the system alone — see DELEGATION_REASSIGNED_AWAY
    // above. It is deliberately absent from the status list the bulk-update
    // endpoint accepts, so nobody can mark their own task reassigned to duck it.
    enum: ['Pending', 'In Progress', 'Awaiting Verification', 'Completed', 'Need Revision', DELEGATION_REASSIGNED_AWAY],
    default: 'Pending',
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium',
  },
  
  category: { type: String, default: 'Operations' },
  categoryColor: { type: String, default: '#1E4C92' },
  tags: [tagSchema],
  
  // Scheduling & Dates
  startDate: { type: Date, default: Date.now },
  dueDate: { type: Date, required: true },
  completedAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Recurrence
  recurrence: {
    type: String,
    enum: ['none', 'Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Yearly'],
    default: 'none',
  },

  // Verification & Evidence Flags
  verificationRequired: { type: Boolean, default: true },
  evidenceRequired: { type: Boolean, default: false },
  evidenceUrl: { type: String, default: '' },
  evidenceNotes: { type: String, default: '' },

  // Soft Delete Audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deletedByFirstName: { type: String, default: '' },
  deletedByLastName: { type: String, default: '' },

  // Sub-items & Audit
  subtasks: [subtaskSchema],
  remarks: [remarkSchema],
  reminders: [reminderSchema],
  followUps: [followUpSchema],
  dateRevisions: [dateRevisionSchema],

  /**
   * ── Where this task actually comes from ─────────────────────────────────
   *
   * 'manual' is every delegation this screen has ever created: somebody
   * picked a doer and a due date by hand, on this page.
   *
   * 'o2d_stage' is a MIRROR, not a copy made once and left to drift. It exists
   * because an O2D order stage is owned by a ROLE, not a person, and this is
   * the one screen a specific person's whole day already lives on — see
   * `modules/o2d/delegationMirror.service.js` for how it is kept truthful in
   * both directions: completing the mirror here runs the REAL stage
   * completion (evidence, SLA, the lot) rather than just flipping a status
   * word, and completing the stage from Order Tracker closes the mirror the
   * same way. Neither side is allowed to say something the other disagrees
   * with.
   *
   * The four `source*` fields below are the mirror's addressing - which order,
   * which stage - and are set once, at creation, and never edited afterwards.
   */
  sourceType: { type: String, enum: ['manual', 'o2d_stage'], default: 'manual', index: true },
  sourceOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', default: null },
  sourceStageId: { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrderStage', default: null },
  sourceStageNumber: { type: Number, default: null },
  sourcePoNumber: { type: String, default: null, trim: true },

  /**
   * ── Parked, because the work behind it was parked ───────────────────────
   *
   * An O2D stage stops being work when its order is put on hold, cancelled or
   * voided: `task.service.js` drops it out of My Tasks, and the mirror has to
   * drop out of the Work Queue with it or the two screens disagree about what
   * this person owes today.
   *
   * A FLAG rather than a new `status` value, deliberately. `exit.service.js`
   * makes the same call for the same reason — inventing a status means
   * auditing every list, count and report that switches on the old ones to
   * find which now under-count. A held task keeps whatever status it had, so
   * it comes back from a resume or a revive saying exactly what it said
   * before, and only the personal work queues filter on the flag.
   */
  heldAt:     { type: Date, default: null },
  holdReason: { type: String, default: null },

  /**
   * The O2D stage behind this mirror has no deadline yet — it is still LOCKED
   * behind an earlier stage — so the date on this row is only a placeholder.
   * Nothing treats such a row as overdue; `resync*` clears the flag the moment
   * the stage unlocks and the real deadline lands.
   */
  scheduleTbd: { type: Boolean, default: false },

  /**
   * Who this task went to, and who moved it — set together with the
   * `Reassigned` status. The same two fields ChecklistOccurrence already
   * carries, named the same way, so "where did this go" is one question with
   * one answer on both surfaces.
   *
   * `reassignedTo` is null for a plain UNASSIGNMENT: the work went back to the
   * role queue rather than to a named person. The status is the same either
   * way — it left this person, and it was not completed.
   */
  reassignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reassignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  /**
   * ── Buddy System ────────────────────────────────────────────────────────
   *
   * `buddy` tasks carry an ordered chain — `buddyChain[0]` is the primary,
   * the rest are backups in priority order — and `doerId` is whoever holds
   * the task TODAY. See `modules/workqueue/buddy.service.js`.
   *
   *   assignmentSource  how `doerId` got there (primary / automatic / manual).
   *                     `manual` pins it: the scheduler stops rotating until
   *                     a manager resumes the rotation.
   *   assignmentReason  the one-line why, for the screen.
   *   buddyDay          the office day the rotation last decided for. A new
   *                     day starts from the top of the chain again.
   *   noAssigneeDay     set to the day everyone in the chain was away; the
   *                     task keeps its last doer and is flagged instead.
   */
  assignmentType:    { type: String, enum: ASSIGNMENT_TYPES, default: 'single' },
  buddyChain:        { type: [buddyMemberSchema], default: [] },
  assignmentSource:  { type: String, enum: ASSIGNMENT_SOURCES, default: 'primary' },
  assignmentReason:  { type: String, default: '' },
  buddyDay:          { type: String, default: null },
  noAssigneeDay:     { type: String, default: null },
  assignmentHistory: { type: [assignmentEventSchema], default: [] },
}, { timestamps: true });

delegationSchema.index({ assignerId: 1, status: 1 });
delegationSchema.index({ doerId: 1, status: 1 });
delegationSchema.index({ dueDate: 1 });
delegationSchema.index({ assignmentType: 1, status: 1 });
delegationSchema.index({ isDeleted: 1, deletedAt: -1 });
/**
 * One live mirror per stage. `partialFilterExpression` rather than a plain
 * unique index, because most delegations have no `sourceStageId` at all and a
 * plain unique index would only ever allow ONE null across the whole
 * collection - every ordinary manual task after the first would fail to save.
 */
delegationSchema.index(
  { sourceStageId: 1 },
  { unique: true, partialFilterExpression: { sourceStageId: { $type: 'objectId' } } },
);

export const Delegation = mongoose.model('Delegation', delegationSchema);
export default Delegation;
