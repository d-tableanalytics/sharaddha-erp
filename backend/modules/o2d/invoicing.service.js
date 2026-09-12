/**
 * Invoice creation and sync with Zoho Books (§43-45).
 *
 * ---------------------------------------------------------------------------
 * 🔴 THE IDEMPOTENCY KEY MUST BE DERIVED, NEVER GENERATED
 * ---------------------------------------------------------------------------
 *
 * This is the single most important line in the file:
 *
 *     const idempotencyKey = `o2d-invoice-${orderId}`;
 *
 * A freshly generated UUID per call would be WORSE THAN USELESS. The whole
 * point of an idempotency key is that a retry carries the SAME key, so the
 * provider recognises it and returns the original result instead of acting
 * twice. A new UUID on every attempt means every retry looks like a brand-new
 * request, and Zoho — correctly, obediently — creates a SECOND INVOICE.
 *
 * That is a real invoice, with a real number, sent to a real customer, against
 * a single order. Deriving the key from the order ID makes it stable across
 * retries, process restarts and redeploys, which is exactly when retries happen.
 *
 * ---------------------------------------------------------------------------
 * FOUR LAYERS OF DUPLICATE PROTECTION
 * ---------------------------------------------------------------------------
 *
 * Because a duplicate here costs money, one guard is not enough:
 *
 *   1. The order's own `invoiceNumber` — already invoiced, return immediately.
 *   2. A unique index on (order, action) in `zoho_invoices`.
 *   3. The derived idempotency key, so Zoho itself refuses the second call.
 *   4. A CREATED row for the order short-circuits before any network call.
 *
 * ---------------------------------------------------------------------------
 * ZOHO FAILING MUST NEVER BLOCK AN ORDER
 * ---------------------------------------------------------------------------
 *
 * Every failure is recorded and returned, never thrown past the caller. The
 * warehouse has already dispatched the goods; a billing integration being down
 * is not a reason the portal should refuse to record that fact.
 */

import crypto from 'node:crypto';

import { O2dOrder } from '../../models/o2d/O2dOrder.js';
import { O2dOrderItem } from '../../models/o2d/O2dOrderItem.js';
import { ZohoInvoice } from '../../models/o2d/ZohoInvoice.js';
import User from '../../models/User.js';
import { O2dWorkflowError } from './stage.engine.js';
import { createInvoice } from './channels/zoho.channel.js';

/**
 * The stable key for an order's invoice.
 *
 * Derived, not random — see the header. Exported so a test can assert that two
 * calls for the same order produce the same key, which is the property that
 * actually prevents the duplicate.
 */
export const idempotencyKeyFor = (orderId) => `o2d-invoice-${orderId}`;

/**
 * Create an invoice for an order.
 *
 * Never throws for a Zoho failure — returns `{ ok: false, message }` so the
 * caller can record it and carry on. Throws only when the ORDER is wrong
 * (missing), which is a programming error rather than an integration one.
 */
