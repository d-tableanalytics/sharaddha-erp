/**
 * "What has passed through this stage", as distinct from "what is sitting here".
 *
 * ---------------------------------------------------------------------------
 * THE MODEL THIS DEFENDS
 * ---------------------------------------------------------------------------
 *
 * An O2D order is ONE record with TWELVE stage rows, created at intake and
 * never deleted. Nothing is ever moved out of a stage — the stage row keeps its
 * own status, timestamps, actor and evidence for the life of the order.
 *
 * The stage BOARD did not reflect that. It grouped by `order.currentStage`, so
 * an order completed at stage 2 vanished from stage 2 entirely and the screen
 * behaved exactly like the "move it along and drop it" model the data layer had
 * deliberately avoided. `stageReached` closes that gap.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dOrderItem } from '../models/o2d/O2dOrderItem.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import * as orders from '../modules/o2d/order.service.js';
import { completeStage } from '../modules/o2d/stage.engine.js';
import { closeStage } from './helpers/o2dStage.js';
import { STAGES, STAGE_STATUS, ORDER_STATUS, displayStatusFor } from '../shared/constants/o2d.js';
import { listO2dOrdersQuery, exportQuery, myTasksQuery } from '../shared/schemas/o2d.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date();

const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

const intake = (po) => ({
  poNumber: po,
  poDate: new Date(NOW.getTime() - 2 * MINUTE).toISOString(),
  customerName: 'ABC Industries',
  promiseDate: new Date(NOW.getTime() + 11 * DAY).toISOString(),
  items: [],
});

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster, O2dOrderItem);
});
after(async () => { await stopTestMongo(); });
beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

const create = async (po = 'PO-PASS-1') =>
  (await orders.createOrder(intake(po), actor('Sales'), { now: NOW })).order;

const close = (order, stageNumber, role = 'Billing') =>
  closeStage({ orderId: order._id, stageNumber, actor: actor(role), now: NOW });

// ---------------------------------------------------------------------------

describe('every stage keeps its own record', () => {
  test('all twelve rows exist from the moment the order is created', async () => {
    const order = await create();
    const rows = await O2dOrderStage.find({ order: order._id }).sort({ stageNumber: 1 }).lean();

    // One order, twelve stages — not a cursor that a row is dragged along.
    assert.equal(rows.length, 12);
    assert.deepEqual(rows.map((r) => r.stageNumber), [1,2,3,4,5,6,7,8,9,10,11,12]);
  });

  test('completing a stage preserves its row, and unlocks the next', async () => {
    const order = await create();
    await close(order, STAGES.SUBMIT_PO_TO_BILLING);

    const rows = await O2dOrderStage.find({ order: order._id }).sort({ stageNumber: 1 }).lean();
    const [s1, s2, s3] = rows;

    // The example from the requirement, asserted literally.
    assert.equal(displayStatusFor(s1.status), 'DONE');
    assert.equal(displayStatusFor(s2.status), 'DONE');
    assert.equal(displayStatusFor(s3.status), 'IN_PROGRESS');
    assert.equal(displayStatusFor(rows[3].status), 'NOT_STARTED');
    assert.equal(rows.length, 12, 'nothing was removed');
  });

  test('a completed stage keeps who did it, when, and what they said', async () => {
    const order = await create();
    await closeStage({
      orderId: order._id,
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'),
      remarks: 'Handed over at the counter',
      now: NOW,
    });

    const s2 = await O2dOrderStage.findOne({
      order: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    }).lean();

    assert.ok(s2.actualStart, 'when it started');
    assert.ok(s2.actualCompletion, 'when it finished');
    assert.equal(s2.completedByName, 'A Billing');
    assert.equal(s2.completedByRole, 'Billing');
    assert.equal(s2.remarks, 'Handed over at the counter');
    // The deadline it was judged against, kept alongside the actual.
    assert.ok(s2.plannedCompletion);
  });

  test('the order tracks its current stage separately from the completed ones', async () => {
    const order = await create();
    await close(order, STAGES.SUBMIT_PO_TO_BILLING);

    const fresh = await O2dOrder.findById(order._id).lean();
    // The cursor moved; the history did not.
    assert.equal(fresh.currentStage, STAGES.SEND_SOR_PI);
    assert.equal(
      (await O2dOrderStage.countDocuments({
        order: order._id, status: { $in: [STAGE_STATUS.DONE_ON_TIME, STAGE_STATUS.DONE_LATE] },
      })),
      2,
    );
  });
});

// ---------------------------------------------------------------------------

describe('stageReached — what has passed through a stage', () => {
  test('an order stays listed against a stage it has finished', async () => {
    const order = await create();
    await close(order, STAGES.SUBMIT_PO_TO_BILLING);

    // Its cursor is on stage 3 now, but it certainly passed through stage 2.
    const { data } = await orders.listOrders({ stageReached: STAGES.SUBMIT_PO_TO_BILLING });

    assert.equal(data.length, 1);
    assert.equal(String(data[0]._id), String(order._id));
    assert.equal(displayStatusFor(data[0].stageStatus.status), 'DONE');
  });

  test('and carries WHO closed it and WHEN, for the row to show', async () => {
    const order = await create();
    await close(order, STAGES.SUBMIT_PO_TO_BILLING);

    const { data } = await orders.listOrders({ stageReached: STAGES.SUBMIT_PO_TO_BILLING });
    assert.equal(data[0].stageStatus.completedByName, 'A Billing');
    assert.ok(data[0].stageStatus.actualCompletion);
  });

  test('currentStage still answers the narrower question', async () => {
    const order = await create();
    await close(order, STAGES.SUBMIT_PO_TO_BILLING);

    // Sitting here NOW: nothing at stage 2. That reading is still available —
    // the new parameter adds a question rather than replacing one.
    assert.equal((await orders.listOrders({ currentStage: STAGES.SUBMIT_PO_TO_BILLING })).data.length, 0);
    assert.equal((await orders.listOrders({ currentStage: STAGES.SEND_SOR_PI })).data.length, 1);
  });

  test('a stage the order has not reached lists nothing', async () => {
    await create();
    // Stage 7 exists as a row but is LOCKED — the row existing is not arrival,
    // or every order ever would be listed under every stage.
    const { data } = await orders.listOrders({ stageReached: STAGES.WAREHOUSE_PICKING });
    assert.equal(data.length, 0);
  });

  test('an order currently IN a stage is listed there too', async () => {
    const order = await create();
    const { data } = await orders.listOrders({ stageReached: STAGES.SUBMIT_PO_TO_BILLING });

    assert.equal(data.length, 1);
    assert.equal(String(data[0]._id), String(order._id));
    assert.equal(displayStatusFor(data[0].stageStatus.status), 'IN_PROGRESS');
  });

  test('separates two orders by where each has got to', async () => {
    const ahead = await create('PO-AHEAD');
    const behind = await create('PO-BEHIND');
    await close(ahead, STAGES.SUBMIT_PO_TO_BILLING);
    await close(ahead, STAGES.SEND_SOR_PI);

    const atTwo = await orders.listOrders({ stageReached: STAGES.SUBMIT_PO_TO_BILLING });
    const atThree = await orders.listOrders({ stageReached: STAGES.SEND_SOR_PI });

    // Both passed stage 2; only one has reached stage 3.
    assert.equal(atTwo.data.length, 2);
    assert.equal(atThree.data.length, 1);
    assert.equal(atThree.data[0].poNumber, 'PO-AHEAD');
    assert.equal(String(behind._id) !== String(atThree.data[0]._id), true);
  });

  test('a plain tracker row is unchanged — no stray stageStatus', async () => {
    await create();
    const { data } = await orders.listOrders({});
    // The field rides along only when a stage was asked about; otherwise a
    // reader would have to guess which stage a bare status referred to.
    assert.equal(data[0].stageStatus, undefined);
  });
});

// ---------------------------------------------------------------------------

describe('the order history view', () => {
  test('the default tracker hides finished orders, as it always has', async () => {
    const order = await create();
    await O2dOrder.updateOne({ _id: order._id }, { $set: { status: ORDER_STATUS.CLOSED } });

    // Unchanged behaviour, pinned so the history view below is visibly a
    // DIFFERENT question rather than an accidental widening of this one.
    assert.equal((await orders.listOrders({})).data.length, 0);
  });

  test('asking for every status returns the complete record', async () => {
    const live = await create('PO-LIVE');
    const done = await create('PO-DONE');
    await O2dOrder.updateOne({ _id: done._id }, { $set: { status: ORDER_STATUS.CLOSED } });

    const { data } = await orders.listOrders({
      status: [ORDER_STATUS.OPEN, ORDER_STATUS.ON_HOLD, ORDER_STATUS.CLOSED,
        ORDER_STATUS.CANCELLED, ORDER_STATUS.VOID],
    });

    assert.equal(data.length, 2);
    const pos = data.map((o) => o.poNumber).sort();
    assert.deepEqual(pos, ['PO-DONE', 'PO-LIVE']);
    assert.ok(String(live._id));
  });

  test('a closed order keeps all twelve stage rows', async () => {
    const order = await create();
    await O2dOrder.updateOne({ _id: order._id }, { $set: { status: ORDER_STATUS.CLOSED } });

    // The requirement in one assertion: finishing an order must not move its
    // data out of the workflow.
    assert.equal(await O2dOrderStage.countDocuments({ order: order._id }), 12);
  });
});

// ---------------------------------------------------------------------------

describe('list parameters accept how clients actually send them', () => {
  /**
   * A live 400 came from here.
   *
   * The Stages board sends `status` as an ARRAY, which axios serialises as
   * `?status[]=OPEN&status[]=ON_HOLD` and Express hands over as a real array.
   * The schema accepted only a comma-separated STRING, so the request was
   * refused with "expected values from: OPEN, ON_HOLD, ..." — a message about
   * the VALUES, which were fine, pointing the reader away from the shape, which
   * was not.
   */
  test('a status array is accepted, as axios sends it', () => {
    const parsed = listO2dOrdersQuery.parse({
      page: '1', pageSize: '25', stageReached: '2',
      status: ['OPEN', 'ON_HOLD', 'CLOSED', 'CANCELLED', 'VOID'],
    });
    assert.deepEqual(parsed.status, ['OPEN', 'ON_HOLD', 'CLOSED', 'CANCELLED', 'VOID']);
    assert.equal(parsed.stageReached, 2);
  });

  test('a comma-separated string is still accepted', () => {
    // The hand-built form the tracker has always used.
    assert.deepEqual(listO2dOrdersQuery.parse({ status: 'OPEN,CLOSED' }).status, ['OPEN', 'CLOSED']);
  });

  test('a single value works in either shape', () => {
    assert.deepEqual(listO2dOrdersQuery.parse({ status: 'OPEN' }).status, ['OPEN']);
    assert.deepEqual(listO2dOrdersQuery.parse({ status: ['OPEN'] }).status, ['OPEN']);
  });

  test('absent stays absent, so the live-only default still applies', () => {
    assert.equal(listO2dOrdersQuery.parse({}).status, undefined);
  });

  test('an invalid value is still refused, in both shapes', () => {
    // Widening the accepted SHAPE must not widen the accepted VALUES.
    assert.throws(() => listO2dOrdersQuery.parse({ status: ['NOT_A_STATUS'] }));
    assert.throws(() => listO2dOrdersQuery.parse({ status: 'NOT_A_STATUS' }));
  });

  test('the export and task queries share the one helper', () => {
    // There were two near-identical helpers and only one had been fixed, which
    // is a worse state than either.
    assert.deepEqual(exportQuery.parse({ status: ['CLOSED'] }).status, ['CLOSED']);
    assert.deepEqual(myTasksQuery.parse({ status: ['PENDING'] }).status, ['PENDING']);
  });
});
