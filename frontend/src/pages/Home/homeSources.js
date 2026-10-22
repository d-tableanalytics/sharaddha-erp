import { delegationService } from "../../services/delegation";
import { checklistApi } from "../../services/checklist";
import { scoreboardApi } from "../../services/scoreboard";
import { activityService } from "../../services/activity";
import { o2dApi } from "../../services/o2d/orders";
import { dashboardApi } from "../../services/hrms/dashboard";
import { inboxApi } from "../../services/hrms/inbox";
import { attendanceApi } from "../../services/hrms/attendance";
import { leaveApi } from "../../services/hrms/leave";
import { myLearningApi } from "../../services/hrms/academy";
import { goalsApi, reviewsApi } from "../../services/hrms/performance";
import { requisitionsApi, interviewsApi } from "../../services/hrms/hiring";
import { isTaskOverdue } from "../Delegation/taskOverdue";
import { PERMISSIONS } from "../../utils/permissions";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import {
  HRMS_MODULES as M,
  HRMS_ACTIONS as A,
  SCOPES as S,
} from "@shared/permissions/constants.js";

/**
 * Where the home dashboard's numbers come from, and who may see each one.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE IS A NEW SOURCE OF TRUTH
 * ---------------------------------------------------------------------------
 * Every source calls an endpoint a module screen already calls, and asks the
 * permission question that screen's route and sidebar row already ask:
 *
 *   Work Queue   canAction(user, 'work_queue', <sub-module>, 'view')  — the
 *                same cell ModuleProtectedRoute and the rail check
 *   FMS / O2D    view_o2d, and view_o2d_analytics for the order-level figures
 *   HRMS         the shared evaluator (`useHrmsPermissions`), with the exact
 *                module/action/scope the endpoint's requirePermission demands,
 *                AND `usesModule` so a half-built module never appears
 *
 * So a card is on the page exactly when its endpoint will answer, and the
 * server still re-checks every request — hiding a card is presentation, not
 * access control. Each endpoint also scopes its own rows (my tasks, my team,
 * the whole org) server-side; nothing here filters for authorization.
 *
 * ---------------------------------------------------------------------------
 * SHAPE
 * ---------------------------------------------------------------------------
 * A source is `{ key, visible(ctx), load(ctx) }`. What a response MEANS lives
 * in the pure `*Metrics` / `*Attention` functions below, so they can be tested
 * without rendering anything.
 *
 * `ctx` is built once by the page:
 *   { userId, can(m, s, a), has(key), hrms: { can(m, a, s), uses(m), employeeId } }
 */

const H = HRMS_ROUTE_PREFIX;

/** May this viewer use this HRMS module AND pass this endpoint's guard? */
const hrmsAllows = (ctx, module, action, scope) =>
  ctx.hrms.uses(module) && ctx.hrms.can(module, action, scope);

const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const idOf = (v) => (v && typeof v === "object" ? v._id ?? v.id : v);

/** Statuses that are no longer the doer's to act on. Mirrors taskOverdue.js. */
const CLOSED_TASK = ["Completed", "Awaiting Verification", "Reassigned"];

// ===========================================================================
// Sources
// ===========================================================================

