/**
 * HRMS roles — all of them, database-backed and editable.
 *
 * ---------------------------------------------------------------------------
 * AD-3 REVERSED, DELIBERATELY, ON EXPLICIT REQUEST
 * ---------------------------------------------------------------------------
 * This codebase spent a long time treating the eight `hrms_*` roles as fixed
 * in code (`shared/permissions/matrix.js`), never editable, identical in
 * every environment. That design traded flexibility for a specific safety
 * property: nobody could tick a checkbox and accidentally strip their own
 * access to the screen that grants access.
 *
 * The product decision, made with that trade-off explained, is that every
 * role - the eight seeded ones included - should be an ordinary editable row
 * here, the same way a hand-built custom role always was. So as of this file,
 * `hrms_super_admin` through `hrms_auditor` are `HrmsRole` documents like any
 * other, seeded once (`hrms.bootstrap.js`, from the code matrix's PRE-EDIT
 * values so nobody's access changes the moment this ships) and from then on
 * read and written exactly the way a role built from scratch always was.
 *
 * `shared/permissions/matrix.js` still exists and is still what the seed
 * copies from - but after the seed has run once, nothing reads it again. The
 * database is the only source of truth an actor's permissions are resolved
 * from; see `resolveGrantsForRoleKeys` below and `customRole.middleware.js`,
 * which replaces (not merely extends) what `buildHrmsActor` computed.
 *
 * ---------------------------------------------------------------------------
 * THE ONE GUARANTEE THAT SURVIVES: `hrms_super_admin` CANNOT BE LOCKED
 * ---------------------------------------------------------------------------
 * Editing every role is exactly the footgun the fixed design existed to
 * avoid: strip `settings:edit:org` from `hrms_super_admin`'s own permission
 * set, or deactivate it, and every holder loses the ability to open this
 * screen at all - with no code-level fallback to get back in, because the
 * fallback USED to be that this role could not be edited.
 *
 * `assertProtectedRoleIntact` is the replacement guarantee, narrowly scoped
 * to exactly that failure: `hrms_super_admin` can never be deleted, never be
 * deactivated, and can never have `settings:edit:org` removed from its
 * permission set. Every other grant on it, and every other role including the
 * other seven built-in ones, is unrestricted.
 *
 * ---------------------------------------------------------------------------
 * DEFENCE IN DEPTH
 * ---------------------------------------------------------------------------
 * Every mutating function re-checks `settings:edit:org` even though the route
 * guard already did. The service is reachable from scripts, seeds and other
 * modules where no guard ran, and the reference makes the same choice for the
 * same reason.
 */

import { HrmsRole, HrmsUserRole } from '../../../models/hrms/RoleModels.js';
import User from '../../../models/User.js';
import { hasHrmsPermission } from '../../../shared/permissions/has-permission.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
  HRMS_ROLES as R,
  HRMS_ROLE_LIST,
} from '../../../shared/permissions/constants.js';
import { recordAudit } from '../../../utils/auditLog.js';
import { AUDIT_ACTIONS } from '../../../shared/constants/hrms.js';
import {
  HrmsForbiddenError,
  HrmsNotFoundError,
  HrmsConflictError,
  HrmsValidationError,
} from '../hrms.errors.js';

const actorUser = (actor) => ({ _id: actor?.userId ?? null });

/**
 * The one role the product decided must always be able to fix Roles &
 * Permissions. See the file header.
 */
const PROTECTED_ROLE_KEY = R.SUPER_ADMIN;

const assertCanView = (actor) => {
  if (!hasHrmsPermission(actor, M.SETTINGS, A.VIEW, S.ORG)) {
    throw new HrmsForbiddenError('Cannot view roles.');
  }
};

const assertCanEdit = (actor) => {
  if (!hasHrmsPermission(actor, M.SETTINGS, A.EDIT, S.ORG)) {
    throw new HrmsForbiddenError('Cannot change roles.');
  }
};

/**
 * Refuse the three edits that would strip `hrms_super_admin`'s guarantee.
 *
 * Checked against the SUBMITTED dto, not the resulting document, so the
 * refusal happens before anything is written - the same "validate before the
 * first write" discipline `resolveCustomRoleKeys` uses.
 */
