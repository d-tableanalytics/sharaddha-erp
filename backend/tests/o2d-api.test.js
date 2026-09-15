/**
 * The O2D routes, end to end.
 *
 * The service tests cover what each layer decides. These cover the WIRING —
 * the part no unit test can see:
 *
 *   - that the route guards are actually mounted, and in the right order;
 *   - that the per-stage check runs, so `work_o2d_stage` is not a skeleton key;
 *   - that the controller hands the engine's events to the notification layer.
 *     The engine deliberately returns events rather than sending them, so if the
 *     controller forgets to announce them, every service test still passes and
 *     NOTHING is ever sent. Only this catches it.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS STUBBED HERE, NOT EVEN AUTHENTICATION
 * ---------------------------------------------------------------------------
 *
 * The HRMS API tests mount a sub-router and supply `stubProtect`, because those
 * sub-routers carry no auth of their own. The O2D router owns its whole chain —
 * domain fence, then `protect`, then the permission guards — which is the safer
 * shape (it cannot be mounted unprotected by accident) and means a stub would
 * never run. Rather than loosen the router so a test can reach it, these sign a
 * real JWT against a real user.
 *
 * That buys more than it costs: permissions resolve through the genuine
 * `BASELINE_ROLE_PERMISSIONS`, so these also prove that the roles P1 added
 * actually grant what the routes require.
 */

import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import { buildTestApp, withServer, get, post } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';
import User from '../models/User.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dDocument } from '../models/o2d/O2dDocument.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dNotification } from '../models/o2d/O2dNotification.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import o2dRoutes from '../modules/o2d/o2d.routes.js';
import { STAGES, O2D_EVENTS } from '../shared/constants/o2d.js';
import { ZohoInvoice } from '../models/o2d/ZohoInvoice.js';
import { captureZohoRawBody, ZOHO_WEBHOOK_PATH } from '../modules/o2d/zoho-webhook.js';

