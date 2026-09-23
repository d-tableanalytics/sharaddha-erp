/**
 * Settings routes, mounted at /api/v1/hrms/settings.
 *
 * The parent HRMS router has already applied protect -> attachHrmsActor ->
 * requireHrmsAccess, so everything here is authenticated and holds some HRMS
 * grant. Each route then adds its own permission.
 *
 * Permissions are the reference's own module keys — no matrix change was
 * needed. Shraddha's `matrix.js` already grants exactly what DTA's does, which
 * was verified by parsing both matrices and diffing every `settings*` triple
 * per role:
 *
 *   settings:view:org                 super_admin
 *   settings:edit:org                 super_admin
 *   settings:integrations:edit:org    super_admin
 *
 * So Settings is super-admin-only in both codebases, and the `audit-logs`
 * surface — which hr_admin and auditor DO hold — is mounted separately.
 *
 * ONE DEPARTURE. The reference gates its integrations READ on
 * `settings:integrations:edit:org`, because it never defined a matching `view`
 * key. Reading is admitted here by that key OR by `settings:view:org`, so a
 * future read-only administrator is expressible without inventing a permission.
 * It cannot widen anything today: both are held by super_admin alone.
 */

import express from 'express';

import { requirePermission } from '../../../middlewares/hrmsAuth.js';
import { validate } from '../../../middlewares/validate.js';
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from '../../../shared/permissions/constants.js';
import {
  updateCompanySettingsSchema,
  upsertSsoConfigSchema,
  upsertIntegrationConfigSchema,
} from '../../../shared/schemas/settings.js';
import {
  createRoleSchema,
  updateRoleSchema,
  objectIdParamSchema,
} from '../../../shared/schemas/role.js';
import { uploadLogoFile, handleLogoUploadErrors } from './logoUpload.js';
import * as controller from './settings.controller.js';

const router = express.Router();

const canView = requirePermission({ module: M.SETTINGS, action: A.VIEW, scope: S.ORG });
const canEdit = requirePermission({ module: M.SETTINGS, action: A.EDIT, scope: S.ORG });

/** Integration secrets are the most sensitive thing Settings holds. */
const canEditIntegrations = requirePermission({
  module: M.SETTINGS_INTEGRATIONS,
  action: A.EDIT,
  scope: S.ORG,
});

const canViewIntegrations = requirePermission(
  { module: M.SETTINGS_INTEGRATIONS, action: A.EDIT, scope: S.ORG },
  { module: M.SETTINGS, action: A.VIEW, scope: S.ORG },
);

// ---------------------------------------------------------------------------
// Company profile
//
// Reads and writes the EXISTING CompanyProfile — the same document
// /hrms/company serves. One source of truth; this is the administration view
// of it, deliberately narrower than the company module's own editing surface.
// ---------------------------------------------------------------------------

router.get('/company', canView, controller.getCompany);

router.patch(
  '/company',
  canEdit,
  validate({ body: updateCompanySettingsSchema }),
  controller.updateCompany,
);

/**
 * The logo.
 *
 * `handleLogoUploadErrors` sits directly after multer so a rejected file is a
 * 400 rather than a 500 from the app-wide handler.
 */
router.post(
  '/company/logo',
  canEdit,
  uploadLogoFile,
  handleLogoUploadErrors,
  controller.uploadLogo,
);

// ---------------------------------------------------------------------------
// Roles and permissions
//
// The GET returns BOTH kinds of role: the eight built-in ones, which are
// code-defined (AD-3), carry `isSystem: true` and have no write route here at
// all — and any CUSTOM roles, which are rows in `hrms_roles` and whose grants
// really are enforced, because rbac/customRole.middleware.js unions them onto
// the actor the guards read.
//
// So the three writes below can only ever address a custom role. "A system
// role cannot be edited or deleted" needs no check on these routes: a built-in
// role has no id in that collection to address. The reference needs three
// explicit `isSystem` refusals for the same guarantee.
//
// Role MEMBERSHIP is still changed where it already was:
// PATCH /hrms/employees/:id/roles, which enforces AD-4's Customer exclusion.
// ---------------------------------------------------------------------------

router.get('/roles', canView, controller.getRoles);

router.post(
  '/roles',
  canEdit,
  validate({ body: createRoleSchema }),
  controller.createRole,
);

router.patch(
  '/roles/:id',
  canEdit,
  validate({ params: objectIdParamSchema, body: updateRoleSchema }),
  controller.updateRole,
);

router.delete(
  '/roles/:id',
  canEdit,
  validate({ params: objectIdParamSchema }),
  controller.deleteRole,
);

// ---------------------------------------------------------------------------
// SSO and integrations
//
// PUT, not POST: both are upserts keyed on the provider or the kind, so the
// call is idempotent and naming it POST would suggest otherwise.
// ---------------------------------------------------------------------------

router.get('/sso', canViewIntegrations, controller.listSso);

router.put(
  '/sso',
  canEditIntegrations,
  validate({ body: upsertSsoConfigSchema }),
  controller.upsertSso,
);

router.get('/integrations', canViewIntegrations, controller.listIntegrations);

router.put(
  '/integrations',
  canEditIntegrations,
  validate({ body: upsertIntegrationConfigSchema }),
  controller.upsertIntegration,
);

export default router;
