/**
 * Custom HRMS roles: the builder, and the grants it produces.
 *
 * The thing worth proving is not that the CRUD works - it is that a tick in
 * the builder changes what a request may do. The reference's own README calls
 * that out as the whole point of the feature, and a role screen whose
 * checkboxes do not reach the guard is the failure mode this suite exists to
 * catch.
 *
 * So the centre of this file is the round trip: create a role granting
 * leave:approve:org, assign it to somebody who could not approve leave, and
 * watch a real request through the real middleware chain start passing.
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';

import Employee from '../models/hrms/Employee.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { HrmsRole, HrmsUserRole } from '../models/hrms/RoleModels.js';
import settingsRoutes from '../modules/hrms/settings/settings.routes.js';
import employeeRoutes from '../modules/hrms/employees/employee.routes.js';
import { hrmsAuthorizationChain, setEmployeeResolver } from '../middlewares/hrmsAuth.js';
import { attachCustomHrmsGrants } from '../modules/hrms/rbac/customRole.middleware.js';
import { requirePermission } from '../middlewares/hrmsAuth.js';
import { hrmsErrorHandler } from '../modules/hrms/hrms.errors.js';
import {
  registerReferenceProvider,
  __resetReferenceProviders,
} from '../modules/hrms/references/reference.service.js';
import { employeeReferenceProvider } from '../modules/hrms/employees/employee.provider.js';
import {
  HRMS_ROLES as R,
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
  HRMS_MODULE_LIST,
  HRMS_ACTION_LIST,
  SCOPE_LIST,
} from '../shared/permissions/constants.js';
import { AUDIT_ACTIONS } from '../shared/constants/hrms.js';
import { buildTestApp, stubProtect, withServer, get, post, patch, del } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

const API = '/api/v1/hrms/settings';

before(async () => {
  await startTestMongo();
  await syncIndexes(Employee, User, HrmsRole, HrmsUserRole);
  registerReferenceProvider('employee', employeeReferenceProvider);
  setEmployeeResolver((userId) => employeeReferenceProvider.byUserId(userId));
});

after(async () => {
  __resetReferenceProviders();
  await stopTestMongo();
});

beforeEach(async () => {
  await clearCollections(Employee, User, HrmsRole, HrmsUserRole, AuditLog);
});

let seq = 0;

/** A user with an employee record, holding the given built-in HRMS roles. */
async function makePerson(roles, { managerChain = [] } = {}) {
  seq += 1;
  const user = await User.create({
    user: `Person ${seq}`,
    email: `person${seq}@example.test`,
    password: 'irrelevant-hash',
    role: 'Management',
    roles,
    status: 'Active',
  });
  const employee = await Employee.create({
    employeeCode: `E${String(seq).padStart(3, '0')}`,
    firstName: 'Test',
    lastName: `Person ${seq}`,
    dateOfJoining: new Date('2026-01-01'),
    employmentType: 'full_time',
    status: 'active',
    userId: user._id,
    managerChain,
  });
  return { user, employee };
}

/** The settings surface, behind the real authorization chain. */
const settingsApp = (user) =>
  buildTestApp({
    mount: (a) => {
      const router = express.Router();
      router.use(stubProtect(user));
      router.use(hrmsAuthorizationChain);
      router.use(attachCustomHrmsGrants);
      router.use('/settings', settingsRoutes);
      router.use('/employees', employeeRoutes);
      router.use(hrmsErrorHandler);
      a.use('/api/v1/hrms', router);
    },
  });

const envelope = (res) => {
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
  return res.body.data;
};

const REGIONAL = {
  key: 'hrms_regional_manager',
  label: 'Regional Manager',
  description: 'Approves leave company-wide without the rest of HR.',
  permissions: [{ module: M.LEAVE, action: A.APPROVE, scope: S.ORG }],
};

// ===========================================================================
// The vocabulary the builder draws from
// ===========================================================================

