/**
 * Settings / Administration DTOs (AD-6).
 *
 * Four of the reference's fourteen settings endpoints validate nothing at all:
 * `PATCH /organization/current`, `POST /roles`, `PATCH /roles/:id` and
 * `GET /audit-logs` take raw bodies and query strings. Where Zod does run, the
 * integration `config` is `z.record(z.string(), z.any())` — which constrains
 * nothing either.
 *
 * Settings is privileged infrastructure: a field that reaches the database
 * unvalidated here is a configuration-injection hole in the one module whose
 * whole job is deciding how the rest of the system behaves. So every schema
 * below is `.strict()` and every value space is an explicit allow-list.
 */

import { z } from 'zod';

import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../constants/hrms.js';
import { objectId, isoDay } from '../validation/common.js';

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

/**
 * The brand tokens the Company Profile tab edits.
 *
 * An ALLOW-LIST, not a free record. The reference stores `brand` as
 * `Record<string, any>` and writes whatever the request carried straight into
 * the column, so the branding blob is an unbounded key/value store on a
 * privileged endpoint.
 *
 * ---------------------------------------------------------------------------
 * THE DEFAULTS ARE THIS PRODUCT'S PALETTE, NOT THE REFERENCE'S
 * ---------------------------------------------------------------------------
 * They used to be the reference's indigo (`#4338CA` and family), which it
 * applies in the BROWSER and therefore never persists. Carrying them here meant
 * an untouched install opened the Branding card showing four indigo swatches
 * while every screen behind it rendered blue - the picker described a theme
 * that was not running. These are the real values from
 * `frontend/tailwind.config.js`: `primary.600`, `primary.900`, `primary.500`
 * and the amber accent.
 */
export const BRAND_TOKENS = Object.freeze({
  primary: '#2563eb',
  primaryDark: '#1e3a8a',
  primaryLight: '#3b82f6',
  accent: '#f59e0b',
});

export const BRAND_TOKEN_KEYS = Object.freeze(Object.keys(BRAND_TOKENS));

const hexColour = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'expected a #rrggbb colour');

export const brandSchema = z
  .object({
    primary: hexColour,
    primaryDark: hexColour,
    primaryLight: hexColour,
    accent: hexColour,
  })
  .strict()
  .partial();

// ---------------------------------------------------------------------------
// Company profile
// ---------------------------------------------------------------------------

/**
 * What the Settings screen may change on the company profile.
 *
 * Deliberately NARROWER than `updateCompanyProfileSchema` in the company
 * module. That endpoint stays the one source of truth and keeps its own wider
 * surface (statutory identifiers, weekend days, financial year); this is the
 * subset the reference's Company Profile tab actually edits, so the Settings
 * screen cannot reach past its own remit.
 */
export const updateCompanySettingsSchema = z
  .object({
    legalName: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(200),
    brand: brandSchema,
  })
  .strict()
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

/**
 * PNG only, and under 512 KB — the reference's own two rules.
 *
 * PNG because the payslip renderer embeds it with `pdf-lib.embedPng`, which
 * handles no other format; a JPEG here would fail at payslip time, far from the
 * upload that caused it.
 */
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_MIME = 'image/png';
/** The first eight bytes of every PNG. Content-Type alone is caller-supplied. */
export const PNG_MAGIC = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------------------
// SSO
// ---------------------------------------------------------------------------

export const SSO_PROVIDERS = Object.freeze(['google', 'microsoft', 'okta']);
export const ssoProvider = z.enum(SSO_PROVIDERS);

export const upsertSsoConfigSchema = z
  .object({
    provider: ssoProvider,
    clientId: z.string().trim().min(1).max(500),
    /**
     * Optional on UPDATE so an administrator can toggle a provider without
     * retyping the secret — and because the secret is never sent back to the
     * browser, the form has nothing to resubmit. Omitted means "leave it".
     */
    clientSecret: z.string().min(1).max(500).optional(),
    redirectUri: z.string().trim().url().max(2000),
    active: z.boolean().default(true),
  })
  .strict();

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export const INTEGRATION_KINDS = Object.freeze([
  'tally',
  'quickbooks',
  'slack',
  'teams',
  'biometric_zkteco',
  'biometric_essl',
  'biometric_realtime',
]);

export const integrationKind = z.enum(INTEGRATION_KINDS);

/**
 * The fields each integration takes, and which of them are secret.
 *
 * The reference declares exactly this table in its BROWSER
 * (`IntegrationsTab.tsx`), marks five fields `secret: true` — and then returns
 * every one of them from `GET /integrations`, because its service hands back
 * `config: c.config` whole. The table belongs on the server, where it can
 * decide what may be stored and what may be read back.
 */
