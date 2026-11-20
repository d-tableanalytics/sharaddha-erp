/**
 * Resolve an account's REAL, current permissions from the database.
 *
 * ---------------------------------------------------------------------------
 * REPLACES THE CODE MATRIX'S ANSWER, RATHER THAN EXTENDING IT
 * ---------------------------------------------------------------------------
 * This file used to UNION a handful of extra, hand-built grants onto whatever
 * `buildHrmsActor` computed from the eight code-fixed roles. Now that all
 * eight are editable database rows (`customRole.service.js`'s file header
 * explains why), the code matrix's answer is only ever the value they were
 * SEEDED with - an administrator's edit since then lives in the database and
 * nowhere else. So this middleware does not add to `actor.permissions`
 * anymore; it re-resolves the actor's full role-key list from the database
 * and REPLACES it, every request.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS SITS, AND WHY THAT ORDER STILL MATTERS
 * ---------------------------------------------------------------------------
 *   protect              authenticated
 *   attachHrmsActor      actor.roleKeys from the CODE matrix + portal bridge
 *   requireHrmsAccess    AD-4 choke point: refuses anyone holding no HRMS grant
 *   attachCustomHrmsGrants   <- here
 *   requirePermission(...)   per-route, reads the resolved actor
 *
 * Running AFTER the AD-4 gate is still deliberate, even though permissions
 * are now database-backed. `requireHrmsAccess` decides "does this account
 * hold ANY hrms_* role key" purely from `actor.roleKeys`, which is unaffected
 * by this file - editing a role's PERMISSIONS down to nothing does not erase
 * the fact that the account holds that role key, so a Customer is still
 * refused structurally, before a single query here runs. What CAN now happen,
 * by design, is an account passing that door check and then finding every
 * specific `requirePermission` refuses it, because the role it holds has been
 * edited to grant nothing - which is the correct, safe shape for "this role's
 * permissions were edited to zero" to take.
 *
 * ---------------------------------------------------------------------------
 * COST OF THIS DESIGN
 * ---------------------------------------------------------------------------
 * Every authenticated HRMS request now costs one query here - there is no
 * "nothing to add, skip it" fast path left, because even an account holding
 * only code-seeded roles needs their CURRENT (possibly edited) permissions
 * read fresh. `resolveGrantsForRoleKeys` is one `$in` query regardless of how
 * many role keys the actor holds.
 */

import { customRoleKeysForUser, resolveGrantsForRoleKeys } from './customRole.service.js';
import { fenceSuperAdminOnly } from '../../../shared/permissions/constants.js';

export async function attachCustomHrmsGrants(req, res, next) {
  try {
    const actor = req.hrmsActor;
    if (!actor?.userId) return next();

    // The eight-and-beyond keys held via User.roles[] (from the matrix/portal
    // bridge), unioned with anything held via the HrmsUserRole join table -
    // together, everything this account holds, regardless of which of the
    // two storage mechanisms a given key uses. See customRole.service.js's
    // file header for why there still are two.
    const customKeys = await customRoleKeysForUser(actor.userId);
    const allKeys = [...new Set([...actor.roleKeys, ...customKeys])];

    const resolved = await resolveGrantsForRoleKeys(allKeys);

    req.hrmsActor = {
      ...actor,
      roleKeys: allKeys,
      /**
       * The salary fence is re-applied here, and that is not belt-and-braces.
       *
       * This line REPLACES what `buildHrmsActor` computed, with rows an
       * administrator can edit in Settings -> Roles & Permissions. Ticking
       * `employees:compensation` for any role would otherwise hand that role
       * every CTC, payslip and F&F amount in the company, silently undoing the
       * fence one checkbox at a time. See SUPER_ADMIN_ONLY_MODULES.
       */
      permissions: fenceSuperAdminOnly(resolved.permissions, actor.portalSuperAdmin),
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

export default attachCustomHrmsGrants;
