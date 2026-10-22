/**
 * The common home dashboard.
 *
 * The services are mocked; the permission evaluators are REAL — portal grants
 * go through `canAction`/`hasPermission` exactly as the browser runs them, and
 * HRMS actors are built with the shared matrix. So a test that says "an HRMS
 * employee sees no Work Queue card" is also saying the permission model makes
 * it so.
 *
 * Most assertions are about ABSENCE, and about requests NOT made: the page's
 * contract is that it never asks an endpoint the viewer cannot use.
 */

import { Suspense } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const {
  delegation, checklist, scoreboard, activity, o2d, hrmsDashboard, inbox, attendance, leave, learning, goals, reviews, requisitions, interviews,
} = vi.hoisted(() => ({
  delegation: { getDelegations: vi.fn() },
  checklist: { getSummary: vi.fn() },
  scoreboard: { getScoreboard: vi.fn() },
  activity: { getActivities: vi.fn() },
  o2d: { taskCounts: vi.fn(), analyticsSummary: vi.fn(), slaCompliance: vi.fn() },
  hrmsDashboard: { widgets: vi.fn(), summary: vi.fn() },
  inbox: { list: vi.fn() },
  attendance: { today: vi.fn() },
  leave: { myBalances: vi.fn() },
  learning: { get: vi.fn() },
  goals: { list: vi.fn() },
  reviews: { mine: vi.fn() },
  requisitions: { list: vi.fn() },
  interviews: { mine: vi.fn() },
}));

vi.mock("../../services/delegation", () => ({ delegationService: delegation, default: delegation }));

vi.mock("../../services/checklist", () => ({ checklistApi: checklist, default: checklist }));

vi.mock("../../services/scoreboard", () => ({ scoreboardApi: scoreboard, default: scoreboard }));

vi.mock("../../services/activity", () => ({ activityService: activity, default: activity }));

vi.mock("../../services/o2d/orders", () => ({ o2dApi: o2d }));

vi.mock("../../services/hrms/dashboard", async (orig) => ({ ...(await orig()), dashboardApi: hrmsDashboard }));

vi.mock("../../services/hrms/inbox", async (orig) => ({ ...(await orig()), inboxApi: inbox }));

vi.mock("../../services/hrms/attendance", async (orig) => ({ ...(await orig()), attendanceApi: attendance }));

vi.mock("../../services/hrms/leave", async (orig) => ({ ...(await orig()), leaveApi: leave }));

vi.mock("../../services/hrms/academy", async (orig) => ({ ...(await orig()), myLearningApi: learning }));

vi.mock("../../services/hrms/performance", async (orig) => ({ ...(await orig()), goalsApi: goals, reviewsApi: reviews }));

vi.mock("../../services/hrms/hiring", async (orig) => ({
  ...(await orig()),
  requisitionsApi: requisitions,
  interviewsApi: interviews,
}));

import { useUserStore } from "../../store/userStore";
import { useHrmsStore } from "../../store/hrmsStore";
import { buildHrmsActor } from "@shared/permissions/has-permission.js";
import { HRMS_ROLES as R, HRMS_MODULES as M } from "@shared/permissions/constants.js";
import { HomeDashboard } from "./HomeDashboard";
import { HomeRoute } from "../../components/layout/HomeRoute";
import { myWorkMetrics, buildAttention, rankAttention, visibleSources, attendanceStatus } from "./homeSources";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const NOW = new Date("2026-10-07T10:00:00+05:30");
const ME = "u1";

/** A Work Queue task in the shape GET /delegation returns. */
const task = (over = {}) => ({
  _id: `t${Math.random().toString(36).slice(2, 8)}`,
  taskTitle: "A task",
  doerId: ME,
  assignerId: "boss",
  status: "Pending",
  dueDate: new Date(NOW.getTime() + 3 * DAY).toISOString(),
  ...over,
});

const WQ_TASKS = [{ module: "work_queue", submodule: "tasks", actions: ["view", "create"] }];

const ALL_HRMS_MODULES = [
  M.DASHBOARD, M.INBOX, M.ATTENDANCE, M.LEAVE, M.ACADEMY, M.PERFORMANCE, M.HIRING, M.EMPLOYEES, M.ENGAGE,
];

function signIn({ role = "Billing", permissions = [], grants = [], hrmsRoles = null, employeeId = "e1" } = {}) {
  useUserStore.setState({
    user: { _id: ME, user: "Asha Verma", email: "asha@example.com", role, permissions, grants },
    loading: false,
    error: null,
  });
  useHrmsStore.setState({
    actor: hrmsRoles
      ? buildHrmsActor({ userId: ME, roles: hrmsRoles, employee: employeeId ? { id: employeeId } : null })
      : null,
    implementedModules: hrmsRoles ? ALL_HRMS_MODULES : [],
    loaded: true,
    loading: false,
    error: null,
  });
}