function assertProtectedRoleIntact(role, dto) {
  if (role.key !== PROTECTED_ROLE_KEY) return;

  if (dto.active === false) {
    throw new HrmsForbiddenError(
      `"${role.label}" cannot be deactivated. It is the one role guaranteed to always reach Roles & Permissions — deactivating it could lock every holder out with no way back in. Remove it from anyone who should not hold it instead.`,
    );
  }

  if (dto.permissions !== undefined) {
    const keepsAccess = dto.permissions.some(
      (p) => p.module === M.SETTINGS && p.action === A.EDIT && p.scope === S.ORG,
    );
    if (!keepsAccess) {
      throw new HrmsForbiddenError(
        `"${role.label}" must always include settings:edit:org. Removing it would mean nobody holding this role could open Roles & Permissions to undo the change.`,
      );
    }
  }
}

/**
 * How many accounts hold each role, by KEY rather than by database id.
 *
 * A role's assignments live in one of two places depending on how old the key
 * is, and a caller should not have to know which: the eight seeded keys are
 * written into `User.roles[]` (validated there against a fixed allow-list,
 * one of the sixteen files this repository holds byte-identical with the
 * Customer Portal), because that is where every OTHER portal role already
 * lives and `assignEmployeeRoles` has always split on it. Anything genuinely
 * new goes into `HrmsUserRole`. Summing both is safe because a single key is
 * never written to both - `assignEmployeeRoles` still branches on
 * `HRMS_ROLE_LIST.includes(key)` to decide which.
 */
async function userCountsByRoleKey(roles) {
  const keys = roles.map((r) => r.key);
  if (keys.length === 0) return new Map();

  const [customCounts, directCounts] = await Promise.all([
    HrmsUserRole.aggregate([{ $group: { _id: '$roleId', n: { $sum: 1 } } }]),
    User.aggregate([
      { $match: { roles: { $in: keys } } },
      { $unwind: '$roles' },
      { $match: { roles: { $in: keys } } },
      { $group: { _id: '$roles', n: { $sum: 1 } } },
    ]),
  ]);

  const byKey = new Map(directCounts.map((c) => [c._id, c.n]));
  const idToKey = new Map(roles.map((r) => [String(r._id), r.key]));
  for (const c of customCounts) {
    const key = idToKey.get(String(c._id));
    if (!key) continue; // a stale HrmsUserRole row pointing at a deleted role
    byKey.set(key, (byKey.get(key) ?? 0) + c.n);
  }
  return byKey;
}

/** Accounts holding this ONE role, across both storage mechanisms. */
async function countHolders(role) {
  const [custom, direct] = await Promise.all([
    HrmsUserRole.countDocuments({ roleId: role._id }),
    User.countDocuments({ roles: role.key }),
  ]);
  return custom + direct;
}

/**
 * Every role - the eight seeded ones and anything built since - with how many
 * accounts hold each.
 *
 * Ordered by creation so the list does not reshuffle under an administrator
 * between one save and the next, which puts the seeded eight first (they were
 * created once, at bootstrap, before anything else could exist).
 *
 * NO permission check: this is the plain read, and the two callers are gated
 * differently. The HRMS settings surface goes through `listCustomRoles` below,
 * which re-checks; the portal's Administration screen reaches the same data
 * through its own `manage_roles` gate and holds no HRMS grant at all.
 */
export async function readCustomRoles() {
  const roles = await HrmsRole.find().sort({ createdAt: 1 });
  const counts = await userCountsByRoleKey(roles);
  return roles.map((role) =>
    role.publicShape(counts.get(role.key) ?? 0, { protected: role.key === PROTECTED_ROLE_KEY }),
  );
}

/** `readCustomRoles`, for a caller that must hold `settings:view:org`. */
export async function listCustomRoles(actor) {
  assertCanView(actor);
  return readCustomRoles();
}

export async function createCustomRole(dto, actor, req = null) {
  assertCanEdit(actor);

  /*
   * Checked before the insert rather than left to the unique index.
   *
   * A duplicate key is the ordinary, expected outcome of someone reusing a
   * name - including, now, one of the eight seeded keys, which this catches
   * with the same friendly message rather than a raw driver error.
   */
  const clash = await HrmsRole.findOne({ key: dto.key }).select('_id').lean();
  if (clash) throw new HrmsConflictError(`Role key "${dto.key}" is already in use.`);

  const role = await HrmsRole.create({
    key: dto.key,
    label: dto.label,
    description: dto.description ?? '',
    permissions: dto.permissions,
    createdById: actor?.userId ?? null,
    updatedById: actor?.userId ?? null,
  });

  await recordAudit(
    actorUser(actor),
    AUDIT_ACTIONS.SETTINGS_ROLE_CREATED,
    `Created HRMS role "${role.label}" (${role.key}) with ${role.permissions.length} permission(s).`,
    req,
    { meta: { key: role.key, permissionCount: role.permissions.length } },
  );

  return role.publicShape(0, { protected: false });
}

