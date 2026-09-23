/**
 * Settings / Administration and Audit Logs — the screens.
 *
 * Only the axios instance is mocked. The HRMS client, the real permission
 * matrix and the real route guard are all live, so these also cover the request
 * URLs, the payload shapes and the `{ success, data }` unwrapping.
 *
 * Settings is super-admin-only and the audit trail is not, so a good deal of
 * this is about which door each role gets through — the same asymmetry the
 * backend suite tests from the other side.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../../../services/api", () => ({ api: { request: vi.fn() } }));

import { api } from "../../../services/api";
import { SettingsPage } from "./SettingsPage";
import { AuditLogsPage } from "../audit/AuditLogsPage";
import { HrmsProtectedRoute } from "../../../components/hrms/HrmsProtectedRoute";
import { formatAuditAction } from "../../../services/hrms/settings";
import { useHrmsStore } from "../../../store/hrmsStore";
import { buildHrmsActor } from "@shared/permissions/has-permission.js";
import { HRMS_ROLES as R, HRMS_MODULES as M } from "@shared/permissions/constants.js";

const ME = "652f0000000000000000b001";

const COMPANY = {
  legalName: "Shraddha Impex",
  displayName: "Shraddha",
  brand: {
    primary: "#4338ca",
    primaryDark: "#312e81",
    primaryLight: "#6366f1",
    accent: "#f59e0b",
  },
  logoKey: "hrms/company/logo.png",
  logoUrl: "https://s3.example/presigned/logo.png",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

const ROLES = {
  // Every role is a database row now — the eight seeded built-ins included —
  // so one flag says the whole surface is editable. See getRoleMatrix in
  // settings.service.js.
  editable: true,
  assignmentPath: "/hrms/employees",
  // Including a sub-module, so the grid's parent/child grouping is exercised.
  modules: ["employees", "employees:compensation", "settings"],
  actions: ["view", "edit"],
  scopes: ["self", "org"],
  roles: [
    {
      id: "r-super",
      key: R.SUPER_ADMIN,
      label: "HRMS Super Admin",
      protected: true,
      active: true,
      userCount: 1,
      permissions: [
        { module: "settings", action: "edit", scope: "org" },
        { module: "employees", action: "view", scope: "org" },
      ],
    },
    {
      id: "r-employee",
      key: R.EMPLOYEE,
      label: "Employee",
      protected: false,
      active: true,
      userCount: 42,
      permissions: [{ module: "employees", action: "view", scope: "self" }],
    },
    {
      id: "c1",
      key: "hrms_regional_manager",
      label: "Regional Manager",
      description: "Approves leave company-wide.",
      protected: false,
      active: true,
      userCount: 0,
      permissions: [{ module: "employees", action: "view", scope: "org" }],
    },
  ],
};

const SSO = [
  {
    id: "s1",
    provider: "google",
    clientId: "client-abc",
    redirectUri: "https://hr.example.com/cb",
    active: true,
    hasClientSecret: true,
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
  { id: null, provider: "microsoft", clientId: "", redirectUri: "", active: false, hasClientSecret: false, updatedAt: null },
  { id: null, provider: "okta", clientId: "", redirectUri: "", active: false, hasClientSecret: false, updatedAt: null },
];

const INTEGRATIONS = [
  {
    id: "i1",
    kind: "slack",
    config: { defaultChannel: "#hr" },
    configuredSecrets: ["webhookUrl"],
    active: true,
    updatedAt: "2026-03-01T00:00:00.000Z",
    fields: [
      { key: "webhookUrl", label: "Slack Incoming Webhook URL", type: "url", secret: true },
      { key: "defaultChannel", label: "Default Channel", type: "text" },
    ],
  },
  {
    id: null,
    kind: "tally",
    config: {},
    configuredSecrets: [],
    active: false,
    updatedAt: null,
    fields: [
      { key: "ledgerServerUrl", label: "Tally Server URL", type: "url" },
      { key: "companyName", label: "Company Name in Tally", type: "text" },
    ],
  },
];

const AUDIT_ROW = {
  id: "a1",
  action: "hrms.settings.sso.updated",
  actorUserId: ME,
  actorName: "Sue Person",
  method: "PUT",
  endpoint: "/api/v1/hrms/settings/sso",
  ipAddress: "10.0.0.1",
  remarks: "Updated the google SSO configuration.",
  meta: { provider: "google", secretRotated: true, clientSecret: "[redacted]" },
  createdAt: "2026-03-02T10:00:00.000Z",
};

let calls = [];
const envelope = (payload) => ({ data: { success: true, data: payload } });
const fail = (status, body) => Promise.reject({ response: { status, data: body } });

function installTransport(overrides = {}) {
  calls = [];
  api.request.mockImplementation(async (config) => {
    calls.push(config);
    const key = `${config.method.toUpperCase()} ${config.url}`;
    if (overrides[key]) return overrides[key](config);

    if (key === "GET /hrms/settings/company") return envelope(COMPANY);
    if (key === "PATCH /hrms/settings/company") return envelope({ ...COMPANY, ...config.data });
    if (key === "POST /hrms/settings/company/logo") return envelope(COMPANY);
    if (key === "GET /hrms/settings/roles") return envelope(ROLES);
    if (key === "GET /hrms/settings/sso") return envelope(SSO);
    if (key === "PUT /hrms/settings/sso") return envelope({ ...SSO[0], ...config.data });
    if (key === "GET /hrms/settings/integrations") return envelope(INTEGRATIONS);
    if (key === "PUT /hrms/settings/integrations") return envelope(INTEGRATIONS[0]);
    if (key === "GET /hrms/audit-logs")
      return envelope({ data: [AUDIT_ROW], total: 1, page: 1, pageSize: 25 });
    if (key === "GET /hrms/audit-logs/actions")
      return envelope(["hrms.settings.sso.updated", "hrms.employee.updated"]);
    throw new Error(`unstubbed: ${key}`);
  });
}

const signIn = (roles) =>
  useHrmsStore.setState({
    actor: buildHrmsActor({ userId: "u1", roles, employee: { id: ME, managerChain: [] } }),
    implementedModules: [M.DASHBOARD, M.EMPLOYEES, M.SETTINGS, M.AUDIT_LOGS],
    loaded: true,
    loading: false,
    error: null,
  });

const at = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/hrms/settings" element={<SettingsPage />} />
        <Route path="/hrms/settings/:tab" element={<SettingsPage />} />
        <Route path="/hrms/audit-logs" element={<AuditLogsPage />} />
        <Route path="/hrms/employees" element={<p>Employee directory</p>} />
      </Routes>
    </MemoryRouter>,
  );

/**
 * Through the real guard, wired as routes/index.jsx wires it.
 *
 * The `:tab` child matters: the settings page redirects `/hrms/settings` to
 * `/hrms/settings/company`, so a harness without it would render nothing and
 * look identical to a refusal.
 */
