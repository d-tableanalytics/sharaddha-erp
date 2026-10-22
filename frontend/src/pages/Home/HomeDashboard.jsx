import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  ClipboardCheck,
  Clock,
  GraduationCap,
  ListTodo,
  Megaphone,
  Palmtree,
  PartyPopper,
  RefreshCw,
  Sparkles,
  Target,
  Trophy,
  Truck,
  Users,
} from "lucide-react";

import { SectionTitle, WidgetCard, PersonRow } from "../../components/hrms/dashboard/DashboardPieces";
import { Badge } from "../../components/ui/Badge";
import {
  greetingFor,
  formatHeroDate,
  formatClock,
  formatShortDay,
  formatDaysUntil,
} from "../../services/hrms/dashboard";
import { formatInboxTime } from "../../services/hrms/inbox";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import { useHomeSources, useHomeContext } from "./useHomeSources";
import {
  visibleSources,
  buildAttention,
  myWorkMetrics,
  scoreboardMetrics,
  performanceMetrics,
  hiringMetrics,
  attendanceStatus,
} from "./homeSources";
import { ModuleCard, AttentionList, QuickAction, CardError } from "./homePieces";
import { quickActionsFor } from "./quickActions";

const H = HRMS_ROUTE_PREFIX;

/** How many quick actions show before "More". One row on a laptop. */
const QUICK_ACTION_FOLD = 8;

/**
 * The Employee Portal's home — the page every account opens on after sign-in.
 *
 * ---------------------------------------------------------------------------
 * ONE PAGE, SHAPED BY WHAT THE VIEWER MAY OPEN
 * ---------------------------------------------------------------------------
 * The portal is three systems behind one rail — HRMS, FMS (O2D) and the Work
 * Queue — each with its own permission model. This page asks each of them the
 * same question its own route asks (see homeSources.js), requests ONLY the
 * sources that answer yes, and renders a card only for those. Two accounts
 * therefore see different pages without a single role-name comparison here.
 *
 * ---------------------------------------------------------------------------
 * PRIORITY ORDER
 * ---------------------------------------------------------------------------
 *   1. Greeting, and the quick actions this person can take
 *   2. Needs your attention — every overdue or waiting item, all modules,
 *      most urgent first — beside Today (attendance and leave)
 *   3. At a glance — one KPI card per module
 *   4. Up next, notifications / activity, and company news
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS DUPLICATED
 * ---------------------------------------------------------------------------
 * Every number comes from an endpoint a module screen already uses, and every
 * card links to that screen. The HR Dashboard (/hrms/dashboard) stays as the
 * deep HR view; this page shows its headline figures and links to it.
 */
