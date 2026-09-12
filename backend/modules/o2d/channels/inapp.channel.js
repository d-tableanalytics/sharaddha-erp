/**
 * The in-app bell.
 *
 * The odd one out, and deliberately trivial: the notification ROW is the
 * delivery. There is nothing to transmit — the recipient reads it from the same
 * database it was written to.
 *
 * It exists as a channel anyway, rather than being special-cased in the
 * notification service, so that:
 *
 *   - the service has one loop over channels instead of a loop plus an
 *     exception, and the exception is where a bug would live;
 *   - it can be switched off by the same mechanism as the others, should a
 *     deployment ever want email only;
 *   - a future change — a websocket push, a badge count broadcast — has an
 *     obvious home, and the service does not have to learn about it.
 *
 * Unlike email and WhatsApp this defaults to ON. It reaches nobody who is not
 * already looking at the application, so the reasoning that makes the outward
 * channels opt-in does not apply.
 */

const enabled = () => process.env.O2D_INAPP_ENABLED !== 'disabled';

export const inAppChannel = {
  name: 'IN_APP',
  isEnabled: enabled,

  async send() {
    if (!enabled()) return { ok: false, skipped: true, detail: 'O2D_INAPP_ENABLED is disabled' };

    // The row the notification service has already written IS the delivery.
    return { ok: true, detail: 'filed' };
  },
};

export default inAppChannel;
