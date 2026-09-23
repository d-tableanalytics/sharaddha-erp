/**
 * Settings / Administration.
 *
 * The reference spreads this across five backend modules (`organization`,
 * `rbac`, `integration`, `admin`, `audit`) that share one RBAC key. This is the
 * same surface, minus two things it does that should not be ported:
 *
 *   - the custom-role builder, because Shraddha's matrix is code-defined by
 *     AD-3 and rendering 532 checkboxes that change nothing would be a lie;
 *   - `POST /admin/reset-dtable-seed`, which wipes every employee, payroll run
 *     and leave balance and reseeds a demo tenant with a published password.
 *
 * Both are argued in documentation/hrms-settings-analysis.md §21.
 *
 * ---------------------------------------------------------------------------
 * The rule this module exists to hold
 * ---------------------------------------------------------------------------
 * A secret goes IN and never comes OUT. Not through a read endpoint, not
 * through the audit trail, not through an error message. The reference breaks
 * this three ways and the three compose into a real escalation: its
 * `GET /integrations` returns every credential; its audit interceptor stores
 * `req.body` unredacted; and its Audit Logs page — which hr_admin and auditor
 * can open, though neither may see Settings at all — renders that payload in a
 * modal.
 */

import CompanyProfile from '../../../models/hrms/CompanyProfile.js';
import { SsoConfig, IntegrationConfig } from '../../../models/hrms/SettingsModels.js';
import { encryptField } from '../../../utils/hrms/crypto/index.js';
import { putObject, getReadUrl } from '../../../utils/hrms/storage/index.js';
import { recordAudit } from '../../../utils/auditLog.js';
import { AUDIT_ACTIONS, STORAGE_CATEGORIES } from '../../../shared/constants/hrms.js';
import { HrmsValidationError } from '../hrms.errors.js';
import {
  readCustomRoles,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
} from '../rbac/customRole.service.js';
import {
  HRMS_MODULE_LIST,
  HRMS_ACTIONS,
  SCOPES,
} from '../../../shared/permissions/constants.js';
import {
  BRAND_TOKENS,
  LOGO_MAX_BYTES,
  LOGO_MIME,
  PNG_MAGIC,
  secretKeysFor,
  fieldsFor,
  INTEGRATION_KINDS,
  INTEGRATION_FIELDS,
  SSO_PROVIDERS,
} from '../../../shared/schemas/settings.js';

const actorUser = (actor) => ({ _id: actor?.userId ?? null });

// ---------------------------------------------------------------------------
// Company profile
// ---------------------------------------------------------------------------

/**
 * The singleton profile, created on first read.
 *
 * `CompanyProfile` already exists and is the one source of truth — the company
 * module owns its full editing surface (statutory identifiers, weekend days,
 * financial year, default state). Settings edits a deliberately narrower slice.
 */
async function loadProfile() {
  const existing = await CompanyProfile.findOne({ key: 'company-profile' });
  if (existing) return existing;
  return CompanyProfile.create({ key: 'company-profile' });
}

/** Brand tokens, with the reference's defaults filled in ON THE SERVER. */
export const withBrandDefaults = (brand) => ({ ...BRAND_TOKENS, ...(brand ?? {}) });

export async function getCompanySettings() {
  const profile = await loadProfile();

  return {
    legalName: profile.legalName,
    displayName: profile.displayName,
    brand: withBrandDefaults(profile.brand),
    logoKey: profile.logoKey,
    // A presigned URL, never the raw key (AD-7). The reference serves its logo
    // from a single unauthenticated file on the API server's local disk.
    logoUrl: profile.logoKey
      ? await getReadUrl(profile.logoKey, { category: STORAGE_CATEGORIES.COMPANY_ASSET })
      : null,
    updatedAt: profile.updatedAt,
  };
}

export async function updateCompanySettings(dto, actor, req = null) {
  const profile = await loadProfile();
  const changed = [];

  if (dto.legalName !== undefined && dto.legalName !== profile.legalName) {
    profile.legalName = dto.legalName;
    changed.push('legalName');
  }
  if (dto.displayName !== undefined && dto.displayName !== profile.displayName) {
    profile.displayName = dto.displayName;
    changed.push('displayName');
  }
  if (dto.brand !== undefined) {
    // Merged onto the CURRENT value, not onto the defaults: a form that submits
    // one colour must not silently reset the other three.
    profile.brand = { ...withBrandDefaults(profile.brand), ...dto.brand };
    changed.push('brand');
  }

  if (changed.length > 0) {
    await profile.save();
    await recordAudit(
      actorUser(actor),
      AUDIT_ACTIONS.SETTINGS_COMPANY_UPDATED,
      `Updated company settings (${changed.join(', ')}).`,
      req,
      { meta: { fields: changed } },
    );
  }

  return getCompanySettings();
}

