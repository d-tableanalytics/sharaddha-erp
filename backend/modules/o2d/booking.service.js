/**
 * The bridge from a Customer Portal booking to an FMS O2D order.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * `O2dOrder`'s header comment states the original decision plainly: O2D was
 * built as its own collection, and "a booking that becomes a PO exists in both
 * places, and nothing reconciles them today". §3 and §28 of the FMS brief close
 * exactly that gap — the Sales user must be able to find the customer's booking,
 * review it, and create the O2D order FROM it, with the relationship retained.
 *
 * This is the reconciliation service that comment said the link belongs in. It
 * is deliberately one-directional and read-only over the customer side:
 *
 *   - it READS the shared `orders` collection (bookings), and
 *   - it WRITES nothing there.
 *
 * Writing back would put the Employee Portal in the business of moving customer
 * booking statuses, which `bookingStatus.service.js` on the customer side
 * already owns — two writers on one lifecycle field is the bug this avoids.
 *
 * ---------------------------------------------------------------------------
 * A BOOKING IS NOT A ROW
 * ---------------------------------------------------------------------------
 *
 * In the shared schema, ONE booking is SEVERAL `Order` documents sharing one
 * `orderId` (`BO-`/`SO-YYYY-######`) — one document per SKU line. Every function
 * here groups by `orderId` before returning anything, because a Sales user
 * picking "the booking to convert" means the whole PO, never a single line.
 *
 * The grouping is done in MongoDB rather than in Node on purpose: the picker is
 * paginated, and paginating after a client-side group would either read the
 * entire collection or return short pages.
 */

import Order from '../../models/Order.js';
import { O2dOrder, o2dKey } from '../../models/o2d/O2dOrder.js';
import { ORDER_STATUS } from '../../shared/constants/o2d.js';
import { O2dWorkflowError } from './stage.engine.js';

/**
 * O2D orders that still occupy their booking.
 *
 * Declared here rather than imported from `order.service.js`, which holds an
 * identical list: `order.service` imports THIS module for intake, so reaching
 * back for the constant would close an import cycle. Three frozen strings are a
 * cheaper duplicate than a cycle, and the pairing is asserted in
 * `o2d-bookings.test.js` so the two cannot drift apart unnoticed.
 */
const LIVE_STATUSES = Object.freeze([
  ORDER_STATUS.OPEN,
  ORDER_STATUS.ON_HOLD,
  ORDER_STATUS.CLOSED,
]);

/**
 * Booking statuses whose lines may still become an O2D order.
 *
 * `Delivered` is absent because that booking's journey is over, and
 * `Cancelled` because there is nothing left to dispatch. Both remain readable
 * by id — `getBooking` does not filter — so an O2D order already linked to one
 * never loses its source just because the booking moved on afterwards.
 */
export const CONVERTIBLE_BOOKING_STATUSES = Object.freeze([
  'PO Received',
  'Ready for Dispatch',
  'Booked',
]);

/** Normalise a booking id into its lookup key. Mirrors `o2dKey`. */
export const bookingKey = (value) =>
  String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * The $group stage that turns booking LINES into one booking.
 *
 * `$first` on the header-ish fields is safe because the customer side stamps
 * them onto every row of a booking (see the `unitPrice` note in models/Order.js
 * — "stamped on EVERY row of the booking"). Quantities are summed; the line
 * detail is kept so the picker can show what is on the PO without a second read.
 */
