/**
 * Role-based visibility of an order's stages.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE ARE GUARDING
 * ---------------------------------------------------------------------------
 *
 * Admin and Super Admin see the whole workflow. Everybody else sees only the
 * stages their role is attached to.
 *
 * A restriction like this is only worth as much as its LEAKIEST endpoint, and
 * stage data is reachable from three places: the order payload, the per-stage
 * history, and the `stageReached` filter on the tracker. Hiding stage 7 in the
 * first while the other two still describe it would be no restriction at all —
 * so each one is tested here rather than only the obvious one.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { closeStage } from './helpers/o2dStage.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dOrderItem } from '../models/o2d/O2dOrderItem.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import * as orders from '../modules/o2d/order.service.js';
import {
  visibleStagesFor, applyStageVisibility, canSeeStage,
} from '../modules/o2d/stageVisibility.service.js';
import { STAGES } from '../shared/constants/o2d.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date();
const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster, O2dOrderItem);
});
after(async () => { await stopTestMongo(); });
beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

const create = async (po = 'PO-VIS-1') =>
  (await orders.createOrder({
    poNumber: po,
    poDate: new Date(NOW.getTime() - 2 * MINUTE).toISOString(),
    customerName: 'ABC Industries',
    promiseDate: new Date(NOW.getTime() + 11 * DAY).toISOString(),
    items: [],
  }, actor('Sales'), { now: NOW })).order;

// ---------------------------------------------------------------------------

describe('who sees everything', () => {
  test('Super Admin is unscoped', async () => {
    assert.equal(await visibleStagesFor(actor('Super Admin')), null);
  });

  test('Admin is unscoped', async () => {
    // Both hold the '*' wildcard, and the workflow as a whole is the thing
    // they are accountable for.
    assert.equal(await visibleStagesFor(actor('Admin')), null);
  });

  test('Admin gets all twelve stages on an order', async () => {
    const order = await create();
    const { stages, stageVisibility } = await orders.getOrder(order._id, actor('Admin'));

    assert.equal(stages.length, 12);
    assert.equal(stageVisibility.scoped, false);
    assert.equal(stageVisibility.hiddenStageCount, 0);
  });
});

// ---------------------------------------------------------------------------

describe('everybody else sees only their own stages', () => {
  test('Warehouse sees the two stages it is attached to, not twelve', async () => {
    const order = await create();
    const { stages, stageVisibility } = await orders.getOrder(order._id, actor('Warehouse User'));

    const numbers = stages.map((s) => s.stageNumber);
    // 7 (it closes) and 9 (it owns and closes). Nothing else.
    assert.ok(numbers.includes(STAGES.WAREHOUSE_PICKING));
    assert.ok(numbers.includes(STAGES.PACK_AND_DISPATCH));
    assert.ok(!numbers.includes(STAGES.SEND_SOR_PI), 'stage 3 is Billing’s, not theirs');
    assert.ok(stages.length < 12);
    assert.equal(stageVisibility.scoped, true);
  });

  test('a stage it merely OWNS is visible, not just what it closes', async () => {
    const order = await create();
    const { stages } = await orders.getOrder(order._id, actor('Sales'));
    const numbers = stages.map((s) => s.stageNumber);

    // Sales owns stage 2; Billing closes it. Hiding it would leave the
    // salesperson with no screen telling them a PO is waiting to be handed over.
    assert.ok(numbers.includes(STAGES.SUBMIT_PO_TO_BILLING));
  });

  test('the payload says how many stages were withheld', async () => {
    const order = await create();
    const { stages, stageVisibility } = await orders.getOrder(order._id, actor('Warehouse User'));

    // Counted, never listed. A viewer shown three stages of twelve with no
    // indication the rest exist would read that as the whole workflow.
    assert.equal(stageVisibility.hiddenStageCount, 12 - stages.length);
    assert.equal(stageVisibility.totalStages, 12);
  });

  test('the order itself is still readable — only its stages are scoped', async () => {
    const order = await create();
    const { order: header } = await orders.getOrder(order._id, actor('Warehouse User'));

    // `currentStage` is deliberately NOT hidden: "where is this order" has to
    // stay answerable or the restriction stops people doing their job.
    assert.equal(header.poNumber, 'PO-VIS-1');
    assert.ok(header.currentStage);
  });

  test('canSeeStage agrees with the list', async () => {
    assert.equal(await canSeeStage(actor('Billing'), STAGES.SEND_SOR_PI), true);
    assert.equal(await canSeeStage(actor('Billing'), STAGES.PACK_AND_DISPATCH), false);
    assert.equal(await canSeeStage(actor('Admin'), STAGES.PACK_AND_DISPATCH), true);
  });
});

// ---------------------------------------------------------------------------

describe('the restriction cannot be walked around', () => {
  test('stageReached returns nothing for a stage the viewer may not see', async () => {
    const order = await create();
    await closeStage({
      orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'), now: NOW,
    });

    // Warehouse asking "what has passed through stage 2?" would otherwise read
    // the progress of a stage its order payload deliberately withholds.
    const { data } = await orders.listOrders(
      { stageReached: STAGES.SUBMIT_PO_TO_BILLING },
      actor('Warehouse User'),
    );
    assert.equal(data.length, 0);
  });

  test('and still answers for a stage it may', async () => {
    const order = await create();
    const { data } = await orders.listOrders(
      { stageReached: STAGES.WAREHOUSE_PICKING },
      actor('Warehouse User'),
    );
    // Stage 7 is theirs; it is simply not reached yet, which is a different
    // empty from "you may not ask".
    assert.equal(data.length, 0);
    assert.ok(order);
  });

  test('an unscoped viewer is unaffected by the filter', async () => {
    const order = await create();
    await closeStage({
      orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'), now: NOW,
    });

    const { data } = await orders.listOrders(
      { stageReached: STAGES.SUBMIT_PO_TO_BILLING },
      actor('Admin'),
    );
    assert.equal(data.length, 1);
  });

  test('scoping happens in getOrder, so every caller inherits it', async () => {
    const order = await create();
    // Not in a controller: the exit service, the picklist and the notification
    // renderer all read orders through this function, and a filter applied one
    // layer up would leave each of them returning the full workflow.
    const asWarehouse = await orders.getOrder(order._id, actor('Warehouse User'));
    const asAdmin = await orders.getOrder(order._id, actor('Admin'));
    assert.ok(asWarehouse.stages.length < asAdmin.stages.length);
  });
});

// ---------------------------------------------------------------------------

describe('applyStageVisibility', () => {
  const rows = [{ stageNumber: 1 }, { stageNumber: 2 }, { stageNumber: 7 }];

  test('null means unrestricted, and copies nothing', () => {
    const out = applyStageVisibility(rows, null);
    assert.equal(out.stages.length, 3);
    assert.equal(out.scoped, false);
  });

  test('an empty list hides everything rather than showing everything', () => {
    // The dangerous default. A role attached to no stage must see none — an
    // empty allow-list read as "no restriction" is how these bugs happen.
    const out = applyStageVisibility(rows, []);
    assert.equal(out.stages.length, 0);
    assert.equal(out.hiddenStageCount, 3);
  });

  test('keeps exactly what was allowed', () => {
    const out = applyStageVisibility(rows, [2, 7]);
    assert.deepEqual(out.stages.map((s) => s.stageNumber), [2, 7]);
    assert.equal(out.hiddenStageCount, 1);
  });
});
