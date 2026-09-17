import { twMerge } from "tailwind-merge";
import {
  FileText,
  Lock,
  CheckCircle2,
  Circle,
  PlayCircle,
  ClipboardList,
  AlertTriangle,
} from "lucide-react";

import { Badge } from "../../../components/ui/Badge";
import {
  ASSIGNMENT_STATUS_TONES,
  DUE_STATE_TONES,
  LESSON_STATUS_TONES,
  formatDay,
} from "../../../services/hrms/academy";

/**
 * Pieces shared by the Academy screens.
 *
 * Built from the portal's own primitives — Badge, the Tailwind palette, the
 * lucide icon set — rather than introducing anything new. `components/hrms`
 * already states the rule: duplicating the UI kit would give one module a
 * second visual language inside the same application.
 *
 * Nothing here is Academy-specific styling. It is Academy-specific VOCABULARY
 * rendered in the existing style: a percentage bar, a lock, a lesson icon.
 */

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * A percentage bar.
 *
 * Distinct from `onboarding/ProgressBar`, which takes completed/total and shows
 * "3 / 7". This one takes a PERCENT, because that is what the server computes
 * and what every Academy surface displays — deriving the count back out of a
 * percentage to feed the other component would be arithmetic in the wrong
 * direction.
 *
 * `role="progressbar"` with the aria value attributes, so the number reaches a
 * screen reader and not only the eye — the same reasoning that component
 * records.
 */
