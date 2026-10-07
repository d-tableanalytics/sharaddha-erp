import mongoose from 'mongoose';

/**
 * The Buddy System's shared pieces — embedded in Delegation, ChecklistRoutine
 * and ChecklistOccurrence rather than kept in a collection of their own.
 *
 * A buddy task is still ONE task. The chain only decides who holds it on a
 * given office day: the first person in priority order who is available that
 * day. Nobody gets a copy; the row's existing doer field simply moves, and
 * every move is written to `assignmentHistory` on the same row — the shape
 * `dateRevisions` already uses for "what changed on this task and why".
 *
 * See `modules/workqueue/buddy.service.js` for the rules.
 */

export const ASSIGNMENT_TYPES = Object.freeze(['single', 'buddy']);

/** Smallest and largest chains: a primary plus 1–5 backups. */
export const BUDDY_CHAIN_MIN = 2;
export const BUDDY_CHAIN_MAX = 6;

/**
 * How a row came to its current doer.
 *
 *   primary    the chain's first person, holding it as planned
 *   automatic  a backup the scheduler activated because those above were away
 *   manual     a manager picked the doer by hand — the scheduler leaves it alone
 */
export const ASSIGNMENT_SOURCES = Object.freeze(['primary', 'automatic', 'manual']);

/**
 * What a history entry records.
 *
 *   buddy_activated  a backup took over for the day
 *   primary_restored the chain's primary is back and holds it again
 *   no_assignee      everyone in the chain was away — flagged, manager told
 *   manual_override  a manager assigned it by hand
 *   resumed          a manager handed it back to the automatic rotation
 *   chain_changed    the chain itself was edited
 */
export const ASSIGNMENT_EVENTS = Object.freeze([
  'buddy_activated', 'primary_restored', 'no_assignee', 'manual_override', 'resumed', 'chain_changed',
]);

/** One person in the chain. Index 0 is the primary; order is priority. */
export const buddyMemberSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:   { type: String, default: '' },
}, { _id: false });

/** Why one person in the chain could not take the task that day. */
const unavailableSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name:   { type: String, default: '' },
  reason: { type: String, default: '' },
}, { _id: false });

export const assignmentEventSchema = new mongoose.Schema({
  /** The office day (`YYYY-MM-DD`) the decision was for. */
  day:          { type: String, required: true },
  at:           { type: Date, default: Date.now },
  event:        { type: String, enum: ASSIGNMENT_EVENTS, required: true },
  source:       { type: String, enum: ['automatic', 'manual'], required: true },
  fromUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  fromName:     { type: String, default: '' },
  toUserId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  toName:       { type: String, default: '' },
  reason:       { type: String, default: '' },
  /** Everyone above the chosen person (or the whole chain), and why they were skipped. */
  unavailable:  { type: [unavailableSchema], default: [] },
  /** The manager, for a manual entry; null when the scheduler decided. */
  byUserId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName:       { type: String, default: '' },
}, { _id: true });
