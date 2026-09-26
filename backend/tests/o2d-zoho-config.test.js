/**
 * The Zoho channel reads its configuration when it is USED.
 *
 * server.js loads `.env` after its imports have evaluated, and this channel
 * used to read O2D_ZOHO_MODE and the credentials into module constants — so a
 * value set only in `.env` was never seen. Every test here changes the
 * environment AFTER the module is imported, which is the situation that failed.
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInvoice,
  verifyWebhookSignature,
  signPayload,
} from '../modules/o2d/channels/zoho.channel.js';

const KEYS = ['O2D_ZOHO_MODE', 'O2D_ZOHO_ENABLED', 'ZOHO_WEBHOOK_SECRET', 'NODE_ENV',
  'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ORG_ID'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const invoice = () => createInvoice({
  orderId: 'o1', customerEmail: 'a@b.c', poNumber: 'PO-1', items: [], idempotencyKey: 'k1',
});

test('a mode set after import takes effect', async () => {
  process.env.O2D_ZOHO_MODE = 'live';
  delete process.env.O2D_ZOHO_ENABLED;
  const res = await invoice();
  // Live, and disabled: it refuses rather than faking a number.
  assert.equal(res.ok, false);
  assert.match(res.detail, /not enabled/i);
});

test('`log` — the documented value — stays offline', async () => {
  process.env.O2D_ZOHO_MODE = 'log';
  const res = await invoice();
  assert.equal(res.ok, true);
  assert.match(res.invoiceNumber, /^MOCK-/);
});

test('empty and unset stay offline, as before', async () => {
  process.env.O2D_ZOHO_MODE = '';
  assert.match((await invoice()).invoiceNumber, /^MOCK-/);
  delete process.env.O2D_ZOHO_MODE;
  assert.match((await invoice()).invoiceNumber, /^MOCK-/);
});

test('an unknown mode stays offline instead of taking the live path', async () => {
  process.env.O2D_ZOHO_MODE = 'staging';
  assert.match((await invoice()).invoiceNumber, /^MOCK-/);
});

test('a configured webhook secret is checked in every mode', () => {
  const body = '{"invoice_number":"INV-1","status":"paid"}';
  process.env.ZOHO_WEBHOOK_SECRET = 's3cret';
  for (const mode of ['mock', 'log', 'live']) {
    process.env.O2D_ZOHO_MODE = mode;
    assert.equal(verifyWebhookSignature(body, signPayload(body, 's3cret')), true, mode);
    assert.equal(verifyWebhookSignature(body, 'forged'), false, mode);
  }
});

test('with no secret: accepted offline in development, refused in production and live', () => {
  const body = '{}';
  delete process.env.ZOHO_WEBHOOK_SECRET;

  process.env.O2D_ZOHO_MODE = 'mock';
  process.env.NODE_ENV = 'development';
  assert.equal(verifyWebhookSignature(body, 'anything'), true);

  process.env.NODE_ENV = 'production';
  assert.equal(verifyWebhookSignature(body, 'anything'), false);

  process.env.NODE_ENV = 'development';
  process.env.O2D_ZOHO_MODE = 'live';
  assert.equal(verifyWebhookSignature(body, 'anything'), false);
});
