/**
 * One notification, addressed to one person, on one channel.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `InboxItem`
 * ---------------------------------------------------------------------------
 *
 * HRMS already has an inbox, and it is good. It is also keyed on
 * `recipientEmployeeId`, because every HRMS notification is about a person's own
 * employment — their leave, their appraisal, their asset.
 *
 * O2D addresses ROLES. "The picking request is waiting" goes to whoever is
 * Warehouse User today, and several of the roles this module exists for —
 * Billing, Accounts — are portal accounts that need not have an Employee record
 * at all. Widening `InboxItem` to accept either kind of recipient would make
 * every one of its twenty existing producers, its indexes and its retention
 * sweep handle a case none of them have.
 *
 * So this is a sibling, keyed on `user`. What is NOT duplicated is the delivery:
 * email goes through `utils/mailer.js`, the portal's one mailer, with its
 * blocklist and its dev simulator intact.
 *
 * ---------------------------------------------------------------------------
 * ONE ROW PER (RECIPIENT, EVENT, CHANNEL) — AND WHY THAT MATTERS
 * ---------------------------------------------------------------------------
 *
 * §42 wants reminders, not nagging. The escalation sweep runs every few minutes
 * and would otherwise re-send "stage 7 is overdue" on every pass. `dedupeKey`
 * carries a unique index, so a second attempt at the same notification is
 * refused by the DATABASE rather than by a check that races with itself when two
 * workers sweep at once.
 */

import mongoose from 'mongoose';

import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_STATUS,
  STAGE_NUMBERS,
} from '../../shared/constants/o2d.js';

const o2dNotificationSchema = new mongoose.Schema(
  {
    /** The portal account. Not an employee — see the note above. */
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** Denormalised so a delivery retry needs no join. */
    recipientEmail: { type: String, default: null, trim: true, lowercase: true, maxlength: 320 },
    recipientPhone: { type: String, default: null, trim: true, maxlength: 32 },
    recipientRole: { type: String, default: null, trim: true, maxlength: 60 },

    /** One of `O2D_EVENTS`. Free-form so a new event needs no migration. */
    event: { type: String, required: true, trim: true, maxlength: 80, index: true },

    channel: { type: String, required: true, enum: COMMUNICATION_CHANNELS },
    status: { type: String, required: true, enum: COMMUNICATION_STATUS, default: 'PENDING' },

    // ── What it is about ───────────────────────────────────────────────────
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'O2dOrder', default: null, index: true },
    poNumber: { type: String, default: null, trim: true, maxlength: 80 },
    stageNumber: { type: Number, default: null, enum: [...STAGE_NUMBERS, null] },

    // ── What it says ───────────────────────────────────────────────────────
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, default: null, trim: true, maxlength: 2000 },

    /**
     * Where clicking it should go — a path, never a full URL.
     *
     * The host differs between environments and between the two portals; storing
     * an absolute link would send somebody from staging into production.
     */
    href: { type: String, default: null, trim: true, maxlength: 300 },

    // ── Delivery ───────────────────────────────────────────────────────────
    /**
     * `<event>:<orderId>:<stageNumber>:<userId>:<channel>` — unique.
     *
     * The whole reason the sweep can run every two minutes without becoming
     * spam. Built by the notification service; never supplied by a caller.
     */
    dedupeKey: { type: String, required: true, trim: true, maxlength: 300 },

    sentAt: { type: Date, default: null },
    failureReason: { type: String, default: null, trim: true, maxlength: 500 },
    attempts: { type: Number, default: 0 },

    /** IN_APP only. Email and WhatsApp leave the building and cannot be unread. */
    readAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'o2d_notifications' },
);

/**
 * The idempotency guarantee, enforced by the database.
 *
 * A pre-check in application code would still double-send when the reminder
 * sweep and a stage completion fire in the same instant, which is exactly when
 * it matters.
 */
o2dNotificationSchema.index({ dedupeKey: 1 }, { unique: true });

/** The bell: this user's unread in-app notifications, newest first. */
o2dNotificationSchema.index({ user: 1, channel: 1, readAt: 1, createdAt: -1 });

/** The retry sweep, and "what failed last night". */
o2dNotificationSchema.index({ status: 1, createdAt: -1 });

export const O2dNotification =
  mongoose.models.O2dNotification || mongoose.model('O2dNotification', o2dNotificationSchema);
export default O2dNotification;
