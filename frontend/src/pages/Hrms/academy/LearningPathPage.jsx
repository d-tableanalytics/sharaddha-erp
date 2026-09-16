import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Lock, Award, ArrowLeft } from "lucide-react";

import { HrmsPageLayout } from "../../../components/hrms/HrmsPageLayout";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import {
  assignmentsApi,
  certificatesApi,
  formatDuration,
  formatDay,
  CONTENT_TYPE_LABELS,
} from "../../../services/hrms/academy";
import {
  ProgressRow,
  AcademyStatusBadge,
  DueLabel,
  MandatoryBadge,
  LessonStatusIcon,
  LockedNotice,
  LESSON_ICONS,
} from "./academyShared";

/**
 * One learning path, as the learner works through it.
 *
 * ---------------------------------------------------------------------------
 * The server decides what is locked, and this screen only renders it
 * ---------------------------------------------------------------------------
 * `course.locked` and `course.lockedBy` arrive computed. Nothing here
 * re-derives a prerequisite rule, which is what stops the greying-out in the UI
 * and the 403 from the API disagreeing — and the API is the one that binds
 * (`loadForProgress` refuses a locked lesson server-side regardless of what
 * this page drew).
 */
export function LearningPathPage() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();

  const [assignment, setAssignment] = useState(undefined);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [certBusy, setCertBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await assignmentsApi.get(assignmentId);
      setAssignment(data);
      /**
       * Open the course the learner is actually in, and nothing else.
       *
       * A path with eight courses fully expanded is a wall of text; all
       * collapsed is a page that makes you hunt. The next lesson's course is
       * the one they came here for.
       */
      const target =
        data.nextLesson?.courseId ??
        data.courses.find((c) => !c.locked && c.status !== "completed")?.courseId;
      if (target) setOpen(new Set([target]));
    } catch (err) {
      setError(err);
    }
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (courseId) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });

  const openCertificate = useCallback(async () => {
    if (!assignment?.certificateId) return;
    setCertBusy(true);
    try {
      const { url } = await certificatesApi.documentUrl(assignment.certificateId);
      // A presigned URL, opened in a new tab. `noopener` because the target is
      // a storage origin and must never get a handle on this window.
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err);
    } finally {
      setCertBusy(false);
    }
  }, [assignment]);

  const crumbs = [
    { label: "HRMS", to: `${HRMS_ROUTE_PREFIX}/dashboard` },
    { label: "SI Academy", to: `${HRMS_ROUTE_PREFIX}/academy/my-learning` },
    { label: assignment?.pathName ?? "Learning path" },
  ];

  return (
    <HrmsPageLayout
      title={assignment?.pathName ?? "Learning path"}
      subtitle={
        assignment
          ? `${assignment.completedLessons} of ${assignment.totalLessons} required lessons complete`
          : undefined
      }
      breadcrumbs={crumbs}
      loading={assignment === undefined && !error}
      error={error}
      onRetry={load}
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(`${HRMS_ROUTE_PREFIX}/academy/my-learning`)}
        >
          <ArrowLeft size={14} className="mr-1.5" />
          My Learning
        </Button>
      }
    >
      {assignment && (
        <div className="flex flex-col gap-5">
          {/* ---- Summary --------------------------------------------------- */}
          <section className="flex flex-col gap-4 p-4 sm:p-5 bg-white border border-slate-200 rounded-xl shadow-enterprise">
            <div className="flex flex-wrap items-center gap-2">
              <AcademyStatusBadge status={assignment.status} dueState={assignment.dueState} />
              <MandatoryBadge mandatory={assignment.mandatory} />
              {assignment.sequential && <Badge variant="neutral">Courses in order</Badge>}
              <DueLabel
                dueState={assignment.dueState}
                dueLabel={assignment.dueLabel}
                dueDate={assignment.dueDate}
                className="ml-auto"
              />
            </div>

            <ProgressRow
              percent={assignment.percent}
              completed={assignment.completedLessons}
              total={assignment.totalLessons}
              tone={assignment.dueState === "overdue" ? "danger" : undefined}
            />

            {assignment.status === "cancelled" && (
              <p className="text-xs text-slate-500">
                This assignment was withdrawn
                {assignment.cancelReason ? `: ${assignment.cancelReason}` : "."}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {assignment.nextLesson && assignment.status !== "cancelled" && (
                <Link
                  to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignment.id}/lesson/${assignment.nextLesson.lessonId}`}
                >
                  <Button size="sm">
                    {assignment.percent > 0 ? "Continue" : "Start"} — {assignment.nextLesson.lessonTitle}
                  </Button>
                </Link>
              )}

              {assignment.certificateId && (
                <Button size="sm" variant="outline" loading={certBusy} onClick={openCertificate}>
                  <Award size={14} className="mr-1.5" />
                  View certificate
                </Button>
              )}

              {assignment.status === "completed" &&
                assignment.requiresCertificate &&
                !assignment.certificateId && (
                  <p className="text-xs text-slate-500">
                    Your certificate is being prepared. If it does not appear shortly, ask HR to
                    re-issue it.
                  </p>
                )}
            </div>
          </section>

          {/* ---- Courses --------------------------------------------------- */}
          {assignment.courses.length === 0 ? (
            <EmptyState
              title="This path has no courses yet"
              description="Nothing has been published here. Your HR team will add the material."
            />
          ) : (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold text-slate-900">Courses</h2>

              {assignment.courses.map((course, index) => {
                const expanded = open.has(course.courseId);
                return (
                  <article
                    key={course.courseId}
                    className="bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(course.courseId)}
                      aria-expanded={expanded}
                      className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-slate-50/70 transition-colors"
                    >
                      <span className="mt-0.5 shrink-0 text-slate-400">
                        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>

                      <span className="flex-1 min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="text-sm font-bold text-slate-900">{course.name}</span>
                          {course.locked && (
                            <Lock size={13} className="text-slate-400" aria-label="Locked" />
                          )}
                          {!course.mandatory && (
                            <Badge variant="neutral" className="text-[10px]">
                              Optional
                            </Badge>
                          )}
                          {!course.active && (
                            <Badge variant="warning" className="text-[10px]">
                              Archived
                            </Badge>
                          )}
                        </span>

                        {course.description && (
                          <span className="block mt-1 text-xs text-slate-500 line-clamp-2">
                            {course.description}
                          </span>
                        )}

                        <span className="flex items-center gap-3 mt-2">
                          <ProgressRow
                            percent={course.percent}
                            completed={course.completedLessons}
                            total={course.totalLessons}
                            className="max-w-xs"
                          />
                          {course.estimatedMinutes && (
                            <span className="text-[11px] text-slate-400 whitespace-nowrap">
                              ~{course.estimatedMinutes} min
                            </span>
                          )}
                        </span>
                      </span>
                    </button>

                    {expanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-slate-100">
                        {course.locked ? (
                          <LockedNotice lockedBy={course.lockedBy} className="mt-3" />
                        ) : course.lessons.length === 0 ? (
                          <p className="mt-3 text-xs text-slate-500">
                            This course has no lessons yet.
                          </p>
                        ) : (
                          <ul className="mt-2 divide-y divide-slate-100">
                            {course.lessons.map((lesson) => {
                              const Icon = LESSON_ICONS[lesson.type] ?? LESSON_ICONS.document;
                              const reachable =
                                lesson.inAssignment &&
                                !lesson.contentMissing &&
                                assignment.status !== "cancelled";

                              const row = (
                                <span className="flex items-center gap-3 py-2.5">
                                  <LessonStatusIcon status={lesson.status} />
                                  <Icon size={15} className="shrink-0 text-slate-400" />

                                  <span className="flex-1 min-w-0">
                                    <span className="block text-sm text-slate-800 truncate">
                                      {lesson.title}
                                    </span>
                                    <span className="flex flex-wrap items-center gap-2 mt-0.5">
                                      <span className="text-[11px] text-slate-400">
                                        {CONTENT_TYPE_LABELS[lesson.type] ?? lesson.type}
                                      </span>
                                      {lesson.type === "video" &&
                                        lesson.videoDurationSeconds != null && (
                                          <span className="text-[11px] text-slate-400">
                                            {formatDuration(lesson.videoDurationSeconds)}
                                          </span>
                                        )}
                                      {!lesson.mandatory && (
                                        <span className="text-[11px] text-slate-400">Optional</span>
                                      )}
                                      {lesson.type === "video" &&
                                        lesson.status === "in_progress" && (
                                          <span className="text-[11px] text-primary-600 font-semibold">
                                            {lesson.videoPercent}% watched
                                          </span>
                                        )}
                                      {lesson.assessment?.attemptCount > 0 && (
                                        <span className="text-[11px] text-slate-500">
                                          Best {lesson.assessment.bestScore}% ·{" "}
                                          {lesson.assessment.attemptCount} attempt
                                          {lesson.assessment.attemptCount === 1 ? "" : "s"}
                                        </span>
                                      )}
                                      {lesson.completedAt && (
                                        <span className="text-[11px] text-slate-400">
                                          {formatDay(lesson.completedAt.slice(0, 10))}
                                        </span>
                                      )}
                                    </span>
                                  </span>

                                  {/*
                                    A lesson added to the course after this
                                    person was assigned carries no record. Said
                                    plainly rather than hidden: a lesson that
                                    silently vanishes makes the course look
                                    shorter than it is.
                                  */}
                                  {!lesson.inAssignment && (
                                    <Badge variant="neutral" className="shrink-0 text-[10px]">
                                      Not in your assignment
                                    </Badge>
                                  )}
                                  {lesson.contentMissing && (
                                    <Badge variant="warning" className="shrink-0 text-[10px]">
                                      Unavailable
                                    </Badge>
                                  )}
                                </span>
                              );

                              return (
                                <li key={lesson.id}>
                                  {reachable ? (
                                    <Link
                                      to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignment.id}/lesson/${lesson.id}`}
                                      className="block -mx-2 px-2 rounded-lg hover:bg-slate-50 transition-colors"
                                    >
                                      {row}
                                    </Link>
                                  ) : (
                                    <div className="opacity-60 cursor-not-allowed">{row}</div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          )}
        </div>
      )}
    </HrmsPageLayout>
  );
}

export default LearningPathPage;