test('the builder is served the FULL module, action and scope vocabulary', async () => {
  /*
   * The reference hardcodes 19 modules and 7 actions in its React component
   * and has since drifted from its own 33-module, 10-action union - so its
   * builder cannot grant payroll:run, helpdesk:resolve or any sub-module at
   * all. Serving the vocabulary from the same constants the evaluator imports
   * is what makes that drift impossible.
   */
  const { user } = await makePerson([R.SUPER_ADMIN]);
  await withServer(settingsApp(user), async (url) => {
    const data = envelope(await get(url, `${API}/roles`));

    assert.deepEqual(data.modules, [...HRMS_MODULE_LIST]);
    assert.deepEqual(data.actions, [...HRMS_ACTION_LIST]);
    assert.deepEqual(data.scopes, [...SCOPE_LIST]);

    // The sub-modules the reference's builder cannot reach at all.
    for (const sub of ['employees:compensation', 'helpdesk:it', 'reports:payroll']) {
      assert.ok(data.modules.includes(sub), `${sub} must be grantable`);
    }
    assert.ok(data.actions.includes('run'), 'payroll:run must be grantable');
    assert.ok(data.actions.includes('resolve'));
  });
});

// ===========================================================================
// CRUD
// ===========================================================================

test('a super admin creates a custom role, and it appears beside the built-in eight', async () => {
  const { user } = await makePerson([R.SUPER_ADMIN]);
  await withServer(settingsApp(user), async (url) => {
    const created = await post(url, `${API}/roles`, REGIONAL);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.key, REGIONAL.key);
    assert.equal(created.body.data.isSystem, false);
    assert.equal(created.body.data.userCount, 0);

    const data = envelope(await get(url, `${API}/roles`));
    const mine = data.roles.find((r) => r.key === REGIONAL.key);
    assert.ok(mine, 'the custom role is listed');
    assert.equal(mine.isSystem, false);
    assert.equal(data.roles.length, 9, 'the built-in eight plus the new custom role');
    assert.equal(data.editable, true);
  });
});

test('a duplicate key is a 409 naming the collision, not a raw driver error', async () => {
  const { user } = await makePerson([R.SUPER_ADMIN]);
  await withServer(settingsApp(user), async (url) => {
    assert.equal((await post(url, `${API}/roles`, REGIONAL)).status, 201);

    const again = await post(url, `${API}/roles`, REGIONAL);
    assert.equal(again.status, 409);
    assert.match(again.body.message, /already in use/i);
  });
});

test('an invented module, action or scope is refused with a 400', async () => {
  /*
   * The reference types these as bare `string`, so `empolyees` persists and
   * grants nothing forever. Two layers here: the DTO below, and an enum on the
   * sub-schema for anything that reaches the model another way.
   */
  const { user } = await makePerson([R.SUPER_ADMIN]);
  await withServer(settingsApp(user), async (url) => {
    const cases = [
      { module: 'empolyees', action: A.VIEW, scope: S.ORG },
      { module: M.EMPLOYEES, action: 'peruse', scope: S.ORG },
      { module: M.EMPLOYEES, action: A.VIEW, scope: 'galaxy' },
    ];
    for (const bad of cases) {
      // eslint-disable-next-line no-await-in-loop
      const res = await post(url, `${API}/roles`, {
        key: 'hrms_bad_one',
        label: 'Bad',
        permissions: [bad],
      });
      assert.equal(res.status, 400, JSON.stringify(bad));
    }

    // And nothing was written by any of them — the seeded eight are the only
    // rows, `hrms_bad_one` never landed.
    assert.equal(await HrmsRole.countDocuments({ key: 'hrms_bad_one' }), 0);
  });
});

test('a bad key shape, and one colliding with a built-in role, are both refused', async () => {
  const { user } = await makePerson([R.SUPER_ADMIN]);
  await withServer(settingsApp(user), async (url) => {
    for (const key of ['regional_manager', 'hrms_Regional', 'hrms_', R.MANAGER]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await post(url, `${API}/roles`, { key, label: 'X', permissions: [] });
      assert.equal(res.status, 400, `key "${key}" must be refused`);
    }
  });
});

