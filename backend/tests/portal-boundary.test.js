/**
 * The domain boundary between the Customer Portal and the Employee Portal.
 *
 * One database, one `users` collection, one `roles` collection — and two
 * domains that must show the same account different things. These tests are the
 * guard against the boundary quietly dissolving, which it would do silently:
 * a module that leaks into the wrong domain looks like a working feature.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MODULES,
  PORTALS,
  PORTAL_LIST,
  portalsOf,
  servesPortal,
  getSubmodule,
} from '../config/moduleRegistry.js';
import { currentPortal, isCurrentPortal } from '../config/portal.js';
import { menuFor, resolveUserPermissions } from '../utils/roleResolver.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const withPortal = (portal, fn) => {
  const prev = process.env.PORTAL;
  try {
    process.env.PORTAL = portal;
    return fn();
  } finally {
    if (prev === undefined) delete process.env.PORTAL;
    else process.env.PORTAL = prev;
  }
};

// ===========================================================================
// The registry is the single source of truth
// ===========================================================================

describe('module registry portal tags', () => {
  test('every module declares which portals serve it', () => {
    for (const mod of MODULES) {
      assert.ok(
        Array.isArray(mod.portals) && mod.portals.length,
        `module "${mod.key}" has no portals tag — it would default to EVERY portal, `
          + 'which is right for a genuinely shared module but must be a decision, not an omission',
      );
      for (const p of mod.portals) {
        assert.ok(PORTAL_LIST.includes(p), `module "${mod.key}" names unknown portal "${p}"`);
      }
    }
  });

  test('the customer domain owns the customer-facing modules and not HRMS', () => {
    const served = MODULES.filter((m) => servesPortal(m, PORTALS.CUSTOMER)).map((m) => m.key);
    for (const key of ['customer_portal', 'sales', 'inventory', 'reports']) {
      assert.ok(served.includes(key), `${key} must be served by the customer domain`);
    }
    assert.ok(!served.includes('hrms'), 'HRMS must not be served by the customer domain');
  });

  test('the employee domain owns HRMS and not the sales or inventory desks', () => {
    const served = MODULES.filter((m) => servesPortal(m, PORTALS.EMPLOYEE)).map((m) => m.key);
    assert.ok(served.includes('hrms'));
    for (const key of ['sales', 'inventory', 'customer_portal']) {
      assert.ok(!served.includes(key), `${key} must not be served by the employee domain`);
    }
  });

  test('an untagged entry defaults to every portal, and that default is documented', () => {
    // The permissive default is load-bearing: it means a new module cannot be
    // accidentally hidden. The test above is what stops it being used by
    // accident on a module that DOES have a boundary.
    assert.deepEqual(portalsOf({}), PORTAL_LIST);
    assert.deepEqual(portalsOf({ portals: [] }), PORTAL_LIST);
    assert.deepEqual(portalsOf({ portals: [PORTALS.EMPLOYEE] }), [PORTALS.EMPLOYEE]);
  });
});

// ===========================================================================
// Separate user management — the split you cannot get from one screen
// ===========================================================================

describe('customer vs internal user management', () => {
  test('they are two sub-modules, at two paths, in two domains', () => {
    const customers = getSubmodule('administration', 'customers');
    const users = getSubmodule('administration', 'users');
    assert.ok(customers, 'Customer Management must exist as its own sub-module');
    assert.ok(users, 'Internal User Management must exist as its own sub-module');

    assert.notEqual(
      customers.submodule.path,
      users.submodule.path,
      'two workflows sharing one route is the fusion this split exists to undo',
    );

    // Customers are a customer-domain concern.
    assert.deepEqual(customers.submodule.portals, [PORTALS.CUSTOMER]);
    // Staff work in BOTH domains, so both can create them.
    assert.deepEqual(users.submodule.portals, [PORTALS.CUSTOMER, PORTALS.EMPLOYEE]);
  });

  test('creating a customer never requires the permission that can create an admin', () => {
    const customers = getSubmodule('administration', 'customers').submodule;
    const users = getSubmodule('administration', 'users').submodule;

    // Sales holds manage_customer_users and must reach Customer Management.
    assert.ok(customers.actions.create.includes('manage_customer_users'));
    // ...and must NOT reach Internal User Management, which is the escalation
    // path: a salesperson who could create staff could create an Admin.
    assert.ok(!users.actions.create.includes('manage_customer_users'));
    assert.deepEqual(users.actions.create, ['manage_users']);
  });

  test('the role matrix is editable in exactly one domain', () => {
    const roles = getSubmodule('administration', 'roles').submodule;
    assert.deepEqual(
      roles.portals,
      [PORTALS.EMPLOYEE],
      'two editors of one Role.grants means one can strip what the other wrote',
    );
  });
});

// ===========================================================================
// The menu, per domain — the same account, two different navigations
// ===========================================================================

describe('menu is domain-scoped', () => {
  const superAdmin = { role: 'Super Admin', roles: [], extraGrants: [] };

  test('a Super Admin sees no HRMS in the customer domain', () => {
    withPortal(PORTALS.CUSTOMER, () => {
      const keys = menuFor(superAdmin).map((m) => m.key);
      assert.ok(!keys.includes('hrms'), 'the most privileged account must still be domain-scoped');
      assert.ok(keys.includes('inventory'));
    });
  });

  test('the same Super Admin sees no customer desks in the employee domain', () => {
    withPortal(PORTALS.EMPLOYEE, () => {
      const keys = menuFor(superAdmin).map((m) => m.key);
      for (const gone of ['sales', 'inventory', 'customer_portal', 'reports']) {
        assert.ok(!keys.includes(gone), `${gone} must not appear in the employee domain`);
      }
    });
  });

  /**
   * The `hrms` module contributes NO menu entries, in either domain, and that is
   * correct rather than a gap.
   *
   * Every one of its sub-modules carries `path: null` — they are ENTRY GRANTS
   * (`access_hrms`, `manage_hrms_payroll`, …) that the Employee Portal's own
   * navigation reads to decide what to draw. Giving them paths would put a
   * second, competing set of HRMS links in the sidebar, which is exactly what
   * the registry comment on that module warns against.
   *
   * Asserted so that a future reader who notices "HRMS is missing from the menu"
   * finds this test before they add paths to fix it.
   */
  test('the HRMS module is grant-only and contributes no navigation', () => {
    const hrms = MODULES.find((m) => m.key === 'hrms');
    assert.ok(hrms.submodules.every((s) => s.path === null),
      'HRMS registry cells grant entry; the Employee Portal draws its own nav');

    for (const portal of PORTAL_LIST) {
      withPortal(portal, () => {
        assert.ok(!menuFor(superAdmin).map((m) => m.key).includes('hrms'));
      });
    }
  });

  test('Roles & Permissions appears only in the employee domain', () => {
    const pathsIn = (portal) =>
      withPortal(portal, () => menuFor(superAdmin).flatMap((m) => m.items.map((i) => i.path)));

    assert.ok(!pathsIn(PORTALS.CUSTOMER).includes('/admin/permissions'));
    assert.ok(pathsIn(PORTALS.EMPLOYEE).includes('/admin/permissions'));
  });

  test('Customer Management appears only in the customer domain', () => {
    const pathsIn = (portal) =>
      withPortal(portal, () => menuFor(superAdmin).flatMap((m) => m.items.map((i) => i.path)));

    assert.ok(pathsIn(PORTALS.CUSTOMER).includes('/admin/customers'));
    assert.ok(!pathsIn(PORTALS.EMPLOYEE).includes('/admin/customers'));
  });
});

