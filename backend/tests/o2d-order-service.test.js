/**
 * Order intake, lines, the advance decision and My Tasks.
 *
 * The rules under test are the ones the brief states as requirements rather than
 * as implementation: §26's duplicate check, §27's promise date, §8–9's advance
 * branch, and §14's task routing. Each is checked in BOTH directions — that it
 * refuses what it should, and that it still allows what it should — because a
 * guard that refuses everything also passes a one-sided test.
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
import * as tasks from '../modules/o2d/task.service.js';
import { completeStage, O2dWorkflowError } from '../modules/o2d/stage.engine.js';
import { STAGES, STAGE_STATUS, ORDER_STATUS } from '../shared/constants/o2d.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

const INTAKE = {
  poNumber: 'PO-4471',
  poDate: ist('2026-09-14', '09:00').toISOString(),
  customerName: 'ABC Industries',
  promiseDate: ist('2026-09-25', '10:00').toISOString(),
};

const NOW = ist('2026-09-14', '10:30');

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster, O2dOrderItem);
});
after(async () => { await stopTestMongo(); });

beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

const create = (over = {}, who = actor('Sales')) =>
  orders.createOrder({ ...INTAKE, items: [], ...over }, who, { now: NOW });

// ---------------------------------------------------------------------------

describe('order intake', () => {
  test('creates the order, its twelve stages, and completes stage 1', async () => {
    const { order } = await create();

    assert.equal(order.poNumber, 'PO-4471');
    assert.equal(order.status, ORDER_STATUS.OPEN);
    // Stage 1 is done by the act of creating, so the cursor is already on 2.
    assert.equal(order.currentStage, STAGES.SUBMIT_PO_TO_BILLING);

    const stages = await O2dOrderStage.find({ order: order._id }).sort({ stageNumber: 1 });
    assert.equal(stages.length, 12);
    assert.equal(stages[0].status, STAGE_STATUS.DONE_ON_TIME);
    assert.equal(stages[1].status, STAGE_STATUS.PENDING);
    // Everything after the open stage stays locked.
    assert.ok(stages.slice(2).every((s) => s.status === STAGE_STATUS.LOCKED));
  });

  test('stores lines in the customer PO order, and rolls the total up', async () => {
    const { order } = await create({
      items: [
        { skuCode: 'SKU-B', orderedQty: 10 },
        { skuCode: 'SKU-A', orderedQty: 5 },
      ],
    });

    const items = await orders.listItems(order._id);
    // Position in the array IS the customer's sequence — not re-sorted by SKU.
    assert.deepEqual(items.map((i) => i.skuCode), ['SKU-B', 'SKU-A']);
    assert.deepEqual(items.map((i) => i.lineSeq), [1, 2]);
    assert.equal(order.totalOrderedQty, 15);
  });

  // ── §26 duplicates ──────────────────────────────────────────────────────

  test('refuses a second live order for the same PO and customer', async () => {
    await create();
    await assert.rejects(
      () => create(),
      (e) => e.code === 'O2D_DUPLICATE_PO' && e.statusCode === 409,
    );
  });

  test('the refusal names the existing order, so Sales can go and look at it', async () => {
    const { order: first } = await create();
    await create().catch((e) => {
      assert.equal(String(e.duplicate._id), String(first._id));
      assert.match(e.message, /currently at stage/);
    });
  });

  test('the same PO number for a DIFFERENT customer is not a duplicate', async () => {
    await create();
    const { order } = await create({ customerName: 'XYZ Traders' });
    assert.equal(order.poNumber, 'PO-4471');
  });

  test('the duplicate rule is a BAN, because the unique index makes it one', async () => {
    await create();
    // There is deliberately no override flag. The partial unique index on
    // (poNumberKey, customerKey) refuses the insert regardless of what the
    // service decides, so an override would be a button that always errored.
    await assert.rejects(() => create(), (e) => e.code === 'O2D_DUPLICATE_PO');

    // And the sanctioned route out still works: cancel, then reissue.
    await O2dOrder.updateOne({ poNumber: 'PO-4471' }, { $set: { status: ORDER_STATUS.CANCELLED } });
    const { order } = await create();
    assert.ok(order._id);
  });

  test('a cancelled order does not block the PO number being reissued', async () => {
    const { order } = await create();
    await O2dOrder.updateOne({ _id: order._id }, { $set: { status: ORDER_STATUS.CANCELLED } });

    // No override needed: the partial index and the check both look at live
    // orders only, so this is an ordinary create.
    const { order: reissued } = await create();
    assert.notEqual(String(reissued._id), String(order._id));
  });

  // ── §27 promise date ────────────────────────────────────────────────────

  test('refuses an order with no promise date and no reason', async () => {
    await assert.rejects(
      () => create({ promiseDate: null }),
      (e) => e.code === 'O2D_PROMISE_DATE_REQUIRED',
    );
  });

  test('allows one with a reason, and records the reason against the order', async () => {
    const { order } = await create({
      promiseDate: null,
      promiseDateOverrideReason: 'Customer will confirm the date after their audit',
    });
    assert.equal(order.promiseDate, null);
    assert.match(order.promiseDateOverrideReason, /after their audit/);
    assert.ok(order.promiseDateOverrideBy !== undefined);
  });

  test('a normal order carries no override, so the exception stays visible', async () => {
    const { order } = await create();
    assert.equal(order.promiseDateOverrideReason, null);
    assert.equal(order.promiseDateOverrideBy, null);
  });

  test('refuses a promise date that falls before the PO date', async () => {
    await assert.rejects(
      () => create({ promiseDate: ist('2026-09-10', '10:00').toISOString() }),
      (e) => e.code === 'O2D_PROMISE_BEFORE_PO',
    );
  });

  test('refuses a PO dated in the future', async () => {
    await assert.rejects(
      () => create({ poDate: ist('2026-12-01', '09:00').toISOString() }),
      (e) => e.code === 'O2D_FUTURE_PO_DATE',
    );
  });

  test('clearing the promise date later needs a reason too', async () => {
    const { order } = await create();
    await assert.rejects(
      () => orders.updateOrder(order._id, { promiseDate: null }, actor('Sales')),
      (e) => e.code === 'O2D_PROMISE_DATE_REQUIRED',
    );
  });

  test('renaming the customer keeps the duplicate key in step', async () => {
    const { order } = await create();
    await orders.updateOrder(order._id, { customerName: 'ABC Industries Pvt Ltd' }, actor('Sales'));

    // The old name is now free, and the new one is taken.
    assert.equal(await orders.findDuplicateOrder('PO-4471', 'ABC Industries'), null);
    assert.ok(await orders.findDuplicateOrder('PO-4471', 'ABC Industries Pvt Ltd'));
  });
});

// ---------------------------------------------------------------------------

describe('order lines', () => {
  test('are replaceable while the warehouse has not acted', async () => {
    const { order } = await create({ items: [{ skuCode: 'SKU-A', orderedQty: 5 }] });
    const items = await orders.replaceItems(
      order._id,
      [{ skuCode: 'SKU-C', orderedQty: 8 }],
      actor('Sales'),
    );
    assert.deepEqual(items.map((i) => i.skuCode), ['SKU-C']);

    const fresh = await O2dOrder.findById(order._id);
    assert.equal(fresh.totalOrderedQty, 8);
  });

  test('are frozen once the picking request is acknowledged', async () => {
    const { order } = await create({ items: [{ skuCode: 'SKU-A', orderedQty: 5 }] });

    // Walk to stage 7 and close it.
    for (const n of [2, 3]) {
      await completeStage({ orderId: order._id, stageNumber: n, actor: actor('Billing'), now: NOW });
    }
    await orders.decideAdvance(order._id, { advanceRequired: false }, actor('Billing'), { now: NOW });
    await completeStage({ orderId: order._id, stageNumber: 6, actor: actor('Billing'), now: NOW });
    await completeStage({
      orderId: order._id, stageNumber: STAGES.WAREHOUSE_PICKING,
      actor: actor('Warehouse User'), now: NOW,
    });

    await assert.rejects(
      () => orders.replaceItems(order._id, [{ skuCode: 'SKU-X', orderedQty: 1 }], actor('Sales')),
      (e) => e.code === 'O2D_ITEMS_LOCKED',
    );
  });
});

// ---------------------------------------------------------------------------

describe('the advance decision (§8-9)', () => {
  const walkToStage4 = async () => {
    const { order } = await create();
    await completeStage({ orderId: order._id, stageNumber: 2, actor: actor('Billing'), now: NOW });
    await completeStage({ orderId: order._id, stageNumber: 3, actor: actor('Billing'), now: NOW });
    return order;
  };

  test('NO skips stage 5 and leaves the cursor on stage 6', async () => {
    const order = await walkToStage4();
    const { order: after } = await orders.decideAdvance(
      order._id, { advanceRequired: false }, actor('Billing'), { now: NOW },
    );

    assert.equal(after.advanceRequired, false);
    assert.equal(after.currentStage, STAGES.CREATE_ORDER_LIST);

    const five = await O2dOrderStage.findOne({ order: order._id, stageNumber: STAGES.RECEIVE_ADVANCE });
    assert.equal(five.status, STAGE_STATUS.SKIPPED);
    assert.match(five.skipReason, /decided at stage 4/);
  });

  test('YES leaves stage 5 open for Accounts, and the cursor on it', async () => {
    const order = await walkToStage4();
    const { order: after } = await orders.decideAdvance(
      order._id, { advanceRequired: true }, actor('Billing'), { now: NOW },
    );

    assert.equal(after.advanceRequired, true);
    assert.equal(after.currentStage, STAGES.RECEIVE_ADVANCE);

    const five = await O2dOrderStage.findOne({ order: order._id, stageNumber: STAGES.RECEIVE_ADVANCE });
    assert.equal(five.status, STAGE_STATUS.PENDING);
    // 7 CALENDAR days, not working days — a customer's bank keeps its own hours.
    assert.equal(
      new Date(five.plannedCompletion).toISOString().slice(0, 10),
      '2026-09-21',
    );
  });

  test('a refused stage-4 completion leaves no decision on the header', async () => {
    // Stage 4 is not reachable yet: stages 2 and 3 are still open.
    const { order } = await create();
    await assert.rejects(
      () => orders.decideAdvance(order._id, { advanceRequired: true }, actor('Billing'), { now: NOW }),
      O2dWorkflowError,
    );

    const fresh = await O2dOrder.findById(order._id);
    // null, not false — undecided is a third state, and writing the header
    // before the engine agreed would make a refused click look like a decision.
    assert.equal(fresh.advanceRequired, null);
  });
});

// ---------------------------------------------------------------------------

describe('My Tasks (§14)', () => {
  test('routes a stage to the role that CLOSES it, not the one that pushes it', async () => {
    // Stage 7's owner is Billing; §10 says the WAREHOUSE acknowledgement closes
    // it. So it is the warehouse's task to action.
    const { actionable, watching } = await tasks.roleStageMap('Warehouse User');
    assert.ok(actionable.includes(STAGES.WAREHOUSE_PICKING));

    const billing = await tasks.roleStageMap('Billing');
    assert.ok(!billing.actionable.includes(STAGES.WAREHOUSE_PICKING));
    // Billing still SEES it — they raised it and are accountable for it.
    assert.ok(billing.watching.includes(STAGES.WAREHOUSE_PICKING));
  });

  test('shows the open stage to the role that can close it', async () => {
    const { order } = await create();
    const { data } = await tasks.myTasks(actor('Billing'), {});

    const row = data.find((r) => String(r.order?._id) === String(order._id));
    assert.ok(row, 'Billing should see the stage-2 acknowledgement');
    assert.equal(row.stageNumber, STAGES.SUBMIT_PO_TO_BILLING);
    assert.equal(row.actionable, true);
    assert.equal(row.order.poNumber, 'PO-4471');
  });

  test('shows it to the owner as watching, not as actionable', async () => {
    await create();
    const { data } = await tasks.myTasks(actor('Sales'), {});
    const row = data.find((r) => r.stageNumber === STAGES.SUBMIT_PO_TO_BILLING);
    assert.ok(row, 'Sales owns stage 2 and should still see it');
    // The distinction that stops Sales closing a stage Billing must acknowledge.
    assert.equal(row.actionable, false);
  });

  test('locked stages are not tasks', async () => {
    await create();
    const { data } = await tasks.myTasks(actor('Warehouse User'), {});
    // Stage 7 exists but is locked behind stages 2-6.
    assert.equal(data.length, 0);
  });

  test('an order on hold leaves every queue', async () => {
    const { order } = await create();
    assert.ok((await tasks.myTasks(actor('Billing'), {})).total > 0);

    await O2dOrder.updateOne({ _id: order._id }, { $set: { status: ORDER_STATUS.ON_HOLD } });
    assert.equal((await tasks.myTasks(actor('Billing'), {})).total, 0);
  });

  test('a stageNumber filter narrows the caller\'s own stages and never widens them', async () => {
    await create();
    // Warehouse asks for stage 2, which is not theirs to close or watch.
    const { data } = await tasks.myTasks(actor('Warehouse User'), {
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    });
    assert.equal(data.length, 0);
  });

  test('canWorkStage refuses a stage the role does not close', async () => {
    assert.equal(await tasks.canWorkStage(actor('Warehouse User'), STAGES.SEND_SOR_PI), false);
    assert.equal(await tasks.canWorkStage(actor('Billing'), STAGES.SEND_SOR_PI), true);
  });

  test('an administrator who reassigns a stage reroutes the task, with no deploy', async () => {
    // §37: the master is the source of truth for ownership.
    await O2dStageMaster.updateOne(
      { stageNumber: STAGES.SEND_SOR_PI },
      { $set: { ownerRole: 'Accounts', alsoAllowedRoles: [] } },
    );
    assert.equal(await tasks.canWorkStage(actor('Billing'), STAGES.SEND_SOR_PI), false);
    assert.equal(await tasks.canWorkStage(actor('Accounts'), STAGES.SEND_SOR_PI), true);
  });

  test('counts are computed over the whole queue, not the current page', async () => {
    await create();
    await create({ poNumber: 'PO-4472' });

    const counts = await tasks.myTaskCounts(actor('Billing'));
    assert.equal(counts.total, 2);
    assert.equal(counts.actionable, 2);
  });
});

// ---------------------------------------------------------------------------

describe('the tracker list', () => {
  test('shows open orders by default and finds them by PO or customer', async () => {
    await create();
    await create({ poNumber: 'PO-9000', customerName: 'XYZ Traders' });

    assert.equal((await orders.listOrders({})).total, 2);
    assert.equal((await orders.listOrders({ search: 'XYZ' })).total, 1);
    assert.equal((await orders.listOrders({ search: 'PO-9000' })).total, 1);
  });

  test('overdueOnly selects orders whose open stage is past its deadline', async () => {
    await create();
    await create({ poNumber: 'PO-9000' , customerName: 'XYZ Traders' });

    // `overdueOnly` compares against the real clock, and the fixture's dates are
    // deliberately in the future — so NEITHER order is late to begin with.
    // Pull one deadline into the past to make exactly one overdue.
    const late = await O2dOrder.findOne({ poNumber: 'PO-4471' });
    await O2dOrderStage.updateOne(
      { order: late._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING },
      { $set: { plannedCompletion: new Date(Date.now() - 86_400_000) } },
    );

    const result = await orders.listOrders({ overdueOnly: true });
    assert.equal(result.total, 1);
    assert.equal(result.data[0].poNumber, 'PO-4471');
  });

  test('getOrder returns the header, twelve stages and the lines together', async () => {
    const { order } = await create({ items: [{ skuCode: 'SKU-A', orderedQty: 3 }] });
    const full = await orders.getOrder(order._id);

    assert.equal(full.order.poNumber, 'PO-4471');
    assert.equal(full.stages.length, 12);
    assert.equal(full.items.length, 1);
    // The derived field the tracker shows, present on a lean read.
    assert.equal(full.items[0].remainingQty, 3);
  });
});

// ---------------------------------------------------------------------------

describe('the Imports visibility scope (§20)', () => {
  /** Move an order's cursor without walking every stage. */
  const setStage = (poNumber, stage) =>
    O2dOrder.updateOne({ poNumber }, { $set: { currentStage: stage } });

  const imports = actor('Import Team');

  test('hides orders that have not reached stage 6', async () => {
    await create();
    await setStage('PO-4471', STAGES.SEND_SOR_PI);

    // Sales sees it; Imports does not. The permission is identical — only the
    // scope differs.
    assert.equal((await orders.listOrders({}, actor('Sales'))).total, 1);
    assert.equal((await orders.listOrders({}, imports)).total, 0);
  });

  test('shows them from stage 6 onward', async () => {
    await create();
    await setStage('PO-4471', STAGES.CREATE_ORDER_LIST);
    assert.equal((await orders.listOrders({}, imports)).total, 1);

    await setStage('PO-4471', STAGES.PACK_AND_DISPATCH);
    assert.equal((await orders.listOrders({}, imports)).total, 1);
  });

  test('a stage filter below the floor returns nothing rather than being widened', async () => {
    await create();
    await setStage('PO-4471', STAGES.CREATE_ORDER_LIST);

    // Asking for stage 3 must not silently become "stage 6 and above".
    const result = await orders.listOrders({ currentStage: STAGES.SEND_SOR_PI }, imports);
    assert.equal(result.total, 0);
  });

  test('Order 360 answers 404, not 403, for an order below the floor', async () => {
    const { order } = await create();
    await setStage('PO-4471', STAGES.SEND_SOR_PI);

    // 403 would confirm the order exists and reveal that it is early.
    await assert.rejects(
      () => orders.getOrder(order._id, imports),
      (e) => e.statusCode === 404,
    );

    await setStage('PO-4471', STAGES.CREATE_ORDER_LIST);
    assert.ok(await orders.getOrder(order._id, imports));
  });

  test('no other role is scoped, and an absent viewer is unscoped', async () => {
    await create();
    await setStage('PO-4471', STAGES.SUBMIT_PO_TO_BILLING);

    for (const role of ['Sales', 'Billing', 'Accounts', 'Warehouse User', 'Management']) {
      assert.equal(
        (await orders.listOrders({}, actor(role))).total, 1,
        `${role} should not be stage-scoped`,
      );
    }
    // Internal callers (migrations, jobs) pass no viewer and see everything.
    assert.equal((await orders.listOrders({})).total, 1);
  });

  test('Imports owns no stage and so has no tasks', async () => {
    const { actionable } = await tasks.roleStageMap('Import Team');
    assert.deepEqual(actionable, [], 'read-only: notified to plan, not to advance the order');
  });
});