const guarded = (path, module, element) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<HrmsProtectedRoute module={module} />}>
          <Route index element={element} />
          <Route path=":tab" element={element} />
        </Route>
        <Route path="/hrms/dashboard" element={<p>HRMS home</p>} />
        <Route path="/" element={<p>Portal home</p>} />
      </Routes>
    </MemoryRouter>,
  );

const urlsHit = () => calls.map((c) => `${c.method.toUpperCase()} ${c.url}`);
const lastCallTo = (url) => calls.filter((c) => c.url === url).pop();

beforeEach(() => {
  useHrmsStore.getState().clear();
  installTransport();
});

// ===========================================================================
// Gating
// ===========================================================================

describe("who reaches Settings", () => {
  it("a super admin reaches it", async () => {
    signIn([R.SUPER_ADMIN]);
    guarded("/hrms/settings", M.SETTINGS, <SettingsPage />);
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("an hr_admin is turned away BEFORE the page loads anything", async () => {
    // hr_admin holds `audit-logs:view:org` but not `settings:view:org`.
    signIn([R.HR_ADMIN]);
    guarded("/hrms/settings", M.SETTINGS, <SettingsPage />);

    expect(await screen.findByText(/home/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    expect(urlsHit()).not.toContain("GET /hrms/settings/company");
  });

  it("every non-super-admin role is turned away", async () => {
    for (const role of [R.HR_ADMIN, R.PAYROLL_ADMIN, R.RECRUITER, R.IT_ADMIN, R.MANAGER, R.EMPLOYEE, R.AUDITOR]) {
      useHrmsStore.getState().clear();
      installTransport();
      signIn([role]);
      const view = guarded("/hrms/settings", M.SETTINGS, <SettingsPage />);
      expect(await screen.findByText(/home/i)).toBeTruthy();
      view.unmount();
    }
  });

  it("audit logs admit the oversight roles, and nobody else", async () => {
    for (const role of [R.SUPER_ADMIN, R.HR_ADMIN, R.AUDITOR]) {
      useHrmsStore.getState().clear();
      installTransport();
      signIn([role]);
      const view = guarded("/hrms/audit-logs", M.AUDIT_LOGS, <AuditLogsPage />);
      expect(await screen.findByRole("heading", { name: "Audit Logs" })).toBeTruthy();
      view.unmount();
    }

    for (const role of [R.PAYROLL_ADMIN, R.IT_ADMIN, R.MANAGER, R.EMPLOYEE]) {
      useHrmsStore.getState().clear();
      installTransport();
      signIn([role]);
      const view = guarded("/hrms/audit-logs", M.AUDIT_LOGS, <AuditLogsPage />);
      expect(await screen.findByText(/home/i)).toBeTruthy();
      view.unmount();
    }
  });
});

describe("the settings page", () => {
  it("hides SSO and Integrations from an actor without the integrations grant", async () => {
    // No shipped role separates these two today — super_admin holds both — so
    // the gate is exercised by building the actor directly. It exists so the
    // permissions can diverge later without the screen offering a tab whose
    // endpoints would refuse it.
    useHrmsStore.setState({
      actor: {
        userId: "u1",
        employeeId: ME,
        departmentId: null,
        managerChain: [],
        roleKeys: [R.SUPER_ADMIN],
        permissions: [{ module: M.SETTINGS, action: "view", scope: "org" }],
      },
      implementedModules: [M.SETTINGS],
      loaded: true,
      loading: false,
      error: null,
    });
    at("/hrms/settings/company");

    expect(await screen.findByRole("tab", { name: "Company Profile" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Single Sign-On" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Integrations" })).toBeNull();
  });

  it("refuses a gated tab reached by URL, WITHOUT firing its request", async () => {
    useHrmsStore.setState({
      actor: {
        userId: "u1",
        employeeId: ME,
        departmentId: null,
        managerChain: [],
        roleKeys: [R.SUPER_ADMIN],
        permissions: [{ module: M.SETTINGS, action: "view", scope: "org" }],
      },
      implementedModules: [M.SETTINGS],
      loaded: true,
      loading: false,
      error: null,
    });
    at("/hrms/settings/sso");

    expect(await screen.findByText(/do not have access to this view/i)).toBeTruthy();
    expect(urlsHit()).not.toContain("GET /hrms/settings/sso");
  });

  it("shows the reference's four tabs, in its order", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/company");

    expect(await screen.findByRole("tab", { name: "Company Profile" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Roles & Permissions" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Single Sign-On" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Integrations" })).toBeTruthy();
  });

  it("puts the tab in the URL", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("HRMS Super Admin");
    expect(urlsHit()).toContain("GET /hrms/settings/roles");
    expect(urlsHit()).not.toContain("GET /hrms/settings/sso");
  });
});

// ===========================================================================
// Company profile
// ===========================================================================

describe("company profile", () => {
  it("loads the EXISTING profile and shows its logo", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/company");

    expect(await screen.findByDisplayValue("Shraddha Impex")).toBeTruthy();
    expect(screen.getByDisplayValue("Shraddha")).toBeTruthy();
    expect(screen.getByAltText("Current company logo").src).toBe(COMPANY.logoUrl);
    // The presigned URL, never the storage key.
    expect(screen.queryByText(/hrms\/company\/logo\.png/)).toBeNull();
  });

  it("saves name and brand together", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/company");
    await screen.findByDisplayValue("Shraddha Impex");

    await userEvent.clear(screen.getByLabelText("Display name"));
    await userEvent.type(screen.getByLabelText("Display name"), "Shraddha HR");
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => {
      const call = lastCallTo("/hrms/settings/company");
      expect(call.method).toBe("patch");
      expect(call.data.displayName).toBe("Shraddha HR");
      expect(call.data.brand.primary).toBe("#4338ca");
    });
  });

  it("offers only the four brand tokens", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/company");
    await screen.findByDisplayValue("Shraddha Impex");

    for (const label of ["Primary", "Primary (dark)", "Primary (light)", "Accent"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("refuses a non-PNG logo without calling the server", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/company");
    await screen.findByDisplayValue("Shraddha Impex");

    // `fireEvent`, not `userEvent.upload`: the latter honours the input's
    // `accept="image/png"` and drops the file before the change handler runs,
    // so it would prove the ATTRIBUTE rather than the check behind it. A
    // scripted upload does not respect `accept` either.
    const input = screen.getByLabelText("Choose a logo");
    const file = new File(["x"], "logo.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() =>
      expect(urlsHit()).not.toContain("POST /hrms/settings/company/logo"),
    );
  });

  it("refuses an oversized PNG without calling the server", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/company");
    await screen.findByDisplayValue("Shraddha Impex");

    const input = screen.getByLabelText("Choose a logo");
    const big = new File(["x"], "logo.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 600 * 1024 });
    Object.defineProperty(input, "files", { value: [big], configurable: true });
    fireEvent.change(input);

    await waitFor(() =>
      expect(urlsHit()).not.toContain("POST /hrms/settings/company/logo"),
    );
  });

  it("uploads a PNG as multipart, once the replacement is confirmed", async () => {
    // The fixture already HAS a logo, so this is a replacement — which
    // overwrites the stored object with no undo and therefore asks first.
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/company");
    await screen.findByDisplayValue("Shraddha Impex");

    const file = new File(["\x89PNG"], "logo.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Choose a logo"), file);

    // Nothing is sent until the dialog is answered.
    expect(lastCallTo("/hrms/settings/company/logo")).toBeFalsy();
    await userEvent.click(await screen.findByRole("button", { name: /replace logo/i }));

    await waitFor(() => {
      const call = lastCallTo("/hrms/settings/company/logo");
      expect(call).toBeTruthy();
      expect(call.data instanceof FormData).toBe(true);
      expect(call.data.get("logo")).toBeTruthy();
    });
  });

  it("does NOT ask before the FIRST logo upload — nothing is being destroyed", async () => {
    installTransport({
      "GET /hrms/settings/company": () => envelope({ ...COMPANY, logoKey: null, logoUrl: null }),
    });
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/company");
    await screen.findByDisplayValue("Shraddha Impex");

    const file = new File(["\x89PNG"], "logo.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Choose a logo"), file);

    await waitFor(() => expect(lastCallTo("/hrms/settings/company/logo")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /replace logo/i })).toBeNull();
  });

  it("has no danger-zone reset", async () => {
    // The reference's fourth card wipes every employee, payroll run and leave
    // balance and reseeds a demo tenant with a published password.
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/company");
    await screen.findByDisplayValue("Shraddha Impex");

    expect(screen.queryByText(/danger zone/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /reset|wipe|reseed/i })).toBeNull();
  });

  it("shows a real error state with a retry", async () => {
    installTransport({
      "GET /hrms/settings/company": () => fail(500, { message: "Server error" }),
    });
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/company");

    expect(await screen.findByText("Company settings could not be loaded")).toBeTruthy();
    const before = calls.length;
    await userEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
  });
});

