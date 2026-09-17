import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  RotateCcw,
  ListTree,
  Info,
  Clock,
  Lightbulb,
  PartyPopper,
  XCircle,
  Lock,
} from "lucide-react";

import { HrmsPageLayout } from "../../../components/hrms/HrmsPageLayout";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { ErrorState } from "../../../components/hrms/ErrorState";
import { HRMS_ROUTE_PREFIX } from "@shared/constants/hrms.js";
import {
  assignmentsApi,
  formatDuration,
  CONTENT_TYPE_LABELS,
} from "../../../services/hrms/academy";
import {
  PercentBar,
  MissingContentNotice,
  LessonStatusIcon,
  LESSON_ICONS,
} from "./academyShared";

/**
 * How often the player reports progress, in milliseconds.
 *
 * Ten seconds is a deliberate balance: often enough that closing the tab loses
 * at most ten seconds of credit, rare enough that a forty-minute video is 240
 * requests rather than 2,400.
 */
const HEARTBEAT_MS = 10_000;

/**
 * The size of the viewing area, shared by video, PDF and document previews.
 *
 * ---------------------------------------------------------------------------
 * 🔴 A FIXED HEIGHT, NOT `aspect-video`
 * ---------------------------------------------------------------------------
 * The player used `aspect-video`, and it collapsed to nothing. The media sits
 * inside a column flex container, and a column flex item takes its height from
 * its CONTENT before the aspect ratio is consulted — an empty `<div>` wrapping
 * a `<video>` has no content height, so the ratio never got a width to work
 * from and the player rendered as a sliver.
 *
 * Fixed heights also make the three lesson types interchangeable: switching
 * from a video to a PDF to a document no longer moves everything below the
 * player up and down the page.
 *
 * `<video>` and `<object>` both letterbox inside the box rather than cropping,
 * so a portrait clip or an A4 page is shown whole.
 */
const MEDIA_BOX = "w-full h-[15rem] sm:h-[22rem] xl:h-[26rem]";

/**
 * The lesson player.
 *
 * ---------------------------------------------------------------------------
 * 🔴 WHAT THIS COMPONENT DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not decide whether a lesson is complete, it does not compute a score,
 * and it does not know the answers to a quiz. All three are server concerns,
 * and the API gives this page no vocabulary in which to assert any of them —
 * see `assignment.service.js`. What it renders is whatever the server sent
 * back.
 *
 * That is worth stating because the tempting version of this file marks the
 * video complete in the browser at 90% and POSTs `completed: true`. That
 * version is a checkbox, not a control.
 *
 * ---------------------------------------------------------------------------
 * THE THREE-COLUMN SHELL
 * ---------------------------------------------------------------------------
 * Outline, content, details — the layout the design reference gives this
 * screen. The outline earns its column: a learner working through a twelve
 * lesson path otherwise has to go back to the path page between every lesson to
 * see where they are, and the "next" button alone gives them no map.
 *
 * It collapses below `xl`, where three columns would leave the video too narrow
 * to be worth watching.
 */
