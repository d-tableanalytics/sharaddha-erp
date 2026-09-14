/**
 * A task stays visible in every stage it has passed through.
 *
 * ---------------------------------------------------------------------------
 * THE BEHAVIOUR THIS REPLACES
 * ---------------------------------------------------------------------------
 *
 * My Tasks used to exclude terminal statuses, so an order VANISHED from the
 * queue the instant its stage was closed. The person who closed it had no way
 * to confirm the click registered, and no way to answer "did I already do this
 * one?" without opening the tracker.
 *
 * Now the row is retained, marked Done, and the order also appears against
 * whichever stage is now active — so the queue shows progress rather than only
 * what is outstanding.
 *
 * ---------------------------------------------------------------------------
 * AND THE COST IT MUST NOT PAY
 * ---------------------------------------------------------------------------
 *
 * A queue that fills with history stops being a queue. Two properties protect
 * it, and both are pinned below: open work sorts ABOVE finished work whatever
 * the deadlines say, and the badge counts only what is still owed.
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
import * as tasks from '../modules/o2d/task.service.js';
import { completeStage } from '../modules/o2d/stage.engine.js';
import { closeStage } from './helpers/o2dStage.js';
import { STAGES, STAGE_DISPLAY_STATUS } from '../shared/constants/o2d.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date();

const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

const INTAKE = {
  poNumber: 'PO-RETAIN-1',
  poDate: new Date(NOW.getTime() - 2 * MINUTE).toISOString(),
  customerName: 'ABC Industries',
  promiseDate: new Date(NOW.getTime() + 11 * DAY).toISOString(),
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

const create = async (over = {}) =>
  (await orders.createOrder({ ...INTAKE, items: [], ...over }, actor('Sales'), { now: NOW })).order;

/** Close stage 2, which unlocks stage 3 — both of them Billing's. */
const closeStage2 = async (order) =>
  closeStage({
    orderId: order._id,
    stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    actor: actor('Billing'),
    now: NOW,
  });

const rowFor = (data, stageNumber) => data.find((r) => r.stageNumber === stageNumber);

// ---------------------------------------------------------------------------

describe('a finished stage stays in the queue', () => {
  test('the row is retained rather than removed', async () => {
    const order = await create();
    await closeStage2(order);

    const { data } = await tasks.myTasks(actor('Billing'), {});
    const stage2 = rowFor(data, STAGES.SUBMIT_PO_TO_BILLING);

    // The whole point: before this change the row was simply gone.
    assert.ok(stage2, 'the completed stage must still be visible');
    assert.equal(stage2.completed, true);
    assert.equal(stage2.displayStatus, STAGE_DISPLAY_STATUS.DONE);
  });

  test('and is NOT offered as work', async () => {
    const order = await create();
    await closeStage2(order);

    const { data } = await tasks.myTasks(actor('Billing'), {});
    const stage2 = rowFor(data, STAGES.SUBMIT_PO_TO_BILLING);

    // A retained row that still showed a Complete button would invite somebody
    // to close finished work.
    assert.equal(stage2.actionable, false);
  });

  test('the order appears against the NEXT active stage at the same time', async () => {
    const order = await create();
    await closeStage2(order);

    const { data } = await tasks.myTasks(actor('Billing'), {});
    const mine = data.filter((r) => String(r.order?._id) === String(order._id));

    // One order, two rows: where it has been and where it is.
    const stage2 = rowFor(mine, STAGES.SUBMIT_PO_TO_BILLING);
    const stage3 = rowFor(mine, STAGES.SEND_SOR_PI);

    assert.ok(stage2 && stage3, 'both the finished and the active stage are present');
    assert.equal(stage2.completed, true);
    assert.equal(stage3.completed, false);
    assert.equal(stage3.actionable, true, 'the active one is the work');
    assert.equal(stage3.displayStatus, STAGE_DISPLAY_STATUS.IN_PROGRESS);
  });

  test('a stage filter shows what passed through it, not just what sits there', async () => {
    const order = await create();
    await closeStage2(order);

    const { data } = await tasks.myTasks(actor('Billing'), {
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    });

    assert.equal(data.length, 1);
    assert.equal(data[0].completed, true);
  });
});

