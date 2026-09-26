/**
 * Sending a completed O2D stage back for rework.
 *
 * The guarantees: the stage becomes the one active task again, the stages that
 * depend on it stop being actionable, the previous completion survives in the
 * history and audit trail, and the assignee gets a live task back.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import User from '../models/User.js';
import { O2dOrder, o2dKey } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dStageEvent } from '../models/o2d/O2dStageEvent.js';
import { Delegation } from '../models/Delegation.js';
import { ChecklistRoutine, ChecklistOccurrence } from '../models/Checklist.js';
import AuditLog from '../models/AuditLog.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import {
  createStagesForOrder, skipStage, holdOrder, reopenStage, O2dWorkflowError,
} from '../modules/o2d/stage.engine.js';
import { assignStageToUser } from '../modules/o2d/o2dDelegationSync.service.js';
import { mirrorRefOf } from '../modules/o2d/stageMirror.service.js';
import { closeStage } from './helpers/o2dStage.js';
import {
  STAGES, STAGE_STATUS, ORDER_STATUS, O2D_EVENTS, O2D_AUDIT_ACTIONS,
} from '../shared/constants/o2d.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

before(async () => {
  await startTestMongo();
  await syncIndexes(
    O2dOrder, O2dOrderStage, O2dStageMaster, Delegation, ChecklistRoutine, ChecklistOccurrence, User,
  );
});
after(async () => { await stopTestMongo(); });

beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

const makeOrder = async () => {
  const order = await O2dOrder.create({
    poNumber: 'PO-RW-1',
    poNumberKey: o2dKey('PO-RW-1'),
    poDate: ist('2026-09-14', '09:00'),
    customerName: 'ABC Industries',
    customerKey: o2dKey('ABC Industries'),
    promiseDate: ist('2026-09-25', '10:00'),
  });
  await createStagesForOrder(order, { actor: actor('Sales'), now: ist('2026-09-14', '10:30') });
  return O2dOrder.findById(order._id);
};

const stageOf = (orderId, n) => O2dOrderStage.findOne({ order: orderId, stageNumber: n }).lean();

/** Order with stages 2 and 3 done, so stage 4 is the active one. */
const orderAtStage4 = async () => {
  const order = await makeOrder();
  await closeStage({ orderId: order._id, stageNumber: 2, actor: actor('Billing'), now: ist('2026-09-14', '10:33') });
  await closeStage({ orderId: order._id, stageNumber: 3, actor: actor('Billing'), now: ist('2026-09-14', '12:00') });
  return O2dOrder.findById(order._id);
};

const manager = actor('Management');

