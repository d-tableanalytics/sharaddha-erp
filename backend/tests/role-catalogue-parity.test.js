/**
 * The role catalogue, as the server knows it and as the browser bundle does.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 *
 * The Employee Portal defines twelve roles. The frontend keeps its own copy of
 * that catalogue in `FALLBACK_ROLE_PERMISSIONS` — necessarily, because it must
 * render a menu before any API call returns — and `assignableRolesFor` used to
 * keep a THIRD copy, hand-typed, listing eight.
 *
 * The result shipped: HR, Billing, Accounts and Billing Head were accepted by
 * the server, granted real permissions across FMS, and absent from every role
 * dropdown in user management. Nobody could be made a Billing or an Accounts
 * user through the UI at all.
 *
 * The third copy is gone — `assignableRolesFor` now derives from the second.
 * This file guards the remaining seam, which is the one that cannot be removed:
 * a role added to the SERVER's catalogue and not to the bundle's is invisible
 * in exactly the same way, and nothing else in either test suite would notice.
 *
 * ---------------------------------------------------------------------------
 * WHY A BACKEND TEST READS A FRONTEND FILE
 * ---------------------------------------------------------------------------
 *
 * It has to live on one side or the other, and this side is where the
 * authoritative list is. `frontend/src/utils/permissions.js` imports nothing —
 * deliberately, so it can be reasoned about on its own — which makes it
 * importable here without pulling a bundler or a DOM in.
 *
 * Only the NAMES are compared, not the permission arrays behind them. The
 * frontend copy is explicitly a fallback used until the server answers, and it
 * is allowed to be coarser; what it may not be is missing a role.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { assignableRoleNames } from '../utils/roleResolver.js';
import {
  SYSTEM_ROLE_NAMES,
  assignableRolesFor,
} from '../../frontend/src/utils/permissions.js';

/** An actor who may assign anything, so the offer is at its widest. */
const SUPER_ADMIN = { role: 'Super Admin', permissions: ['*'] };

describe('role catalogue parity', () => {
  test('the bundle knows every role the server will accept', () => {
    const server = assignableRoleNames();
    const bundle = SYSTEM_ROLE_NAMES;

    const missing = server.filter((r) => !bundle.includes(r));
    assert.deepEqual(
      missing, [],
      'these roles exist on the server but not in frontend/src/utils/permissions.js, '
        + 'so no dropdown built from the bundle can offer them',
    );
  });

  test('the bundle invents no role the server would refuse', () => {
    const server = assignableRoleNames();
    const invented = SYSTEM_ROLE_NAMES.filter((r) => !server.includes(r));

    // The same fault pointing the other way: the option appears, is chosen,
    // and the save 400s on a role the server has never heard of.
    assert.deepEqual(invented, [], 'these roles are in the bundle but not on the server');
  });

  test('every server role is actually offered in the user-management dropdown', () => {
    /*
     * The end-to-end statement, and the one that would have caught the shipped
     * bug on its own. The two tests above compare catalogues; this one compares
     * the SERVER's catalogue against what the screen finally renders, so a
     * future filter quietly dropping a role fails here even if both catalogues
     * still agree.
     */
    const offered = assignableRolesFor(SUPER_ADMIN);
    const missing = assignableRoleNames().filter((r) => !offered.includes(r));

    assert.deepEqual(
      missing, [],
      'the server accepts these roles but user management does not offer them',
    );
  });

  test('the FMS roles specifically are assignable', () => {
    const offered = assignableRolesFor(SUPER_ADMIN);

    // Named explicitly because these are the ones FMS depends on: §24 gives
    // Billing eight stages, Accounts the payment stage, and Billing Head the
    // Proceed Anyway authorisation. A portal that cannot create those accounts
    // cannot run the workflow at all.
    for (const role of ['Billing', 'Accounts', 'Billing Head']) {
      assert.ok(offered.includes(role), `${role} must be assignable — FMS stages are owned by it`);
    }
  });
});