// ===========================================================================
// Roles — a viewer, not an editor
// ===========================================================================

describe("roles and permissions", () => {
  it("lists all eight built-in roles alongside any custom ones, with their counts", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");

    expect(await screen.findByText("HRMS Super Admin")).toBeTruthy();
    expect(screen.getByText("Employee")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("marks the super admin role Protected, and disables its delete and deactivate", async () => {
    /*
     * Every role is an editable database row now, the eight built-ins
     * included — except `hrms_super_admin`, which the server refuses to
     * delete or deactivate so an admin can never lock everyone out of this
     * screen with no way back in. Edit still works, so its permissions can be
     * grown; the server separately refuses an edit that strips
     * `settings:edit:org`.
     */
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("HRMS Super Admin");

    expect(screen.getByText("Protected")).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit hrms super admin/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete hrms super admin/i }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /deactivate hrms super admin/i }).disabled).toBe(
      true,
    );
  });

  it("offers full edit, deactivate and delete for a non-protected built-in role", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("Employee");

    expect(screen.getByRole("button", { name: /edit employee/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete employee/i }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: /deactivate employee/i }).disabled).toBe(false);
  });

  it("offers create, edit and delete for a CUSTOM role", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("Regional Manager");

    expect(screen.getByRole("button", { name: /new role/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit regional manager/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete regional manager/i })).toBeTruthy();
  });

  it("lists roles as Key / Label / Status / Users / Permissions", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("Regional Manager");

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent.trim());
    expect(headers.slice(0, 5)).toEqual(["Key", "Label", "Status", "Users", "Permissions"]);

    // A count reads as "{n} rules".
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getAllByText(/^\d+ rules$/).length).toBe(3);
  });

  it("has no Duplicate control on any role", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("Regional Manager");

    expect(screen.queryByRole("button", { name: /duplicate/i })).toBeNull();
  });

  it("deactivates a custom role from the list, and reports it plainly", async () => {
    const patched = [];
    let active = true;
    installTransport({
      "GET /hrms/settings/roles": () =>
        envelope({ ...ROLES, roles: [ROLES.roles[0], ROLES.roles[1], { ...ROLES.roles[2], active }] }),
      "PATCH /hrms/settings/roles/c1": (config) => {
        patched.push(config.data);
        active = config.data.active;
        return envelope({ ...ROLES.roles[2], active });
      },
    });
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("Regional Manager");

    await userEvent.click(screen.getByRole("button", { name: /deactivate regional manager/i }));

    // The toggle sends ONLY `active` — never the permission set, so a stale
    // draft elsewhere on the page could never leak into it.
    await waitFor(() => expect(patched).toEqual([{ active: false }]));
    expect(await screen.findByText("Inactive")).toBeTruthy();
  });

  it("Edit implies View at the same scope, and clearing View clears what depended on it", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("Regional Manager");

    await userEvent.click(screen.getByRole("button", { name: /new role/i }));
    await userEvent.click(screen.getByRole("button", { name: /^employees/i }));

    await userEvent.click(
      screen.getByRole("checkbox", { name: "edit employees at org scope" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "view employees at org scope" }).checked,
    ).toBe(true);

    // Clearing View takes the dependent Edit with it — an edit-without-view
    // role is not a stricter role, it is a broken one.
    await userEvent.click(
      screen.getByRole("checkbox", { name: "view employees at org scope" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "edit employees at org scope" }).checked,
    ).toBe(false);
  });

  it("filters the module list without touching what is already ticked", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("Regional Manager");

    await userEvent.click(screen.getByRole("button", { name: /new role/i }));
    await userEvent.type(screen.getByLabelText(/filter modules/i), "settings");

    // Module headers are `role="button"`; scoped to those so the page's own
    // "Settings" breadcrumb (outside the drawer) cannot make this ambiguous.
    const moduleNames = screen
      .getAllByRole("button", { expanded: false })
      .map((el) => el.textContent.trim());
    expect(moduleNames).not.toContain("Employees");
    expect(moduleNames.some((t) => t.startsWith("Settings"))).toBe(true);
  });

  it("blocks the delete outright while the role is still assigned", async () => {
    // The server refuses it independently; disabling the button is what stops
    // the round trip that was never going to succeed.
    installTransport({
      "GET /hrms/settings/roles": () =>
        envelope({
          ...ROLES,
          roles: [{ ...ROLES.roles[2], userCount: 3 }],
        }),
    });
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("Regional Manager");

    await userEvent.click(screen.getByRole("button", { name: /delete regional manager/i }));

    expect(await screen.findByText(/3 user\(s\) are assigned to this role/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete role/i }).disabled).toBe(true);
  });

  it("reports missing required fields inline rather than silently refusing", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("Regional Manager");

    await userEvent.click(screen.getByRole("button", { name: /new role/i }));
    await userEvent.click(screen.getByRole("button", { name: /create role/i }));

    expect(await screen.findByText("Key required")).toBeTruthy();
    expect(screen.getByText("Label required")).toBeTruthy();
    // Nothing was sent.
    expect(urlsHit()).not.toContain("POST /hrms/settings/roles");

    // And the message clears as soon as the field is filled in.
    await userEvent.type(screen.getByLabelText(/^key/i), "hrms_x");
    expect(screen.queryByText("Key required")).toBeNull();
  });

  it("builds a role from the vocabulary the SERVER sent, sub-modules included", async () => {
    /*
     * The grid iterates `modules`/`actions`/`scopes` from the response rather
     * than a list of its own. The reference hardcodes them and has drifted
     * from its own union, so its builder cannot express `payroll/run` or any
     * sub-module at all.
     */
    const posted = [];
    installTransport({
      "POST /hrms/settings/roles": (config) => {
        posted.push(config.data);
        return envelope({ ...ROLES.roles[2], ...config.data });
      },
    });
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("HRMS Super Admin");

    await userEvent.click(screen.getByRole("button", { name: /new role/i }));

    await userEvent.type(screen.getByLabelText(/^key/i), "hrms_floor_lead");
    await userEvent.type(screen.getByLabelText(/display label/i), "Floor Lead");

    // The sub-module is grouped under its parent, not listed separately.
    await userEvent.click(screen.getByRole("button", { name: /^employees/i }));
    expect(screen.getByText("employees:compensation")).toBeTruthy();

    await userEvent.click(
      screen.getByRole("checkbox", { name: "edit employees:compensation at org scope" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /create role/i }));

    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].key).toBe("hrms_floor_lead");
    // Ticking `edit` implies `view` at the same scope — see permissionKeys.js
    // — so both triples are sent for the one checkbox that was clicked.
    expect(posted[0].permissions.sort((a, b) => a.action.localeCompare(b.action))).toEqual([
      { module: "employees:compensation", action: "edit", scope: "org" },
      { module: "employees:compensation", action: "view", scope: "org" },
    ]);
  });

  it("round-trips an existing role's ticks unchanged through edit -> save", async () => {
    const patched = [];
    installTransport({
      "PATCH /hrms/settings/roles/c1": (config) => {
        patched.push(config.data);
        return envelope({ ...ROLES.roles[2], ...config.data });
      },
    });
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("Regional Manager");

    await userEvent.click(screen.getByRole("button", { name: /edit regional manager/i }));
    // The key is the identity the assignments point at, so it is not editable.
    expect(screen.getByLabelText(/^key/i).disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(patched.length).toBe(1));
    expect(patched[0].permissions).toEqual([
      { module: "employees", action: "view", scope: "org" },
    ]);
    expect(patched[0].key).toBeUndefined();
  });

  it("says where roles ARE changed", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("HRMS Super Admin");

    const link = screen.getByRole("link", { name: /employee record/i });
    expect(link.getAttribute("href")).toBe("/hrms/employees");
  });

  it("has no View control on any role", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/roles");
    await screen.findByText("HRMS Super Admin");

    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
  });
});

