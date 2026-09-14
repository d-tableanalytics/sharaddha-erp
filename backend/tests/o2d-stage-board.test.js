/**
 * The stage board — live orders per stage, and how many are late (§27).
 *
 * The properties worth pinning down are the ones a counting screen gets wrong
 * quietly: a stage with nothing in it must still appear, finished orders must
 * not be counted as work in progress, and the board's idea of "overdue" must be
 * the SAME idea My Tasks and the tracker use. A board that disagrees with the
 * screens beside it is worse than no board, because nobody can tell which is
 * lying.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dOrderItem } from '../models/o2d/O2dOrderItem.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import * as orders from '../modules/o2d/order.service.js';
import { completeStage } from '../modules/o2d/stage.engine.js';
import { closeStage } from './helpers/o2dStage.js';
import { STAGES, ORDER_STATUS } from '../shared/constants/o2d.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

const NOW = ist('2026-09-14', '10:30');

const INTAKE = {
  poDate: ist('2026-09-14', '09:00').toISOString(),
  promiseDate: ist('2026-09-25', '10:00').toISOString(),
};

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster, O2dOrderItem);
});
after(async () => { await stopTestMongo(); });

beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

const create = (poNumber, customerName = 'ABC Industries') =>
  orders.createOrder(
    { ...INTAKE, poNumber, customerName, items: [] },
    actor('Sales'),
    { now: NOW },
  );

/** The board keyed by stage number, so assertions read by name not by index. */
const boardBy = async (viewer = null, at = NOW) =>
  new Map(
    (await orders.stageBoard(viewer, { now: at })).map((s) => [s.stageNumber, s]),
  );

// ---------------------------------------------------------------------------

describe('the stage board', () => {
  test('returns all twelve stages, including the empty ones', async () => {
    await create('PO-1');

    const board = await orders.stageBoard(null, { now: NOW });

    assert.equal(board.length, 12, 'an empty stage is still a stage');
    assert.deepEqual(
      board.map((s) => s.stageNumber),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      'and they come back in pipeline order',
    );
  });

  test('carries the stage master name and owner, not just a number', async () => {
    const board = await boardBy();

    // The rail renders these; a board of bare numbers would need the frontend
    // to keep its own copy of the stage names.
    assert.equal(board.get(STAGES.PACK_AND_DISPATCH).name, 'Pack & Dispatch');
    assert.ok(board.get(STAGES.PACK_AND_DISPATCH).ownerRole);
  });

  test('counts a new order at the stage it is actually waiting at', async () => {
    await create('PO-1');

    const board = await boardBy();

    // Creating the order COMPLETES stage 1, so the order waits at stage 2.
    assert.equal(board.get(STAGES.RECEIVE_ORDER).total, 0);
    assert.equal(board.get(STAGES.SUBMIT_PO_TO_BILLING).total, 1);
  });

  test('an order moves off its old stage when the stage is completed', async () => {
    const { order } = await create('PO-1');

    await closeStage({
      orderId: order._id,
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Sales'),
      now: NOW,
    });

    const board = await boardBy();
    assert.equal(board.get(STAGES.SUBMIT_PO_TO_BILLING).total, 0);
    assert.equal(board.get(STAGES.SEND_SOR_PI).total, 1);
  });

  test('several orders at one stage are counted together', async () => {
    await create('PO-1');
    await create('PO-2');
    await create('PO-3', 'XYZ Traders');

    const board = await boardBy();
    assert.equal(board.get(STAGES.SUBMIT_PO_TO_BILLING).total, 3);
  });
});

// ---------------------------------------------------------------------------
// What counts as work in progress
// ---------------------------------------------------------------------------

describe('what the board counts', () => {
  test('cancelled and void orders are not work in progress', async () => {
    const { order: a } = await create('PO-1');
    const { order: b } = await create('PO-2');
    await create('PO-3');

    await O2dOrder.updateOne({ _id: a._id }, { $set: { status: ORDER_STATUS.CANCELLED } });
    await O2dOrder.updateOne({ _id: b._id }, { $set: { status: ORDER_STATUS.VOID } });

    const board = await boardBy();
    assert.equal(board.get(STAGES.SUBMIT_PO_TO_BILLING).total, 1, 'only the live one remains');
  });

  test('a closed order is finished, not pending', async () => {
    const { order } = await create('PO-1');
    await O2dOrder.updateOne({ _id: order._id }, { $set: { status: ORDER_STATUS.CLOSED } });

    const board = await boardBy();
    assert.equal(board.get(STAGES.SUBMIT_PO_TO_BILLING).total, 0);
  });

  test('an order on hold is still counted, and reported separately', async () => {
    const { order } = await create('PO-1');
    await O2dOrder.updateOne({ _id: order._id }, { $set: { status: ORDER_STATUS.ON_HOLD } });

    const board = await boardBy();
    const row = board.get(STAGES.SUBMIT_PO_TO_BILLING);

    // Held work has not gone away — it is stuck, which is the thing the board
    // exists to make visible. Counting it as done would hide it entirely.
    assert.equal(row.total, 1);
    assert.equal(row.onHold, 1);
  });
});

