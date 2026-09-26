/**
 * Every active O2D stage is a real Checklist task.
 *
 * When a stage opens and nobody is named, it is a TEAM task: everyone in the
 * role that completes it sees it on their Checklist — the same people who see
 * it in O2D My Tasks — plus admins and cover roles. Whoever completes it, from
 * either screen, is credited, and the next stage's task appears for its team.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { buildTestApp, stubProtect, withServer, get, post, patch } from './helpers/http.js';
import User from '../models/User.js';
import { O2dOrder, o2dKey } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dDocument } from '../models/o2d/O2dDocument.js';
import { Delegation } from '../models/Delegation.js';
import { ChecklistRoutine, ChecklistOccurrence, OCCURRENCE_REASSIGNED_AWAY } from '../models/Checklist.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import {
  createStagesForOrder, holdOrder, resumeOrder, reopenStage,
} from '../modules/o2d/stage.engine.js';
import { decideAdvance } from '../modules/o2d/order.service.js';
import { assignStageToUser } from '../modules/o2d/o2dDelegationSync.service.js';
import { myTasks } from '../modules/o2d/task.service.js';
import checklistRoutes from '../modules/checklist/checklist.routes.js';
import { closeStage } from './helpers/o2dStage.js';
import { STAGES, STAGE_STATUS } from '../shared/constants/o2d.js';

before(async () => {
  await startTestMongo();
  await syncIndexes(
    O2dOrder, O2dOrderStage, O2dStageMaster, O2dDocument, Delegation, ChecklistRoutine, ChecklistOccurrence, User,
  );
});
after(async () => { await stopTestMongo(); });
beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

let seq = 0;
async function account(role) {
  seq += 1;
  return User.create({
    email: `team${seq}@example.com`, password: 'x'.repeat(12), user: `${role} Person${seq}`, role, status: 'Active',
  });
}

async function newOrder(sales) {
  seq += 1;
  const order = await O2dOrder.create({
    poNumber: `PO-TEAM-${seq}`,
    poNumberKey: o2dKey(`PO-TEAM-${seq}`),
    poDate: new Date(Date.now() - 60 * 60_000),
    customerName: 'ABC Industries',
    customerKey: o2dKey('ABC Industries'),
    promiseDate: new Date(Date.now() + 10 * 86_400_000),
  });
  await createStagesForOrder(order, { actor: sales });
  return O2dOrder.findById(order._id);
}

const stageOf = (orderId, n) => O2dOrderStage.findOne({ order: orderId, stageNumber: n });
const taskOf = async (orderId, n) => {
  const stage = await stageOf(orderId, n);
  return stage?.checklistOccurrenceId ? ChecklistOccurrence.findById(stage.checklistOccurrenceId).lean() : null;
};

const app = (user) => buildTestApp({
  mount: (a) => {
    a.use((req, res, next) => stubProtect(user)(req, res, next));
    a.use('/api/v1/checklist', checklistRoutes);
  },
});

/** The live rows a user's Checklist shows for one order's stage. */
async function checklistRows(url, orderId, stageNumber) {
  const res = await get(url, '/api/v1/checklist/tasks?limit=100');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.tasks.filter(
    (t) => String(t.sourceOrderId) === String(orderId) && t.sourceStageNumber === stageNumber && t.status !== 'completed',
  );
}

const inMyTasks = async (user, orderId, stageNumber) =>
  (await myTasks(user, { view: 'open' })).data
    .some((r) => String(r.order?._id) === String(orderId) && r.stageNumber === stageNumber);

// ===========================================================================

