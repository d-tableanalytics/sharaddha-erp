/**
 * Employee Portal <-> HRMS synchronisation.
 *
 * These run against a real MongoDB, because the guarantee under test is a
 * database guarantee: "one account resolves to exactly one employee" is held by
 * the partial unique index on `Employee.userId`, and asserting it against a
 * mock would only prove the mock agrees with itself.
 *
 * What they cover, in the order the requirement states it:
 *
 *   1  creating a portal user creates the HRMS employee
 *   2  the details entered at creation are mapped across
 *   3  it works through the HTTP route, not only the service
 *   4  editing a portal user updates the employee
 *   5  status changes stay in step in BOTH directions
 *   6  duplicates are impossible, and reruns are no-ops
 *   7  paths other than the create screen are covered
 *   +  failures queue and retry rather than vanishing
 *   +  the reconciliation sweep is the backstop for everything else
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';

import User from '../models/User.js';
import ArchivedUser from '../models/ArchivedUser.js';
import Employee from '../models/hrms/Employee.js';
import EmployeeSyncJob from '../models/hrms/EmployeeSyncJob.js';
import AuditLog from '../models/AuditLog.js';
import userRoutes from '../modules/users/user.routes.js';
import {
  syncUserSafely,
  syncUserToEmployee,
  reconcileEmployeeRecords,
  retryFailedSyncs,
  needsEmployeeRecord,
  splitDisplayName,
  portalStatusForEmployeeStatus,
  SYNC_AUDIT,
} from '../modules/hrms/employees/employeeSync.service.js';
import { HRMS_ROLES as R } from '../shared/permissions/constants.js';
import employeeRoutes from '../modules/hrms/employees/employee.routes.js';
import { hrmsAuthorizationChain, setEmployeeResolver } from '../middlewares/hrmsAuth.js';
import { hrmsErrorHandler } from '../modules/hrms/hrms.errors.js';
import {
  registerReferenceProvider,
  __resetReferenceProviders,
} from '../modules/hrms/references/reference.service.js';
import { employeeReferenceProvider } from '../modules/hrms/employees/employee.provider.js';
import { buildTestApp, stubProtect, withServer, post, patch, put } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

const oid = () => new mongoose.Types.ObjectId();

before(async () => {
  await startTestMongo();
  // The partial unique index on `Employee.userId` IS the duplicate guarantee.
  // Without building it first, the duplicate test would pass for the wrong
  // reason - mongoose creates indexes in the background.
  await syncIndexes(Employee, User, EmployeeSyncJob);
});

after(async () => {
  await stopTestMongo();
});

beforeEach(async () => {
  await clearCollections();
  __resetReferenceProviders();
  registerReferenceProvider('employee', employeeReferenceProvider);
  setEmployeeResolver((userId) => employeeReferenceProvider.byUserId(userId));
});

let seq = 0;
const makeUser = async (over = {}) => {
  seq += 1;
  return User.create({
    email: over.email ?? `staff${seq}@shraddhaimpex.com`,
    password: 'hashed',
    user: over.user ?? `Staff ${seq}`,
    role: over.role ?? 'Sales',
    status: over.status ?? 'Active',
    ...over,
  });
};

/** The HRMS side, for the reverse direction. */
const hrmsApp = (actor) => buildTestApp({
  mount: (app) => {
    const router = express.Router();
    router.use(stubProtect(actor));
    router.use(hrmsAuthorizationChain);
    router.use('/employees', employeeRoutes);
    router.use(hrmsErrorHandler);
    app.use('/api/v1/hrms', router);
  },
});

const adminApp = () => buildTestApp({
  mount: (app) => {
    app.use(stubProtect({ _id: oid(), role: 'Admin', status: 'Active' }));
    app.use('/api/v1/users', userRoutes);
  },
});

// ---------------------------------------------------------------------------
// The mapping itself
// ---------------------------------------------------------------------------

