import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * A view-only account is offered nothing to click.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * Before this change the Work Queue's eight screens contained 195 onClick
 * handlers and exactly one permission check between them - and that one asked
 * about a ROLE. Assign Task, bulk delete, Verify & Complete, stop a routine and
 * restore from the bin all rendered for anybody who could reach the route, and
 * the route was gated on FMS's `view_o2d`.
 *
 * The server refuses all of it now, so the worst case was a 403 rather than a
 * data breach. But a screen full of buttons that fail is not an access model
 * either, and "if the user does not have Create permission, the Create action
 * should not be available" is a statement about the UI.
 *
 * So these tests drive the real components with a real permission set. They
 * assert on ABSENCE, which is the thing no amount of manual clicking finds:
 * nobody notices a button that should not be there.
 *
 * The grants below are the shape `/auth/me` sends - `grantsForUser` on the
 * server - so `canAction` is answering the same data in the test as in the
 * browser.
 */

vi.mock("../hooks/useHrmsPermissions", () => ({
  useHrmsPermissions: () => ({ can: () => false, implementedModules: [], hasAccess: false }),
}));

/**
 * The service returns ARRAYS, and the pages call `.filter` on them straight
 * away - so a `{ data: [] }` mock crashes the render before any permission is
 * read. Both the default export and the named one are stubbed because the four
 * screens import it both ways.
 */
const delegationStub = {
  getDelegations: vi.fn().mockResolvedValue([]),
  getDeletedDelegations: vi.fn().mockResolvedValue([]),
  getTasks: vi.fn().mockResolvedValue([]),
  getTaskStats: vi.fn().mockResolvedValue({}),
  getUsers: vi.fn().mockResolvedValue([]),
  getCategories: vi.fn().mockResolvedValue([]),
  getTags: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue([]),
};

vi.mock("../services/delegation", () => ({
  default: delegationStub,
  delegationService: delegationStub,
}));

vi.mock("../services/checklist", () => ({
  checklistApi: {
    getTasks: vi.fn().mockResolvedValue([]),
    getRoutines: vi.fn().mockResolvedValue([]),
    getSummary: vi.fn().mockResolvedValue({}),
    getStats: vi.fn().mockResolvedValue({}),
    getScoreboard: vi.fn().mockResolvedValue([]),
    getDepartments: vi.fn().mockResolvedValue({}),
    getDepartmentsList: vi.fn().mockResolvedValue([]),
    getUsers: vi.fn().mockResolvedValue([]),
    getLocations: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

import { useUserStore } from "../store/userStore";
import { useUIStore } from "../store/uiStore";
import { Sidebar } from "../components/layout/Sidebar";

/**
 * Sign in with an explicit grant list.
 *
 * `permissions: []` deliberately: these screens must decide from the MATRIX,
 * and a test that also handed them flat keys could not tell the two apart.
 */
const signIn = (grants) =>
  useUserStore.setState({
    user: { _id: "u1", user: "A Person", role: "Import Team", permissions: [], grants },
    loading: false,
  });

const cell = (module, submodule, actions) => ({ module, submodule, actions });

const VIEW_ONLY = [cell("work_queue", "tasks", ["view"])];

const FULL = [
  cell("work_queue", "tasks", ["view", "create", "edit", "delete", "approve"]),
  cell("work_queue", "assignment", ["edit"]),
  cell("work_queue", "completion", ["edit"]),
  cell("work_queue", "administration", ["delete", "approve"]),
  cell("work_queue", "checklist", ["view", "create", "edit", "delete", "approve"]),
  cell("work_queue", "trash", ["view", "delete", "approve"]),
  cell("work_queue", "scoreboard", ["view", "edit"]),
  cell("work_queue", "activity", ["view"]),
];

beforeEach(() => {
  useUIStore.setState({ sidebarOpen: true, collapsedNavGroups: [] });
  useUserStore.setState({ user: null, loading: false });
});

// ---------------------------------------------------------------------------
// The sidebar
// ---------------------------------------------------------------------------

describe("a module with no View permission is not in the rail", () => {
  const drawRail = () =>
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Sidebar />
      </MemoryRouter>,
    );

  test("view on tasks shows the task screens and nothing else", () => {
    signIn(VIEW_ONLY);
    drawRail();

    expect(screen.getByRole("link", { name: /My Work/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /All Tasks/ })).toBeTruthy();

    // The four that are separately grantable, and were not granted. Each was
    // unconditionally in the rail before, for anyone holding `view_o2d`.
    expect(screen.queryByRole("link", { name: /Deleted Tasks/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Checklist/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Executive Scoreboard/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Activities/ })).toBeNull();
  });

  test("the whole Work Queue group disappears when nothing in it is granted", () => {
    signIn([]);
    drawRail();

    expect(screen.queryByRole("button", { name: /Work Queue/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /My Work/ })).toBeNull();
  });

  test("the full grant shows every row", () => {
    signIn(FULL);
    drawRail();

    for (const name of [/My Work/, /Delegation/, /Loop Tasks/, /All Tasks/, /Deleted Tasks/, /Checklist/, /Executive Scoreboard/, /Activities/]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
  });

  test("Work Queue no longer rides on the FMS permission", () => {
    // `view_o2d` as a flat key, which is exactly what used to open this group.
    useUserStore.setState({
      user: { _id: "u1", user: "A Person", role: "Billing", permissions: ["view_o2d"], grants: [] },
      loading: false,
    });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /FMS/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /My Work/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------

describe("Create is not offered without Create", () => {
  const drawPage = async (path, importer) => {
    const mod = await importer();
    const Page = mod.default ?? Object.values(mod)[0];
    render(
      <MemoryRouter initialEntries={[path]}>
        <Page />
      </MemoryRouter>,
    );
    // Every one of these pages fetches on mount; let that settle so the
    // assertion is about permissions rather than about a loading state.
    await screen.findByRole("heading", { level: 1 });
  };

  test("Delegation offers no Assign Task to a viewer", async () => {
    signIn(VIEW_ONLY);
    await drawPage("/wq/delegation", () => import("./Delegation/DelegationPage"));

    expect(screen.queryByRole("button", { name: /Assign Task/i })).toBeNull();
  });

  test("Delegation offers Assign Task once Create is granted", async () => {
    signIn(FULL);
    await drawPage("/wq/delegation", () => import("./Delegation/DelegationPage"));

    expect(screen.getByRole("button", { name: /Assign Task/i })).toBeTruthy();
  });

  test("All Tasks offers no Assign Task to a viewer", async () => {
    signIn(VIEW_ONLY);
    await drawPage("/wq/alltasks", () => import("./AllTasks/AllTasks"));

    expect(screen.queryByRole("button", { name: /Assign Task/i })).toBeNull();
  });

  test("the Checklist offers no New Checklist to a viewer", async () => {
    signIn([cell("work_queue", "checklist", ["view"])]);
    await drawPage("/wq/checklist", () => import("./Checklist/ChecklistPage"));

    expect(screen.queryByRole("button", { name: /New Checklist|Add Task/i })).toBeNull();
  });
});
