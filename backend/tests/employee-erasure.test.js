/**
 * Permanently deleting an employee — the HTTP layer, over a real MongoDB.
 *
 * Only `protect` is stubbed, as the other HRMS route tests do it. The
 * permission chain, the validator, the service and the error handler are the
 * genuine article, because what this feature gets wrong is never one function:
 * it is a record left behind in some collection, or a record taken that
 * belonged to somebody else.
 *
 * The records are inserted RAW, past the schemas. The erase matches on the
 * field that says whose a record is and nothing else, so a fully-valid payslip
 * would prove no more than one carrying an `employeeId` — and the list below
 * is this test's own statement of what must go, written independently of the
 * service's list so the two can disagree.
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';

// The local storage driver reads its root when first loaded, so this must be
// set before anything below imports it.
process.env.STORAGE_LOCAL_PATH =
  process.env.STORAGE_LOCAL_PATH || (await fs.mkdtemp(path.join(os.tmpdir(), 'hrms-erasure-')));

const { default: Employee } = await import('../models/hrms/Employee.js');
const { default: User } = await import('../models/User.js');
const { default: ArchivedUser } = await import('../models/ArchivedUser.js');
const { default: AuditLog } = await import('../models/AuditLog.js');
const { default: AttendanceRecord } = await import('../models/hrms/AttendanceRecord.js');
const { default: AttendanceCorrection } = await import('../models/hrms/AttendanceCorrection.js');
const { default: AttendanceConsent } = await import('../models/hrms/AttendanceConsent.js');
const { LeaveRequest } = await import('../models/hrms/LeaveRequest.js');
const { LeaveBalance } = await import('../models/hrms/LeaveBalance.js');
const { EmployeeCompensation, Payslip, PayrollAdjustment, PayrollRun } = await import(
  '../models/hrms/PayrollModels.js'
);
const { HrmsDocument, DocumentAcknowledgment } = await import('../models/hrms/DocumentModels.js');
const { ExitRequest } = await import('../models/hrms/ExitRequest.js');
const { ExpenseClaim } = await import('../models/hrms/ExpenseClaim.js');
const { HelpdeskTicket } = await import('../models/hrms/HelpdeskModels.js');
const { LearningAssignment, AcademyCertificate } = await import('../models/hrms/AcademyModels.js');
const { AssetItem, AssetRequest } = await import('../models/hrms/AssetModels.js');
const { OnboardingChecklist, OfferLetter } = await import('../models/hrms/OnboardingModels.js');
const { Goal, ReviewResponse, Feedback, OneOnOne } = await import('../models/hrms/PerformanceModels.js');
const { Recognition, PollResponse, ENpsResponse } = await import('../models/hrms/EngageModels.js');
const { InboxItem } = await import('../models/hrms/InboxItem.js');
const { HrmsUserRole } = await import('../models/hrms/RoleModels.js');
const { WorkQueueSeen } = await import('../models/WorkQueueSeen.js');
const { O2dNotification } = await import('../models/o2d/O2dNotification.js');
const { default: employeeRoutes } = await import('../modules/hrms/employees/employee.routes.js');
const { hrmsAuthorizationChain, setEmployeeResolver } = await import('../middlewares/hrmsAuth.js');
const { hrmsErrorHandler } = await import('../modules/hrms/hrms.errors.js');
const { registerReferenceProvider, __resetReferenceProviders } = await import(
  '../modules/hrms/references/reference.service.js'
);
const { employeeReferenceProvider } = await import('../modules/hrms/employees/employee.provider.js');
const { putObject, objectExists } = await import('../utils/hrms/storage/index.js');
const { STORAGE_CATEGORIES } = await import('../shared/constants/hrms.js');
const { HRMS_ROLES: R } = await import('../shared/permissions/constants.js');
const { buildTestApp, stubProtect, withServer, get, post } = await import('./helpers/http.js');
const { startTestMongo, stopTestMongo, clearCollections } = await import('./helpers/mongo.js');

const P = '/api/v1/hrms/employees';
const oid = () => new mongoose.Types.ObjectId();

/**
 * Every kind of record that is ABOUT an employee, and the field that says so.
 * One row of each is planted for the person being deleted and one for a
 * bystander; afterwards the first must be gone and the second untouched.
 */
