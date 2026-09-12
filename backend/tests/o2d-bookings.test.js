/**
 * The Customer Portal booking → FMS O2D bridge (§3, §28).
 *
 * The requirement these cover is the one `O2dOrder`'s header comment admitted
 * was missing: "a booking that becomes a PO exists in both places, and nothing
 * reconciles them today". So the tests are written against the RECONCILIATION,
 * not against the shape of the new field — that a booking can be found, reviewed,
 * converted exactly once, and still named afterwards.
 *
 * Two properties get checked in both directions on purpose, because a guard that
 * refuses everything also passes a one-sided test:
 *
 *   - the picker hides converted bookings, AND still shows unconverted ones;
 *   - a second conversion is refused, AND a cancelled O2D order frees it again.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';

import { startTestMongo, stopTestMongo, clearCollections, syncIndexes } from './helpers/mongo.js';
import Order from '../models/Order.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dOrderItem } from '../models/o2d/O2dOrderItem.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import * as orders from '../modules/o2d/order.service.js';
import * as bookings from '../modules/o2d/booking.service.js';
import { O2dWorkflowError } from '../modules/o2d/stage.engine.js';
import { ORDER_STATUS } from '../shared/constants/o2d.js';

const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);
const actor = (role) => ({ _id: undefined, user: `A ${role}`, role });

const NOW = ist('2026-09-14', '10:30');

const INTAKE = {
  poNumber: 'PO-4471',
  poDate: ist('2026-09-14', '09:00').toISOString(),
  customerName: 'ABC Industries',
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

/**
 * Seed a booking the way the Customer Portal actually stores one: SEVERAL
 * `Order` documents sharing an `orderId`, one per SKU line.
 *
 * Written out rather than hidden behind a fixture factory with defaults,
 * because the multi-row shape IS the thing most likely to be got wrong by a
 * later change, and a test that hides it would not catch that.
 */
const seedBooking = async ({
  orderId = 'BO-2026-000412',
  company = 'ABC Industries',
  status = 'PO Received',
  // The customer account the booking belongs to. Required by the shared `Order`
  // schema, and stamped on every line of the booking — which is what lets the
  // bridge take it with `$first`.
  user = new mongoose.Types.ObjectId(),
  lines = [
    { skuCode: 'KKN-100', bookedQty: 10, confirmedQty: 10 },
    { skuCode: 'KKN-220', bookedQty: 4, confirmedQty: 3, pendingQty: 1 },
  ],
} = {}) => {
  await Order.insertMany(
    lines.map((line) => ({
      brand: 'Koken',
      user,
      orderId,
      company,
      status,
      orderTimestamp: ist('2026-09-10', '11:00'),
      skuCode: line.skuCode,
      bookedQty: line.bookedQty ?? 0,
      confirmedQty: line.confirmedQty ?? 0,
      pendingQty: line.pendingQty ?? 0,
    })),
  );
  return orderId;
};

const create = (over = {}, who = actor('Sales')) =>
  orders.createOrder({ ...INTAKE, items: [], ...over }, who, { now: NOW });

// ---------------------------------------------------------------------------
// Reading bookings
// ---------------------------------------------------------------------------

