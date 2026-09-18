import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Award,
  ArrowLeft,
  ClipboardList,
  CheckCircle2,
  Circle,
  Layers,
  BookOpen,
  PlayCircle,
  Clock,
} from "lucide-react";

import { HrmsPageLayout } from "../../../components/hrms/HrmsPageLayout";
import { TabNav } from "../../../components/hrms/TabNav";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import {
  assignmentsApi,
  certificatesApi,
  formatDuration,
  formatDay,
  formatInstant,
  CONTENT_TYPE_LABELS,
} from "../../../services/hrms/academy";
import {
  PercentBar,
  AcademyStatusBadge,
  DueLabel,
  MandatoryBadge,
  LessonStatusIcon,
  LockedNotice,
  LESSON_ICONS,
} from "./academyShared";
import { CoverTile } from "./academyVisuals";
import { openFile } from "../../../services/fileUrl";

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
  const [tab, setTab] = useState("content");

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
      openFile(url);
    } catch (err) {
      setError(err);
    } finally {
      setCertBusy(false);
    }
  }, [assignment]);

  /**
   * Every quiz in this path that has been ATTEMPTED, flattened out of the
   * course tree.
   *
   * Only attempted ones: a quiz nobody has sat yet has nothing to report, and
   * listing it with an empty table would bury the two that do.
   */
  const assessmentResults = (assignment?.courses ?? []).flatMap((course) =>
    course.lessons
      .filter((lesson) => lesson.type === "quiz" && lesson.assessment?.attemptCount > 0)
      .map((lesson) => ({ courseName: course.name, lesson })),
  );

  const crumbs = [
    { label: "HRMS", to: `${HRMS_ROUTE_PREFIX}/dashboard` },
    { label: "SI Academy", to: `${HRMS_ROUTE_PREFIX}/academy/my-learning` },
    { label: assignment?.pathName ?? "Learning path" },
  ];

  const totalLessons = (assignment?.courses ?? []).reduce(
    (sum, course) => sum + course.lessons.length,
    0,
  );

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
          {/* ---- Hero ------------------------------------------------------ */}
          <section className="flex flex-col sm:flex-row bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden">
            {/*
              The cover doubles as the resume control. A large image beside a
              small text button, where the image is the obvious thing to press
              and does nothing, is the reference's layout implemented as a trap.
            */}
            {assignment.nextLesson && assignment.status !== "cancelled" ? (
              <Link
                to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignment.id}/lesson/${assignment.nextLesson.lessonId}`}
                aria-label={`Resume ${assignment.nextLesson.lessonTitle}`}
                className="group relative shrink-0 w-full h-40 sm:w-[240px] sm:h-auto sm:self-stretch"
              >
                <CoverTile name={assignment.pathName} kind="path" />
                <span className="absolute inset-0 flex items-center justify-center bg-slate-900/25 transition-colors group-hover:bg-slate-900/40">
                  <PlayCircle size={40} strokeWidth={1.5} className="text-white drop-shadow" />
                </span>
              </Link>
            ) : (
              <div className="shrink-0 w-full h-40 sm:w-[240px] sm:h-auto sm:self-stretch">
                <CoverTile name={assignment.pathName} kind="path" />
              </div>
            )}

            <div className="flex-1 flex flex-col gap-3 p-4 sm:p-5 min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900 leading-snug min-w-0">
                  {assignment.pathName}
                </h2>
                <AcademyStatusBadge
                  status={assignment.status}
                  dueState={assignment.dueState}
                  className="shrink-0"
                />
              </div>

              {assignment.description && (
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                  {assignment.description}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <Layers size={13} className="text-slate-400" />
                  {assignment.courses.length}{" "}
                  {assignment.courses.length === 1 ? "Course" : "Courses"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <BookOpen size={13} className="text-slate-400" />
                  {totalLessons} {totalLessons === 1 ? "Lesson" : "Lessons"}
                </span>
                <MandatoryBadge mandatory={assignment.mandatory} className="text-[10px] px-2 py-0" />
                {assignment.sequential && (
                  <Badge variant="neutral" className="text-[10px] px-2 py-0">
                    Courses in order
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2.5 flex-1 min-w-[180px]">
                  <PercentBar
                    percent={assignment.percent}
                    tone={assignment.dueState === "overdue" ? "danger" : undefined}
                    className="flex-1"
                  />
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

              {assignment.status === "cancelled" && (
                <p className="text-xs text-slate-500">
                  This assignment was withdrawn
                  {assignment.cancelReason ? `: ${assignment.cancelReason}` : "."}
                </p>
              )}

              {(assignment.certificateId ||
                (assignment.status === "completed" &&
                  assignment.requiresCertificate &&
                  !assignment.certificateId)) && (
                <div className="flex flex-wrap items-center gap-2">
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
              )}
            </div>
          </section>

          {/* ---- Tabs ------------------------------------------------------ */}
          <div>
            <TabNav
              tabs={[
                { key: "content", label: "Course Content" },
                { key: "about", label: "About" },
              ]}
              activeKey={tab}
              onChange={setTab}
              className="mb-4"
            />

            {tab === "about" ? (
              <AboutPanel assignment={assignment} totalLessons={totalLessons} />
            ) : assignment.courses.length === 0 ? (
              <EmptyState
                title="This path has no courses yet"
                description="Nothing has been published here. Your HR team will add the material."
              />
            ) : (
              <div className="flex flex-col gap-3">
                {assignment.courses.map((course, index) => (
                  <CourseRow
                    key={course.courseId}
                    course={course}
                    index={index}
                    assignment={assignment}
                    expanded={open.has(course.courseId)}
                    onToggle={() => toggle(course.courseId)}
                  />
                ))}
              </div>
            )}
          </div>

          {/*
            ── ASSESSMENT RESULTS ────────────────────────────────────────────

            Every attempt at every quiz in this path, with its score and whether
            it passed.

            The data was always in the response — `lesson.assessment.attempts` —
            but the only place it was ever RENDERED in full was the learner's own
            quiz screen, behind a "Start assessment" button. So HR opening
            somebody's progress saw a single inline "Best 80% · 2 attempts" on
            the lesson row and no way to reach the breakdown at all, which is
            exactly what section 13 asks for ("assessment scores", "number of
            attempts") and what section 16's "Attempt 1 → 60% → Failed,
            Attempt 2 → 80% → Passed" describes.

            It sits on THIS page rather than on a new HR-only screen because
            this page is already where the Assignments tab sends an
            administrator, and it is already scoped three ways — the learner
            sees their own, a manager their reports', HR anyone's. One view, one
            permission check, and the learner gets their own history too.
          */}
          {tab === "content" && assessmentResults.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-bold text-slate-900">Assessment results</h2>

              {assessmentResults.map(({ courseName, lesson }) => (
                <AssessmentResultCard key={lesson.id} courseName={courseName} lesson={lesson} />
              ))}
            </section>
          )}
        </div>
      )}
    </HrmsPageLayout>
  );
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

/**
 * The reference's second tab.
 *
 * It carries what the Course Content list deliberately leaves out — the full
 * description, and the administrative facts about the assignment itself: where
 * it came from, when it landed, what it awards. That is genuinely a second
 * subject rather than a second page of the same one, which is what earns it a
 * tab instead of more rows in the hero.
 */
function AboutPanel({ assignment, totalLessons }) {
  const rows = [
    { label: "Courses", value: assignment.courses.length },
    { label: "Lessons", value: totalLessons },
    { label: "Required lessons", value: assignment.totalLessons },
    { label: "Completed", value: `${assignment.completedLessons} of ${assignment.totalLessons}` },
    { label: "Assigned", value: assignment.assignedAt ? formatInstant(assignment.assignedAt) : "—" },
    {
      label: "Assigned by",
      value: assignment.source === "rule" ? (assignment.ruleName ?? "Automatic rule") : "HR",
    },
    { label: "Started", value: assignment.startedAt ? formatInstant(assignment.startedAt) : "—" },
    {
      label: "Completed on",
      value: assignment.completedAt ? formatInstant(assignment.completedAt) : "—",
    },
    { label: "Due", value: assignment.dueDate ? formatDay(assignment.dueDate) : "No due date" },
    {
      label: "Certificate",
      value: assignment.requiresCertificate ? "Awarded on completion" : "None",
    },
    { label: "Order", value: assignment.sequential ? "Courses must be taken in order" : "Any order" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {assignment.description && (
        <section className="p-4 sm:p-5 bg-white border border-slate-200 rounded-xl shadow-enterprise">
          <h3 className="text-sm font-bold text-slate-900 mb-2">About this path</h3>
          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
            {assignment.description}
          </p>
        </section>
      )}

      <section className="p-4 sm:p-5 bg-white border border-slate-200 rounded-xl shadow-enterprise">
        <h3 className="text-sm font-bold text-slate-900 mb-3">Details</h3>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {row.label}
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-700 break-words">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Course row
// ---------------------------------------------------------------------------

/**
 * One course in the path.
 *
 * ---------------------------------------------------------------------------
 * THE NUMBER IS A STATUS, NOT A COUNTER
 * ---------------------------------------------------------------------------
 * The reference puts a circled index at the head of every row and changes what
 * the circle contains as the course advances: the number while it is pending, a
 * tick once it is done, a padlock while it is locked. So the left edge of the
 * list is a single column a reader can run their eye down to see where they
 * are, which a column of identical grey numerals would not give them.
 *
 * The row stays an accordion. The reference shows the collapsed state only, and
 * a course whose lessons cannot be reached from the path page would mean going
 * into the player to find out what is in it.
 */
function CourseRow({ course, index, assignment, expanded, onToggle }) {
  const done = course.status === "completed";
  const started = course.percent > 0 && !done;

  const marker = course.locked ? (
    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-400 shrink-0">
      <Lock size={14} aria-label="Locked" />
    </span>
  ) : done ? (
    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-success-50 text-success-600 shrink-0">
      <CheckCircle2 size={17} aria-label="Completed" />
    </span>
  ) : (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold tabular-nums shrink-0 ${
        started ? "bg-primary-600 text-white" : "bg-slate-100 text-slate-500"
      }`}
    >
      {index + 1}
    </span>
  );

  /** The one control on the right: continue, done, waiting, or locked. */
  const trailing = course.locked ? (
    <Lock size={16} className="text-slate-300 shrink-0" aria-label="Locked" />
  ) : done ? (
    <CheckCircle2 size={20} className="text-success-600 shrink-0" aria-label="Completed" />
  ) : started && assignment.status !== "cancelled" ? (
    <Badge variant="primary" className="shrink-0">
      In progress
    </Badge>
  ) : (
    <Circle size={20} className="text-slate-200 shrink-0" aria-label="Not started" />
  );

  const summary = [
    `${course.lessons.length} ${course.lessons.length === 1 ? "Lesson" : "Lessons"}`,
    course.locked
      ? "Locked"
      : done
        ? "Completed"
        : started
          ? `${course.percent}% complete`
          : "Not started",
  ].join(" · ");

  return (
    <article className="bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden transition-colors hover:border-slate-300">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50/70 transition-colors"
      >
        {marker}

        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-900">{course.name}</span>
            {!course.mandatory && (
              <Badge variant="neutral" className="text-[10px] px-2 py-0">
                Optional
              </Badge>
            )}
            {!course.active && (
              <Badge variant="warning" className="text-[10px] px-2 py-0">
                Archived
              </Badge>
            )}
          </span>

          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-slate-500">
            <span>{summary}</span>
            {course.estimatedMinutes && (
              <span className="inline-flex items-center gap-1 text-slate-400">
                <Clock size={11} />~{course.estimatedMinutes} min
              </span>
            )}
          </span>
        </span>

        {trailing}

        <span className="shrink-0 text-slate-300">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100">
          {course.locked ? (
            <LockedNotice lockedBy={course.lockedBy} className="mt-3" />
          ) : course.lessons.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">This course has no lessons yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100">
              {course.lessons.map((lesson) => (
                <LessonRow key={lesson.id} lesson={lesson} assignment={assignment} />
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

function LessonRow({ lesson, assignment }) {
  const Icon = LESSON_ICONS[lesson.type] ?? LESSON_ICONS.document;
  const reachable =
    lesson.inAssignment && !lesson.contentMissing && assignment.status !== "cancelled";

  const row = (
    <span className="flex items-center gap-3 py-2.5">
      <LessonStatusIcon status={lesson.status} />
      <Icon size={15} className="shrink-0 text-slate-400" />

      <span className="flex-1 min-w-0">
        <span className="block text-sm text-slate-800 truncate">{lesson.title}</span>
        <span className="flex flex-wrap items-center gap-2 mt-0.5">
          <span className="text-[11px] text-slate-400">
            {CONTENT_TYPE_LABELS[lesson.type] ?? lesson.type}
          </span>
          {lesson.type === "video" && lesson.videoDurationSeconds != null && (
            <span className="text-[11px] text-slate-400">
              {formatDuration(lesson.videoDurationSeconds)}
            </span>
          )}
          {!lesson.mandatory && <span className="text-[11px] text-slate-400">Optional</span>}
          {lesson.type === "video" && lesson.status === "in_progress" && (
            <span className="text-[11px] text-primary-600 font-semibold">
              {lesson.videoPercent}% watched
            </span>
          )}
          {lesson.assessment?.attemptCount > 0 && (
            <span className="text-[11px] text-slate-500">
              Best {lesson.assessment.bestScore}% · {lesson.assessment.attemptCount} attempt
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
        A lesson added to the course after this person was assigned carries no
        record. Said plainly rather than hidden: a lesson that silently vanishes
        makes the course look shorter than it is.
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
    <li>
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
}

// ---------------------------------------------------------------------------
// Assessment results
// ---------------------------------------------------------------------------

function AssessmentResultCard({ courseName, lesson }) {
  const a = lesson.assessment;

  return (
    <article className="bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div className="flex items-start gap-2.5 min-w-0">
          <ClipboardList size={16} className="mt-0.5 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">{lesson.title}</h3>
            <p className="text-xs text-slate-500">{courseName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={a.passed ? "success" : "danger"}>
            {a.passed ? "Passed" : "Not passed"}
          </Badge>
          <span className="text-sm font-bold text-slate-900 tabular-nums">{a.bestScore}%</span>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2.5 w-[90px]">Attempt</th>
              <th className="px-4 py-2.5 w-[90px] text-center">Score</th>
              <th className="px-4 py-2.5 w-[110px]">Result</th>
              <th className="px-4 py-2.5">Correct</th>
              <th className="px-4 py-2.5">Submitted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {a.attempts.map((attempt) => (
              <tr key={attempt.attemptNo}>
                <td className="px-4 py-2.5 font-bold text-slate-700 tabular-nums">
                  #{attempt.attemptNo}
                </td>
                <td
                  className={`px-4 py-2.5 text-center font-bold tabular-nums ${
                    attempt.passed ? "text-success-600" : "text-error-600"
                  }`}
                >
                  {attempt.score}%
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant={attempt.passed ? "success" : "danger"}>
                    {attempt.passed ? "Passed" : "Failed"}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-600 tabular-nums">
                  {attempt.correctCount} of {attempt.questionCount}
                  {/*
                    The bar AS IT WAS when this attempt was sat. Raising the pass
                    mark later must not make a historic pass look like a fail, so
                    the attempt carries its own — and it is shown whenever it
                    differs from the one in force now.
                  */}
                  {attempt.passingPercent != null && (
                    <span className="text-slate-400"> · pass {attempt.passingPercent}%</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {formatInstant(attempt.submittedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        The actionable line for an administrator: somebody who has failed and has
        nothing left is stuck, and no report surfaces that on its own.
      */}
      {!a.passed && a.attemptsRemaining === 0 && (
        <p className="px-4 py-2.5 border-t border-slate-100 bg-amber-50 text-xs font-semibold text-amber-700">
          All {a.maxAttempts} attempt{a.maxAttempts === 1 ? "" : "s"} used without passing — this
          learner cannot progress without help.
        </p>
      )}
      {!a.passed && a.attemptsRemaining !== 0 && (
        <p className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-500">
          {a.attemptsRemaining == null
            ? "Unlimited attempts remain."
            : `${a.attemptsRemaining} attempt(s) remain.`}
        </p>
      )}
    </article>
  );
}

export default LearningPathPage;
