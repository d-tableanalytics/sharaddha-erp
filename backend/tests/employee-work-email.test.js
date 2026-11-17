/**
 * Changing an employee's work email after creation.
 *
 * The work email is the login account's `User.email`. These run against a real
 * MongoDB and prove the change lands in that one place - so every screen that
 * reads it shows the new address - while the password, sessions, roles and the
 * employee record are left exactly as they were.
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';

const { default: Employee } = await import('../models/hrms/Employee.js');
const { default: User } = await import('../models/User.js');
const { default: ArchivedUser } = await import('../models/ArchivedUser.js');
const { default: Delegation } = await import('../models/Delegation.js');
const { default: employeeRoutes } = await import('../modules/hrms/employees/employee.routes.js');
const { hrmsAuthorizationChain, setEmployeeResolver } = await import('../middlewares/hrmsAuth.js');
const { hrmsErrorHandler } = await import('../modules/hrms/hrms.errors.js');
const { registerReferenceProvider, __resetReferenceProviders } = await import(
  '../modules/hrms/references/reference.service.js'
);
const { employeeReferenceProvider } = await import('../modules/hrms/employees/employee.provider.js');
const { HRMS_ROLES: R } = await import('../shared/permissions/constants.js');
const { changeWorkEmailSchema } = await import('../shared/schemas/employee.js');
const { buildTestApp, stubProtect, withServer, get, patch } = await import('./helpers/http.js');
const { startTestMongo, stopTestMongo, clearCollections } = await import('./helpers/mongo.js');

const P = '/api/v1/hrms/employees';
const oid = () => new mongoose.Types.ObjectId();

before(async () => {
  await startTestMongo();
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

function appFor(user) {
  return buildTestApp({
    mount: (app) => {
      const router = express.Router();
      router.use(stubProtect(user));
      router.use(hrmsAuthorizationChain);
      router.use('/employees', employeeRoutes);
      router.use(hrmsErrorHandler);
      app.use('/api/v1/hrms', router);
    },
  });
}

let seq = 0;
async function makePerson(roles, over = {}) {
  seq += 1;
  const userId = oid();
  const role = over.portalRole ?? 'Management';
  await User.create({
    _id: userId,
    user: `Person ${seq}`,
    email: over.email ?? `person${seq}@example.com`,
    password: 'hashed-password-unchanged',
    role,
    roles,
    status: 'Active',
    refreshSessions: [],
  });
  const employee = await Employee.create({
    employeeCode: `WE-${String(seq).padStart(4, '0')}`,
    userId,
    firstName: 'Test',
    lastName: `Person${seq}`,
    personalEmail: `personal${seq}@gmail.com`,
    phone: '9876543210',
    designation: 'Executive',
    dateOfJoining: new Date('2021-04-01'),
    status: 'active',
  });
  return { user: { _id: userId, role, roles, status: 'Active' }, employee };
}

const changeEmail = (url, id, email) => patch(url, `${P}/${id}/email`, { email });

test('HR changes a work email: the login address changes and nothing else does', async () => {
  const hr = await makePerson([R.HR_ADMIN]);
  const target = await makePerson([R.EMPLOYEE]);
  await User.updateOne(
    { _id: target.employee.userId },
    { $set: { refreshTokenHash: 'live-session-hash', refreshSessions: [{ hash: 'live-session-hash', jti: 'j1' }] } },
  );
  const SECRET = '+password +refreshTokenHash +refreshSessions';
  const beforeUser = await User.findById(target.employee.userId).select(SECRET).lean();
  const beforeEmp = await Employee.findById(target.employee._id).lean();

  await withServer(appFor(hr.user), async (url) => {
    const res = await changeEmail(url, target.employee._id, '  New.Address@Example.com ');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.email, 'new.address@example.com', 'normalised and returned');

    // The profile read - and so every screen hydrating from User - sees it.
    const read = await get(url, `${P}/${target.employee._id}`);
    assert.equal(read.body.data.email, 'new.address@example.com');
  });

  const afterUser = await User.findById(target.employee.userId).select(SECRET).lean();
  assert.equal(afterUser.email, 'new.address@example.com');
  // Credentials and authentication untouched.
  assert.equal(afterUser.password, beforeUser.password);
  assert.equal(afterUser.refreshTokenHash, 'live-session-hash', 'nobody is signed out');
  assert.equal(afterUser.refreshSessions.length, 1, 'live sessions kept');
  assert.deepEqual(afterUser.roles, beforeUser.roles);
  assert.equal(afterUser.status, beforeUser.status);
  assert.equal(afterUser.role, beforeUser.role);

  // The employee record's own data untouched.
  const afterEmp = await Employee.findById(target.employee._id).lean();
  for (const f of ['employeeCode', 'firstName', 'lastName', 'personalEmail', 'phone', 'designation', 'status']) {
    assert.deepEqual(afterEmp[f], beforeEmp[f], `${f} must not change`);
  }
});

test('a duplicate email is refused, including one held by a suspended (archived) account', async () => {
  const hr = await makePerson([R.HR_ADMIN]);
  const target = await makePerson([R.EMPLOYEE]);
  const other = await makePerson([R.EMPLOYEE], { email: 'taken@example.com' });
  const original = (await User.findById(target.employee.userId).lean()).email;
  await ArchivedUser.create({
    _id: oid(),
    email: 'parked@example.com',
    password: 'x',
    role: 'Management',
    status: 'Suspended',
  });

  await withServer(appFor(hr.user), async (url) => {
    const live = await changeEmail(url, target.employee._id, 'TAKEN@example.com');
    assert.equal(live.status, 409);
    const parked = await changeEmail(url, target.employee._id, 'parked@example.com');
    assert.equal(parked.status, 409);
  });

  const still = await User.findById(target.employee.userId).lean();
  assert.equal(still.email, original);
  assert.equal((await User.findById(other.employee.userId).lean()).email, 'taken@example.com');
});

test('an invalid email format is a 400 and writes nothing', async () => {
  const hr = await makePerson([R.HR_ADMIN]);
  const target = await makePerson([R.EMPLOYEE]);
  const before = (await User.findById(target.employee.userId).lean()).email;

  await withServer(appFor(hr.user), async (url) => {
    for (const bad of ['not-an-email', '', 'a@', '@b.com']) {
      const res = await changeEmail(url, target.employee._id, bad);
      assert.equal(res.status, 400, `"${bad}" must be refused`);
    }
    const extra = await patch(url, `${P}/${target.employee._id}/email`, {
      email: 'ok@example.com',
      password: 'sneaky',
    });
    assert.equal(extra.status, 400, 'nothing but the email is accepted');
  });

  assert.equal((await User.findById(target.employee.userId).lean()).email, before);
  assert.equal(changeWorkEmailSchema.safeParse({ email: 'a@b.co' }).success, true);
});

test('an ordinary employee cannot change a work email - not even their own', async () => {
  const me = await makePerson([R.EMPLOYEE]);
  const colleague = await makePerson([R.EMPLOYEE]);

  await withServer(appFor(me.user), async (url) => {
    assert.equal((await changeEmail(url, me.employee._id, 'mine@example.com')).status, 403);
    assert.equal((await changeEmail(url, colleague.employee._id, 'theirs@example.com')).status, 403);
  });
});

test('HR cannot re-point the sign-in address of a full-access account', async () => {
  const hr = await makePerson([R.HR_ADMIN]);
  const boss = await makePerson([R.EMPLOYEE], { portalRole: 'Super Admin' });

  await withServer(appFor(hr.user), async (url) => {
    const res = await changeEmail(url, boss.employee._id, 'hijack@example.com');
    assert.equal(res.status, 403);
  });
  assert.notEqual((await User.findById(boss.employee.userId).lean()).email, 'hijack@example.com');
});

test('the collaborator snapshot on delegated tasks follows the new address', async () => {
  const hr = await makePerson([R.HR_ADMIN]);
  const target = await makePerson([R.EMPLOYEE]);
  const bystander = await makePerson([R.EMPLOYEE]);
  const oldEmail = (await User.findById(target.employee.userId).lean()).email;
  const bystanderEmail = (await User.findById(bystander.employee.userId).lean()).email;

  await Delegation.collection.insertOne({
    title: 'Task',
    inLoop: [
      { userId: target.employee.userId, name: 'Target', email: oldEmail },
      { userId: bystander.employee.userId, name: 'Bystander', email: bystanderEmail },
    ],
  });

  await withServer(appFor(hr.user), async (url) => {
    assert.equal((await changeEmail(url, target.employee._id, 'moved@example.com')).status, 200);
  });

  const task = await Delegation.collection.findOne({ title: 'Task' });
  assert.equal(task.inLoop[0].email, 'moved@example.com');
  assert.equal(task.inLoop[1].email, bystanderEmail, 'other collaborators untouched');
});

test('saving the same address is a no-op success', async () => {
  const hr = await makePerson([R.HR_ADMIN]);
  const target = await makePerson([R.EMPLOYEE]);
  const current = (await User.findById(target.employee.userId).lean()).email;

  await withServer(appFor(hr.user), async (url) => {
    const res = await changeEmail(url, target.employee._id, current.toUpperCase());
    assert.equal(res.status, 200);
    assert.equal(res.body.data.email, current);
  });
});

test('an employee without a portal login is refused with the reason', async () => {
  const hr = await makePerson([R.HR_ADMIN]);
  const noLogin = await Employee.create({
    employeeCode: 'WE-NOLOGIN',
    firstName: 'No',
    lastName: 'Login',
    dateOfJoining: new Date('2022-01-01'),
    status: 'active',
  });

  await withServer(appFor(hr.user), async (url) => {
    const res = await changeEmail(url, noLogin._id, 'x@example.com');
    assert.equal(res.status, 400);
    assert.match(res.body.message, /no portal login/i);
  });
});
