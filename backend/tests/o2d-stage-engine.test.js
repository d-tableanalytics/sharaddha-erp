/**
 * The O2D stage engine, against a real database.
 *
 * §50 names the workflow paths this must cover: 01→02→03→04, advance YES and NO,
 * warehouse acknowledgement, invoice, dispatch, close — plus the edge cases that
 * are easy to get wrong and invisible when you do: a skipped stage leaking into
 * KPIs, a hold making somebody look late, an out-of-order completion.
 *
 * Uses mongod, because the guarantees under test are database ones: a unique
 * stage row per order, a partial unique index on the PO, and transitions that
 * must not half-apply.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { O2dOrder, o2dKey } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2D_STAGE_SEED, seedO2dStages } from '../config/seedO2dStages.js';
import {
  createStagesForOrder,
  completeStage,
  skipStage,
  holdOrder,
  resumeOrder,
  O2dWorkflowError,
} from '../modules/o2d/stage.engine.js';
import { onTimePercentage } from '../modules/o2d/sla.service.js';
import { STAGES, STAGE_STATUS, ORDER_STATUS, O2D_EVENTS, O2D_AUDIT_ACTIONS } from '../shared/constants/o2d.js';
import AuditLog from '../models/AuditLog.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);

const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster);
});
after(async () => { await stopTestMongo(); });

beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

/** A fresh order with its twelve stages, stage 1 already complete. */
const makeOrder = async (over = {}, at = ist('2026-09-14', '10:30')) => {
  const order = await O2dOrder.create({
    poNumber: 'PO-001',
    poNumberKey: o2dKey('PO-001'),
    poDate: ist('2026-09-14', '09:00'),
    customerName: 'ABC Industries',
    customerKey: o2dKey('ABC Industries'),
    promiseDate: ist('2026-09-25', '10:00'),
    ...over,
  });
  await createStagesForOrder(order, { actor: actor('Sales'), now: at });
  return O2dOrder.findById(order._id);
};

const stageOf = (orderId, n) => O2dOrderStage.findOne({ order: orderId, stageNumber: n }).lean();

// ===========================================================================

describe('the stage master', () => {
  test('seeds all twelve stages', async () => {
    const all = await O2dStageMaster.find().sort({ stageNumber: 1 }).lean();
    assert.equal(all.length, 12);
    assert.deepEqual(all.map((s) => s.stageNumber), [1,2,3,4,5,6,7,8,9,10,11,12]);
  });

  test('re-seeding never overwrites a tuned SLA', async () => {
    // The failure this guards: a deploy silently reverting an SLA an admin set.
    await O2dStageMaster.updateOne({ stageNumber: 3 }, { $set: { slaValue: 8 } });
    const result = await seedO2dStages();
    assert.equal(result.inserted, 0);
    assert.equal((await O2dStageMaster.findOne({ stageNumber: 3 }).lean()).slaValue, 8);
  });

  test('only stage 5 is skippable', async () => {
    const skippable = O2D_STAGE_SEED.filter((s) => s.skippable).map((s) => s.stageNumber);
    assert.deepEqual(skippable, [STAGES.RECEIVE_ADVANCE]);
  });

  test('stages 2 and 7 record their actual from a DIFFERENT role than the owner', async () => {
    // §5 and §10: the acknowledging party stamps the actual, not the sender.
    const s2 = O2D_STAGE_SEED.find((s) => s.stageNumber === 2);
    const s7 = O2D_STAGE_SEED.find((s) => s.stageNumber === 7);
    assert.equal(s2.ownerRole, 'Sales');
    assert.equal(s2.completedByRole, 'Billing');
    assert.equal(s7.ownerRole, 'Billing');
    assert.equal(s7.completedByRole, 'Warehouse User');
  });
});