// ---------------------------------------------------------------------------

describe('the queue still works as a queue', () => {
  test('open work sorts above finished work, whatever the deadlines say', async () => {
    const order = await create();
    await closeStage2(order);

    const { data } = await tasks.myTasks(actor('Billing'), {});

    // A stage completed earlier has an older deadline than anything still open,
    // so a single deadline ordering would bury today's work under history.
    const firstCompleted = data.findIndex((r) => r.completed);
    const lastOpen = data.map((r) => r.completed).lastIndexOf(false);
    assert.ok(firstCompleted === -1 || lastOpen < firstCompleted,
      'every open row must precede every completed row');
  });

  test('the counts above the list report only what is still owed', async () => {
    const order = await create();
    await closeStage2(order);

    const counts = await tasks.myTaskCounts(actor('Billing'));

    // A badge counts work to be done. Counting the retained history would show
    // a warehouse user "412 tasks" when three are theirs, which is how a badge
    // stops being read.
    assert.equal(counts.total, 1, 'only the open stage 3');
    assert.equal(counts.completed, 1, 'the finished one is reported separately');
  });

  test('the list reports both totals so a screen needs one request', async () => {
    const order = await create();
    await closeStage2(order);

    const res = await tasks.myTasks(actor('Billing'), {});
    assert.equal(res.openCount, 1);
    assert.equal(res.completedCount, 1);
    assert.equal(res.total, res.openCount + res.completedCount);
  });
});

// ---------------------------------------------------------------------------

describe('the view parameter', () => {
  test('open returns the classic to-do list', async () => {
    const order = await create();
    await closeStage2(order);

    const { data } = await tasks.myTasks(actor('Billing'), { view: 'open' });
    assert.ok(data.every((r) => !r.completed));
    assert.equal(rowFor(data, STAGES.SUBMIT_PO_TO_BILLING), undefined);
    assert.ok(rowFor(data, STAGES.SEND_SOR_PI));
  });

  test('completed returns only what this role has closed', async () => {
    const order = await create();
    await closeStage2(order);

    const { data } = await tasks.myTasks(actor('Billing'), { view: 'completed' });
    assert.ok(data.length > 0);
    assert.ok(data.every((r) => r.completed));
  });

  test('all is the default, and returns both', async () => {
    const order = await create();
    await closeStage2(order);

    const bare = await tasks.myTasks(actor('Billing'), {});
    const explicit = await tasks.myTasks(actor('Billing'), { view: 'all' });
    assert.equal(bare.total, explicit.total);
    assert.ok(bare.data.some((r) => r.completed));
    assert.ok(bare.data.some((r) => !r.completed));
  });
});

// ---------------------------------------------------------------------------

describe('what retention did NOT change', () => {
  test('a locked stage is still not a task', async () => {
    await create();
    // Stage 7 exists but sits behind stages 2-6. Retaining finished work must
    // not have quietly turned My Tasks into a copy of the tracker.
    const { data } = await tasks.myTasks(actor('Warehouse User'), {});
    assert.equal(data.length, 0);
  });

  test('an explicit status filter cannot widen the view back to locked', async () => {
    await create();
    const { data } = await tasks.myTasks(actor('Warehouse User'), { status: ['LOCKED'] });
    assert.equal(data.length, 0);
  });

  test('a held order still leaves every queue', async () => {
    const order = await create();
    await closeStage2(order);
    assert.ok((await tasks.myTasks(actor('Billing'), {})).total > 0);

    await O2dOrder.updateOne({ _id: order._id }, { $set: { status: 'ON_HOLD' } });
    // §19 freezes the SLA; people must not be chasing work they were told to
    // stop, and that applies to the history rows too.
    assert.equal((await tasks.myTasks(actor('Billing'), {})).total, 0);
  });

  test('a role still sees only its own stages', async () => {
    const order = await create();
    await closeStage2(order);

    // Stage 2 is Billing's to close and Sales' to own. Warehouse has no claim
    // on it, finished or not.
    const { data } = await tasks.myTasks(actor('Warehouse User'), {
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    });
    assert.equal(data.length, 0);
  });
});
