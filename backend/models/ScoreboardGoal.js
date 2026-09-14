import mongoose from 'mongoose';

const scoreboardGoalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    doerName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    period: {
      type: String,
      enum: ['week', 'month', 'year'],
      default: 'week',
    },
    periodKey: {
      type: String,
      required: true,
      index: true,
    },
    nextGoal: {
      type: Number,
      default: null,
    },
    mdAdjustment: {
      type: Number,
      default: 0,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

scoreboardGoalSchema.index({ doerName: 1, period: 1, periodKey: 1 }, { unique: true });

export const ScoreboardGoal = mongoose.model('ScoreboardGoal', scoreboardGoalSchema);
export default ScoreboardGoal;