export function HomeDashboard() {
  const { user, ctx } = useHomeContext();
  const { userId } = ctx;

  const sources = useMemo(() => visibleSources(ctx), [ctx]);
  const visible = useMemo(() => new Set(sources.map((s) => s.key)), [sources]);
  const { state, reload, retry, refreshing } = useHomeSources(sources, ctx);

  const statusOf = (key) => state[key]?.status ?? "loading";
  const dataOf = (key) => (state[key]?.status === "ready" ? state[key].data : undefined);

  // The clock in the hero ticks, because it says the time.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const widgets = dataOf("hrmsWidgets");
  const attention = useMemo(() => buildAttention(state, ctx, now), [state, ctx, now]);
  const attentionLoading = sources.some((s) => statusOf(s.key) === "loading");
  const quickActions = useMemo(() => quickActionsFor(user, ctx, widgets), [user, ctx, widgets]);

  const firstName = widgets?.viewer?.firstName || String(user?.user || user?.name || "").trim().split(/\s+/)[0] || "";
  const showToday = visible.has("attendance") || visible.has("leave");

  return (
    <div className="flex flex-col gap-6 max-w-[1500px] mx-auto">
      {/* ── Hero ─────────────────────────────────────────────────────────
          The sidebar's own gradient stops, as the HR Dashboard's hero uses,
          so the banner beside the rail reads as one brand colour. */}
      <section className="relative overflow-hidden rounded-2xl px-5 py-5 sm:px-8 sm:py-6 bg-gradient-to-br from-slate-800 via-primary-900 to-slate-900 text-white shadow-enterprise">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <span className="shrink-0 inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white/15 border-2 border-white/25 text-xl font-bold">
              {(firstName || "?").charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/80">
                {greetingFor(now.getHours())}
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold leading-tight truncate">
                {firstName ? `Hi, ${firstName}` : "Welcome back"}
              </h1>
              <p className="text-[12.5px] text-white/85 mt-1">
                {formatHeroDate(now)} · {formatClock(now)}
                {user?.role && <span className="text-white/60"> · {user.role}</span>}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={reload}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-[12px] font-bold hover:bg-white/15 disabled:opacity-60 transition-colors"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </section>

      {/* ── Quick actions ─────────────────────────────────────────────── */}
      {quickActions.length > 0 && <QuickActions actions={quickActions} />}

      {/* ── Needs your attention + Today ─────────────────────────────── */}
      <div className={`grid grid-cols-1 gap-4 ${showToday ? "lg:grid-cols-3" : ""}`}>
        <WidgetCard
          title={attention.length > 0 ? `Needs your attention (${attention.length})` : "Needs your attention"}
          icon={Bell}
          className={showToday ? "lg:col-span-2" : ""}
        >
          <AttentionList items={attention} loading={attentionLoading} />
        </WidgetCard>

        {showToday && (
          <TodayCard
            attendance={visible.has("attendance") ? state.attendance ?? { status: "loading" } : null}
            leave={visible.has("leave") ? state.leave ?? { status: "loading" } : null}
            onRetry={retry}
          />
        )}
      </div>

      {/* ── At a glance ───────────────────────────────────────────────── */}
      <ModuleCards visible={visible} statusOf={statusOf} dataOf={dataOf} retry={retry} userId={userId} now={now} />

      {/* ── Up next, notifications, activity, company ────────────────── */}
      <BottomRow visible={visible} statusOf={statusOf} dataOf={dataOf} retry={retry} userId={userId} now={now} />
    </div>
  );
}

// ===========================================================================
// Quick actions
// ===========================================================================

function QuickActions({ actions }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? actions : actions.slice(0, QUICK_ACTION_FOLD);
  const hidden = actions.length - shown.length;

  return (
    <section aria-label="Quick actions">
      <SectionTitle title="Quick actions" />
      <div className="flex flex-wrap gap-2">
        {shown.map((a) => (
          <QuickAction key={a.key} action={a} />
        ))}
        {(hidden > 0 || expanded) && actions.length > QUICK_ACTION_FOLD && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center rounded-xl border border-dashed border-slate-300 px-3 py-2 text-[12.5px] font-semibold text-slate-600 hover:border-primary-300 hover:text-primary-700"
          >
            {expanded ? "Show less" : `+${hidden} more`}
          </button>
        )}
      </div>
    </section>
  );
}

// ===========================================================================
// Today
// ===========================================================================

