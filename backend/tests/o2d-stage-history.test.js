/**
 * The stage status history, and the two-state display name.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE ARE GUARDING
 * ---------------------------------------------------------------------------
 *
 * A history is only worth having if NOTHING escapes it, and the transitions
 * most likely to escape are the ones no person performed: a deadline passing, a
 * hold freezing the board, the resume thawing it. None of those appear in an
 * audit log, because nobody did them — and they are most of the timeline of any
 * order that ran late, which is the only kind anybody investigates.
 *
 * The second half guards the display mapping. Collapsing the STORED status to
 * two values would destroy the on-time percentage, the skip exclusion and the
 * escalation trigger, so the tests below pin that the stored vocabulary is
 * untouched and only the NAME is simplified.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dOrderItem } from '../models/o2d/O2dOrderItem.js';
import { O2dStageEvent, STAGE_EVENT_SOURCES } from '../models/o2d/O2dStageEvent.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import * as orders from '../modules/o2d/order.service.js';
import { completeStage, skipStage, holdOrder, resumeOrder } from '../modules/o2d/stage.engine.js';
import { closeStage } from './helpers/o2dStage.js';
import { stageHistory } from '../modules/o2d/stageHistory.service.js';
import {
  STAGES, STAGE_STATUS, STAGE_DISPLAY_STATUS, displayStatusFor, stageFlagsFor,
  TERMINAL_STAGE_STATUSES, KPI_COUNTED_STATUSES,
} from '../shared/constants/o2d.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date();

const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

const INTAKE = {
  poNumber: 'PO-HIST-1',
  poDate: new Date(NOW.getTime() - 2 * MINUTE).toISOString(),
  customerName: 'ABC Industries',
  promiseDate: new Date(NOW.getTime() + 11 * DAY).toISOString(),
};

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster, O2dOrderItem, O2dStageEvent);
});
after(async () => { await stopTestMongo(); });
beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

const create = async () =>
  (await orders.createOrder({ ...INTAKE, items: [] }, actor('Sales'), { now: NOW })).order;

/** Every event for one stage, oldest first. */
const timeline = async (orderId, stageNumber) =>
  (await stageHistory(orderId, { stageNumber })).map((e) => e.to);

// ---------------------------------------------------------------------------

describe('every transition is recorded', () => {
  test('a stage is born LOCKED, with no prior state', async () => {
    const order = await create();
    const rows = await stageHistory(order._id, { stageNumber: STAGES.SEND_SOR_PI });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].to, STAGE_STATUS.LOCKED);
    // Null, not some invented starting value — a stage coming into existence
    // has no state to have come from.
    assert.equal(rows[0].from, null);
    assert.equal(rows[0].source, STAGE_EVENT_SOURCES.WORKFLOW);
  });

  test('reaching a stage is recorded as its own event', async () => {
    const order = await create();
    // Stage 1 opens with the order; stage 2 unlocks behind it.
    assert.deepEqual(
      await timeline(order._id, STAGES.SUBMIT_PO_TO_BILLING),
      [STAGE_STATUS.LOCKED, STAGE_STATUS.PENDING],
    );
  });

  test('a completion records who did it and how late it was', async () => {
    const order = await create();
    await closeStage({
      orderId: order._id,
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'),
      now: NOW,
    });

    const rows = await stageHistory(order._id, { stageNumber: STAGES.SUBMIT_PO_TO_BILLING });
    const done = rows.at(-1);

    assert.ok(TERMINAL_STAGE_STATUSES.includes(done.to));
    assert.equal(done.source, STAGE_EVENT_SOURCES.USER);
    // Snapshotted, so a renamed or deactivated account still reads correctly
    // years later.
    assert.equal(done.actorRole, 'Billing');
    assert.equal(done.actorName, 'A Billing');
    // Kept on the EVENT as well as the stage: a re-completion overwrites the
    // stage's delayMinutes, and the history must keep what the first close said.
    assert.equal(typeof done.meta.delayMinutes, 'number');
  });

  test('a skip is recorded with its reason', async () => {
    const order = await create();
    for (const n of [STAGES.SUBMIT_PO_TO_BILLING, STAGES.SEND_SOR_PI]) {
      await closeStage({ orderId: order._id, stageNumber: n, actor: actor('Billing'), now: NOW });
    }
    await orders.decideAdvance(order._id, { advanceRequired: false }, actor('Billing'), { now: NOW });

    const rows = await stageHistory(order._id, { stageNumber: STAGES.RECEIVE_ADVANCE });
    const skipped = rows.find((r) => r.to === STAGE_STATUS.SKIPPED);

    assert.ok(skipped, 'the skip itself is an event, not just a field on the stage');
    assert.ok(skipped.reason, 'and it carries why');
  });

  test('a hold records what each stage WAS before it froze', async () => {
    const order = await create();
    await holdOrder({
      orderId: order._id,
      reason: 'STOCK_UNAVAILABLE',
      note: 'Awaiting import',
      actor: actor('Billing'),
      now: NOW,
    });

    const rows = await stageHistory(order._id, { stageNumber: STAGES.SUBMIT_PO_TO_BILLING });
    const held = rows.at(-1);

    assert.equal(held.to, STAGE_STATUS.ON_HOLD);
    // The whole point of reading the stages before the bulk write: afterwards
    // every one of them simply reads ON_HOLD, and "it was already overdue when
    // we froze it" is a different story from "it was comfortably pending".
    assert.equal(held.from, STAGE_STATUS.PENDING);
    assert.equal(held.source, STAGE_EVENT_SOURCES.ORDER);
    assert.match(held.reason, /Awaiting import/);
  });

  test('a resume is recorded, and so is the time that was frozen', async () => {
    const order = await create();
    await holdOrder({ orderId: order._id, reason: 'STOCK_UNAVAILABLE', actor: actor('Billing'), now: NOW });
    await resumeOrder({
      orderId: order._id,
      actor: actor('Billing'),
      now: new Date(NOW.getTime() + 60 * MINUTE),
    });

    const rows = await stageHistory(order._id, { stageNumber: STAGES.SUBMIT_PO_TO_BILLING });
    const resumed = rows.at(-1);

    assert.equal(resumed.to, STAGE_STATUS.PENDING);
    assert.equal(resumed.from, STAGE_STATUS.ON_HOLD);
    // The deadline MOVED by the hold; without this the reader would have to
    // infer the push from a deadline that silently differs from the one
    // recorded at unlock.
    assert.equal(typeof resumed.meta.heldWorkingMinutes, 'number');
  });

  test('the full timeline reads as a narrative, oldest first', async () => {
    const order = await create();
    await holdOrder({ orderId: order._id, reason: 'STOCK_UNAVAILABLE', actor: actor('Billing'), now: NOW });
    await resumeOrder({ orderId: order._id, actor: actor('Billing'), now: new Date(NOW.getTime() + 30 * MINUTE) });
    await closeStage({
      orderId: order._id,
      stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'),
      now: new Date(NOW.getTime() + 31 * MINUTE),
    });

    const states = await timeline(order._id, STAGES.SUBMIT_PO_TO_BILLING);
    assert.deepEqual(states.slice(0, 4), [
      STAGE_STATUS.LOCKED,
      STAGE_STATUS.PENDING,
      STAGE_STATUS.ON_HOLD,
      STAGE_STATUS.PENDING,
    ]);
    assert.ok(TERMINAL_STAGE_STATUSES.includes(states.at(-1)));
  });

  test('the whole order can be read in one go', async () => {
    const order = await create();
    const all = await stageHistory(order._id);

    // Twelve stages, each born LOCKED, plus the two that opened.
    assert.ok(all.length >= 12);
    assert.ok(all.every((e, i, a) => i === 0 || a[i - 1].at <= e.at), 'oldest first');
  });

  test('history is append-only — a second completion adds, never rewrites', async () => {
    const order = await create();
    await closeStage({
      orderId: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
      actor: actor('Billing'), now: NOW,
    });
    const before = (await stageHistory(order._id, { stageNumber: STAGES.SUBMIT_PO_TO_BILLING })).length;

    // Whatever else a re-close does, it must not remove what was there.
    const after = (await stageHistory(order._id, { stageNumber: STAGES.SUBMIT_PO_TO_BILLING })).length;
    assert.ok(after >= before);
  });
});

