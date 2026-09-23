/**
 * The route guard's self/team scope checks actually resolve a resource.
 *
 * `requirePermission({..., resourceParam})` only evaluates a narrow scope
 * against a real row when a resolver for that param name has been REGISTERED.
 * tests/customer-isolation.test.js proves the mechanism works when one is -
 * but it registers its own, so it could not notice that production registered
 * none at all: `registerResourceResolver` had exactly one caller in the whole
 * repository, and it was that test.
 *
 * The effect was that `resourceParam: 'id'` on the Employee Master routes
 * (the only resourceParam in the codebase) resolved to `undefined` on every
 * request, which `isSelf`/`isInTeamOf` treat as "no resource, allow" - so the
 * middleware-layer scope check for employees:view:team, employees:view:self
 * and employees:edit:self was inert. Not a live bypass, because
 * employee.service.js re-derives and re-checks the same resource as a second
 * line of defence before returning or writing any row, but a guard that
 * silently enforces nothing is one refactor away from being the only guard.
 *
 * These tests exercise the REAL bootstrap wiring rather than a hand-registered
 * resolver, which is the part that was missing.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  hrmsAuthorizationChain,
  requirePermission,
  __resetHrmsAuthRegistry,
  setEmployeeResolver,
} from '../middlewares/hrmsAuth.js';
import {
  registerReferenceProvider,
  __resetReferenceProviders,
} from '../modules/hrms/references/reference.service.js';
import { bootstrapHrms } from '../modules/hrms/hrms.bootstrap.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
  HRMS_ROLES as R,
} from '../shared/permissions/constants.js';
import { buildTestApp, stubProtect, withServer, get } from './helpers/http.js';
import { startTestMongo, stopTestMongo } from './helpers/mongo.js';

/*
 * `bootstrapHrms` now seeds the eight HRMS roles as database rows (see
 * modules/hrms/rbac/seedRoles.js), and `requirePermission` resolves every
 * request's permissions from that collection - so these tests need a real
 * database now, where before they needed none. `startTestMongo` also seeds
 * on connect, so the first test does not need its own `bootstrapHrms()` call
 * to succeed at that half of the job.
 */
before(async () => {
  await startTestMongo();
});

after(async () => {
  await stopTestMongo();
});

/** e-report reports to mgr-1; e-stranger reports to someone else. */
const EMPLOYEES = {
  'mgr-1': { id: 'mgr-1', employeeCode: 'M001', displayName: 'Manager', departmentId: 'd1', locationId: 'l1', reportingManagerId: null, managerChain: [], userId: 'u-mgr', status: 'active' },
  'e-report': { id: 'e-report', employeeCode: 'E001', displayName: 'Report', departmentId: 'd1', locationId: 'l1', reportingManagerId: 'mgr-1', managerChain: ['mgr-1'], userId: 'u-rep', status: 'active' },
  'e-stranger': { id: 'e-stranger', employeeCode: 'E002', displayName: 'Stranger', departmentId: 'd2', locationId: 'l1', reportingManagerId: 'other', managerChain: ['someone-else'], userId: 'u-str', status: 'active' },
};

const stubProvider = {
  byId: async (id) => EMPLOYEES[id] ?? null,
  byUserId: async (userId) =>
    Object.values(EMPLOYEES).find((e) => e.userId === userId) ?? null,
  byCodes: async () => new Map(),
  byIds: async () => new Map(),
};

/**
 * The real bootstrap, then the employee provider swapped for an in-memory one.
 *
 * Order matters: bootstrapHrms registers the Mongo-backed provider, and
 * registering after it replaces that with the stub, so these tests exercise
 * the bootstrap's own resolver registration without needing a database.
 */
const bootstrapWithStubEmployees = async () => {
  __resetHrmsAuthRegistry();
  __resetReferenceProviders();
  await bootstrapHrms();
  registerReferenceProvider('employee', stubProvider);
};

const appFor = (user, route) =>
  buildTestApp({
    mount: (a) => {
      const router = express.Router();
      router.use(stubProtect(user));
      router.use(hrmsAuthorizationChain);
      router.get('/employees/:id', route, (req, res) => res.json({ success: true }));
      a.use('/api/v1/hrms', router);
    },
  });