// ===========================================================================
// Resolved permissions are fenced too — the menu is convenience, this is not
// ===========================================================================

describe('permissions are domain-scoped', () => {
  test('an HR account holds no HRMS entry key while in the customer domain', () => {
    // HR's baseline is ADMINISTER_HRMS. In the employee domain it resolves; in
    // the customer domain it must not, or `authorize('administer_hrms')` on a
    // mis-mounted route would pass.
    const hr = { role: 'HR', roles: [], extraGrants: [] };
    const inEmployee = withPortal(PORTALS.EMPLOYEE, () => resolveUserPermissions(hr));
    const inCustomer = withPortal(PORTALS.CUSTOMER, () => resolveUserPermissions(hr));

    assert.ok(inEmployee.includes('administer_hrms'));
    assert.ok(!inCustomer.includes('administer_hrms'));
  });

  test('a Sales account keeps its booking permissions in the customer domain', () => {
    const sales = { role: 'Sales', roles: [], extraGrants: [] };
    const perms = withPortal(PORTALS.CUSTOMER, () => resolveUserPermissions(sales));
    for (const key of ['raise_po', 'view_all_bookings', 'manage_customer_users']) {
      assert.ok(perms.includes(key), `Sales must keep ${key} — the fence must not cost real access`);
    }
  });

  test('a Sales account loses those same permissions in the employee domain', () => {
    const sales = { role: 'Sales', roles: [], extraGrants: [] };
    const perms = withPortal(PORTALS.EMPLOYEE, () => resolveUserPermissions(sales));
    assert.ok(!perms.includes('raise_po'));
    assert.ok(!perms.includes('view_all_bookings'));
  });
});

