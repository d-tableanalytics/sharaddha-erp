import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, AlertTriangle } from "lucide-react";

import { ErrorState } from "../../../components/hrms/ErrorState";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import { academyReportsApi, formatDay } from "../../../services/hrms/academy";
import { StatCard, PercentBar } from "./academyShared";

/**
 * The Academy admin dashboard.
 *
 * ---------------------------------------------------------------------------
 * NO CHART LIBRARY
 * ---------------------------------------------------------------------------
 * Section 14 asks for "existing charts/components if available" and says not to
 * introduce unnecessary visualisations. This portal ships exactly one chart
 * (`LoginTrendChart`, hand-drawn SVG) and no charting dependency, so adding one
 * for a completion rate would be a new dependency for information a bar already
 * conveys precisely.
 *
 * Every figure here is either a number or a proportion, and a proportion is a
 * bar. That is the whole visual vocabulary, and it is the portal's own.
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

  const { metrics, pathCompletion, overdueQueue } = data;

  if (metrics.assignments === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
        title="Nothing assigned yet"
        description="Once learning paths are assigned — manually or by a rule — completion figures and the overdue queue will appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Metrics ------------------------------------------------------ */}
      <section>
        <h2 className="sr-only">Academy at a glance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Employees" value={metrics.employeesAssigned} />
          <StatCard label="Assignments" value={metrics.assignments} />
          <StatCard label="In progress" value={metrics.inProgress} tone="primary" />
          <StatCard label="Completed" value={metrics.completed} tone="success" />
          <StatCard
            label="Overdue"
            value={metrics.overdue}
            tone={metrics.overdue > 0 ? "danger" : "neutral"}
          />
          <StatCard label="Avg. complete" value={`${metrics.averagePercent}%`} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ---- Completion by path ---------------------------------------- */}
        <section className="lg:col-span-3">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Learning path completion</h2>

          <div className="bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden">
            {pathCompletion.length === 0 ? (
              <p className="p-5 text-xs text-slate-500">No paths have been assigned yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pathCompletion.map((path) => (
                  <li key={path.pathId} className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="text-sm font-semibold text-slate-800 min-w-0">
                        {path.pathName}
                      </h3>
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
          </div>
        </section>

        {/* ---- Overdue queue --------------------------------------------- */}
        <section className="lg:col-span-2">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Needs attention</h2>

          <div className="bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden">
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
                        <span className="block text-xs text-slate-500 truncate">
                          {row.pathName}
                        </span>
                        <span className="block mt-0.5 text-[11px] font-semibold text-error-600">
                          Overdue by {row.overdueByDays} day{row.overdueByDays === 1 ? "" : "s"} ·
                          due {formatDay(row.dueDate)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default AcademyDashboardTab;