describe('every active stage has its task, created and closed by the workflow', () => {
  test('a new order gives stage 2 a team task for the role that completes it', async () => {
    const order = await newOrder(await account('Sales'));
    const stage = await stageOf(order._id, STAGES.SUBMIT_PO_TO_BILLING);
    const task = await taskOf(order._id, STAGES.SUBMIT_PO_TO_BILLING);

    assert.ok(task, 'the active stage has a Checklist task');
    assert.equal(task.doer, null, 'nobody is named, so it belongs to the team');
    // Stage 2 is owned by Sales but completed by Billing — the team is the closer.
    assert.equal(task.doerFirstName, 'Billing team');
    assert.equal(task.department, 'Sales');
    assert.equal(task.status, 'pending');
    assert.equal(new Date(task.plannedDate).getTime(), new Date(stage.plannedCompletion).getTime());
  });

  test('a locked stage has no task, so nobody can work ahead', async () => {
    const order = await newOrder(await account('Sales'));
    assert.equal(await ChecklistOccurrence.countDocuments({ sourceOrderId: order._id, sourceStageNumber: STAGES.SEND_SOR_PI }), 0);
  });

  test('completing the stage credits the completer and opens the next team task', async () => {
    const billing = await account('Billing');
    const order = await newOrder(await account('Sales'));
    const first = await taskOf(order._id, STAGES.SUBMIT_PO_TO_BILLING);

    await closeStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, actor: billing });

    const done = await ChecklistOccurrence.findById(first._id).lean();
    assert.equal(done.status, 'completed');
    assert.equal(String(done.doer), String(billing._id), 'the team task is credited to whoever completed it');
    assert.equal(String(done.completedBy), String(billing._id));

    const next = await taskOf(order._id, STAGES.SEND_SOR_PI);
    assert.ok(next, 'stage 3 is active, so it has its task');
    assert.equal(next.doer, null);
    assert.equal(next.status, 'pending');
  });

  test('stage 4 (a decision) gets no team task — it becomes a Delegation only once someone is named', async () => {
    const billing = await account('Billing');
    const order = await newOrder(await account('Sales'));
    await closeStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, actor: billing });
    await closeStage({ orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, actor: billing });

    const s4 = await stageOf(order._id, STAGES.ADVANCE_DECISION);
    assert.equal(s4.status, STAGE_STATUS.PENDING);
    assert.equal(s4.checklistOccurrenceId, null);
    assert.equal(s4.delegationId, null);

    await assignStageToUser({ orderId: order._id, stageNumber: STAGES.ADVANCE_DECISION, userId: billing._id, actor: billing });
    assert.ok((await stageOf(order._id, STAGES.ADVANCE_DECISION)).delegationId, 'named → Delegation, as before');
  });

  test('"no advance" leaves no stage-5 task behind on the Accounts team', async () => {
    const billing = await account('Billing');
    const order = await newOrder(await account('Sales'));
    await closeStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, actor: billing });
    await closeStage({ orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, actor: billing });

    await decideAdvance(order._id, { advanceRequired: false }, billing);

    assert.equal(await ChecklistOccurrence.countDocuments({ sourceOrderId: order._id, sourceStageNumber: STAGES.RECEIVE_ADVANCE }), 0);
    assert.equal((await stageOf(order._id, STAGES.RECEIVE_ADVANCE)).checklistOccurrenceId, null);
    assert.ok(await taskOf(order._id, STAGES.CREATE_ORDER_LIST), 'stage 6 is next, with its team task');
  });

  test('holding the order parks the team task; resuming brings it back', async () => {
    const admin = await account('Admin');
    const order = await newOrder(await account('Sales'));

    await holdOrder({ orderId: order._id, reason: 'CUSTOMER_REQUEST', actor: admin });
    assert.ok((await taskOf(order._id, STAGES.SUBMIT_PO_TO_BILLING)).heldAt);

    await resumeOrder({ orderId: order._id, actor: admin });
    assert.equal((await taskOf(order._id, STAGES.SUBMIT_PO_TO_BILLING)).heldAt, null);
  });

  test('rework: the relocked stage loses its task, the reopened stage gets a fresh one', async () => {
    const billing = await account('Billing');
    const admin = await account('Admin');
    const order = await newOrder(await account('Sales'));
    const firstClose = await taskOf(order._id, STAGES.SUBMIT_PO_TO_BILLING);
    await closeStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, actor: billing });
    const stage3Task = await taskOf(order._id, STAGES.SEND_SOR_PI);

    await reopenStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, reason: 'Wrong PO', actor: admin });

    const relocked = await ChecklistOccurrence.findById(stage3Task._id).lean();
    assert.equal(relocked.status, OCCURRENCE_REASSIGNED_AWAY, 'off every list while stage 3 waits again');
    assert.equal(relocked.sourceStageId, null);
    assert.equal((await stageOf(order._id, STAGES.SEND_SOR_PI)).checklistOccurrenceId, null);

    const fresh = await taskOf(order._id, STAGES.SUBMIT_PO_TO_BILLING);
    assert.notEqual(String(fresh._id), String(firstClose._id));
    assert.equal(fresh.status, 'pending');
    assert.equal(fresh.doer, null);
    // The first close keeps its credit.
    assert.equal((await ChecklistOccurrence.findById(firstClose._id).lean()).status, 'completed');
  });
});