describe('creating an order', () => {
  test('creates twelve stages, completes stage 1, unlocks stage 2', async () => {
    const order = await makeOrder();
    const stages = await O2dOrderStage.find({ order: order._id }).sort({ stageNumber: 1 }).lean();

    assert.equal(stages.length, 12);
    assert.equal(stages[0].status, STAGE_STATUS.DONE_ON_TIME);
    assert.equal(stages[1].status, STAGE_STATUS.PENDING);
    assert.equal(stages[2].status, STAGE_STATUS.LOCKED);
    assert.equal(order.currentStage, 2);
  });

  test('stage 2 is given its 5-minute deadline at unlock', async () => {
    const order = await makeOrder({}, ist('2026-09-14', '11:00'));
    const s2 = await stageOf(order._id, 2);
    assert.equal(new Date(s2.plannedCompletion).toISOString(), ist('2026-09-14', '11:05').toISOString());
  });

  test('each stage freezes a COPY of the SLA, so a later master edit cannot re-judge it', async () => {
    const order = await makeOrder();
    await O2dStageMaster.updateOne({ stageNumber: 3 }, { $set: { slaValue: 99 } });
    const s3 = await stageOf(order._id, 3);
    assert.equal(s3.sla.value, 3, 'the row keeps the rule it was created with');
  });

  test('a duplicate PO for the same customer is refused by the database', async () => {
    await makeOrder();
    await assert.rejects(
      () => makeOrder(),
      (e) => e.code === 11000,
      'the partial unique index must refuse a live duplicate',
    );
  });

  test('the same PO number for a DIFFERENT customer is allowed', async () => {
    await makeOrder();
    const other = await makeOrder({ customerName: 'XYZ Traders', customerKey: o2dKey('XYZ Traders') });
    assert.ok(other._id);
  });
});

