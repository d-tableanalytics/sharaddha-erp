import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../hooks/useHrmsPermissions", () => ({
  // HRMS is out of scope here; an account with no HRMS access renders the rail
  // with only the FMS group, which is what these assert on.
  useHrmsPermissions: () => ({ can: () => false, implementedModules: [], hasAccess: false }),
}));

import { useUIStore } from "../../store/uiStore";
import { useUserStore } from "../../store/userStore";
import { Sidebar } from "./Sidebar";
import { PERMISSIONS } from "../../utils/permissions";

/**
 * The rail renders at all.
 *
 * This file exists because of a live `ReferenceError: o2dGroups is not defined`
 * that reached the browser with a GREEN build and a GREEN test suite. Nothing
 * imported the Sidebar in a test, so nothing ever executed it — and a bundler
 * will happily bundle a component that throws the moment it runs.
 *
 * The structural assertions below are secondary. The first test is the one that
 * matters: it renders.
 */
const signIn = (role, permissions) =>
  useUserStore.setState({
    user: { _id: "u1", user: "A Person", role, permissions, status: "Active" },
  });

const draw = () =>
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );

beforeEach(() => {
  useUIStore.setState({ sidebarOpen: true, collapsedNavGroups: [] });
  useUserStore.setState({ user: null });
});

describe("the rail renders", () => {
  test("without throwing, for an O2D user", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    // The whole point. A ReferenceError here is the bug this file guards.
    expect(() => draw()).not.toThrow();
  });

  test("and for an account with nothing at all", () => {
    signIn("Customer", []);
    expect(() => draw()).not.toThrow();
  });
});

describe("FMS contains O2D, which contains the screens", () => {
  test("the group is FMS and the section inside it is O2D", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    draw();

    expect(screen.getByRole("button", { name: /FMS/ })).toBeTruthy();
    // A real section heading, not a prefix on every link.
    expect(screen.getByText("O2D")).toBeTruthy();
  });

  test("the links are named for what they are, not prefixed", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    draw();

    for (const label of ["My Tasks", "Order Tracker", "Stages", "Order History", "Exit Register"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    // The old flat labelling put the module name where the eye scans last.
    expect(screen.queryByText(/O2D — My Tasks/)).toBeNull();
  });

  test("every link points under /fms/o2d", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    draw();

    // Built from the shared `o2dRoute` helper, so the rail cannot drift from
    // the routes — an earlier copy of this group pointed at /o2d/... and went
    // unnoticed because nothing rendered it.
    for (const label of ["My Tasks", "Order Tracker", "Stages", "Order History", "Exit Register"]) {
      expect(screen.getByRole("link", { name: label }).getAttribute("href"))
        .toMatch(/^\/fms\/o2d\//);
    }
  });
});

describe("Analytics follows its own permission", () => {
  test("hidden without view_o2d_analytics", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    draw();
    // The server refuses that endpoint on its own key; the link matches so
    // nobody clicks into a 403.
    expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
  });

  test("shown with it", () => {
    signIn("Management", [PERMISSIONS.VIEW_O2D, PERMISSIONS.VIEW_O2D_ANALYTICS]);
    draw();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeTruthy();
  });
});

describe("an account without O2D sees no FMS group", () => {
  test("the group is absent entirely", () => {
    signIn("Customer", []);
    draw();
    expect(screen.queryByRole("button", { name: /FMS/ })).toBeNull();
  });
});
