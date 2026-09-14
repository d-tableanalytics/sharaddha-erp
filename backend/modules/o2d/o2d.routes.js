/**
 * O2D routes, mounted at /api/v1/o2d.
 *
 * ---------------------------------------------------------------------------
 * THREE LAYERS OF AUTHORISATION, AND WHY NONE OF THEM IS REDUNDANT
 * ---------------------------------------------------------------------------
 *
 *   1. THE DOMAIN. `requirePortalModule('o2d')` answers 404 unless this
 *      deployment is the Employee Portal. O2D is internal; a customer-domain URL
 *      should not reveal that it exists. This sits OUTSIDE the permission system
 *      on purpose — a Super Admin satisfies every permission check ever written,
 *      so a fence built from permissions would fail to contain exactly the
 *      accounts that matter most.
 *
 *   2. THE CAPABILITY. `authorize(...)` asks whether this role does this KIND of
 *      thing: view orders, create them, work a stage, place a hold.
 *
 *   3. THE STAGE. Whether a role may close stage 7 is not a capability — it is a
 *      property of the stage master, which an administrator edits without a
 *      deploy (§37). A route guard is fixed at mount time and cannot answer it,
 *      so the controller re-asks per request via `canWorkStage`.
 *
 * Layer 2 without layer 3 would let anyone holding WORK_O2D_STAGE close every
 * stage in the workflow, which is the whole point of having twelve of them.
 */

import express from 'express';

import { protect } from '../../middlewares/auth.js';
import { authorize, PERMISSIONS } from '../../middlewares/rbac.js';
import { requirePortalModule } from '../../middlewares/portalGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  createO2dOrderSchema,
  updateO2dOrderSchema,
  replaceO2dItemsSchema,
  completeStageSchema,
  advanceDecisionSchema,
  skipStageSchema,
  holdOrderSchema,
  resumeOrderSchema,
  listO2dOrdersQuery,
  listBookingsQuery,
  myTasksQuery,
  exitOrderSchema,
  reviveOrderSchema,
  exitRegisterQuery,
  analyticsQuery,
  exportQuery,
} from '../../shared/schemas/o2d.js';
import {
  uploadDocumentFile,
  handleDocumentUploadErrors,
} from '../hrms/documents/documentUpload.js';
import * as controller from './o2d.controller.js';
import { handleWebhook } from './zoho-webhook.js';

const router = express.Router();

// The domain fence first: an unavailable module should 404 before it asks who
// you are, so the customer domain cannot probe for O2D by reading status codes.
router.use(requirePortalModule('o2d'));

/**
 * The Zoho webhook, declared BEFORE `protect` — the one route here without a
 * session.
 *
 * Zoho holds no JWT and never will. Behind `protect` this endpoint answers 401
 * to every legitimate callback, which fails silently: Zoho retries a few times,
 * gives up, and invoice statuses simply stop updating with nothing in this
 * portal's logs to say why.
 *
 * It is NOT unauthenticated, it is authenticated differently — by an HMAC over
 * the raw body (see zoho-webhook.js). It stays inside `requirePortalModule` so
 * a customer-portal deployment does not expose it at all.
 */
router.post('/webhooks/zoho', handleWebhook);

router.use(protect);

const canView = authorize(PERMISSIONS.VIEW_O2D);
const canCreate = authorize(PERMISSIONS.CREATE_O2D_ORDER);
const canWork = authorize(PERMISSIONS.WORK_O2D_STAGE);
const canHold = authorize(PERMISSIONS.HOLD_O2D);
const canExit = authorize(PERMISSIONS.EXIT_O2D);
// Its own permission, not VIEW_O2D. Seeing the orders you work is a different
// thing from seeing how fast each team closes them: the second is a management
// view, and several roles that need the first should not have the second.
const canSeeAnalytics = authorize(PERMISSIONS.VIEW_O2D_ANALYTICS);

// ---------------------------------------------------------------------------
// My Tasks. Declared before `/orders/:id` cannot matter — different prefix —
// but kept first because it is the screen most users open.
// ---------------------------------------------------------------------------

router.get('/tasks', canView, validate({ query: myTasksQuery }), controller.myTasks);
router.get('/tasks/counts', canView, controller.myTaskCounts);

// The bell. Only VIEW_O2D, and the service scopes every read and write to the
// caller's own rows - there is no route by which one user reads another's.
router.get('/notifications', canView, controller.listNotifications);
router.post('/notifications/read', canView, controller.readNotifications);

/** The stage master, read-only. Editing it needs MANAGE_O2D_MASTERS (P5). */
router.get('/stages', canView, controller.listStageMasters);

/**
 * The stage board — live orders per stage, with the late count (§27).
 *
 * Declared AFTER `/stages` but the two cannot collide: both are literal paths,
 * and there is no `/stages/:param` route for "board" to be swallowed by. If one
 * is ever added, it must come after this line.
 */
router.get('/stages/board', canView, controller.stageBoard);

// ---------------------------------------------------------------------------
// Orders. Literal paths before `/:id`, so `check-duplicate` is not read as one.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Customer Portal bookings (§3)
// ---------------------------------------------------------------------------
//
// `canCreate`, NOT `canView`. These endpoints read the shared `orders`
// collection — the customer's own commercial activity — and the sole reason the
// Employee Portal surfaces it is so Sales can raise an O2D order from a
// booking. Gated on VIEW_O2D it would hand every role that can read the tracker
// a browsable list of customer bookings, which is a wider disclosure than
// anything else in this module makes.