describe('reading customer bookings', () => {
  test('a booking is returned as ONE row, not one row per line', async () => {
    await seedBooking();

    const { rows, total } = await bookings.listBookings();

    assert.equal(rows.length, 1, 'two line documents must group into one booking');
    assert.equal(total, 1, 'the total counts bookings, not booking lines');
    assert.equal(rows[0].bookingId, 'BO-2026-000412');
    assert.equal(rows[0].lineCount, 2);
    assert.equal(rows[0].totalBookedQty, 14);
    assert.equal(rows[0].totalConfirmedQty, 13);
  });

  test('the detail view carries the lines Sales needs to review', async () => {
    await seedBooking();

    const booking = await bookings.getBooking('BO-2026-000412');

    assert.equal(booking.customerName, 'ABC Industries');
    assert.deepEqual(
      booking.lines.map((l) => l.skuCode).sort(),
      ['KKN-100', 'KKN-220'],
    );
    assert.equal(booking.o2dOrder, null, 'nothing has been converted yet');
  });

  test('an unknown booking is a 404, not an empty object', async () => {
    await assert.rejects(
      () => bookings.getBooking('BO-does-not-exist'),
      (err) => err instanceof O2dWorkflowError && err.statusCode === 404,
    );
  });

  test('search escapes regex metacharacters rather than running them', async () => {
    await seedBooking({ orderId: 'BO-2026-000500', company: 'Acme (India) Ltd' });

    // Unescaped, "(India)" is a capture group and matches "Acme India Ltd" too;
    // it must be matched literally.
    const { rows } = await bookings.listBookings({ search: 'Acme (India)' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].customerName, 'Acme (India) Ltd');
  });

  test('delivered bookings are out of the picker but still readable by id', async () => {
    await seedBooking({ orderId: 'BO-2026-000600', status: 'Delivered' });

    const { rows } = await bookings.listBookings();
    assert.equal(rows.length, 0, 'a delivered booking has nothing left to dispatch');

    // Still readable: an O2D order linked to it must not lose its source.
    const booking = await bookings.getBooking('BO-2026-000600');
    assert.equal(booking.status, 'Delivered');
  });
});

// ---------------------------------------------------------------------------
// Converting a booking into an O2D order
// ---------------------------------------------------------------------------

describe('booking to O2D order', () => {
  test('the link is stamped on the order, and the booking status is frozen at link time', async () => {
    await seedBooking();

    const { order } = await create({ sourceBookingId: 'BO-2026-000412' });

    assert.equal(order.sourceBooking.bookingId, 'BO-2026-000412');
    assert.equal(order.sourceBooking.bookingKey, 'BO-2026-000412');
    assert.equal(order.sourceBooking.customerName, 'ABC Industries');
    assert.deepEqual(order.sourceBooking.linkedAt, NOW);
    assert.equal(order.sourceBooking.bookingStatusAtLink, 'PO Received');

    // §28: the booking's LINES are not copied onto the O2D order.
    assert.equal(order.sourceBooking.lines, undefined);
  });

  test('an order with no booking behind it is ordinary, not an error', async () => {
    const { order } = await create();
    assert.equal(order.sourceBooking, null);
  });

  test('two unlinked orders coexist — the booking index must not collide on null', async () => {
    await create();
    // Different PO and customer, so §26's rule is not what is being tested here:
    // this is the `$exists` half of the sourceBooking partial index.
    const { order } = await create({ poNumber: 'PO-9999', customerName: 'XYZ Traders' });
    assert.equal(order.sourceBooking, null);
    assert.equal(await O2dOrder.countDocuments({}), 2);
  });

  test('a booking that does not exist is refused before anything is written', async () => {
    await assert.rejects(
      () => create({ sourceBookingId: 'BO-nope' }),
      (err) => err instanceof O2dWorkflowError && err.statusCode === 404,
    );
    assert.equal(await O2dOrder.countDocuments({}), 0, 'no order may be left behind');
  });

  test("a booking belonging to another customer is refused, naming both", async () => {
    await seedBooking({ orderId: 'BO-2026-000700', company: 'Other Corp' });

    await assert.rejects(
      () => create({ sourceBookingId: 'BO-2026-000700' }),
      (err) => {
        assert.equal(err.code, 'O2D_BOOKING_CUSTOMER_MISMATCH');
        assert.match(err.message, /Other Corp/);
        assert.match(err.message, /ABC Industries/);
        return true;
      },
    );
    assert.equal(await O2dOrder.countDocuments({}), 0);
  });
});

// ---------------------------------------------------------------------------
// One booking, one live order (§28)
// ---------------------------------------------------------------------------

