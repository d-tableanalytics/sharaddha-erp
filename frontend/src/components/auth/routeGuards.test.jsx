/**
 * A URL must not open what the sidebar does not offer.
 *
 * Renders the REAL guards against the REAL permission matrix: the nav item's
 * own `requires` list decides the route, so the two cannot drift.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { HrmsProtectedRoute } from "../hrms/HrmsProtectedRoute";
import { PredicateProtectedRoute } from "./PredicateProtectedRoute";
import { useHrmsStore } from "../../store/hrmsStore";
import { useUserStore } from "../../store/userStore";
import { buildHrmsActor } from "@shared/permissions/has-permission.js";
import { HRMS_ROLES as R, HRMS_MODULES as M } from "@shared/permissions/constants.js";

const signIn = (roles) =>
  useHrmsStore.setState({
    actor: buildHrmsActor({ userId: "u1", roles }),
    implementedModules: [M.DASHBOARD, M.EMPLOYEES],
    loaded: true,
    loading: false,
    error: null,
  });

const renderEmployees = (guard) =>
  render(
    <MemoryRouter initialEntries={["/hrms/employees"]}>
      <Routes>
        <Route path="/" element={<div>Portal home</div>} />
        <Route path="/hrms/dashboard" element={<div>HRMS dashboard</div>} />
        <Route path="/hrms/employees" element={guard}>
          <Route index element={<div>Employee directory</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  useHrmsStore.setState({ load: async () => null });
});

describe("HrmsProtectedRoute navKey", () => {
  it("refuses a self-scope employee the Employees page their sidebar hides", () => {
    signIn([R.EMPLOYEE]);
    renderEmployees(<HrmsProtectedRoute module={M.EMPLOYEES} navKey="hrms-employees" />);
    expect(screen.queryByText("Employee directory")).toBeNull();
    expect(screen.getByText("HRMS dashboard")).toBeTruthy();
  });

  it("admits HR, whose grants the nav item accepts", () => {
    signIn([R.HR_ADMIN]);
    renderEmployees(<HrmsProtectedRoute module={M.EMPLOYEES} navKey="hrms-employees" />);
    expect(screen.getByText("Employee directory")).toBeTruthy();
  });

  it("fails closed on an unknown navKey", () => {
    signIn([R.HR_ADMIN]);
    renderEmployees(<HrmsProtectedRoute module={M.EMPLOYEES} navKey="hrms-nope" />);
    expect(screen.queryByText("Employee directory")).toBeNull();
    expect(screen.getByText("Portal home")).toBeTruthy();
  });
});

describe("PredicateProtectedRoute", () => {
  const renderAdmin = (allow) =>
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/" element={<div>Portal home</div>} />
          <Route path="/admin" element={<PredicateProtectedRoute allow={allow} />}>
            <Route index element={<div>Admin screen</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

  beforeEach(() => useUserStore.setState({ user: { permissions: [] }, loading: false }));

  it("redirects when the predicate says no", () => {
    renderAdmin(() => false);
    expect(screen.queryByText("Admin screen")).toBeNull();
    expect(screen.getByText("Portal home")).toBeTruthy();
  });

  it("renders when the predicate says yes", () => {
    renderAdmin(() => true);
    expect(screen.getByText("Admin screen")).toBeTruthy();
  });
});