router.get('/bookings', canCreate, validate({ query: listBookingsQuery }), controller.listBookings);
router.get('/bookings/:bookingId', canCreate, controller.getBooking);

router.get('/orders/check-duplicate', canCreate, controller.checkDuplicate);

router.get('/orders', canView, validate({ query: listO2dOrdersQuery }), controller.listOrders);
router.post('/orders', canCreate, validate({ body: createO2dOrderSchema }), controller.createOrder);

router.get('/orders/:id', canView, controller.getOrder);
router.patch('/orders/:id', canCreate, validate({ body: updateO2dOrderSchema }), controller.updateOrder);

router.get('/orders/:id/items', canView, controller.listItems);
router.put(
  '/orders/:id/items',
  canCreate,
  validate({ body: replaceO2dItemsSchema }),
  controller.replaceItems,
);

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Stage 4 has its own route rather than being a `complete` with a flag.
 *
 * The decision writes a header field AND determines whether stage 5 is skipped,
 * and the ordering of those two matters (see `decideAdvance`). A generic
 * complete would have to special-case stage 4 anyway; naming it keeps the
 * special case visible in the API rather than buried in a conditional.
 */
router.post(
  '/orders/:id/advance-decision',
  canWork,
  validate({ body: advanceDecisionSchema }),
  controller.advanceDecision,
);

/**
 * The stage timeline. Behind `canView`, like the order it describes.
 *
 * Declared BEFORE the `/complete` route below only for readability - they do
 * not collide, since these are GETs on a different path - but the two-segment
 * form is registered first so `/history/7` can never be read as a stage id.
 */
router.get('/orders/:id/history', canView, controller.history);
router.get('/orders/:id/history/:stageNumber', canView, controller.history);

router.post(
  '/orders/:id/stages/:stageNumber/complete',
  canWork,
  validate({ body: completeStageSchema }),
  controller.complete,
);
router.post(
  '/orders/:id/stages/:stageNumber/skip',
  canWork,
  validate({ body: skipStageSchema }),
  controller.skip,
);

router.post('/orders/:id/hold', canHold, validate({ body: holdOrderSchema }), controller.hold);
router.post('/orders/:id/resume', canHold, validate({ body: resumeOrderSchema }), controller.resume);

// ---------------------------------------------------------------------------
// Leaving the workflow
// ---------------------------------------------------------------------------
//
// EXIT_O2D is a separate permission from HOLD_O2D on purpose: pausing an order
// is an operational act the people working it should be able to take, while
// removing one from the workflow ends the customer's order and is not.

router.get('/exit-register', canView, validate({ query: exitRegisterQuery }), controller.exitRegister);
router.get('/exit-register/by-stage', canView, controller.exitsByStage);

router.post('/orders/:id/cancel', canExit, validate({ body: exitOrderSchema }), controller.cancelOrder);
router.post('/orders/:id/void', canExit, validate({ body: exitOrderSchema }), controller.voidOrder);
router.post('/orders/:id/revive', canExit, validate({ body: reviveOrderSchema }), controller.reviveOrder);

/** Order 360's history tab. */
router.get('/orders/:id/history', canView, controller.orderHistory);

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

router.get('/analytics', canSeeAnalytics, validate({ query: analyticsQuery }), controller.dashboard);
router.get('/analytics/sla', canSeeAnalytics, validate({ query: analyticsQuery }), controller.slaCompliance);
router.get('/analytics/delays', canSeeAnalytics, validate({ query: analyticsQuery }), controller.delays);
router.get('/analytics/people', canSeeAnalytics, validate({ query: analyticsQuery }), controller.people);
router.get('/analytics/customers', canSeeAnalytics, validate({ query: analyticsQuery }), controller.customers);

/** Declared last in this block so `/analytics/export/...` is not read as a report key. */
router.get(
  '/analytics/export/:dataset',
  canSeeAnalytics,
  validate({ query: exportQuery }),
  controller.exportDataset,
);

// ---------------------------------------------------------------------------
// Invoicing
// ---------------------------------------------------------------------------

/**
 * `canWork`, NOT `canView`.
 *
 * Raising an invoice is a financial act, not a way of looking at an order.
 * Gated on VIEW_O2D it would be available to every role that can merely read
 * the tracker — including the Import Team, whose access is read-only by
 * definition (§20).
 */
router.post('/orders/:orderId/invoice', canWork, controller.createInvoice);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
//
// The multer middleware and its error translator are the HRMS ones, reused
// unchanged: memory storage, one file, a 10 MB ceiling, and magic-byte sniffing
// in the service. `validate()` is deliberately absent from the upload route —
// multer parses the multipart body, so a body validator mounted before it would
// see nothing, and one mounted after would run too late to matter.

router.get('/orders/:id/documents', canView, controller.listDocuments);
router.post(
  '/orders/:id/documents',
  // CREATE_O2D_ORDER rather than WORK_O2D_STAGE: attaching the customer's PO is
  // part of keying the order in, and it happens before any stage is worked.
  canCreate,
  uploadDocumentFile,
  handleDocumentUploadErrors,
  controller.uploadDocument,
);

router.get('/documents/:documentId/url', canView, controller.documentUrl);
router.delete('/documents/:documentId', canCreate, controller.deleteDocument);

export default router;