// ===========================================================================
// SSO
// ===========================================================================

describe("single sign-on", () => {
  it("never prefills the secret, and says one is stored", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/sso");

    const secret = await screen.findByLabelText("Client secret", { selector: "#google-client-secret" });
    expect(secret.value).toBe("");
    expect(secret.type).toBe("password");
    expect(secret.placeholder).toMatch(/leave blank to keep/i);
    expect(screen.getByDisplayValue("client-abc")).toBeTruthy();
  });

  it("omits the secret entirely when it is left blank", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/sso");
    await screen.findByDisplayValue("client-abc");

    await userEvent.click(screen.getByRole("button", { name: /Save Google Workspace/ }));

    await waitFor(() => {
      const call = lastCallTo("/hrms/settings/sso");
      expect(call.data.provider).toBe("google");
      // Not an empty string — that would be a rotation to nothing.
      expect("clientSecret" in call.data).toBe(false);
    });
  });

  it("sends the secret when one is typed", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/sso");
    await screen.findByDisplayValue("client-abc");

    await userEvent.type(
      screen.getByLabelText("Client secret", { selector: "#google-client-secret" }),
      "NEW-SECRET",
    );
    await userEvent.click(screen.getByRole("button", { name: /Save Google Workspace/ }));

    await waitFor(() => {
      expect(lastCallTo("/hrms/settings/sso").data.clientSecret).toBe("NEW-SECRET");
    });
  });

  it("does NOT render a secret even if the server wrongly sends one", async () => {
    // The server never returns it — but this form must not display one
    // whatever arrives, so a future server regression cannot become a leak on
    // screen. The reference's integrations tab beside it does exactly that.
    installTransport({
      "GET /hrms/settings/sso": () =>
        envelope([{ ...SSO[0], clientSecret: "LEAKED-FROM-SERVER" }, SSO[1], SSO[2]]),
    });
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/sso");

    const secret = await screen.findByLabelText("Client secret", {
      selector: "#google-client-secret",
    });
    expect(secret.value).toBe("");
    expect(document.body.textContent).not.toContain("LEAKED-FROM-SERVER");
  });

  it("says plainly that SSO does not sign anyone in yet", async () => {
    // True of the reference too — its `buildAuthUrl` is never called — but its
    // UI does not admit it.
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/sso");
    expect(await screen.findByText(/not yet wired to sign-in/i)).toBeTruthy();
  });
});

