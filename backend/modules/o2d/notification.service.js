/**
 * Who hears about what, and how (§42).
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE
 * ---------------------------------------------------------------------------
 *
 * The stage engine returns EVENTS. It sends nothing, and it does not know that
 * WhatsApp exists. This module turns an event into notifications:
 *
 *   event -> recipients (by ROLE, from the stage master)
 *         -> a rendered title and body
 *         -> one row per (recipient, channel), deduped
 *         -> delivery, per channel, never throwing
 *
 * Producers call `dispatch(events)` and move on. Adding a channel, changing who
 * is told, or rewording a message is a change here and nowhere else.
 *
 * ---------------------------------------------------------------------------
 * RECIPIENTS ARE RESOLVED FROM THE STAGE MASTER, NOT HARDCODED
 * ---------------------------------------------------------------------------
 *
 * §37 lets an administrator reassign a stage's owner without a deploy. A
 * constant mapping stage 7 to "Warehouse User" here would keep notifying the old
 * team after somebody changed it — and the notification layer is precisely where
 * that goes unnoticed longest, because nobody reports mail they did not receive.
 *
 * ---------------------------------------------------------------------------
 * NEVER THROWS
 * ---------------------------------------------------------------------------
 *
 * Same rule the HRMS notifier settled on, for the same reason: a notification is
 * a courtesy on top of a fact that is already recorded and already audited. A
 * warehouse must not be unable to record a departed truck because SMTP was down.
 */

import mongoose from 'mongoose';

import User from '../../models/User.js';
import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../../models/o2d/O2dStageMaster.js';
import { O2dNotification } from '../../models/o2d/O2dNotification.js';
import { channelFor } from './channels/index.js';
import { O2D_EVENTS, COMMUNICATION_CHANNELS } from '../../shared/constants/o2d.js';

/**
 * Which channels an event travels on.
 *
 * Not "everything everywhere". An order being created is worth a bell and
 * nothing more; an escalation is worth interrupting somebody's evening. Getting
 * this wrong in the generous direction is how a notification system trains its
 * users to ignore it.
 */
const ROUTING = Object.freeze({
  [O2D_EVENTS.STAGE_UNLOCKED]: ['IN_APP'],
  [O2D_EVENTS.STAGE_DUE_SOON]: ['IN_APP'],
  [O2D_EVENTS.STAGE_OVERDUE]: ['IN_APP', 'EMAIL'],
  // The only event that reaches a phone by default: somebody senior is being
  // told that a deadline has been missed and nobody acted on the reminder.
  [O2D_EVENTS.STAGE_ESCALATED]: ['IN_APP', 'EMAIL', 'WHATSAPP'],
  [O2D_EVENTS.ORDER_HELD]: ['IN_APP', 'EMAIL'],
  [O2D_EVENTS.ORDER_RESUMED]: ['IN_APP'],
  [O2D_EVENTS.ORDER_CANCELLED]: ['IN_APP', 'EMAIL'],
  [O2D_EVENTS.ADVANCE_PENDING]: ['IN_APP'],
  [O2D_EVENTS.INVOICE_CREATED]: ['IN_APP'],
  [O2D_EVENTS.DISPATCH_COMPLETED]: ['IN_APP'],
  [O2D_EVENTS.ORDER_CLOSED]: ['IN_APP'],
  [O2D_EVENTS.DAILY_SUMMARY]: ['EMAIL'],
  // Deliberately absent: ORDER_CREATED and STAGE_COMPLETED. Every order is
  // created and every stage completes, so notifying on them would mean a
  // notification per stage per order — noise that buries the exceptions.
});

/** Active portal accounts holding any of these roles. */
async function usersInRoles(roles = []) {
  const wanted = [...new Set(roles.filter(Boolean))];
  if (wanted.length === 0) return [];

  return User.find({ role: { $in: wanted }, status: 'Active' })
    .select('_id email user role phone')
    .lean();
}

/**
 * Events about the ORDER rather than about a stage.
 *
 * These carry a `stageNumber` for context — a hold records where the order was
 * when it stopped — but they are not that stage's business, they are everyone's.
 * Deciding "is this a stage event?" by whether a stage number is present looks
 * right and is wrong: it sent "this order is on hold" to the team whose task had
 * just disappeared, and to nobody accountable for the workflow.
 */
const ORDER_LEVEL_EVENTS = new Set([
  O2D_EVENTS.ORDER_HELD,
  O2D_EVENTS.ORDER_RESUMED,
  O2D_EVENTS.ORDER_CANCELLED,
  O2D_EVENTS.ORDER_CLOSED,
  O2D_EVENTS.DAILY_SUMMARY,
]);

/** Oversight: the people accountable for the workflow as a whole. */
const OVERSIGHT_ROLES = ['Management', 'Billing Head'];