const GROUP_BOOKING = {
  $group: {
    _id: '$orderId',
    bookingId: { $first: '$orderId' },
    customerName: { $first: '$company' },
    customer: { $first: '$user' },
    brand: { $first: '$brand' },
    status: { $first: '$status' },
    poNumber: { $first: '$poNumber' },
    poDate: { $first: '$poDate' },
    poGeneratedAt: { $first: '$poGeneratedAt' },
    promiseDate: { $first: '$promiseDate' },
    bookedAt: { $min: '$orderTimestamp' },
    createdAt: { $min: '$createdAt' },
    emailId: { $first: '$emailId' },
    phoneNumber: { $first: '$phoneNumber' },
    shippingAddress: { $first: '$shippingAddress' },
    remarks: { $first: '$remarks' },
    lineCount: { $sum: 1 },
    totalBookedQty: { $sum: { $ifNull: ['$bookedQty', 0] } },
    totalConfirmedQty: { $sum: { $ifNull: ['$confirmedQty', 0] } },
    totalPendingQty: { $sum: { $ifNull: ['$pendingQty', 0] } },
    lines: {
      $push: {
        skuCode: '$skuCode',
        category: '$category',
        brand: '$brand',
        msilCode: '$msilCode',
        bookedQty: { $ifNull: ['$bookedQty', 0] },
        confirmedQty: { $ifNull: ['$confirmedQty', 0] },
        pendingQty: { $ifNull: ['$pendingQty', 0] },
        remarks: '$remarks',
      },
    },
  },
};

/**
 * Which of these booking ids already have a live O2D order against them?
 *
 * Asked as ONE query over the page's ids rather than per row: the picker shows
 * 25 bookings, and 25 round trips to render a badge is not a trade worth making.
 *
 * Cancelled and void O2D orders are excluded so a booking whose O2D order was
 * abandoned becomes convertible again — the same escape hatch the PO-number
 * uniqueness rule already uses.
 */
async function linkedOrdersFor(bookingIds = []) {
  if (bookingIds.length === 0) return new Map();

  const rows = await O2dOrder.find({
    'sourceBooking.bookingKey': { $in: bookingIds.map(bookingKey) },
    status: { $in: LIVE_STATUSES },
  })
    .select('poNumber currentStage status sourceBooking.bookingId sourceBooking.bookingKey')
    .lean();

  return new Map(rows.map((row) => [row.sourceBooking.bookingKey, row]));
}

/** Shape one grouped booking for the API, with its O2D link resolved. */
function decorate(row, linked) {
  const existing = linked.get(bookingKey(row.bookingId)) ?? null;
  const { _id, ...rest } = row;
  return {
    ...rest,
    o2dOrder: existing
      ? {
          id: String(existing._id),
          poNumber: existing.poNumber,
          currentStage: existing.currentStage,
          status: existing.status,
        }
      : null,
  };
}

/**
 * The Sales picker: customer bookings, newest first, each flagged with whether
 * an O2D order already exists for it.
 *
 * `includeConverted` defaults to FALSE — the common case is "what still needs an
 * O2D order", and burying those in a list of already-handled bookings is how a
 * PO gets missed. It is a flag rather than a hard filter because Sales also
 * legitimately asks "which booking did PO-4471 come from".
 */
export async function listBookings({
  search = null,
  status = null,
  includeConverted = false,
  page = 1,
  pageSize = 25,
} = {}) {
  const match = status
    ? { status }
    : { status: { $in: CONVERTIBLE_BOOKING_STATUSES } };

  if (search && String(search).trim()) {
    // Escaped: a customer name with a "(" must not be read as a regex group.
    const safe = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');
    match.$or = [{ orderId: rx }, { company: rx }, { poNumber: rx }, { skuCode: rx }];
  }

  const skip = (Math.max(1, page) - 1) * pageSize;

  const [result] = await Order.aggregate([
    { $match: match },
    GROUP_BOOKING,
    { $sort: { bookedAt: -1, createdAt: -1, _id: -1 } },
    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: pageSize }],
        // Counted AFTER grouping: the total the user needs is bookings, not
        // booking lines, and those differ by roughly the average line count.
        total: [{ $count: 'value' }],
      },
    },
  ]);

  const raw = result?.rows ?? [];
  const linked = await linkedOrdersFor(raw.map((r) => r.bookingId));
  const rows = raw.map((row) => decorate(row, linked));

  return {
    rows: includeConverted ? rows : rows.filter((r) => !r.o2dOrder),
    total: result?.total?.[0]?.value ?? 0,
    page: Math.max(1, page),
    pageSize,
  };
}