const ABOUT_THEM = [
  [AttendanceRecord, 'employeeId'],
  [AttendanceCorrection, 'employeeId'],
  [AttendanceConsent, 'employeeId'],
  [LeaveRequest, 'employeeId'],
  [LeaveBalance, 'employeeId'],
  [Payslip, 'employeeId'],
  [PayrollAdjustment, 'employeeId'],
  [EmployeeCompensation, 'employeeId'],
  [HrmsDocument, 'employeeId'],
  [DocumentAcknowledgment, 'employeeId'],
  [ExitRequest, 'employeeId'],
  [ExpenseClaim, 'employeeId'],
  [HelpdeskTicket, 'requesterEmployeeId'],
  [AssetRequest, 'employeeId'],
  [OnboardingChecklist, 'employeeId'],
  [OfferLetter, 'employeeId'],
  [LearningAssignment, 'employeeId'],
  [AcademyCertificate, 'employeeId'],
  [Goal, 'employeeId'],
  [ReviewResponse, 'employeeId'],
  [Feedback, 'toEmployeeId'],
  [OneOnOne, 'reportEmployeeId'],
  [Recognition, 'toEmployeeId'],
  [PollResponse, 'respondentEmployeeId'],
  [ENpsResponse, 'respondentEmployeeId'],
  [InboxItem, 'recipientEmployeeId'],
];

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
  await User.create({
    _id: userId,
    name: `${over.firstName ?? 'Test'} Person`,
    email: `erase${seq}@example.com`,
    password: 'hashed-not-used',
    role: 'Management',
    roles,
    status: 'Active',
  });
  const employee = await Employee.create({
    employeeCode: `ER-${String(seq).padStart(4, '0')}`,
    userId,
    firstName: over.firstName ?? 'Test',
    lastName: over.lastName ?? `Person${seq}`,
    dateOfJoining: new Date('2020-01-01'),
    status: 'active',
    ...over,
  });
  return { user: { _id: userId, role: 'Management', roles, status: 'Active' }, employee };
}

/** An admin, the person to delete, and a bystander who must not be touched. */
async function seedOrg() {
  const admin = await makePerson([R.SUPER_ADMIN], { firstName: 'Asha' });
  const target = await makePerson([R.EMPLOYEE], { firstName: 'Tarun' });
  const other = await makePerson([R.EMPLOYEE], { firstName: 'Omar' });
  return { admin, target, other };
}

/**
 * A value for each unique index a model declares, so two raw rows never collide
 * on a field neither of them is about — a helpdesk ticket's number, say.
 */
function uniqueFiller(model, field, tag) {
  const fill = {};
  for (const [spec, options] of model.schema.indexes()) {
    if (!options?.unique) continue;
    for (const p of Object.keys(spec)) {
      if (p !== field && p !== 'date' && !p.includes('.')) fill[p] = `${tag}-${p}`;
    }
  }
  return fill;
}

/** One row of every kind for this employee, with a distinct date per row. */
async function plantRecords(employeeId, day) {
  for (const [model, field] of ABOUT_THEM) {
    await model.collection.insertOne({
      ...uniqueFiller(model, field, `${employeeId}-${day}`),
      [field]: employeeId,
      date: new Date(`2026-10-${day}`),
    });
  }
}

const envelope = (res, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  return res.body.data;
};

const errorBody = (res, status, code) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  if (code) assert.equal(res.body.code, code);
  return res.body;
};

const erase = (url, employee, code = employee.employeeCode) =>
  post(url, `${P}/${employee._id}/erase`, { confirmEmployeeCode: code });

/** The stored files are removed after the response; give them a moment. */
async function waitUntilGone(key, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await objectExists(key))) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Who may
// ---------------------------------------------------------------------------

test('only the delete grant reaches it — an HR admin is refused both the preview and the erase', async () => {
  const { target } = await seedOrg();
  const hr = await makePerson([R.HR_ADMIN], { firstName: 'Hana' });

  await withServer(appFor(hr.user), async (url) => {
    errorBody(await get(url, `${P}/${target.employee._id}/erasure-preview`), 403);
    errorBody(await erase(url, target.employee), 403);
  });
  assert.ok(await Employee.exists({ _id: target.employee._id }));
});

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