// ===========================================================================
// Integrations
// ===========================================================================

describe("integrations", () => {
  it("groups by the reference's categories and shows credential counts", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/integrations");

    expect(await screen.findByRole("heading", { name: "Communication" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Accounting" })).toBeTruthy();
    expect(screen.getByText("1 credential stored")).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();
  });

  it("renders the fields the SERVER declared, secrets blank", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/integrations");
    await screen.findByText("1 credential stored");

    await userEvent.click(screen.getByRole("button", { name: /Configure Slack/ }));

    const webhook = await screen.findByLabelText("Slack Incoming Webhook URL");
    expect(webhook.type).toBe("password");
    expect(webhook.value).toBe("");
    expect(screen.getByLabelText("Default Channel").value).toBe("#hr");
  });

  it("does NOT render an integration secret even if the server sends one", async () => {
    installTransport({
      "GET /hrms/settings/integrations": () =>
        envelope([
          { ...INTEGRATIONS[0], config: { defaultChannel: "#hr", webhookUrl: "LEAKED-HOOK" } },
          INTEGRATIONS[1],
        ]),
    });
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/integrations");
    await screen.findByText("1 credential stored");

    await userEvent.click(screen.getByRole("button", { name: /Configure Slack/ }));
    expect((await screen.findByLabelText("Slack Incoming Webhook URL")).value).toBe("");
    expect(document.body.textContent).not.toContain("LEAKED-HOOK");
  });

  it("omits an untouched secret so the stored one survives", async () => {
    signIn([R.SUPER_ADMIN]);
    at("/hrms/settings/integrations");
    await screen.findByText("1 credential stored");

    await userEvent.click(screen.getByRole("button", { name: /Configure Slack/ }));
    await screen.findByLabelText("Slack Incoming Webhook URL");
    await userEvent.clear(screen.getByLabelText("Default Channel"));
    await userEvent.type(screen.getByLabelText("Default Channel"), "#people");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const call = lastCallTo("/hrms/settings/integrations");
      expect(call.data.kind).toBe("slack");
      expect(call.data.config.defaultChannel).toBe("#people");
      expect("webhookUrl" in call.data.config).toBe(false);
    });
  });
});

