/**
 * WhatsApp — a greenfield abstraction with a working mock.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT BUILT HERE
 * ---------------------------------------------------------------------------
 *
 * The portal has never sent a WhatsApp message and no provider has been chosen.
 * Guessing an API — Meta Cloud, Twilio, Gupshup, an on-prem gateway — would mean
 * writing code against a contract nobody has agreed to, which is worse than
 * writing none: it looks finished.
 *
 * So what is built is the SEAM:
 *
 *   - the shape every channel implements, so the notification layer is complete
 *     and testable end to end today;
 *   - a MOCK transport that records what would have been sent, so the business
 *     can review real message text against real orders before a provider exists;
 *   - one function, `deliver`, to replace when the provider is chosen. Nothing
 *     outside this file changes at that point.
 *
 * ---------------------------------------------------------------------------
 * WHY TEMPLATES ARE A SEPARATE CONCEPT
 * ---------------------------------------------------------------------------
 *
 * Every WhatsApp Business provider requires business-initiated messages to use a
 * PRE-APPROVED TEMPLATE with numbered placeholders — free text is refused
 * outside a 24-hour customer-service window. That is not a provider detail that
 * can be papered over later: it shapes what a message is allowed to say, and
 * discovering it after the notification layer was built around free text would
 * mean rewriting all of it.
 *
 * So a notification is rendered to `{ template, params }` here and now, and the
 * mock records exactly that. When a provider is chosen, the template names get
 * registered with them and `deliver` starts posting; the message bodies have
 * already been in use and reviewed.
 */

const enabled = () => process.env.O2D_WHATSAPP_ENABLED === 'enabled';

/** `mock` records and returns success; `live` needs a provider implementation. */
const mode = () => process.env.O2D_WHATSAPP_MODE || 'mock';

/**
 * Template names, to be registered with whichever provider is chosen.
 *
 * Kept as a small closed set rather than one per event: a provider charges per
 * template and reviews each by hand, and "your order needs attention" with the
 * specifics as parameters covers a dozen events that differ only in wording.
 */
export const WHATSAPP_TEMPLATES = Object.freeze({
  STAGE_DUE: 'o2d_stage_due',
  STAGE_OVERDUE: 'o2d_stage_overdue',
  ORDER_HELD: 'o2d_order_held',
  ORDER_DISPATCHED: 'o2d_order_dispatched',
  DAILY_SUMMARY: 'o2d_daily_summary',
});

const TEMPLATE_BY_EVENT = Object.freeze({
  'o2d.stage.due_soon': WHATSAPP_TEMPLATES.STAGE_DUE,
  'o2d.stage.overdue': WHATSAPP_TEMPLATES.STAGE_OVERDUE,
  'o2d.stage.escalated': WHATSAPP_TEMPLATES.STAGE_OVERDUE,
  'o2d.order.held': WHATSAPP_TEMPLATES.ORDER_HELD,
  'o2d.dispatch.completed': WHATSAPP_TEMPLATES.ORDER_DISPATCHED,
  'o2d.summary.daily': WHATSAPP_TEMPLATES.DAILY_SUMMARY,
});

/**
 * A notification, as a template invocation.
 *
 * Exported so a test — and the review screen — can assert the exact parameters
 * without sending anything.
 */
export function renderWhatsApp(notification) {
  const template = TEMPLATE_BY_EVENT[notification.event] ?? WHATSAPP_TEMPLATES.STAGE_DUE;
  return {
    template,
    // Positional, because that is how every provider's template API works.
    params: [
      notification.poNumber ?? '—',
      notification.stageNumber ? String(notification.stageNumber) : '—',
      notification.title,
    ],
  };
}

/**
 * Normalise a phone number to E.164, as every provider requires.
 *
 * India-defaulted: the portal's numbers are stored as ten digits, sometimes with
 * spaces or a leading 0, occasionally already with +91. A number that cannot be
 * made sense of is REFUSED rather than guessed at — sending an order update to
 * the wrong person is worse than not sending it.
 */
export function toE164(raw, defaultCountry = '91') {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  // A leading 0 is the domestic trunk prefix, not part of the number.
  if (digits.length === 11 && digits.startsWith('0')) return `+${defaultCountry}${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith(defaultCountry)) return `+${digits}`;
  // Already international, or a length we cannot reason about safely.
  if (digits.length >= 11 && digits.length <= 15 && String(raw).trim().startsWith('+')) {
    return `+${digits}`;
  }
  return null;
}

/**
 * 🔴 THE ONE FUNCTION TO REPLACE.
 *
 * When a provider is chosen, this posts to it and returns the same shape.
 * Everything else in the module — dedupe, retry, recipient resolution, the
 * message text — is already correct and already exercised by tests.
 */
async function deliver({ to, template, params }) {
  if (mode() === 'mock') {
    // Logged, not silent. The point of mock mode is that somebody can read what
    // would have gone out and to whom, before it does.
    console.info(
      `[o2d:whatsapp:mock] -> ${to} template=${template} params=${JSON.stringify(params)}`,
    );
    return { ok: true, detail: `mock:${template}` };
  }

  return {
    ok: false,
    detail:
      'O2D_WHATSAPP_MODE is "live" but no provider is implemented. '
      + 'Implement deliver() in whatsapp.channel.js, or set the mode back to "mock".',
  };
}

export const whatsappChannel = {
  name: 'WHATSAPP',
  isEnabled: enabled,

  async send(notification) {
    if (!enabled()) {
      return { ok: false, skipped: true, detail: 'O2D_WHATSAPP_ENABLED is not set' };
    }

    const to = toE164(notification.recipientPhone);
    if (!to) {
      return {
        ok: false,
        skipped: true,
        detail: notification.recipientPhone
          ? `"${notification.recipientPhone}" is not a number we can dial safely`
          : 'That account has no phone number',
      };
    }

    try {
      const { template, params } = renderWhatsApp(notification);
      return await deliver({ to, template, params });
    } catch (error) {
      return { ok: false, detail: error?.message ?? 'Unknown WhatsApp failure' };
    }
  },
};

export default whatsappChannel;
