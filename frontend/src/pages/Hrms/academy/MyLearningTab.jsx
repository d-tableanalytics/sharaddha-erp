import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, PlayCircle, ArrowRight } from "lucide-react";

import { ErrorState } from "../../../components/hrms/ErrorState";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { Button } from "../../../components/ui/Button";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import { myLearningApi, formatInstant } from "../../../services/hrms/academy";
import {
  LearningPathCard,
  ProgressRow,
  StatCard,
  AcademyStatusBadge,
  DueLabel,
} from "./academyShared";

/**
 * My Learning — the module's default tab and the screen most people see.
 *
 * Section 4 asks that it answer six questions immediately: what is assigned to
 * me, how much have I done, what should I continue, what is due soon, what is
 * overdue, what have I finished. The layout is in that order, because that is
 * the order somebody wants them answered.
 *
 * The request takes NO id — `/academy/my-learning` is scoped to the session,
 * the shape `onboarding/checklists/mine` and `documents/me` use, so there is
 * nothing on the wire to tamper with.
 */
export function MyLearningTab() {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await myLearningApi.get());
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

  const { summary, assignments, continue: resume } = data;

  if (assignments.length === 0) {
    return (
      <EmptyState
        icon={<GraduationCap className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
        title="No learning assigned yet"
        description="You don't have any learning paths assigned. When training is assigned to you it will appear here, along with anything that is due."
      />
    );
  }

  /**
   * The counters double as filters.
   *
   * Clicking "Overdue" filters the list below rather than navigating somewhere
   * — the number and the thing it counts stay on one screen, which is what
   * makes the count actionable rather than decorative.
   */
  const shown = assignments.filter((a) => {
    if (!filter) return true;
    if (filter === "overdue") return a.dueState === "overdue";
    if (filter === "completed") return a.status === "completed";
    if (filter === "in_progress") return a.status === "in_progress";
    if (filter === "not_started") return a.status === "assigned";
    return true;
  });

  const toggle = (key) => setFilter((f) => (f === key ? null : key));

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Counters ---------------------------------------------------- */}
      <section>
        <h2 className="sr-only">Your learning at a glance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Assigned" value={summary.assigned} />
          <StatCard
            label="Not started"
            value={summary.notStarted}
            onClick={() => toggle("not_started")}
            active={filter === "not_started"}
          />
          <StatCard
            label="In progress"
            value={summary.inProgress}
            tone="primary"
            onClick={() => toggle("in_progress")}
            active={filter === "in_progress"}
          />
          <StatCard
            label="Completed"
            value={summary.completed}
            tone="success"
            onClick={() => toggle("completed")}
            active={filter === "completed"}
          />
          <StatCard
            label="Overdue"
            value={summary.overdue}
            tone={summary.overdue > 0 ? "danger" : "neutral"}
            onClick={() => toggle("overdue")}
            active={filter === "overdue"}
          />
        </div>
      </section>

      {/* ---- Continue learning ------------------------------------------- */}
      {resume && (
        <section>
          <h2 className="text-sm font-bold text-slate-900 mb-3">Continue learning</h2>

          <div className="flex flex-col gap-4 p-4 sm:p-5 bg-white border border-slate-200 rounded-xl shadow-enterprise">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900">{resume.pathName}</h3>
                {resume.nextLesson ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Next up in{" "}
                    <span className="font-semibold text-slate-700">
                      {resume.nextLesson.courseName}
                    </span>
                    : {resume.nextLesson.lessonTitle}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Everything available is complete — open the path to review it.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <AcademyStatusBadge status={resume.status} dueState={resume.dueState} />
                <DueLabel
                  dueState={resume.dueState}
                  dueLabel={resume.dueLabel}
                  dueDate={resume.dueDate}
                />
              </div>
            </div>

            <ProgressRow
              percent={resume.percent}
              completed={resume.completedLessons}
              total={resume.totalLessons}
              tone={resume.dueState === "overdue" ? "danger" : undefined}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={
                  resume.nextLesson
                    ? `${HRMS_ROUTE_PREFIX}/academy/learn/${resume.id}/lesson/${resume.nextLesson.lessonId}`
                    : `${HRMS_ROUTE_PREFIX}/academy/learn/${resume.id}`
                }
              >
                <Button size="sm">
                  <PlayCircle size={15} className="mr-1.5" />
                  {resume.percent > 0 ? "Continue learning" : "Start learning"}
                </Button>
              </Link>
              <Link to={`${HRMS_ROUTE_PREFIX}/academy/learn/${resume.id}`}>
                <Button size="sm" variant="outline">
                  View path
                </Button>
              </Link>
              {resume.lastActivityAt && (
                <span className="text-[11px] text-slate-400 ml-auto">
                  Last opened {formatInstant(resume.lastActivityAt)}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ---- All paths ---------------------------------------------------- */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-bold text-slate-900">
            My learning paths
            {filter && (
              <span className="ml-2 text-xs font-medium text-slate-500">
                ({shown.length} shown)
              </span>
            )}
          </h2>
          {filter && (
            <Button size="xs" variant="ghost" onClick={() => setFilter(null)}>
              Clear filter
            </Button>
          )}
        </div>

        {shown.length === 0 ? (
          <EmptyState
            title="Nothing matches that filter"
            description="Clear the filter to see all of your learning paths."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((assignment) => (
              <LearningPathCard
                key={assignment.id}
                assignment={assignment}
                to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignment.id}`}
                action={
                  <Link
                    to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignment.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-primary-700 hover:underline"
                  >
                    {assignment.status === "completed"
                      ? "Review"
                      : assignment.percent > 0
                        ? "Continue"
                        : "Start"}
                    <ArrowRight size={13} />
                  </Link>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default MyLearningTab;