// ---------------------------------------------------------------------------
// Lateness, and agreeing with the rest of the module
// ---------------------------------------------------------------------------

describe('overdue counting', () => {
  test('a stage past its deadline is counted overdue', async () => {
    const { order } = await create('PO-1');

    const stage = await O2dOrderStage.findOne({
      order: order._id,
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    });

    // Well past whatever the seeded SLA is, so the test does not depend on it.
    const later = new Date(new Date(stage.plannedCompletion).getTime() + 60 * 60 * 1000);

    const board = await boardBy(null, later);
    assert.equal(board.get(STAGES.SUBMIT_PO_TO_BILLING).overdue, 1);
  });

  test('nothing is overdue before its deadline', async () => {
    await create('PO-1');

    const board = await boardBy();
    assert.equal(board.get(STAGES.SUBMIT_PO_TO_BILLING).overdue, 0);
  });

  test("the board's verdict matches bucketFor, stage for stage", async () => {
    /*
     * The invariant that matters most here. `bucketFor` is what My Tasks and
     * the tracker use; the board must not develop a second opinion about which
     * orders are late. Asserted by comparing the board against the very rows it
     * summarises, rather than against a hardcoded number.
     */
    await create('PO-1');
    await create('PO-2');
    const { order: third } = await create('PO-3', 'XYZ Traders');
    await closeStage({
      orderId: third._id,
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Sales'),
      now: NOW,
    });

    const at = ist('2026-09-16', '12:00');
    const board = await boardBy(null, at);

    const liveIds = (await O2dOrder.find({
      status: { $in: [ORDER_STATUS.OPEN, ORDER_STATUS.ON_HOLD] },
    }).select('_id').lean()).map((o) => o._id);

    const openStages = await O2dOrderStage.find({
      order: { $in: liveIds },
      status: { $in: ['PENDING', 'DUE_SOON', 'OVERDUE', 'ON_HOLD'] },
    }).lean();

    const expected = new Map();
    for (const stage of openStages) {
      const row = expected.get(stage.stageNumber) ?? { overdue: 0, dueSoon: 0 };
      const bucket = orders.bucketFor(stage, at);
      if (bucket === 'overdue') row.overdue += 1;
      else if (bucket === 'due_soon') row.dueSoon += 1;
      expected.set(stage.stageNumber, row);
    }

    for (const [stageNumber, want] of expected) {
      assert.equal(
        board.get(stageNumber).overdue, want.overdue,
        `stage ${stageNumber} overdue count must match bucketFor`,
      );
      assert.equal(
        board.get(stageNumber).dueSoon, want.dueSoon,
        `stage ${stageNumber} due-soon count must match bucketFor`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Role scope (§20)
// ---------------------------------------------------------------------------

describe('role scope', () => {
  test('the Import Team sees only stages from its floor upward', async () => {
    await create('PO-1');

    const scoped = await orders.stageBoard({ role: 'Import Team' }, { now: NOW });

    assert.ok(
      scoped.every((s) => s.total === 0),
      'an order at stage 2 is below the Imports floor and must not be counted',
    );

    // The rail itself is not truncated — the stages exist, they are just empty
    // for this viewer. Hiding them would make "no visibility" look like "no
    // such stage", and the service is the only place that decides either way.
    assert.equal(scoped.length, 12);
  });

  test('an unscoped role sees the same order the Import Team cannot', async () => {
    await create('PO-1');

    const full = await boardBy({ role: 'Billing' });
    assert.equal(full.get(STAGES.SUBMIT_PO_TO_BILLING).total, 1);
  });

  test('the Import Team sees an order once it reaches the floor stage', async () => {
    const { order } = await create('PO-1');

    // Walk it up to stage 6, where §20 says Imports gains visibility.
    for (const stageNumber of [
      STAGES.SUBMIT_PO_TO_BILLING,
      STAGES.SEND_SOR_PI,
    ]) {
      await closeStage({ orderId: order._id, stageNumber, actor: actor('Sales'), now: NOW });
    }
    await orders.decideAdvance(
      order._id,
      { advanceRequired: false },
      actor('Accounts'),
      { now: NOW },
    );

    const scoped = await boardBy({ role: 'Import Team' });
    assert.equal(
      scoped.get(STAGES.CREATE_ORDER_LIST).total, 1,
      'stage 6 is the Imports floor, so the order is now visible',
    );
  });
});
