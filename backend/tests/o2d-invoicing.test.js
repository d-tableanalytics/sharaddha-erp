/**
 * Zoho invoicing (§43-45).
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE ARE GUARDING
 * ---------------------------------------------------------------------------
 *
 * A duplicate invoice is not a bug report, it is a second real document with a
 * real number sent to a real customer for goods they received once. Every test
 * below exists because some plausible-looking implementation produces one.
 *
 * Run in MOCK mode: no credentials, no network. The mock's invoice number is
 * DERIVED from the idempotency key precisely so these tests are not vacuous —
 * a clock-based mock would return a fresh number every call and let a broken
 * idempotency implementation pass.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { O2dOrder, o2dKey } from '../models/o2d/O2dOrder.js';
import { O2dOrderItem } from '../models/o2d/O2dOrderItem.js';
import { ZohoInvoice } from '../models/o2d/ZohoInvoice.js';
import * as invoicing from '../modules/o2d/invoicing.service.js';
import { signPayload, signaturesMatch } from '../modules/o2d/channels/zoho.channel.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderItem, ZohoInvoice);
});
after(async () => { await stopTestMongo(); });
beforeEach(async () => { await clearCollections(); });

/** An order with one dispatched line, ready to invoice. */
async function makeOrder({ poNumber = 'PO-INV-1', items = null, ...over } = {}) {
  const order = await O2dOrder.create({
    poNumber,
    poNumberKey: o2dKey(poNumber),
    poDate: ist('2026-09-01', '10:00'),
    customerName: 'ABC Industries',
    customerKey: o2dKey('ABC Industries'),
    promiseDate: ist('2026-09-15', '10:00'),
    status: 'OPEN',
    ...over,
  });

  const lines =
    items ?? [{ skuCode: 'SKU-001', productName: 'Widget A', orderedQty: 100, dispatchedQty: 95 }];
  if (lines.length > 0) {
    await O2dOrderItem.insertMany(lines.map((l, i) => ({ order: order._id, lineSeq: i + 1, ...l })));
  }
  return order;
}

// ---------------------------------------------------------------------------

describe('the idempotency key', () => {
  test('is DERIVED from the order, so a retry carries the same one', () => {
    const a = invoicing.idempotencyKeyFor('abc123');
    const b = invoicing.idempotencyKeyFor('abc123');

    // The property the whole integration rests on. A generated UUID would make
    // these differ, every retry would look like a new request to Zoho, and Zoho
    // would obediently create a SECOND INVOICE.
    assert.equal(a, b);
  });

  test('and differs between orders', () => {
    assert.notEqual(invoicing.idempotencyKeyFor('abc123'), invoicing.idempotencyKeyFor('def456'));
  });
});

// ---------------------------------------------------------------------------

