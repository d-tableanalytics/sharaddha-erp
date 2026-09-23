import express from 'express';
import {
  getRoles,
  getRegistry,
  getHrmsRoles,
  createRole,
  updateRole,
  updateRolePermissions,
  deleteRole,
  getMyAccess,
} from './role.controller.js';
import { protect } from '../../middlewares/auth.js';
import { authorize, authorizeModule, PERMISSIONS } from '../../middlewares/rbac.js';
import { auditLogger } from '../../middlewares/auditLogger.js';
import { requirePortalModule } from '../../middlewares/portalGuard.js';

const router = express.Router();

router.use(protect);

/**
 * "What may I do?" is not an administrative question.
 *
 * Declared BEFORE the manage_roles gate below, because every signed-in account
 * needs its own permission list to render its own sidebar - including the
 * customers, who by definition hold no administrative permission at all.
 * Putting it after the gate would mean the only people who could find out what
 * they are allowed to do are the people allowed to do everything.
 */
router.get('/my-access', getMyAccess);

/*
 * Everything past this point administers OTHER people's access.
 *
 * TWO GATES, and they answer different questions:
 *
 *   requirePortalModule  is this DOMAIN allowed to offer the role matrix at
 *                        all? The matrix grants access across both portals'
 *                        modules, and both repositories write the same `roles`
 *                        collection — so two editors mean one can strip cells
 *                        the other wrote (see SHARED-CONTRACT.md). The single
 *                        editor lives in the employee domain; here these routes
 *                        404 as though they were never written.
 *
 *   authorize            does this USER hold manage_roles? Unchanged.
 *
 * The portal gate is FIRST and is not a permission check, deliberately: a Super
 * Admin holds the wildcard and satisfies every permission ever written, so a
 * domain fence built out of permissions would fail on exactly the accounts it
 * most needs to contain.
 *
 * `/my-access` above stays open to every signed-in account in both domains — it
 * reports what the caller may do, which is how any sidebar gets drawn.
 */
router.use(requirePortalModule('administration', 'roles'));
router.use(authorize(PERMISSIONS.MANAGE_ROLES));

/*
 * `manage_roles` opened the screen AND authorised every write on it, because
 * all four actions on this sub-module resolved to that one key. Reading the
 * permission matrix and rewriting it are not the same authority - the matrix is
 * where every other permission in the product is decided - so each write now
 * names its own cell.
 */
const canCreate = authorizeModule('administration', 'roles', 'create');
const canEdit = authorizeModule('administration', 'roles', 'edit');
const canDelete = authorizeModule('administration', 'roles', 'delete');

router.get('/', getRoles);

// Static path, declared before any ':id' route would shadow it.
router.get('/registry', getRegistry);

/**
 * The eight HRMS roles, read-only — see the handler for why this calls the
 * same function the HRMS settings screen uses rather than a second
 * implementation. Static path, same reason as '/registry' above.
 */
router.get('/hrms', getHrmsRoles);

router.post('/', canCreate, auditLogger('Create Role'), createRole);
router.patch('/:id', canEdit, auditLogger('Update Role'), updateRole);
router.delete('/:id', canDelete, auditLogger('Delete Role'), deleteRole);

// Legacy flat-permission endpoint. Still served - see the note on the handler.
router.put('/:id/permissions', canEdit, auditLogger('Update Role Permissions'), updateRolePermissions);

export default router;