export function PercentBar({ percent = 0, tone, className, size = "md" }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const done = value >= 100;

  const fill =
    tone === "danger"
      ? "bg-error-500"
      : tone === "warning"
        ? "bg-warning-500"
        : done
          ? "bg-success-600"
          : "bg-primary-600";

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${value}% complete`}
      className={twMerge(
        "relative w-full rounded-full bg-slate-200 overflow-hidden",
        size === "sm" ? "h-1.5" : size === "lg" ? "h-2.5" : "h-2",
        className,
      )}
    >
      <div
        className={twMerge("absolute inset-y-0 left-0 rounded-full transition-all", fill)}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

/** The bar with its number beside it, the shape most cards want. */
export function ProgressRow({ percent = 0, completed, total, tone, className }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className={twMerge("flex items-center gap-3", className)}>
      <PercentBar percent={value} tone={tone} className="flex-1" />
      <span className="text-xs font-bold text-slate-700 tabular-nums whitespace-nowrap">
        {value}%
      </span>
      {total != null && (
        <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
          {completed}/{total}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const ASSIGNMENT_LABELS = {
  assigned: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * One pill that tells the whole story.
 *
 * OVERDUE WINS over the status, deliberately. An overdue assignment is
 * technically `in_progress`, and rendering "In progress" beside a date three
 * weeks past is the single most misleading thing this screen could do — the
 * person reading it needs to see the problem, not the category.
 *
 * `HrmsStatusBadge` is not reused here for that reason: it maps a status to a
 * tone, and this has to weigh two fields against each other.
 */
export function AcademyStatusBadge({ status, dueState, className }) {
  if (dueState === "overdue" && status !== "completed" && status !== "cancelled") {
    return (
      <Badge variant="danger" className={className}>
        Overdue
      </Badge>
    );
  }
  return (
    <Badge variant={ASSIGNMENT_STATUS_TONES[status] ?? "neutral"} className={className}>
      {ASSIGNMENT_LABELS[status] ?? status}
    </Badge>
  );
}

/**
 * The due date, in the words section 10 asks for.
 *
 * The LABEL comes from the server (`deriveDueState`), so "Due in 5 days",
 * "Due tomorrow" and "Overdue by 2 days" are computed in one place and cannot
 * disagree between a list row and a detail page.
 */
export function DueLabel({ dueState, dueLabel, dueDate, className }) {
  if (!dueLabel) return <span className={twMerge("text-slate-400", className)}>—</span>;

  const tone =
    DUE_STATE_TONES[dueState] === "danger"
      ? "text-error-600 font-semibold"
      : DUE_STATE_TONES[dueState] === "warning"
        ? "text-warning-600 font-semibold"
        : "text-slate-600";

  return (
    <span className={twMerge("text-xs", tone, className)} title={dueDate ? formatDay(dueDate) : undefined}>
      {dueLabel}
    </span>
  );
}

/** Mandatory vs optional, so the distinction section 8 asks for is always visible. */
export function MandatoryBadge({ mandatory, className }) {
  return mandatory ? (
    <Badge variant="primary" className={className}>
      Mandatory
    </Badge>
  ) : (
    <Badge variant="neutral" className={className}>
      Optional
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export const LESSON_ICONS = {
  video: PlayCircle,
  pdf: FileText,
  document: FileText,
  quiz: ClipboardList,
};

/** The lesson's state, as one icon. Completed / in progress / not started. */
export function LessonStatusIcon({ status, className, size = 16 }) {
  if (status === "completed") {
    return (
      <CheckCircle2
        size={size}
        aria-label="Completed"
        className={twMerge("text-success-600 shrink-0", className)}
      />
    );
  }
  if (status === "in_progress") {
    return (
      <Circle
        size={size}
        aria-label="In progress"
        className={twMerge("text-primary-600 fill-primary-100 shrink-0", className)}
      />
    );
  }
  return (
    <Circle
      size={size}
      aria-label="Not started"
      className={twMerge("text-slate-300 shrink-0", className)}
    />
  );
}

export function LessonStatusBadge({ status, className }) {
  const labels = { not_started: "Not started", in_progress: "In progress", completed: "Completed" };
  return (
    <Badge variant={LESSON_STATUS_TONES[status] ?? "neutral"} className={className}>
      {labels[status] ?? status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Locked and missing states
// ---------------------------------------------------------------------------

/**
 * Why a course is locked.
 *
 * NAMES the blocking course. Section 9 asks that the employee "can see why it
 * is locked", and a padlock with no explanation is the version of this that
 * generates a helpdesk ticket.
 */
export function LockedNotice({ lockedBy, className }) {
  return (
    <div
      className={twMerge(
        "flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200",
        className,
      )}
    >
      <Lock size={15} className="mt-0.5 shrink-0 text-slate-400" />
      <p className="text-xs text-slate-600 leading-relaxed">
        {lockedBy ? (
          <>
            Locked. Complete <span className="font-semibold text-slate-800">{lockedBy}</span> to
            unlock this course.
          </>
        ) : (
          "Locked until its prerequisite course is complete."
        )}
      </p>
    </div>
  );
}

/**
 * Content that has been removed from the library.
 *
 * Shown rather than hidden, because a lesson that silently disappears makes a
 * course quietly shorter — section 24's "missing content" case. The learner is
 * told it is a system problem rather than left staring at a blank player.
 */
export function MissingContentNotice({ className }) {
  return (
    <div
      className={twMerge(
        "flex items-start gap-2.5 p-3 rounded-lg bg-warning-50 border border-warning-200",
        className,
      )}
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning-600" />
      <p className="text-xs text-warning-700 leading-relaxed">
        The material for this lesson is unavailable. Your HR team has been able to see this too —
        your progress is safe and nothing you have already completed is affected.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * The tone palette. Shared by the accent bar and the icon tile so a given tone
 * means the same colour wherever it lands.
 */
const TONE_BAR = {
  neutral: "bg-slate-300",
  primary: "bg-primary-500",
  success: "bg-success-600",
  warning: "bg-warning-500",
  danger: "bg-error-500",
};

const TONE_TILE = {
  neutral: "bg-slate-100 text-slate-600",
  primary: "bg-primary-50 text-primary-700",
  success: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-600",
  danger: "bg-error-50 text-error-500",
};

/**
 * One Academy number.
 *
 * ---------------------------------------------------------------------------
 * THE TONE IS NEVER THE NUMBER
 * ---------------------------------------------------------------------------
 * This once tinted the figure itself - an overdue count rendered in red text.
 * A number is data, and data reads best at full contrast; a row of tiles with
 * differently coloured figures is a row nobody can compare at a glance, because
 * the eye does colour before it does magnitude.
 *
 * So the tone is carried BESIDE the number and never by it, in one of two ways:
 * an icon tile when the caller supplies an icon - the design reference's
 * treatment - and otherwise the 4px top bar that `components/hrms/dashboard/
 * StatTile` uses. Both leave the digits at `slate-900`.
 *
 * It stays a separate component rather than an import of `StatTile`: that one is
 * a link or a static tile, and this one can also be a TOGGLE that filters the
 * list below it. Same shell, same palette, different control.
 */
export function StatCard({ label, value, tone = "neutral", icon: Icon, onClick, active, hint }) {
  const Element = onClick ? "button" : "div";

  return (
    <Element
      {...(onClick ? { type: "button", onClick, "aria-pressed": Boolean(active) } : {})}
      className={twMerge(
        "relative flex items-center gap-3 px-4 py-4 bg-white border rounded-xl shadow-enterprise overflow-hidden text-left transition-colors",
        active ? "border-primary-400 ring-1 ring-primary-200" : "border-slate-200",
        onClick &&
          "cursor-pointer hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className={twMerge(
            "inline-flex items-center justify-center w-10 h-10 rounded-xl shrink-0",
            TONE_TILE[tone] ?? TONE_TILE.neutral,
          )}
        >
          <Icon size={19} strokeWidth={1.8} />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className={twMerge("absolute inset-x-0 top-0 h-1", TONE_BAR[tone] ?? TONE_BAR.neutral)}
        />
      )}

      <span className="flex flex-col min-w-0">
        <span className="text-2xl font-bold text-slate-900 tabular-nums leading-none">
          {typeof value === "number" ? value.toLocaleString("en-IN") : value}
        </span>
        <span className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 truncate">
          {label}
        </span>
        {hint && <span className="mt-0.5 text-[11px] text-slate-400 truncate">{hint}</span>}
      </span>
    </Element>
  );
}

export default {
  PercentBar,
  ProgressRow,
  AcademyStatusBadge,
  DueLabel,
  MandatoryBadge,
  LessonStatusIcon,
  LessonStatusBadge,
  LockedNotice,
  MissingContentNotice,
  StatCard,
  LESSON_ICONS,
};
