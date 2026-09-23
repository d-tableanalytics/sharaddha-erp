/**
 * The matrix decides, and a cell means "any of these keys".
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TESTS ARE FOR
 * ---------------------------------------------------------------------------
 *
 * Two changes to `utils/roleResolver.js` are what make the product's stated
 * rule - "View only means view only" - true, and both are invisible from the
 * outside until somebody unticks a box:
 *
 *   1. A role with a database row resolves to THAT ROW, not to the row unioned
 *      with the compiled-in baseline. Before, the baseline was a floor and
 *      unticking a cell changed nothing for any built-in role.
 *
 *   2. A cell's key list is satisfied by ANY of its keys. Before, `can()`
 *      required EVERY key while `menuFor()` required any - so Sales, who hold
 *      `manage_customer_users` and not `manage_users`, were given a Customer
 *      Management link that `can()` said they could not use.
 *
 * Everything here is asserted against a REAL role row, because the whole point
 * is what happens when the database has an opinion. `tests/permissions.test.js`
 * covers the no-row case, which is the baseline fallback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import Role from '../models/Role.js';
import { can, loadRoles, resolveRolePermissions, satisfiesCell } from '../utils/roleResolver.js';
import { startTestMongo, stopTestMongo, syncIndexes, clearCollections } from './helpers/mongo.js';

test.before(async () => {
  await startTestMongo();
  await syncIndexes(Role);
});

test.after(async () => {
  await stopTestMongo();
});

test.beforeEach(async () => {
  await clearCollections(Role);
});

// ---------------------------------------------------------------------------
// 1. The row is the whole answer
// ---------------------------------------------------------------------------

test('a role row with only view grants resolves to view only', async () => {
  await Role.create({
    name: 'Sales',
    isSystem: true,
    grants: [{ module: 'work_queue', submodule: 'tasks', actions: ['view'] }],
    permissions: [],
  });
  await loadRoles();

  const user = { role: 'Sales' };

  assert.equal(can(user, 'work_queue', 'tasks', 'view'), true, 'view was granted');

  // The four that must NOT come back. Under the old baseline union, Sales held
  // the whole Work Queue block compiled in, so every one of these answered true
  // no matter what the row said.
  assert.equal(can(user, 'work_queue', 'tasks', 'create'), false);
  assert.equal(can(user, 'work_queue', 'tasks', 'edit'), false);
  assert.equal(can(user, 'work_queue', 'tasks', 'delete'), false);
  assert.equal(can(user, 'work_queue', 'tasks', 'approve'), false);
});

test('unticking a cell revokes it, which is the whole point', async () => {
  const role = await Role.create({
    name: 'Management',
    isSystem: true,
    grants: [
      { module: 'work_queue', submodule: 'tasks', actions: ['view', 'create', 'edit'] },
    ],
  });
  await loadRoles();
  assert.equal(can({ role: 'Management' }, 'work_queue', 'tasks', 'create'), true);

  // The Super Admin unticks Create and saves.
  await Role.updateOne(
    { _id: role._id },
    { $set: { grants: [{ module: 'work_queue', submodule: 'tasks', actions: ['view', 'edit'] }] } },
  );
  await loadRoles();

  assert.equal(
    can({ role: 'Management' }, 'work_queue', 'tasks', 'create'),
    false,
    'the untick took effect',
  );
  assert.equal(can({ role: 'Management' }, 'work_queue', 'tasks', 'edit'), true, 'edit survived');
});

test('a role with NO row still falls back to its compiled-in baseline', async () => {
  // Nothing created. This is the cold-process, empty-collection, database-down
  // case, and it must not lock the business out of its own ERP.
  await loadRoles();

  const permissions = resolveRolePermissions('Sales');
  assert.ok(permissions.length > 0, 'the baseline answered');
  assert.ok(permissions.includes('raise_po'), 'and it is the real baseline');
});

test('an empty row means empty, not baseline', async () => {
  await Role.create({ name: 'Sales', isSystem: true, grants: [], permissions: [] });
  await loadRoles();

  assert.deepEqual(
    resolveRolePermissions('Sales'),
    [],
    'a row that grants nothing grants nothing - otherwise revocation is impossible',
  );
});

test('the super-admin flag still short-circuits everything', async () => {
  await Role.create({ name: 'Super Admin', isSystem: true, isSuperAdmin: true, grants: [] });
  await loadRoles();

  assert.deepEqual(resolveRolePermissions('Super Admin'), ['*']);
  assert.equal(can({ role: 'Super Admin' }, 'work_queue', 'administration', 'delete'), true);
});

// ---------------------------------------------------------------------------
// 2. A cell is satisfied by ANY of its keys
// ---------------------------------------------------------------------------

test('satisfiesCell: any key admits, an empty list admits nobody', () => {
  assert.equal(
    satisfiesCell(['manage_customer_users'], ['manage_customer_users', 'manage_users']),
    true,
  );
  assert.equal(satisfiesCell(['manage_users'], ['manage_customer_users', 'manage_users']), true);
  assert.equal(satisfiesCell(['something_else'], ['manage_customer_users', 'manage_users']), false);

  assert.equal(satisfiesCell(['*'], ['anything']), true, 'the wildcard satisfies every cell');

  // A cell that grants nothing must not read as permission to do the thing.
  assert.equal(satisfiesCell(['*'], []), false);
  assert.equal(satisfiesCell(['*'], undefined), false);
});

test('a holder of one of a two-key cell can use it', async () => {
  await Role.create({
    name: 'Management',
    isSystem: true,
    grants: [{ module: 'administration', submodule: 'roles', actions: ['view'] }],
  });
  await loadRoles();

  // administration.overview.view is [manage_users, manage_roles], and the role
  // above holds only the second. Under `every` this answered false, so an
  // account that could edit the permission matrix could not open the Admin
  // Panel that links to it.
  assert.equal(can({ role: 'Management' }, 'administration', 'overview', 'view'), true);

  // ANY must not mean ALL: the other key is still not held.
  assert.equal(
    can({ role: 'Management' }, 'administration', 'users', 'view'),
    false,
    'Internal User Management needs manage_users on its own',
  );
});

test('the domain fence still outranks the matrix', async () => {
  await Role.create({
    name: 'Sales',
    isSystem: true,
    grants: [],
    // Exactly the shape scripts/seed-role-baselines.js writes for Sales: the one
    // baseline key no single cell can express on its own.
    permissions: ['manage_customer_users'],
  });
  await loadRoles();

  // Customer Management is a CUSTOMER-domain screen, and these tests run in the
  // employee domain. The key is granted and the cell would admit it, and the
  // answer is still no - which is the fence doing its job, not the matrix
  // failing. Asserted so that a later change to `satisfiesCell` cannot quietly
  // widen a role across domains.
  assert.equal(can({ role: 'Sales' }, 'administration', 'customers', 'view'), false);
});

// ---------------------------------------------------------------------------
// 3. The Work Queue cells this change introduced
// ---------------------------------------------------------------------------

test('the Work Queue sub-modules are separately grantable', async () => {
  await Role.create({
    name: 'Import Team',
    isSystem: true,
    grants: [
      { module: 'work_queue', submodule: 'tasks', actions: ['view'] },
      { module: 'work_queue', submodule: 'checklist', actions: ['view'] },
    ],
  });
  await loadRoles();
  const user = { role: 'Import Team' };

  assert.equal(can(user, 'work_queue', 'checklist', 'view'), true);

  // The three screens that used to ride in on view_o2d and are now their own
  // grants: the bin, everybody's targets, and the audit log.
  assert.equal(can(user, 'work_queue', 'trash', 'view'), false);
  assert.equal(can(user, 'work_queue', 'scoreboard', 'edit'), false);

  // Reading the checklist must not carry the right to stop a routine or close
  // an occurrence - the split this change exists for.
  assert.equal(can(user, 'work_queue', 'checklist', 'create'), false);
  assert.equal(can(user, 'work_queue', 'checklist', 'delete'), false);
  assert.equal(can(user, 'work_queue', 'checklist', 'approve'), false);
});

test('the Work Queue no longer answers to the FMS key', async () => {
  await Role.create({
    name: 'Billing',
    isSystem: true,
    // Everything FMS has, and nothing from the Work Queue.
    grants: [
      { module: 'o2d', submodule: 'orders', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
      { module: 'o2d', submodule: 'tasks', actions: ['view'] },
    ],
  });
  await loadRoles();
  const user = { role: 'Billing' };

  assert.equal(can(user, 'o2d', 'orders', 'view'), true, 'FMS is granted');

  // Before this change every one of these answered true, because the checklist,
  // scoreboard and activity routers all gated on view_o2d.
  assert.equal(can(user, 'work_queue', 'checklist', 'view'), false);
  assert.equal(can(user, 'work_queue', 'checklist', 'create'), false);
  assert.equal(can(user, 'work_queue', 'scoreboard', 'view'), false);
  assert.equal(can(user, 'work_queue', 'activity', 'view'), false);
});
