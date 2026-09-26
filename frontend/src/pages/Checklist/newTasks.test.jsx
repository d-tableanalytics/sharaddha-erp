import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../hooks/useHrmsPermissions", () => ({
  useHrmsPermissions: () => ({ can: () => false, implementedModules: [], hasAccess: false }),
}));
vi.mock("../../services/checklist", () => ({
  checklistApi: {
    getNewCount: vi.fn(),
    getTasks: vi.fn(),
    getSummary: vi.fn().mockResolvedValue({}),
    getLocations: vi.fn().mockResolvedValue([]),
    getDepartmentsList: vi.fn().mockResolvedValue([]),
    getUsers: vi.fn().mockResolvedValue([]),
    getRoutines: vi.fn().mockResolvedValue([]),
    getDepartments: vi.fn().mockResolvedValue(null),
    markSeen: vi.fn().mockResolvedValue({}),
  },
}));

import { checklistApi } from "../../services/checklist";
import { useUIStore } from "../../store/uiStore";
import { useUserStore } from "../../store/userStore";
import { useChecklistBadgeStore } from "../../store/checklistBadgeStore";
import { Sidebar } from "../../components/layout/Sidebar";
import { TasksTable } from "./TasksTable";
import { ChecklistPage } from "./ChecklistPage";

/**
 * "New" Checklist tasks: the tag on the row, and the count beside Checklist in
 * the sidebar.
 */
const row = (over = {}) => ({
  _id: "occ-1",
  taskName: "Send SOR + PI to Customer — PO-1",
  taskCode: "O2D-PO-1-S3",
  doerFirstName: "Billing team",
  doerLastName: "",
  frequency: "once",
  plannedDate: "2026-09-23T10:00:00.000Z",
  status: "pending",
  ...over,
});

const table = (tasks, props = {}) =>
  render(
    <TasksTable
      tasks={tasks}
      loading={false}
      isAdmin={false}
      selectedIds={[]}
      onToggleSelect={vi.fn()}
      onToggleSelectAll={vi.fn()}
      hasFilters={false}
      onClearFilters={vi.fn()}
      {...props}
    />,
  );

describe("the New tag on a Checklist row", () => {
  test("appears on a task the server marked new, and not on the others", () => {
    table([row({ _id: "a", taskName: "Fresh task", isNew: true }), row({ _id: "b", taskName: "Old task", isNew: false })]);

    expect(within(screen.getByText("Fresh task").closest("tr")).getByText("New")).toBeTruthy();
    expect(within(screen.getByText("Old task").closest("tr")).queryByText("New")).toBeNull();
  });

  test("stays for the rest of the visit, from the page's remembered set", () => {
    table([row({ _id: "a", taskName: "Seen this visit", isNew: false })], { newIds: new Set(["a"]) });
    expect(screen.getByText("New")).toBeTruthy();
  });

  test("never on a finished task", () => {
    table([row({ taskName: "Done task", isNew: true, status: "completed", completedDate: "2026-09-23T11:00:00Z" })]);
    expect(screen.queryByText("New")).toBeNull();
  });
});

describe("opening the Checklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUserStore.setState({ user: { _id: "u1", user: "A Person", role: "Admin", permissions: ["*"], status: "Active" } });
    useChecklistBadgeStore.setState({ newCount: 2 });
  });

  test("marks the list seen only after it has loaded — so the rows keep their tag — and clears the badge", async () => {
    checklistApi.getTasks.mockResolvedValue({ tasks: [row({ _id: "a", taskName: "Arrived today", isNew: true })] });
    render(
      <MemoryRouter>
        <ChecklistPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(checklistApi.markSeen).toHaveBeenCalled());
    expect(checklistApi.markSeen.mock.invocationCallOrder[0])
      .toBeGreaterThan(checklistApi.getTasks.mock.invocationCallOrder[0]);
    expect(within((await screen.findByText("Arrived today")).closest("tr")).getByText("New")).toBeTruthy();
    expect(useChecklistBadgeStore.getState().newCount).toBe(0);
  });
});

describe("the sidebar badge beside Checklist", () => {
  const signIn = (grants) =>
    useUserStore.setState({ user: { _id: "u1", user: "A Person", role: "Billing", permissions: [], grants, status: "Active" } });
  // Several Work Queue screens, so Checklist is its own row rather than the
  // whole group collapsing into one "Work Queue" link.
  const workQueueWithChecklist = [
    { module: "work_queue", submodule: "tasks", actions: ["view"] },
    { module: "work_queue", submodule: "checklist", actions: ["view"] },
  ];
  const draw = () =>
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Sidebar />
      </MemoryRouter>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ sidebarOpen: true, collapsedNavGroups: [] });
    useChecklistBadgeStore.setState({ newCount: 0 });
  });

  test("shows how many tasks are new", async () => {
    checklistApi.getNewCount.mockResolvedValue({ count: 3 });
    signIn(workQueueWithChecklist);
    draw();

    const link = await screen.findByRole("link", { name: /Checklist/ });
    await waitFor(() => expect(within(link).getByText("3 new")).toBeTruthy());
  });

  test("shows nothing when there is nothing new", async () => {
    checklistApi.getNewCount.mockResolvedValue({ count: 0 });
    signIn(workQueueWithChecklist);
    draw();

    await waitFor(() => expect(checklistApi.getNewCount).toHaveBeenCalled());
    expect(within(screen.getByRole("link", { name: /Checklist/ })).queryByText(/new/)).toBeNull();
  });

  test("is not asked for by someone without the Checklist", () => {
    signIn([]);
    draw();
    expect(checklistApi.getNewCount).not.toHaveBeenCalled();
  });
});