function stubAll() {
  delegation.getDelegations.mockImplementation(async (params) =>
    params?.myWork
      ? [
          task({ taskTitle: "File GST return", dueDate: new Date(NOW.getTime() - 2 * DAY).toISOString() }),
          task({ taskTitle: "Call supplier" }),
        ]
      : [task({ status: "Awaiting Verification", doerId: "someone", assignerId: ME })],
  );
  checklist.getSummary.mockResolvedValue({ total: 10, pendingToday: 2, overdue: 0, completed: 7, complianceRate: 88, complianceBase: 8 });
  scoreboard.getScoreboard.mockResolvedValue({
    rows: [
      { userId: "a", doer: "Ravi", hasWork: true, finalScore: 90, rank: 1 },
      { userId: "b", doer: "Meera", hasWork: true, finalScore: 70, rank: 2 },
    ],
    top: [{ userId: "a", doer: "Ravi", hasWork: true, finalScore: 90, rank: 1 }],
    activeDoers: 2,
    totalDoers: 3,
  });
  activity.getActivities.mockResolvedValue([
    { id: "x1", title: "Task completed", createdAt: NOW.toISOString(), user: { firstName: "Ravi", lastName: "K" } },
  ]);
  o2d.taskCounts.mockResolvedValue({ total: 4, overdue: 3, dueSoon: 1, onTrack: 0, actionable: 2, completed: 9 });
  o2d.analyticsSummary.mockResolvedValue({ open: 12, onHold: 1, overdueStages: 5, dispatched: 40, exits: 0, total: 53 });
  o2d.slaCompliance.mockResolvedValue({ onTimePercentage: 91.5 });

  hrmsDashboard.widgets.mockResolvedValue({
    viewer: { firstName: "Asha" },
    quickAccess: [{ key: "applyLeave", label: "Apply for Leave", icon: "CalendarDays", path: "/leave/me", tone: "success" }],
    announcements: [{ id: "a1", title: "Office closed Friday", publishedAt: NOW.toISOString(), createdByName: "HR" }],
    upcomingHolidays: [],
    birthdays: [],
    anniversaries: [],
    scope: { team: false, org: false, audit: false },
  });
  hrmsDashboard.summary.mockResolvedValue({ role: "self" });
  inbox.list.mockImplementation(async (params) =>
    params?.category === "action"
      ? { data: [], total: 1, unread: 2 }
      : { data: [{ id: "n1", title: "Leave approved", typeLabel: "Leave", href: "/hrms/leave/me", createdAt: NOW.toISOString() }], total: 2, unread: 2 },
  );
  attendance.today.mockResolvedValue(null);
  leave.myBalances.mockResolvedValue([{ leaveTypeId: "l1", code: "CL", leaveTypeName: "Casual Leave", balance: 4.5 }]);
  learning.get.mockResolvedValue({
    summary: { assigned: 2, notStarted: 1, inProgress: 1, completed: 3, overdue: 1, dueSoon: 0 },
    assignments: [],
    continue: { id: "as1", pathName: "POSH Awareness", percent: 40 },
  });
  goals.list.mockResolvedValue({ data: [{ id: "g1", status: "at_risk" }, { id: "g2", status: "achieved" }], total: 2 });
  reviews.mine.mockResolvedValue({ data: [], total: 1 });
  requisitions.list.mockResolvedValue({ data: [], total: 3 });
  interviews.mine.mockResolvedValue({ data: [], total: 0 });
}

const renderAt = (element) =>
  render(
    <MemoryRouter>
      <Suspense fallback={<div>loading page</div>}>{element}</Suspense>
    </MemoryRouter>,
  );

const hrmsCalls = () =>
  [hrmsDashboard.widgets, hrmsDashboard.summary, inbox.list, attendance.today, leave.myBalances, learning.get, goals.list, requisitions.list]
    .reduce((n, fn) => n + fn.mock.calls.length, 0);

beforeEach(() => {
  vi.clearAllMocks();
  stubAll();
});

// ===========================================================================
// Pure rules
// ===========================================================================