describe('reopening a stage', () => {
  test('makes it the active stage again and locks the open stage behind it', async () => {
    const order = await orderAtStage4();
    const now = ist('2026-09-14', '13:00');

    const { stage, order: after, events } = await reopenStage({
      orderId: order._id, stageNumber: 2, reason: 'Wrong PO copy attached', actor: manager, now,
    });

    assert.equal(stage.status, STAGE_STATUS.PENDING);
    assert.equal(stage.actualCompletion, null);
    assert.equal(stage.completedByName, null);
    assert.equal(stage.reopenCount, 1);
    assert.equal(stage.lastReopenReason, 'Wrong PO copy attached');
    assert.equal(new Date(stage.plannedStart).toISOString(), now.toISOString());
    assert.ok(stage.plannedCompletion, 'a fresh deadline is computed');

    assert.equal((await stageOf(order._id, 3)).status, STAGE_STATUS.DONE_ON_TIME, 'completed work is kept by default');
    assert.equal((await stageOf(order._id, 4)).status, STAGE_STATUS.LOCKED, 'the dependent open stage is locked');
    assert.equal(after.currentStage, 2);
    assert.equal(events[0].type, O2D_EVENTS.STAGE_REOPENED);
  });

  test('re-completing it resumes the sequence at the next unfinished stage', async () => {
    const order = await orderAtStage4();
    await reopenStage({ orderId: order._id, stageNumber: 2, reason: 'Redo', actor: manager, now: ist('2026-09-14', '13:00') });

    const { order: after } = await closeStage({
      orderId: order._id, stageNumber: 2, actor: actor('Billing'), now: ist('2026-09-14', '13:02'),
    });

    assert.equal((await stageOf(order._id, 2)).status, STAGE_STATUS.DONE_ON_TIME);
    assert.equal((await stageOf(order._id, 4)).status, STAGE_STATUS.PENDING, 'skips past the kept stage 3');
    assert.equal(after.currentStage, 4);
  });

  test('resetDownstream sends every later completed stage back to LOCKED', async () => {
    const order = await orderAtStage4();
    await reopenStage({
      orderId: order._id, stageNumber: 2, reason: 'Start over', resetDownstream: true, actor: manager,
      now: ist('2026-09-14', '13:00'),
    });

    const s3 = await stageOf(order._id, 3);
    assert.equal(s3.status, STAGE_STATUS.LOCKED);
    assert.equal(s3.actualCompletion, null);
    assert.equal(s3.reopenCount, 1);

    await closeStage({ orderId: order._id, stageNumber: 2, actor: actor('Billing'), now: ist('2026-09-14', '13:02') });
    assert.equal((await stageOf(order._id, 3)).status, STAGE_STATUS.PENDING, 'stage 3 is next in line again');
  });

  test('keeps the previous completion in the stage history and audit log', async () => {
    const order = await orderAtStage4();
    const before = await stageOf(order._id, 2);

    await reopenStage({ orderId: order._id, stageNumber: 2, reason: 'Wrong PO', actor: manager, now: ist('2026-09-14', '13:00') });

    const event = await O2dStageEvent.findOne({
      order: order._id, stageNumber: 2, from: STAGE_STATUS.DONE_ON_TIME, to: STAGE_STATUS.PENDING,
    }).lean();
    assert.ok(event, 'the reopen transition is recorded');
    assert.equal(event.meta.reopened, true);
    assert.equal(
      new Date(event.meta.previous.actualCompletion).toISOString(),
      new Date(before.actualCompletion).toISOString(),
    );
    assert.equal(event.meta.previous.completedByName, before.completedByName);

    // The original completion event is still there, untouched.
    assert.ok(await O2dStageEvent.exists({ order: order._id, stageNumber: 2, to: STAGE_STATUS.DONE_ON_TIME }));

    const audit = await AuditLog.findOne({ action: O2D_AUDIT_ACTIONS.STAGE_REOPENED }).lean();
    assert.ok(audit);
    assert.equal(audit.meta.reason, 'Wrong PO');
    assert.equal(audit.meta.from, STAGE_STATUS.DONE_ON_TIME);
  });

  test('each completion keeps its own form data in the history, across a rework', async () => {
    const order = await orderAtStage4();
    await reopenStage({ orderId: order._id, stageNumber: 3, reason: 'Wrong PI', actor: manager, now: ist('2026-09-14', '13:00') });
    await closeStage({
      orderId: order._id, stageNumber: 3, actor: actor('Billing'), now: ist('2026-09-14', '13:05'),
      evidence: { piNumber: 'PI-2' }, remarks: 'Corrected PI',
    });

    const closes = await O2dStageEvent.find({
      order: order._id, stageNumber: 3, to: { $in: [STAGE_STATUS.DONE_ON_TIME, STAGE_STATUS.DONE_LATE] },
    }).sort({ at: 1 }).lean();
    assert.equal(closes.length, 2);
    assert.equal(closes[0].meta.evidence.piNumber, 'TEST-piNumber', 'the first close is not overwritten');
    assert.equal(closes[1].meta.evidence.piNumber, 'PI-2');
    assert.equal(closes[1].meta.remarks, 'Corrected PI');

    const row = await stageOf(order._id, 3);
    assert.equal(row.evidence.piNumber, 'PI-2');
    assert.equal(row.remarks, 'Corrected PI');
  });

  test('reopening stage 4 always resets stage 5, which it decided', async () => {
    const order = await orderAtStage4();
    await closeStage({ orderId: order._id, stageNumber: 4, actor: actor('Billing'), now: ist('2026-09-14', '12:10') });
    await skipStage({ orderId: order._id, stageNumber: 5, reason: 'No advance', actor: actor('Billing'), now: ist('2026-09-14', '12:11') });

    await reopenStage({ orderId: order._id, stageNumber: 4, reason: 'Customer now pays advance', actor: manager, now: ist('2026-09-14', '13:00') });

    const s5 = await stageOf(order._id, 5);
    assert.equal(s5.status, STAGE_STATUS.LOCKED);
    assert.equal(s5.skipReason, null);
    assert.equal((await stageOf(order._id, 6)).status, STAGE_STATUS.LOCKED);
  });

  test('reopening a stage on a closed order reopens the order, and finishing closes it again', async () => {
    const order = await makeOrder();
    let t = ist('2026-09-14', '10:31');
    const tick = () => { t = new Date(t.getTime() + 60_000); return t; };
    for (let n = 2; n <= 12; n += 1) {
      if (n === STAGES.RECEIVE_ADVANCE) {
        await skipStage({ orderId: order._id, stageNumber: n, reason: 'No advance', actor: actor('Billing'), now: tick() });
      } else {
        await closeStage({ orderId: order._id, stageNumber: n, actor: actor('Billing'), now: tick() });
      }
    }
    assert.equal((await O2dOrder.findById(order._id)).status, ORDER_STATUS.CLOSED);

    const { order: reopened } = await reopenStage({
      orderId: order._id, stageNumber: 11, reason: 'Dispatch details were wrong', actor: manager, now: tick(),
    });
    assert.equal(reopened.status, ORDER_STATUS.OPEN);
    assert.equal(reopened.closedAt, null);
    assert.equal(reopened.currentStage, 11);
    assert.ok(await AuditLog.exists({ action: O2D_AUDIT_ACTIONS.ORDER_REOPENED }));

    const { order: closed } = await closeStage({ orderId: order._id, stageNumber: 11, actor: actor('Billing'), now: tick() });
    assert.equal(closed.status, ORDER_STATUS.CLOSED);
  });

  test('gives the assigned person a new live task, leaving the old one completed', async () => {
    const order = await orderAtStage4();
    const person = (email, name, role) => User.create({
      email, password: 'x'.repeat(12), user: name, role, status: 'Active',
    });
    const assignee = await person('rw@example.com', 'Rework Person', 'Billing');
    const lead = await person('lead@example.com', 'Billing Lead', 'Billing');
    const boss = await person('boss@example.com', 'The Manager', 'Management');

    // Stage 4 routes to Delegation (no required fields); assign it, then finish it.
    await assignStageToUser({ orderId: order._id, stageNumber: 4, userId: assignee._id, actor: lead });
    await closeStage({ orderId: order._id, stageNumber: 4, actor: assignee, now: ist('2026-09-14', '12:10') });
    const oldRef = mirrorRefOf(await stageOf(order._id, 4));

    await reopenStage({ orderId: order._id, stageNumber: 4, reason: 'Redo', actor: boss, now: ist('2026-09-14', '13:00') });

    const s4 = await stageOf(order._id, 4);
    const newRef = mirrorRefOf(s4);
    assert.ok(newRef.id, 'a new mirror exists');
    assert.notEqual(String(newRef.id), String(oldRef.id));
    assert.equal(String(s4.assignedTo), String(assignee._id), 'still assigned to the same person');

    const fresh = await Delegation.findById(newRef.id).lean();
    assert.equal(fresh.status, 'Pending');
    assert.equal(String(fresh.doerId), String(assignee._id));
    const old = await Delegation.findById(oldRef.id).lean();
    assert.equal(old.status, 'Completed', 'the earned completion is not erased');
    assert.equal(old.sourceStageId, null);
  });
});

