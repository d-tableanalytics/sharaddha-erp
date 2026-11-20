/**
 * HRMS foundation endpoints.
 */

import { modulesForHrmsRoles } from '../../shared/permissions/matrix.js';
import { HRMS_ROLE_LABELS, isSuperAdminOnlyModule } from '../../shared/permissions/constants.js';
import { describe as describeReferences } from './references/reference.service.js';
import { registeredRetentionCategories } from './retention/retention.registry.js';
import { registeredFileCategories } from './storage/storage.service.js';
import { IMPLEMENTED_HRMS_MODULES } from './hrms.modules.js';

/**
 * The modules an actor may reach, with the Super-Admin-only ones removed for
 * anyone who is not a portal Super Admin.
 *
 * `modulesForHrmsRoles` answers from the role keys and so knows nothing about
 * the salary fence. Without this, an HR account (which holds
 * `hrms_super_admin` through the portal bridge) would be told it reaches
 * `employees:compensation` while every grant for it had already been stripped
 * from `actor.permissions` — the payload would contradict itself.
 */
const reachableModules = (actor) => {
  const permitted = modulesForHrmsRoles(actor.roleKeys);
  return actor.portalSuperAdmin ? permitted : permitted.filter((m) => !isSuperAdminOnlyModule(m));
};

/**
 * GET /api/v1/hrms/me
 *
 * The payload the entire frontend HRMS authorization layer is built on: role
 * keys, the flattened grant list, and the modules those grants reach.
 *
 * The permission list is sent in full so the client can evaluate the SAME
 * `hasHrmsPermission` the server uses, rather than reimplementing the rules.
 * It describes what this account may do; it is not a credential, and the server
 * re-checks every request regardless.
 */
export const getHrmsMe = async (req, res, next) => {
  try {
    const actor = req.hrmsActor;

    res.status(200).json({
      success: true,
      data: {
        userId: actor.userId,
        employeeId: actor.employeeId,
        departmentId: actor.departmentId,
        managerChain: actor.managerChain,
        roleKeys: actor.roleKeys,
        roleLabels: actor.roleKeys.map((k) => HRMS_ROLE_LABELS[k] ?? k),
        permissions: actor.permissions,
        modules: reachableModules(actor),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/hrms/status
 *
 * What the HRMS foundation currently has wired up.
 *
 * Exists so the shell and the dashboard can be HONEST. The permission matrix
 * declares 31 modules; two are built. Without this the dashboard would either
 * invent numbers or show a permission error for a module that simply does not
 * exist yet - and those read very differently to a user.
 */
export const getHrmsStatus = async (req, res, next) => {
  try {
    const actor = req.hrmsActor;
    const permitted = reachableModules(actor);

    res.status(200).json({
      success: true,
      data: {
        implementedModules: IMPLEMENTED_HRMS_MODULES,
        // Modules this actor may reach AND that exist. The nav renders these.
        availableModules: IMPLEMENTED_HRMS_MODULES.filter((m) => permitted.includes(m)),
        foundation: {
          references: describeReferences(),
          retentionHandlers: registeredRetentionCategories(),
          fileCategories: registeredFileCategories(),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export default { getHrmsMe, getHrmsStatus };
