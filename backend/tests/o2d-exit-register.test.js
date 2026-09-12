/**
 * Cancel, void, revive, and the register.
 *
 * The rules here are all about NOT LOSING THINGS: a cancelled order keeps its
 * reason, a revived one keeps the fact that it left, and neither deletes a row.
 * The tests are written so that a future "tidy up" that deletes exit rows fails
 * loudly rather than passing quietly.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dExitRegister } from '../models/o2d/O2dExitRegister.js';
import AuditLog from '../models/AuditLog.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import * as orders from '../modules/o2d/order.service.js';
import * as exits from '../modules/o2d/exit.service.js';
import { holdOrder } from '../modules/o2d/stage.engine.js';
import { STAGES, STAGE_STATUS, ORDER_STATUS } from '../shared/constants/o2d.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
const NOW = ist('2026-09-14', '10:30');
const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster, O2dExitRegister);
});
after(async () => { await stopTestMongo(); });

beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

const create = (over = {}) =>
  orders.createOrder({
    poNumber: 'PO-4471',
    poDate: ist('2026-09-14', '09:00').toISOString(),
    customerName: 'ABC Industries',
    promiseDate: ist('2026-09-25', '10:00').toISOString(),
    items: [],
    ...over,
  }, actor('Sales'), { now: NOW }).then((r) => r.order);

const mgmt = actor('Management');

// ---------------------------------------------------------------------------

describe('cancelling an order', () => {
  test('records the reason, the stage it died at, and who did it', async () => {
    const order = await create();
    const { entry } = await exits.cancelOrder(
      order._id, { reason: 'Customer withdrew the order' }, mgmt, { now: NOW },
    );

    assert.equal(entry.exitType, ORDER_STATUS.CANCELLED);
    assert.equal(entry.poNumber, 'PO-4471');
    // The analytically valuable field: it cannot be recovered later, because
    // the order stops moving the moment it exits.
    assert.equal(entry.stageAtExit, STAGES.SUBMIT_PO_TO_BILLING);
    assert.equal(entry.stageNameAtExit, 'Submit PO to Billing');
    assert.match(entry.reason, /Customer withdrew/);
    assert.equal(entry.exitedByName, 'A Management');
  });

  test('refuses without a reason — it is the only record of why', async () => {
    const order = await create();
    await assert.rejects(
      () => exits.cancelOrder(order._id, { reason: '  ' }, mgmt),
      (e) => e.code === 'O2D_EXIT_REASON_REQUIRED',
    );
    // And nothing was half-applied.
    assert.equal((await O2dOrder.findById(order._id)).status, ORDER_STATUS.OPEN);
  });

  test('parks the open stages so they leave My Tasks and stop accruing', async () => {
    const order = await create();
    await exits.cancelOrder(order._id, { reason: 'Customer withdrew' }, mgmt);

    const stages = await O2dOrderStage.find({ order: order._id }).sort({ stageNumber: 1 });
    // Stage 1 was completed before the cancellation and stays completed — an
    // exit does not rewrite work that actually happened.
    assert.equal(stages[0].status, STAGE_STATUS.DONE_ON_TIME);
    assert.ok(stages.slice(1).every((s) => s.status === STAGE_STATUS.ON_HOLD));
  });

  test('cannot be cancelled twice', async () => {
    const order = await create();
    await exits.cancelOrder(order._id, { reason: 'First' }, mgmt);
    await assert.rejects(
      () => exits.cancelOrder(order._id, { reason: 'Second' }, mgmt),
      (e) => e.code === 'O2D_ALREADY_EXITED',
    );
  });

  test('a cancelled order cannot be worked', async () => {
    const order = await create();
    await exits.cancelOrder(order._id, { reason: 'Customer withdrew' }, mgmt);
    await assert.rejects(
      () => orders.updateOrder(order._id, { stockStatus: 'in stock' }, mgmt),
      (e) => e.code === 'O2D_ORDER_EXITED',
    );
  });

  // ── after dispatch ──────────────────────────────────────────────────────

  test('cancelling AFTER dispatch demands an approver', async () => {
    const order = await create();
    await O2dOrder.updateOne({ _id: order._id }, { $set: { dispatchedAt: NOW } });

    await assert.rejects(
      () => exits.cancelOrder(order._id, { reason: 'Customer refused delivery' }, mgmt),
      (e) => e.code === 'O2D_EXIT_APPROVAL_REQUIRED',
    );
  });

  test('and goes through once one is named', async () => {
    const order = await create();
    await O2dOrder.updateOne({ _id: order._id }, { $set: { dispatchedAt: NOW } });

    const approver = '64b7f1c2e4b0a1a2b3c4d5e6';
    const { entry } = await exits.cancelOrder(
      order._id, { reason: 'Customer refused delivery', approvedBy: approver }, mgmt,
    );
    assert.equal(String(entry.approvedBy), approver);

    const row = await AuditLog.findOne({ action: 'o2d.order.cancelled' }).lean();
    // Recorded because it changes what the cancellation means: there is an
    // invoice and a shipment to unwind.
    assert.equal(row.meta.afterDispatch, true);
  });

  test('a pre-dispatch cancellation needs no approver', async () => {
    const order = await create();
    const { entry } = await exits.cancelOrder(order._id, { reason: 'Keyed in error by Sales' }, mgmt);
    assert.equal(entry.approvedBy, null);
  });
});

// ---------------------------------------------------------------------------

describe('voiding an order', () => {
  test('is a different exit type from cancelling', async () => {
    const order = await create();
    const { order: after, entry } = await exits.voidOrder(
      order._id, { reason: 'Keyed twice — this is the duplicate' }, mgmt,
    );

    assert.equal(after.status, ORDER_STATUS.VOID);
    assert.equal(entry.exitType, ORDER_STATUS.VOID);

    // Filed under its own action, so analytics can drop entry errors without
    // also hiding real lost orders.
    assert.ok(await AuditLog.findOne({ action: 'o2d.order.voided' }));
    assert.equal(await AuditLog.findOne({ action: 'o2d.order.cancelled' }), null);
  });

  test('frees the PO number for re-entry, same as a cancellation', async () => {
    const order = await create();
    await exits.voidOrder(order._id, { reason: 'Wrong customer' }, mgmt);

    const replacement = await create();
    assert.notEqual(String(replacement._id), String(order._id));
  });
});

// ---------------------------------------------------------------------------

describe('reviving an order', () => {
  test('reopens it at the stage it left, keeping the exit row', async () => {
    const order = await create();
    await exits.cancelOrder(order._id, { reason: 'Customer withdrew' }, mgmt, { now: NOW });

    const { order: revived } = await exits.reviveOrder(
      order._id, { reason: 'Customer changed their mind' }, mgmt, { now: NOW },
    );

    assert.equal(revived.status, ORDER_STATUS.OPEN);
    assert.equal(revived.currentStage, STAGES.SUBMIT_PO_TO_BILLING);

    const stage = await O2dOrderStage.findOne({
      order: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    });
    assert.equal(stage.status, STAGE_STATUS.PENDING, 'the open stage is workable again');

    // The row SURVIVES — that an order once left is the fact an auditor wants.
    const entry = await O2dExitRegister.findOne({ order: order._id }).lean();
    assert.ok(entry);
    assert.ok(entry.revivedAt);
    assert.match(entry.revivalReason, /changed their mind/);
  });

  test('does not recompute deadlines, so a late order stays late', async () => {
    const order = await create();
    const before = await O2dOrderStage.findOne({
      order: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    }).lean();

    await exits.cancelOrder(order._id, { reason: 'Paused' }, mgmt);
    await exits.reviveOrder(order._id, { reason: 'Resumed' }, mgmt);

    const after = await O2dOrderStage.findOne({
      order: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    }).lean();

    assert.deepEqual(after.plannedCompletion, before.plannedCompletion,
      'reviving must not quietly turn a missed deadline into a met one');
  });

  test('refuses when a replacement order has taken the PO number', async () => {
    const order = await create();
    await exits.cancelOrder(order._id, { reason: 'Customer withdrew' }, mgmt);
    await create(); // the replacement

    await assert.rejects(
      () => exits.reviveOrder(order._id, { reason: 'Actually it was real' }, mgmt),
      (e) => e.code === 'O2D_REVIVE_WOULD_DUPLICATE' && e.statusCode === 409,
    );
  });

  test('refuses on an order that never left', async () => {
    const order = await create();
    await assert.rejects(
      () => exits.reviveOrder(order._id, { reason: 'x' }, mgmt),
      (e) => e.code === 'O2D_NOT_EXITED',
    );
  });

  test('a second exit does not overwrite the first', async () => {
    const order = await create();
    await exits.cancelOrder(order._id, { reason: 'First cancellation' }, mgmt);
    await exits.reviveOrder(order._id, { reason: 'Back on' }, mgmt);
    await exits.cancelOrder(order._id, { reason: 'Second cancellation' }, mgmt);

    const rows = await O2dExitRegister.find({ order: order._id }).sort({ exitedAt: 1 }).lean();
    assert.equal(rows.length, 2, 'two departures, two rows');
    assert.match(rows[0].reason, /First/);
    assert.ok(rows[0].revivedAt);
    assert.match(rows[1].reason, /Second/);
    assert.equal(rows[1].revivedAt, null);
  });
});

// ---------------------------------------------------------------------------

describe('the register', () => {
  test('shows departures AND held orders, because it lists everything not moving', async () => {
    const cancelled = await create();
    await exits.cancelOrder(cancelled._id, { reason: 'Customer withdrew' }, mgmt);

    const heldOrder = await create({ poNumber: 'PO-9000', customerName: 'XYZ Traders' });
    await holdOrder({
      orderId: heldOrder._id, actor: mgmt, reason: 'STOCK_UNAVAILABLE',
      note: 'Awaiting import', now: NOW,
    });

    const { data, total } = await exits.listExitRegister({});
    assert.equal(total, 2);

    const hold = data.find((r) => r.kind === 'HOLD');
    assert.ok(hold, 'a held order appears in the register');
    assert.equal(hold.poNumber, 'PO-9000');
    assert.equal(hold.reason, 'STOCK_UNAVAILABLE');
    assert.equal(hold.exitType, ORDER_STATUS.ON_HOLD);

    // The held row is DERIVED from the order, not stored — so no exit row was
    // written for it, and there is only one record of that hold.
    assert.equal(await O2dExitRegister.countDocuments({ exitType: 'ON_HOLD' }), 0);
  });

  test('filters by exit type', async () => {
    const a = await create();
    await exits.cancelOrder(a._id, { reason: 'Withdrawn' }, mgmt);
    const b = await create({ poNumber: 'PO-9000', customerName: 'XYZ Traders' });
    await exits.voidOrder(b._id, { reason: 'Duplicate entry' }, mgmt);

    assert.equal((await exits.listExitRegister({ exitType: 'CANCELLED' })).total, 1);
    assert.equal((await exits.listExitRegister({ exitType: 'VOID' })).total, 1);
    assert.equal((await exits.listExitRegister({ exitType: 'ON_HOLD' })).total, 0);
  });

  test('hides revived exits by default — they are no longer exceptions', async () => {
    const order = await create();
    await exits.cancelOrder(order._id, { reason: 'Withdrawn' }, mgmt);
    await exits.reviveOrder(order._id, { reason: 'Back on' }, mgmt);

    assert.equal((await exits.listExitRegister({})).total, 0);
    assert.equal((await exits.listExitRegister({ includeRevived: true })).total, 1);
  });

  test('counts where orders die, excluding the ones that came back', async () => {
    const a = await create();
    await exits.cancelOrder(a._id, { reason: 'Withdrawn' }, mgmt);

    const b = await create({ poNumber: 'PO-9000', customerName: 'XYZ Traders' });
    await exits.cancelOrder(b._id, { reason: 'Withdrawn' }, mgmt);
    await exits.reviveOrder(b._id, { reason: 'Back on' }, mgmt);

    const byStage = await exits.exitsByStage();
    assert.equal(byStage.length, 1);
    assert.equal(byStage[0].stageAtExit, STAGES.SUBMIT_PO_TO_BILLING);
    assert.equal(byStage[0].exitType, ORDER_STATUS.CANCELLED);
    // One, not two: an order that was revived did not die there.
    assert.equal(byStage[0].count, 1);
  });
});
