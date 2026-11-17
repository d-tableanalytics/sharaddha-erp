import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * Every refusal renders the Unauthorized panel instead of silently sending the
 * user home, and the role fallback is held to the backend baseline (audit F9,
 * F11).
 */

import { BASELINE_ROLE_PERMISSIONS } from "../../../../backend/config/permissions.js";
import { Unauthorized } from "./Unauthorized";
import { NotFound } from "./NotFound";
import { ModuleProtectedRoute } from "../auth/ModuleProtectedRoute";
import { O2dProtectedRoute } from "../o2d/O2dProtectedRoute";
import { useUserStore } from "../../store/userStore";
import {
  FALLBACK_ROLE_PERMISSIONS, SYSTEM_ROLE_NAMES, PERMISSIONS, canUseInventoryMaster, canViewLineItemBoxNo,
} from "../../utils/permissions";

const PANEL = /don.t have access to this screen/;
const sorted = (list) => [...new Set(list)].sort();

const at = (user, guard) => {
  useUserStore.setState({ user, loading: false });
  return render(
    <MemoryRouter initialEntries={["/x"]}>
      <Routes>
        <Route path="/" element={<p>Portal home</p>} />
        <Route path="/x" element={guard}>
          <Route index element={<p>Screen</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => useUserStore.setState({ user: null, loading: false }));

describe("Unauthorized / NotFound", () => {
  it("explains the refusal and links home", () => {
    render(<MemoryRouter><Unauthorized /></MemoryRouter>);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(PANEL)).toBeTruthy();
    expect(screen.getByRole("link", { name: /home screen/ }).getAttribute("href")).toBe("/");
  });

  it("NotFound is not an access refusal", () => {
    render(<MemoryRouter><NotFound /></MemoryRouter>);
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.queryByText(PANEL)).toBeNull();
  });
});

describe("guards render the panel", () => {
  it("ModuleProtectedRoute refuses without the cell", () => {
    at({ role: "Sales", permissions: [], grants: [] },
      <ModuleProtectedRoute module="work_queue" submodule="trash" action="view" />);
    expect(screen.queryByText("Screen")).toBeNull();
    expect(screen.queryByText("Portal home")).toBeNull();
    expect(screen.getByText(PANEL)).toBeTruthy();
  });

  it("ModuleProtectedRoute admits with the cell", () => {
    at({ role: "HR", permissions: [], grants: [{ module: "work_queue", submodule: "trash", actions: ["view"] }] },
      <ModuleProtectedRoute module="work_queue" submodule="trash" action="view" />);
    expect(screen.getByText("Screen")).toBeTruthy();
  });

  it("O2dProtectedRoute refuses the intake form without create_o2d_order", () => {
    at({ role: "Accounts", permissions: [PERMISSIONS.VIEW_O2D] },
      <O2dProtectedRoute permission={PERMISSIONS.CREATE_O2D_ORDER} />);
    expect(screen.getByText(PANEL)).toBeTruthy();
  });
});

describe("role-name checks now follow cells", () => {
  it("inventory master and line-item box numbers", () => {
    expect(canUseInventoryMaster({ role: "HR", permissions: [], grants: [{ module: "inventory", submodule: "master", actions: ["view"] }] })).toBe(true);
    expect(canUseInventoryMaster({ role: "Management", permissions: ["view_inventory"], grants: [] })).toBe(false);
    expect(canViewLineItemBoxNo({ role: "Billing", permissions: ["view_all_bookings"] })).toBe(true);
    expect(canViewLineItemBoxNo({ role: "Sales", permissions: [] })).toBe(false);
  });
});

describe("FALLBACK_ROLE_PERMISSIONS mirrors backend BASELINE_ROLE_PERMISSIONS", () => {
  it("same roles", () => {
    expect(sorted(SYSTEM_ROLE_NAMES)).toEqual(sorted(Object.keys(BASELINE_ROLE_PERMISSIONS)));
  });

  it.each(Object.keys(BASELINE_ROLE_PERMISSIONS))("%s holds the same keys", (role) => {
    expect(sorted(FALLBACK_ROLE_PERMISSIONS[role])).toEqual(sorted(BASELINE_ROLE_PERMISSIONS[role]));
  });
});
