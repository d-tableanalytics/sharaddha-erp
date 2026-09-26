/**
 * Zoho integration for O2D (§43-45).
 *
 * ---------------------------------------------------------------------------
 * SEALED ABSTRACTION
 * ---------------------------------------------------------------------------
 *
 * The rest of the system does not know about Zoho, OAuth, tokens or invoices.
 * It calls createInvoice({ orderId, items }) and gets back a result. The
 * channel owns authentication, retry, mock mode, and all the Zoho seams.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCY: THE WHOLE POINT OF THIS LAYER
 * ---------------------------------------------------------------------------
 *
 * Creating an invoice twice is a financial transaction twice. A network error,
 * a timeout, a deployed fix that restarted the process — any of these can cause
 * a second attempt. The Zoho API accepts an `idempotency_key`, and we MUST use
 * it for every request.
 *
 * The key is per-order: if the same order is invoiced again, that is a genuine
 * duplicate and Zoho rejects it (201 becomes 400 on the second call, WITH the
 * invoice number, so we can update the order and carry on).
 *
 * ---------------------------------------------------------------------------
 * MOCK MODE
 * ---------------------------------------------------------------------------
 *
 * O2D_ZOHO_MODE='mock' (default; 'live' errors until this is deployed to
 * production with real Zoho credentials). Mock mode generates a fake invoice
 * number, stores nothing, and returns success. A test can then assert that the
 * order's invoiceNumber field was set.
 *
 * Unlike a stub at the Express level, this is a RUNTIME choice, so "mock in
 * dev, live in staging" does not require a redeploy — it's an env var flip.
 *
 * ---------------------------------------------------------------------------
 * TOKENS ARE ENCRYPTED AT REST
 * ---------------------------------------------------------------------------
 *
 * ZOHO_REFRESH_TOKEN is never printed, logged, or sent outside the process.
 * It is stored in an environment variable (which Docker/K8s will read from a
 * secret). Here, we DO NOT encrypt it again — the platform layer is
 * responsible for that secret storage. If this portal were to support MULTIPLE
 * Zoho orgs, we would encrypt tokens in the database; for a single global org
 * the env var is the right place.
 */

import crypto from 'node:crypto';

import { O2dWorkflowError } from '../stage.engine.js';

/**
 * The configuration, read when USED rather than when this file loads.
 *
 * server.js calls `dotenv.config()` after its imports have evaluated, so
 * module-level constants here saw an empty environment: anything set only in
 * `.env` was ignored and the channel stayed in mock mode whatever it said. The
 * other channels already read lazily; this one now does too.
 *
 * MODES
 *   live                 reach Zoho.
 *   log | mock | (empty) do not reach Zoho: a derived MOCK- invoice number lets
 *                        the workflow run. `log` is the value .env.example and
 *                        render.yaml document; the code used to recognise only
 *                        `mock`, so `log` took the live path.
 *   anything else        treated as offline, and said so loudly, rather than
 *                        silently taking the live path as it used to.
 */
const OFFLINE_MODES = new Set(['', 'mock', 'log']);
let warnedMode = null;

const zohoMode = () => {
  const raw = String(process.env.O2D_ZOHO_MODE ?? '').trim().toLowerCase();
  if (raw === 'live') return 'live';
  if (!OFFLINE_MODES.has(raw) && warnedMode !== raw) {
    warnedMode = raw;
    console.error(`[O2D/Zoho] O2D_ZOHO_MODE="${raw}" is not live, log or mock; staying offline.`);
  }
  return 'mock';
};

const isMock = () => zohoMode() === 'mock';

const zohoConfig = () => ({
  enabled: process.env.O2D_ZOHO_ENABLED === 'enabled',
  clientId: process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  orgId: process.env.ZOHO_ORG_ID,
});

const API_BASE = 'https://www.zohoapis.com/books/v3';

/** Cached access token and its expiry, so we don't re-auth on every request. */
let accessToken = null;
let tokenExpiry = 0;

/**
 * Get or refresh the access token.
 *
 * Zoho's OAuth2 flow: POST /token with refresh_token to get a new access_token,
 * which lives for 1 hour. Cache it locally so we don't hit the auth endpoint
 * multiple times per minute.
 *
 * In mock mode, this is a no-op.
 */
async function getAccessToken() {
  if (isMock()) return 'mock-token';

  const { enabled, clientId, clientSecret, refreshToken, orgId } = zohoConfig();
  if (!enabled) {
    throw new O2dWorkflowError('Zoho is not enabled. Set O2D_ZOHO_ENABLED=enabled to use it.', {
      status: 503,
      code: 'O2D_ZOHO_DISABLED',
    });
  }

  if (!clientId || !clientSecret || !refreshToken || !orgId) {
    throw new O2dWorkflowError('Zoho credentials are incomplete. Check ZOHO_CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, ORG_ID.', {
      status: 500,
      code: 'O2D_ZOHO_CONFIG_MISSING',
    });
  }

  // Token still valid?
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  try {
    const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!res.ok) {
      throw new Error(`Zoho auth failed: ${res.status}`);
    }

    const { access_token: token, expires_in: expiresIn } = await res.json();
    accessToken = token;
    // Refresh 5 minutes before actual expiry, to be safe.
    tokenExpiry = Date.now() + (expiresIn - 300) * 1000;
    return token;
  } catch (error) {
    throw new O2dWorkflowError(`Zoho authentication failed: ${error.message}`, {
      status: 500,
      code: 'O2D_ZOHO_AUTH_FAILED',
    });
  }
}