describe('duplicate prevention', () => {
  test('a second O2D order for the same booking is refused, and names the first', async () => {
    await seedBooking();
    const { order: first } = await create({ sourceBookingId: 'BO-2026-000412' });

    await assert.rejects(
      // A different PO number, so the refusal can only come from the booking
      // rule and not from §26's PO-number uniqueness.
      () => create({ poNumber: 'PO-4472', sourceBookingId: 'BO-2026-000412' }),
      (err) => {
        assert.equal(err.code, 'O2D_BOOKING_ALREADY_CONVERTED');
        assert.match(err.message, /PO-4471/);
        assert.equal(err.duplicate.id, String(first._id));
        return true;
      },
    );

    assert.equal(await O2dOrder.countDocuments({}), 1);
  });

  test('cancelling the O2D order frees the booking to be converted again', async () => {
    await seedBooking();
    const { order: first } = await create({ sourceBookingId: 'BO-2026-000412' });

    // The escape hatch §28 relies on — the same one the PO-number rule uses.
    await O2dOrder.updateOne({ _id: first._id }, { $set: { status: ORDER_STATUS.CANCELLED } });

    const { order: second } = await create({
      poNumber: 'PO-4472',
      sourceBookingId: 'BO-2026-000412',
    });
    assert.equal(second.sourceBooking.bookingId, 'BO-2026-000412');
  });

  test('the picker hides a converted booking and shows it again once cancelled', async () => {
    await seedBooking();
    const { order } = await create({ sourceBookingId: 'BO-2026-000412' });

    const hidden = await bookings.listBookings();
    assert.equal(hidden.rows.length, 0, 'a converted booking is not waiting for an order');

    // ...but it is findable when explicitly asked for, flagged with its order.
    const shown = await bookings.listBookings({ includeConverted: true });
    assert.equal(shown.rows.length, 1);
    assert.equal(shown.rows[0].o2dOrder.poNumber, 'PO-4471');

    await O2dOrder.updateOne({ _id: order._id }, { $set: { status: ORDER_STATUS.CANCELLED } });

    const freed = await bookings.listBookings();
    assert.equal(freed.rows.length, 1, 'a cancelled order returns the booking to the queue');
    assert.equal(freed.rows[0].o2dOrder, null);
  });

  test('a CLOSED order still holds its booking — closure is completion, not release', async () => {
    await seedBooking();
    const { order } = await create({ sourceBookingId: 'BO-2026-000412' });
    await O2dOrder.updateOne({ _id: order._id }, { $set: { status: ORDER_STATUS.CLOSED } });

    await assert.rejects(
      () => create({ poNumber: 'PO-4472', sourceBookingId: 'BO-2026-000412' }),
      (err) => err.code === 'O2D_BOOKING_ALREADY_CONVERTED',
    );
  });
});

// ---------------------------------------------------------------------------
// The duplicated constant, asserted rather than trusted
// ---------------------------------------------------------------------------

describe('booking service invariants', () => {
  test('its LIVE_STATUSES match the ones order intake uses', async () => {
    // `booking.service` keeps its own copy to avoid an import cycle with
    // `order.service` (see the comment there). If the two ever diverge, a
    // booking would be released by one rule and held by the other — so the
    // pairing is asserted through observable behaviour rather than by exporting
    // the constant purely to compare it.
    await seedBooking();
    const { order } = await create({ sourceBookingId: 'BO-2026-000412' });

    for (const status of [ORDER_STATUS.OPEN, ORDER_STATUS.ON_HOLD, ORDER_STATUS.CLOSED]) {
      await O2dOrder.updateOne({ _id: order._id }, { $set: { status } });
      const { rows } = await bookings.listBookings();
      assert.equal(rows.length, 0, `${status} must keep holding the booking`);
    }

    for (const status of [ORDER_STATUS.CANCELLED, ORDER_STATUS.VOID]) {
      await O2dOrder.updateOne({ _id: order._id }, { $set: { status } });
      const { rows } = await bookings.listBookings();
      assert.equal(rows.length, 1, `${status} must release the booking`);
    }
  });
});