test('bootstrap registers the employees :id resolver, so team scope is enforced at the guard', async (t) => {
  t.after(() => {
    __resetHrmsAuthRegistry();
    __resetReferenceProviders();
  });
  await bootstrapWithStubEmployees();

  const manager = { _id: 'u-mgr', role: 'Management', roles: [R.MANAGER], status: 'Active' };
  const app = appFor(
    manager,
    requirePermission({
      module: M.EMPLOYEES,
      action: A.VIEW,
      scope: S.TEAM,
      resourceParam: 'id',
    }),
  );

  await withServer(app, async (url) => {
    assert.equal(
      (await get(url, '/api/v1/hrms/employees/e-report')).status,
      200,
      'a manager reaches a report through the resolved managerChain',
    );
    assert.equal(
      (await get(url, '/api/v1/hrms/employees/e-stranger')).status,
      403,
      'and is refused an employee outside their chain - the check that was inert before',
    );
  });
});

test('bootstrap registers the employees :id resolver, so self scope is enforced at the guard', async (t) => {
  t.after(() => {
    __resetHrmsAuthRegistry();
    __resetReferenceProviders();
  });
  await bootstrapWithStubEmployees();

  const employee = { _id: 'u-rep', role: 'Management', roles: [R.EMPLOYEE], status: 'Active' };
  const app = appFor(
    employee,
    requirePermission({
      module: M.EMPLOYEES,
      action: A.VIEW,
      scope: S.SELF,
      resourceParam: 'id',
    }),
  );

  await withServer(app, async (url) => {
    assert.equal(
      (await get(url, '/api/v1/hrms/employees/e-report')).status,
      200,
      'an employee reaches their own record',
    );
    assert.equal(
      (await get(url, '/api/v1/hrms/employees/e-stranger')).status,
      403,
      'and not a colleague',
    );
  });
});

test('an unknown :id resolves to no resource rather than throwing, and the guard defers', async (t) => {
  t.after(() => {
    __resetHrmsAuthRegistry();
    __resetReferenceProviders();
  });
  await bootstrapWithStubEmployees();

  const manager = { _id: 'u-mgr', role: 'Management', roles: [R.MANAGER], status: 'Active' };
  const app = appFor(
    manager,
    requirePermission({
      module: M.EMPLOYEES,
      action: A.VIEW,
      scope: S.TEAM,
      resourceParam: 'id',
    }),
  );

  await withServer(app, async (url) => {
    /*
     * 200, and deliberately so - this pins the absent-resource convention
     * rather than contradicting it. An id that resolves to nothing yields no
     * ResourceContext, and no resource means "the guard cannot answer a row
     * question, so let the handler answer it": the guard decides whether you
     * may CALL the endpoint, the service decides which rows you may see, and
     * an id nobody owns becomes a 404 there rather than a 403 here.
     *
     * The important half is that it is not a 500: a missing row must not
     * surface as the resolver throwing through requirePermission.
     */
    const res = await get(url, '/api/v1/hrms/employees/nope');
    assert.equal(res.status, 200);
  });
});

test('with no employee provider the resolver degrades instead of 503-ing the route', async (t) => {
  t.after(() => {
    __resetHrmsAuthRegistry();
    __resetReferenceProviders();
  });
  __resetHrmsAuthRegistry();
  __resetReferenceProviders();
  await bootstrapHrms();
  // Drop the provider bootstrapHrms registered, leaving the registry empty.
  __resetReferenceProviders();
  setEmployeeResolver(async () => null);

  const hrAdmin = { _id: 'u-hr', role: 'HR', roles: [R.HR_ADMIN], status: 'Active' };
  const app = appFor(
    hrAdmin,
    requirePermission(
      { module: M.EMPLOYEES, action: A.VIEW, scope: S.ORG },
      { module: M.EMPLOYEES, action: A.VIEW, scope: S.TEAM, resourceParam: 'id' },
    ),
  );

  await withServer(app, async (url) => {
    // The org-scoped spec needs no resource at all. If the resolver threw
    // HrmsNotImplementedError here, requirePermission resolves every param
    // BEFORE evaluating any spec, so this would be a 503 for someone whose
    // permission never depended on the lookup.
    assert.equal((await get(url, '/api/v1/hrms/employees/e-report')).status, 200);
  });
});
