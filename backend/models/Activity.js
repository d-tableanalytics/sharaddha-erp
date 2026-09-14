import mongoose from 'mongoose';

/**
 * Activity ("Audit Log") Model.
 *
 * Tracks system-wide task mutations, status transitions, creations,
 * subtask dispatches, remarks, and revisions into a unified chronological ledger.
 */
const activitySchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: [
      'task_created',
      'subtask_created',
      'status_change',
      'remark',
      'date_revision',
      'deleted',
      'restored',
      'general',
    ],
    default: 'general',
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Delegation',
    default: null,
  },
  relatedType: {
    type: String,
    default: 'task',
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

activitySchema.index({ createdAt: -1 });
activitySchema.index({ userId: 1, createdAt: -1 });
activitySchema.index({ relatedId: 1 });
activitySchema.index({ type: 1 });

export const Activity = mongoose.model('Activity', activitySchema);
export default Activity;
