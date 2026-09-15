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

const draw = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
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

describe("sub-modules are dropdowns", () => {
  /*
   * O2D used to render as a <p>: a heading that looked like a control, sat
   * above a list it did not govern, and could not be closed. With six links
   * under it and eight under Work Queue, the rail scrolls and there was no way
   * to put a sub-module away.
   */
  test("the section heading is a real control, expanded by default", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    draw();

    const heading = screen.getByRole("button", { name: /O2D/ });
    // Absent from the collapsed list means expanded — the right default, since
    // a sub-module that hides itself on first load is one nobody finds.
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "My Tasks" })).toBeTruthy();
  });

  test("collapsing it hides its links but keeps the heading", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    // Namespaced by group: a bare "o2d" would collide with the FMS GROUP key
    // and close the whole rail instead of one heading.
    useUIStore.setState({ sidebarOpen: true, collapsedNavGroups: ["o2d:o2d"] });
    draw();

    expect(screen.getByRole("button", { name: /O2D/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "My Tasks" })).toBeNull();
  });

  test("the section key does not collide with its group key", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    // Collapsing the GROUP hides everything including the section heading...
    useUIStore.setState({ sidebarOpen: true, collapsedNavGroups: ["o2d"] });
    draw();

    expect(screen.getByRole("button", { name: /FMS/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /O2D/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "My Tasks" })).toBeNull();
  });
});

/** Class names as a list, so assertions compare tokens not substrings. */
const classList = (el) => String(el.className).split(/\s+/).filter(Boolean);

describe("the active item is unmistakable", () => {
  test("it gets a solid white background, not a translucent tint", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    draw("/fms/o2d/stages");

    const classes = classList(screen.getByRole("link", { name: "Stages" }));

    // A SOLID pill. `bg-white/10` on a dark gradient sat about as far from the
    // hover state (`white/[0.07]`) as a rounding error, so the rail could not
    // answer "which page am I on" at a glance.
    expect(classes).toContain("bg-white");
    expect(classes).not.toContain("bg-white/10");
    // Dark text, or the label vanishes into its own pill.
    expect(classes).toContain("text-primary-900");
  });

  test("only ONE row is active, and it is the most specific match", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    draw("/fms/o2d/stages");

    // Keyed on `nav-active`, not on the white background: the LOGO is also a
    // link with a white background, and counting by colour would call it a
    // second active row.
    const activeRows = screen
      .getAllByRole("link")
      .filter((el) => classList(el).includes("nav-active"));

    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].textContent).toContain("Stages");
  });

  test("an inactive row carries no white background", () => {
    signIn("Billing", [PERMISSIONS.VIEW_O2D]);
    draw("/fms/o2d/stages");

    const classes = classList(screen.getByRole("link", { name: "My Tasks" }));
    expect(classes).not.toContain("bg-white");
    expect(classes).not.toContain("nav-active");
  });
});
