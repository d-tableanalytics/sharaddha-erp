import { api } from "../api";
import { hrmsClient } from "./client";

/**
 * Settings / Administration API.
 *
 * Mirrors the reference's settings surface, which it spreads across four API
 * clients (`/organization`, `/roles`, `/integrations`, `/admin`). Four
 * differences matter at the call site:
 *
 *   1. A SECRET IS NEVER RETURNED. The reference's `GET /integrations` hands
 *      back the whole `config` blob — QuickBooks client secrets, Slack and
 *      Teams webhooks, biometric keys and tokens — even though its own UI
 *      marks those fields secret. Here a read reports PRESENCE
 *      (`hasClientSecret`, `configuredSecrets`) and nothing else, so a form
 *      shows "configured" rather than a value it should never have received.
 *
 *   2. THE BUILT-IN EIGHT ARE READ-ONLY; CUSTOM ROLES ARE NOT. The eight roles
 *      AD-3 fixes are code-defined and have no write route at all. A CUSTOM
 *      role is a row, its grants are unioned onto the actor the guards read,
 *      and its three write verbs are below. Role MEMBERSHIP for both kinds is
 *      still changed in Employees.
 *
 *   3. THE FIELD CONTRACT COMES FROM THE SERVER. The reference keeps its
 *      per-integration field table in the browser only.
 *
 *   4. THERE IS NO DATA RESET. The reference's danger zone wipes every
 *      employee, payroll run and leave balance and reseeds a demo tenant whose
 *      admin password is printed in its own confirm dialog.
 */

export const settingsApi = {
  // -- Company profile ------------------------------------------------------
  /** The EXISTING company profile — the same document `/hrms/company` serves. */
  company: () => hrmsClient.get("/settings/company"),
  updateCompany: (dto) => hrmsClient.patch("/settings/company", dto),

  /**
   * Replace the company logo.
   *
   * Not on `hrmsClient`, which serialises JSON; this posts multipart and must
   * let the browser set its own boundary. It still goes through the shared
   * axios instance, so the Bearer header and the 401 refresh are unchanged.
   */
  async uploadLogo(file) {
    const form = new FormData();
    form.append("logo", file, file.name || "logo.png");
    const res = await api.request({
      method: "post",
      url: "/hrms/settings/company/logo",
      data: form,
    });
    return res.data?.data;
  },

  // -- Roles ----------------------------------------------------------------
  /**
   * The eight built-in roles AND any custom ones, plus the module/action/scope
   * vocabulary the builder draws its grid from.
   *
   * The vocabulary comes from the server on purpose: the reference keeps its
   * own copy in the React component and it has drifted, so its builder cannot
   * grant `payroll/run`, `helpdesk/resolve` or any sub-module at all.
   */
  roles: () => hrmsClient.get("/settings/roles"),

  /** Custom roles only — a built-in role has no id to address. */
  createRole: (dto) => hrmsClient.post("/settings/roles", dto),
  updateRole: (id, dto) => hrmsClient.patch(`/settings/roles/${id}`, dto),
  deleteRole: (id) => hrmsClient.delete(`/settings/roles/${id}`),

  /**
   * Withdraw or restore a role's grants without touching who holds it.
   *
   * Its own method rather than a `updateRole` call at the call site, because
   * the payload MUST be only `{active}`: sending the permission set alongside
   * would make a toggle silently rewrite the matrix from whatever the list
   * screen happened to be holding.
   */
  setRoleActive: (id, active) => hrmsClient.patch(`/settings/roles/${id}`, { active }),

  // -- SSO ------------------------------------------------------------------
  sso: () => hrmsClient.get("/settings/sso"),
  saveSso: (dto) => hrmsClient.put("/settings/sso", dto),

  // -- Integrations ---------------------------------------------------------
  integrations: () => hrmsClient.get("/settings/integrations"),
  saveIntegration: (dto) => hrmsClient.put("/settings/integrations", dto),
};

/** Audit logs — its own module key and its own page, as in the reference. */
export const auditApi = {
  list: (params = {}) => hrmsClient.get("/audit-logs", params),
  actions: () => hrmsClient.get("/audit-logs/actions"),
};

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const SSO_PROVIDER_LABELS = {
  google: "Google Workspace",
  microsoft: "Microsoft Entra ID",
  okta: "Okta",
};

export const INTEGRATION_LABELS = {
  tally: "Tally",
  quickbooks: "QuickBooks",
  slack: "Slack",
  teams: "Microsoft Teams",
  biometric_zkteco: "ZKTeco Biometric",
  biometric_essl: "eSSL Biometric",
  biometric_realtime: "Realtime Biometric",
};

/** The reference's own three groupings, in its order. */
export const INTEGRATION_CATEGORIES = [
  { key: "Accounting", kinds: ["tally", "quickbooks"] },
  { key: "Communication", kinds: ["slack", "teams"] },
  { key: "Biometric", kinds: ["biometric_zkteco", "biometric_essl", "biometric_realtime"] },
];

export const BRAND_TOKEN_LABELS = {
  primary: "Primary",
  primaryDark: "Primary (dark)",
  primaryLight: "Primary (light)",
  accent: "Accent",
};

/** `hrms.settings.sso.updated` → `Settings · Sso · Updated`. */
export function formatAuditAction(action) {
  if (!action) return "—";
  return String(action)
    .replace(/^hrms\./, "")
    .split(".")
    .map((part) =>
      part
        .split("_")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(" "),
    )
    .join(" · ");
}

export default { settingsApi, auditApi };