test('the preview counts what would go, names the login and lists only what exists', async () => {
  const { admin, target } = await seedOrg();
  await plantRecords(target.employee._id, '01');
  await AttendanceRecord.collection.insertOne({ employeeId: target.employee._id, date: new Date('2026-10-02') });

  await withServer(appFor(admin.user), async (url) => {
    const preview = envelope(await get(url, `${P}/${target.employee._id}/erasure-preview`));

    assert.equal(preview.employeeCode, target.employee.employeeCode);
    assert.equal(preview.displayName, `Tarun ${target.employee.lastName}`);
    assert.match(preview.login.email, /^erase\d+@example\.com$/);
    assert.deepEqual(preview.blockers, []);

    const byKey = Object.fromEntries(preview.records.map((r) => [r.key, r.count]));
    assert.equal(byKey.attendance, 2);
    assert.equal(byKey.payslips, 1);
    assert.equal(preview.records.length, ABOUT_THEM.length, 'one entry per kind of record planted');
    assert.ok(preview.records.every((r) => r.count > 0 && r.label));
  });
});

test('the preview of someone with nothing on file lists no records at all', async () => {
  const { admin, target } = await seedOrg();
  await withServer(appFor(admin.user), async (url) => {
    const preview = envelope(await get(url, `${P}/${target.employee._id}/erasure-preview`));
    assert.deepEqual(preview.records, []);
    assert.deepEqual(preview.warnings, []);
  });
});

test('the preview warns about work it leaves for others, without refusing', async () => {
  const { admin, target, other } = await seedOrg();
  await AssetItem.collection.insertOne({
    assignedToEmployeeId: target.employee._id,
    deletedAt: null,
    status: 'assigned',
    assignments: [{ employeeId: target.employee._id, employeeName: 'Tarun' }],
  });
  await LeaveRequest.collection.insertOne({
    employeeId: other.employee._id,
    status: 'pending',
    approvalChain: [{ approverEmployeeId: target.employee._id, decision: 'pending' }],
  });

  await withServer(appFor(admin.user), async (url) => {
    const preview = envelope(await get(url, `${P}/${target.employee._id}/erasure-preview`));
    const codes = preview.warnings.map((w) => w.code);
    assert.deepEqual(codes, ['HOLDS_ASSETS', 'PENDING_LEAVE_APPROVALS']);
    assert.match(preview.warnings[0].message, /1 asset is still issued to them/);
    assert.deepEqual(preview.blockers, []);
  });
});

test('an unknown or malformed id is a 404, not a crash', async () => {
  const { admin } = await seedOrg();
  await withServer(appFor(admin.user), async (url) => {
    errorBody(await get(url, `${P}/${oid()}/erasure-preview`), 404);
    errorBody(await get(url, `${P}/not-an-id/erasure-preview`), 404);
  });
});

// ---------------------------------------------------------------------------
// The erase
// ---------------------------------------------------------------------------

test('nothing is deleted unless the employee code is typed back', async () => {
  const { admin, target } = await seedOrg();
  await plantRecords(target.employee._id, '01');

  await withServer(appFor(admin.user), async (url) => {
    const res = errorBody(await erase(url, target.employee, 'ER-9999'), 400);
    assert.match(res.message, new RegExp(target.employee.employeeCode));
    // Missing altogether is refused by the validator.
    errorBody(await post(url, `${P}/${target.employee._id}/erase`, {}), 400);
  });

  assert.ok(await Employee.exists({ _id: target.employee._id }));
  assert.ok(await User.exists({ _id: target.employee.userId }));
  assert.equal(await Payslip.countDocuments({ employeeId: target.employee._id }), 1);
});

test('the typed code is matched ignoring case and surrounding space', async () => {
  const { admin, target } = await seedOrg();
  await withServer(appFor(admin.user), async (url) => {
    envelope(await erase(url, target.employee, `  ${target.employee.employeeCode.toLowerCase()} `));
  });
  assert.equal(await Employee.exists({ _id: target.employee._id }), null);
});