export async function createInvoiceForOrder(orderId) {
  const order = await O2dOrder.findById(orderId)
    .select('poNumber invoiceNumber customer customerName status')
    .lean();

  if (!order) {
    throw new O2dWorkflowError(`Order ${orderId} not found.`, {
      status: 404,
      code: 'O2D_ORDER_NOT_FOUND',
    });
  }

  // Guard 1: the order already carries a number.
  if (order.invoiceNumber) {
    return { ok: true, invoiceNumber: order.invoiceNumber, message: 'Already invoiced' };
  }

  // Guard 2: a successful row exists even though the order was not updated —
  // possible if the process died between the Zoho call and the order write.
  // Recovering here is what stops that crash from becoming a second invoice.
  const existing = await ZohoInvoice.findOne({
    order: orderId,
    action: 'CREATE',
    status: { $ne: 'FAILED' },
  })
    .select('invoiceNumber')
    .lean();

  if (existing?.invoiceNumber) {
    await O2dOrder.findByIdAndUpdate(orderId, { invoiceNumber: existing.invoiceNumber });
    return {
      ok: true,
      invoiceNumber: existing.invoiceNumber,
      message: 'Recovered an invoice that was created but not recorded on the order',
    };
  }

  const items = await O2dOrderItem.find({ order: orderId })
    .select('skuCode productName orderedQty dispatchedQty invoicedQty')
    .lean();

  if (items.length === 0) {
    return { ok: false, message: 'Order has no line items' };
  }

  /**
   * Invoice what LEFT, not what was asked for.
   *
   * A part-dispatched order invoiced at ordered quantity overcharges the
   * customer for goods still sitting in the warehouse. `dispatchedQty` falls
   * back to `orderedQty` only when nothing has shipped yet, which for a
   * stage-8 invoice is the normal case.
   */
  const zohoItems = items.map((item) => ({
    description: item.productName || item.skuCode,
    sku: item.skuCode,
    qty: item.dispatchedQty > 0 ? item.dispatchedQty : item.orderedQty,
  }));

  // The customer's email lives on the linked User, not on the order — the
  // order denormalises only the NAME, because a renamed customer must not
  // silently repoint historical orders.
  const customerEmail = order.customer
    ? (await User.findById(order.customer).select('email').lean())?.email ?? null
    : null;

  const idempotencyKey = idempotencyKeyFor(orderId);

  const { ok, invoiceNumber, detail } = await createInvoice({
    orderId: String(orderId),
    customerEmail,
    customerName: order.customerName,
    poNumber: order.poNumber,
    items: zohoItems,
    idempotencyKey,
  });

  // Record the attempt either way. Wrapped, because a bookkeeping failure must
  // not lose an invoice number Zoho has already issued.
  try {
    await ZohoInvoice.findOneAndUpdate(
      { order: orderId, action: 'CREATE' },
      {
        order: orderId,
        action: 'CREATE',
        invoiceNumber: invoiceNumber ?? null,
        status: ok ? 'CREATED' : 'FAILED',
        idempotencyKey,
        errorMessage: ok ? null : detail,
        $inc: { attempts: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    console.error('[O2D/Invoicing] Could not record the Zoho attempt:', err.message);
  }

  if (ok && invoiceNumber) {
    await O2dOrder.findByIdAndUpdate(orderId, { invoiceNumber });
  }

  return { ok, invoiceNumber, message: detail };
}

/**
 * A status update pushed by Zoho.
 *
 * Unknown invoices are ignored rather than refused: the Zoho org may bill for
 * things this portal knows nothing about, and answering 4xx would make Zoho
 * retry a webhook that will never succeed.
 */
export async function handleZohoWebhook({ invoiceNumber, status }) {
  const record = await ZohoInvoice.findOne({ invoiceNumber }).select('order').lean();
  if (!record) {
    return { ok: true, message: `Invoice ${invoiceNumber} is not an O2D invoice; ignored.` };
  }

  const mapped = ZOHO_STATUS_MAP[String(status).toLowerCase()];
  if (!mapped) {
    return { ok: true, message: `Status "${status}" is not one this portal tracks; ignored.` };
  }

  await ZohoInvoice.updateOne(
    { invoiceNumber },
    { status: mapped, syncedAt: new Date() },
  );

  return {
    ok: true,
    orderId: String(record.order),
    message: `Invoice ${invoiceNumber} is ${mapped}`,
  };
}

/**
 * Zoho's vocabulary, mapped onto ours.
 *
 * An unrecognised status is ignored rather than written through: storing
 * whatever arrives would let a provider-side rename silently populate our
 * enum with values no screen renders and no query matches.
 */
const ZOHO_STATUS_MAP = Object.freeze({
  paid: 'PAID',
  partially_paid: 'PARTIALLY_PAID',
  sent: 'CREATED',
  draft: 'CREATED',
  void: 'CANCELLED',
  voided: 'CANCELLED',
});

/**
 * Re-attempt invoices that failed.
 *
 * Capped by `maxAttempts`: an invoice failing for a reason that will not
 * resolve itself — a customer Zoho does not have, a malformed line — must stop
 * being retried, or the sweep spends every run on the same doomed rows.
 */
export async function retryFailedInvoices({ limit = 50, maxAttempts = 3 } = {}) {
  const failed = await ZohoInvoice.find({
    status: 'FAILED',
    attempts: { $lt: maxAttempts },
  })
    .select('order')
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  const results = { attempted: 0, succeeded: 0, stillFailed: 0 };

  for (const record of failed) {
    results.attempted += 1;
    try {
      const { ok } = await createInvoiceForOrder(String(record.order));
      if (ok) results.succeeded += 1;
      else results.stillFailed += 1;
    } catch {
      // A deleted order, most likely. Counted, not thrown: one bad row must not
      // stop the sweep from reaching the rest.
      results.stillFailed += 1;
    }
  }

  return results;
}

export default {
  createInvoiceForOrder,
  handleZohoWebhook,
  retryFailedInvoices,
  idempotencyKeyFor,
};