describe("myWorkMetrics", () => {
  it("counts only the viewer's own open tasks, using the shared overdue rule", () => {
    const m = myWorkMetrics(
      {
        mine: [
          task({ dueDate: new Date(NOW.getTime() - DAY).toISOString() }), // overdue
          task({ dueDate: NOW.toISOString() }), // due today, not yet late
          task({ status: "Completed", dueDate: new Date(NOW.getTime() - DAY).toISOString() }),
          task({ status: "Awaiting Verification" }),
          task({ doerId: "someone-else" }), // I am only in the loop
          task({ scheduleTbd: true, dueDate: new Date(NOW.getTime() - DAY).toISOString() }), // locked O2D placeholder
        ],
        toVerify: [task({ status: "Awaiting Verification", doerId: "x" })],
      },
      ME,
      NOW.getTime(),
    );

    expect(m.open).toBe(3);
    expect(m.overdue).toBe(1);
    expect(m.dueToday).toBe(1);
    expect(m.toVerify).toBe(1);
    // Late first.
    expect(m.upNext[0].overdue).toBe(true);
  });

  it("reads a populated doer as well as a bare id", () => {
    const m = myWorkMetrics({ mine: [task({ doerId: { _id: ME } })] }, ME, NOW.getTime());
    expect(m.open).toBe(1);
  });
});

describe("attention", () => {
  it("ranks danger before warning before info, and bigger piles first", () => {
    const ranked = rankAttention([
      { key: "a", severity: "warning", count: 9 },
      { key: "b", severity: "info", count: 1 },
      { key: "c", severity: "danger", count: 1 },
      { key: "d", severity: "danger", count: 4 },
    ]);
    expect(ranked.map((i) => i.key)).toEqual(["d", "c", "a", "b"]);
  });

  it("never lists a zero, and ignores sources that are loading or failed", () => {
    const items = buildAttention(
      {
        checklist: { status: "ready", data: { overdue: 0, pendingToday: 0 } },
        o2dTasks: { status: "error", error: new Error("boom") },
        myWork: { status: "loading" },
      },
      { userId: ME },
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("does not nag about clocking in on a Sunday", () => {
    const sunday = new Date("2026-10-11T10:00:00+05:30");
    const state = { attendance: { status: "ready", data: { today: null, canClock: true } } };
    expect(buildAttention(state, { userId: ME }, sunday)).toEqual([]);
    expect(buildAttention(state, { userId: ME }, NOW).map((i) => i.key)).toEqual(["att-clock"]);
  });

  it("reads a null punch as 'not clocked in', not as a failure", () => {
    expect(attendanceStatus({ today: null }).label).toBe("Not clocked in");
  });
});

describe("visibleSources", () => {
  const ctxFor = ({ grants = [], permissions = [], hrms = () => false, uses = () => false, employeeId = null }) => ({
    userId: ME,
    can: (m, s, a) => grants.some((g) => g.module === m && g.submodule === s && g.actions.includes(a)),
    has: (k) => permissions.includes(k),
    hrms: { can: hrms, uses, employeeId },
  });

  it("asks each Work Queue sub-module for its own cell", () => {
    const keys = visibleSources(ctxFor({ grants: WQ_TASKS })).map((s) => s.key);
    expect(keys).toEqual(["myWork"]);
  });

  it("keeps order-level FMS figures behind the analytics permission", () => {
    expect(visibleSources(ctxFor({ permissions: ["view_o2d"] })).map((s) => s.key)).toEqual(["o2dTasks"]);
    expect(
      visibleSources(ctxFor({ permissions: ["view_o2d", "view_o2d_analytics"] })).map((s) => s.key),
    ).toEqual(["o2dTasks", "o2dOrders"]);
  });

  it("offers no HRMS source for a module that is permitted but not built", () => {
    const keys = visibleSources(ctxFor({ hrms: () => true, uses: () => false, employeeId: "e1" })).map((s) => s.key);
    expect(keys).toEqual([]);
  });
});

// ===========================================================================
// The page, per kind of account
// ===========================================================================

describe("an FMS + Work Queue account with no HRMS role (e.g. Billing)", () => {
  beforeEach(() => signIn({ permissions: ["view_o2d", "create_o2d_order"], grants: WQ_TASKS }));

  it("gets a dashboard of its own modules and never calls HRMS", async () => {
    renderAt(<HomeDashboard />);

    expect(await screen.findByRole("heading", { name: "My Work" })).toBeTruthy();
    expect(screen.getByText("FMS · My Order Stages")).toBeTruthy();
    expect(screen.queryByText("Workforce")).toBeNull();
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.queryByText("FMS · Order Pipeline")).toBeNull();
    expect(hrmsCalls()).toBe(0);
    expect(o2d.analyticsSummary).not.toHaveBeenCalled();
    expect(checklist.getSummary).not.toHaveBeenCalled();
  });

  it("puts overdue work at the top of Needs your attention", async () => {
    renderAt(<HomeDashboard />);

    const items = await screen.findAllByRole("link", { name: /Overdue order stages|Overdue tasks|awaiting your verification/ });
    const labels = items.map((a) => a.textContent);
    expect(labels[0]).toMatch(/Overdue order stages/); // 3 overdue beats 1
    expect(labels[1]).toMatch(/Overdue tasks/);
    expect(labels[2]).toMatch(/awaiting your verification/);
  });

  it("offers only the quick actions its permissions allow", async () => {
    renderAt(<HomeDashboard />);
    const actions = await screen.findByRole("region", { name: "Quick actions" });
    expect(within(actions).getByText("Assign Task")).toBeTruthy();
    expect(within(actions).getByText("New Order")).toBeTruthy();
    expect(within(actions).queryByText("Manage Users")).toBeNull();
    expect(within(actions).queryByText("Apply for Leave")).toBeNull();
  });
});

describe("an HRMS employee with no Work Queue or FMS grant", () => {
  beforeEach(() => signIn({ role: "HR", hrmsRoles: [R.EMPLOYEE] }));

  it("sees their own HR day and nothing from the Work Queue or FMS", async () => {
    renderAt(<HomeDashboard />);

    expect(await screen.findByText("Hi, Asha")).toBeTruthy();
    expect(await screen.findByText("Casual Leave")).toBeTruthy();
    expect(await screen.findByText("POSH Awareness")).toBeTruthy();
    expect(screen.getByText("Learning")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "My Work" })).toBeNull();
    expect(delegation.getDelegations).not.toHaveBeenCalled();
    expect(o2d.taskCounts).not.toHaveBeenCalled();
    // An employee is not a recruiter: hiring's routes have no self scope.
    expect(requisitions.list).not.toHaveBeenCalled();
    expect(screen.queryByText("Recruitment")).toBeNull();
  });

  it("uses the HRMS quick access the server filtered", async () => {
    renderAt(<HomeDashboard />);
    const actions = await screen.findByRole("region", { name: "Quick actions" });
    expect(await within(actions).findByText("Apply for Leave")).toBeTruthy();
    expect(within(actions).queryByText("Assign Task")).toBeNull();
  });

  it("flags overdue learning and an unclocked day", async () => {
    renderAt(<HomeDashboard />);
    expect(await screen.findByText("Overdue learning")).toBeTruthy();
    expect(await screen.findByText("You haven't clocked in today")).toBeTruthy();
  });
});

