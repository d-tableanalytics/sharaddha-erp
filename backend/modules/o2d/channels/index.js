/**
 * Delivery channels.
 *
 * ---------------------------------------------------------------------------
 * THE POINT OF THE ABSTRACTION
 * ---------------------------------------------------------------------------
 *
 * §42: a stage controller must not know whether a notification goes by email,
 * WhatsApp or the in-app bell. It announces what happened; this decides how it
 * travels. Adding SMS later is a file in this folder and one entry below — not
 * a change to any producer.
 *
 * Every channel exports the SAME shape:
 *
 *   name       the COMMUNICATION_CHANNELS value
 *   isEnabled()  whether this deployment has it switched on
 *   send(notification) -> { ok, detail }   never throws
 *
 * `send` never throwing is load-bearing. A notification is a courtesy on top of
 * a fact that is already recorded and already audited; a WhatsApp outage must
 * not be the reason a dispatch cannot be recorded. Failures are RETURNED, so the
 * notification row can be marked FAILED and retried, rather than swallowed into
 * a log nobody reads.
 *
 * ---------------------------------------------------------------------------
 * MOCK MODE IS THE DEFAULT, NOT A TEST FIXTURE
 * ---------------------------------------------------------------------------
 *
 * Both outward channels default to OFF. Email and WhatsApp reach people who are
 * not looking at the application, cannot be recalled, and land in mailboxes and
 * phones this system does not control — during a migration, with 2,315
 * historical orders about to be imported, an accidental fan-out is the single
 * most expensive mistake available.
 *
 * So: enabling is a deployment decision, and a disabled channel records the
 * notification with status SKIPPED rather than silently dropping it. What WOULD
 * have been sent is then answerable from the database.
 */

import { emailChannel } from './email.channel.js';
import { whatsappChannel } from './whatsapp.channel.js';
import { inAppChannel } from './inapp.channel.js';

export const CHANNELS = Object.freeze({
  EMAIL: emailChannel,
  WHATSAPP: whatsappChannel,
  IN_APP: inAppChannel,
});

export const channelFor = (name) => CHANNELS[name] ?? null;

export { emailChannel, whatsappChannel, inAppChannel };
export default { CHANNELS, channelFor };