/**
 * Who should hear about this event.
 *
 * Reads the stage master for the roles, so an administrator's reassignment takes
 * effect immediately (§37). An escalation goes to the stage's `escalationRole`
 * rather than its owner — the whole point is that the owner did not act.
 */
async function recipientsFor(event, { stageNumber = null, escalate = false } = {}) {
  // The digest is oversight only — sending it to everyone who works a stage
  // would be a daily email about work that is not theirs.
  if (event === O2D_EVENTS.DAILY_SUMMARY) return usersInRoles(OVERSIGHT_ROLES);

  const master = stageNumber == null
    ? null
    : await O2dStageMaster.findOne({ stageNumber })
        .select('ownerRole alsoAllowedRoles completedByRole escalationRole')
        .lean();

  if (ORDER_LEVEL_EVENTS.has(event)) {
    /**
     * Oversight AND the team holding the order.
     *
     * Both, because they need it for different reasons: management is
     * accountable for the exception, and the team currently working the order
     * needs to know why their task vanished from the queue. Telling only one of
     * them is how somebody keeps chasing an order that was cancelled yesterday.
     */
    const stageRoles = master ? [master.completedByRole || master.ownerRole] : [];
    const users = await usersInRoles([...OVERSIGHT_ROLES, ...stageRoles]);
    // `usersInRoles` already de-duplicates by document, but a person holding an
    // oversight role who also works the stage would otherwise be listed twice
    // if the two queries were run separately.
    return users;
  }

  if (!master) return [];

  if (escalate) {
    return usersInRoles([master.escalationRole ?? 'Management']);
  }

  // The role that CLOSES the stage is the one that needs telling — §5 and §10.
  // Telling the owner of a stage somebody else records would send "the picking
  // request is waiting" to Billing, who raised it.
  const closer = master.completedByRole || master.ownerRole;
  return usersInRoles([closer, ...(master.alsoAllowedRoles ?? [])]);
}

/** `<event>:<orderId>:<stage>:<user>:<channel>` — see the model. */
const dedupeKeyFor = (event, orderId, stageNumber, userId, channel) =>
  `${event}:${orderId ?? 'none'}:${stageNumber ?? 'none'}:${userId}:${channel}`;

/**
 * The words.
 *
 * Written as sentences a person can act on, not as event names. "o2d.stage.
 * overdue" tells somebody nothing; "Stage 7 on PO-4471 is 3 hours past its
 * deadline" tells them what to open and why.
 */
function render(event, { order, stage, payload = {} }) {
  const po = order?.poNumber ?? payload.poNumber ?? 'an order';
  const customer = order?.customerName ? ` for ${order.customerName}` : '';
  const stageName = stage?.stageName ?? (stage ? `Stage ${stage.stageNumber}` : null);

  switch (event) {
    case O2D_EVENTS.STAGE_UNLOCKED:
      return {
        title: `${stageName} is ready on ${po}`,
        body: `${po}${customer} has reached ${stageName}. It is now waiting on your team.`,
      };
    case O2D_EVENTS.STAGE_DUE_SOON:
      return {
        title: `${stageName} on ${po} is due soon`,
        body: `Most of the allowed time for ${stageName} has passed.`,
      };
    case O2D_EVENTS.STAGE_OVERDUE:
      return {
        title: `${stageName} on ${po} is overdue`,
        body: `${stageName}${customer} has passed its deadline and is still open.`,
      };
    case O2D_EVENTS.STAGE_ESCALATED:
      return {
        title: `Escalation: ${stageName} on ${po}`,
        body: `${stageName}${customer} is still open well past its deadline and the reminder was not acted on.`,
      };
    case O2D_EVENTS.ORDER_HELD:
      return {
        title: `${po} is on hold`,
        body: `Reason: ${payload.reason ?? 'not given'}. SLA deadlines are frozen until it resumes.`,
      };
    case O2D_EVENTS.ORDER_RESUMED:
      return { title: `${po} has resumed`, body: 'Deadlines have been extended by the time held.' };
    case O2D_EVENTS.ORDER_CANCELLED:
      return {
        title: `${po} was ${String(payload.exitType ?? 'cancelled').toLowerCase()}`,
        body: `At stage ${payload.stageAtExit ?? '—'}. Reason: ${payload.reason ?? 'not given'}.`,
      };
    case O2D_EVENTS.ADVANCE_PENDING:
      return {
        title: `${po} is waiting on an advance payment`,
        body: 'Stage 5 stays open until Accounts record the payment.',
      };
    case O2D_EVENTS.INVOICE_CREATED:
      return { title: `Invoice ${payload.invoiceNumber ?? ''} raised for ${po}`.trim(), body: null };
    case O2D_EVENTS.DISPATCH_COMPLETED:
      return { title: `${po} has dispatched`, body: `Dispatched${customer}.` };
    case O2D_EVENTS.ORDER_CLOSED:
      return { title: `${po} is closed`, body: null };
    default:
      return { title: `${po}: ${event}`, body: null };
  }
}