function TodayCard({ attendance, leave, onRetry }) {
  return (
    <WidgetCard title="Today" icon={Clock}>
      <div className="flex flex-col gap-4">
        {attendance && (
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Attendance</p>
            {attendance.status === "error" ? (
              <CardError onRetry={() => onRetry("attendance")} />
            ) : attendance.status !== "ready" ? (
              <div className="h-12 rounded-lg bg-slate-50 animate-pulse" />
            ) : (
              <AttendanceLine data={attendance.data} />
            )}
          </div>
        )}

        {leave && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Leave balance</p>
              <Link to={`${H}/leave/me`} className="text-[11px] font-bold text-primary-700 hover:underline">
                Apply
              </Link>
            </div>
            {leave.status === "error" ? (
              <CardError onRetry={() => onRetry("leave")} />
            ) : leave.status !== "ready" ? (
              <div className="h-12 rounded-lg bg-slate-50 animate-pulse" />
            ) : (leave.data ?? []).length === 0 ? (
              <p className="text-[12px] text-slate-500">No leave types set up for you yet.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2">
                {(leave.data ?? []).slice(0, 4).map((b) => (
                  <li key={b.leaveTypeId ?? b.code} className="rounded-lg bg-slate-50 px-3 py-2 min-w-0">
                    <p className="text-[10.5px] font-semibold text-slate-500 truncate" title={b.leaveTypeName}>
                      {b.leaveTypeName ?? b.code}
                    </p>
                    <p className="text-lg font-bold text-slate-900 tabular-nums">
                      {Number(b.balance ?? 0).toLocaleString("en-IN")}
                      <span className="text-[10.5px] font-semibold text-slate-400"> days</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </WidgetCard>
  );
}

function AttendanceLine({ data }) {
  const s = attendanceStatus(data);
  return (
    <Link
      to={`${H}/attendance/me`}
      className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 hover:bg-primary-50 transition-colors"
    >
      <span className="flex flex-col min-w-0">
        <span className="text-[13px] font-bold text-slate-900">{s.label}</span>
        <span className="text-[11px] text-slate-500">
          {s.clockIn ? `In at ${formatClock(new Date(s.clockIn))}` : "No punch recorded today"}
          {s.hours ? ` · ${Number(s.hours).toFixed(1)} h` : ""}
        </span>
      </span>
      {data?.canClock && (
        <span className="shrink-0 rounded-lg bg-primary-600 px-2.5 py-1 text-[11px] font-bold text-white">
          {!s.clockedIn ? "Clock in" : s.clockedOut ? "View" : "Clock out"}
        </span>
      )}
    </Link>
  );
}

// ===========================================================================
// At a glance
// ===========================================================================

function ModuleCards({ visible, statusOf, dataOf, retry, userId, now }) {
  const cards = [];
  const common = (key) => ({ status: statusOf(key), onRetry: () => retry(key) });

  if (visible.has("myWork")) {
    const m = myWorkMetrics(dataOf("myWork"), userId, now.getTime());
    cards.push(
      <ModuleCard
        key="myWork"
        title="My Work"
        icon={ListTodo}
        to="/work-queue"
        {...common("myWork")}
        metrics={[
          { key: "open", label: "Open", value: m.open, to: "/work-queue" },
          { key: "overdue", label: "Overdue", value: m.overdue, tone: "danger", to: "/work-queue" },
          { key: "today", label: "Due today", value: m.dueToday, tone: "warning", to: "/work-queue" },
          { key: "verify", label: "To verify", value: m.toVerify, tone: "primary", to: "/wq/delegation" },
        ]}
      />,
    );
  }

  if (visible.has("checklist")) {
    const c = dataOf("checklist") ?? {};
    cards.push(
      <ModuleCard
        key="checklist"
        title="Checklist"
        icon={ClipboardCheck}
        to="/wq/checklist"
        {...common("checklist")}
        metrics={[
          { key: "today", label: "Due today", value: c.pendingToday ?? 0, tone: "warning" },
          { key: "overdue", label: "Overdue", value: c.overdue ?? 0, tone: "danger" },
          {
            key: "compliance",
            label: "Compliance",
            value: c.complianceBase ? c.complianceRate ?? 0 : null,
            suffix: "%",
            tone: (c.complianceRate ?? 0) >= 90 ? "success" : "warning",
            hint: c.complianceBase ? `of ${c.complianceBase} due` : "nothing due yet",
          },
        ]}
      />,
    );
  }

  if (visible.has("o2dTasks")) {
    const o = dataOf("o2dTasks") ?? {};
    cards.push(
      <ModuleCard
        key="o2dTasks"
        title="FMS · My Order Stages"
        icon={Truck}
        to="/fms/o2d/tasks"
        {...common("o2dTasks")}
        metrics={[
          { key: "open", label: "Open", value: o.total ?? 0 },
          { key: "overdue", label: "Overdue", value: o.overdue ?? 0, tone: "danger" },
          { key: "soon", label: "Due soon", value: o.dueSoon ?? 0, tone: "warning" },
        ]}
        footer={o.actionable ? `${o.actionable} of these are yours to complete` : null}
      />,
    );
  }

  if (visible.has("o2dOrders")) {
    const { summary = {}, onTimePercentage = null } = dataOf("o2dOrders") ?? {};
    cards.push(
      <ModuleCard
        key="o2dOrders"
        title="FMS · Order Pipeline"
        icon={BarChart3}
        to="/fms/o2d/analytics"
        linkLabel="Analytics"
        {...common("o2dOrders")}
        metrics={[
          { key: "open", label: "Open orders", value: summary.open ?? 0, to: "/fms/o2d/orders" },
          { key: "hold", label: "On hold", value: summary.onHold ?? 0, tone: "warning" },
          { key: "late", label: "Overdue stages", value: summary.overdueStages ?? 0, tone: "danger" },
          { key: "dispatched", label: "Dispatched", value: summary.dispatched ?? 0, tone: "success" },
          {
            key: "ontime",
            label: "On-time stages",
            value: onTimePercentage,
            suffix: "%",
            tone: onTimePercentage !== null && onTimePercentage >= 90 ? "success" : "warning",
            hint: onTimePercentage === null ? "nothing scored yet" : "all time",
          },
        ]}
      />,
    );
  }

  if (visible.has("hrmsSummary")) {
    const s = dataOf("hrmsSummary");
    if (statusOf("hrmsSummary") !== "ready" || s?.role === "org") {
      const toneOf = (t) => (t === "positive" ? "success" : t ?? "neutral");
      cards.push(
        <ModuleCard
          key="workforce"
          title="Workforce"
          icon={Users}
          to={`${H}/dashboard`}
          linkLabel="HR Dashboard"
          {...common("hrmsSummary")}
          metrics={(s?.kpis ?? []).map((k) => ({
            key: k.key,
            label: k.label,
            value: k.value,
            tone: toneOf(k.tone),
            to: `${H}${k.href}`,
          }))}
        />,
      );
    } else if (s?.role === "team" && s.team) {
      cards.push(
        <ModuleCard
          key="team"
          title="My Team"
          icon={Users}
          to={`${H}/attendance/team`}
          {...common("hrmsSummary")}
          metrics={[
            { key: "reports", label: "Direct reports", value: s.team.directReports ?? 0, to: `${H}/attendance/team` },
            { key: "leave", label: "On leave today", value: s.team.onLeaveToday ?? 0, tone: "warning", to: `${H}/leave/calendar` },
            { key: "approvals", label: "Pending approvals", value: s.team.pendingApprovals ?? 0, tone: "warning", to: `${H}/leave/approvals` },
          ]}
        />,
      );
    }
  }

  if (visible.has("learning")) {
    const l = dataOf("learning");
    const sum = l?.summary ?? {};
    const next = l?.continue;
    cards.push(
      <ModuleCard
        key="learning"
        title="Learning"
        icon={GraduationCap}
        to={`${H}/academy`}
        {...common("learning")}
        metrics={[
          { key: "progress", label: "In progress", value: sum.inProgress ?? 0, tone: "primary" },
          { key: "new", label: "Not started", value: sum.notStarted ?? 0 },
          { key: "overdue", label: "Overdue", value: sum.overdue ?? 0, tone: "danger" },
          { key: "done", label: "Completed", value: sum.completed ?? 0, tone: "success" },
        ]}
      >
        {next && (
          <Link
            to={`${H}/academy/learn/${next.id}`}
            className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-primary-100 bg-primary-50/50 px-3 py-2 hover:bg-primary-50"
          >
            <span className="min-w-0">
              <span className="block text-[10.5px] font-bold uppercase tracking-wide text-primary-700">Continue</span>
              <span className="block text-[12.5px] font-semibold text-slate-900 truncate">{next.pathName}</span>
            </span>
            <span className="shrink-0 text-[12px] font-bold text-primary-700 tabular-nums">{next.percent ?? 0}%</span>
          </Link>
        )}
      </ModuleCard>,
    );
  }

  if (visible.has("performance")) {
    const p = performanceMetrics(dataOf("performance"));
    cards.push(
      <ModuleCard
        key="performance"
        title="Performance"
        icon={Target}
        to={`${H}/performance`}
        {...common("performance")}
        metrics={[
          { key: "goals", label: "Active goals", value: p.activeGoals, to: `${H}/performance/goals` },
          { key: "risk", label: "At risk", value: p.atRisk, tone: "danger", to: `${H}/performance/goals` },
          { key: "reviews", label: "Reviews to write", value: p.reviewsPending, tone: "warning", to: `${H}/performance/reviews` },
        ]}
      />,
    );
  }

  if (visible.has("hiring")) {
    const r = hiringMetrics(dataOf("hiring"), now.getTime());
    cards.push(
      <ModuleCard
        key="hiring"
        title="Recruitment"
        icon={Briefcase}
        to={`${H}/hiring`}
        {...common("hiring")}
        metrics={[
          { key: "open", label: "Open requisitions", value: r.openRequisitions, to: `${H}/hiring/requisitions` },
          { key: "upcoming", label: "My interviews", value: r.upcomingInterviews, tone: "primary", to: `${H}/hiring/interviews`, hint: "upcoming" },
          { key: "feedback", label: "Feedback due", value: r.feedbackDue, tone: "warning", to: `${H}/hiring/interviews` },
        ]}
      />,
    );
  }

  if (visible.has("scoreboard")) {
    const s = scoreboardMetrics(dataOf("scoreboard"));
    cards.push(
      <ModuleCard
        key="scoreboard"
        title="Team Scoreboard · This Week"
        icon={Trophy}
        to="/wq/executivescoreboard"
        {...common("scoreboard")}
        metrics={[
          { key: "avg", label: "Average score", value: s.average, tone: s.average !== null && s.average >= 80 ? "success" : "warning" },
          { key: "active", label: "People with work", value: s.activeDoers, hint: `of ${s.totalDoers}` },
        ]}
      >
        {s.top.length > 0 && (
          <ol className="mt-3 flex flex-col divide-y divide-slate-100">
            {s.top.map((p) => (
              <li key={p.userId}>
                <PersonRow
                  name={p.name}
                  meta={`Rank #${p.rank}`}
                  trailing={<span className="text-[13px] font-bold text-slate-900 tabular-nums">{p.score}</span>}
                />
              </li>
            ))}
          </ol>
        )}
      </ModuleCard>,
    );
  }

  if (cards.length === 0) return null;

  return (
    <section aria-label="At a glance">
      <SectionTitle title="At a glance" subtitle="Headline numbers from every module you can open" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{cards}</div>
    </section>
  );
}

// ===========================================================================
// Bottom row
// ===========================================================================

const DUE_FORMAT = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" });

function BottomRow({ visible, statusOf, dataOf, retry, userId, now }) {
  const cards = [];

  /** A list card's body: skeleton, error, or the list. */
  const body = (key, render) => {
    const status = statusOf(key);
    if (status === "error") return <CardError onRetry={() => retry(key)} />;
    if (status !== "ready") return <div className="h-24 rounded-lg bg-slate-50 animate-pulse" />;
    return render(dataOf(key));
  };

  if (visible.has("myWork")) {
    const upNext = myWorkMetrics(dataOf("myWork"), userId, now.getTime()).upNext;
    cards.push(
      <WidgetCard
        key="upnext"
        title="Up next"
        icon={ListTodo}
        viewAllTo="/work-queue"
        isEmpty={statusOf("myWork") === "ready" && upNext.length === 0}
        emptyTitle="Nothing open"
        emptyDescription="Tasks assigned to you appear here."
      >
        {body("myWork", () => (
          <ul className="flex flex-col divide-y divide-slate-100">
            {upNext.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/wq/delegation/${t.id}`}
                  className="flex items-center justify-between gap-3 py-2 -mx-2 px-2 rounded-lg hover:bg-slate-50"
                >
                  <span className="text-[13px] font-semibold text-slate-800 truncate">{t.title}</span>
                  {t.overdue ? (
                    <Badge variant="danger">Overdue</Badge>
                  ) : (
                    <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
                      {t.dueDate ? DUE_FORMAT.format(new Date(t.dueDate)) : "No date"}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </WidgetCard>,
    );
  }

  if (visible.has("inbox")) {
    const inbox = dataOf("inbox");
    cards.push(
      <WidgetCard
        key="inbox"
        title={inbox?.unread ? `Notifications (${inbox.unread} unread)` : "Notifications"}
        icon={Bell}
        viewAllTo={`${H}/inbox`}
        isEmpty={statusOf("inbox") === "ready" && (inbox?.items ?? []).length === 0}
        emptyTitle="No unread notifications"
        emptyDescription="Approvals, decisions and updates addressed to you appear here."
      >
        {body("inbox", (d) => (
          <ul className="flex flex-col divide-y divide-slate-100">
            {(d?.items ?? []).map((n) => (
              <li key={n.id}>
                <Link to={n.href || `${H}/inbox`} className="flex flex-col gap-0.5 py-2 -mx-2 px-2 rounded-lg hover:bg-slate-50 min-w-0">
                  <span className="flex items-center gap-2 min-w-0">
                    {n.actionable && <span className="w-1.5 h-1.5 rounded-full bg-warning-500 shrink-0" aria-label="Needs action" />}
                    <span className="text-[13px] font-semibold text-slate-800 truncate">{n.title}</span>
                  </span>
                  <span className="text-[11px] text-slate-500 truncate">
                    {n.typeLabel} · {formatInboxTime(n.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </WidgetCard>,
    );
  }

  if (visible.has("activity")) {
    const rows = dataOf("activity") ?? [];
    cards.push(
      <WidgetCard
        key="activity"
        title="Recent activity"
        icon={Activity}
        viewAllTo="/wq/activities"
        isEmpty={statusOf("activity") === "ready" && rows.length === 0}
        emptyTitle="No activity yet"
        emptyDescription="Task changes across the Work Queue appear here."
      >
        {body("activity", (d) => (
          <ul className="flex flex-col divide-y divide-slate-100">
            {(d ?? []).slice(0, 6).map((a) => {
              const who = [a.user?.firstName, a.user?.lastName].filter(Boolean).join(" ") || "Someone";
              return (
                <li key={a.id ?? a._id} className="py-2 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{a.title}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {who} · {formatInboxTime(a.createdAt)}
                  </p>
                </li>
              );
            })}
          </ul>
        ))}
      </WidgetCard>,
    );
  }

  if (visible.has("hrmsWidgets")) {
    const w = dataOf("hrmsWidgets");
    const celebrations = [
      ...(w?.birthdays ?? []).map((b) => ({ ...b, kind: "birthday" })),
      ...(w?.anniversaries ?? []).map((a) => ({ ...a, kind: "anniversary" })),
    ]
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 3);
    const announcements = (w?.announcements ?? []).slice(0, 2);
    const holidays = (w?.upcomingHolidays ?? []).slice(0, 3);
    const empty = statusOf("hrmsWidgets") === "ready" && !announcements.length && !holidays.length && !celebrations.length;

    cards.push(
      <WidgetCard
        key="company"
        title="Company"
        icon={Sparkles}
        viewAllTo={`${H}/engage/announcements`}
        isEmpty={empty}
        emptyTitle="Nothing new"
        emptyDescription="Announcements, holidays and celebrations appear here."
      >
        {body("hrmsWidgets", () => (
          <div className="flex flex-col gap-4">
            {announcements.length > 0 && (
              <CompanyBlock icon={Megaphone} title="Announcements">
                {announcements.map((a) => (
                  <Link key={a.id} to={`${H}/engage/announcements`} className="block py-1 min-w-0 hover:text-primary-700">
                    <span className="block text-[13px] font-semibold text-slate-800 truncate">{a.title}</span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {a.createdByName ?? "HR"} · {formatShortDay(a.publishedAt?.slice(0, 10))}
                    </span>
                  </Link>
                ))}
              </CompanyBlock>
            )}
            {holidays.length > 0 && (
              <CompanyBlock icon={Palmtree} title="Upcoming holidays">
                {holidays.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-3 py-1">
                    <span className="text-[13px] font-semibold text-slate-800 truncate">{h.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">{formatShortDay(h.date)}</span>
                  </div>
                ))}
              </CompanyBlock>
            )}
            {celebrations.length > 0 && (
              <CompanyBlock icon={PartyPopper} title="Celebrations">
                {celebrations.map((c) => (
                  <div key={`${c.kind}-${c.employeeId}`} className="flex items-center justify-between gap-3 py-1">
                    <span className="text-[13px] font-semibold text-slate-800 truncate">{c.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {c.kind === "birthday" ? "Birthday" : `${c.yearsCount} yr${c.yearsCount === 1 ? "" : "s"}`} ·{" "}
                      {formatDaysUntil(c.daysUntil)}
                    </span>
                  </div>
                ))}
              </CompanyBlock>
            )}
          </div>
        ))}
      </WidgetCard>,
    );
  }

  if (cards.length === 0) return null;

  return <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{cards}</div>;
}

function CompanyBlock({ icon: Icon, title, children }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-500 mb-1">
        <Icon size={12} />
        {title}
      </p>
      <div className="flex flex-col divide-y divide-slate-100">{children}</div>
    </div>
  );
}

export default HomeDashboard;