describe('the Checklist shows each person what O2D My Tasks shows them', () => {
  test('the whole responsible team sees an unassigned stage; other teams do not', async () => {
    const billing1 = await account('Billing');
    const billing2 = await account('Billing');
    const warehouse = await account('Warehouse User');
    const head = await account('Billing Head');
    const admin = await account('Admin');
    const order = await newOrder(await account('Sales'));
    await closeStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, actor: billing1 });

    for (const [user, expected] of [[billing2, true], [head, true], [admin, true], [warehouse, false]]) {
      await withServer(app(user), async (url) => {
        const rows = await checklistRows(url, order._id, STAGES.SEND_SOR_PI);
        assert.equal(rows.length > 0, expected, `${user.role} Checklist`);
        assert.equal(await inMyTasks(user, order._id, STAGES.SEND_SOR_PI), expected, `${user.role} My Tasks agrees`);
        if (expected) assert.equal(rows[0].canComplete, true);
      });
    }
  });

  test('a manager who cannot work O2D stages sees the row but is not offered Complete', async () => {
    // Management oversees every Checklist but completes no O2D stage.
    const management = await account('Management');
    const order = await newOrder(await account('Sales'));

    await withServer(app(management), async (url) => {
      const rows = await checklistRows(url, order._id, STAGES.SUBMIT_PO_TO_BILLING);
      assert.equal(rows.length, 1, 'a Checklist manager sees every row, as before');
      assert.equal(rows[0].canComplete, false);
    });
  });

  test('naming one person moves it to them; admins and cover roles still see it', async () => {
    const billing1 = await account('Billing');
    const billing2 = await account('Billing');
    const head = await account('Billing Head');
    const admin = await account('Admin');
    const order = await newOrder(await account('Sales'));
    await closeStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, actor: billing1 });

    await assignStageToUser({ orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, userId: billing1._id, actor: billing1 });

    for (const [user, expected] of [[billing1, true], [billing2, false], [head, true], [admin, true]]) {
      await withServer(app(user), async (url) => {
        const rows = await checklistRows(url, order._id, STAGES.SEND_SOR_PI);
        assert.equal(rows.length, expected ? 1 : 0, `${user.user} Checklist`);
        assert.equal(await inMyTasks(user, order._id, STAGES.SEND_SOR_PI), expected, `${user.user} My Tasks agrees`);
        if (expected) assert.equal(String(rows[0].doer), String(billing1._id));
      });
    }
  });

  test('a team member completes the team task from the Checklist, and the next stage appears', async () => {
    const billing = await account('Billing');
    const order = await newOrder(await account('Sales'));
    await O2dDocument.create({
      order: order._id, poNumber: order.poNumber, docType: 'PO', stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      storageKey: 'o2d/x/po.pdf', contentType: 'application/pdf', uploadedAt: new Date(),
    });

    await withServer(app(billing), async (url) => {
      const [row] = await checklistRows(url, order._id, STAGES.SUBMIT_PO_TO_BILLING);
      const res = await patch(url, `/api/v1/checklist/tasks/${row._id}/complete`, { evidence: {}, remarks: 'Got it' });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const stage2 = await stageOf(order._id, STAGES.SUBMIT_PO_TO_BILLING);
      assert.ok([STAGE_STATUS.DONE_ON_TIME, STAGE_STATUS.DONE_LATE].includes(stage2.status));
      assert.equal(stage2.remarks, 'Got it', 'the form data is stored on the stage');
      assert.equal(String(res.body.data.doer), String(billing._id));

      const next = await checklistRows(url, order._id, STAGES.SEND_SOR_PI);
      assert.equal(next.length, 1, 'stage 3 is on the same team’s Checklist straight away');
    });
  });

  test('someone outside the team cannot complete it through the Checklist either', async () => {
    const warehouse = await account('Warehouse User');
    const order = await newOrder(await account('Sales'));
    const task = await taskOf(order._id, STAGES.SUBMIT_PO_TO_BILLING);

    await withServer(app(warehouse), async (url) => {
      const res = await patch(url, `/api/v1/checklist/tasks/${task._id}/complete`, { evidence: {} });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'O2D_NOT_YOUR_STAGE');
    });
  });

  test('My Work (mine=true): an admin gets every open O2D task, not other people’s finished ones', async () => {
    const billing = await account('Billing');
    const admin = await account('Admin');
    const order = await newOrder(await account('Sales'));
    const stage2Task = await taskOf(order._id, STAGES.SUBMIT_PO_TO_BILLING);
    await closeStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, actor: billing });
    const stage3Task = await taskOf(order._id, STAGES.SEND_SOR_PI);

    await withServer(app(admin), async (url) => {
      const mine = (await get(url, '/api/v1/checklist/tasks?mine=true&limit=100')).body.data.tasks.map((t) => t._id);
      assert.ok(mine.includes(String(stage3Task._id)), 'the open team task is on the admin’s own queue');
      assert.ok(!mine.includes(String(stage2Task._id)), 'Billing’s finished task is Billing’s, not the admin’s');

      // The manager's full Checklist view is unchanged: every row.
      const all = (await get(url, '/api/v1/checklist/tasks?limit=100')).body.data.tasks.map((t) => t._id);
      assert.ok(all.includes(String(stage2Task._id)) && all.includes(String(stage3Task._id)));
    });
  });

  test('a cover role’s list and tiles do not count other people’s finished work', async () => {
    const billing = await account('Billing');
    const head = await account('Billing Head');
    const order = await newOrder(await account('Sales'));
    await closeStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, actor: billing });
    const stage3Task = await taskOf(order._id, STAGES.SEND_SOR_PI);
    await closeStage({ orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, actor: billing });

    await withServer(app(head), async (url) => {
      const list = (await get(url, '/api/v1/checklist/tasks?limit=100')).body.data.tasks;
      assert.ok(!list.some((t) => t._id === String(stage3Task._id)), 'completed by Billing, so not on Billing Head’s list');
      const summary = (await get(url, '/api/v1/checklist/summary')).body.data;
      assert.equal(summary.completed, 0);
    });
  });

  test('a new team task is new for every team member until each of them looks', async () => {
    const billing1 = await account('Billing');
    const billing2 = await account('Billing');
    const order = await newOrder(await account('Sales'));
    const task = await taskOf(order._id, STAGES.SUBMIT_PO_TO_BILLING);

    await withServer(app(billing1), async (url) => {
      const rows = await checklistRows(url, order._id, STAGES.SUBMIT_PO_TO_BILLING);
      assert.equal(rows[0].isNew, true);
      assert.equal((await get(url, '/api/v1/checklist/tasks/new-count')).body.data.count, 1);
      await post(url, '/api/v1/checklist/seen', {});
      assert.equal((await get(url, '/api/v1/checklist/tasks/new-count')).body.data.count, 0);
    });

    await withServer(app(billing2), async (url) => {
      const rows = await checklistRows(url, order._id, STAGES.SUBMIT_PO_TO_BILLING);
      assert.equal(String(rows[0]._id), String(task._id));
      assert.equal(rows[0].isNew, true, 'Billing 1 looking does not make it old for Billing 2');
    });
  });

  test('the tiles count the team task for the team', async () => {
    const billing = await account('Billing');
    const order = await newOrder(await account('Sales'));

    await withServer(app(billing), async (url) => {
      const list = await get(url, '/api/v1/checklist/tasks?limit=100');
      const summary = await get(url, '/api/v1/checklist/summary');
      assert.ok(list.body.data.tasks.some((t) => String(t.sourceOrderId) === String(order._id)));
      assert.equal(summary.body.data.total, list.body.data.tasks.length, 'the tiles count what the list shows');
    });
  });
});