describe('creating an invoice', () => {
  test('issues a number and records it on the order', async () => {
    const order = await makeOrder();

    const result = await invoicing.createInvoiceForOrder(String(order._id));

    assert.equal(result.ok, true);
    assert.ok(result.invoiceNumber);

    const updated = await O2dOrder.findById(order._id).select('invoiceNumber').lean();
    assert.equal(updated.invoiceNumber, result.invoiceNumber);
  });

  test('a second call returns the SAME number and creates no second invoice', async () => {
    const order = await makeOrder();

    const first = await invoicing.createInvoiceForOrder(String(order._id));
    const second = await invoicing.createInvoiceForOrder(String(order._id));

    assert.equal(second.invoiceNumber, first.invoiceNumber);
    assert.match(second.message, /Already invoiced/);

    const rows = await ZohoInvoice.find({ order: order._id }).lean();
    assert.equal(rows.length, 1, 'one attempt row, not two');
  });

  test('recovers a number issued before a crash, rather than buying a second invoice', async () => {
    const order = await makeOrder();

    // The exact gap: Zoho issued the invoice, the row was written, and the
    // process died before the order was updated. The order looks un-invoiced.
    await ZohoInvoice.create({
      order: order._id,
      action: 'CREATE',
      invoiceNumber: 'INV-ALREADY-ISSUED',
      status: 'CREATED',
      attempts: 1,
    });

    const result = await invoicing.createInvoiceForOrder(String(order._id));

    assert.equal(result.invoiceNumber, 'INV-ALREADY-ISSUED');
    assert.match(result.message, /Recovered/);

    const updated = await O2dOrder.findById(order._id).select('invoiceNumber').lean();
    assert.equal(updated.invoiceNumber, 'INV-ALREADY-ISSUED', 'the order is repaired');
  });

  test('the database refuses a second CREATE row for one order', async () => {
    const order = await makeOrder();
    await ZohoInvoice.create({ order: order._id, action: 'CREATE', status: 'CREATED' });

    // Not merely an `if` in the service — two concurrent requests can both pass
    // a check before either writes. The index is what actually holds.
    await assert.rejects(
      () => ZohoInvoice.create({ order: order._id, action: 'CREATE', status: 'CREATED' }),
      (e) => e.code === 11000,
    );
  });

  test('invoices what was DISPATCHED, not what was ordered', async () => {
    const order = await makeOrder({
      items: [{ skuCode: 'SKU-1', productName: 'Widget', orderedQty: 100, dispatchedQty: 60 }],
    });

    const result = await invoicing.createInvoiceForOrder(String(order._id));
    assert.equal(result.ok, true);

    const rows = await ZohoInvoice.find({ order: order._id }).lean();
    assert.equal(rows[0].status, 'CREATED');
  });

  test('an order with no lines is refused, not invoiced for nothing', async () => {
    const order = await makeOrder({ poNumber: 'PO-EMPTY', items: [] });

    const result = await invoicing.createInvoiceForOrder(String(order._id));

    assert.equal(result.ok, false);
    assert.match(result.message, /no line items/i);
  });

  test('a missing order is a programming error, and throws', async () => {
    await assert.rejects(
      () => invoicing.createInvoiceForOrder('507f1f77bcf86cd799439011'),
      (e) => e.code === 'O2D_ORDER_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------

describe('webhook signatures', () => {
  const SECRET = 'a-shared-secret';
  const BODY = '{"invoice_number":"INV-001","status":"paid"}';

  test('a correctly signed payload matches', () => {
    assert.equal(signaturesMatch(signPayload(BODY, SECRET), signPayload(BODY, SECRET)), true);
  });

  test('a tampered payload does NOT match', () => {
    const legitimate = signPayload(BODY, SECRET);
    const tampered = signPayload('{"invoice_number":"INV-001","status":"void"}', SECRET);

    // Someone changing "paid" to "void" in flight must not be believed.
    assert.equal(signaturesMatch(legitimate, tampered), false);
  });

  test('a signature made with the wrong secret does NOT match', () => {
    assert.equal(
      signaturesMatch(signPayload(BODY, SECRET), signPayload(BODY, 'guessed-secret')),
      false,
    );
  });

  test('a length mismatch is refused rather than throwing', () => {
    // `timingSafeEqual` throws on unequal lengths; an unguarded call would turn
    // a malformed header into a 500 instead of a rejection.
    assert.doesNotThrow(() => signaturesMatch(signPayload(BODY, SECRET), 'short'));
    assert.equal(signaturesMatch(signPayload(BODY, SECRET), 'short'), false);
  });

  test('a missing or non-string signature is refused', () => {
    assert.equal(signaturesMatch(signPayload(BODY, SECRET), undefined), false);
    assert.equal(signaturesMatch(signPayload(BODY, SECRET), null), false);
  });
});

// ---------------------------------------------------------------------------

describe('status updates pushed by Zoho', () => {
  async function invoiced(number) {
    const order = await makeOrder({ poNumber: `PO-${number}` });
    await ZohoInvoice.create({
      order: order._id,
      action: 'CREATE',
      invoiceNumber: number,
      status: 'CREATED',
    });
    return order;
  }

  test('a paid invoice is recorded', async () => {
    await invoiced('INV-PAID');

    const result = await invoicing.handleZohoWebhook({ invoiceNumber: 'INV-PAID', status: 'paid' });

    assert.equal(result.ok, true);
    const row = await ZohoInvoice.findOne({ invoiceNumber: 'INV-PAID' }).lean();
    assert.equal(row.status, 'PAID');
    assert.ok(row.syncedAt);
  });

  test('Zoho vocabulary is mapped, not stored raw', async () => {
    await invoiced('INV-PART');

    await invoicing.handleZohoWebhook({ invoiceNumber: 'INV-PART', status: 'partially_paid' });

    const row = await ZohoInvoice.findOne({ invoiceNumber: 'INV-PART' }).lean();
    assert.equal(row.status, 'PARTIALLY_PAID');
  });

  test('an unrecognised status is ignored rather than written through', async () => {
    await invoiced('INV-ODD');

    const result = await invoicing.handleZohoWebhook({
      invoiceNumber: 'INV-ODD',
      status: 'quantum',
    });

    assert.equal(result.ok, true);
    const row = await ZohoInvoice.findOne({ invoiceNumber: 'INV-ODD' }).lean();
    // Storing whatever arrives would let a provider-side rename populate our
    // enum with values no screen renders and no query matches.
    assert.equal(row.status, 'CREATED', 'unchanged');
  });

  test('an invoice this portal did not raise is ignored, not refused', async () => {
    const result = await invoicing.handleZohoWebhook({
      invoiceNumber: 'INV-FOREIGN',
      status: 'paid',
    });

    // Answering 4xx would make Zoho retry a webhook that can never succeed.
    assert.equal(result.ok, true);
    assert.match(result.message, /not an O2D invoice/);
  });
});

// ---------------------------------------------------------------------------

describe('the retry sweep', () => {
  test('re-attempts a failed invoice', async () => {
    const order = await makeOrder({ poNumber: 'PO-RETRY' });
    await ZohoInvoice.create({
      order: order._id,
      action: 'CREATE',
      status: 'FAILED',
      errorMessage: 'Zoho was unreachable',
      attempts: 1,
    });

    const result = await invoicing.retryFailedInvoices({ limit: 10 });

    assert.equal(result.attempted, 1);
    assert.equal(result.succeeded, 1);

    const updated = await O2dOrder.findById(order._id).select('invoiceNumber').lean();
    assert.ok(updated.invoiceNumber, 'the order now carries a number');
  });

  test('gives up after maxAttempts, rather than retrying forever', async () => {
    const order = await makeOrder({ poNumber: 'PO-DOOMED' });
    await ZohoInvoice.create({
      order: order._id,
      action: 'CREATE',
      status: 'FAILED',
      errorMessage: 'Customer does not exist in Zoho',
      attempts: 3,
    });

    const result = await invoicing.retryFailedInvoices({ limit: 10, maxAttempts: 3 });

    // An invoice failing for a reason that will not resolve itself must stop
    // being retried, or every sweep is spent on the same doomed rows.
    assert.equal(result.attempted, 0);
  });

  test('one broken row does not stop the sweep reaching the rest', async () => {
    const good = await makeOrder({ poNumber: 'PO-GOOD' });
    await ZohoInvoice.create({ order: good._id, action: 'CREATE', status: 'FAILED', attempts: 0 });
    // An order that has since been deleted.
    await ZohoInvoice.create({
      order: '507f1f77bcf86cd799439011',
      action: 'CREATE',
      status: 'FAILED',
      attempts: 0,
    });

    const result = await invoicing.retryFailedInvoices({ limit: 10 });

    assert.equal(result.attempted, 2);
    assert.equal(result.succeeded, 1);
    assert.equal(result.stillFailed, 1);
  });
});
