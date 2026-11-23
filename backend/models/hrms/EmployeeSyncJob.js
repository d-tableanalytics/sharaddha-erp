/**
 * The outbox for Employee Portal -> HRMS employee synchronisation.
 *
 * ---------------------------------------------------------------------------
 * WHY AN OUTBOX AND NOT "just call the service"
 * ---------------------------------------------------------------------------
 * Creating a portal account and creating the HRMS employee behind it are two
 * writes in two collections, and the first one is the request the administrator
 * is waiting on. Three things can go wrong between them:
 *
 *   - a validation error in the mapped employee (a name that will not split, a
 *     generated code that collided)
 *   - a transient database failure, which on a remote Atlas cluster is a normal
 *     Tuesday rather than an exception
 *   - a deploy landing between the two writes
 *
 * None of them may fail the account creation: the login is a fact that has
 * already been written and audited, and "your user was not created because
 * HRMS was briefly unreachable" is a worse outcome than a record that arrives
 * ninety seconds late. So the sync runs after the account write, never throws,
 * and on failure leaves a row HERE.
 *
 * A row in this collection means exactly one thing: THIS ACCOUNT DOES NOT YET
 * HAVE THE HRMS RECORD IT SHOULD HAVE. The retry sweep drains it with
 * exponential backoff, and the reconciliation sweep refills it for anything
 * that was missed entirely - a user written by a script, by a migration, or by
 * a code path that predates this module.
 *
 * Rows are DELETED on success rather than marked done. The backlog is meant to
 * be short and actionable; the permanent trail of what synced and when lives in
 * `AuditLog`, which is where every other answer of that shape already lives.
 *
 * Nothing is ever dropped. `attempts` grows without a ceiling and the backoff
 * caps out at MAX_BACKOFF_MINUTES, so a record that cannot be written stays
 * visible and keeps being retried instead of silently expiring - "employee
 * records are not missed" is the requirement, and an outbox that gives up after
 * five tries does not meet it.
 */

import mongoose from 'mongoose';

const employeeSyncJobSchema = new mongoose.Schema(
  {
    /**
     * The portal account that still needs an HRMS record.
     *
     * UNIQUE: the queue is a SET of accounts needing attention, not a log of
     * attempts. Enqueueing the same user twice - an admin editing an account
     * three times while the database is down - must leave one row, not three,
     * or the backlog becomes a count of retries rather than a count of people.
     */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    /** Carried for legibility: the backlog screen should not need a join. */
    email: { type: String, default: null },
    displayName: { type: String, default: null },

    /** What triggered the sync - 'user.created', 'user.updated', 'reconcile'. */
    reason: { type: String, default: null },

    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    lastAttemptAt: { type: Date, default: null },

    /**
     * When the sweep may try again. Indexed, because the sweep's only query is
     * "everything due now, oldest first".
     */
    nextAttemptAt: { type: Date, default: Date.now, index: true },

    /** Who performed the portal action, so the retry audits to the same person. */
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

employeeSyncJobSchema.index({ nextAttemptAt: 1, createdAt: 1 });

export default mongoose.models.EmployeeSyncJob
  || mongoose.model('EmployeeSyncJob', employeeSyncJobSchema);