export function LessonPlayerPage() {
  const { assignmentId, lessonId } = useParams();
  const navigate = useNavigate();

  const [assignment, setAssignment] = useState(undefined);
  const [error, setError] = useState(null);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setAssignment(await assignmentsApi.get(assignmentId));
    } catch (err) {
      setError(err);
    }
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  /** The lesson, and the course it belongs to, out of the assignment tree. */
  const found = useMemo(() => {
    if (!assignment) return null;
    for (const course of assignment.courses) {
      const lesson = course.lessons.find((l) => l.id === lessonId);
      if (lesson) return { course, lesson };
    }
    return null;
  }, [assignment, lessonId]);

  /**
   * Every reachable lesson in order — the spine of both the outline and the
   * previous/next controls, so the three cannot disagree about what comes next.
   */
  const flat = useMemo(() => {
    if (!assignment) return [];
    return assignment.courses
      .filter((c) => !c.locked)
      .flatMap((c) =>
        c.lessons.filter((l) => l.inAssignment).map((l) => ({ course: c, lesson: l })),
      );
  }, [assignment]);

  const position = flat.findIndex((x) => x.lesson.id === lessonId);
  const prevLesson = position > 0 ? flat[position - 1] : null;
  const nextLesson = position >= 0 && position < flat.length - 1 ? flat[position + 1] : null;

  const crumbs = [
    { label: "HRMS", to: `${HRMS_ROUTE_PREFIX}/dashboard` },
    { label: "SI Academy", to: `${HRMS_ROUTE_PREFIX}/academy/my-learning` },
    {
      label: assignment?.pathName ?? "Learning path",
      to: `${HRMS_ROUTE_PREFIX}/academy/learn/${assignmentId}`,
    },
    { label: found?.lesson.title ?? "Lesson" },
  ];

  const onProgress = useCallback(
    (result) => {
      setAssignment((prev) => {
        if (!prev) return prev;
        // Patch the one lesson in place rather than refetching the whole tree.
        // A refetch on every heartbeat would re-render the video element and
        // lose the playhead, which is the bug this avoids.
        return {
          ...prev,
          status: result.assignmentStatus ?? prev.status,
          courses: prev.courses.map((c) => ({
            ...c,
            lessons: c.lessons.map((l) =>
              l.id === lessonId
                ? {
                    ...l,
                    status: result.status ?? l.status,
                    watchedSeconds: result.watchedSeconds ?? l.watchedSeconds,
                    videoPercent: result.videoPercent ?? l.videoPercent,
                  }
                : l,
            ),
          })),
        };
      });
    },
    [lessonId],
  );

  if (error) return <ErrorState description={error.message} onRetry={load} />;

  if (assignment === undefined) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  if (!found) {
    return (
      <ErrorState
        variant="error"
        description="That lesson is not part of this learning path."
        onRetry={() => navigate(`${HRMS_ROUTE_PREFIX}/academy/learn/${assignmentId}`)}
      />
    );
  }

  const { course, lesson } = found;

  const body = lesson.contentMissing ? (
    <MissingContentNotice />
  ) : lesson.type === "video" ? (
    <VideoLesson
      assignmentId={assignmentId}
      lesson={lesson}
      onProgress={onProgress}
      onError={setFailure}
      onReload={load}
    />
  ) : lesson.type === "quiz" ? (
    <QuizLesson
      assignmentId={assignmentId}
      lesson={lesson}
      onDone={load}
      onError={setFailure}
    />
  ) : (
    <DocumentLesson
      assignmentId={assignmentId}
      lesson={lesson}
      busy={busy}
      setBusy={setBusy}
      onDone={load}
      onError={setFailure}
    />
  );

  return (
    <HrmsPageLayout
      title={lesson.title}
      subtitle={course.name}
      breadcrumbs={crumbs}
      actions={
        <Link to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignmentId}`}>
          <Button size="sm" variant="outline">
            <ArrowLeft size={14} className="mr-1.5" />
            Back to path
          </Button>
        </Link>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)_290px]">
        {/* ---- Outline ---------------------------------------------------- */}
        <CourseOutline
          assignment={assignment}
          activeLessonId={lessonId}
          className="xl:order-1"
        />

        {/* ---- Content ---------------------------------------------------- */}
        <main className="flex flex-col gap-4 min-w-0 xl:order-2">
          {failure && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-error-50 border border-error-200 text-xs text-error-700"
            >
              {failure}
            </div>
          )}

          {body}

          {/* ---- Previous / next ------------------------------------------ */}
          <nav
            aria-label="Lesson navigation"
            className="flex items-center justify-between gap-3 pt-1"
          >
            {prevLesson ? (
              <Link to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignmentId}/lesson/${prevLesson.lesson.id}`}>
                <Button size="sm" variant="outline">
                  <ArrowLeft size={14} className="mr-1.5" />
                  Previous
                </Button>
              </Link>
            ) : (
              <span />
            )}

            {nextLesson ? (
              <Link to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignmentId}/lesson/${nextLesson.lesson.id}`}>
                <Button size="sm">
                  Next Lesson
                  <ArrowRight size={14} className="ml-1.5" />
                </Button>
              </Link>
            ) : (
              <Link to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignmentId}`}>
                <Button size="sm" variant="outline">
                  Finish — back to path
                  <ArrowRight size={14} className="ml-1.5" />
                </Button>
              </Link>
            )}
          </nav>
        </main>

        {/* ---- Details ---------------------------------------------------- */}
        <LessonDetails
          lesson={lesson}
          position={position}
          total={flat.length}
          className="xl:order-3"
        />
      </div>
    </HrmsPageLayout>
  );
}

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

/**
 * The course/lesson tree beside the player.
 *
 * Rendered twice — once as a disclosure for narrow screens and once as a sticky
 * column for wide ones. Only the WRAPPER is duplicated; the tree itself is one
 * component, so the two can never drift.
 *
 * A sticky column rather than a scrolling one: on a path with fifty lessons the
 * outline is taller than the viewport, and an outline that scrolls away as you
 * watch is an outline you have to hunt for.
 */
