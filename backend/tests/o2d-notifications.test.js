/**
 * Notifications, escalation and the daily summary.
 *
 * These tests carry more weight than most in this module. The whole layer is
 * built to NEVER THROW — a notification is a courtesy on top of a fact that is
 * already recorded, and a WhatsApp outage must not roll back a dispatch. The
 * cost of that design is that a mis-wired producer sends nothing and every other
 * test still passes. Nothing but an assertion catches it.
 *
 * Channels run in their default state (in-app on, email and WhatsApp off) unless
 * a test switches one on, so the default path is the one exercised.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import User from '../models/User.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dNotification } from '../models/o2d/O2dNotification.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import * as orders from '../modules/o2d/order.service.js';
import * as notifier from '../modules/o2d/notification.service.js';
import * as escalation from '../modules/o2d/escalation.service.js';
import { toE164, renderWhatsApp, WHATSAPP_TEMPLATES } from '../modules/o2d/channels/whatsapp.channel.js';
import { holdOrder } from '../modules/o2d/stage.engine.js';
import { O2D_EVENTS, STAGES, STAGE_STATUS } from '../shared/constants/o2d.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
const NOW = ist('2026-09-14', '10:30');
const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

before(async () => {
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster, O2dNotification);
});
after(async () => {
  await stopTestMongo();
  delete process.env.O2D_EMAIL_ENABLED;
  delete process.env.O2D_WHATSAPP_ENABLED;
  delete process.env.O2D_INAPP_ENABLED;
});

let billing;
let warehouse;
let management;

beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();

  delete process.env.O2D_EMAIL_ENABLED;
  delete process.env.O2D_WHATSAPP_ENABLED;
  delete process.env.O2D_INAPP_ENABLED;

  [billing, warehouse, management] = await User.create([
    { email: 'billing@example.com', password: 'x'.repeat(12), user: 'Bee', role: 'Billing', status: 'Active' },
    { email: 'wh@example.com', password: 'x'.repeat(12), user: 'Dubs', role: 'Warehouse User', status: 'Active', phone: '9876543210' },
    { email: 'mgmt@example.com', password: 'x'.repeat(12), user: 'Em', role: 'Management', status: 'Active', phone: '9000000001' },
  ]);
});

const makeOrder = async () => {
  const { order } = await orders.createOrder(
    {
      poNumber: 'PO-4471',
      poDate: ist('2026-09-14', '09:00').toISOString(),
      customerName: 'ABC Industries',
      promiseDate: ist('2026-09-25', '10:00').toISOString(),
      items: [],
    },
    actor('Sales'),
    { now: NOW },
  );
  return order;
};

const rowsFor = (event) => O2dNotification.find(event ? { event } : {}).lean();

// ---------------------------------------------------------------------------

describe('routing an event to the right people', () => {
  test('a stage unlocking notifies the role that CLOSES it, not the one that owns it', async () => {
    const order = await makeOrder();

    // Stage 7: Billing raises the picking request, the WAREHOUSE acknowledges.
    await notifier.dispatchEvent(O2D_EVENTS.STAGE_UNLOCKED, {
      orderId: order._id,
      stageNumber: STAGES.WAREHOUSE_PICKING,
    });

    const rows = await rowsFor(O2D_EVENTS.STAGE_UNLOCKED);
    const recipients = rows.map((r) => String(r.user));
    assert.ok(recipients.includes(String(warehouse._id)), 'the warehouse must be told');
    assert.ok(
      !recipients.includes(String(billing._id)),
      'Billing raised it — telling them it is waiting would be noise',
    );
  });

  test('reads the stage master, so an admin reassignment reroutes the notification', async () => {
    const order = await makeOrder();
    await O2dStageMaster.updateOne(
      { stageNumber: STAGES.WAREHOUSE_PICKING },
      { $set: { completedByRole: 'Billing', alsoAllowedRoles: [] } },
    );

    await notifier.dispatchEvent(O2D_EVENTS.STAGE_UNLOCKED, {
      orderId: order._id,
      stageNumber: STAGES.WAREHOUSE_PICKING,
    });

    const recipients = (await rowsFor(O2D_EVENTS.STAGE_UNLOCKED)).map((r) => String(r.user));
    assert.ok(recipients.includes(String(billing._id)));
    assert.ok(!recipients.includes(String(warehouse._id)));
  });

  test('an escalation goes to the escalation role, not the owner who did not act', async () => {
    const order = await makeOrder();

    await notifier.dispatchEvent(
      O2D_EVENTS.STAGE_ESCALATED,
      { orderId: order._id, stageNumber: STAGES.WAREHOUSE_PICKING },
      { escalate: true },
    );

    const recipients = (await rowsFor(O2D_EVENTS.STAGE_ESCALATED)).map((r) => String(r.user));
    // Stage 7 escalates to Management.
    assert.ok(recipients.includes(String(management._id)));
    assert.ok(!recipients.includes(String(warehouse._id)));
  });

  test('an inactive account is not notified', async () => {
    await User.updateOne({ _id: warehouse._id }, { $set: { status: 'Inactive' } });
    const order = await makeOrder();

    await notifier.dispatchEvent(O2D_EVENTS.STAGE_UNLOCKED, {
      orderId: order._id,
      stageNumber: STAGES.WAREHOUSE_PICKING,
    });

    assert.equal((await rowsFor(O2D_EVENTS.STAGE_UNLOCKED)).length, 0);
  });

  test('an event nobody routed sends nothing, and is not an error', async () => {
    const order = await makeOrder();
    // STAGE_COMPLETED is deliberately unrouted: every stage completes, so
    // notifying on it would bury the exceptions.
    const tally = await notifier.dispatchEvent(O2D_EVENTS.STAGE_COMPLETED, {
      orderId: order._id,
      stageNumber: 2,
    });
    assert.deepEqual(tally, { written: 0, sent: 0, skipped: 0, failed: 0 });
  });
});

// ---------------------------------------------------------------------------

describe('channels', () => {
  test('in-app is on by default; email and WhatsApp are not', async () => {
    const order = await makeOrder();
    await notifier.dispatchEvent(O2D_EVENTS.STAGE_OVERDUE, {
      orderId: order._id,
      stageNumber: STAGES.WAREHOUSE_PICKING,
    });

    const rows = await rowsFor(O2D_EVENTS.STAGE_OVERDUE);
    const inApp = rows.find((r) => r.channel === 'IN_APP');
    const email = rows.find((r) => r.channel === 'EMAIL');

    assert.equal(inApp.status, 'SENT');
    // SKIPPED, not FAILED — a switched-off channel has not failed, and counting
    // it as a failure would hide real ones.
    assert.equal(email.status, 'SKIPPED');
    assert.match(email.failureReason, /O2D_EMAIL_ENABLED/);
  });

  test('a disabled channel still records WHAT would have been sent', async () => {
    const order = await makeOrder();
    await notifier.dispatchEvent(O2D_EVENTS.STAGE_OVERDUE, {
      orderId: order._id,
      stageNumber: STAGES.WAREHOUSE_PICKING,
    });

    const email = (await rowsFor(O2D_EVENTS.STAGE_OVERDUE)).find((r) => r.channel === 'EMAIL');
    assert.match(email.title, /overdue/i);
    assert.equal(email.poNumber, 'PO-4471');
    assert.equal(email.recipientEmail, 'wh@example.com');
  });

  test('WhatsApp in mock mode reports success and records the template', async () => {
    process.env.O2D_WHATSAPP_ENABLED = 'enabled';
    const order = await makeOrder();

    await notifier.dispatchEvent(
      O2D_EVENTS.STAGE_ESCALATED,
      { orderId: order._id, stageNumber: STAGES.WAREHOUSE_PICKING },
      { escalate: true },
    );

    const wa = (await rowsFor(O2D_EVENTS.STAGE_ESCALATED)).find((r) => r.channel === 'WHATSAPP');
    assert.ok(wa, 'escalation is the one event that reaches a phone');
    assert.equal(wa.status, 'SENT');
  });

  test('WhatsApp skips an account with no usable number rather than guessing', async () => {
    process.env.O2D_WHATSAPP_ENABLED = 'enabled';
    await User.updateOne({ _id: management._id }, { $set: { phone: '123' } });
    const order = await makeOrder();

    await notifier.dispatchEvent(
      O2D_EVENTS.STAGE_ESCALATED,
      { orderId: order._id, stageNumber: STAGES.WAREHOUSE_PICKING },
      { escalate: true },
    );

    const wa = (await rowsFor(O2D_EVENTS.STAGE_ESCALATED)).find((r) => r.channel === 'WHATSAPP');
    assert.equal(wa.status, 'SKIPPED');
    assert.match(wa.failureReason, /not a number we can dial safely/);
  });
});

describe('phone normalisation', () => {
  test('accepts the shapes the portal actually stores', () => {
    assert.equal(toE164('9876543210'), '+919876543210');
    assert.equal(toE164('09876543210'), '+919876543210');
    assert.equal(toE164('919876543210'), '+919876543210');
    assert.equal(toE164('+91 98765 43210'), '+919876543210');
  });

  test('refuses anything it cannot make sense of', () => {
    // Sending an order update to the wrong person is worse than not sending it.
    for (const bad of ['123', '', null, undefined, '98765', 'not a phone']) {
      assert.equal(toE164(bad), null, `${bad} should be refused`);
    }
  });

  test('renders to a template invocation, because providers require one', () => {
    const { template, params } = renderWhatsApp({
      event: O2D_EVENTS.STAGE_OVERDUE,
      poNumber: 'PO-4471',
      stageNumber: 7,
      title: 'Stage 7 is overdue',
    });
    assert.equal(template, WHATSAPP_TEMPLATES.STAGE_OVERDUE);
    assert.deepEqual(params, ['PO-4471', '7', 'Stage 7 is overdue']);
  });
});

// ---------------------------------------------------------------------------

describe('not sending the same thing twice', () => {
  test('a repeated dispatch writes nothing the second time', async () => {
    const order = await makeOrder();
    const payload = { orderId: order._id, stageNumber: STAGES.WAREHOUSE_PICKING };

    const first = await notifier.dispatchEvent(O2D_EVENTS.STAGE_OVERDUE, payload);
    const second = await notifier.dispatchEvent(O2D_EVENTS.STAGE_OVERDUE, payload);

    assert.ok(first.written > 0);
    assert.equal(second.written, 0, 'the unique dedupeKey refuses the duplicate');
  });

  test('the same event on a DIFFERENT order still sends', async () => {
    const a = await makeOrder();
    const b = (
      await orders.createOrder(
        {
          poNumber: 'PO-9000',
          poDate: ist('2026-09-14', '09:00').toISOString(),
          customerName: 'XYZ Traders',
          promiseDate: ist('2026-09-25', '10:00').toISOString(),
          items: [],
        },
        actor('Sales'),
        { now: NOW },
      )
    ).order;

    await notifier.dispatchEvent(O2D_EVENTS.STAGE_OVERDUE, { orderId: a._id, stageNumber: 7 });
    const second = await notifier.dispatchEvent(O2D_EVENTS.STAGE_OVERDUE, {
      orderId: b._id,
      stageNumber: 7,
    });
    assert.ok(second.written > 0);
  });
});

// ---------------------------------------------------------------------------

describe('the escalation sweep', () => {
  /** Put the open stage's deadline where the test needs it. */
  const setDeadline = (orderId, stageNumber, plannedStart, plannedCompletion) =>
    O2dOrderStage.updateOne({ order: orderId, stageNumber }, { $set: { plannedStart, plannedCompletion } });

  test('warns when most of the allowed time has gone', async () => {
    const order = await makeOrder();
    // A window from 10:00 to 11:00; at 10:50, 83% has elapsed.
    await setDeadline(order._id, STAGES.SUBMIT_PO_TO_BILLING, ist('2026-09-14', '10:00'), ist('2026-09-14', '11:00'));

    const r = await escalation.runEscalationSweep({ now: ist('2026-09-14', '10:50') });
    assert.equal(r.dueSoon, 1);
    assert.equal(r.overdue, 0);

    const stage = await O2dOrderStage.findOne({ order: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING });
    assert.equal(stage.status, STAGE_STATUS.DUE_SOON);
    assert.ok(stage.dueSoonNotifiedAt);
  });

  test('does not warn early', async () => {
    const order = await makeOrder();
    await setDeadline(order._id, STAGES.SUBMIT_PO_TO_BILLING, ist('2026-09-14', '10:00'), ist('2026-09-14', '11:00'));

    const r = await escalation.runEscalationSweep({ now: ist('2026-09-14', '10:20') });
    assert.equal(r.dueSoon, 0);
  });

  test('flags an overdue stage, and does not escalate in the same pass', async () => {
    const order = await makeOrder();
    await setDeadline(order._id, STAGES.SUBMIT_PO_TO_BILLING, ist('2026-09-14', '10:00'), ist('2026-09-14', '11:00'));

    const r = await escalation.runEscalationSweep({ now: ist('2026-09-14', '11:05') });
    assert.equal(r.overdue, 1);
    // The grace period is measured from the deadline, and five minutes is not
    // enough for anybody to have acted on the alert.
    assert.equal(r.escalated, 0);
  });

  test('escalates only after the grace period, in WORKING minutes', async () => {
    const order = await makeOrder();
    await setDeadline(order._id, STAGES.SUBMIT_PO_TO_BILLING, ist('2026-09-14', '10:00'), ist('2026-09-14', '11:00'));

    await escalation.runEscalationSweep({ now: ist('2026-09-14', '11:05') });
    // 120 working minutes after 11:00 is 13:00, still inside the working day.
    const early = await escalation.runEscalationSweep({ now: ist('2026-09-14', '12:30') });
    assert.equal(early.escalated, 0);

    const late = await escalation.runEscalationSweep({ now: ist('2026-09-14', '13:30') });
    assert.equal(late.escalated, 1);
  });

  test('is idempotent — a second pass at the same moment does nothing', async () => {
    const order = await makeOrder();
    await setDeadline(order._id, STAGES.SUBMIT_PO_TO_BILLING, ist('2026-09-14', '10:00'), ist('2026-09-14', '11:00'));

    const first = await escalation.runEscalationSweep({ now: ist('2026-09-14', '11:05') });
    const second = await escalation.runEscalationSweep({ now: ist('2026-09-14', '11:05') });

    assert.equal(first.overdue, 1);
    assert.equal(second.overdue, 0, 'overdueNotifiedAt keeps it out of the query');
  });

  test('leaves a held order alone — §19 froze its SLA', async () => {
    const order = await makeOrder();
    await setDeadline(order._id, STAGES.SUBMIT_PO_TO_BILLING, ist('2026-09-14', '10:00'), ist('2026-09-14', '11:00'));
    await holdOrder({
      orderId: order._id,
      actor: actor('Management'),
      reason: 'STOCK_UNAVAILABLE',
      now: ist('2026-09-14', '10:30'),
    });

    const r = await escalation.runEscalationSweep({ now: ist('2026-09-14', '13:30') });
    assert.equal(r.scanned, 0, 'chasing somebody about work they were told to stop is worse than silence');
    assert.equal(r.overdue, 0);
  });

  test('ignores stages that are already done', async () => {
    const order = await makeOrder();
    // Stage 1 completed at creation; it must never appear in the sweep.
    const r = await escalation.runEscalationSweep({ now: ist('2026-09-20', '11:00') });
    const stage1 = await O2dOrderStage.findOne({ order: order._id, stageNumber: STAGES.RECEIVE_ORDER });
    assert.ok(!stage1.overdueNotifiedAt);
    assert.ok(r.scanned >= 1);
  });
});

