/**
 * Zoho Books webhook handler for invoice status updates (§45).
 *
 * ---------------------------------------------------------------------------
 * RAW BODY SIGNATURE VERIFICATION
 * ---------------------------------------------------------------------------
 *
 * Zoho sends an HMAC-SHA256 signature in `X-Zoho-Hmac` computed over the
 * exact bytes of the request body. express.json() consumes the stream, so by
 * the time our handler runs there are no bytes left to verify.
 *
 * The solution: express.json({ verify }) is a hook that runs WITH the raw
 * buffer, before parsing, and is where we stash it. This is the same pattern
 * used by the HRMS biometric webhook — see modules/hrms/attendance/rawBody.js.
 *
 * The cost is minimal: the hook tests one URL and ignores everything else, so a
 * second copy of the body is kept only for this endpoint.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ROUTE SITS OUTSIDE `protect`
 * ---------------------------------------------------------------------------
 *
 * Zoho holds no session and never will. It is authenticated by the HMAC below
 * rather than by a JWT — which is why the missing-secret case in the channel
 * REFUSES rather than warning: an unsigned webhook endpoint lets anyone who
 * learns the URL mark invoices paid.
 */

import { O2D_API_PREFIX } from '../../shared/constants/o2d.js';
import { verifyWebhookSignature } from './channels/zoho.channel.js';
import { handleZohoWebhook } from './invoicing.service.js';

/** The one path whose raw bytes are kept. */
export const ZOHO_WEBHOOK_PATH = `${O2D_API_PREFIX}/webhooks/zoho`;

/**
 * `express.json({ verify })` hook.
 *
 * `req.originalUrl`, NOT `req.path`: this runs before any router has been
 * reached, let alone stripped its mount prefix, so `req.path` is not yet the
 * value this comparison needs. A query string can still be attached, hence the
 * split. This is the same shape as `captureBiometricRawBody`, deliberately —
 * the two hooks are composed in app.js and must behave identically.
 */
export function captureZohoRawBody(req, _res, buf) {
  const url = req.originalUrl ?? req.url ?? '';
  if (buf?.length && url.split('?')[0].startsWith(ZOHO_WEBHOOK_PATH)) {
    req.rawBody = buf;
  }
}

/**
 * Webhook payload handler.
 *
 * Zoho sends `{ invoice_number, status, ... }`. The invoice number is looked up
 * against this portal's own records, so a payload naming an invoice we did not
 * raise changes nothing.
 *
 * Answers 200 even on failure, deliberately: a 5xx makes Zoho retry a callback
 * that will fail identically every time, and the retries bury the real error.
 * The refusals that DO matter — a bad signature, a missing field — answer 4xx,
 * because those are worth Zoho telling somebody about.
 */
export async function handleWebhook(req, res, next) {
  try {
    // Verify the signature.
    const signature = req.headers['x-zoho-hmac'];
    if (!signature) {
      console.warn('[O2D/Zoho Webhook] Missing X-Zoho-Hmac header');
      return res.status(400).json({ success: false, message: 'Missing signature' });
    }

    if (!req.rawBody) {
      console.warn('[O2D/Zoho Webhook] No raw body captured');
      return res.status(400).json({ success: false, message: 'No body' });
    }

    if (!verifyWebhookSignature(req.rawBody, signature)) {
      console.warn('[O2D/Zoho Webhook] Signature verification failed');
      return res.status(403).json({ success: false, message: 'Invalid signature' });
    }

    // Parse and process the payload.
    const { invoice_number, status } = req.body ?? {};

    if (!invoice_number || !status) {
      return res.status(400).json({ success: false, message: 'Missing invoice_number or status' });
    }

    const result = await handleZohoWebhook({ invoiceNumber: invoice_number, status });

    // Always return 200; Zoho will retry if we error.
    return res.status(200).json({ success: result.ok, message: result.message });
  } catch (error) {
    console.error('[O2D/Zoho Webhook] Error:', error.message);
    // Return 200 so Zoho stops retrying. Log it for manual investigation.
    return res.status(200).json({ success: false, message: error.message });
  }
}

export default { ZOHO_WEBHOOK_PATH, captureZohoRawBody, handleWebhook };