export const HOME_SOURCES = [
  // ── Work Queue ────────────────────────────────────────────────────────────
  {
    key: "myWork",
    visible: (ctx) => ctx.can("work_queue", "tasks", "view"),
    load: async () => {
      // The same two reads My Work and Delegation make: my own queue, and the
      // tasks I assigned that are waiting for me to verify them (the default,
      // assigner-scoped list).
      const [mine, toVerify] = await Promise.all([
        delegationService.getDelegations({ myWork: "true" }),
        delegationService.getDelegations({ status: "Awaiting Verification" }),
      ]);
      return { mine: mine ?? [], toVerify: toVerify ?? [] };
    },
  },
  {
    key: "checklist",
    visible: (ctx) => ctx.can("work_queue", "checklist", "view"),
    load: () => checklistApi.getSummary(),
  },
  {
    key: "scoreboard",
    visible: (ctx) => ctx.can("work_queue", "scoreboard", "view"),
    load: () => scoreboardApi.getScoreboard({ period: "week" }),
  },
  {
    key: "activity",
    visible: (ctx) => ctx.can("work_queue", "activity", "view"),
    load: () => activityService.getActivities({ limit: 6 }),
  },

  // ── FMS / O2D ─────────────────────────────────────────────────────────────
  {
    key: "o2dTasks",
    visible: (ctx) => ctx.has(PERMISSIONS.VIEW_O2D),
    load: () => o2dApi.taskCounts(),
  },
  {
    key: "o2dOrders",
    visible: (ctx) => ctx.has(PERMISSIONS.VIEW_O2D_ANALYTICS),
    load: async () => {
      const [summary, sla] = await Promise.all([o2dApi.analyticsSummary(), o2dApi.slaCompliance()]);
      return { summary: summary ?? {}, onTimePercentage: sla?.onTimePercentage ?? null };
    },
  },

  // ── HRMS ──────────────────────────────────────────────────────────────────
  {
    // Holidays, announcements, celebrations and the server-filtered quick
    // access catalogue — the HR Dashboard's own aggregation, reused whole.
    key: "hrmsWidgets",
    visible: (ctx) => hrmsAllows(ctx, M.DASHBOARD, A.VIEW, S.SELF),
    load: () => dashboardApi.widgets(),
  },
  {
    // Role-shaped on the server: workforce KPIs for org scope, the team block
    // for a manager, nothing for an individual.
    key: "hrmsSummary",
    visible: (ctx) => hrmsAllows(ctx, M.DASHBOARD, A.VIEW, S.SELF),
    load: () => dashboardApi.summary(),
  },
  {
    key: "inbox",
    // Every query is keyed by the caller's employee record; without one the
    // inbox is empty by definition.
    visible: (ctx) => hrmsAllows(ctx, M.INBOX, A.VIEW, S.SELF) && Boolean(ctx.hrms.employeeId),
    load: async () => {
      const [recent, action] = await Promise.all([
        inboxApi.list({ state: "unread", pageSize: 5 }),
        inboxApi.list({ state: "unread", category: "action", pageSize: 1 }),
      ]);
      return {
        items: recent?.data ?? [],
        unread: recent?.unread ?? 0,
        actionUnread: action?.total ?? 0,
      };
    },
  },
  {
    key: "attendance",
    visible: (ctx) => hrmsAllows(ctx, M.ATTENDANCE, A.VIEW, S.SELF) && Boolean(ctx.hrms.employeeId),
    load: async (ctx) => ({
      today: await attendanceApi.today(),
      canClock: ctx.hrms.can(M.ATTENDANCE, A.SUBMIT, S.SELF),
    }),
  },
  {
    key: "leave",
    // The endpoint 403s an account with no employee record.
    visible: (ctx) => hrmsAllows(ctx, M.LEAVE, A.VIEW, S.SELF) && Boolean(ctx.hrms.employeeId),
    load: () => leaveApi.myBalances(),
  },
  {
    key: "learning",
    visible: (ctx) => hrmsAllows(ctx, M.ACADEMY, A.VIEW, S.SELF) && Boolean(ctx.hrms.employeeId),
    load: () => myLearningApi.get(),
  },
  {
    key: "performance",
    visible: (ctx) => hrmsAllows(ctx, M.PERFORMANCE, A.VIEW, S.SELF) && Boolean(ctx.hrms.employeeId),
    load: async (ctx) => {
      const [goals, reviews] = await Promise.all([
        // `employeeId` narrows a manager's team-wide list to their OWN goals.
        goalsApi.list({ employeeId: ctx.hrms.employeeId, pageSize: 100 }),
        reviewsApi.mine({ submitted: "false", pageSize: 1 }),
      ]);
      return { goals: goals?.data ?? [], reviewsPending: reviews?.total ?? 0 };
    },
  },
  {
    key: "hiring",
    // Hiring has no self scope: team is the narrowest grant its routes accept.
    visible: (ctx) => hrmsAllows(ctx, M.HIRING, A.VIEW, S.TEAM),
    load: async () => {
      const [open, interviews] = await Promise.all([
        requisitionsApi.list({ status: "open", pageSize: 1 }),
        interviewsApi.mine({ pageSize: 50 }),
      ]);
      return { openRequisitions: open?.total ?? 0, interviews: interviews?.data ?? [] };
    },
  },
];

/** The sources this viewer may see — and therefore the only ones ever requested. */
export const visibleSources = (ctx) => HOME_SOURCES.filter((s) => s.visible(ctx));

// ===========================================================================
// Work Queue
// ===========================================================================

const startOfLocalDay = (now) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
};