// ---------------------------------------------------------------------------

describe('the daily summary', () => {
  test('reports the figures a manager actually asks about', async () => {
    const order = await makeOrder();
    await O2dOrderStage.updateOne(
      { order: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING },
      { $set: { plannedCompletion: ist('2026-09-14', '10:00') } },
    );

    const figures = await escalation.summaryFigures({ now: ist('2026-09-14', '18:00') });
    assert.equal(figures.openOrders, 1);
    assert.equal(figures.overdueStages, 1);
    // "Which team is behind?" — the question a bare count cannot answer.
    assert.deepEqual(figures.overdueByRole, { Sales: 1 });
  });

  test('is not sent when there is nothing to report', async () => {
    const result = await escalation.sendDailySummary({ now: ist('2026-09-14', '18:00') });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'nothing to report');
  });

  test('is sent when something is overdue', async () => {
    process.env.O2D_EMAIL_ENABLED = 'enabled';
    const order = await makeOrder();
    await O2dOrderStage.updateOne(
      { order: order._id, stageNumber: STAGES.SUBMIT_PO_TO_BILLING },
      { $set: { plannedCompletion: ist('2026-09-14', '10:00') } },
    );

    const result = await escalation.sendDailySummary({ now: ist('2026-09-14', '18:00') });
    assert.ok(result.lines.some((l) => /overdue/i.test(l)));

    const rows = await rowsFor(O2D_EVENTS.DAILY_SUMMARY);
    assert.ok(rows.length > 0);
    // Oversight roles only — not everyone who works a stage.
    const roles = [...new Set(rows.map((r) => r.recipientRole))];
    assert.ok(roles.every((r) => ['Management', 'Billing Head'].includes(r)), roles.join(','));
  });
});

