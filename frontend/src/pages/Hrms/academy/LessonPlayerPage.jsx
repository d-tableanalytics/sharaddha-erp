import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  RotateCcw,
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
import { PercentBar, MissingContentNotice, LessonStatusBadge } from "./academyShared";

/**
 * How often the player reports progress, in milliseconds.
 *
 * Ten seconds is a deliberate balance: often enough that closing the tab loses
 * at most ten seconds of credit, rare enough that a forty-minute video is 240
 * requests rather than 2,400.
 */
const HEARTBEAT_MS = 10_000;

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

  /** The next reachable lesson, so "Next" moves without going back to the path. */
  const nextLesson = useMemo(() => {
    if (!assignment || !found) return null;
    const flat = assignment.courses
      .filter((c) => !c.locked)
      .flatMap((c) => c.lessons.filter((l) => l.inAssignment).map((l) => ({ course: c, lesson: l })));
    const index = flat.findIndex((x) => x.lesson.id === lessonId);
    return index >= 0 && index < flat.length - 1 ? flat[index + 1] : null;
  }, [assignment, found, lessonId]);

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

  return (
    <HrmsPageLayout
      title={lesson.title}
      subtitle={course.name}
      breadcrumbs={crumbs}
      actions={
        <div className="flex items-center gap-2">
          <Link to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignmentId}`}>
            <Button size="sm" variant="outline">
              <ArrowLeft size={14} className="mr-1.5" />
              Back to path
            </Button>
          </Link>
          {nextLesson && (
            <Link
              to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignmentId}/lesson/${nextLesson.lesson.id}`}
            >
              <Button size="sm" variant="secondary">
                Next
                <ArrowRight size={14} className="ml-1.5" />
              </Button>
            </Link>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4 max-w-4xl">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{CONTENT_TYPE_LABELS[lesson.type] ?? lesson.type}</Badge>
          <LessonStatusBadge status={lesson.status} />
          {!lesson.mandatory && <Badge variant="neutral">Optional</Badge>}
        </div>

        {lesson.description && (
          <p className="text-sm text-slate-600 leading-relaxed">{lesson.description}</p>
        )}

        {failure && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-error-50 border border-error-200 text-xs text-error-700"
          >
            {failure}
          </div>
        )}

        {lesson.contentMissing ? (
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
        )}
      </div>
    </HrmsPageLayout>
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

  return (
    <div className="flex flex-col gap-3">
      <div className="relative bg-slate-900 rounded-xl overflow-hidden aspect-video max-w-full">
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
            className="w-full h-full"
          >
            Your browser cannot play this video.
          </video>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 p-3.5 bg-white border border-slate-200 rounded-xl shadow-enterprise">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-slate-600">
            Watched <span className="font-bold tabular-nums">{lesson.videoPercent}%</span>
            {lesson.videoDurationSeconds != null && (
              <span className="text-slate-400">
                {" "}
                of {formatDuration(lesson.videoDurationSeconds)}
              </span>
            )}
          </span>
          <span className="text-slate-500">
            {lesson.status === "completed" ? (
              <span className="inline-flex items-center gap-1 font-semibold text-success-600">
                <CheckCircle2 size={13} /> Complete
              </span>
            ) : (
              <>Complete at {required}%</>
            )}
          </span>
        </div>

        <PercentBar percent={lesson.videoPercent} size="sm" />

        {lesson.status !== "completed" && (
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Your progress is measured on how much you have actually watched, not on where the
            playhead is — skipping ahead will not mark this complete. It saves automatically.
          </p>
        )}
      </div>
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
    <div className="flex flex-col gap-3">
      {loading ? (
        <div className="flex items-center justify-center h-64 bg-slate-50 border border-slate-200 rounded-xl">
          <LoadingSpinner size={28} />
        </div>
      ) : isPdf && link ? (
        <object
          data={link.url}
          type="application/pdf"
          aria-label={lesson.title}
          className="w-full h-[55vh] min-h-[380px] bg-slate-100 border border-slate-200 rounded-xl"
        >
          {/* Fallback for a browser with no built-in PDF viewer — mobile Safari
              among them, which is exactly where employees read these. */}
          <div className="flex flex-col items-center justify-center gap-3 h-full p-6 text-center">
            <p className="text-xs text-slate-500">
              Your browser cannot display this PDF inline.
            </p>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline">
                <ExternalLink size={14} className="mr-1.5" />
                Open the document
              </Button>
            </a>
          </div>
        </object>
      ) : link ? (
        <div className="flex flex-col items-center justify-center gap-3 p-8 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center">
          <p className="text-xs text-slate-500">
            This document opens in a new tab.
          </p>
          <a href={link.url} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline">
              <Download size={14} className="mr-1.5" />
              Open {link.name}
            </Button>
          </a>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 p-4 bg-white border border-slate-200 rounded-xl shadow-enterprise">
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
      </div>
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
 */
function QuizLesson({ assignmentId, lesson, onDone, onError }) {
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const history = lesson.assessment;
  const passed = history?.passed;

  const start = async () => {
    setStarting(true);
    onError(null);
    setResult(null);
    try {
      const loaded = await assignmentsApi.startAttempt(assignmentId, lesson.id);
      setQuiz(loaded);
      setAnswers({});
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

  // ---- the result of the attempt just submitted ---------------------------
  if (result) {
    return (
      <div className="flex flex-col gap-4 p-5 bg-white border border-slate-200 rounded-xl shadow-enterprise">
        <div className="flex items-center gap-3">
          <span
            className={`text-3xl font-bold tabular-nums ${
              result.passed ? "text-success-600" : "text-error-600"
            }`}
          >
            {result.score}%
          </span>
          <div>
            <Badge variant={result.passed ? "success" : "danger"}>
              {result.passed ? "Passed" : "Not passed"}
            </Badge>
            <p className="mt-1 text-xs text-slate-500">
              {result.correctCount} of {result.questionCount} correct · pass mark{" "}
              {result.passingPercent}%
            </p>
          </div>
        </div>

        {!result.passed && (
          <p className="text-xs text-slate-600">
            {result.attemptsRemaining === null
              ? "You can retry this assessment."
              : result.attemptsRemaining > 0
                ? `You have ${result.attemptsRemaining} attempt${
                    result.attemptsRemaining === 1 ? "" : "s"
                  } left.`
                : "You have used all of your attempts. Speak to your HR team."}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {!result.passed && result.attemptsRemaining !== 0 && (
            <Button size="sm" loading={starting} onClick={start}>
              <RotateCcw size={14} className="mr-1.5" />
              Try again
            </Button>
          )}
          <Link to={`${HRMS_ROUTE_PREFIX}/academy/learn/${assignmentId}`}>
            <Button size="sm" variant="outline">
              Back to path
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ---- the assessment itself ---------------------------------------------
  if (quiz) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
          <span className="text-xs text-slate-600">
            Attempt {quiz.attemptNo} · pass mark{" "}
            <span className="font-bold">{quiz.passingPercent}%</span>
          </span>
          <span className="text-xs text-slate-500 tabular-nums">
            {answeredCount} of {quiz.questions.length} answered
          </span>
        </div>

        <ol className="flex flex-col gap-4">
          {quiz.questions.map((question, index) => (
            <li
              key={question.id}
              className="p-4 bg-white border border-slate-200 rounded-xl shadow-enterprise"
            >
              <fieldset>
                <legend className="text-sm font-semibold text-slate-900 mb-1">
                  <span className="text-slate-400 mr-1.5">Q{index + 1}.</span>
                  {question.text}
                </legend>
                {question.type === "multiple" && (
                  <p className="text-[11px] text-slate-400 mb-2">Select all that apply.</p>
                )}

                <div className="flex flex-col gap-1.5 mt-2">
                  {question.options.map((option) => {
                    const selected = (answers[question.id] ?? []).includes(option.id);
                    return (
                      <label
                        key={option.id}
                        className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                          selected
                            ? "border-primary-400 bg-primary-50"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type={question.type === "multiple" ? "checkbox" : "radio"}
                          name={question.id}
                          checked={selected}
                          onChange={() => pick(question, option.id)}
                          className="mt-0.5 w-4 h-4 border-slate-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm text-slate-700">{option.text}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-2 sticky bottom-0 py-3 bg-white/90 backdrop-blur border-t border-slate-100">
          <Button size="sm" loading={submitting} onClick={submit}>
            Submit assessment
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setQuiz(null)}>
            Cancel
          </Button>
          {answeredCount < quiz.questions.length && (
            <span className="text-[11px] text-warning-600">
              {quiz.questions.length - answeredCount} unanswered — these count as incorrect.
            </span>
          )}
        </div>
      </div>
    );
  }

  // ---- the landing state, with attempt history ----------------------------
  return (
    <div className="flex flex-col gap-4 p-5 bg-white border border-slate-200 rounded-xl shadow-enterprise">
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

      {!passed && (
        <div>
          <Button size="sm" loading={starting} onClick={start}>
            {history?.attemptCount > 0 ? "Try again" : "Start assessment"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default LessonPlayerPage;