function CourseOutline({ assignment, activeLessonId, className }) {
  const tree = (
    <ul className="flex flex-col gap-1">
      {assignment.courses.map((course) => (
        <li key={course.courseId}>
          <div className="flex items-center gap-2 px-2 py-1.5">
            {course.locked ? (
              <Lock size={12} className="shrink-0 text-slate-300" aria-label="Locked" />
            ) : course.status === "completed" ? (
              <CheckCircle2 size={12} className="shrink-0 text-success-600" />
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 truncate">
              {course.name}
            </span>
          </div>

          {!course.locked && course.lessons.length > 0 && (
            <ul className="flex flex-col">
              {course.lessons.map((lesson) => {
                const active = lesson.id === activeLessonId;
                const reachable = lesson.inAssignment && assignment.status !== "cancelled";
                const Icon = LESSON_ICONS[lesson.type] ?? LESSON_ICONS.document;

                const inner = (
                  <>
                    <LessonStatusIcon status={lesson.status} size={14} />
                    <Icon size={13} className="shrink-0 text-slate-400" />
                    <span className="flex-1 min-w-0 truncate">{lesson.title}</span>
                  </>
                );

                const shell =
                  "flex items-center gap-2 pl-3 pr-2 py-1.5 ml-1.5 border-l text-xs rounded-r-md transition-colors";

                return (
                  <li key={lesson.id}>
                    {reachable ? (
                      <Link
                        to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignment.id}/lesson/${lesson.id}`}
                        aria-current={active ? "page" : undefined}
                        className={`${shell} ${
                          active
                            ? "border-primary-500 bg-primary-50 text-primary-800 font-semibold"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className={`${shell} border-slate-200 text-slate-400`}>{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {/* Narrow: a disclosure, closed by default. The video is what they came
          for; the map is one tap away when they want it. */}
      <details className="xl:hidden bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden">
        <summary className="flex items-center gap-2 px-4 py-3 text-sm font-bold text-slate-900 cursor-pointer select-none hover:bg-slate-50">
          <ListTree size={15} className="text-slate-400" />
          Course Content
          <span className="ml-auto text-[11px] font-semibold text-slate-400">
            {assignment.percent}% complete
          </span>
        </summary>
        <div className="px-3 pb-3 border-t border-slate-100 pt-2">{tree}</div>
      </details>

      <aside className={`hidden xl:block ${className ?? ""}`}>
        <nav
          aria-label="Course content"
          className="sticky top-4 bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden"
        >
          <header className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Course Content</h2>
            <div className="flex items-center gap-2 mt-2">
              <PercentBar percent={assignment.percent} size="sm" className="flex-1" />
              <span className="text-[11px] font-bold text-slate-600 tabular-nums">
                {assignment.percent}%
              </span>
            </div>
          </header>
          <div className="p-2 max-h-[60vh] overflow-y-auto">{tree}</div>
        </nav>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Details rail
// ---------------------------------------------------------------------------

/** One fact in the details rail. */
function DetailRow({ icon: Icon, children, tone = "neutral" }) {
  const tint =
    tone === "primary"
      ? "text-primary-600"
      : tone === "success"
        ? "text-success-600"
        : "text-slate-400";

  return (
    <li className="flex items-start gap-2.5">
      <Icon size={14} className={`mt-0.5 shrink-0 ${tint}`} />
      <span className="text-xs text-slate-600 leading-relaxed">{children}</span>
    </li>
  );
}

/**
 * What this lesson expects of the learner.
 *
 * The reference's right-hand panel. It states the COMPLETION RULE up front —
 * "complete automatically at 90% watch time" — which is the single question a
 * learner asks of a lesson they are part-way through, and the one the old
 * layout answered in a footnote under the video.
 *
 * For a quiz it becomes the reference's "Quiz Details" panel: the rules of the
 * assessment stated before it is started rather than discovered during it.
 */
function LessonDetails({ lesson, position, total, className }) {
  const isQuiz = lesson.type === "quiz";
  const a = lesson.assessment;

  return (
    <aside className={`flex flex-col gap-4 min-w-0 ${className ?? ""}`}>
      <section className="bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden">
        <header className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">
            {isQuiz ? "Quiz Details" : "Details"}
          </h2>
        </header>

        <div className="p-4">
          {isQuiz ? (
            <dl className="flex flex-col gap-3">
              <Fact label="Pass Mark" value={a?.passingPercent != null ? `${a.passingPercent}%` : "—"} />
              <Fact
                label="Attempt Limit"
                value={
                  a?.maxAttempts
                    ? `${a.maxAttempts} attempt${a.maxAttempts === 1 ? "" : "s"}`
                    : "Unlimited"
                }
              />
              <Fact label="Questions" value={a?.questionCount ?? "—"} />
              <Fact
                label="Scoring"
                value={a?.scorePolicy === "latest" ? "Latest attempt" : "Best attempt"}
              />
              <Fact
                label="Attempts used"
                value={
                  a?.maxAttempts
                    ? `${a.attemptCount ?? 0} of ${a.maxAttempts}`
                    : (a?.attemptCount ?? 0)
                }
              />
            </dl>
          ) : (
            <ul className="flex flex-col gap-3">
              {position >= 0 && (
                <DetailRow icon={Info}>
                  Lesson {position + 1} of {total}
                </DetailRow>
              )}

              {lesson.type === "video" ? (
                <DetailRow icon={Info}>
                  Marked complete automatically at{" "}
                  <span className="font-semibold text-slate-800">
                    {lesson.videoCompletionPercent ?? 90}%
                  </span>{" "}
                  watch time
                </DetailRow>
              ) : (
                <DetailRow icon={Info}>
                  Marked complete when you confirm you have read it
                </DetailRow>
              )}

              <DetailRow icon={Info}>
                This lesson is{" "}
                <span className="font-semibold text-slate-800">
                  {lesson.mandatory ? "mandatory" : "optional"}
                </span>
              </DetailRow>

              {lesson.status === "completed" && (
                <DetailRow icon={CheckCircle2} tone="success">
                  You have completed this lesson
                </DetailRow>
              )}
            </ul>
          )}
        </div>
      </section>

      {/*
        The encouragement panel from the reference.

        It carries a real instruction rather than a slogan — what to do to
        finish this lesson — so it is worth the space it takes. A box that only
        says "keep going!" is decoration.
      */}
      {lesson.status !== "completed" && !isQuiz && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-primary-50 border border-primary-100">
          <Lightbulb size={15} className="mt-0.5 shrink-0 text-primary-600" />
          <p className="text-xs text-primary-800 leading-relaxed">
            {lesson.type === "video" ? (
              <>
                <span className="font-semibold">You're on the right track.</span> Progress is
                measured on how much you have actually watched — skipping ahead will not complete
                this lesson.
              </>
            ) : (
              <>
                <span className="font-semibold">Almost there.</span> Read the document, then
                confirm below to mark this lesson complete.
              </>
            )}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[11px] text-slate-500">
        {lesson.type === "video" && lesson.videoDurationSeconds != null && (
          <span className="inline-flex items-center gap-1.5">
            <Clock size={12} className="text-slate-400" />
            {formatDuration(lesson.videoDurationSeconds)}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          {(() => {
            const Icon = LESSON_ICONS[lesson.type] ?? LESSON_ICONS.document;
            return <Icon size={12} className="text-slate-400" />;
          })()}
          {CONTENT_TYPE_LABELS[lesson.type] ?? lesson.type}
        </span>
      </div>
    </aside>
  );
}

/** A label/value pair in the quiz details panel. */
function Fact({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-xs font-bold text-slate-900 tabular-nums text-right">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

/**
 * A video lesson.
 *
 * ---------------------------------------------------------------------------
 * THE HEARTBEAT SENDS A DELTA, AND WHY THAT MATTERS
 * ---------------------------------------------------------------------------
 * `watchedDeltaSeconds` is how much genuinely NEW material played since the
 * last report — accumulated from `timeupdate` and reset on each send. The
 * server clamps it against wall-clock elapsed, so it cannot be inflated.
 *
 * Seeking does NOT contribute: the delta is only incremented when the playhead
 * advances by roughly the amount of real time that passed, so dragging the
 * scrubber forward moves the position and adds nothing to the credit. That
 * check is here as an optimisation — it keeps the request honest — and it is
 * re-applied on the server, which is where it actually binds.
 */
function VideoLesson({ assignmentId, lesson, onProgress, onError, onReload }) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);

  const videoRef = useRef(null);
  const pendingRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    assignmentsApi
      .contentUrl(assignmentId, lesson.id)
      .then(({ url }) => {
        if (!cancelled) setSrc(url);
      })
      .catch((err) => {
        if (!cancelled) onError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, lesson.id, onError]);

  /** Push whatever has accumulated. Shared by the timer and the unmount flush. */
  const flush = useCallback(async () => {
    const video = videoRef.current;
    const delta = pendingRef.current;
    if (!video || delta <= 0) return;
    pendingRef.current = 0;

    try {
      const result = await assignmentsApi.videoProgress(assignmentId, lesson.id, {
        positionSeconds: Math.floor(video.currentTime),
        watchedDeltaSeconds: Math.round(delta),
      });
      onProgress(result);
    } catch (err) {
      // A dropped heartbeat is not worth interrupting playback for; the next
      // one carries on. A persistent failure surfaces when the learner tries
      // to move on and the lesson is still incomplete.
      console.warn("[academy] video progress failed:", err.message);
    }
  }, [assignmentId, lesson.id, onProgress]);

  useEffect(() => {
    const id = setInterval(flush, HEARTBEAT_MS);
    return () => {
      clearInterval(id);
      // One last send on the way out, so closing the tab does not discard the
      // last few seconds.
      flush();
    };
  }, [flush]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const now = video.currentTime;
    const advanced = now - lastTimeRef.current;
    lastTimeRef.current = now;
    // Only forward movement of a plausible size counts. A jump is a seek.
    if (advanced > 0 && advanced < 2) pendingRef.current += advanced;
  };

  /** Resume where they left off, once the metadata says the seek is legal. */
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const resumeAt = Number(lesson.lastPositionSeconds ?? 0);
    if (resumeAt > 0 && resumeAt < video.duration - 1) {
      video.currentTime = resumeAt;
      lastTimeRef.current = resumeAt;
    }
  };

  const required = lesson.videoCompletionPercent ?? 90;
  const done = lesson.status === "completed";

  return (
    <div className="flex flex-col gap-4">
      <div className={`relative bg-slate-900 rounded-xl overflow-hidden ${MEDIA_BOX}`}>
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner size={28} />
          </div>
        ) : src ? (
          <video
            ref={videoRef}
            src={src}
            controls
            controlsList="nodownload"
            playsInline
            preload="metadata"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPause={flush}
            onEnded={() => {
              flush().then(onReload);
            }}
            className="w-full h-full object-contain"
          >
            Your browser cannot play this video.
          </video>
        ) : null}
      </div>

      <section className="flex flex-col gap-3 p-4 bg-white border border-slate-200 rounded-xl shadow-enterprise">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-base font-bold text-slate-900">{lesson.title}</h2>
          {done ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-600">
              <CheckCircle2 size={14} /> Complete
            </span>
          ) : (
            <span className="text-xs text-slate-500">Complete at {required}%</span>
          )}
        </div>

        {lesson.description && (
          <p className="text-sm text-slate-600 leading-relaxed">{lesson.description}</p>
        )}

        <div className="flex items-center gap-2.5">
          <PercentBar percent={lesson.videoPercent} size="sm" className="flex-1" />
          <span className="text-xs font-bold text-slate-700 tabular-nums">
            {lesson.videoPercent}%
          </span>
          {lesson.videoDurationSeconds != null && (
            <span className="text-[11px] text-slate-400 whitespace-nowrap">
              of {formatDuration(lesson.videoDurationSeconds)}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PDF / document
// ---------------------------------------------------------------------------

/**
 * A PDF or document lesson.
 *
 * A PDF is embedded so it can be read without leaving the page; anything else
 * is opened in a new tab, because a browser will not render a .docx inline and
 * an empty frame reads as a broken page.
 *
 * The presigned URL is fetched on demand and refreshed if the learner lingers:
 * these expire in five minutes, and an `<object>` whose URL died shows nothing
 * with no explanation.
 */
function DocumentLesson({ assignmentId, lesson, busy, setBusy, onDone, onError }) {
  const [link, setLink] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);

  const fetchLink = useCallback(async () => {
    setLoading(true);
    try {
      setLink(await assignmentsApi.contentUrl(assignmentId, lesson.id));
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [assignmentId, lesson.id, onError]);

  useEffect(() => {
    fetchLink();
  }, [fetchLink]);

  const complete = async () => {
    setBusy(true);
    onError(null);
    try {
      await assignmentsApi.completeLesson(assignmentId, lesson.id);
      onDone();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const isPdf = lesson.mimeType === "application/pdf" || lesson.type === "pdf";
  const done = lesson.status === "completed";

  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <div className={`${MEDIA_BOX} flex items-center justify-center bg-slate-50 border border-slate-200 rounded-xl`}>
          <LoadingSpinner size={28} />
        </div>
      ) : isPdf && link ? (
        <object
          data={link.url}
          type="application/pdf"
          aria-label={lesson.title}
          className={`${MEDIA_BOX} bg-slate-100 border border-slate-200 rounded-xl`}
        >
          {/* Fallback for a browser with no built-in PDF viewer — mobile Safari
              among them, which is exactly where employees read these. */}
          <div className="flex flex-col items-center justify-center gap-3 h-full p-6 text-center">
            <p className="text-xs text-slate-500">Your browser cannot display this PDF inline.</p>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline">
                <ExternalLink size={14} className="mr-1.5" />
                Open the document
              </Button>
            </a>
          </div>
        </object>
      ) : link ? (
        <div className={`${MEDIA_BOX} flex flex-col items-center justify-center gap-3 p-8 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center`}>
          <p className="text-xs text-slate-500">This document opens in a new tab.</p>
          <a href={link.url} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline">
              <Download size={14} className="mr-1.5" />
              Open {link.name}
            </Button>
          </a>
        </div>
      ) : null}

      <section className="flex flex-col gap-3 p-4 bg-white border border-slate-200 rounded-xl shadow-enterprise">
        <h2 className="text-base font-bold text-slate-900">{lesson.title}</h2>
        {lesson.description && (
          <p className="text-sm text-slate-600 leading-relaxed">{lesson.description}</p>
        )}

        {done ? (
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-600">
            <CheckCircle2 size={14} />
            You marked this as read.
          </p>
        ) : (
          <>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-slate-700">
                I have read and understood this document.
              </span>
            </label>

            <div className="flex items-center gap-2">
              <Button size="sm" disabled={!acknowledged} loading={busy} onClick={complete}>
                Mark as complete
              </Button>
              {link && (
                <Button size="xs" variant="ghost" onClick={fetchLink}>
                  <RotateCcw size={12} className="mr-1" />
                  Refresh link
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

/**
 * A quiz lesson.
 *
 * The questions arrive WITHOUT their answers — the server strips `isCorrect`
 * before they leave, so there is nothing in this component's props to cheat
 * with. The submission carries only the option ids that were ticked, and the
 * score that comes back was computed server-side.
 *
 * A failed attempt shows WHICH questions were wrong and not what the right
 * answers were: handing those back would make a retry a transcription exercise.
 *
 * ---------------------------------------------------------------------------
 * ONE QUESTION AT A TIME
 * ---------------------------------------------------------------------------
 * The design reference paginates the attempt — "Question 4 of 10" with Previous
 * and Next — rather than scrolling every question onto one page. Worth
 * following: a single question with four options is a decision, and twenty of
 * them stacked vertically is a form, which is the difference between reading
 * each one and skimming to the end.
 *
 * 🔴 The answers are still submitted in ONE request at the end. Paginating the
 * display must not turn into paginating the submission — a per-question POST
 * would let a learner discover their score question by question.
 */
function QuizLesson({ assignmentId, lesson, onDone, onError }) {
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [reviewed, setReviewed] = useState(null);
  const [review, setReview] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const history = lesson.assessment;
  const passed = history?.passed;

  const start = async () => {
    setStarting(true);
    onError(null);
    setResult(null);
    setReview(false);
    setReviewed(null);
    try {
      const loaded = await assignmentsApi.startAttempt(assignmentId, lesson.id);
      setQuiz(loaded);
      setAnswers({});
      setIndex(0);
    } catch (err) {
      onError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const pick = (question, optionId) => {
    setAnswers((prev) => {
      if (question.type === "multiple") {
        const current = new Set(prev[question.id] ?? []);
        if (current.has(optionId)) current.delete(optionId);
        else current.add(optionId);
        return { ...prev, [question.id]: [...current] };
      }
      return { ...prev, [question.id]: [optionId] };
    });
  };

  const submit = async () => {
    setSubmitting(true);
    onError(null);
    try {
      const payload = quiz.questions.map((q) => ({
        questionId: q.id,
        selectedOptionIds: answers[q.id] ?? [],
      }));
      const outcome = await assignmentsApi.submitAttempt(assignmentId, lesson.id, payload);
      setResult(outcome);
      // The questions and what was ticked are kept so "Review answers" has
      // something to show. They are NOT re-submittable — `quiz` is cleared, so
      // the attempt is over as far as this component is concerned.
      setReviewed({ questions: quiz.questions, answers });
      setQuiz(null);
      onDone();
    } catch (err) {
      onError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const answeredCount = quiz
    ? quiz.questions.filter((q) => (answers[q.id] ?? []).length > 0).length
    : 0;

  // ---- reviewing the attempt just submitted -------------------------------
  if (result && review && reviewed) {
    return (
      <AttemptReview
        result={result}
        reviewed={reviewed}
        onBack={() => setReview(false)}
      />
    );
  }

  // ---- the result of the attempt just submitted ---------------------------
  if (result) {
    return (
      <AttemptResult
        result={result}
        assignmentId={assignmentId}
        canReview={Boolean(reviewed)}
        onReview={() => setReview(true)}
        onRetry={start}
        retrying={starting}
      />
    );
  }

  // ---- the assessment itself ---------------------------------------------
  if (quiz) {
    const question = quiz.questions[index];
    const selected = answers[question.id] ?? [];
    const last = index === quiz.questions.length - 1;

    return (
      <div className="flex flex-col gap-4">
        <section className="bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">
              Question {index + 1} of {quiz.questions.length}
            </h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {answeredCount} answered · pass mark{" "}
              <span className="font-bold text-slate-700">{quiz.passingPercent}%</span>
            </span>
          </header>

          {/* A progress bar over the QUESTIONS, not the score. It is the one
              honest measure available mid-attempt. */}
          <PercentBar
            percent={((index + 1) / quiz.questions.length) * 100}
            size="sm"
            className="rounded-none"
          />

          <div className="p-4 sm:p-5">
            <fieldset>
              <legend className="text-sm font-semibold text-slate-900 mb-1">{question.text}</legend>
              {question.type === "multiple" && (
                <p className="text-[11px] text-slate-400 mb-1">Select all that apply.</p>
              )}

              <div className="flex flex-col gap-2 mt-3">
                {question.options.map((option) => {
                  const on = selected.includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className={`flex items-center gap-3 px-3.5 py-3 rounded-lg border cursor-pointer transition-colors ${
                        on
                          ? "border-primary-500 bg-primary-50 ring-1 ring-primary-200"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type={question.type === "multiple" ? "checkbox" : "radio"}
                        name={question.id}
                        checked={on}
                        onChange={() => pick(question, option.id)}
                        className="w-4 h-4 border-slate-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-slate-700">{option.text}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/60 border-t border-slate-100">
            <Button
              size="sm"
              variant="outline"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              <ArrowLeft size={14} className="mr-1.5" />
              Previous
            </Button>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setQuiz(null)}>
                Cancel
              </Button>
              {last ? (
                <Button size="sm" loading={submitting} onClick={submit}>
                  Submit assessment
                </Button>
              ) : (
                <Button size="sm" onClick={() => setIndex((i) => i + 1)}>
                  Next
                  <ArrowRight size={14} className="ml-1.5" />
                </Button>
              )}
            </div>
          </footer>
        </section>

        {/* The question map. On a twenty question attempt, "which have I not
            answered yet" is otherwise twenty clicks to find out. */}
        <nav
          aria-label="Questions"
          className="flex flex-wrap gap-1.5 p-3.5 bg-white border border-slate-200 rounded-xl shadow-enterprise"
        >
          {quiz.questions.map((q, i) => {
            const done = (answers[q.id] ?? []).length > 0;
            const here = i === index;
            return (
              <button
                key={q.id}
                type="button"
                aria-label={`Question ${i + 1}${done ? ", answered" : ", not answered"}`}
                aria-current={here ? "true" : undefined}
                onClick={() => setIndex(i)}
                className={`w-8 h-8 rounded-lg text-xs font-bold tabular-nums transition-colors ${
                  here
                    ? "bg-primary-600 text-white"
                    : done
                      ? "bg-primary-50 text-primary-700 border border-primary-200"
                      : "bg-slate-50 text-slate-400 border border-slate-200 hover:border-slate-300"
                }`}
              >
                {i + 1}
              </button>
            );
          })}

          {answeredCount < quiz.questions.length && (
            <span className="ml-auto self-center text-[11px] text-warning-600">
              {quiz.questions.length - answeredCount} unanswered — these count as incorrect.
            </span>
          )}
        </nav>
      </div>
    );
  }

  // ---- the landing state, with attempt history ----------------------------
  return (
    <section className="flex flex-col gap-4 p-4 sm:p-5 bg-white border border-slate-200 rounded-xl shadow-enterprise">
      <h2 className="text-base font-bold text-slate-900">{lesson.title}</h2>

      {passed ? (
        <div className="flex items-center gap-2.5">
          <CheckCircle2 size={18} className="text-success-600" />
          <p className="text-sm text-slate-700">
            You passed with <span className="font-bold">{history.bestScore}%</span>.
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          {history?.attemptCount > 0
            ? "You have not passed this assessment yet."
            : "Answer every question and submit. Your score is calculated when you submit."}
        </p>
      )}

      {history?.attempts?.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {history.attempts.map((attempt) => (
            <li
              key={attempt.attemptNo}
              className="flex items-center justify-between gap-3 px-3 py-2 text-xs bg-slate-50 rounded-lg"
            >
              <span className="text-slate-600">Attempt {attempt.attemptNo}</span>
              <span className="tabular-nums font-semibold text-slate-700">{attempt.score}%</span>
              <Badge variant={attempt.passed ? "success" : "danger"}>
                {attempt.passed ? "Passed" : "Failed"}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {/*
        `attemptsRemaining === 0` is the one case that must NOT offer the
        button. It arrives from the server, computed by the same function the
        submit endpoint gates on, so what is offered here and what is accepted
        there cannot drift. `null` means unlimited and still offers it.
      */}
      {!passed && history?.attemptsRemaining === 0 ? (
        <p className="text-xs text-slate-500">
          You have used all {history.maxAttempts} attempt
          {history.maxAttempts === 1 ? "" : "s"} at this assessment. Speak to your HR team.
        </p>
      ) : (
        !passed && (
          <div>
            {history?.attemptsRemaining != null && (
              <p className="mb-2 text-xs text-slate-500">
                {history.attemptsRemaining} attempt
                {history.attemptsRemaining === 1 ? "" : "s"} left.
              </p>
            )}
            <Button size="md" loading={starting} onClick={start}>
              {history?.attemptCount > 0 ? "Try again" : "Start assessment"}
            </Button>
          </div>
        )
      )}
    </section>
  );
}

/**
 * The result of an attempt, as the reference draws it: the outcome first and
 * large, then the three figures behind it, then what to do next.
 *
 * ---------------------------------------------------------------------------
 * 🔴 THE THIRD FIGURE IS THE ATTEMPT NUMBER, NOT TIME TAKEN
 * ---------------------------------------------------------------------------
 * The reference's third tile is "Time Taken — 1m 28s". Nothing records it: an
 * `AcademyAttempt` carries `submittedAt` and no start, because an attempt row is
 * only written on submission.
 *
 * Measuring it in the browser would produce a figure that disappears on
 * refresh, that HR never sees on the same attempt in Assessment results, and
 * that any learner could alter — three ways of being wrong for a number that
 * decides nothing. The attempt number is real, persisted, and the thing a
 * learner on their second of three attempts actually needs to see.
 */
function AttemptResult({ result, assignmentId, canReview, onReview, onRetry, retrying }) {
  const { passed, score, correctCount, questionCount, passingPercent, attemptNo } = result;

  return (
    <section className="flex flex-col items-center gap-5 px-4 sm:px-6 py-8 bg-white border border-slate-200 rounded-xl shadow-enterprise text-center">
      <span
        className={`inline-flex items-center justify-center w-16 h-16 rounded-full ${
          passed ? "bg-success-50 text-success-600" : "bg-error-50 text-error-500"
        }`}
      >
        {passed ? <PartyPopper size={30} strokeWidth={1.5} /> : <XCircle size={30} strokeWidth={1.5} />}
      </span>

      <div>
        <h2 className="text-xl font-bold text-slate-900">Assessment Completed</h2>
        <p className="mt-1 text-sm text-slate-500">
          Your score:{" "}
          <span
            className={`text-lg font-bold tabular-nums ${
              passed ? "text-success-600" : "text-error-600"
            }`}
          >
            {score}%
          </span>
        </p>
      </div>

      <div
        className={`w-full max-w-md px-4 py-3 rounded-xl border ${
          passed
            ? "bg-success-50 border-success-200 text-success-600"
            : "bg-error-50 border-error-200 text-error-600"
        }`}
      >
        <p className="inline-flex items-center gap-1.5 text-sm font-bold">
          {passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {passed ? "Passed" : "Not passed"}
        </p>
        <p className="mt-0.5 text-xs opacity-90">
          {passed
            ? "You have met the pass mark for this assessment."
            : `The pass mark for this assessment is ${passingPercent}%.`}
        </p>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-md">
        <ResultStat label="Questions" value={`${correctCount} / ${questionCount}`} />
        <ResultStat label="Score" value={`${score}%`} />
        <ResultStat label="Attempt" value={`#${attemptNo}`} />
      </dl>

      {!passed && (
        <p className="text-xs text-slate-500">
          {result.attemptsRemaining === null
            ? "You can retry this assessment."
            : result.attemptsRemaining > 0
              ? `You have ${result.attemptsRemaining} attempt${
                  result.attemptsRemaining === 1 ? "" : "s"
                } left.`
              : "You have used all of your attempts. Speak to your HR team."}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {canReview && (
          <Button size="md" variant="outline" onClick={onReview}>
            Review Answers
          </Button>
        )}
        {!passed && result.attemptsRemaining !== 0 && (
          <Button size="md" variant="outline" loading={retrying} onClick={onRetry}>
            <RotateCcw size={14} className="mr-1.5" />
            Try again
          </Button>
        )}
        <Link to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignmentId}`}>
          <Button size="md">Back to Learning Path</Button>
        </Link>
      </div>
    </section>
  );
}

function ResultStat({ label, value }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl">
      <dd className="text-base font-bold text-slate-900 tabular-nums">{value}</dd>
      <dt className="text-[11px] text-slate-500">{label}</dt>
    </div>
  );
}

/**
 * Which questions were right and which were wrong.
 *
 * ---------------------------------------------------------------------------
 * 🔴 WHAT WAS PICKED, NEVER WHAT WAS CORRECT
 * ---------------------------------------------------------------------------
 * The server sends `results: [{ questionId, correct }]` and deliberately does
 * NOT send the right answers — so a wrong question here shows the learner the
 * option THEY chose, marked wrong, and nothing else. There is no correct answer
 * anywhere in this component's props to leak.
 *
 * Without that rule a retry becomes a transcription exercise, and the score
 * stops meaning anything.
 */
function AttemptReview({ result, reviewed, onBack }) {
  const verdict = new Map((result.results ?? []).map((r) => [r.questionId, r.correct]));

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Review answers</h2>
          <p className="text-xs text-slate-500">
            Attempt #{result.attemptNo} · {result.correctCount} of {result.questionCount} correct
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onBack}>
          <ArrowLeft size={14} className="mr-1.5" />
          Back to result
        </Button>
      </header>

      <p className="px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
        Correct answers are not shown — revisit the lesson material before your next attempt.
      </p>

      <ol className="flex flex-col gap-3">
        {reviewed.questions.map((question, i) => {
          const correct = verdict.get(question.id);
          const picked = new Set(reviewed.answers[question.id] ?? []);

          return (
            <li
              key={question.id}
              className={`p-4 bg-white border rounded-xl shadow-enterprise ${
                correct ? "border-success-200" : "border-error-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <p className="text-sm font-semibold text-slate-900">
                  <span className="text-slate-400 mr-1.5">Q{i + 1}.</span>
                  {question.text}
                </p>
                <Badge variant={correct ? "success" : "danger"} className="shrink-0">
                  {correct ? "Correct" : "Incorrect"}
                </Badge>
              </div>

              <ul className="flex flex-col gap-1.5">
                {question.options.map((option) => {
                  const chosen = picked.has(option.id);
                  return (
                    <li
                      key={option.id}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm ${
                        chosen
                          ? correct
                            ? "border-success-200 bg-success-50 text-success-600"
                            : "border-error-200 bg-error-50 text-error-600"
                          : "border-slate-200 text-slate-500"
                      }`}
                    >
                      <span className="text-[11px] font-bold uppercase tracking-wide w-16 shrink-0">
                        {chosen ? "Your pick" : ""}
                      </span>
                      <span>{option.text}</span>
                    </li>
                  );
                })}
              </ul>

              {picked.size === 0 && (
                <p className="mt-2 text-[11px] text-slate-400">
                  You did not answer this question.
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default LessonPlayerPage;