const isSameLocalDay = (value, now) => {
  if (!value) return false;
  const d = new Date(value);
  const today = startOfLocalDay(now);
  return d >= today && d.getTime() < today.getTime() + 86_400_000;
};

/**
 * My open delegated work, bucketed the way My Work buckets it.
 *
 * "Overdue" is `isTaskOverdue`, the one rule every Delegation view shares, so
 * the home page cannot call a task late that the task list does not.
 */
export function myWorkMetrics(data, userId, now = Date.now()) {
  const mine = (data?.mine ?? []).filter((t) => sameId(idOf(t.doerId ?? t.doer), userId));
  const open = mine.filter((t) => !CLOSED_TASK.includes(t.status));
  const overdue = open.filter((t) => isTaskOverdue(t, now));
  const dueToday = open.filter(
    (t) => !isTaskOverdue(t, now) && !t.scheduleTbd && isSameLocalDay(t.dueDate, now),
  );
  const toVerify = (data?.toVerify ?? []).filter((t) => t.status === "Awaiting Verification");

  // Late first, then soonest; undated work last.
  const rank = (t) => (isTaskOverdue(t, now) ? 0 : 1);
  const dueTime = (t) => (t.dueDate && !t.scheduleTbd ? new Date(t.dueDate).getTime() : Infinity);
  const upNext = [...open]
    .sort((a, b) => rank(a) - rank(b) || dueTime(a) - dueTime(b))
    .slice(0, 5)
    .map((t) => ({
      id: String(t._id ?? t.id),
      title: t.taskTitle || t.taskName || "Untitled task",
      dueDate: t.scheduleTbd ? null : t.dueDate ?? null,
      overdue: isTaskOverdue(t, now),
      priority: t.priority ?? null,
      status: t.status,
    }));

  return {
    open: open.length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    toVerify: toVerify.length,
    upNext,
  };
}

/** Average this week's final score over the people who actually had work. */
export function scoreboardMetrics(data) {
  const scored = (data?.rows ?? []).filter((r) => r.hasWork && r.finalScore !== null && r.finalScore !== undefined);
  const average = scored.length
    ? Math.round(scored.reduce((sum, r) => sum + r.finalScore, 0) / scored.length)
    : null;
  return {
    average,
    activeDoers: data?.activeDoers ?? 0,
    totalDoers: data?.totalDoers ?? 0,
    top: (data?.top ?? []).slice(0, 3).map((r) => ({
      userId: String(r.userId),
      name: r.doer,
      score: r.finalScore,
      rank: r.rank,
    })),
  };
}

// ===========================================================================
// HRMS
// ===========================================================================

/** Own goals that are still live, and the ones flagged at risk. */
export function performanceMetrics(data) {
  const live = (data?.goals ?? []).filter((g) => ["open", "in_progress", "at_risk"].includes(g.status));
  return {
    activeGoals: live.length,
    atRisk: live.filter((g) => g.status === "at_risk").length,
    reviewsPending: data?.reviewsPending ?? 0,
  };
}

export function hiringMetrics(data, now = Date.now()) {
  const interviews = data?.interviews ?? [];
  return {
    openRequisitions: data?.openRequisitions ?? 0,
    upcomingInterviews: interviews.filter(
      (i) => i.status === "scheduled" && new Date(i.scheduledAt).getTime() >= now,
    ).length,
    feedbackDue: interviews.filter((i) => i.awaitingMyFeedback).length,
  };
}

/**
 * Today's punch, as one line.
 *
 * `null` from the API is a real answer — no punch yet today — not a failure.
 */
export function attendanceStatus(data) {
  const today = data?.today ?? null;
  if (!today) return { clockedIn: false, label: "Not clocked in", tone: "warning", clockIn: null, hours: null };
  return {
    clockedIn: true,
    clockedOut: Boolean(today.clockOut),
    label: today.derived?.label ?? (today.clockOut ? "Clocked out" : "Clocked in"),
    tone: today.derived?.tone ?? "neutral",
    clockIn: today.clockIn ?? null,
    hours: today.hoursWorked ?? today.derived?.hoursWorked ?? null,
  };
}

/** A local `YYYY-MM-DD`, never `toISOString()` — that is UTC's day, not ours. */
export function localDay(now = new Date()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ===========================================================================
// Needs your attention
// ===========================================================================

const SEVERITY_RANK = { danger: 0, warning: 1, info: 2 };

/** Most urgent first; within a severity, the bigger pile first. */
export const rankAttention = (items) =>
  [...items].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      (b.count ?? 0) - (a.count ?? 0),
  );