export async function updateCustomRole(id, dto, actor, req = null) {
  assertCanEdit(actor);

  const role = await HrmsRole.findById(id);
  if (!role) throw new HrmsNotFoundError('Role');

  assertProtectedRoleIntact(role, dto);

  const changed = [];
  if (dto.label !== undefined && dto.label !== role.label) {
    role.label = dto.label;
    changed.push('label');
  }
  if (dto.description !== undefined && dto.description !== role.description) {
    role.description = dto.description;
    changed.push('description');
  }
  if (dto.permissions !== undefined) {
    // Wholesale replacement - see the note on updateRoleSchema.
    role.permissions = dto.permissions;
    changed.push('permissions');
  }
  if (dto.active !== undefined && dto.active !== (role.active !== false)) {
    role.active = dto.active;
    // Named distinctly in the trail: "deactivated" is the entry somebody will
    // search for when access disappears, and it reads nothing like a
    // permission edit even though it takes the same route.
    changed.push(dto.active ? 'reactivated' : 'deactivated');
  }

  const isProtected = role.key === PROTECTED_ROLE_KEY;

  if (changed.length === 0) {
    const counts = await userCountsByRoleKey([role]);
    return role.publicShape(counts.get(role.key) ?? 0, { protected: isProtected });
  }

  role.updatedById = actor?.userId ?? null;
  await role.save();

  await recordAudit(
    actorUser(actor),
    AUDIT_ACTIONS.SETTINGS_ROLE_UPDATED,
    `Updated HRMS role "${role.label}" (${role.key}): ${changed.join(', ')}.`,
    req,
    {
      meta: {
        key: role.key,
        fields: changed,
        permissionCount: role.permissions.length,
      },
    },
  );

  const counts = await userCountsByRoleKey([role]);
  return role.publicShape(counts.get(role.key) ?? 0, { protected: isProtected });
}

export async function deleteCustomRole(id, actor, req = null) {
  assertCanEdit(actor);

  const role = await HrmsRole.findById(id);
  if (!role) throw new HrmsNotFoundError('Role');

  if (role.key === PROTECTED_ROLE_KEY) {
    throw new HrmsForbiddenError(
      `"${role.label}" cannot be deleted. It is the one role guaranteed to always reach Roles & Permissions.`,
    );
  }

  /*
   * None of the eight seeded keys can be deleted, even unused ones like
   * `hrms_it_admin` at zero holders today.
   *
   * The employee role-assignment screen validates a role key against
   * `HRMS_ROLE_LIST` - a fixed list in a file this repository holds
   * byte-identical with the Customer Portal, which this service cannot
   * change. Deleting the DEFINITION would not remove the key from that
   * picker: someone could still be assigned `hrms_it_admin` tomorrow, and
   * `resolveGrantsForRoleKeys` would silently find no document for it and
   * hand them zero permissions - a role that is assignable and does nothing,
   * with no error anywhere to explain why. Deactivating withdraws the same
   * access reversibly, with no such trap, which is what this points to.
   */
  if (HRMS_ROLE_LIST.includes(role.key)) {
    throw new HrmsForbiddenError(
      `"${role.label}" is one of the eight seeded roles and cannot be deleted — it would still be assignable with no definition behind it. Deactivate it instead to withdraw its permissions.`,
    );
  }

  /*
   * Refused while anybody still holds it, even though the assignments would
   * cascade cleanly.
   *
   * Deleting the role out from under live accounts silently narrows what those
   * people can do, and the first anyone hears of it is a 403 on a screen that
   * worked yesterday. The count is in the message so the administrator knows
   * how much reassigning is in front of them.
   */
  const inUse = await countHolders(role);
  if (inUse > 0) {
    throw new HrmsConflictError(
      `Cannot delete "${role.label}" — ${inUse} account(s) still hold it. Reassign them first.`,
    );
  }

  await HrmsRole.deleteOne({ _id: role._id });

  await recordAudit(
    actorUser(actor),
    AUDIT_ACTIONS.SETTINGS_ROLE_DELETED,
    `Deleted HRMS role "${role.label}" (${role.key}).`,
    req,
    { meta: { key: role.key } },
  );

  return { id: String(role._id), key: role.key };
}