describe("an executive (Super Admin, HRMS super admin)", () => {
  beforeEach(() =>
    signIn({ role: "Super Admin", permissions: ["*"], grants: [], hrmsRoles: [R.SUPER_ADMIN] }),
  );

  it("sees the order pipeline, the scoreboard and the workforce", async () => {
    hrmsDashboard.summary.mockResolvedValue({
      role: "org",
      kpis: [{ key: "total", label: "Total headcount", value: 128, tone: "neutral", href: "/employees" }],
      pendingActions: [{ key: "leave", label: "Leave requests", value: 3, tone: "warning", href: "/leave/approvals" }],
    });

    renderAt(<HomeDashboard />);

    expect(await screen.findByText("FMS · Order Pipeline")).toBeTruthy();
    expect(await screen.findByText("91.5%")).toBeTruthy();
    expect(screen.getByText("Team Scoreboard · This Week")).toBeTruthy();
    expect(await screen.findByText("Total headcount")).toBeTruthy();
    expect(await screen.findByText("Leave requests to review")).toBeTruthy();
    expect(screen.getByText("Recruitment")).toBeTruthy();
    expect(await screen.findByText("Task completed")).toBeTruthy();
  });

  it("keeps the rest of the page when one module fails", async () => {
    o2d.taskCounts.mockRejectedValue(new Error("FMS down"));
    renderAt(<HomeDashboard />);

    expect(await screen.findByText("Couldn't load this right now.")).toBeTruthy();
    expect(await screen.findByText("POSH Awareness")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My Work" })).toBeTruthy();
  });
});

describe("the route at /", () => {
  it("shows the dashboard to an account with no HRMS role but other modules", async () => {
    signIn({ permissions: ["view_o2d"], grants: [] });
    renderAt(<HomeRoute />);
    expect(await screen.findByText("FMS · My Order Stages")).toBeTruthy();
    expect(screen.queryByText("No Employee Portal access")).toBeNull();
  });

  it("still says so plainly when an account has nothing at all", async () => {
    signIn({ permissions: [], grants: [] });
    renderAt(<HomeRoute />);
    expect(await screen.findByText("No Employee Portal access")).toBeTruthy();
    expect(delegation.getDelegations).not.toHaveBeenCalled();
  });
});
