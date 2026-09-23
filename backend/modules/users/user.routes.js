import express from 'express';
import {
  getUsers, createUser, updateUser, updateUserRole, resetUserPassword, updateUserAccess,
} from './user.controller.js';
import { protect } from '../../middlewares/auth.js';
import { authorize, authorizeModule, PERMISSIONS } from '../../middlewares/rbac.js';
import { passwordLimiter } from '../../middlewares/rateLimiters.js';
import { auditLogger } from '../../middlewares/auditLogger.js';

const router = express.Router();

router.use(protect);

/**
 * Two permissions reach this router:
 *
 *   MANAGE_USERS          (Admin) — every account, any role.
 *   MANAGE_CUSTOMER_USERS (Sales) — CUSTOMER accounts only.
 *
 * The route guard can only answer "may this actor use user management at all".
 * WHICH accounts they may see and change depends on the target's role, which
 * the route does not know, so every handler re-checks it — see
 * denyIfOutOfScope() in the controller. Guarding here alone would let a
 * salesperson POST /users with role: 'Admin'.
 */
router.use(authorize(PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_CUSTOMER_USERS));

/*
 * ── AND THEN PER ACTION ───────────────────────────────────────────────────
 *
 * The `router.use` above answers "may this actor use user management at all",
 * and it used to be the ONLY question asked. `manage_users` was the key behind
 * every action on this sub-module, so an account granted nothing but View on
 * Internal User Management could POST a new administrator - the permission the
 * route demanded was the one the View tick compiled to.
 *
 * Each write now names its own cell. The two checks are complementary and both
 * are needed: the entry gate is what lets Sales in for customer accounts at
 * all, and these decide what anybody may do once inside.
 *
 * `denyIfOutOfScope` in the controller is the third and narrowest check - WHICH
 * accounts, decided per target. A route guard cannot express it, and none of
 * this replaces it.
 */
const canCreate = authorizeModule('administration', 'users', 'create');
const canEdit = authorizeModule('administration', 'users', 'edit');

router.get('/', getUsers);
router.post('/', canCreate, auditLogger('Create User'), createUser);
router.patch('/:id', canEdit, auditLogger('Update User'), updateUser);
// Changing a role is Admin-only; the handler refuses anyone else outright.
router.put('/:id/roles', canEdit, auditLogger('Update User Role'), updateUserRole);
// The rate limiter stays on the password route: it is the one path here that
// can be used to guess or grind, and the merge must not drop it.
router.put('/:id/password', canEdit, passwordLimiter, auditLogger('Reset User Password'), resetUserPassword);
// Extra per-account access. Admin-only, and the handler refuses anyone else
// outright - handing out permissions is not part of managing customers.
router.put('/:id/access', canEdit, auditLogger('Update User Access'), updateUserAccess);

export default router;
