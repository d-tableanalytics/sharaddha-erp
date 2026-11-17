/**
 * HA1: bank account, PAN, Aadhaar and the other sensitive identifiers may only
 * be WRITTEN by someone with compensation authority
 * (employees:compensation:edit:org) - the same gate payroll uses to write a
 * salary. Reading them already needed employees:compensation; writing them
 * (which redirects salary) used to need only employees:edit.
 *
 * Covered through the real HTTP chain, over a real MongoDB:
 *   PATCH /employees/:id               org editor (recruiter, hr_admin) and self-edit
 *   POST  /imports/employees/commit     the import upsert path
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import Employee from '../models/hrms/Employee.js';
import User from '../models/User.js';
import employeeRoutes from '../modules/hrms/employees/employee.routes.js';
import importRoutes from '../modules/hrms/import/import.routes.js';
import { hrmsAuthorizationChain, setEmployeeResolver } from '../middlewares/hrmsAuth.js';
import { hrmsErrorHandler } from '../modules/hrms/hrms.errors.js';
import {
  registerReferenceProvider,
  __resetReferenceProviders,
} from '../modules/hrms/references/reference.service.js';
import {
  employeeReferenceProvider,
  employeePersistencePort,
} from '../modules/hrms/employees/employee.provider.js';
import { registerEmployeePersistence } from '../modules/hrms/import/adapter.js';
import { encPath } from '../models/hrms/plugins/sensitiveFields.js';
import { HRMS_ROLES as R } from '../shared/permissions/constants.js';
import { buildTestApp, stubProtect, withServer, post, patch } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

const API = '/api/v1/hrms';

before(async () => {
  await startTestMongo();
  await syncIndexes(Employee, User);
  try {
    registerEmployeePersistence(employeePersistencePort);
  } catch {
    // Already registered by another import of the bootstrap - fine.
  }
});

after(async () => {
  __resetReferenceProviders();
  await stopTestMongo();
});

beforeEach(async () => {
  await clearCollections();
  __resetReferenceProviders();
  registerReferenceProvider('employee', employeeReferenceProvider);
  setEmployeeResolver((userId) => employeeReferenceProvider.byUserId(userId));
});

let seq = 0;
async function makePerson(roles) {
  seq += 1;
  const user = await User.create({
    user: `Person ${seq}`,
    email: `sens${seq}@example.test`,
    password: 'irrelevant-hash',
    role: 'Management',
    roles,
    status: 'Active',
  });
  const employee = await Employee.create({
    employeeCode: `SW${String(seq).padStart(3, '0')}`,
    firstName: 'Test',
    lastName: `Person ${seq}`,
    dateOfJoining: new Date('2025-01-01'),
    employmentType: 'full_time',
    status: 'active',
    userId: user._id,
  });
  return {
    user: { _id: user._id, role: 'Management', roles, status: 'Active' },
    employee,
    id: String(employee._id),
  };
}

const appFor = (user) =>
  buildTestApp({
    mount: (a) => {
      const router = express.Router();
      router.use(stubProtect(user));
      router.use(hrmsAuthorizationChain);
      router.use('/employees', employeeRoutes);
      router.use('/imports/employees', importRoutes);
      router.use(hrmsErrorHandler);
      a.use(API, router);
    },
  });

const storedEnvelope = async (id, field) => {
  const row = await Employee.findById(id).select(`+${encPath(field)}`).lean();
  return row?.[encPath(field)] ?? null;
};

test('🔴 HA1: an org editor without compensation authority cannot write bank / PAN / Aadhaar', async () => {
  const subject = await makePerson([R.EMPLOYEE]);
  for (const role of [R.RECRUITER, R.HR_ADMIN]) {
    const editor = await makePerson([role]);
    await withServer(appFor(editor.user), async (url) => {
      for (const body of [
        { bankAccountNumber: '999988887777' },
        { bankIfsc: 'HDFC0009999' },
        { panNumber: 'ZZZZZ9999Z' },
        { aadhaarNumber: '9999' },
        // Smuggled through the custom-field blob, where the sanitiser lifts it out.
        { customFieldValues: { bank_account_number: '111122223333' } },
      ]) {
        const res = await patch(url, `${API}/employees/${subject.id}`, body);
        assert.equal(res.status, 403, `${role} ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`);
      }
      // Ordinary profile edits still work.
      const ok = await patch(url, `${API}/employees/${subject.id}`, { phone: '9876543210' });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    });
  }
  assert.equal(await storedEnvelope(subject.id, 'bankAccountNumber'), null, 'nothing was written');
  assert.equal(await storedEnvelope(subject.id, 'panNumber'), null);
});

test('🔴 HA1: an employee cannot change their own bank account directly (no approval flow exists)', async () => {
  const self = await makePerson([R.EMPLOYEE]);
  await withServer(appFor(self.user), async (url) => {
    const res = await patch(url, `${API}/employees/${self.id}`, { bankAccountNumber: '123412341234' });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.match(res.body.message, /payroll/i);

    const ok = await patch(url, `${API}/employees/${self.id}`, { phone: '9123456780' });
    assert.equal(ok.status, 200, 'personal details are still self-editable');
  });
  assert.equal(await storedEnvelope(self.id, 'bankAccountNumber'), null);
});

test('HA1: the compensation holder (super admin) still writes sensitive fields', async () => {
  const subject = await makePerson([R.EMPLOYEE]);
  const admin = await makePerson([R.SUPER_ADMIN]);
  await withServer(appFor(admin.user), async (url) => {
    const res = await patch(url, `${API}/employees/${subject.id}`, {
      bankAccountNumber: '555566667777',
      panNumber: 'ABCDE1234F',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
  assert.ok(await storedEnvelope(subject.id, 'bankAccountNumber'), 'stored encrypted');
  assert.ok(await storedEnvelope(subject.id, 'panNumber'));
});

const record = (over = {}) => ({
  employeeCode: 'IMP001',
  firstName: 'Imported',
  lastName: 'Person',
  email: 'imported@example.test',
  dateOfJoining: '2025-01-15',
  employmentType: 'full_time',
  status: 'active',
  customFieldValues: {},
  ...over,
});

test('🔴 HA1: the import upsert path refuses sensitive fields, and updates of existing rows, without the authority', async () => {
  // hr_admin holds employees:create:org (the import gate) but neither
  // employees:compensation:edit nor - for this check - is that enough to
  // overwrite bank details on an existing employee via employeeCode.
  const target = await makePerson([R.EMPLOYEE]);
  const hr = await makePerson([R.HR_ADMIN]);

  await withServer(appFor(hr.user), async (url) => {
    const overwrite = await post(url, `${API}/imports/employees/commit`, {
      records: [
        record({
          employeeCode: target.employee.employeeCode,
          email: 'target@example.test',
          bankAccountNumber: '000011112222',
        }),
      ],
    });
    assert.equal(overwrite.status, 403, JSON.stringify(overwrite.body));

    const fresh = await post(url, `${API}/imports/employees/commit`, {
      records: [record({ panNumber: 'PQRST6789U' })],
    });
    assert.equal(fresh.status, 403, JSON.stringify(fresh.body));
    assert.equal(await Employee.countDocuments({ employeeCode: 'IMP001' }), 0, 'refused before any write');

    // Without sensitive fields the import still runs for HR.
    const plain = await post(url, `${API}/imports/employees/commit`, { records: [record()] });
    assert.equal(plain.status, 200, JSON.stringify(plain.body));
  });
  assert.equal(await storedEnvelope(target.id, 'bankAccountNumber'), null);

  // The compensation holder may import them.
  const admin = await makePerson([R.SUPER_ADMIN]);
  await withServer(appFor(admin.user), async (url) => {
    const res = await post(url, `${API}/imports/employees/commit`, {
      records: [record({ employeeCode: 'IMP002', email: 'imp2@example.test', panNumber: 'PQRST6789U' })],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
  const imported = await Employee.findOne({ employeeCode: 'IMP002' }).lean();
  assert.ok(await storedEnvelope(imported._id, 'panNumber'));
});
