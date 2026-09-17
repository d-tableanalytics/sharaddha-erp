import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, PlayCircle, ArrowRight, Layers, BookOpen } from "lucide-react";

import { ErrorState } from "../../../components/hrms/ErrorState";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { Button } from "../../../components/ui/Button";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import { myLearningApi, formatInstant } from "../../../services/hrms/academy";
import { PercentBar, AcademyStatusBadge, DueLabel, MandatoryBadge } from "./academyShared";
import { CoverTile, FilterChips } from "./academyVisuals";

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

  const assignments = data?.assignments;

  /**
   * The chips and the list are driven by ONE predicate.
   *
   * A chip whose count disagrees with the number of cards it reveals is the
   * defect this shape rules out: the count IS `filtered(key).length`, so the
   * two cannot drift apart however the rules change later.
   */
  const matches = useCallback((assignment, key) => {
    if (!key) return true;
    if (key === "in_progress") return assignment.status === "in_progress";
    if (key === "due_soon") return assignment.dueState === "due_soon";
    if (key === "overdue") return assignment.dueState === "overdue";
    if (key === "completed") return assignment.status === "completed";
    return true;
  }, []);

  const chips = useMemo(() => {
    const rows = assignments ?? [];
    const count = (key) => rows.filter((a) => matches(a, key)).length;
    return [
      { key: null, label: "All", count: rows.length },
      { key: "in_progress", label: "In Progress", count: count("in_progress") },
      { key: "due_soon", label: "Due Soon", count: count("due_soon") },
      { key: "overdue", label: "Overdue", count: count("overdue") },
      { key: "completed", label: "Completed", count: count("completed") },
    ];
  }, [assignments, matches]);

  if (error) return <ErrorState description={error.message} onRetry={load} />;

  if (data === undefined) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  const { continue: resume } = data;

  if (assignments.length === 0) {
    return (
      <EmptyState
        icon={<GraduationCap className="w-10 h-10 text-slate-400 stroke-[1.5]" />}
        title="No learning assigned yet"
        description="You don't have any learning paths assigned. When training is assigned to you it will appear here, along with anything that is due."
      />
    );
  }

  const shown = assignments.filter((a) => matches(a, filter));

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Continue learning -------------------------------------------- */}
      {resume && (
        <section>
          <h2 className="text-sm font-bold text-slate-900 mb-3">Continue Learning</h2>

          {/*
            THE ONE CARD ON THIS SCREEN THAT IS A CALL TO ACTION.

            The reference gives it a landscape thumbnail on the left, the path
            and its next lesson in the middle, and the action at the far right —
            a horizontal band that reads as a resume bar rather than as one more
            card in the grid below. That distinction is the whole point of the
            row: it is the single thing most people open this page to do.
          */}
          <article className="flex flex-col sm:flex-row sm:items-stretch bg-white border border-primary-200 rounded-xl shadow-enterprise overflow-hidden">
            {/* Fixed on a phone; stretched to the row on `sm`, where
                `self-stretch` gives it a definite height that `h-full` inside
                can actually resolve against. */}
            <div className="shrink-0 w-full h-32 sm:w-[190px] sm:h-auto sm:self-stretch">
              <CoverTile name={resume.pathName} kind="path" />
            </div>

            <div className="flex-1 flex flex-col justify-center gap-3 p-4 sm:p-5 min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900 leading-snug">
                    {resume.pathName}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {resume.nextLesson ? (
                      <>
                        Next:{" "}
                        <span className="font-semibold text-slate-700">
                          {resume.nextLesson.lessonTitle}
                        </span>
                      </>
                    ) : (
                      "Everything available is complete — open the path to review it."
                    )}
                  </p>
                </div>

                <Link
                  to={
                    resume.nextLesson
                      ? `${HRMS_ROUTE_PREFIX}/academy/learn/${resume.id}/lesson/${resume.nextLesson.lessonId}`
                      : `${HRMS_ROUTE_PREFIX}/academy/learn/${resume.id}`
                  }
                  className="max-sm:w-full"
                >
                  {/* Full width on a phone. A 150px button floating in a 343px
                      card is the primary action looking like an afterthought,
                      and it is the one control here a thumb goes for. */}
                  <Button size="md" className="max-sm:w-full">
                    <PlayCircle size={16} className="mr-1.5" />
                    {resume.percent > 0 ? "Continue Learning" : "Start Learning"}
                    <ArrowRight size={15} className="ml-1.5" />
                  </Button>
                </Link>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2.5 flex-1 min-w-[180px]">
                  <PercentBar
                    percent={resume.percent}
                    tone={resume.dueState === "overdue" ? "danger" : undefined}
                    className="flex-1"
                  />
                  <span className="text-xs font-bold text-slate-700 tabular-nums">
                    {resume.percent}%
                  </span>
                </div>

                <DueLabel
                  dueState={resume.dueState}
                  dueLabel={resume.dueLabel}
                  dueDate={resume.dueDate}
                />

                {resume.lastActivityAt && (
                  <span className="text-[11px] text-slate-400">
                    Last opened {formatInstant(resume.lastActivityAt)}
                  </span>
                )}
              </div>
            </div>
          </article>
        </section>
      )}

      {/* ---- Filters + grid ------------------------------------------------ */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <FilterChips
            options={chips}
            value={filter}
            onChange={setFilter}
            ariaLabel="Filter learning paths"
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            title="Nothing matches that filter"
            description="Choose “All” to see every learning path assigned to you."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((assignment) => (
              <PathCard key={assignment.id} assignment={assignment} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * One learning path in the grid.
 *
 * The reference's card is a vertical stack: cover, then title, then the counts,
 * then progress, then the action across the full width of the card. The action
 * being full-width matters — it makes every card in the row terminate in the
 * same place, so the grid reads as a set of equivalent options rather than as
 * cards of drifting height.
 */
function PathCard({ assignment }) {
  const to = `${HRMS_ROUTE_PREFIX}/academy/learn/${assignment.id}`;
  const tone =
    assignment.dueState === "overdue"
      ? "danger"
      : assignment.dueState === "due_soon"
        ? "warning"
        : undefined;

  const label =
    assignment.status === "completed"
      ? "Review"
      : assignment.percent > 0
        ? "Continue"
        : "Start";

  return (
    <article className="group flex flex-col bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden transition-all hover:border-primary-300 hover:shadow-md">
      <Link to={to} className="block h-32 shrink-0">
        <CoverTile name={assignment.pathName} kind="path" />
      </Link>

      <div className="flex-1 flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 leading-snug min-w-0">
            <Link to={to} className="hover:text-primary-700">
              {assignment.pathName}
            </Link>
          </h3>
          <AcademyStatusBadge
            status={assignment.status}
            dueState={assignment.dueState}
            className="shrink-0"
          />
        </div>

        {/* The reference's "5 Courses · 12 Lessons" line — the size of the
            commitment, which is the second thing anybody wants to know. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Layers size={12} className="text-slate-400" />
            {assignment.totalCourses} {assignment.totalCourses === 1 ? "Course" : "Courses"}
          </span>
          <span className="inline-flex items-center gap-1">
            <BookOpen size={12} className="text-slate-400" />
            {assignment.totalLessons} {assignment.totalLessons === 1 ? "Lesson" : "Lessons"}
          </span>
          <MandatoryBadge mandatory={assignment.mandatory} className="text-[10px] px-2 py-0" />
        </div>

        <div className="mt-auto flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <PercentBar percent={assignment.percent} tone={tone} className="flex-1" size="sm" />
            <span className="text-xs font-bold text-slate-700 tabular-nums">
              {assignment.percent}%
            </span>
          </div>

          <DueLabel
            dueState={assignment.dueState}
            dueLabel={assignment.dueLabel}
            dueDate={assignment.dueDate}
          />
        </div>
      </div>

      <div className="px-4 pb-4">
        <Link to={to} className="block">
          <Button
            size="sm"
            variant={assignment.percent > 0 ? "primary" : "outline"}
            className="w-full"
          >
            {label}
            <ArrowRight size={14} className="ml-1.5" />
          </Button>
        </Link>
      </div>
    </article>
  );
}

export default MyLearningTab;
