/**
 * Administration's four actions no longer share one key.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GUARDS
 * ---------------------------------------------------------------------------
 *
 * `administration.users` and `administration.roles` used to back View, Create,
 * Edit and Delete with the SAME flat key (`manage_users`, `manage_roles`
 * respectively). Ticking View in the matrix compiled to the key the create,
 * update and delete ROUTES demanded, so a role granted read-only access to
 * User Management could POST a new account - the exact failure "View only
 * means view only" describes, and the one place in this codebase where it was
 * still true after the Work Queue fix.
 *
 * These tests exercise the REAL routers - `buildTestApp`/`stubProtect`, the
 * pattern `tests/academy-api.test.js` established - with a role that holds one
 * action and not the others.
 */

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import Role from '../models/Role.js';
import User from '../models/User.js';
import userRoutes from '../modules/users/user.routes.js';
import roleRoutes from '../modules/roles/role.routes.js';
import { loadRoles } from '../utils/roleResolver.js';
import { buildTestApp, stubProtect, withServer, get, post, patch, del } from './helpers/http.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

before(async () => {
  await startTestMongo();
  await syncIndexes(Role, User);
});

after(async () => {
  await stopTestMongo();
});

beforeEach(async () => {
  await clearCollections(Role, User);
});

let seq = 0;

/** A real Role row with the given grants, and an app authenticated as it. */
const appFor = async (grants) => {
  seq += 1;
  const roleName = `Custom Admin ${seq}`;
  await Role.create({ name: roleName, isSystem: false, grants });
  await loadRoles();

  return buildTestApp({
    mount: (app) => {
      // A real ObjectId, not the string 'u1': the audit logger every write
      // route runs through casts `req.user._id` into an AuditLog document, and
      // a non-ObjectId string fails that cast rather than the check under test.
      app.use(stubProtect({ _id: new mongoose.Types.ObjectId(), role: roleName, status: 'Active' }));
      app.use('/api/v1/users', userRoutes);
      app.use('/api/v1/roles', roleRoutes);
    },
  });
};

// ---------------------------------------------------------------------------
// Internal User Management
// ---------------------------------------------------------------------------

test('view-only on Internal User Management may list but not create', async () => {
  const app = await appFor([{ module: 'administration', submodule: 'users', actions: ['view'] }]);

  await withServer(app, async (url) => {
    const list = await get(url, '/api/v1/users');
    assert.equal(list.status, 200, 'view was granted');

    const create = await post(url, '/api/v1/users', {
      user: 'x',
      email: 'x@example.test',
      password: 'whatever123',
      role: 'Sales',
    });
    assert.equal(create.status, 403, 'create was not granted, so the route refuses');
  });
});

test('create-only on Internal User Management may not edit an existing account', async () => {
  const target = await User.create({
    user: 'Target',
    email: 'target@example.test',
    password: 'irrelevant-hash',
    role: 'Sales',
    status: 'Active',
  });
  const app = await appFor([
    { module: 'administration', submodule: 'users', actions: ['view', 'create'] },
  ]);

  await withServer(app, async (url) => {
    const edit = await patch(url, `/api/v1/users/${target._id}`, { user: 'Renamed' });
    assert.equal(edit.status, 403, 'edit was not granted');
  });
});

test('the full grant can create an account', async () => {
  const app = await appFor([
    { module: 'administration', submodule: 'users', actions: ['view', 'create', 'edit'] },
  ]);

  await withServer(app, async (url) => {
    const create = await post(url, '/api/v1/users', {
      user: 'New Person',
      email: 'new-person@example.test',
      password: 'whatever123',
      role: 'Sales',
    });
    assert.equal(create.status, 201);
  });
});

// ---------------------------------------------------------------------------
// Roles & Permissions
// ---------------------------------------------------------------------------

test('view-only on Roles & Permissions may read the matrix but not create a role', async () => {
  const app = await appFor([{ module: 'administration', submodule: 'roles', actions: ['view'] }]);

  await withServer(app, async (url) => {
    const list = await get(url, '/api/v1/roles');
    assert.equal(list.status, 200);

    const create = await post(url, '/api/v1/roles', { name: 'Should Not Exist' });
    assert.equal(create.status, 403);
  });
});

test('view-only on Roles & Permissions can also read the eight HRMS roles', async () => {
  // Not a second permission system: GET /roles/hrms sits behind the exact same
  // gate as GET /roles above, and answers with the same data the HRMS
  // settings screen reads via getRoleMatrix() - one source, two places to see it.
  const app = await appFor([{ module: 'administration', submodule: 'roles', actions: ['view'] }]);

  await withServer(app, async (url) => {
    const res = await get(url, '/api/v1/roles/hrms');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data.roles));
    assert.equal(res.body.data.roles.length, 8, 'the eight seeded HRMS roles, no custom ones yet');
    for (const role of res.body.data.roles) {
      // Every role is an editable database row now; `hrms_super_admin` is the
      // one exception, marked `protected` rather than uneditable.
      assert.equal(role.isSystem, false, `${role.key} is a database row, not code-defined`);
      assert.equal(
        role.protected,
        role.key === 'hrms_super_admin',
        `only hrms_super_admin should come back protected`,
      );
      assert.ok(Array.isArray(role.permissions));
      assert.equal(typeof role.userCount, 'number');
    }
  });
});

test('view-only may not delete a role, and edit-only may not delete either', async () => {
  const role = await Role.create({ name: 'Disposable', isSystem: false, grants: [] });

  for (const actions of [['view'], ['view', 'edit']]) {
    const app = await appFor([{ module: 'administration', submodule: 'roles', actions }]);
    // eslint-disable-next-line no-await-in-loop
    await withServer(app, async (url) => {
      const result = await del(url, `/api/v1/roles/${role._id}`);
      assert.equal(result.status, 403, `delete was not granted for actions=[${actions}]`);
    });
  }
});

test('edit-only on Roles & Permissions can rewrite grants but not delete the role', async () => {
  const role = await Role.create({ name: 'Editable', isSystem: false, grants: [] });
  const app = await appFor([{ module: 'administration', submodule: 'roles', actions: ['view', 'edit'] }]);

  await withServer(app, async (url) => {
    const patched = await patch(url, `/api/v1/roles/${role._id}`, {
      grants: [{ module: 'work_queue', submodule: 'tasks', actions: ['view'] }],
    });
    assert.equal(patched.status, 200);

    const deleted = await del(url, `/api/v1/roles/${role._id}`);
    assert.equal(deleted.status, 403);
  });
});