const P = '/api/v1/o2d';
const ist = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`);

before(async () => {
  // The router's first middleware is the domain fence, which reads PORTAL.
  process.env.PORTAL = 'employee';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'o2d-api-test-secret';
  await startTestMongo();
  await syncIndexes(O2dOrder, O2dOrderStage, O2dStageMaster, O2dNotification);
});
after(async () => {
  await stopTestMongo();
});

beforeEach(async () => {
  await clearCollections();
  await seedO2dStages();
});

/**
 * A real account, carrying the role's REAL permissions.
 *
 * No permission list is supplied: `resolveUserPermissions` derives it from the
 * role, so a test asserting that Billing can complete stage 2 is also asserting
 * that the Billing role actually grants `work_o2d_stage`. Handing the user a
 * permissions array would have made that question unaskable.
 */
let seq = 0;
async function accountFor(role) {
  seq += 1;
  const user = await User.create({
    email: `o2dapi${seq}@example.com`,
    password: 'x'.repeat(12),
    user: `A ${role}`,
    role,
    status: 'Active',
  });
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { user, auth: { headers: { Authorization: `Bearer ${token}` } } };
}

const app = () =>
  buildTestApp({
    mount: (a) => a.use(P, o2dRoutes),
    // The same capture hook app.js installs, so the webhook tests below run
    // against the real raw-body path rather than a parser only tests use.
    verify: captureZohoRawBody,
  });

/**
 * Dates relative to NOW, not fixed.
 *
 * Unlike the service tests, these go through HTTP and so cannot inject a clock —
 * the service uses the real `new Date()`. A hardcoded PO date is therefore a
 * fixture with an expiry: it passes until the day it becomes "in the future"
 * and the service correctly refuses it (`O2D_FUTURE_PO_DATE`). Deriving the
 * dates from now keeps the test honest on every future run.
 */
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

const INTAKE = {
  poNumber: 'PO-4471',
  poDate: daysFromNow(-2),
  customerName: 'ABC Industries',
  promiseDate: daysFromNow(11),
  items: [{ skuCode: 'SKU-A', orderedQty: 5 }],
};

/** Create an order as Sales and return its id. */
async function seedOrder(url) {
  const sales = await accountFor('Sales');
  const res = await post(url, `${P}/orders`, INTAKE, sales.auth);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.order._id;
}

/**
 * Put a PO copy on file, so stage 2 will close.
 *
 * Stage 2 will not complete without one — "PO Copy / PO Scan -> REQUIRED
 * upload" in the stage-wise field spec. The row is written directly rather than
 * uploaded through the endpoint because these tests are about the WORKFLOW, and
 * driving multipart and object storage to prove a permission check would be a
 * slower test of something else.
 */
async function attachPoCopy(orderId) {
  const order = await O2dOrder.findById(orderId).select('poNumber').lean();
  await O2dDocument.create({
    order: orderId,
    poNumber: order.poNumber,
    docType: 'PO',
    stageNumber: STAGES.SUBMIT_PO_TO_BILLING,
    storageKey: `o2d/${orderId}/po-copy.pdf`,
    contentType: 'application/pdf',
    uploadedAt: new Date(),
  });
}

// ---------------------------------------------------------------------------

describe('intake over HTTP', () => {
  test('creates an order and returns it', async () => {
    await withServer(app(), async (url) => {
      const sales = await accountFor('Sales');
      const res = await post(url, `${P}/orders`, INTAKE, sales.auth);

      assert.equal(res.status, 201);
      assert.equal(res.body.data.order.poNumber, 'PO-4471');
      assert.equal(res.body.data.order.currentStage, STAGES.SUBMIT_PO_TO_BILLING);
    });
  });

  test('a duplicate comes back as 409 WITH the offending order attached', async () => {
    await withServer(app(), async (url) => {
      const sales = await accountFor('Sales');
      await post(url, `${P}/orders`, INTAKE, sales.auth);
      const res = await post(url, `${P}/orders`, INTAKE, sales.auth);

      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'O2D_DUPLICATE_PO');
      // Without this the UI can only say "duplicate" and leave the user stuck.
      assert.equal(res.body.data.duplicate.poNumber, 'PO-4471');
    });
  });

  test('a missing promise date with no reason is refused with a code', async () => {
    await withServer(app(), async (url) => {
      const sales = await accountFor('Sales');
      const res = await post(url, `${P}/orders`, { ...INTAKE, promiseDate: null }, sales.auth);

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'O2D_PROMISE_DATE_REQUIRED');
    });
  });

  test('zod refuses a malformed body before the service sees it', async () => {
    await withServer(app(), async (url) => {
      const sales = await accountFor('Sales');
      const res = await post(url, `${P}/orders`, { poNumber: '', customerName: '' }, sales.auth);
      assert.equal(res.status, 400);
    });
  });
});

// ---------------------------------------------------------------------------

describe('the guards are really mounted', () => {
  test('an unauthenticated request is refused', async () => {
    await withServer(app(), async (url) => {
      assert.equal((await get(url, `${P}/orders`)).status, 401);
    });
  });

  test('a signed-in account with no O2D permission is refused', async () => {
    await withServer(app(), async (url) => {
      const nobody = await accountFor('Customer');
      assert.equal((await get(url, `${P}/orders`, nobody.auth)).status, 403);
      assert.equal((await get(url, `${P}/tasks`, nobody.auth)).status, 403);
    });
  });

  test('VIEW_O2D alone cannot create an order', async () => {
    await withServer(app(), async (url) => {
      // Import Team is view-only by design (§20).
      const imports = await accountFor('Import Team');
      assert.equal((await get(url, `${P}/orders`, imports.auth)).status, 200);
      assert.equal((await post(url, `${P}/orders`, INTAKE, imports.auth)).status, 403);
    });
  });

  test('VIEW_O2D alone cannot place a hold', async () => {
    await withServer(app(), async (url) => {
      const imports = await accountFor('Import Team');
      const res = await post(
        url,
        `${P}/orders/64b7f1c2e4b0a1a2b3c4d5e6/hold`,
        { reason: 'STOCK_UNAVAILABLE' },
        imports.auth,
      );
      assert.equal(res.status, 403);
    });
  });

  test('the domain fence 404s when this deployment is not the Employee Portal', async () => {
    const previous = process.env.PORTAL;
    process.env.PORTAL = 'customer';
    try {
      await withServer(app(), async (url) => {
        const sales = await accountFor('Sales');
        const res = await get(url, `${P}/orders`, sales.auth);
        // 404, not 403: a prober learns nothing about whether O2D exists here.
        // And it fires BEFORE auth, so even a valid token gets nothing.
        assert.equal(res.status, 404);
      });
    } finally {
      process.env.PORTAL = previous;
    }
  });
});

// ---------------------------------------------------------------------------

describe('the per-stage check (§37)', () => {
  test("WORK_O2D_STAGE is not a skeleton key — a role cannot close another's stage", async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      const warehouse = await accountFor('Warehouse User');

      // The warehouse holds WORK_O2D_STAGE, but stage 3 belongs to Billing.
      const res = await post(url, `${P}/orders/${orderId}/stages/3/complete`, {}, warehouse.auth);

      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'O2D_NOT_YOUR_STAGE');
      // The message names who it DOES belong to, so the refusal is actionable.
      assert.match(res.body.message, /Billing/);
    });
  });

  test('and the role that owns it can', async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      await attachPoCopy(orderId);
      const billing = await accountFor('Billing');

      const res = await post(url, `${P}/orders/${orderId}/stages/2/complete`, {}, billing.auth);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.order.currentStage, STAGES.SEND_SOR_PI);
    });
  });

  test('a stage cannot be completed out of order without an override', async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      const billing = await accountFor('Billing');

      const res = await post(url, `${P}/orders/${orderId}/stages/6/complete`, {}, billing.auth);
      assert.equal(res.status, 422);
      assert.equal(res.body.code, 'O2D_PREREQUISITE_INCOMPLETE');
    });
  });
});

// ---------------------------------------------------------------------------

describe('the controller announces what the engine returned', () => {
  /**
   * The test that justifies this file.
   *
   * The engine returns events and sends nothing. If the controller forgets to
   * pass them on, every service test still passes and not one notification is
   * ever delivered — the exact failure the layer's never-throw design makes
   * invisible.
   */
  test("completing a stage notifies the next stage's owner", async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      await attachPoCopy(orderId);
      const billing = await accountFor('Billing');

      const res = await post(url, `${P}/orders/${orderId}/stages/2/complete`, {}, billing.auth);
      assert.equal(res.status, 200);
      // The engine reported the unlock...
      assert.ok(res.body.data.events.some((e) => e.type === O2D_EVENTS.STAGE_UNLOCKED));

      // ...and the controller turned it into a real notification.
      const rows = await O2dNotification.find({ event: O2D_EVENTS.STAGE_UNLOCKED }).lean();
      assert.ok(rows.length > 0, 'the controller must hand the engine events to the notifier');
      // Stage 3 is Billing's, so Billing is who gets told.
      assert.ok(rows.some((r) => String(r.user) === String(billing.user._id)));
    });
  });

  test('placing a hold notifies, and resuming does too', async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      const mgmt = await accountFor('Management');

      assert.equal(
        (await post(url, `${P}/orders/${orderId}/hold`, { reason: 'STOCK_UNAVAILABLE' }, mgmt.auth))
          .status,
        200,
      );
      assert.equal((await post(url, `${P}/orders/${orderId}/resume`, {}, mgmt.auth)).status, 200);

      assert.ok(await O2dNotification.findOne({ event: O2D_EVENTS.ORDER_HELD }));
      assert.ok(await O2dNotification.findOne({ event: O2D_EVENTS.ORDER_RESUMED }));
    });
  });
});

// ---------------------------------------------------------------------------

describe('the bell', () => {
  test("returns the caller's own notifications only", async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      const warehouse = await accountFor('Warehouse User');
      const billing = await accountFor('Billing');

      const { dispatchEvent } = await import('../modules/o2d/notification.service.js');
      await dispatchEvent(O2D_EVENTS.STAGE_UNLOCKED, {
        orderId,
        stageNumber: STAGES.WAREHOUSE_PICKING,
      });

      const mine = await get(url, `${P}/notifications`, warehouse.auth);
      assert.equal(mine.status, 200);
      assert.equal(mine.body.data.unread, 1);
      assert.match(mine.body.data.data[0].title, /Warehouse Picking Request/);

      // A different account sees none of them.
      const theirs = await get(url, `${P}/notifications`, billing.auth);
      assert.equal(theirs.body.data.data.length, 0);
    });
  });

  test('marking read clears the unread count', async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      const warehouse = await accountFor('Warehouse User');

      const { dispatchEvent } = await import('../modules/o2d/notification.service.js');
      await dispatchEvent(O2D_EVENTS.STAGE_UNLOCKED, {
        orderId,
        stageNumber: STAGES.WAREHOUSE_PICKING,
      });

      await post(url, `${P}/notifications/read`, { ids: [] }, warehouse.auth);
      const after = await get(url, `${P}/notifications`, warehouse.auth);
      assert.equal(after.body.data.unread, 0);
    });
  });
});

// ---------------------------------------------------------------------------

describe('the Zoho webhook is actually reachable', () => {
  /**
   * The bug this guards.
   *
   * The route was first declared after `router.use(protect)`, so every genuine
   * Zoho callback answered 401 before reaching the handler. Nothing failed
   * loudly: Zoho retries a few times, gives up, and invoice statuses simply
   * stop updating with nothing in this portal's logs to explain it. Every
   * service-level test still passed, because the handler itself was fine.
   */
  test('reaches the handler with NO Authorization header', async () => {
    await withServer(app(), async (url) => {
      const res = await post(url, `${P}/webhooks/zoho`, {
        invoice_number: 'INV-NOPE',
        status: 'paid',
      }, { headers: { 'X-Zoho-Hmac': 'mock-signature' } });

      // Specifically NOT 401. The body is irrelevant here — what matters is
      // that the request was not turned away by the session guard.
      assert.notEqual(res.status, 401, 'a webhook behind `protect` can never work');
      assert.equal(res.status, 200);
    });
  });

  test('an unsigned callback is refused', async () => {
    await withServer(app(), async (url) => {
      const res = await post(url, `${P}/webhooks/zoho`, {
        invoice_number: 'INV-X',
        status: 'paid',
      });

      assert.equal(res.status, 400);
    });
  });

  test('a malformed payload is refused rather than throwing', async () => {
    await withServer(app(), async (url) => {
      const res = await post(url, `${P}/webhooks/zoho`, { status: 'paid' }, {
        headers: { 'X-Zoho-Hmac': 'mock-signature' },
      });

      assert.equal(res.status, 400);
    });
  });
});

describe('the raw-body capture hook', () => {
  /**
   * Tested directly, not through HTTP.
   *
   * In mock mode the signature check passes regardless, so an HTTP test would
   * go green with the capture completely broken — which is how the first
   * version, matching on `req.path` instead of `req.originalUrl`, looked fine.
   */
  const buf = Buffer.from('{"invoice_number":"INV-1"}');

  test('captures the body on the webhook path', () => {
    const req = { originalUrl: ZOHO_WEBHOOK_PATH };
    captureZohoRawBody(req, null, buf);
    assert.equal(req.rawBody, buf);
  });

  test('still captures when a query string is attached', () => {
    const req = { originalUrl: `${ZOHO_WEBHOOK_PATH}?source=books` };
    captureZohoRawBody(req, null, buf);
    assert.ok(req.rawBody, 'the query string must not defeat the match');
  });

  test('keeps nothing for any other route', () => {
    const req = { originalUrl: '/api/v1/o2d/orders' };
    captureZohoRawBody(req, null, buf);
    // Buffering every request would keep a second copy of every upload and
    // import payload in memory for the benefit of one endpoint.
    assert.equal(req.rawBody, undefined);
  });

  test('ignores an empty body', () => {
    const req = { originalUrl: ZOHO_WEBHOOK_PATH };
    captureZohoRawBody(req, null, Buffer.alloc(0));
    assert.equal(req.rawBody, undefined);
  });
});

describe('raising an invoice over HTTP', () => {
  test('a read-only role is refused', async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      const imports = await accountFor('Import Team');

      const res = await post(url, `${P}/orders/${orderId}/invoice`, {}, imports.auth);

      // Raising an invoice is a financial act, not a way of reading an order.
      // Gated on VIEW_O2D this would have been open to the Import Team, whose
      // access is read-only by definition (§20).
      assert.equal(res.status, 403);
    });
  });

  test('Billing can raise one, and it is recorded', async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      const billing = await accountFor('Billing');

      const res = await post(url, `${P}/orders/${orderId}/invoice`, {}, billing.auth);

      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.ok(res.body.data.invoiceNumber);

      const row = await ZohoInvoice.findOne({ order: orderId }).lean();
      assert.equal(row.status, 'CREATED');
    });
  });

  test('and raising it twice does not buy a second invoice', async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      const billing = await accountFor('Billing');

      const first = await post(url, `${P}/orders/${orderId}/invoice`, {}, billing.auth);
      const second = await post(url, `${P}/orders/${orderId}/invoice`, {}, billing.auth);

      assert.equal(second.body.data.invoiceNumber, first.body.data.invoiceNumber);
      assert.equal(await ZohoInvoice.countDocuments({ order: orderId }), 1);
    });
  });
});

// ---------------------------------------------------------------------------

describe('the role that must upload a stage document may actually upload it', () => {
  /**
   * A live 403 came from here.
   *
   * Stage 2 will not close without the PO copy and stage 12 will not close
   * without the AWB/LR copy — both stages closed by Billing. The upload route
   * required CREATE_O2D_ORDER, which Billing does not hold, so the only role
   * permitted to complete those stages was refused the upload they need first.
   *
   * The two halves of the rule were each defensible and together made a stage
   * impossible to complete, which is the kind of gap no single test of either
   * half would have caught.
   */
  test('Billing is not refused the upload endpoint', async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      const billing = await accountFor('Billing');

      const res = await fetch(`${url}${P}/orders/${orderId}/documents`, {
        method: 'POST',
        headers: billing.auth.headers,
      });

      // Not 403. A 400 is the RIGHT answer here — no multipart body was sent —
      // and asserting "not forbidden" rather than "200" keeps this about the
      // permission without needing a real file upload.
      assert.notEqual(res.status, 403, 'Billing must be able to attach a stage document');
    });
  });

  test('Sales keeps the intake upload it always had', async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      const sales = await accountFor('Sales');

      const res = await fetch(`${url}${P}/orders/${orderId}/documents`, {
        method: 'POST',
        headers: sales.auth.headers,
      });
      assert.notEqual(res.status, 403);
    });
  });

  test('a role with neither key is still refused', async () => {
    await withServer(app(), async (url) => {
      const orderId = await seedOrder(url);
      // Import Team is read-only from stage 6 (§20) and works no stage.
      const imports = await accountFor('Import Team');

      const res = await fetch(`${url}${P}/orders/${orderId}/documents`, {
        method: 'POST',
        headers: imports.auth.headers,
      });
      // Widening the guard must not have opened it to everyone.
      assert.equal(res.status, 403);
    });
  });
});
