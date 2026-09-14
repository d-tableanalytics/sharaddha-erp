import mongoose from 'mongoose';

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
    enum: ['Pending', 'In Progress', 'Awaiting Verification', 'Completed', 'Need Revision'],
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
}, { timestamps: true });

delegationSchema.index({ assignerId: 1, status: 1 });
delegationSchema.index({ doerId: 1, status: 1 });
delegationSchema.index({ dueDate: 1 });
delegationSchema.index({ isDeleted: 1, deletedAt: -1 });

export const Delegation = mongoose.model('Delegation', delegationSchema);
export default Delegation;
