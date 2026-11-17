import { describe, test, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { MODULE_INFO } from "./content";
import ROUTES from "./content/routes";
import { moduleInfoForPath } from "./registry";
import { PageHeader } from "../components/common/PageHeader";

/**
 * The ⓘ "About this module" panel: every routed screen has documentation, the
 * documentation is well formed, and the header shows it.
 */

/** One URL per screen (and alias) in routes/index.jsx. Add a line when a screen is added. */
const SCREENS = [
  "/",
  "/work-queue", "/work-queue/t1", "/my-work", "/in-loop-tasks", "/wq/looptasks", "/all-tasks", "/wq/alltasks",
  "/wq/delegation", "/wq/checklist", "/wq/executivescoreboard", "/wq/activities", "/deleted-tasks", "/wq/deletedtasks",
  "/admin/users", "/admin/permissions",
  "/fms/o2d/tasks", "/fms/o2d/orders", "/fms/o2d/orders/new", "/fms/o2d/stages", "/fms/o2d/analytics",
  "/hrms/dashboard", "/hrms/inbox", "/hrms/me", "/hrms/employees", "/hrms/employees/e1", "/hrms/employees/e1/edit",
  "/hrms/org", "/hrms/attendance", "/hrms/leave", "/hrms/payroll", "/hrms/expenses",
  "/hrms/performance", "/hrms/documents", "/hrms/engage", "/hrms/helpdesk",
  "/hrms/academy", "/hrms/academy/learn/a1", "/hrms/academy/learn/a1/lesson/l1", "/hrms/academy/paths/p1",
  "/hrms/onboarding", "/hrms/exits", "/hrms/assets", "/hrms/hiring", "/hrms/planning",
  "/hrms/reports", "/hrms/settings", "/hrms/audit-logs",
];

const KINDS = ["automatic", "manual", "historical", "multi"];

describe("module documentation", () => {
  test.each(SCREENS)("%s has its own panel", (path) => {
    expect(moduleInfoForPath(path), `no documentation for ${path}`).not.toBeNull();
  });

  test("the academy sub-pages get their own panels, not the academy's", () => {
    const academy = moduleInfoForPath("/hrms/academy");
    expect(moduleInfoForPath("/hrms/academy/paths/p1")).not.toBe(academy);
    expect(moduleInfoForPath("/hrms/academy/learn/a1/lesson/l1")).not.toBe(academy);
  });

  test("the route index matches the documentation exactly", () => {
    expect(ROUTES).toEqual(MODULE_INFO.map(({ key, title, paths }) => ({ key, title, paths })));
  });

  test("keys are unique", () => {
    const keys = MODULE_INFO.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("no two screens share an overview (no copied boilerplate)", () => {
    const whats = MODULE_INFO.map((e) => e.overview.what.trim());
    expect(new Set(whats).size).toBe(whats.length);
  });

  test.each(MODULE_INFO.map((e) => [e.key, e]))("%s is well formed", (_key, e) => {
    expect(e.title).toBeTruthy();
    expect(e.paths.length).toBeGreaterThan(0);
    expect(e.overview.what.length).toBeGreaterThan(20);
    expect(e.functions.length).toBeGreaterThan(0);
    expect(e.steps.length).toBeGreaterThan(0);
    for (const i of e.impacts) expect(KINDS).toContain(i.kind);
    for (const c of e.connections) expect(["one-way", "two-way"]).toContain(c.direction);
    expect(JSON.stringify(e)).not.toMatch(/backend\/|frontend\/|\.jsx?\b/);
  });

  test("an unknown route has no panel, so no empty icon appears", () => {
    expect(moduleInfoForPath("/no-such-screen")).toBeNull();
  });
});

describe("the ⓘ icon in the page header", () => {
  const at = (path, ui) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

  test("sits beside the heading and opens this screen's panel", async () => {
    at("/hrms/leave", <PageHeader title="Leave" />);
    fireEvent.click(screen.getByRole("button", { name: /About this module/ }));
    const panel = await screen.findByTestId("module-info-panel");
    expect(panel.textContent).toContain(MODULE_INFO.find((e) => e.key === "hrms.leave").overview.what);
  });

  test("is absent where nothing is documented", () => {
    at("/no-such-screen", <PageHeader title="Nothing" />);
    expect(screen.queryByTestId("module-info-button")).toBeNull();
  });
});