test('a display name splits into first and last name, and an email is the fallback', () => {
  assert.deepEqual(splitDisplayName('Priya Sharma', 'p@x.com'), {
    firstName: 'Priya', lastName: 'Sharma',
  });
  // Everything after the first token is the surname, matching the join that
  // `updateEmployee` performs in the other direction.
  assert.deepEqual(splitDisplayName('Ravi Kumar Singh', 'r@x.com'), {
    firstName: 'Ravi', lastName: 'Kumar Singh',
  });
  // One word reports a null surname rather than inventing one. What to do about
  // it differs between create and update, which is why it is reported.
  assert.deepEqual(splitDisplayName('Priya', 'p@x.com'), {
    firstName: 'Priya', lastName: null,
  });
  // No display name at all: the email local part, split on its separators.
  assert.deepEqual(splitDisplayName('', 'priya.sharma@x.com'), {
    firstName: 'Priya', lastName: 'Sharma',
  });
  assert.deepEqual(splitDisplayName(null, 'admin@x.com'), {
    firstName: 'Admin', lastName: null,
  });
  assert.deepEqual(splitDisplayName('   ', '@x.com'), {
    firstName: null, lastName: null,
  });
});

test('AD-4: a customer account is never an employee, every staff role is', () => {
  assert.equal(needsEmployeeRecord({ _id: oid(), role: 'Customer' }), false);
  for (const role of ['Admin', 'Sales', 'Management', 'Inventory Manager', 'Super Admin']) {
    assert.equal(needsEmployeeRecord({ _id: oid(), role }), true, role);
  }
});

test('employee status maps back to a portal status only where a login has an opinion', () => {
  assert.equal(portalStatusForEmployeeStatus('suspended'), 'Suspended');
  assert.equal(portalStatusForEmployeeStatus('exited'), 'Suspended');
  assert.equal(portalStatusForEmployeeStatus('invited'), 'Inactive');
  // All three mean "still working here" as far as signing in is concerned.
  assert.equal(portalStatusForEmployeeStatus('active'), 'Active');
  assert.equal(portalStatusForEmployeeStatus('probation'), 'Active');
  assert.equal(portalStatusForEmployeeStatus('notice'), 'Active');
});

// ---------------------------------------------------------------------------
// 1-3: creation
// ---------------------------------------------------------------------------

test('creating a staff account creates the HRMS employee behind it', async () => {
  const user = await makeUser({ user: 'Priya Sharma', role: 'Sales' });

  const result = await syncUserSafely(user, { reason: 'user.created' });
  assert.equal(result.action, 'created');

  const employee = await Employee.findOne({ userId: user._id }).lean();
  assert.ok(employee, 'an employee record exists for the new account');
  assert.equal(employee.firstName, 'Priya');
  assert.equal(employee.lastName, 'Sharma');
  assert.equal(employee.status, 'active', 'an Active login is an active employee');
  assert.equal(String(employee.userId), String(user._id), 'linked by the one mapping there is');
  assert.ok(/^EMP\d{4}$/.test(employee.employeeCode), employee.employeeCode);

  // The login now carries HRMS access, or the record would exist and be
  // unreachable: `requireHrmsAccess` refuses an account with no `hrms_*` key.
  const after = await User.findById(user._id).lean();
  assert.ok(after.roles.includes(R.EMPLOYEE));
  assert.equal(after.role, 'Sales', 'the portal role is untouched');
});

test('a customer account gets no employee record', async () => {
  const customer = await makeUser({
    role: 'Customer', user: 'Acme Traders', email: 'buyer@acme.com',
  });

  const result = await syncUserSafely(customer, { reason: 'user.created' });

  assert.equal(result.action, 'skipped');
  assert.equal(result.reason, 'portal-only-role');
  assert.equal(await Employee.countDocuments({ userId: customer._id }), 0);
  const after = await User.findById(customer._id).lean();
  assert.deepEqual(after.roles, [], 'and no HRMS role either (AD-4)');
});

test('generated employee codes do not collide and do not disturb imported ones', async () => {
  // An imported employee, on the business's own numbering.
  await Employee.create({
    employeeCode: 'SI-1042',
    firstName: 'Imported',
    lastName: 'Person',
    dateOfJoining: new Date('2020-01-01'),
    status: 'active',
  });

  const a = await makeUser({ user: 'One Person' });
  const b = await makeUser({ user: 'Two Person' });
  await syncUserSafely(a);
  await syncUserSafely(b);

  const codes = (await Employee.find({}).select('employeeCode').lean())
    .map((e) => e.employeeCode).sort();
  assert.deepEqual(codes, ['EMP0001', 'EMP0002', 'SI-1042'], 'sequential, and SI-1042 untouched');
});