test('an update REPLACES the permission set and cannot rename the key', async () => {
  const { user } = await makePerson([R.SUPER_ADMIN]);
  await withServer(settingsApp(user), async (url) => {
    const { body } = await post(url, `${API}/roles`, {
      ...REGIONAL,
      permissions: [
        { module: M.LEAVE, action: A.APPROVE, scope: S.ORG },
        { module: M.LEAVE, action: A.VIEW, scope: S.ORG },
      ],
    });
    const id = body.data.id;

    const updated = envelope(
      await patch(url, `${API}/roles/${id}`, {
        label: 'Area Manager',
        permissions: [{ module: M.EXPENSES, action: A.APPROVE, scope: S.ORG }],
      }),
    );

    assert.equal(updated.label, 'Area Manager');
    assert.equal(updated.key, REGIONAL.key, 'the key is immutable');
    assert.deepEqual(
      updated.permissions,
      [{ module: M.EXPENSES, action: A.APPROVE, scope: S.ORG }],
      'replaced wholesale, not merged',
    );

    // `key` is not even accepted in the payload - strict() refuses it.
    const renamed = await patch(url, `${API}/roles/${id}`, { key: 'hrms_something_else' });
    assert.equal(renamed.status, 400);
  });
});

test('a role still held by somebody cannot be deleted, and the message counts them', async () => {
  const { user: admin } = await makePerson([R.SUPER_ADMIN]);
  const { employee } = await makePerson([R.EMPLOYEE]);

  await withServer(settingsApp(admin), async (url) => {
    const { body } = await post(url, `${API}/roles`, REGIONAL);
    const id = body.data.id;

    envelope(
      await patch(url, `/api/v1/hrms/employees/${employee._id}/roles`, {
        roleKeys: [R.EMPLOYEE, REGIONAL.key],
      }),
    );

    const refused = await del(url, `${API}/roles/${id}`);
    assert.equal(refused.status, 409);
    assert.match(refused.body.message, /1 account\(s\) still hold it/i);

    // The count is reported on the list too, so the screen can warn first.
    const data = envelope(await get(url, `${API}/roles`));
    assert.equal(data.roles.find((r) => r.key === REGIONAL.key).userCount, 1);

    // Once nobody holds it, it goes.
    envelope(
      await patch(url, `/api/v1/hrms/employees/${employee._id}/roles`, {
        roleKeys: [R.EMPLOYEE],
      }),
    );
    assert.equal((await del(url, `${API}/roles/${id}`)).status, 200);
    assert.equal(await HrmsRole.countDocuments({ key: REGIONAL.key }), 0);
  });
});

test('every role write is audited; a refused one is not', async () => {
  const { user } = await makePerson([R.SUPER_ADMIN]);
  await withServer(settingsApp(user), async (url) => {
    const { body } = await post(url, `${API}/roles`, REGIONAL);
    await patch(url, `${API}/roles/${body.data.id}`, { label: 'Renamed' });
    await post(url, `${API}/roles`, REGIONAL); // 409, writes nothing
    await del(url, `${API}/roles/${body.data.id}`);

    const actions = (await AuditLog.find().lean()).map((a) => a.action);
    assert.deepEqual(actions.sort(), [
      AUDIT_ACTIONS.SETTINGS_ROLE_CREATED,
      AUDIT_ACTIONS.SETTINGS_ROLE_DELETED,
      AUDIT_ACTIONS.SETTINGS_ROLE_UPDATED,
    ].sort());
  });
});

// ===========================================================================
// Authorization on the surface itself
// ===========================================================================

test('only settings holders reach the role surface at all', async () => {
  // hr_admin holds no `settings` grant in the matrix - Settings is super-admin
  // only, in both codebases.
  const { user: hr } = await makePerson([R.HR_ADMIN]);
  await withServer(settingsApp(hr), async (url) => {
    assert.equal((await get(url, `${API}/roles`)).status, 403);
    assert.equal((await post(url, `${API}/roles`, REGIONAL)).status, 403);
  });
});

// ===========================================================================
// The part that matters: a tick changes what a request may do
// ===========================================================================

