/**
 * Every HRMS role, and who holds it.
 *
 * ---------------------------------------------------------------------------
 * ALL EIGHT SEEDED ROLES LIVE HERE TOO, NOT ONLY THE ONES BUILT BY HAND
 * ---------------------------------------------------------------------------
 * This collection used to hold only roles a Super Admin composed beyond the
 * eight AD-3 fixed in code. It now holds all of them: `hrms.bootstrap.js`
 * seeds `hrms_super_admin` through `hrms_auditor` here once, copying their
 * starting permissions from `shared/permissions/matrix.js`, and from then on
 * this collection — not the code matrix — is what an actor's permissions
 * resolve from. See `modules/hrms/rbac/customRole.service.js`'s file header
 * for why, and for the one guarantee that survives the change:
 * `hrms_super_admin` cannot be deleted, deactivated, or edited to drop
 * `settings:edit:org`, because there is no longer a code-level fallback if it
 * were.
 *
 * There is still no `isSystem` FLAG. "Protected" (the one role above) is
 * computed from the key, at the point a response is built, never stored — a
 * flag that must never be flipped is a rule enforced by remembering to check
 * it, and a key comparison cannot be forgotten to be checked the way a stored
 * boolean can be forgotten to be read.
 *
 * AD-1: single tenant, so no `organizationId` (the reference keys its roles on
 * `[organizationId, key]`; here the key is the whole key).
 */

import mongoose from 'mongoose';

import {
  HRMS_MODULE_LIST,
  HRMS_ACTION_LIST,
  SCOPE_LIST,
} from '../../shared/permissions/constants.js';

const { Schema } = mongoose;

/**
 * One grant.
 *
 * The three enums are the SECOND line of validation, after the Zod schema on
 * the DTO (shared/schemas/role.js). Both exist deliberately: the DTO gives a
 * caller a 400 naming the bad value, and the enum means a triple that reached
 * the model another way - a script, a seed, a future endpoint - still cannot be
 * stored. An invented module string persists silently and grants nothing
 * forever, which is the failure this pair prevents.
 *
 * `_id: false` because a grant has no identity of its own: role permissions are
 * replaced wholesale on every save, so a per-row id would be a new value on
 * every write and would make an audit diff unreadable.
 */
const permissionSchema = new Schema(
  {
    module: { type: String, required: true, enum: HRMS_MODULE_LIST },
    action: { type: String, required: true, enum: HRMS_ACTION_LIST },
    scope: { type: String, required: true, enum: SCOPE_LIST },
  },
  { _id: false },
);

const hrmsRoleSchema = new Schema(
  {
    /**
     * Immutable after creation, and `hrms_`-prefixed by the DTO.
     *
     * The prefix is not cosmetic: `isHrmsRoleKey` is what AD-4 tests to decide
     * whether a key may contribute HRMS grants at all, and what keeps a custom
     * key from ever colliding with a portal role name in the shared `users`
     * collection.
     */
    key: { type: String, required: true, unique: true, trim: true, maxlength: 64 },

    label: { type: String, required: true, trim: true, maxlength: 120 },

    description: { type: String, trim: true, maxlength: 500, default: '' },

    permissions: { type: [permissionSchema], default: () => [] },

    /**
     * Deactivated roles grant nothing, without being deleted.
     *
     * The difference from deleting matters: a role still held by twenty people
     * cannot be deleted at all (the assignments are the reason), but an
     * administrator who needs its access withdrawn TODAY - a contractor tier
     * being wound down, a role created in error - should not have to reassign
     * twenty accounts first. Deactivating drops the grants immediately and
     * keeps both the definition and the assignments, so reactivating restores
     * exactly what was there.
     *
     * `resolveGrantsForRoleKeys` filters on this, which is what makes it real
     * rather than a label: an inactive role contributes no permission to any
     * actor. `hrms_super_admin` refuses this specific edit - see
     * `assertProtectedRoleIntact` in customRole.service.js.
     */
    active: { type: Boolean, default: true },

    createdById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'hrms_roles' },
);

/**
 * The shape every read surface returns.
 *
 * `isSystem` stays in the payload, always `false` now, rather than being
 * removed: it is API surface some caller could depend on, and every role
 * really is a database row now, so `false` is simply the honest value.
 * `protected` is the signal that matters - true for exactly one role,
 * `hrms_super_admin` - and `RolesTab.jsx` reads it to disable Delete and
 * Deactivate for that row while leaving Edit reachable everywhere.
 */
hrmsRoleSchema.methods.publicShape = function publicShape(userCount = 0, { protected: isProtected = false } = {}) {
  return {
    id: String(this._id),
    key: this.key,
    label: this.label,
    description: this.description ?? '',
    isSystem: false,
    protected: isProtected,
    active: this.active !== false,
    permissions: (this.permissions ?? []).map((p) => ({
      module: p.module,
      action: p.action,
      scope: p.scope,
    })),
    userCount,
    updatedAt: this.updatedAt,
  };
};

/**
 * Who holds which role BEYOND the eight seeded ones.
 *
 * The eight seeded keys are still assigned through `User.roles[]`, same as
 * every other portal role - `assignEmployeeRoles` has always branched that
 * way, and nothing about editing their PERMISSIONS changes how they are
 * ASSIGNED. A collection of its own exists for anything genuinely new,
 * because `User.roles[]` is validated against a fixed allow-list by a
 * pre-validate hook in models/User.js - one of the sixteen files this
 * repository holds byte-identical with the Customer Portal
 * (SHARED-CONTRACT.md §2). A key that allow-list does not know would fail
 * validation in both portals.
 *
 * That constraint turned out to be the right shape anyway: it is the
 * reference's own `UserRole` join table, and it keeps a custom grant clearly
 * separable from the eight built-in roles when reading an account.
 */
const hrmsUserRoleSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'HrmsRole', required: true },
  },
  { timestamps: true, collection: 'hrms_user_roles' },
);

/** The actor lookup runs on every HRMS request; `userId` must be indexed. */
hrmsUserRoleSchema.index({ userId: 1 });
hrmsUserRoleSchema.index({ roleId: 1 });
hrmsUserRoleSchema.index({ userId: 1, roleId: 1 }, { unique: true });

export const HrmsRole =
  mongoose.models.HrmsRole || mongoose.model('HrmsRole', hrmsRoleSchema);

export const HrmsUserRole =
  mongoose.models.HrmsUserRole || mongoose.model('HrmsUserRole', hrmsUserRoleSchema);

export default { HrmsRole, HrmsUserRole };