// ---------------------------------------------------------------------------

describe('reading the bell', () => {
  test('returns only the caller\'s own in-app rows, with an unread count', async () => {
    const order = await makeOrder();
    await notifier.dispatchEvent(O2D_EVENTS.STAGE_UNLOCKED, {
      orderId: order._id,
      stageNumber: STAGES.WAREHOUSE_PICKING,
    });

    const mine = await notifier.listForUser(warehouse._id);
    assert.equal(mine.data.length, 1);
    assert.equal(mine.unread, 1);
    assert.ok(mine.data.every((r) => r.channel === 'IN_APP'));

    const theirs = await notifier.listForUser(billing._id);
    assert.equal(theirs.data.length, 0);
  });

  test('marking read cannot touch another user\'s notification', async () => {
    const order = await makeOrder();
    await notifier.dispatchEvent(O2D_EVENTS.STAGE_UNLOCKED, {
      orderId: order._id,
      stageNumber: STAGES.WAREHOUSE_PICKING,
    });

    const [theirRow] = (await notifier.listForUser(warehouse._id)).data;

    // Billing tries to mark the warehouse's notification as read.
    const result = await notifier.markRead(billing._id, [String(theirRow._id)]);
    assert.equal(result.updated, 0);

    // Still unread for its actual owner.
    assert.equal((await notifier.listForUser(warehouse._id)).unread, 1);
  });

  test('marking read with no ids clears everything unread for that user', async () => {
    const order = await makeOrder();
    await notifier.dispatchEvent(O2D_EVENTS.STAGE_UNLOCKED, {
      orderId: order._id,
      stageNumber: STAGES.WAREHOUSE_PICKING,
    });

    await notifier.markRead(warehouse._id, []);
    assert.equal((await notifier.listForUser(warehouse._id)).unread, 0);
  });
});

// ---------------------------------------------------------------------------

describe('failures never reach the producer', () => {
  test('dispatch of a malformed event resolves rather than throwing', async () => {
    const tally = await notifier.dispatchEvent(O2D_EVENTS.STAGE_OVERDUE, {
      orderId: 'not-an-object-id',
      stageNumber: 2,
    });
    assert.ok(tally, 'a notification must never be the reason a transition fails');
  });

  test('dispatch() tolerates rubbish in the events array', async () => {
    const totals = await notifier.dispatch([null, undefined, {}, { type: null }]);
    assert.deepEqual(totals, { written: 0, sent: 0, skipped: 0, failed: 0 });
  });
});