test('erases the employee, their login and every record about them — and nobody else\'s', async () => {
  const { admin, target, other } = await seedOrg();
  await plantRecords(target.employee._id, '01');
  await plantRecords(other.employee._id, '02');
  await HrmsUserRole.collection.insertOne({ userId: target.employee.userId, roleId: oid() });
  await WorkQueueSeen.collection.insertOne({ user: target.employee.userId });
  await O2dNotification.collection.insertOne({ user: target.employee.userId });

  await withServer(appFor(admin.user), async (url) => {
    const result = envelope(await erase(url, target.employee));
    assert.equal(result.employeeCode, target.employee.employeeCode);
    assert.equal(result.erased.attendance, 1);
    assert.equal(result.erased.payslips, 1);
  });

  assert.equal(await Employee.exists({ _id: target.employee._id }), null);
  assert.equal(await User.exists({ _id: target.employee.userId }), null, 'the login is gone');
  for (const [model, field] of ABOUT_THEM) {
    assert.equal(
      await model.countDocuments({ [field]: target.employee._id }),
      0,
      `${model.modelName} still holds a row about the deleted employee`,
    );
    assert.equal(
      await model.countDocuments({ [field]: other.employee._id }),
      1,
      `${model.modelName} lost the bystander's row`,
    );
  }
  assert.equal(await HrmsUserRole.countDocuments({ userId: target.employee.userId }), 0);
  assert.equal(await WorkQueueSeen.countDocuments({ user: target.employee.userId }), 0);
  assert.equal(await O2dNotification.countDocuments({ user: target.employee.userId }), 0);

  // The bystander and the admin are whole.
  assert.ok(await Employee.exists({ _id: other.employee._id }));
  assert.ok(await User.exists({ _id: other.employee.userId }));
  assert.ok(await User.exists({ _id: admin.employee.userId }));
});

test('what they did on someone else\'s record stays — only what is about them goes', async () => {
  const { admin, target, other } = await seedOrg();
  const runId = oid();
  await PayrollRun.collection.insertOne({ _id: runId, totals: { headcount: 2, netPay: '90000.00' } });
  await Payslip.collection.insertOne({ employeeId: target.employee._id, runId });
  // Feedback they GAVE, and a leave they were asked to approve, belong to Omar.
  await Feedback.collection.insertOne({ fromEmployeeId: target.employee._id, toEmployeeId: other.employee._id });
  await LeaveRequest.collection.insertOne({
    employeeId: other.employee._id,
    status: 'pending',
    approvalChain: [{ approverEmployeeId: target.employee._id, decision: 'pending' }],
  });
  // An asset they still hold is company property.
  await AssetItem.collection.insertOne({ assignedToEmployeeId: target.employee._id, deletedAt: null });

  await withServer(appFor(admin.user), async (url) => {
    envelope(await erase(url, target.employee));
  });

  assert.equal(await Feedback.countDocuments({ toEmployeeId: other.employee._id }), 1);
  assert.equal(await LeaveRequest.countDocuments({ employeeId: other.employee._id }), 1);
  assert.equal(await AssetItem.countDocuments({}), 1);
  // The run still states what was paid that month.
  const run = await PayrollRun.collection.findOne({ _id: runId });
  assert.equal(run.totals.headcount, 2);
  assert.equal(await Payslip.countDocuments({ runId }), 0);
});

test('frees the employee code, so the person can be added again correctly', async () => {
  const { admin, target } = await seedOrg();
  await withServer(appFor(admin.user), async (url) => {
    envelope(await erase(url, target.employee));
  });

  await Employee.syncIndexes();
  await Employee.create({
    employeeCode: target.employee.employeeCode,
    firstName: 'Tarun',
    lastName: 'Again',
    dateOfJoining: new Date('2026-11-01'),
  });
});

test('removes their stored files, and only theirs', async () => {
  const { admin, target, other } = await seedOrg();
  const file = (category) =>
    putObject({ category, body: Buffer.from('x'), contentType: 'image/jpeg', filename: 'f.jpg', size: 1 });
  const selfie = await file(STORAGE_CATEGORIES.ATTENDANCE_SELFIE);
  const document = await file(STORAGE_CATEGORIES.EMPLOYEE_DOCUMENT);
  const keep = await file(STORAGE_CATEGORIES.EMPLOYEE_DOCUMENT);

  await AttendanceRecord.collection.insertOne({
    employeeId: target.employee._id,
    date: new Date('2026-10-01'),
    clockInCapture: { selfieKey: selfie.key },
  });
  await HrmsDocument.collection.insertOne({ employeeId: target.employee._id, storageKey: document.key });
  await HrmsDocument.collection.insertOne({ employeeId: other.employee._id, storageKey: keep.key });

  await withServer(appFor(admin.user), async (url) => {
    const result = envelope(await erase(url, target.employee));
    assert.equal(result.files, 2);
  });

  assert.ok(await waitUntilGone(selfie.key), 'the selfie is deleted');
  assert.ok(await waitUntilGone(document.key), 'the document is deleted');
  assert.equal(await objectExists(keep.key), true, "the bystander's document is kept");
});