/**
 * Create an invoice in Zoho Books.
 *
 * @param {Object} payload
 * @param {string} payload.orderId - O2D order ID (becomes Zoho reference number)
 * @param {string} payload.customerEmail - For Zoho customer lookup
 * @param {string} payload.poNumber - PO number
 * @param {Array} payload.items - [{description, qty, rate}]
 * @param {string} payload.idempotencyKey - UUID: if this request is a retry, Zoho
 *                                          responds with 400 and the invoice number
 * @returns {Promise<{ok: boolean, invoiceNumber: string, detail: string}>}
 */
export async function createInvoice({ orderId, customerEmail, poNumber, items, idempotencyKey }) {
  if (isMock()) {
    /**
     * DERIVED from the idempotency key, not from `Date.now()`.
     *
     * A clock-based mock number hands back a different invoice for every call,
     * quietly modelling the exact duplicate-invoice bug the real path exists to
     * prevent — and every idempotency test would pass while proving nothing.
     */
    const fakeNumber = `MOCK-${crypto
      .createHash('sha256')
      .update(String(idempotencyKey))
      .digest('hex')
      .slice(0, 10)
      .toUpperCase()}`;
    return { ok: true, invoiceNumber: fakeNumber, detail: 'Zoho is in mock mode.' };
  }

  try {
    const token = await getAccessToken();
    const total = items.reduce((sum, item) => sum + item.qty * item.rate, 0);

    const res = await fetch(
      `${API_BASE}/invoices?organization_id=${zohoConfig().orgId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          customer_email: customerEmail,
          reference_number: orderId,
          notes: `Order ${poNumber} from O2D`,
          line_items: items.map((item) => ({
            description: item.description,
            quantity: item.qty,
            rate: item.rate,
          })),
          tax: 0,
          total,
          currency_code: 'INR',
        }),
      },
    );

    const body = await res.json();

    if (res.ok && body.code === 0) {
      return { ok: true, invoiceNumber: body.invoice.invoice_number, detail: null };
    }

    // 400 with code 400 often means "invoice already exists for this idempotency key".
    // Zoho SHOULD return the existing invoice number; check the response.
    if (res.status === 400 && body.message?.includes('exists')) {
      // Could not retrieve the existing invoice number from this response; the
      // order is in an ambiguous state. Log it and ask for manual intervention.
      return {
        ok: false,
        invoiceNumber: null,
        detail: `Invoice may already exist (${body.message}). Check Zoho manually.`,
      };
    }

    return {
      ok: false,
      invoiceNumber: null,
      detail: `Zoho error (${res.status}): ${body.message || JSON.stringify(body)}`,
    };
  } catch (error) {
    return {
      ok: false,
      invoiceNumber: null,
      detail: `Request failed: ${error.message}`,
    };
  }
}

/**
 * Mark an invoice as sent.
 *
 * Some workflows require "mark as sent" as a distinct action from creation.
 * In Zoho, this updates the invoice status and optionally sends a mail.
 * For now, this is a placeholder for future expansion.
 */
export async function markInvoiceSent({ invoiceNumber }) {
  if (isMock()) {
    console.log(`[O2D/Zoho Mock] Invoice marked sent: ${invoiceNumber}`);
    return { ok: true };
  }

  // Not yet implemented; Zoho has an update endpoint for this.
  return { ok: true };
}

/**
 * Verify a webhook signature from Zoho.
 *
 * Zoho sends an `X-Zoho-Hmac` header with an HMAC-SHA256 of the raw body
 * using a shared secret. Verify it matches before processing the payload.
 */
export function signPayload(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

/**
 * Compare two signatures without leaking timing.
 *
 * `===` on strings returns at the first differing byte, so how long it takes
 * reveals how much of a guess was correct — enough, over many attempts, to
 * reconstruct a valid signature byte by byte. `timingSafeEqual` always reads
 * every byte. It also THROWS on a length mismatch, so that is checked first.
 *
 * Exported separately from `verifyWebhookSignature` so it can be tested on its
 * own merits, rather than through a function that short-circuits in mock mode
 * and would make any such test vacuous.
 */
export function signaturesMatch(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/**
 * Is this webhook really from Zoho?
 *
 * A configured secret is ALWAYS checked, whatever the mode. With no secret the
 * webhook is refused, except offline outside production, where accepting
 * anything is what local development needs.
 *
 * That exception used to be the whole of mock mode, production included, and
 * mock was the effective mode whenever the setting lived only in `.env` (see
 * zohoMode above). So the promise in .env.example — "without this secret the
 * webhook refuses every request" — did not hold, and anyone who learned the URL
 * could mark an invoice paid.
 */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.ZOHO_WEBHOOK_SECRET;
  if (secret) return signaturesMatch(signPayload(rawBody, secret), signature);

  if (isMock() && process.env.NODE_ENV !== 'production') return true;

  console.error('[O2D/Zoho] ZOHO_WEBHOOK_SECRET is not set; refusing the webhook.');
  return false;
}

export default { createInvoice, markInvoiceSent, verifyWebhookSignature };