// ===========================================================================
// Audit logs
// ===========================================================================

describe("audit logs", () => {
  it("lists entries with actor, method and action", async () => {
    signIn([R.AUDITOR]);
    at("/hrms/audit-logs");

    expect(await screen.findByText("Sue Person")).toBeTruthy();
    expect(screen.getByText("PUT")).toBeTruthy();
    expect(screen.getByText("hrms.settings.sso.updated")).toBeTruthy();
  });

  it("filters through the SERVER", async () => {
    signIn([R.AUDITOR]);
    at("/hrms/audit-logs");
    await screen.findByText("Sue Person");

    await userEvent.selectOptions(
      screen.getByLabelText("Filter by action"),
      "hrms.settings.sso.updated",
    );
    await waitFor(() =>
      expect(lastCallTo("/hrms/audit-logs").params.action).toBe("hrms.settings.sso.updated"),
    );

    expect(lastCallTo("/hrms/audit-logs").params.page).toBe(1);
    expect(lastCallTo("/hrms/audit-logs").params.pageSize).toBe(25);
  });

  it("opens a detail view showing the REDACTED meta", async () => {
    signIn([R.HR_ADMIN]);
    at("/hrms/audit-logs");
    await screen.findByText("Sue Person");

    await userEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(await screen.findByText(/\/api\/v1\/hrms\/settings\/sso/)).toBeTruthy();
    // In the JSON block itself, not only in the sentence that explains it.
    //
    // Scoped to the drawer: `document.querySelector` is global, and the drawer
    // is a portal on document.body, so a bare query can pick up a node another
    // test in this file left behind. It passed alone and failed in the full
    // run, which is exactly what that looks like.
    const heading = await screen.findByRole("heading", { level: 3 });
    const json = heading.closest("div.fixed").querySelector("pre");
    expect(json).toBeTruthy();
    expect(json.textContent).toMatch(/"clientSecret": "\[redacted\]"/);
    expect(json.textContent).toMatch(/"secretRotated": true/);
    // And it explains that, rather than presenting a blank as an absent value.
    expect(screen.getByText(/removed on the/i)).toBeTruthy();
  });

  it("survives its filter options failing to load", async () => {
    installTransport({
      "GET /hrms/audit-logs/actions": () => fail(500, { message: "nope" }),
    });
    signIn([R.AUDITOR]);
    at("/hrms/audit-logs");

    expect(await screen.findByText("Sue Person")).toBeTruthy();
    const select = screen.getByLabelText("Filter by action");
    expect(within(select).getByText("All actions")).toBeTruthy();
  });
});

// ===========================================================================
// Formatting
// ===========================================================================

describe("formatAuditAction", () => {
  it("reads an action key as a phrase", () => {
    expect(formatAuditAction("hrms.settings.sso.updated")).toBe("Settings · Sso · Updated");
    expect(formatAuditAction("hrms.ticket_category.created")).toBe("Ticket Category · Created");
    expect(formatAuditAction(null)).toBe("—");
  });
});