export const INTEGRATION_FIELDS = Object.freeze({
  tally: [
    { key: 'ledgerServerUrl', label: 'Tally Server URL', type: 'url' },
    { key: 'companyName', label: 'Company Name in Tally', type: 'text' },
  ],
  quickbooks: [
    { key: 'clientId', label: 'QuickBooks Client ID', type: 'text' },
    { key: 'clientSecret', label: 'QuickBooks Client Secret', type: 'text', secret: true },
    { key: 'realmId', label: 'Realm ID', type: 'text' },
  ],
  slack: [
    { key: 'webhookUrl', label: 'Slack Incoming Webhook URL', type: 'url', secret: true },
    { key: 'defaultChannel', label: 'Default Channel', type: 'text' },
  ],
  teams: [{ key: 'webhookUrl', label: 'MS Teams Webhook URL', type: 'url', secret: true }],
  biometric_zkteco: [
    { key: 'deviceIp', label: 'Device IP', type: 'text' },
    { key: 'devicePort', label: 'Device Port', type: 'number' },
    { key: 'commKey', label: 'Communication Key', type: 'text', secret: true },
  ],
  biometric_essl: [
    { key: 'apiUrl', label: 'eSSL Cloud API URL', type: 'url' },
    { key: 'apiKey', label: 'API Key', type: 'text', secret: true },
  ],
  biometric_realtime: [
    { key: 'deviceIp', label: 'Device IP', type: 'text' },
    { key: 'devicePort', label: 'Device Port', type: 'number' },
    { key: 'authToken', label: 'Auth Token', type: 'text', secret: true },
  ],
});

/** Field keys for one kind. */
export const fieldsFor = (kind) => INTEGRATION_FIELDS[kind] ?? [];

/** The secret field keys for one kind — what must never be read back. */
export const secretKeysFor = (kind) =>
  fieldsFor(kind)
    .filter((f) => f.secret)
    .map((f) => f.key);

/** Every secret key across every kind, plus SSO's. Used by the audit redactor. */
export const ALL_SECRET_KEYS = Object.freeze([
  ...new Set([
    'clientSecret',
    ...Object.keys(INTEGRATION_FIELDS).flatMap((k) => secretKeysFor(k)),
  ]),
]);

/** One integration field value: a bounded string, or a port number. */
const fieldValue = z.union([
  z.string().trim().max(2000),
  z.number().int().min(0).max(65535),
]);

/**
 * An integration config, validated against the DECLARED fields for its kind.
 *
 * `superRefine` rather than a per-kind schema map so an unknown key is reported
 * with its own name, which is what makes a typo in a device key debuggable.
 */
export const upsertIntegrationConfigSchema = z
  .object({
    kind: integrationKind,
    config: z.record(z.string(), fieldValue).default({}),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fields = fieldsFor(value.kind);
    const allowed = new Set(fields.map((f) => f.key));
    const config = value.config ?? {};

    for (const key of Object.keys(config)) {
      if (!allowed.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['config', key],
          message: `"${key}" is not a field of the ${value.kind} integration`,
        });
      }
    }

    /*
     * An ACTIVE integration must actually be configured.
     *
     * Nothing required anything, in either direction, so `{kind:'slack',
     * active:true}` with an empty config saved happily and reported itself as
     * Active - a green badge for an integration that could not connect to
     * anything. (The reference has the opposite bug: it marks its SECRET fields
     * required and its ordinary ones optional.)
     *
     * Only the NON-SECRET fields are checked. A secret is write-once and
     * deliberately omitted on a later save to mean "leave the stored one
     * alone", so requiring it here would make every edit demand the webhook URL
     * again - which is the behaviour the SSO tab has to apologise for.
     * Deactivating is always allowed: `active: false` is how you park a
     * half-finished integration.
     */
    if (value.active === false) return;

    for (const field of fields) {
      if (field.secret) continue;
      const supplied = config[field.key];
      if (supplied === undefined || supplied === null || supplied === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['config', field.key],
          message: `${field.label} is required to activate the ${value.kind} integration.`,
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Audit log query
// ---------------------------------------------------------------------------

/**
 * The audit list query.
 *
 * The reference reads `@Query('page')` and friends raw, then `parseInt`s them
 * with no `NaN` guard and no lower bound — `?page=-5` reaches `skip` as a
 * negative offset. Coercion and bounds here, as every other HRMS list does.
 */
export const auditLogQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
    /** Free text matched against the action, escaped before it reaches a regex. */
    action: z.string().trim().min(1).max(120).optional(),
    userId: objectId.optional(),
    from: isoDay.optional(),
    to: isoDay.optional(),
  })
  .strict()
  .refine((v) => !(v.from && v.to) || v.from <= v.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export default {
  BRAND_TOKENS,
  BRAND_TOKEN_KEYS,
  brandSchema,
  updateCompanySettingsSchema,
  LOGO_MAX_BYTES,
  LOGO_MIME,
  PNG_MAGIC,
  SSO_PROVIDERS,
  upsertSsoConfigSchema,
  INTEGRATION_KINDS,
  INTEGRATION_FIELDS,
  fieldsFor,
  secretKeysFor,
  ALL_SECRET_KEYS,
  upsertIntegrationConfigSchema,
  auditLogQuerySchema,
};