test('the one-word name case produces a record rather than failing', async () => {
  const user = await makeUser({ user: 'Warehouse' });

  const result = await syncUserSafely(user);

  assert.equal(result.action, 'created');
  assert.equal(result.placeholderName, true, 'reported, so HR knows to finish it');
  const employee = await Employee.findOne({ userId: user._id }).lean();
  assert.equal(employee.firstName, 'Warehouse');
  assert.equal(employee.lastName, '-', 'visibly a placeholder, not a guess');
});

test('POST /api/v1/users creates both halves in one request', async () => {
  await withServer(adminApp(), async (url) => {
    const res = await post(url, '/api/v1/users', {
      email: 'ravi.kumar@shraddhaimpex.com',
      password: 'initial-password',
      user: 'Ravi Kumar',
      role: 'Sales',
      status: 'Active',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    // Additive: `data` is still the user row the admin screen stores.
    assert.equal(res.body.data.email, 'ravi.kumar@shraddhaimpex.com');
    assert.equal(res.body.hrms.action, 'created');
  });

  const user = await User.findOne({ email: 'ravi.kumar@shraddhaimpex.com' }).lean();
  const employee = await Employee.findOne({ userId: user._id }).lean();
  assert.ok(employee, 'HR never has to type this person in again');
  assert.equal(employee.firstName, 'Ravi');
  assert.equal(employee.lastName, 'Kumar');
});

test('the creation is audited, with the account and the record both named', async () => {
  const user = await makeUser({ user: 'Asha Rao' });
  await syncUserSafely(user, { reason: 'user.created' });

  const entry = await AuditLog.findOne({ action: SYNC_AUDIT.CREATED }).lean();
  assert.ok(entry, 'a sync that creates a person is a recorded event');
  assert.equal(entry.meta.userId, String(user._id));
  assert.equal(entry.meta.trigger, 'user.created');
  assert.ok(entry.meta.employeeCode);
});

// ---------------------------------------------------------------------------
// 4-5: updates and status
// ---------------------------------------------------------------------------

test('renaming a portal account renames the employee', async () => {
  const user = await makeUser({ user: 'Priya Sharma' });
  await syncUserSafely(user);

  await User.updateOne({ _id: user._id }, { $set: { user: 'Priya Mehta' } });
  const result = await syncUserSafely(await User.findById(user._id).lean());

  assert.equal(result.action, 'updated');
  assert.deepEqual(result.changed, ['name']);
  const employee = await Employee.findOne({ userId: user._id }).lean();
  assert.equal(employee.lastName, 'Mehta');
});

test('a one-word display name never overwrites a real surname', async () => {
  const user = await makeUser({ user: 'Priya Sharma' });
  await syncUserSafely(user);

  // Somebody shortening their own profile name must not damage the HR record.
  await User.updateOne({ _id: user._id }, { $set: { user: 'Priya' } });
  const result = await syncUserSafely(await User.findById(user._id).lean());

  assert.equal(result.action, 'noop');
  const employee = await Employee.findOne({ userId: user._id }).lean();
  assert.equal(employee.lastName, 'Sharma', 'left exactly as HR had it');
});

test('suspending the login suspends the employee, and restoring it brings them back', async () => {
  const user = await makeUser({ user: 'Vikram Patel' });
  await syncUserSafely(user);

  await User.updateOne({ _id: user._id }, { $set: { status: 'Inactive' } });
  await syncUserSafely(await User.findById(user._id).lean());
  assert.equal((await Employee.findOne({ userId: user._id }).lean()).status, 'suspended');

  await User.updateOne({ _id: user._id }, { $set: { status: 'Active' } });
  await syncUserSafely(await User.findById(user._id).lean());
  assert.equal((await Employee.findOne({ userId: user._id }).lean()).status, 'active');
});

test('the portal says WHETHER someone has access, never what stage they are at', async () => {
  const user = await makeUser({ user: 'Neha Gupta' });
  await syncUserSafely(user);
  await Employee.updateOne({ userId: user._id }, { $set: { status: 'notice' } });

  // An unrelated portal edit on an Active account must not end a notice period.
  await User.updateOne({ _id: user._id }, { $set: { company: 'Shraddha Impex' } });
  const result = await syncUserSafely(await User.findById(user._id).lean());

  assert.equal(result.action, 'noop');
  assert.equal((await Employee.findOne({ userId: user._id }).lean()).status, 'notice');
});

test('an exited employee is not reactivated by a portal status change', async () => {
  const user = await makeUser({ user: 'Gone Person' });
  await syncUserSafely(user);
  await Employee.updateOne({ userId: user._id }, { $set: { status: 'exited' } });

  await User.updateOne({ _id: user._id }, { $set: { status: 'Inactive' } });
  await syncUserSafely(await User.findById(user._id).lean());

  assert.equal((await Employee.findOne({ userId: user._id }).lean()).status, 'exited');
});

test('PATCH /api/v1/users suspending an account reaches the employee record', async () => {
  const user = await makeUser({ user: 'Suspend Me' });
  await syncUserSafely(user);

  await withServer(adminApp(), async (url) => {
    const res = await patch(url, `/api/v1/users/${user._id}`, { status: 'Suspended' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  // The login is parked in the archive; the employee record says suspended.
  assert.equal(await User.countDocuments({ _id: user._id }), 0);
  assert.equal(await ArchivedUser.countDocuments({ _id: user._id }), 1);
  assert.equal((await Employee.findOne({ userId: user._id }).lean()).status, 'suspended');
});

// ---------------------------------------------------------------------------
// 6: no duplicates
// ---------------------------------------------------------------------------

test('syncing the same account repeatedly produces exactly one employee', async () => {
  const user = await makeUser({ user: 'Idempotent Person' });

  await syncUserSafely(user);
  const second = await syncUserSafely(await User.findById(user._id).lean());
  const third = await syncUserSafely(await User.findById(user._id).lean());

  assert.equal(second.action, 'noop');
  assert.equal(third.action, 'noop');
  assert.equal(await Employee.countDocuments({ userId: user._id }), 1);
});

test('two concurrent syncs still produce one employee', async () => {
  const user = await makeUser({ user: 'Race Person' });

  const results = await Promise.all([
    syncUserSafely(await User.findById(user._id).lean()),
    syncUserSafely(await User.findById(user._id).lean()),
  ]);

  assert.equal(await Employee.countDocuments({ userId: user._id }), 1, 'the index decides');
  assert.ok(results.every((r) => r.action !== 'failed'), JSON.stringify(results));
});

test('a deactivated employee is never resurrected by a portal edit', async () => {
  const user = await makeUser({ user: 'Service Account' });
  await syncUserSafely(user);
  // HR deactivates the record: the documented way to say "not a person".
  await Employee.updateOne(
    { userId: user._id },
    { $set: { deletedAt: new Date(), status: 'exited' } },
  );

  await User.updateOne({ _id: user._id }, { $set: { user: 'Service Account Renamed' } });
  const result = await syncUserSafely(await User.findById(user._id).lean());

  assert.equal(result.action, 'skipped');
  assert.equal(result.reason, 'employee-deactivated');
  assert.equal(await Employee.countDocuments({ userId: user._id }), 1);
  const employee = await Employee.findOne({ userId: user._id }).lean();
  assert.ok(employee.deletedAt, 'still deactivated');
  assert.equal(employee.firstName, 'Service', 'and untouched');
});

// ---------------------------------------------------------------------------
// Failure handling, retry, reconciliation
// ---------------------------------------------------------------------------

test('a failed sync queues the account instead of losing it, and the retry drains it', async (t) => {
  const user = await makeUser({ user: 'Flaky Person' });

  // One transient failure, exactly where a database blink would land.
  const original = Employee.create;
  let failed = false;
  t.mock.method(Employee, 'create', async function failOnce(...args) {
    if (!failed) {
      failed = true;
      throw new Error('connection reset by peer');
    }
    return original.apply(this, args);
  });

  const first = await syncUserSafely(user, { reason: 'user.created' });
  assert.equal(first.action, 'failed', 'reported, not thrown: the account was already created');
  assert.equal(await Employee.countDocuments({ userId: user._id }), 0);

  const job = await EmployeeSyncJob.findOne({ userId: user._id }).lean();
  assert.ok(job, 'the account is queued rather than forgotten');
  assert.equal(job.attempts, 1);
  assert.match(job.lastError, /connection reset/);
  assert.ok(await AuditLog.findOne({ action: SYNC_AUDIT.FAILED }), 'and the failure is audited');

  // The sweep, once the backoff has elapsed.
  const summary = await retryFailedSyncs({ now: new Date(Date.now() + 60 * 60_000) });

  assert.equal(summary.succeeded, 1);
  assert.ok(await Employee.findOne({ userId: user._id }), 'the record arrives late, not never');
  assert.equal(await EmployeeSyncJob.countDocuments({}), 0, 'and leaves the queue');
});

test('the queue holds one row per account however many times it fails', async (t) => {
  const user = await makeUser({ user: 'Repeatedly Failing' });
  t.mock.method(Employee, 'create', async () => { throw new Error('still down'); });

  await syncUserSafely(user);
  await syncUserSafely(await User.findById(user._id).lean());
  await syncUserSafely(await User.findById(user._id).lean());

  assert.equal(await EmployeeSyncJob.countDocuments({}), 1, 'a backlog of people, not of attempts');
  assert.equal((await EmployeeSyncJob.findOne({}).lean()).attempts, 3);
});

test('a queued account that no longer exists drops out rather than retrying forever', async () => {
  const ghost = oid();
  await EmployeeSyncJob.create({ userId: ghost, email: 'gone@x.com', nextAttemptAt: new Date(0) });

  const summary = await retryFailedSyncs();

  assert.equal(summary.abandoned, 1);
  assert.equal(await EmployeeSyncJob.countDocuments({}), 0);
});

test('reconciliation is the backstop: staff accounts this feature never saw get records', async () => {
  // Three accounts written before any of this existed.
  const sales = await makeUser({ user: 'Legacy Sales', role: 'Sales' });
  const admin = await makeUser({ user: 'Legacy Admin', role: 'Admin' });
  const customer = await makeUser({ user: 'Legacy Buyer', role: 'Customer', email: 'b@acme.com' });

  const dry = await reconcileEmployeeRecords({ dryRun: true });
  assert.equal(dry.created, 2, 'the two staff accounts, not the customer');
  assert.equal(await Employee.countDocuments({}), 0, 'and a dry run writes nothing');

  const run = await reconcileEmployeeRecords();

  assert.equal(run.created, 2);
  assert.ok(await Employee.findOne({ userId: sales._id }));
  assert.ok(await Employee.findOne({ userId: admin._id }));
  assert.equal(await Employee.countDocuments({ userId: customer._id }), 0);

  // And it is safe to run again.
  const again = await reconcileEmployeeRecords();
  assert.equal(again.created, 0);
  assert.equal(await Employee.countDocuments({}), 2);
});

test('reconciliation covers suspended staff parked in the archive', async () => {
  const archivedId = oid();
  await ArchivedUser.create({
    _id: archivedId,
    email: 'suspended.staff@shraddhaimpex.com',
    user: 'Suspended Staff',
    role: 'Sales',
    status: 'Suspended',
    password: 'hashed',
  });

  const run = await reconcileEmployeeRecords();

  assert.equal(run.created, 1, 'suspension is not a way to disappear from the HRMS');
  const employee = await Employee.findOne({ userId: archivedId }).lean();
  assert.equal(employee.status, 'suspended');
});

test('an account created a year ago joined a year ago, not today', async () => {
  const user = await makeUser({ user: 'Old Timer' });
  const joined = new Date('2024-03-01T00:00:00.000Z');
  // Straight through the driver: mongoose marks `createdAt` immutable, so a
  // model-level $set is silently dropped and the test would pass vacuously.
  await User.collection.updateOne({ _id: user._id }, { $set: { createdAt: joined } });

  await syncUserSafely(await User.findById(user._id).lean());

  const employee = await Employee.findOne({ userId: user._id }).lean();
  assert.equal(employee.dateOfJoining.toISOString(), joined.toISOString());
});

test('syncUserToEmployee throws for the backfill script, where a failure is the operator\'s to see', async (t) => {
  const user = await makeUser({ user: 'Throwing Person' });
  t.mock.method(Employee, 'create', async () => { throw new Error('index unavailable'); });

  await assert.rejects(
    () => syncUserToEmployee(user),
    /index unavailable/,
    'the unwrapped entry point does not swallow',
  );
});

// ---------------------------------------------------------------------------
// 5, the other direction: HRMS -> portal
// ---------------------------------------------------------------------------

/**
 * The regression these two cover.
 *
 * `updateEmployee` guarded its login suspension on `dto.status === 'inactive'`,
 * and `inactive` IS NOT an employee status - the enum is invited / active /
 * probation / notice / exited / suspended, and the zod schema refuses anything
 * else. The branch could never be true, so suspending somebody from the HRMS
 * side left their login working.
 */
test('suspending an employee in HRMS stops the login and revokes its sessions', async () => {
  const actor = { _id: oid(), role: 'Management', roles: [R.SUPER_ADMIN], status: 'Active' };
  const user = await makeUser({ user: 'Reverse Person' });
  await syncUserSafely(user);
  await User.updateOne(
    { _id: user._id },
    { $set: { refreshSessions: [{ hash: 'live', jti: 'j1' }], refreshTokenHash: 'live' } },
  );
  const employee = await Employee.findOne({ userId: user._id }).lean();

  await withServer(hrmsApp(actor), async (url) => {
    const res = await patch(url, `/api/v1/hrms/employees/${employee._id}`, { status: 'suspended' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  const after = await User.findById(user._id)
    .select('+refreshSessions +refreshTokenHash').lean();
  assert.equal(after.status, 'Suspended', 'the login stops working');
  assert.deepEqual(after.refreshSessions, [], 'and every open session is revoked');
  assert.equal(after.refreshTokenHash, null);
});

test('moving an employee onto notice leaves their login alone', async () => {
  const actor = { _id: oid(), role: 'Management', roles: [R.SUPER_ADMIN], status: 'Active' };
  const user = await makeUser({ user: 'Noticed Person' });
  await syncUserSafely(user);
  await User.updateOne(
    { _id: user._id },
    { $set: { refreshSessions: [{ hash: 'live', jti: 'j1' }] } },
  );
  const employee = await Employee.findOne({ userId: user._id }).lean();

  await withServer(hrmsApp(actor), async (url) => {
    const res = await patch(url, `/api/v1/hrms/employees/${employee._id}`, { status: 'notice' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  const after = await User.findById(user._id).select('+refreshSessions').lean();
  assert.equal(after.status, 'Active', 'serving notice is still working here');
  assert.equal(after.refreshSessions.length, 1, 'and nobody is signed out');
});

// ---------------------------------------------------------------------------
// The consequence of granting hrms_employee: demotion to a portal-only role
// ---------------------------------------------------------------------------

test('a staff account with a live employee record cannot be turned into a Customer', async () => {
  const user = await makeUser({ user: 'Still Employed', role: 'Sales' });
  await syncUserSafely(user);

  await withServer(adminApp(), async (url) => {
    const res = await put(url, `/api/v1/users/${user._id}/roles`, { role: 'Customer' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'EMPLOYEE_RECORD_EXISTS');
    // Actionable: it names the record and the one step that settles it.
    assert.match(res.body.message, /EMP\d{4}/);
    assert.match(res.body.message, /deactivate the employee record/i);
  });

  assert.equal((await User.findById(user._id).lean()).role, 'Sales', 'nothing was written');
});

test('once the employee record is deactivated, the demotion goes through and clears the keys', async () => {
  const user = await makeUser({ user: 'Now Customer', role: 'Sales' });
  await syncUserSafely(user);
  await Employee.updateOne({ userId: user._id }, { $set: { deletedAt: new Date() } });

  await withServer(adminApp(), async (url) => {
    const res = await put(url, `/api/v1/users/${user._id}/roles`, { role: 'Customer' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  const after = await User.findById(user._id).lean();
  assert.equal(after.role, 'Customer');
  assert.deepEqual(after.roles, [], 'AD-4 holds: no HRMS key survives the demotion');
});

test('the same rule applies through the general user edit, not only the role endpoint', async () => {
  const user = await makeUser({ user: 'Edit Route', role: 'Sales' });
  await syncUserSafely(user);

  await withServer(adminApp(), async (url) => {
    const res = await patch(url, `/api/v1/users/${user._id}`, { role: 'Customer' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'EMPLOYEE_RECORD_EXISTS');
  });
});