/**
 * Replace the company logo.
 *
 * Three checks, in order of trustworthiness: size, declared type, then the
 * PNG magic bytes. The declared `Content-Type` is caller-supplied and a
 * renamed JPEG carries the same header a real PNG does — and the payslip
 * renderer embeds this file with `pdf-lib.embedPng`, which handles nothing
 * else. A wrong file here fails at payslip time, far from the upload that
 * caused it, so it is rejected at the door.
 */
export async function replaceLogo(file, actor, req = null) {
  if (!file?.buffer?.length) {
    throw new HrmsValidationError('No logo file was uploaded.');
  }
  if (file.size > LOGO_MAX_BYTES) {
    throw new HrmsValidationError(`Logo must be under ${LOGO_MAX_BYTES / 1024} KB.`);
  }
  if (file.mimetype !== LOGO_MIME) {
    throw new HrmsValidationError('Logo must be a PNG file.');
  }
  const magic = file.buffer.subarray(0, PNG_MAGIC.length);
  if (!PNG_MAGIC.every((byte, i) => magic[i] === byte)) {
    throw new HrmsValidationError('That file is not a PNG, whatever it is named.');
  }

  const { key } = await putObject({
    category: STORAGE_CATEGORIES.COMPANY_ASSET,
    body: file.buffer,
    contentType: LOGO_MIME,
    scope: 'company',
    filename: 'logo.png',
    size: file.size,
  });

  const profile = await loadProfile();
  profile.logoKey = key;
  await profile.save();

  await recordAudit(
    actorUser(actor),
    AUDIT_ACTIONS.SETTINGS_LOGO_UPDATED,
    'Replaced the company logo.',
    req,
    { meta: { bytes: file.size } },
  );

  return getCompanySettings();
}

// ---------------------------------------------------------------------------
// SSO
// ---------------------------------------------------------------------------

/**
 * Every provider, configured or not.
 *
 * The catalogue is fixed, so returning only the configured rows would make the
 * screen unable to offer the others. Never includes a secret — `publicShape`
 * reports presence, and `clientSecretEnc` is `select: false` besides.
 */
export async function listSsoConfigs() {
  // `+clientSecretEnc` so `hasClientSecret` can be computed. The value is
  // loaded and never emitted — `publicShape` returns the boolean alone.
  const rows = await SsoConfig.find().select('+clientSecretEnc').sort({ provider: 1 });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  return SSO_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    return row
      ? row.publicShape()
      : {
          id: null,
          provider,
          clientId: '',
          redirectUri: '',
          active: false,
          hasClientSecret: false,
          updatedAt: null,
        };
  });
}

