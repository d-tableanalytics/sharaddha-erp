import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  AlertTriangle,
  ClipboardList,
  CheckCircle2,
  PlayCircle,
  Clock,
  Award,
  XCircle,
} from "lucide-react";

import { ErrorState } from "../../../components/hrms/ErrorState";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { Initial } from "../../../components/hrms/dashboard/DashboardPieces";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import { academyReportsApi, formatDay, formatInstant } from "../../../services/hrms/academy";
import { StatCard, PercentBar } from "./academyShared";
import { DonutChart, MiniBars, MeterRow } from "./academyVisuals";

/**
 * The Academy admin dashboard.
 *
 * ---------------------------------------------------------------------------
 * NO CHART LIBRARY
 * ---------------------------------------------------------------------------
 * Section 14 asks for "existing charts/components if available" and says not to
 * introduce unnecessary visualisations. This portal ships exactly one chart
 * (`LoginTrendChart`, hand-drawn SVG) and no charting dependency, so adding one
 * for a completion rate would be a new dependency for information a ring and a
 * few bars convey precisely.
 *
 * The design reference's four panels are reproduced in `academyVisuals` with
 * the same technique that chart uses: inline SVG and Tailwind, nothing else.
 */
export function AcademyDashboardTab() {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await academyReportsApi.dashboard());
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState description={error.message} onRetry={load} />;

  if (data === undefined) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  const { metrics, pathCompletion, overdueQueue, byDepartment = [], recentActivity = [] } = data;

  if (metrics.assignments === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
        title="Nothing assigned yet"
        description="Once learning paths are assigned — manually or by a rule — completion figures and the overdue queue will appear here."
      />
    );
  }

  /**
   * The completion rate is COMPLETED OVER ASSIGNED.
   *
   * Not `metrics.averagePercent`, which is the mean progress across everybody.
   * The two answer different questions and the difference is large: a company
   * where every single person is 90% of the way through has completed nothing.
   */
  const completionRate =
    metrics.assignments > 0 ? Math.round((metrics.completed / metrics.assignments) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Metrics ------------------------------------------------------ */}
      <section>
        <h2 className="sr-only">Academy at a glance</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard
            label="Total Assigned"
            value={metrics.assignments}
            icon={ClipboardList}
            hint={`${metrics.employeesAssigned} employee${metrics.employeesAssigned === 1 ? "" : "s"}`}
          />
          <StatCard
            label="Completed"
            value={metrics.completed}
            tone="success"
            icon={CheckCircle2}
            hint={`${metrics.certificatesIssued} certificate${metrics.certificatesIssued === 1 ? "" : "s"} issued`}
          />
          <StatCard
            label="In Progress"
            value={metrics.inProgress}
            tone="primary"
            icon={PlayCircle}
            hint={`${metrics.notStarted} not started`}
          />
          <StatCard
            label="Overdue"
            value={metrics.overdue}
            tone={metrics.overdue > 0 ? "danger" : "neutral"}
            icon={Clock}
            hint={metrics.overdue > 0 ? "Needs attention" : "Everything inside its deadline"}
          />
        </div>
      </section>

      {/* ---- Completion rate · status · departments ----------------------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Completion Rate">
          <div className="flex flex-col items-center justify-center gap-2 py-2">
            <DonutChart
              percent={completionRate}
              label="Overall completion"
              tone={completionRate >= 75 ? "success" : completionRate >= 40 ? "primary" : "warning"}
            />
            <p className="text-[11px] text-slate-500 text-center">
              {metrics.completed} of {metrics.assignments} assignments finished · average progress{" "}
              {metrics.averagePercent}%
            </p>
          </div>
        </Panel>

        <Panel title="Assignments by Status">
          <MiniBars
            className="py-2"
            data={[
              { label: "Completed", value: metrics.completed, tone: "success" },
              { label: "In Progress", value: metrics.inProgress, tone: "primary" },
              { label: "Overdue", value: metrics.overdue, tone: "danger" },
              { label: "Not Started", value: metrics.notStarted, tone: "neutral" },
            ]}
          />
        </Panel>

        <Panel title="Completion by Department">
          {byDepartment.length === 0 ? (
            <p className="text-xs text-slate-500">
              No assignment carries a department yet, so there is nothing to break down.
            </p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {byDepartment.map((row) => (
                <MeterRow
                  key={row.departmentId}
                  label={row.departmentName}
                  percent={row.completionPercent}
                  tone={
                    row.completionPercent >= 75
                      ? "success"
                      : row.completionPercent >= 40
                        ? "primary"
                        : "warning"
                  }
                  meta={`${row.completed} of ${row.assigned} complete`}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ---- Paths · activity --------------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Learning path completion" className="lg:col-span-3" bodyClassName="p-0">
          {pathCompletion.length === 0 ? (
            <p className="p-5 text-xs text-slate-500">No paths have been assigned yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pathCompletion.map((path) => (
                <li key={path.pathId} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="text-sm font-semibold text-slate-800 min-w-0">{path.pathName}</h3>
                    <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
                      {path.completionPercent}%
                    </span>
                  </div>

                  <PercentBar
                    percent={path.completionPercent}
                    size="sm"
                    tone={path.overdue > 0 ? "warning" : undefined}
                  />

                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-slate-500">
                    <span>{path.assigned} assigned</span>
                    <span className="text-success-600 font-semibold">
                      {path.completed} completed
                    </span>
                    <span>{path.inProgress} in progress</span>
                    {path.overdue > 0 && (
                      <span className="text-error-600 font-semibold">{path.overdue} overdue</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent Activity" className="lg:col-span-2" bodyClassName="p-0">
          {recentActivity.length === 0 ? (
            <p className="p-5 text-xs text-slate-500">
              Nothing has been completed or attempted yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentActivity.map((row, i) => (
                <ActivityRow key={`${row.employeeName}-${row.at}-${i}`} row={row} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ---- Overdue queue ------------------------------------------------- */}
      <Panel title="Needs attention" bodyClassName="p-0">
        {overdueQueue.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">
            Nothing is overdue. Every assigned path is inside its deadline.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {overdueQueue.map((row) => (
              <li key={row.id}>
                <Link
                  to={`${HRMS_ROUTE_PREFIX}/academy/assignments`}
                  className="flex items-start gap-2.5 p-3.5 hover:bg-slate-50 transition-colors"
                >
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-error-500" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-800 truncate">
                      {row.employeeName}
                    </span>
                    <span className="block text-xs text-slate-500 truncate">{row.pathName}</span>
                    <span className="block mt-0.5 text-[11px] font-semibold text-error-600">
                      Overdue by {row.overdueByDays} day{row.overdueByDays === 1 ? "" : "s"} · due{" "}
                      {formatDay(row.dueDate)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/**
 * The card every panel on this page sits in.
 *
 * Close to `DashboardPieces.WidgetCard` but not an import of it: that one owns
 * its own empty state and a "View all" link, and these panels each have
 * something different to say when they are empty. The SHELL is identical, which
 * is the part that has to match.
 */
function Panel({ title, action, children, className, bodyClassName }) {
  return (
    <section
      className={`flex flex-col bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden ${className ?? ""}`}
    >
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <h2 className="text-[13px] font-bold text-slate-900 truncate">{title}</h2>
        {action}
      </header>
      <div className={`flex-1 ${bodyClassName ?? "p-4"}`}>{children}</div>
    </section>
  );
}

/**
 * One line of the activity feed.
 *
 * A failed attempt is shown as plainly as a pass. The reference's own feed does
 * this — "failed Product Quiz (Attempt 1)" — and it is the more useful of the
 * two: a completion needs no action, and somebody failing their second attempt
 * is the person an administrator should be looking at.
 */
function ActivityRow({ row }) {
  const isAttempt = row.kind === "attempt";
  const failed = isAttempt && !row.passed;

  const Icon = failed ? XCircle : isAttempt ? ClipboardList : Award;
  const tint = failed ? "text-error-500" : isAttempt ? "text-primary-600" : "text-success-600";

  return (
    <li className="flex items-start gap-2.5 p-3.5">
      <Initial name={row.employeeName} size={28} />

      <span className="flex-1 min-w-0">
        <span className="block text-[13px] text-slate-700 leading-snug">
          <span className="font-semibold text-slate-900">{row.employeeName}</span>{" "}
          {isAttempt ? (
            <>
              {row.passed ? "passed" : "failed"}{" "}
              <span className="font-medium text-slate-800">{row.detail}</span>
              {row.attemptNo != null && (
                <span className="text-slate-500"> (Attempt {row.attemptNo})</span>
              )}
              {row.score != null && <span className="text-slate-500"> · {row.score}%</span>}
            </>
          ) : (
            <>
              completed <span className="font-medium text-slate-800">{row.pathName}</span>
            </>
          )}
        </span>
        <span className="block mt-0.5 text-[11px] text-slate-400">{formatInstant(row.at)}</span>
      </span>

      <Icon size={14} className={`mt-0.5 shrink-0 ${tint}`} />
    </li>
  );
}

export default AcademyDashboardTab;