test('writes an audit entry naming who was deleted', async () => {
  const { admin, target } = await seedOrg();
  await withServer(appFor(admin.user), async (url) => {
    envelope(await erase(url, target.employee));
  });

  const entry = await AuditLog.findOne({ action: 'hrms.employee.erased' }).lean();
  assert.ok(entry, 'audited');
  assert.equal(String(entry.user), String(admin.user._id));
  assert.match(entry.remarks, new RegExp(target.employee.employeeCode));
  assert.match(entry.remarks, /Tarun/);
});

test('deletes a login that was suspended into the archive as well', async () => {
  const { admin, target } = await seedOrg();
  // Suspending from the Users screen MOVES the account out of `users`.
  const login = await User.findById(target.employee.userId).lean();
  await ArchivedUser.collection.insertOne({ ...login, status: 'Suspended', archivedAt: new Date() });
  await User.deleteOne({ _id: login._id });

  await withServer(appFor(admin.user), async (url) => {
    const preview = envelope(await get(url, `${P}/${target.employee._id}/erasure-preview`));
    assert.equal(preview.login.email, login.email);
    envelope(await erase(url, target.employee));
  });
  assert.equal(await ArchivedUser.exists({ _id: login._id }), null);
});

test('an employee who was already deactivated can still be erased', async () => {
  const { admin, target } = await seedOrg();
  await Employee.updateOne({ _id: target.employee._id }, { $set: { deletedAt: new Date(), status: 'exited' } });

  await withServer(appFor(admin.user), async (url) => {
    envelope(await erase(url, target.employee));
  });
  assert.equal(await Employee.exists({ _id: target.employee._id }), null);
});

test('an employee with no login is erased without touching any account', async () => {
  const { admin } = await seedOrg();
  const noLogin = await Employee.create({
    employeeCode: 'ER-NOLOGIN',
    firstName: 'Nia',
    lastName: 'Offline',
    dateOfJoining: new Date('2021-01-01'),
  });
  const users = await User.countDocuments({});

  await withServer(appFor(admin.user), async (url) => {
    const preview = envelope(await get(url, `${P}/${noLogin._id}/erasure-preview`));
    assert.equal(preview.login, null);
    const result = envelope(await erase(url, noLogin));
    assert.equal(result.email, null);
  });
  assert.equal(await User.countDocuments({}), users);
});

// ---------------------------------------------------------------------------
// What still refuses
// ---------------------------------------------------------------------------

test('you cannot delete yourself', async () => {
  const { admin } = await seedOrg();
  // A second Super Admin, so the only thing in the way is that it is yourself.
  await makePerson([R.SUPER_ADMIN], { firstName: 'Bina' });
  await withServer(appFor(admin.user), async (url) => {
    const preview = envelope(await get(url, `${P}/${admin.employee._id}/erasure-preview`));
    assert.deepEqual(preview.blockers.map((b) => b.code), ['CANNOT_ERASE_SELF']);
    errorBody(await erase(url, admin.employee), 409, 'CANNOT_ERASE_SELF');
  });
  assert.ok(await Employee.exists({ _id: admin.employee._id }));
});

test('someone with direct reports is refused until they are reassigned', async () => {
  const { admin, target, other } = await seedOrg();
  await Employee.updateOne({ _id: other.employee._id }, { $set: { reportingManagerId: target.employee._id } });

  await withServer(appFor(admin.user), async (url) => {
    const res = errorBody(await erase(url, target.employee), 409, 'HAS_DIRECT_REPORTS');
    assert.match(res.message, /1 direct report\. Reassign them first/);
  });
  assert.ok(await Employee.exists({ _id: target.employee._id }));
});

test('the last active Super Admin login is refused; another one makes it allowed', async () => {
  // The actor holds the grant without being in the database, so the person
  // being deleted is the only Super Admin account there is.
  const actor = { _id: oid(), role: 'Management', roles: [R.SUPER_ADMIN], status: 'Active' };
  const onlyAdmin = await makePerson([R.SUPER_ADMIN], { firstName: 'Sole' });

  await withServer(appFor(actor), async (url) => {
    errorBody(await erase(url, onlyAdmin.employee), 409, 'LAST_SUPER_ADMIN');

    // The portal's own Super Admin role implies the HRMS one.
    await User.create({
      email: 'second-admin@example.com',
      password: 'hashed-not-used',
      role: 'Super Admin',
      status: 'Active',
    });
    const preview = envelope(await get(url, `${P}/${onlyAdmin.employee._id}/erasure-preview`));
    assert.deepEqual(preview.blockers, []);
    envelope(await erase(url, onlyAdmin.employee));
  });
});