describe('walking the happy path', () => {
  test('02 → 03 → 04, each unlocking the next', async () => {
    const order = await makeOrder();

    await completeStage({ orderId: order._id, stageNumber: 2, actor: actor('Billing'), now: ist('2026-09-14', '10:33') });
    assert.equal((await stageOf(order._id, 2)).status, STAGE_STATUS.DONE_ON_TIME);
    assert.equal((await stageOf(order._id, 3)).status, STAGE_STATUS.PENDING);

    await completeStage({ orderId: order._id, stageNumber: 3, actor: actor('Billing'), now: ist('2026-09-14', '12:00') });
    assert.equal((await stageOf(order._id, 4)).status, STAGE_STATUS.PENDING);
    assert.equal((await O2dOrder.findById(order._id)).currentStage, 4);
  });

  test('a late completion is DONE_LATE with the delay in working minutes', async () => {
    const order = await makeOrder();
    // Stage 2 due 10:35; completed 10:38.
    await completeStage({ orderId: order._id, stageNumber: 2, actor: actor('Billing'), now: ist('2026-09-14', '10:38') });
    const s2 = await stageOf(order._id, 2);
    assert.equal(s2.status, STAGE_STATUS.DONE_LATE);
    assert.equal(s2.delayMinutes, 3, 'the §16 worked example');
  });

  test('the overnight gap is not counted as delay', async () => {
    const order = await makeOrder();
    // Due 10:35 Monday; completed 10:40 Tuesday. Wall clock ~24h; working
    // minutes are 7h55 Monday + 10 Tuesday.
    await completeStage({ orderId: order._id, stageNumber: 2, actor: actor('Billing'), now: ist('2026-09-15', '10:40') });
    const s2 = await stageOf(order._id, 2);
    assert.equal(s2.delayMinutes, 475 + 10);
  });

  test('completing stage 9 stamps the dispatch moment on the order', async () => {
    const order = await makeOrder();
    for (const n of [2, 3, 4]) {
      await completeStage({ orderId: order._id, stageNumber: n, actor: actor('Billing'), now: ist('2026-09-14', '11:00') });
    }
    await skipStage({ orderId: order._id, stageNumber: 5, reason: 'Not an advance order', actor: actor('Billing'), now: ist('2026-09-14', '11:00') });
    for (const n of [6, 7, 8]) {
      await completeStage({ orderId: order._id, stageNumber: n, actor: actor('Billing'), now: ist('2026-09-14', '12:00') });
    }
    const { events } = await completeStage({
      orderId: order._id, stageNumber: 9, actor: actor('Warehouse User'), now: ist('2026-09-14', '16:00'),
    });

    const fresh = await O2dOrder.findById(order._id);
    assert.equal(fresh.dispatchedAt.toISOString(), ist('2026-09-14', '16:00').toISOString());
    assert.ok(events.some((e) => e.type === O2D_EVENTS.DISPATCH_COMPLETED));
  });

  test('completing stage 12 closes the order', async () => {
    const order = await makeOrder();
    for (const n of [2, 3, 4]) {
      await completeStage({ orderId: order._id, stageNumber: n, actor: actor('Billing'), now: ist('2026-09-14', '11:00') });
    }
    await skipStage({ orderId: order._id, stageNumber: 5, reason: 'No advance', actor: actor('Billing'), now: ist('2026-09-14', '11:00') });
    for (const n of [6, 7, 8, 9, 10, 11, 12]) {
      await completeStage({ orderId: order._id, stageNumber: n, actor: actor('Billing'), now: ist('2026-09-15', '12:00') });
    }
    const fresh = await O2dOrder.findById(order._id);
    assert.equal(fresh.status, ORDER_STATUS.CLOSED);
    assert.ok(fresh.closedAt);
  });

  test('the invoice number from stage 8 reaches the order header', async () => {
    const order = await makeOrder();
    for (const n of [2, 3, 4]) {
      await completeStage({ orderId: order._id, stageNumber: n, actor: actor('Billing'), now: ist('2026-09-14', '11:00') });
    }
    await skipStage({ orderId: order._id, stageNumber: 5, reason: 'No advance', actor: actor('Billing'), now: ist('2026-09-14', '11:00') });
    for (const n of [6, 7]) {
      await completeStage({ orderId: order._id, stageNumber: n, actor: actor('Billing'), now: ist('2026-09-14', '12:00') });
    }
    const { events } = await completeStage({
      orderId: order._id, stageNumber: 8, actor: actor('Billing'), now: ist('2026-09-14', '13:00'),
      evidence: { invoiceNumber: 'INV-9001' },
    });
    assert.equal((await O2dOrder.findById(order._id)).invoiceNumber, 'INV-9001');
    assert.ok(events.some((e) => e.type === O2D_EVENTS.INVOICE_CREATED));
  });
});