// ---------------------------------------------------------------------------
// Resolution - the read path the actor and the assignment surface use
// ---------------------------------------------------------------------------

/**
 * Every permission the given role KEYS grant, resolved from the database.
 *
 * This is now the ONLY place an HRMS actor's permissions are computed from -
 * see `customRole.middleware.js`, which calls this with the actor's full role
 * key list (the seeded eight and anything built since, held either through
 * `User.roles[]` or `HrmsUserRole`) and REPLACES what the code matrix
 * produced, rather than adding to it.
 *
 * `active: { $ne: false }` is what makes deactivation mean something: a
 * deactivated role's document still exists (so reactivating restores it
 * exactly), but contributes nothing here. `$ne: false` rather than `true` so
 * a document written before the field existed still counts as active.
 *
 * A key with NO matching document — the seed has not run yet, or a document
 * was deleted out from under a still-held key — contributes nothing rather
 * than throwing. Failing closed on a missing definition is the safe
 * direction, the same reason an unconfigured statutory state blocks payroll
 * rather than deducting zero.
 */
export async function resolveGrantsForRoleKeys(roleKeys = []) {
  const wanted = [...new Set(roleKeys)];
  if (wanted.length === 0) return { roleKeys: [], permissions: [] };

  const roles = await HrmsRole.find({ key: { $in: wanted }, active: { $ne: false } })
    .select('key permissions')
    .lean();

  // De-duplicated across roles: holding two roles that both grant
  // leave:view:team is one grant, not two.
  const seen = new Map();
  for (const role of roles) {
    for (const p of role.permissions ?? []) {
      seen.set(`${p.module}|${p.action}|${p.scope}`, {
        module: p.module,
        action: p.action,
        scope: p.scope,
      });
    }
  }

  return { roleKeys: roles.map((r) => r.key), permissions: [...seen.values()] };
}

/**
 * The role keys an account holds through the CUSTOM join collection only -
 * i.e. excluding the eight seeded keys, which are read from `User.roles[]`
 * and already shown by `getEmployeeRoles`. Used by the employee role-
 * assignment screen to report the "built beyond the eight" half separately.
 */
export async function customRoleKeysForUser(userId) {
  if (!userId) return [];
  const links = await HrmsUserRole.find({ userId }).select('roleId').lean();
  if (links.length === 0) return [];
  const roles = await HrmsRole.find({ _id: { $in: links.map((l) => l.roleId) } })
    .select('key')
    .lean();
  return roles.map((r) => r.key);
}

/**
 * Resolve role keys to their documents, refusing any that do not exist.
 *
 * One query for the whole set, and it throws before anything is written.
 * Callers that also touch `User.roles[]` depend on that ordering: validating
 * after the first write is how half an assignment lands.
 *
 * Unknown keys are refused rather than skipped - a silently dropped key is a
 * person who does not get the access somebody believes they granted.
 */
export async function resolveCustomRoleKeys(keys = []) {
  const wanted = [...new Set(keys)];
  if (wanted.length === 0) return [];

  const roles = await HrmsRole.find({ key: { $in: wanted } }).select('_id key').lean();

  if (roles.length !== wanted.length) {
    const found = new Set(roles.map((r) => r.key));
    const unknown = wanted.filter((k) => !found.has(k));
    throw new HrmsValidationError(`Unknown custom role key(s): ${unknown.join(', ')}`);
  }

  return roles;
}

/**
 * Replace an account's CUSTOM role assignments with exactly `keys`.
 *
 * Only ever called with keys OUTSIDE the seeded eight - `assignEmployeeRoles`
 * splits on `HRMS_ROLE_LIST.includes(key)` and routes the eight into
 * `User.roles[]` instead, so this collection never holds one of them.
 * Replacement rather than add/remove deltas, for the same reason the
 * built-in half of the assignment endpoint replaces: the screen sends the
 * full set it is showing.
 */
export async function setCustomRolesForUser(userId, keys = []) {
  const roles = await resolveCustomRoleKeys(keys);

  await HrmsUserRole.deleteMany({ userId });
  if (roles.length) {
    await HrmsUserRole.insertMany(roles.map((r) => ({ userId, roleId: r._id })));
  }

  return roles.map((r) => r.key);
}

export { PROTECTED_ROLE_KEY };

export default {
  readCustomRoles,
  listCustomRoles,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  resolveGrantsForRoleKeys,
  customRoleKeysForUser,
  resolveCustomRoleKeys,
  setCustomRolesForUser,
  PROTECTED_ROLE_KEY,
};
