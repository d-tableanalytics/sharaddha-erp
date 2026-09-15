/**
 * O2D HTTP handlers.
 *
 * Thin by design: parse, call a service, envelope the answer. Every business
 * decision — may this move, is this a duplicate, whose task is this — belongs to
 * the service or the engine, so the same rule applies whether it is reached from
 * a route, a migration script or a scheduled job (§53).
 *
 * Responses use `{ success: true, data }`, the envelope the rest of the portal
 * uses and a test enforces.
 */

import * as orders from './order.service.js';
import * as tasks from './task.service.js';
import { completeStage, skipStage, holdOrder, resumeOrder, O2dWorkflowError } from './stage.engine.js';
import { O2dStageMaster } from '../../models/o2d/O2dStageMaster.js';
import * as documents from './document.service.js';
import * as exits from './exit.service.js';
import { dispatch, listForUser, markRead } from './notification.service.js';
import AuditLog from '../../models/AuditLog.js';
import { stageHistory } from './stageHistory.service.js';
import { visibleStagesFor } from './stageVisibility.service.js';
import * as analytics from './analytics.service.js';
import * as exporter from './export.service.js';
import * as invoicing from './invoicing.service.js';
import * as bookings from './booking.service.js';

const ctx = (req) => ({ req });

/**
 * Announce what happened, then answer the request.
 *
 * The engine RETURNS events rather than sending them (§53), so somebody has to
 * hand them to the notification layer. Doing it here — once, in the controller —
 * rather than inside the engine keeps the engine testable without a mail server
 * and means a transition cannot fail because SMTP was down.
 *
 * NOT awaited into the response path's failure modes: `dispatch` never throws,
 * and a slow channel must not hold the HTTP response open. It IS awaited so that
 * a test can assert on what was sent without polling.
 */
const announce = (events) => dispatch(events);

/**
 * Refuse a stage action the caller's role does not close.
 *
 * `WORK_O2D_STAGE` is a capability, not a stage list — it says the holder works
 * O2D stages at all. WHICH stages is a property of the stage master, which an
 * administrator edits (§37), so the check has to happen here rather than in a
 * route guard that was fixed at mount time.
 */