describe('refusing a reopen', () => {
  const refused = (code) => (e) => e instanceof O2dWorkflowError && e.code === code;

  test('stage 1', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => reopenStage({ orderId: order._id, stageNumber: 1, reason: 'x', actor: manager }),
      refused('O2D_STAGE_NOT_REOPENABLE'),
    );
  });

  test('a stage that is not complete', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => reopenStage({ orderId: order._id, stageNumber: 2, reason: 'x', actor: manager }),
      refused('O2D_STAGE_NOT_DONE'),
    );
  });

  test('without a reason', async () => {
    const order = await orderAtStage4();
    await assert.rejects(
      () => reopenStage({ orderId: order._id, stageNumber: 2, reason: '  ', actor: manager }),
      refused('O2D_REOPEN_REASON_REQUIRED'),
    );
  });

  test('a skipped stage directly', async () => {
    const order = await orderAtStage4();
    await closeStage({ orderId: order._id, stageNumber: 4, actor: actor('Billing'), now: ist('2026-09-14', '12:10') });
    await skipStage({ orderId: order._id, stageNumber: 5, reason: 'No advance', actor: actor('Billing'), now: ist('2026-09-14', '12:11') });
    await assert.rejects(
      () => reopenStage({ orderId: order._id, stageNumber: 5, reason: 'x', actor: manager }),
      refused('O2D_STAGE_SKIPPED'),
    );
  });

  test('on an order that is on hold', async () => {
    const order = await orderAtStage4();
    await holdOrder({ orderId: order._id, reason: 'CUSTOMER_REQUEST', actor: manager, now: ist('2026-09-14', '12:30') });
    await assert.rejects(
      () => reopenStage({ orderId: order._id, stageNumber: 2, reason: 'x', actor: manager }),
      refused('O2D_ORDER_ON_HOLD'),
    );
  });
});