// ===========================================================================
// The deployment's own identity
// ===========================================================================

describe('portal identity', () => {
  test('this repository is the employee portal by default', () => {
    const prev = process.env.PORTAL;
    try {
      delete process.env.PORTAL;
      // config/portal.js is the ONE file that legitimately differs between the
      // two repositories — its whole job is to say which domain this is.
      assert.equal(currentPortal(), PORTALS.EMPLOYEE);
      assert.equal(isCurrentPortal(PORTALS.EMPLOYEE), true);
    } finally {
      if (prev !== undefined) process.env.PORTAL = prev;
    }
  });

  test('an unrecognised PORTAL refuses to start rather than serving everything', () => {
    withPortal('customers', () => {
      // A typo must not resolve to "no tag matched -> serve all".
      assert.throws(() => currentPortal(), /not a known portal/);
    });
  });
});

// ===========================================================================
// HRMS is gone from this repository, and must stay gone
// ===========================================================================

describe('this repository is the employee domain', () => {
  /*
   * The mirror image of the Customer Portal's copy of this file, which asserts
   * that HRMS has LEFT. Here HRMS is the whole application, so the useful claim
   * is the opposite one: the customer-facing business modules must never appear.
   */
  test('HRMS is present, and the customer business modules are not', async () => {
    const { readdir } = await import('node:fs/promises');
    const present = async (rel) => {
      try { return (await readdir(path.join(ROOT, rel))).length > 0; } catch { return false; }
    };

    assert.equal(await present('modules/hrms'), true, 'HRMS is this repository');
    assert.equal(await present('models/hrms'), true);

    for (const foreign of ['modules/orders', 'modules/products', 'modules/inventory',
                           'modules/sales', 'modules/reservations']) {
      assert.equal(
        await present(foreign),
        false,
        `${foreign} belongs to the Customer Portal — a second writer against the shared `
          + 'database is what the split exists to prevent',
      );
    }
  });

  test('the app serves no customer-domain API namespace', async () => {
    const app = await readFile(path.join(ROOT, 'app.js'), 'utf8');
    for (const ns of ['orders', 'products', 'inventory', 'sales', 'reservations', 'notifications']) {
      assert.doesNotMatch(app, new RegExp(`app[.]use[(]'/api/v1/${ns}'`),
        `/api/v1/${ns} belongs to the Customer Portal`);
    }
    assert.match(app, /app\.use\('\/api\/v1\/hrms'/, 'HRMS is what this app serves');
  });

  test('the AD-4 fence survives here too — both repos write User.roles[]', async () => {
    const guard = await readFile(path.join(ROOT, 'utils/hrmsRoleGuard.js'), 'utf8');
    assert.match(guard, /assertRolesAssignable/);
    const user = await readFile(path.join(ROOT, 'models/User.js'), 'utf8');
    assert.match(user, /assertHrmsRolesAssignable/);
  });
});
