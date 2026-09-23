/**
 * Custom HRMS role DTOs (AD-6).
 *
 * The reference validates NOTHING on `POST /roles` and `PATCH /roles/:id`: its
 * `UpsertRoleDto` types module, action and scope as bare `string`, so a typo
 * (`'empolyees'`) or an invented scope persists into its permission table and
 * silently grants nothing forever. Nobody finds out until someone asks why a
 * role that visibly has the tick cannot do the thing.
 *
 * So every value space here is an explicit allow-list drawn from the same
 * constants the evaluator uses, and every schema is `.strict()`. A bad triple
 * is a 400 naming the offending value, not a row.
 */

import { z } from 'zod';

import {
  HRMS_MODULE_LIST,
  HRMS_ACTION_LIST,
  SCOPE_LIST,
  HRMS_ROLE_LIST,
} from '../permissions/constants.js';
import { objectId } from '../validation/common.js';

/**
 * `:id` on the role routes.
 *
 * Validated at the boundary so a malformed id is a 400 naming the parameter
 * rather than a Mongoose CastError surfacing as a 500 from the app-wide
 * handler. The reference does the same job with a `ParseUUIDPipe`.
 */
export const objectIdParamSchema = z.object({ id: objectId }).strict();

/**
 * A custom role key.
 *
 * `hrms_`-prefixed for the reason given in models/hrms/RoleModels.js: that
 * prefix is what `isHrmsRoleKey` tests, and it is what keeps a custom key from
 * ever colliding with a portal role name in the shared `users` collection.
 *
 * Lower-case and underscored so a key is stable, quotable and URL-safe - it is
 * the identity the grants hang off and, like the eight built-in keys, it cannot
 * be renamed afterwards.
 */
export const roleKeySchema = z
  .string()
  .trim()
  .min(6)
  .max(64)
  .regex(
    /^hrms_[a-z][a-z0-9_]*$/,
    'A role key must start with "hrms_" and contain only lower-case letters, digits and underscores (e.g. hrms_regional_manager).',
  )
  .refine((key) => !HRMS_ROLE_LIST.includes(key), {
    message: 'That key belongs to a built-in role. Choose another.',
  });

/**
 * One (module, action, scope) grant.
 *
 * Note what is NOT checked here: whether the combination is MEANINGFUL.
 * `payroll:submit:self` passes - no module rejects a verb it does not use,
 * because the matrix itself is not exhaustive over the cross product and a
 * module may start honouring a verb tomorrow. A grant nothing enforces is
 * inert, which is the safe direction; an invented MODULE is the one that reads
 * as configured and never will be.
 */
export const permissionTripleSchema = z
  .object({
    module: z.enum([...HRMS_MODULE_LIST]),
    action: z.enum([...HRMS_ACTION_LIST]),
    scope: z.enum([...SCOPE_LIST]),
  })
  .strict();

/**
 * At most one entry per (module, action, scope).
 *
 * A duplicated triple is harmless to the evaluator - `hasHrmsPermission` takes
 * the first match that covers - but it makes the "{n} permissions" the screen
 * reports disagree with what the role actually grants, and it makes two saves
 * of the same matrix produce different documents.
 */
const uniqueTriples = (permissions) => {
  const seen = new Set(permissions.map((p) => `${p.module}|${p.action}|${p.scope}`));
  return seen.size === permissions.length;
};

const permissionsSchema = z
  .array(permissionTripleSchema)
  // 32 modules x 10 actions x 4 scopes is the whole cross product; a payload
  // larger than that is not a role, it is a mistake or an attempt to make the
  // server do work.
  .max(HRMS_MODULE_LIST.length * HRMS_ACTION_LIST.length * SCOPE_LIST.length)
  .refine(uniqueTriples, {
    message: 'The same (module, action, scope) was sent more than once.',
  });

export const createRoleSchema = z
  .object({
    key: roleKeySchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    permissions: permissionsSchema,
    /** Roles are born usable; deactivating is a later, deliberate act. */
    active: z.boolean().optional(),
  })
  .strict();

/**
 * `key` is absent on purpose.
 *
 * It is the identity the assignments in `hrms_user_roles` point at and the
 * thing any future `roleKeys.includes('…')` check would name, so renaming one
 * is a data migration rather than an edit. The label - the part a human reads -
 * is freely changeable.
 *
 * `permissions` REPLACES rather than merges, so the submitted payload is
 * authoritative: a diff would have to carry un-ticks separately, and a matrix
 * screen that sends the full set is the simplest thing that can be correct.
 */
export const updateRoleSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    permissions: permissionsSchema.optional(),
    /**
     * Withdraw (or restore) the role's grants without touching who holds it.
     *
     * Sent on its own by the list screen's Active toggle, which is why the
     * whole object is `.partial()` — deactivating must not require resending
     * the permission set, or a toggle would silently rewrite the matrix.
     */
    active: z.boolean().optional(),
  })
  .strict()
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'Nothing to update.',
  });

export default {
  objectIdParamSchema,
  roleKeySchema,
  permissionTripleSchema,
  createRoleSchema,
  updateRoleSchema,
};