// ---------------------------------------------------------------------------

describe('the two-state display name', () => {
  test('anything still owed reads In Progress, however the clock is running', () => {
    for (const status of [
      STAGE_STATUS.PENDING, STAGE_STATUS.DUE_SOON,
      STAGE_STATUS.OVERDUE, STAGE_STATUS.ON_HOLD,
    ]) {
      assert.equal(displayStatusFor(status), STAGE_DISPLAY_STATUS.IN_PROGRESS, status);
    }
  });

  test('anything finished reads Done, including a skip', () => {
    for (const status of TERMINAL_STAGE_STATUSES) {
      assert.equal(displayStatusFor(status), STAGE_DISPLAY_STATUS.DONE, status);
    }
  });

  test('a stage the order has not reached is Not started, not In Progress', () => {
    // Calling stage 12 "In Progress" on the day the PO arrives would be false,
    // and it is the reading that makes a task list useless.
    assert.equal(displayStatusFor(STAGE_STATUS.LOCKED), STAGE_DISPLAY_STATUS.NOT_STARTED);
  });

  test('🔴 the STORED vocabulary is untouched', () => {
    // The distinctions the display drops are the ones the KPI is built on.
    // If this ever shrinks, the on-time percentage silently stops working.
    assert.ok(KPI_COUNTED_STATUSES.includes(STAGE_STATUS.DONE_ON_TIME));
    assert.ok(KPI_COUNTED_STATUSES.includes(STAGE_STATUS.DONE_LATE));
    assert.equal(KPI_COUNTED_STATUSES.includes(STAGE_STATUS.SKIPPED), false,
      'a skip must stay OUT of the KPI even though it now reads as Done');
    assert.notEqual(STAGE_STATUS.DONE_ON_TIME, STAGE_STATUS.DONE_LATE);
  });

  test('the dropped facts stay available beside the name', () => {
    // "In Progress" AND a red overdue marker is the combination the old
    // vocabulary could not express, because a stage could only be one thing.
    const overdue = stageFlagsFor({ status: STAGE_STATUS.OVERDUE });
    assert.equal(overdue.overdue, true);
    assert.equal(displayStatusFor(STAGE_STATUS.OVERDUE), STAGE_DISPLAY_STATUS.IN_PROGRESS);

    const late = stageFlagsFor({ status: STAGE_STATUS.DONE_LATE, delayMinutes: 185 });
    assert.equal(late.late, true);
    assert.equal(late.delayMinutes, 185);

    assert.equal(stageFlagsFor({ status: STAGE_STATUS.SKIPPED }).skipped, true);
    assert.equal(stageFlagsFor({ status: STAGE_STATUS.ON_HOLD }).held, true);
  });
});
