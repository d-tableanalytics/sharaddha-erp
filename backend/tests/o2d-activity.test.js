/**
 * Order 360's two history feeds, over HTTP.
 *
 * `/orders/:id/history` (the stage timeline) and the audit trail used to be
 * registered on the SAME path. Express ran the first, so the audit handler was
 * unreachable and the drawer's Activity section rendered stage events as blank
 * audit rows. The audit trail now lives at `/orders/:id/activity`; these pin
 * both paths to their own record, and pin the scopes the newly reachable one
 * must obey.
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import { buildTestApp, withServer, get, post } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { O2dOrder } from '../models/o2d/O2dOrder.js';
import { O2dOrderStage } from '../models/o2d/O2dOrderStage.js';
import { O2dStageMaster } from '../models/o2d/O2dStageMaster.js';
import { O2dNotification } from '../models/o2d/O2dNotification.js';
import { seedO2dStages } from '../config/seedO2dStages.js';
import o2dRoutes from '../modules/o2d/o2d.routes.js';

const P = '/api/v1/o2d';

before(async () => {
  process.env.PORTAL = 'employee';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'o2d-activity-test-secret';
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

let seq = 0;
async function accountFor(role) {
  seq += 1;
  const user = await User.create({
    email: `o2dactivity${seq}@example.com`,
    password: 'x'.repeat(12),
    user: `A ${role}`,
    role,
    status: 'Active',
  });
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { user, auth: { headers: { Authorization: `Bearer ${token}` } } };
}

const app = () => buildTestApp({ mount: (a) => a.use(P, o2dRoutes) });
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

async function seedOrder(url, sales) {
  const res = await post(url, `${P}/orders`, {
    poNumber: 'PO-7781',
    poDate: daysFromNow(-2),
    customerName: 'ABC Industries',
    promiseDate: daysFromNow(11),
    items: [{ skuCode: 'SKU-A', orderedQty: 5 }],
  }, sales.auth);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.order._id;
}

test('/activity returns the audit trail, /history the stage timeline', async () => {
  await withServer(app(), async (url) => {
    const sales = await accountFor('Sales');
    const orderId = await seedOrder(url, sales);

    const activity = await get(url, `${P}/orders/${orderId}/activity`, sales.auth);
    assert.equal(activity.status, 200, JSON.stringify(activity.body));
    const created = activity.body.data.find((r) => /created for ABC Industries/.test(r.remarks));
    assert.ok(created, 'the order-created audit row is in the Activity feed');
    assert.ok(created.createdAt, 'audit rows carry the timestamp the drawer renders');

    const history = await get(url, `${P}/orders/${orderId}/history`, sales.auth);
    assert.equal(history.status, 200);
    assert.ok(history.body.data.length > 0);
    // Stage events, not audit rows — the shape the Stage history section reads.
    assert.ok(history.body.data.every((e) => 'stageNumber' in e && 'to' in e && !('remarks' in e)));
  });
});

test('/activity hides stage-level rows for stages the viewer cannot see', async () => {
  await withServer(app(), async (url) => {
    const sales = await accountFor('Sales');
    const orderId = await seedOrder(url, sales);

    const salesStages = (await O2dStageMaster.find({ enabled: true }).lean())
      .filter((m) => [m.ownerRole, m.completedByRole, ...(m.alsoAllowedRoles ?? [])].includes('Sales'))
      .map((m) => m.stageNumber);
    const hidden = (await O2dStageMaster.findOne({ stageNumber: { $nin: salesStages } }).lean()).stageNumber;

    await AuditLog.create([
      { action: 'TEST', remarks: 'visible stage row', meta: { orderId, stageNumber: salesStages[0] } },
      { action: 'TEST', remarks: 'hidden stage row', meta: { orderId, stageNumber: hidden } },
    ]);

    const res = await get(url, `${P}/orders/${orderId}/activity`, sales.auth);
    assert.equal(res.status, 200);
    const remarks = res.body.data.map((r) => r.remarks);
    assert.ok(remarks.includes('visible stage row'));
    assert.ok(!remarks.includes('hidden stage row'));
  });
});

test('/activity answers 404 for an order that does not exist', async () => {
  await withServer(app(), async (url) => {
    const sales = await accountFor('Sales');
    const res = await get(url, `${P}/orders/64b000000000000000000000/activity`, sales.auth);
    assert.equal(res.status, 404);
  });
});