export async function upsertSsoConfig(dto, actor, req = null) {
  const existing = await SsoConfig.findOne({ provider: dto.provider }).select(
    '+clientSecretEnc',
  );

  if (!existing && !dto.clientSecret) {
    // Creating without a secret would store a provider that cannot authenticate
    // anyone. Updating without one is fine — it means "leave it alone".
    throw new HrmsValidationError('A client secret is required when first configuring a provider.');
  }

  const doc = existing ?? new SsoConfig({ provider: dto.provider });
  doc.clientId = dto.clientId;
  doc.redirectUri = dto.redirectUri;
  doc.active = dto.active;
  doc.updatedById = actor?.userId ?? null;

  const rotated = Boolean(dto.clientSecret);
  if (rotated) doc.clientSecretEnc = await encryptField(dto.clientSecret);

  await doc.save();

  await recordAudit(
    actorUser(actor),
    AUDIT_ACTIONS.SETTINGS_SSO_UPDATED,
    `Updated the ${dto.provider} SSO configuration.`,
    req,
    // The provider and WHETHER the secret rotated — never the secret. The
    // reference audits `req.body`, which puts the client secret in the trail in
    // plaintext for anyone holding audit-logs:view:org.
    { meta: { provider: dto.provider, active: dto.active, secretRotated: rotated } },
  );

  return doc.publicShape();
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

/** The catalogue the screen renders: every kind, its fields, and its state. */
export async function listIntegrations() {
  // `+secretsEnc` so `configuredSecrets` can name which secrets are held.
  // The envelopes are loaded and never emitted — only their KEYS are.
  const rows = await IntegrationConfig.find().select('+secretsEnc').sort({ kind: 1 });
  const byKind = new Map(rows.map((r) => [r.kind, r]));

  return INTEGRATION_KINDS.map((kind) => {
    const row = byKind.get(kind);
    const base = row
      ? row.publicShape()
      : { id: null, kind, config: {}, configuredSecrets: [], active: false, updatedAt: null };
    // The field contract travels with the row so the form is server-driven —
    // the reference keeps this table in the browser only.
    return { ...base, fields: INTEGRATION_FIELDS[kind] };
  });
}

export async function upsertIntegrationConfig(dto, actor, req = null) {
  const secretKeys = new Set(secretKeysFor(dto.kind));
  const declared = new Set(fieldsFor(dto.kind).map((f) => f.key));

  const existing = await IntegrationConfig.findOne({ kind: dto.kind }).select('+secretsEnc');
  const doc = existing ?? new IntegrationConfig({ kind: dto.kind });

  // Split the submitted config: plain fields are stored as given, secret fields
  // are encrypted into a separate `select: false` path. A key that is neither
  // was already rejected by the schema; the check is repeated because this is
  // the last point before a write.
  const plain = {};
  const secrets = { ...(doc.secretsEnc ?? {}) };
  const rotated = [];

  for (const [key, value] of Object.entries(dto.config ?? {})) {
    if (!declared.has(key)) {
      throw new HrmsValidationError(`"${key}" is not a field of the ${dto.kind} integration.`);
    }
    if (secretKeys.has(key)) {
      // An empty string means "leave the stored secret alone" — the form cannot
      // round-trip a value it was never given.
      if (value === '' || value === null || value === undefined) continue;
      secrets[key] = await encryptField(String(value));
      rotated.push(key);
    } else {
      plain[key] = value;
    }
  }

  doc.config = plain;
  doc.secretsEnc = secrets;
  doc.active = dto.active;
  doc.updatedById = actor?.userId ?? null;
  await doc.save();

  await recordAudit(
    actorUser(actor),
    AUDIT_ACTIONS.SETTINGS_INTEGRATION_UPDATED,
    `Updated the ${dto.kind} integration.`,
    req,
    // WHICH secrets rotated, never their values.
    { meta: { kind: dto.kind, active: dto.active, secretsRotated: rotated } },
  );

  return { ...doc.publicShape(), fields: INTEGRATION_FIELDS[dto.kind] };
}

// ---------------------------------------------------------------------------
// Roles and permissions — read only
// ---------------------------------------------------------------------------

/**
 * Every role an administrator can see, in one list.
 *
 * ---------------------------------------------------------------------------
 * ONE KIND OF ROLE NOW
 * ---------------------------------------------------------------------------
 * All eight built-in roles are rows in `hrms_roles` too (see
 * `rbac/seedRoles.js`), seeded once and never overwritten, so this used to be
 * two lists — one read from code, one from the database — glued together here.
 * `readCustomRoles()` already returns all of them, built-in and custom alike,
 * each carrying its live (possibly edited) permissions and a `userCount` that
 * accounts for both storage paths (`User.roles[]` for the eight, the
 * `HrmsUserRole` join table for anything else). `isSystem` stays `false` on
 * every row now; only `hrms_super_admin` comes back `protected: true`, which
 * is the one restriction that still separates it from the rest.
 *
 * `modules`, `actions` and `scopes` are served from the SAME constants the
 * evaluator imports, rather than a list the browser keeps. The reference
 * hardcodes 19 modules and 7 actions in its React component and has since
 * drifted from its own 33-module, 10-action union - so its builder cannot
 * grant `payroll/run`, `helpdesk/resolve` or any sub-module at all. Serving
 * the vocabulary is what makes that class of drift impossible here.
 */
export async function getRoleMatrix() {
  /*
   * The plain read, not the permission-checked one: this function has never
   * gated itself, and its two callers are gated differently at the route -
   * `settings:view:org` here, `manage_roles` on the portal's Administration
   * screen, which holds no HRMS grant at all.
   */
  const roles = await readCustomRoles();

  return {
    editable: true,
    assignmentPath: '/hrms/employees',
    modules: [...HRMS_MODULE_LIST],
    actions: Object.values(HRMS_ACTIONS),
    scopes: Object.values(SCOPES),
    roles,
  };
}

/*
 * The write half of Roles & Permissions.
 *
 * Re-exported rather than reimplemented: the rules live in
 * rbac/customRole.service.js next to the model they guard, and Settings is the
 * screen they are reached from. Two copies of "may this be deleted" is how the
 * screen and the API start disagreeing.
 */
export { createCustomRole, updateCustomRole, deleteCustomRole };

export default {
  getRoleMatrix,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  getCompanySettings,
  updateCompanySettings,
  replaceLogo,
  listSsoConfigs,
  upsertSsoConfig,
  listIntegrations,
  upsertIntegrationConfig,
};