/**
 * Everything waiting on this person, from every source that has loaded.
 *
 * A source that is still loading, failed, or was never visible contributes
 * nothing, and a zero is never an item — "0 overdue tasks" is not something to
 * attend to.
 */
export function buildAttention(state, ctx, now = new Date()) {
  const ready = (key) => (state[key]?.status === "ready" ? state[key].data : undefined);
  const items = [];
  const add = (count, item) => {
    if (count > 0) items.push({ ...item, count });
  };

  const work = ready("myWork");
  if (work) {
    const m = myWorkMetrics(work, ctx.userId, now.getTime());
    add(m.overdue, { key: "wq-overdue", label: "Overdue tasks", module: "Work Queue · My Work", severity: "danger", to: "/work-queue" });
    add(m.dueToday, { key: "wq-today", label: "Tasks due today", module: "Work Queue · My Work", severity: "warning", to: "/work-queue" });
    add(m.toVerify, { key: "wq-verify", label: "Tasks awaiting your verification", module: "Work Queue · Delegation", severity: "warning", to: "/wq/delegation" });
  }

  const checklist = ready("checklist");
  if (checklist) {
    add(checklist.overdue ?? 0, { key: "chk-overdue", label: "Overdue checklist items", module: "Work Queue · Checklist", severity: "danger", to: "/wq/checklist" });
    add(checklist.pendingToday ?? 0, { key: "chk-today", label: "Checklist items due today", module: "Work Queue · Checklist", severity: "warning", to: "/wq/checklist" });
  }

  const o2d = ready("o2dTasks");
  if (o2d) {
    add(o2d.overdue ?? 0, { key: "o2d-overdue", label: "Overdue order stages", module: "FMS · O2D", severity: "danger", to: "/fms/o2d/tasks" });
    add(o2d.dueSoon ?? 0, { key: "o2d-soon", label: "Order stages due soon", module: "FMS · O2D", severity: "warning", to: "/fms/o2d/tasks" });
  }

  // The HRMS queues the server already counted for this viewer's scope.
  for (const a of ready("hrmsSummary")?.pendingActions ?? []) {
    add(a.value ?? 0, { key: `hrms-${a.key}`, label: `${a.label} to review`, module: "HRMS", severity: "warning", to: `${H}${a.href}` });
  }

  const inbox = ready("inbox");
  if (inbox) {
    add(inbox.actionUnread, {
      key: "inbox-action",
      label: "Inbox items needing your action",
      module: "HRMS · Inbox",
      severity: "warning",
      to: `${H}/inbox?state=unread&category=action`,
    });
  }

  const learning = ready("learning")?.summary;
  if (learning) {
    add(learning.overdue ?? 0, { key: "learn-overdue", label: "Overdue learning", module: "SI Academy", severity: "danger", to: `${H}/academy` });
    add(learning.dueSoon ?? 0, { key: "learn-soon", label: "Learning due soon", module: "SI Academy", severity: "warning", to: `${H}/academy` });
  }

  const perf = ready("performance");
  if (perf) {
    add(perf.reviewsPending, { key: "perf-reviews", label: "Performance reviews to write", module: "Performance", severity: "warning", to: `${H}/performance/reviews` });
  }

  const hiring = ready("hiring");
  if (hiring) {
    add(hiringMetrics(hiring, now.getTime()).feedbackDue, { key: "hire-feedback", label: "Interview feedback due", module: "Recruitment", severity: "warning", to: `${H}/hiring/interviews` });
  }

  // Not clocked in — only on a day that is plausibly a working day: not a
  // Sunday, and not one of the holidays the HR Dashboard already lists.
  const attendance = ready("attendance");
  if (attendance?.canClock && !attendance.today) {
    const today = localDay(now);
    const holiday = (ready("hrmsWidgets")?.upcomingHolidays ?? []).some(
      (h) => String(h.date).slice(0, 10) === today && !h.isOptional,
    );
    if (now.getDay() !== 0 && !holiday) {
      items.push({ key: "att-clock", label: "You haven't clocked in today", module: "Attendance", severity: "info", to: `${H}/attendance/me` });
    }
  }

  return rankAttention(items);
}