test('a custom role grant reaches the guard and changes the answer', async (t) => {
  const { user: admin } = await makePerson([R.SUPER_ADMIN]);
  const { user: subject, employee } = await makePerson([R.EMPLOYEE]);

  // A route gated exactly as a real leave-approval route is.
  const guardedApp = (user) =>
    buildTestApp({
      mount: (a) => {
        const router = express.Router();
        router.use(stubProtect(user));
        router.use(hrmsAuthorizationChain);
        router.use(attachCustomHrmsGrants);
        router.get(
          '/approve',
          requirePermission({ module: M.LEAVE, action: A.APPROVE, scope: S.ORG }),
          (req, res) => res.json({ success: true }),
        );
        router.use(hrmsErrorHandler);
        a.use('/api/v1/hrms', router);
      },
    });

  // Before: an ordinary employee cannot approve anybody's leave.
  await withServer(guardedApp(subject), async (url) => {
    assert.equal((await get(url, '/api/v1/hrms/approve')).status, 403);
  });

  // The Super Admin builds the role and assigns it.
  await withServer(settingsApp(admin), async (url) => {
    assert.equal((await post(url, `${API}/roles`, REGIONAL)).status, 201);
    envelope(
      await patch(url, `/api/v1/hrms/employees/${employee._id}/roles`, {
        roleKeys: [R.EMPLOYEE, REGIONAL.key],
      }),
    );
  });

  // After: the same request, the same guard, a different answer.
  await withServer(guardedApp(subject), async (url) => {
    assert.equal(
      (await get(url, '/api/v1/hrms/approve')).status,
      200,
      'the tick in the builder is what granted this',
    );
  });

  t.diagnostic('custom grant round trip: 403 -> builder -> 200');
});

test('deactivating a role withdraws its grants without unassigning anybody', async () => {
  /*
   * The difference from deleting is the point: a role somebody still holds
   * cannot be deleted at all, but its access can need withdrawing today.
   * Deactivating drops the grants and keeps both the definition and the
   * assignments, so reactivating restores exactly what was there.
   */
  const { user: admin } = await makePerson([R.SUPER_ADMIN]);
  const { user: subject, employee } = await makePerson([R.EMPLOYEE]);

  const guardedApp = (user) =>
    buildTestApp({
      mount: (a) => {
        const router = express.Router();
        router.use(stubProtect(user));
        router.use(hrmsAuthorizationChain);
        router.use(attachCustomHrmsGrants);
        router.get(
          '/approve',
          requirePermission({ module: M.LEAVE, action: A.APPROVE, scope: S.ORG }),
          (req, res) => res.json({ success: true }),
        );
        router.use(hrmsErrorHandler);
        a.use('/api/v1/hrms', router);
      },
    });

  let roleId;
  await withServer(settingsApp(admin), async (url) => {
    const created = await post(url, `${API}/roles`, REGIONAL);
    roleId = created.body.data.id;
    assert.equal(created.body.data.active, true, 'a new role is active');

    envelope(
      await patch(url, `/api/v1/hrms/employees/${employee._id}/roles`, {
        roleKeys: [R.EMPLOYEE, REGIONAL.key],
      }),
    );
  });

  await withServer(guardedApp(subject), async (url) => {
    assert.equal((await get(url, '/api/v1/hrms/approve')).status, 200);
  });

  // Deactivate — on its own, without resending the permission set.
  await withServer(settingsApp(admin), async (url) => {
    const off = envelope(await patch(url, `${API}/roles/${roleId}`, { active: false }));
    assert.equal(off.active, false);
    assert.equal(off.permissions.length, 1, 'the definition is intact');
    assert.equal(off.userCount, 1, 'and so is the assignment');
  });

  assert.equal(await HrmsUserRole.countDocuments({ userId: subject._id }), 1);

  await withServer(guardedApp(subject), async (url) => {
    assert.equal(
      (await get(url, '/api/v1/hrms/approve')).status,
      403,
      'an inactive role grants nothing',
    );
  });

  // Reactivate — the access comes back with no reassignment.
  await withServer(settingsApp(admin), async (url) => {
    envelope(await patch(url, `${API}/roles/${roleId}`, { active: true }));
  });

  await withServer(guardedApp(subject), async (url) => {
    assert.equal((await get(url, '/api/v1/hrms/approve')).status, 200);
  });
});