/**
 * One booking, with its lines — what Sales reviews before creating the order
 * (§3: "the Sales user should be able to review the customer booking").
 *
 * No status filter here, deliberately: an O2D order linked to a booking must
 * still be able to show its source after that booking has been delivered or
 * cancelled on the customer side.
 */
export async function getBooking(bookingId) {
  const id = String(bookingId ?? '').trim();
  if (!id) throw new O2dWorkflowError('A booking id is required.', { status: 400 });

  const [booking] = await Order.aggregate([
    { $match: { orderId: id } },
    GROUP_BOOKING,
  ]);

  if (!booking) {
    throw new O2dWorkflowError(`No customer booking found for ${id}.`, {
      status: 404,
      code: 'O2D_BOOKING_NOT_FOUND',
    });
  }

  const linked = await linkedOrdersFor([booking.bookingId]);
  return decorate(booking, linked);
}

/**
 * Resolve a booking for intake, refusing the two ways this can go wrong.
 *
 * Called by `createOrder` BEFORE anything is written. It returns the fields the
 * O2D order should carry from the booking, rather than letting the caller copy
 * them — §28 says do not duplicate customer data unnecessarily, and the way
 * that rule gets broken is a controller quietly reading a booking and stamping
 * its own idea of the customer name onto the order.
 *
 * ⚠ THE DUPLICATE RULE IS A REFUSAL, not a warning, and for the same reason the
 * PO-number rule is: §28 requires that a second O2D order for one booking be
 * prevented, and a warning the user clicks past does not prevent anything. The
 * escape hatch is identical — cancel the existing O2D order and the booking is
 * convertible again.
 */
export async function resolveBookingForIntake(bookingId, { customerName = null } = {}) {
  const booking = await getBooking(bookingId);

  if (booking.o2dOrder) {
    const error = new O2dWorkflowError(
      `${booking.bookingId} already has an O2D order — ${booking.o2dOrder.poNumber}, currently `
        + `at stage ${booking.o2dOrder.currentStage}. If that order has been superseded, cancel `
        + 'it first; this booking is then free to convert again.',
      { status: 409, code: 'O2D_BOOKING_ALREADY_CONVERTED' },
    );
    error.duplicate = booking.o2dOrder;
    throw error;
  }

  /**
   * The customer must match.
   *
   * Checked because the booking id arrives in the same request body as a
   * free-typed customer name, and a mismatch means one of them is a typo. Left
   * unchecked, FMS would show an order filed under one customer whose source
   * booking belongs to another — and the Order 360 link would be the only place
   * that disagreement was ever visible.
   */
  if (
    customerName
    && booking.customerName
    && o2dKey(customerName) !== o2dKey(booking.customerName)
  ) {
    throw new O2dWorkflowError(
      `${booking.bookingId} belongs to ${booking.customerName}, not ${customerName}. `
        + 'Pick the right booking, or clear the booking link and key the order in on its own.',
      { status: 400, code: 'O2D_BOOKING_CUSTOMER_MISMATCH' },
    );
  }

  return {
    booking,
    /** Exactly what gets stamped onto `O2dOrder.sourceBooking`. */
    link: {
      bookingId: booking.bookingId,
      bookingKey: bookingKey(booking.bookingId),
      customer: booking.customer ?? null,
      customerName: booking.customerName ?? null,
      bookedAt: booking.bookedAt ?? booking.createdAt ?? null,
      bookingStatusAtLink: booking.status ?? null,
    },
  };
}

export default {
  listBookings,
  getBooking,
  resolveBookingForIntake,
  bookingKey,
  CONVERTIBLE_BOOKING_STATUSES,
};