describe('the advance decision', () => {
  /*
   * Walk to stage 5 with every stage ON TIME.
   *
   * The timings matter: stage 2 has a five-minute SLA from 10:30, so completing
   * it at 11:00 would make it genuinely late and muddy the on-time assertion
   * below — which is about whether a SKIP dilutes the score, not about whether
   * a late stage does.
   */
  const toStage5 = async (order) => {
    await completeStage({ orderId: order._id, stageNumber: 2, actor: actor('Billing'), now: ist('2026-09-14', '10:33') });
    await completeStage({ orderId: order._id, stageNumber: 3, actor: actor('Billing'), now: ist('2026-09-14', '12:00') });
    await completeStage({ orderId: order._id, stageNumber: 4, actor: actor('Billing'), now: ist('2026-09-14', '12:30') });
  };

  test('ADVANCE NO — stage 5 is SKIPPED and stage 6 opens immediately', async () => {
    const order = await makeOrder();
    await toStage5(order);
    const { events } = await skipStage({
      orderId: order._id, stageNumber: 5, reason: 'Not an advance order', actor: actor('Billing'), now: ist('2026-09-14', '11:05'),
    });

    const s5 = await stageOf(order._id, 5);
    assert.equal(s5.status, STAGE_STATUS.SKIPPED);
    assert.equal(s5.skipReason, 'Not an advance order');
    assert.equal(s5.actualCompletion, null, 'a skipped stage was never completed');
    assert.equal(s5.delayMinutes, null, 'and carries no delay');
    assert.equal((await stageOf(order._id, 6)).status, STAGE_STATUS.PENDING);
    assert.ok(events.some((e) => e.type === O2D_EVENTS.STAGE_SKIPPED));
  });

  test('ADVANCE YES — stage 5 stays open with a 7-CALENDAR-day window', async () => {
    const order = await makeOrder();
    await toStage5(order);
    const s5 = await stageOf(order._id, 5);
    assert.equal(s5.status, STAGE_STATUS.PENDING);
    assert.equal(s5.sla.type, 'CALENDAR_DAYS');
    assert.equal(s5.sla.value, 7);
    assert.equal((await stageOf(order._id, 6)).status, STAGE_STATUS.LOCKED);
  });

  test('a SKIPPED stage is excluded from on-time percentage', async () => {
    const order = await makeOrder();
    await toStage5(order);
    await skipStage({ orderId: order._id, stageNumber: 5, reason: 'No advance', actor: actor('Billing'), now: ist('2026-09-14', '12:35') });

    const stages = await O2dOrderStage.find({ order: order._id }).lean();
    const completed = stages.filter((s) => s.status.startsWith('DONE'));
    // Four completed (1,2,3,4), all on time, plus one skipped that must not
    // count either way.
    assert.equal(completed.length, 4);
    assert.equal(onTimePercentage(stages), 100, 'the skip must not dilute the score');
  });

  test('a required stage cannot be skipped', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => skipStage({ orderId: order._id, stageNumber: 2, reason: 'cannot be bothered', actor: actor('Billing') }),
      (e) => e instanceof O2dWorkflowError && /cannot be skipped/.test(e.message),
    );
  });

  test('skipping without a reason is refused', async () => {
    const order = await makeOrder();
    await toStage5(order);
    await assert.rejects(
      () => skipStage({ orderId: order._id, stageNumber: 5, reason: '   ', actor: actor('Billing') }),
      (e) => /needs a reason/.test(e.message),
    );
  });
});

describe('stage order is enforced', () => {
  test('stage 8 cannot be completed while stage 7 is open, and says so in English', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => completeStage({ orderId: order._id, stageNumber: 8, actor: actor('Billing') }),
      (e) => {
        assert.ok(e instanceof O2dWorkflowError);
        // §44: "Stage 08 cannot be completed because Warehouse has not
        // acknowledged Stage 07" — not `stage_transition_invalid`.
        assert.match(e.message, /cannot be completed because/);
        assert.match(e.message, /Submit PO to Billing|stage 2/i);
        return true;
      },
    );
  });

  test('an override completes it, but demands a reason and is recorded', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => completeStage({ orderId: order._id, stageNumber: 8, actor: actor('Billing Head'), override: true }),
      (e) => /needs a reason/.test(e.message),
    );

    await completeStage({
      orderId: order._id, stageNumber: 8, actor: actor('Billing Head'),
      override: true, overrideReason: 'Customer collecting in person; MD approved',
      now: ist('2026-09-14', '12:00'),
    });
    const s8 = await stageOf(order._id, 8);
    assert.equal(s8.overridden, true);
    assert.match(s8.overrideReason, /MD approved/);
  });

  test('a completed stage cannot be completed twice', async () => {
    const order = await makeOrder();
    await completeStage({ orderId: order._id, stageNumber: 2, actor: actor('Billing'), now: ist('2026-09-14', '10:33') });
    await assert.rejects(
      () => completeStage({ orderId: order._id, stageNumber: 2, actor: actor('Billing') }),
      (e) => /already complete/.test(e.message),
    );
  });

  test('a future completion timestamp is refused', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => completeStage({
        orderId: order._id, stageNumber: 2, actor: actor('Billing'),
        actualCompletion: ist('2027-01-01', '10:00'), now: ist('2026-09-14', '11:00'),
      }),
      (e) => /cannot be completed in the future/.test(e.message),
    );
  });

  test('a back-fill records BOTH when it happened and when it was entered', async () => {
    // §33: those are different facts and one timestamp cannot carry both.
    const order = await makeOrder();
    await completeStage({
      orderId: order._id, stageNumber: 2, actor: actor('Billing'),
      actualCompletion: ist('2026-09-14', '10:34'),   // the work
      now: ist('2026-09-14', '15:00'),                // the entry
    });
    const s2 = await stageOf(order._id, 2);
    assert.equal(s2.actualCompletion.toISOString(), ist('2026-09-14', '10:34').toISOString());
    assert.equal(s2.recordedAt.toISOString(), ist('2026-09-14', '15:00').toISOString());
    assert.equal(s2.status, STAGE_STATUS.DONE_ON_TIME, 'judged on when the work happened');
  });
});