async function assertCanWork(req, stageNumber) {
  if (await tasks.canWorkStage(req.user, stageNumber)) return;

  const master = await O2dStageMaster.findOne({ stageNumber }).select('stageName ownerRole completedByRole name').lean();
  const owner = master?.completedByRole || master?.ownerRole || 'another role';
  throw new O2dWorkflowError(
    `${master?.name ?? `Stage ${stageNumber}`} is completed by ${owner}, not by ${req.user?.role}.`,
    { status: 403, code: 'O2D_NOT_YOUR_STAGE' },
  );
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** POST /api/v1/o2d/orders */
export const createOrder = async (req, res, next) => {
  try {
    const { order, events } = await orders.createOrder(req.body, req.user, ctx(req));
    await announce(events);
    res.status(201).json({ success: true, data: { order, events } });
  } catch (error) {
    // The duplicate carries the offending order so the UI can link to it — a
    // 409 saying only "duplicate" leaves the user with nowhere to go.
    if (error?.code === 'O2D_DUPLICATE_PO') {
      return res.status(409).json({
        success: false,
        message: error.message,
        code: error.code,
        data: { duplicate: error.duplicate },
      });
    }
    next(error);
  }
};

/** GET /api/v1/o2d/orders */
export const listOrders = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await orders.listOrders(req.query, req.user) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/o2d/orders/:id — the Order 360 payload. */
export const getOrder = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await orders.getOrder(req.params.id, req.user) });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/o2d/orders/:id */
export const updateOrder = async (req, res, next) => {
  try {
    const data = await orders.updateOrder(req.params.id, req.body, req.user, ctx(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/o2d/orders/check-duplicate?poNumber=&customerName=
 *
 * Exists so the intake form can warn WHILE TYPING rather than on submit. §26
 * asks for a check at entry, and a check that only fires after the user has
 * keyed twenty lines is a check they will learn to click past.
 */
export const checkDuplicate = async (req, res, next) => {
  try {
    const { poNumber, customerName } = req.query;
    if (!poNumber || !customerName) {
      return res.status(400).json({ success: false, message: 'poNumber and customerName are required.' });
    }
    const duplicate = await orders.findDuplicateOrder(String(poNumber), String(customerName));
    res.status(200).json({ success: true, data: { duplicate: duplicate ?? null } });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// Customer Portal bookings (§3)
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/o2d/bookings
 *
 * The Sales picker: which customer bookings still need an O2D order raised.
 *
 * Gated on CREATE_O2D_ORDER at the route, not VIEW_O2D, and the distinction is
 * the point — this is a list of customer commercial activity, and the only
 * reason the Employee Portal shows it here is to raise an order from one. Every
 * role that can merely read the tracker has no business browsing it.
 */
export const listBookings = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await bookings.listBookings(req.query) });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/o2d/bookings/:bookingId
 *
 * One booking with its lines — what Sales reviews before submitting (§3).
 *
 * `:bookingId` is the customer-portal `orderId` (`BO-`/`SO-YYYY-######`), not a
 * Mongo id: a booking is several documents sharing that string, so no single
 * ObjectId names one.
 */
export const getBooking = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await bookings.getBooking(req.params.bookingId) });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** GET /api/v1/o2d/orders/:id/items */
export const listItems = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await orders.listItems(req.params.id) });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/v1/o2d/orders/:id/items */
export const replaceItems = async (req, res, next) => {
  try {
    const data = await orders.replaceItems(req.params.id, req.body.items, req.user, ctx(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// Stage actions
// ---------------------------------------------------------------------------

/** POST /api/v1/o2d/orders/:id/stages/:stageNumber/complete */
export const complete = async (req, res, next) => {
  try {
    const stageNumber = Number(req.params.stageNumber);
    await assertCanWork(req, stageNumber);

    // The stage's required fields are checked INSIDE the engine, after its
    // ordering and lock checks — see completeStage. Doing it here would put
    // "fill in this field" ahead of "you cannot complete this stage yet".
    const { stage, order, events } = await completeStage({
      orderId: req.params.id,
      stageNumber,
      actor: req.user,
      actualCompletion: req.body.actualCompletion ?? null,
      remarks: req.body.remarks ?? null,
      evidence: req.body.evidence ?? null,
      override: req.body.override ?? false,
      overrideReason: req.body.overrideReason ?? null,
    });

    await announce(events);
    res.status(200).json({ success: true, data: { stage, order, events } });
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/o2d/orders/:id/advance-decision — stage 4, and stage 5's fate. */
export const advanceDecision = async (req, res, next) => {
  try {
    await assertCanWork(req, 4);
    const data = await orders.decideAdvance(req.params.id, req.body, req.user, ctx(req));
    await announce(data.events);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/o2d/orders/:id/stages/:stageNumber/skip */
export const skip = async (req, res, next) => {
  try {
    const stageNumber = Number(req.params.stageNumber);
    await assertCanWork(req, stageNumber);

    const data = await skipStage({
      orderId: req.params.id,
      stageNumber,
      actor: req.user,
      reason: req.body.reason,
      actualCompletion: req.body.actualCompletion ?? null,
    });
    await announce(data.events);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/o2d/orders/:id/hold */
export const hold = async (req, res, next) => {
  try {
    const data = await holdOrder({
      orderId: req.params.id,
      actor: req.user,
      reason: req.body.reason,
      note: req.body.note ?? null,
    });
    await announce(data.events);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/o2d/orders/:id/resume */
export const resume = async (req, res, next) => {
  try {
    const data = await resumeOrder({
      orderId: req.params.id,
      actor: req.user,
      note: req.body.note ?? null,
    });
    await announce(data.events);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// Leaving the workflow
// ---------------------------------------------------------------------------

/** POST /api/v1/o2d/orders/:id/cancel */
export const cancelOrder = async (req, res, next) => {
  try {
    const data = await exits.cancelOrder(req.params.id, req.body, req.user, ctx(req));
    await announce(data.events);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/o2d/orders/:id/void - an entry error, not a lost order. */
export const voidOrder = async (req, res, next) => {
  try {
    const data = await exits.voidOrder(req.params.id, req.body, req.user, ctx(req));
    await announce(data.events);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/o2d/orders/:id/revive */
export const reviveOrder = async (req, res, next) => {
  try {
    const data = await exits.reviveOrder(req.params.id, req.body, req.user, ctx(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/o2d/exit-register */
export const exitRegister = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await exits.listExitRegister(req.query) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/o2d/exit-register/by-stage - where orders die. */
export const exitsByStage = async (req, res, next) => {
  try {
    const data = await exits.exitsByStage({ from: req.query.from, to: req.query.to });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/o2d/orders/:id/history - Order 360's audit tab.
 *
 * Reads the SHARED audit log filtered by `meta.orderId` rather than a
 * purpose-built O2D trail. That is what makes "who moved this order" and "who
 * changed this user's role" answerable from one place - see the note on
 * `audit()` in the stage engine.
 */
export const orderHistory = async (req, res, next) => {
  try {
    const rows = await AuditLog.find({ 'meta.orderId': String(req.params.id) })
      .sort({ createdAt: -1 })
      .limit(500)
      .populate('user', 'user email')
      .lean();
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** POST /api/v1/o2d/orders/:id/documents — multipart, field name "file". */
export const uploadDocument = async (req, res, next) => {
  try {
    // The metadata arrives as multipart TEXT fields, so it has not been through
    // `validate()` — multer parses the body after the validator would have run.
    // The service checks it; the enum on the model is the backstop.
    const data = await documents.uploadDocument(
      req.params.id,
      req.file,
      {
        docType: req.body.docType,
        stageNumber: req.body.stageNumber ? Number(req.body.stageNumber) : null,
        remarks: req.body.remarks ?? null,
      },
      req.user,
      ctx(req),
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/o2d/orders/:id/documents */
export const listDocuments = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await documents.listDocuments(req.params.id) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/o2d/documents/:documentId/url — short-lived, audited. */
export const documentUrl = async (req, res, next) => {
  try {
    const { url, expiresInSeconds } = await documents.issueDocumentUrl(
      req.params.documentId, req.user, ctx(req),
    );
    res.status(200).json({ success: true, data: { url, expiresInSeconds } });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/v1/o2d/documents/:documentId — soft, and needs a reason. */
export const deleteDocument = async (req, res, next) => {
  try {
    const data = await documents.deleteDocument(
      req.params.documentId, req.body?.reason, req.user, ctx(req),
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// My Tasks
// ---------------------------------------------------------------------------

/** GET /api/v1/o2d/tasks */
export const myTasks = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await tasks.myTasks(req.user, req.query) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/o2d/tasks/counts — the badges above the list. */
export const myTaskCounts = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await tasks.myTaskCounts(req.user) });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/** GET /api/v1/o2d/analytics - the whole dashboard in one round trip. */
export const dashboard = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await analytics.fullDashboard(req.query) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/o2d/analytics/sla */
export const slaCompliance = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await analytics.slaCompliance(req.query) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/o2d/analytics/delays */
export const delays = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await analytics.delayAnalysis(req.query) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/o2d/analytics/people */
export const people = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await analytics.performanceByPerson(req.query) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/o2d/analytics/customers */
export const customers = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await analytics.performanceByCustomer(req.query) });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/o2d/analytics/export/:dataset?format=xlsx|csv
 *
 * `Content-Disposition: attachment` plus `nosniff`, so a browser downloads the
 * file rather than rendering it - the same shape the HRMS report export uses.
 */
export const exportDataset = async (req, res, next) => {
  try {
    const { format = 'xlsx', ...params } = req.query;

    if (format === 'csv') {
      const { csv, filename, rows, truncated } = await exporter.exportCsv(req.params.dataset, params);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Rows', String(rows));
      // So a caller can tell a capped export from a complete one.
      res.setHeader('X-Export-Truncated', truncated ? 'true' : 'false');
      return res.status(200).send(csv);
    }

    const { buffer, filename, rows, truncated } = await exporter.exportWorkbook(
      req.params.dataset,
      params,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Export-Rows', String(rows));
    res.setHeader('X-Export-Truncated', truncated ? 'true' : 'false');
    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Invoicing
// ---------------------------------------------------------------------------

export const createInvoice = async (req, res, next) => {
  try {
    const result = await invoicing.createInvoiceForOrder(req.params.orderId);
    if (result.ok) {
      return res.status(201).json({ success: true, data: result });
    }
    return res.status(400).json({ success: false, message: result.message });
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Stage history
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/o2d/orders/:id/history         every stage
 * GET /api/v1/o2d/orders/:id/history/:stage  one stage
 *
 * The transitions, oldest first, INCLUDING the ones no person performed - a
 * deadline passing, a hold freezing the board, the resume thawing it. Those are
 * most of a stage's timeline and appear in no audit log, because nobody did them.
 *
 * Scoped through the same viewer rules as the order itself: an account that
 * cannot see the order gets 404 rather than a history proving it exists.
 */
export const history = async (req, res, next) => {
  try {
    // Reuses getOrder's own visibility check (§20 scopes Imports to stage 6+),
    // so this endpoint cannot become a way around it.
    const order = await orders.getOrder(req.params.id, req.user);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    /*
     * The history is per-STAGE, so it has to obey the same stage scope.
     *
     * `getOrder` above already refused an order the viewer may not open, but
     * that is a different question: a Billing user may open the order and still
     * not be entitled to the stage-7 timeline. Returning the full history here
     * would hand back exactly what the order payload withheld.
     */
    const allowed = await visibleStagesFor(req.user);

    if (req.params.stageNumber != null && allowed !== null
      && !allowed.includes(Number(req.params.stageNumber))) {
      // 404, not 403 — refusing confirms the stage exists on this order.
      return res.status(404).json({ success: false, message: 'Not found.' });
    }

    const rows = await stageHistory(req.params.id, {
      stageNumber: req.params.stageNumber ?? null,
    });

    const scoped = allowed === null
      ? rows
      : rows.filter((r) => allowed.includes(Number(r.stageNumber)));

    return res.status(200).json({ success: true, data: scoped });
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** GET /api/v1/o2d/notifications - the bell. */
export const listNotifications = async (req, res, next) => {
  try {
    const data = await listForUser(req.user?._id, {
      unreadOnly: req.query.unreadOnly === 'true',
      limit: Math.min(Number(req.query.limit ?? 50), 200),
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/o2d/notifications/read
 *
 * Scoped to the caller's own rows inside `markRead`, by the query filter rather
 * than by a check after fetching - so an id belonging to somebody else matches
 * nothing instead of being found and then refused.
 */
export const readNotifications = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    res.status(200).json({ success: true, data: await markRead(req.user?._id, ids) });
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

/** GET /api/v1/o2d/stages — the twelve, for form dropdowns and the tracker. */
/**
 * GET /api/v1/o2d/stages/board
 *
 * How many live orders sit at each of the twelve stages, and how many are late.
 *
 * VIEW_O2D, not VIEW_O2D_ANALYTICS. This is an operational question — "where is
 * the work piled up right now" — which everyone who works the queue needs, and
 * it is the same population the tracker already shows them. Analytics answers a
 * different question (how fast each team closes stages, historically) and stays
 * behind its own permission.
 *
 * The service applies the caller's role scope, so an Import Team account sees
 * counts only from its floor stage upward.
 */
export const stageBoard = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await orders.stageBoard(req.user) });
  } catch (error) {
    next(error);
  }
};

export const listStageMasters = async (req, res, next) => {
  try {
    const data = await O2dStageMaster.find({ enabled: true }).sort({ stageNumber: 1 }).lean();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export default {
  createOrder, listOrders, getOrder, updateOrder, checkDuplicate,
  listBookings, getBooking,
  listItems, replaceItems,
  complete, advanceDecision, skip, hold, resume,
  uploadDocument, listDocuments, documentUrl, deleteDocument,
  cancelOrder, voidOrder, reviveOrder, exitRegister, exitsByStage, orderHistory,
  listNotifications, readNotifications,
  history,
  dashboard, slaCompliance, delays, people, customers, exportDataset,
  createInvoice,
  myTasks, myTaskCounts, listStageMasters, stageBoard,
};