test('revoking the role takes the grant away again', async () => {
  const { user: admin } = await makePerson([R.SUPER_ADMIN]);
  const { user: subject, employee } = await makePerson([R.EMPLOYEE]);

  await withServer(settingsApp(admin), async (url) => {
    await post(url, `${API}/roles`, REGIONAL);
    await patch(url, `/api/v1/hrms/employees/${employee._id}/roles`, {
      roleKeys: [R.EMPLOYEE, REGIONAL.key],
    });

    const held = envelope(await get(url, `/api/v1/hrms/employees/${employee._id}/roles`));
    assert.deepEqual(held.roleKeys, [R.EMPLOYEE]);
    assert.deepEqual(held.customRoleKeys, [REGIONAL.key]);

    await patch(url, `/api/v1/hrms/employees/${employee._id}/roles`, {
      roleKeys: [R.EMPLOYEE],
    });

    const after = envelope(await get(url, `/api/v1/hrms/employees/${employee._id}/roles`));
    assert.deepEqual(after.customRoleKeys, []);
    assert.equal(await HrmsUserRole.countDocuments({ userId: subject._id }), 0);
  });
});

test('a custom role cannot be the ONLY role somebody holds', async () => {
  /*
   * Custom grants are unioned on AFTER the AD-4 choke point, so an account
   * holding nothing else would be refused at the door and its grants never
   * consulted. Refusing at assignment time is the alternative to that
   * surfacing later as a 403 nobody can explain.
   */
  const { user: admin } = await makePerson([R.SUPER_ADMIN]);
  const { employee } = await makePerson([R.EMPLOYEE]);

  await withServer(settingsApp(admin), async (url) => {
    await post(url, `${API}/roles`, REGIONAL);

    const res = await patch(url, `/api/v1/hrms/employees/${employee._id}/roles`, {
      roleKeys: [REGIONAL.key],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /extends a built-in HRMS role/i);
  });
});

test('an unknown role key is refused before anything is written', async () => {
  const { user: admin } = await makePerson([R.SUPER_ADMIN]);
  const { employee, user: subject } = await makePerson([R.EMPLOYEE]);

  await withServer(settingsApp(admin), async (url) => {
    const res = await patch(url, `/api/v1/hrms/employees/${employee._id}/roles`, {
      roleKeys: [R.MANAGER, 'hrms_does_not_exist'],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Unknown custom role key/i);

    // The built-in half must NOT have been applied despite being valid.
    const fresh = await User.findById(subject._id).select('roles').lean();
    assert.deepEqual(fresh.roles, [R.EMPLOYEE], 'no partial assignment');
  });
});

test('a custom role never widens who reaches HRMS at all (AD-4 holds)', async () => {
  /*
   * A Customer is fenced out of HRMS structurally. Even holding a custom role
   * row - which the assignment surface would refuse, so this writes it
   * directly - changes nothing, because the AD-4 gate runs first and reads
   * only matrix-derived grants.
   */
  const customer = await User.create({
    user: 'A Customer',
    email: 'customer@example.test',
    password: 'irrelevant-hash',
    role: 'Customer',
    roles: [],
    status: 'Active',
  });
  const role = await HrmsRole.create({
    key: 'hrms_sneaky',
    label: 'Sneaky',
    permissions: [{ module: M.EMPLOYEES, action: A.VIEW, scope: S.ORG }],
  });
  await HrmsUserRole.create({ userId: customer._id, roleId: role._id });

  await withServer(settingsApp(customer), async (url) => {
    assert.equal((await get(url, `${API}/roles`)).status, 403);
    assert.equal((await get(url, '/api/v1/hrms/employees')).status, 403);
  });
});

test('two roles granting the same triple resolve to one grant', async () => {
  const { user: admin } = await makePerson([R.SUPER_ADMIN]);
  const { employee } = await makePerson([R.EMPLOYEE]);

  await withServer(settingsApp(admin), async (url) => {
    await post(url, `${API}/roles`, REGIONAL);
    await post(url, `${API}/roles`, {
      key: 'hrms_area_lead',
      label: 'Area Lead',
      permissions: [
        { module: M.LEAVE, action: A.APPROVE, scope: S.ORG },
        { module: M.EXPENSES, action: A.APPROVE, scope: S.ORG },
      ],
    });

    envelope(
      await patch(url, `/api/v1/hrms/employees/${employee._id}/roles`, {
        roleKeys: [R.EMPLOYEE, REGIONAL.key, 'hrms_area_lead'],
      }),
    );
  });

  const { resolveGrantsForRoleKeys } = await import('../modules/hrms/rbac/customRole.service.js');
  const { permissions } = await resolveGrantsForRoleKeys([
    R.EMPLOYEE,
    REGIONAL.key,
    'hrms_area_lead',
  ]);

  // REGIONAL and hrms_area_lead both grant leave:approve:org - one grant, not
  // two, the same de-duplication the built-in matrix helper always did.
  const leaveApprovals = permissions.filter(
    (p) => p.module === M.LEAVE && p.action === A.APPROVE && p.scope === S.ORG,
  );
  assert.equal(leaveApprovals.length, 1, 'de-duplicated across roles');
  assert.ok(
    permissions.some((p) => p.module === M.EXPENSES && p.action === A.APPROVE && p.scope === S.ORG),
    'the OTHER custom grant survives the de-duplication',
  );
});

test('deleting a role a nobody holds leaves no orphaned assignments', async () => {
  const { user: admin } = await makePerson([R.SUPER_ADMIN]);
  await withServer(settingsApp(admin), async (url) => {
    const { body } = await post(url, `${API}/roles`, REGIONAL);
    assert.equal((await del(url, `${API}/roles/${body.data.id}`)).status, 200);
    assert.equal(await HrmsUserRole.countDocuments({ roleId: body.data.id }), 0);
  });
});

test('the model refuses an invalid triple even when the DTO is bypassed', async () => {
  // The second layer: a script, a seed or a future endpoint writing directly.
  await assert.rejects(
    () =>
      HrmsRole.create({
        key: 'hrms_direct',
        label: 'Direct',
        permissions: [{ module: 'not-a-module', action: A.VIEW, scope: S.ORG }],
      }),
    /not a valid enum value/i,
  );
});

test('an account with no roles beyond the eight resolves straight from the seed, with no extras', async () => {
  const { user } = await makePerson([R.EMPLOYEE]);
  const { customRoleKeysForUser } = await import('../modules/hrms/rbac/customRole.service.js');

  // No genuinely-custom assignment exists for this account.
  assert.deepEqual(await customRoleKeysForUser(user._id), []);

  /*
   * The middleware now ALWAYS re-resolves and REPLACES `req.hrmsActor` -
   * every role's permissions live in the database now, so even an account
   * holding only a seeded key needs its CURRENT (possibly edited) value read
   * fresh on every request. There is no "nothing to add, skip it" fast path
   * left; that is the accepted cost of every role being editable. What
   * survives is that the RESOLVED permissions equal what `hrms_employee`
   * actually grants - not the stale value the test hands in as a starting
   * point.
   */
  const actor = {
    userId: String(user._id),
    roleKeys: [R.EMPLOYEE],
    // Deliberately wrong, to prove the middleware replaces rather than
    // trusts this: a real request would never carry a stale grant like this.
    permissions: [{ module: M.LEAVE, action: A.VIEW, scope: S.SELF }],
  };
  const req = { hrmsActor: actor };
  await new Promise((resolve) => attachCustomHrmsGrants(req, {}, resolve));

  assert.notEqual(req.hrmsActor, actor, 'rebuilt, not reused');
  assert.ok(
    req.hrmsActor.permissions.some(
      (p) => p.module === M.EMPLOYEES && p.action === A.VIEW && p.scope === S.SELF,
    ),
    'resolved from the SEED, not from the stale permissions the actor carried in',
  );
});

test('mongo ids are validated at the boundary, not by a CastError', async () => {
  const { user } = await makePerson([R.SUPER_ADMIN]);
  await withServer(settingsApp(user), async (url) => {
    assert.equal((await del(url, `${API}/roles/nope`)).status, 400);
    assert.equal(
      (await patch(url, `${API}/roles/${new mongoose.Types.ObjectId()}`, { label: 'X' })).status,
      404,
    );
  });
});