describe('hold and resume', () => {
  test('a hold pauses the open stage and blocks completion', async () => {
    const order = await makeOrder();
    await holdOrder({ orderId: order._id, reason: 'CUSTOMER_REQUEST', note: 'Do not dispatch yet', actor: actor('Sales'), now: ist('2026-09-14', '11:00') });

    const fresh = await O2dOrder.findById(order._id);
    assert.equal(fresh.status, ORDER_STATUS.ON_HOLD);
    assert.equal((await stageOf(order._id, 2)).status, STAGE_STATUS.ON_HOLD);

    await assert.rejects(
      () => completeStage({ orderId: order._id, stageNumber: 2, actor: actor('Billing') }),
      (e) => /on hold/.test(e.message),
    );
  });

  test('a hold needs a reason', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => holdOrder({ orderId: order._id, reason: null, actor: actor('Sales') }),
      (e) => /needs a reason/.test(e.message),
    );
  });

  test('resuming gives back exactly the frozen working time', async () => {
    const order = await makeOrder({}, ist('2026-09-14', '11:00'));
    const before = await stageOf(order._id, 2);     // due 11:05

    await holdOrder({ orderId: order._id, reason: 'STOCK_UNAVAILABLE', actor: actor('Sales'), now: ist('2026-09-14', '11:01') });
    await resumeOrder({ orderId: order._id, actor: actor('Sales'), now: ist('2026-09-14', '13:01') });

    const after = await stageOf(order._id, 2);
    const moved = (new Date(after.plannedCompletion) - new Date(before.plannedCompletion)) / 60000;
    assert.equal(moved, 120, 'two held hours must push the deadline two hours');
    assert.equal(after.status, STAGE_STATUS.PENDING);

    const fresh = await O2dOrder.findById(order._id);
    assert.equal(fresh.holds[0].heldWorkingMinutes, 120);
  });

  test('a hold over a weekend freezes only the open hours', async () => {
    const order = await makeOrder({}, ist('2026-09-18', '17:00')); // Friday
    await holdOrder({ orderId: order._id, reason: 'CUSTOMER_REQUEST', actor: actor('Sales'), now: ist('2026-09-18', '18:00') });
    await resumeOrder({ orderId: order._id, actor: actor('Sales'), now: ist('2026-09-21', '11:00') }); // Monday

    const fresh = await O2dOrder.findById(order._id);
    // 30 min Friday + 480 Saturday + 30 Monday. Sunday contributes nothing.
    assert.equal(fresh.holds[0].heldWorkingMinutes, 540);
  });

  test('the full hold history is kept, not overwritten', async () => {
    const order = await makeOrder({}, ist('2026-09-14', '11:00'));
    await holdOrder({ orderId: order._id, reason: 'STOCK_UNAVAILABLE', actor: actor('Sales'), now: ist('2026-09-14', '11:10') });
    await resumeOrder({ orderId: order._id, actor: actor('Sales'), now: ist('2026-09-14', '11:40') });
    await holdOrder({ orderId: order._id, reason: 'CUSTOMER_REQUEST', actor: actor('Sales'), now: ist('2026-09-14', '12:00') });
    await resumeOrder({ orderId: order._id, actor: actor('Sales'), now: ist('2026-09-14', '12:30') });

    const fresh = await O2dOrder.findById(order._id);
    assert.equal(fresh.holds.length, 2);
    assert.deepEqual(fresh.holds.map((h) => h.reason), ['STOCK_UNAVAILABLE', 'CUSTOMER_REQUEST']);
    assert.deepEqual(fresh.holds.map((h) => h.heldWorkingMinutes), [30, 30]);
  });

  test('stock holds are distinguishable from customer holds', async () => {
    // §25: the dashboard must be able to tell "we are slow" from "they asked us
    // to wait", so the two cannot be merged into one reason.
    const order = await makeOrder();
    await holdOrder({ orderId: order._id, reason: 'STOCK_UNAVAILABLE', actor: actor('Sales'), now: ist('2026-09-14', '11:00') });
    const fresh = await O2dOrder.findById(order._id);
    assert.equal(fresh.holds[0].reason, 'STOCK_UNAVAILABLE');
    assert.equal(fresh.holds[0].stageNumber, 2, 'and where it was when it stopped');
  });

  test('resuming an order that is not on hold is refused', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => resumeOrder({ orderId: order._id, actor: actor('Sales') }),
      (e) => /not on hold/.test(e.message),
    );
  });
});

