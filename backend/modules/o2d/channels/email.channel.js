import { sendEmail } from '../../../utils/mailer.js';
import { isBlockedRecipient } from '../../../utils/mailRecipients.js';

/**
 * Email, through the portal's ONE mailer.
 *
 * Deliberately an adapter rather than a transport. `utils/mailer.js` already
 * carries the recipient blocklist, the "a missing SMTP_HOST is not a dev
 * setting" guard, and the shell every portal mail shares. A second nodemailer
 * instance here would mean two configurations and two places for the blocklist
 * to be forgotten — and the blocklist exists because two real addresses were
 * being copied on live customer mail.
 *
 * `O2D_EMAIL_ENABLED` gates it, default OFF. See the note in channels/index.js.
 */

const enabled = () => process.env.O2D_EMAIL_ENABLED === 'enabled';

/**
 * The mail body.
 *
 * Plain and short on purpose. This is an operational nudge — "stage 7 is
 * overdue" — read on a phone between other tasks, and the useful content is the
 * PO number and what is wanted. The order's own detail lives in the portal,
 * behind the link, where it is access-controlled; an email that reproduced it
 * would be an unauthenticated copy of business data sitting in a mailbox.
 */
const render = (n) => `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
    <p style="font-size:15px;margin:0 0 8px">${escapeHtml(n.title)}</p>
    ${n.body ? `<p style="font-size:13px;color:#475569;margin:0 0 12px">${escapeHtml(n.body)}</p>` : ''}
    ${
      n.poNumber
        ? `<p style="font-size:13px;margin:0 0 12px">
             <strong>PO:</strong> ${escapeHtml(n.poNumber)}
             ${n.stageNumber ? ` &middot; <strong>Stage:</strong> ${n.stageNumber}` : ''}
           </p>`
        : ''
    }
    ${
      n.href && process.env.EMPLOYEE_PORTAL_URL
        ? `<p style="font-size:13px;margin:0">
             <a href="${escapeHtml(`${process.env.EMPLOYEE_PORTAL_URL}${n.href}`)}">Open in the portal</a>
           </p>`
        : ''
    }
  </div>
`;

/**
 * Escape before interpolating.
 *
 * A PO number is customer-supplied text arriving from a scanned document, and
 * it lands in an HTML email. `PO<script>` is not a realistic attack here, but
 * `Smith & Sons` rendering as `Smith &amp; Sons` — or breaking the markup — is
 * an entirely realistic embarrassment.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const emailChannel = {
  name: 'EMAIL',
  isEnabled: enabled,

  async send(notification) {
    if (!enabled()) return { ok: false, skipped: true, detail: 'O2D_EMAIL_ENABLED is not set' };

    const to = notification.recipientEmail;
    if (!to) return { ok: false, detail: 'That account has no email address' };

    // Checked here as well as inside `sendEmail`, so the notification row
    // records SKIPPED-because-blocked rather than a bare failure. The mailer's
    // own check stays as the last line of defence for other call paths.
    if (isBlockedRecipient(to)) {
      return { ok: false, skipped: true, detail: 'Recipient is on the blocklist' };
    }

    try {
      const sent = await sendEmail(to, notification.title, render(notification));
      return sent
        ? { ok: true, detail: 'sent' }
        : { ok: false, detail: 'The mailer declined to send' };
    } catch (error) {
      // `sendEmail` already swallows transport errors, so reaching here means
      // something unexpected. Returned rather than thrown — see channels/index.
      return { ok: false, detail: error?.message ?? 'Unknown mail failure' };
    }
  },
};

export default emailChannel;
