import mongoose from 'mongoose';

/**
 * When a person last looked at a Work Queue list — what "new" is measured from.
 *
 * One row per person per list. A task counts as NEW for them if it reached
 * their list after `seenAt`. Per person rather than per task because an O2D team
 * task is shared: Priya opening her Checklist must not make it old for Ravi.
 */
const workQueueSeenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    list: { type: String, enum: ['checklist'], required: true },
    seenAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'work_queue_seen' },
);

workQueueSeenSchema.index({ user: 1, list: 1 }, { unique: true });

export const WorkQueueSeen =
  mongoose.models.WorkQueueSeen || mongoose.model('WorkQueueSeen', workQueueSeenSchema);
export default WorkQueueSeen;