// ---------------------------------------------------------------------------
// The audit trail (§34)
// ---------------------------------------------------------------------------
//
// These matter more than they look. `recordAudit` deliberately swallows its own
// failures so a broken log cannot roll back a dispatch that physically
// happened — which means a mis-wired call writes NOTHING and every other test
// still passes. The only way a gap in the trail is ever noticed is if something
// asserts the rows exist.

describe('the audit trail', () => {
  const trail = (action) => AuditLog.find(action ? { action } : {}).sort({ createdAt: 1 }).lean();

  test('a completion is recorded with who, when and the status it moved from', async () => {
    const order = await makeOrder();
    await completeStage({
      orderId: order._id,
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'),
      now: ist('2026-09-14', '10:33'),
    });

    const rows = await trail(O2D_AUDIT_ACTIONS.STAGE_COMPLETED);
    // Stage 1 is completed by createStagesForOrder, so there are two.
    assert.equal(rows.length, 2);

    const row = rows.at(-1);
    assert.match(row.remarks, /Submit PO to Billing completed on PO-001/);
    assert.equal(row.meta.stageNumber, STAGES.SUBMIT_PO_TO_BILLING);
    assert.equal(row.meta.from, STAGE_STATUS.PENDING);
    assert.equal(row.meta.to, STAGE_STATUS.DONE_ON_TIME);
    assert.equal(row.meta.poNumber, 'PO-001');
    assert.equal(row.meta.overridden, false);
    assert.equal(row.meta.backFilled, false);
  });

  test('a late completion carries the delay, so the trail explains the KPI', async () => {
    const order = await makeOrder();
    // 5 working-minute SLA from 10:30; completing at 11:30 is an hour late.
    await completeStage({
      orderId: order._id,
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'),
      now: ist('2026-09-14', '11:30'),
    });

    const row = (await trail(O2D_AUDIT_ACTIONS.STAGE_COMPLETED)).at(-1);
    assert.equal(row.meta.to, STAGE_STATUS.DONE_LATE);
    assert.equal(row.meta.delayMinutes, 55);
  });

  test('a back-filled completion is distinguishable from one recorded live', async () => {
    const order = await makeOrder();
    await completeStage({
      orderId: order._id,
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'),
      actualCompletion: ist('2026-09-14', '10:33'),
      now: ist('2026-09-15', '09:00'),
    });

    const row = (await trail(O2D_AUDIT_ACTIONS.STAGE_COMPLETED)).at(-1);
    assert.equal(row.meta.backFilled, true);
    assert.notEqual(
      new Date(row.meta.actualCompletion).getTime(),
      new Date(row.meta.recordedAt).getTime(),
    );
  });

  test('an override is its own action, and the reason is in the trail', async () => {
    const order = await makeOrder();
    await completeStage({
      orderId: order._id,
      stageNumber: STAGES.SEND_SOR_PI,
      actor: actor('Billing Head'),
      now: ist('2026-09-14', '11:00'),
      override: true,
      overrideReason: 'PI already emailed by the branch before the portal went live',
    });

    // Filed under STAGE_OVERRIDDEN, not STAGE_COMPLETED — so "show me every
    // out-of-order completion" is one query rather than a scan with a filter.
    const rows = await trail(O2D_AUDIT_ACTIONS.STAGE_OVERRIDDEN);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].meta.overridden, true);
    assert.match(rows[0].meta.overrideReason, /already emailed by the branch/);
    // The stage it jumped was still LOCKED — the assumption worth not making.
    assert.equal(rows[0].meta.from, STAGE_STATUS.LOCKED);
    assert.match(rows[0].remarks, /OUT OF ORDER/);
  });

  test('a skip records why, and that it leaves the KPI', async () => {
    const order = await makeOrder();
    await completeStage({ orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING, actor: actor('Billing'), now: ist('2026-09-14', '10:33') });
    await completeStage({ orderId: order._id, stageNumber: STAGES.SEND_SOR_PI, actor: actor('Billing'), now: ist('2026-09-14', '11:00') });
    await completeStage({ orderId: order._id, stageNumber: STAGES.ADVANCE_DECISION, actor: actor('Billing'), now: ist('2026-09-14', '11:30') });
    await skipStage({
      orderId: order._id,
      stageNumber: STAGES.RECEIVE_ADVANCE,
      actor: actor('Billing'),
      reason: 'Not an advance order — credit customer',
      now: ist('2026-09-14', '11:35'),
    });

    const rows = await trail(O2D_AUDIT_ACTIONS.STAGE_SKIPPED);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].meta.to, STAGE_STATUS.SKIPPED);
    assert.equal(rows[0].meta.excludedFromKpi, true);
    assert.match(rows[0].meta.reason, /Not an advance order/);
  });

  test('hold and resume are both recorded, with the frozen minutes', async () => {
    const order = await makeOrder();
    await holdOrder({
      orderId: order._id,
      actor: actor('Management'),
      reason: 'STOCK_UNAVAILABLE',
      note: 'Awaiting import clearance',
      now: ist('2026-09-14', '11:00'),
    });
    await resumeOrder({ orderId: order._id, actor: actor('Management'), now: ist('2026-09-14', '15:00') });

    const held = await trail(O2D_AUDIT_ACTIONS.ORDER_HELD);
    assert.equal(held.length, 1);
    assert.equal(held[0].meta.from, ORDER_STATUS.OPEN);
    assert.equal(held[0].meta.to, ORDER_STATUS.ON_HOLD);
    assert.match(held[0].remarks, /STOCK_UNAVAILABLE: Awaiting import clearance/);

    const resumed = await trail(O2D_AUDIT_ACTIONS.ORDER_RESUMED);
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0].meta.to, ORDER_STATUS.OPEN);
    // 11:00 to 15:00 inside a 10:30-18:30 day is four working hours.
    assert.equal(resumed[0].meta.heldWorkingMinutes, 240);
    // Every deadline the hold moved, so the extension is reviewable.
    assert.ok(resumed[0].meta.deadlinesExtended.includes(STAGES.SUBMIT_PO_TO_BILLING));
  });

  test('a refused transition writes nothing', async () => {
    const order = await makeOrder();
    await assert.rejects(
      () => completeStage({
        orderId: order._id,
        stageNumber: STAGES.SEND_SOR_PI,
        actor: actor('Billing'),
        now: ist('2026-09-14', '11:00'),
      }),
      O2dWorkflowError,
    );

    // Only stage 1's row, from order creation. A rejected attempt is not a
    // transition, and logging it as one would make the trail lie.
    const rows = await trail(O2D_AUDIT_ACTIONS.STAGE_COMPLETED);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].meta.stageNumber, STAGES.RECEIVE_ORDER);
  });
});