const hrefFor = (orderId) => (orderId ? `/o2d/orders?open=${orderId}` : '/o2d/orders');

/**
 * Turn one event into delivered notifications.
 *
 * @returns {Promise<{written: number, sent: number, skipped: number, failed: number}>}
 */
export async function dispatchEvent(event, payload = {}, { escalate = false } = {}) {
  const tally = { written: 0, sent: 0, skipped: 0, failed: 0 };

  try {
    const channels = ROUTING[event];
    // An event nobody routed is not an error — it is an event deliberately not
    // notified on, like every stage completion.
    if (!channels?.length) return tally;

    const orderId = payload.orderId ? String(payload.orderId) : null;
    const stageNumber = payload.stageNumber ?? null;

    const [order, stage] = await Promise.all([
      orderId && mongoose.isValidObjectId(orderId)
        ? O2dOrder.findById(orderId).select('poNumber customerName').lean()
        : null,
      orderId && stageNumber != null && mongoose.isValidObjectId(orderId)
        ? O2dOrderStage.findOne({ order: orderId, stageNumber }).select('stageName stageNumber').lean()
        : null,
    ]);

    const recipients = await recipientsFor(event, { stageNumber, escalate });
    if (recipients.length === 0) return tally;

    const { title, body } = render(event, { order, stage, payload });
    const href = hrefFor(orderId);

    for (const user of recipients) {
      for (const channelName of channels) {
        if (!COMMUNICATION_CHANNELS.includes(channelName)) continue;

        const dedupeKey = dedupeKeyFor(event, orderId, stageNumber, user._id, channelName);

        let row;
        try {
          row = await O2dNotification.create({
            user: user._id,
            recipientEmail: user.email ?? null,
            recipientPhone: user.phone ?? null,
            recipientRole: user.role ?? null,
            event,
            channel: channelName,
            status: 'PENDING',
            order: orderId,
            poNumber: order?.poNumber ?? payload.poNumber ?? null,
            stageNumber,
            title,
            body,
            href,
            dedupeKey,
          });
        } catch (error) {
          // 11000 means this exact notification already exists — the sweep has
          // run again, or two producers fired at once. That is the dedupe index
          // doing its job, not a failure.
          if (error?.code === 11000) continue;
          throw error;
        }

        tally.written += 1;

        const channel = channelFor(channelName);
        const result = await channel.send(row);

        row.attempts += 1;
        if (result.ok) {
          row.status = 'SENT';
          row.sentAt = new Date();
          tally.sent += 1;
        } else if (result.skipped) {
          // SKIPPED, not FAILED. A channel that is switched off has not failed,
          // and burying it in the failure count would hide real failures.
          row.status = 'SKIPPED';
          row.failureReason = result.detail ?? null;
          tally.skipped += 1;
        } else {
          row.status = 'FAILED';
          row.failureReason = result.detail ?? null;
          tally.failed += 1;
        }
        await row.save();
      }
    }

    return tally;
  } catch (error) {
    console.error(`[o2d:notify] dispatch of "${event}" failed:`, error?.message ?? error);
    return tally;
  }
}

/**
 * The producer-facing call. Takes the array the stage engine returns.
 *
 * Sequential rather than parallel: the events from one transition are related
 * (a stage completed, the next unlocked), and firing them concurrently would
 * race the dedupe index for no benefit at this volume.
 */
export async function dispatch(events = []) {
  const totals = { written: 0, sent: 0, skipped: 0, failed: 0 };
  for (const e of Array.isArray(events) ? events : []) {
    if (!e?.type) continue;
    const tally = await dispatchEvent(e.type, e.payload ?? {});
    for (const key of Object.keys(totals)) totals[key] += tally[key];
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Reading them back
// ---------------------------------------------------------------------------

/** The bell: this user's in-app notifications. */
export async function listForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
  const filter = { user: userId, channel: 'IN_APP' };
  if (unreadOnly) filter.readAt = null;

  const [data, unread] = await Promise.all([
    O2dNotification.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    O2dNotification.countDocuments({ user: userId, channel: 'IN_APP', readAt: null }),
  ]);

  return { data, unread };
}

/**
 * Mark as read.
 *
 * Scoped to the caller's own rows by the FILTER rather than by a check after
 * fetching — an id from the URL that belongs to somebody else then matches
 * nothing, instead of being found and then refused.
 */
export async function markRead(userId, notificationIds = []) {
  const ids = notificationIds.filter((id) => mongoose.isValidObjectId(id));
  const filter = { user: userId, channel: 'IN_APP', readAt: null };
  if (ids.length > 0) filter._id = { $in: ids };

  const result = await O2dNotification.updateMany(filter, { $set: { readAt: new Date() } });
  return { updated: result.modifiedCount ?? 0 };
}

export default { dispatch, dispatchEvent, listForUser, markRead, ROUTING };
