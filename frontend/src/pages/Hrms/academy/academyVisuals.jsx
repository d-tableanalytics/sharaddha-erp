import { useMemo } from "react";
import { twMerge } from "tailwind-merge";
import { BookOpen, PlayCircle, FileText, ClipboardList, Link2, ShieldCheck } from "lucide-react";

/**
 * The presentational vocabulary the Academy design reference introduces.
 *
 * `academyShared.jsx` holds the module's DOMAIN vocabulary — a progress bar, a
 * lock, a due label. This file holds the pieces the visual design needs that
 * the portal's kit did not already have: a cover tile, a chip filter row, and
 * three small charts.
 *
 * Everything here is built from the existing Tailwind palette and the lucide
 * set. No new dependency, no second design language — the reference's look is
 * reproduced in this portal's own tokens.
 */

// ---------------------------------------------------------------------------
// Cover tile
// ---------------------------------------------------------------------------

/**
 * A deterministic tint, derived from the name.
 *
 * The same reasoning `DashboardPieces.Initial` records: a given path looks the
 * same everywhere it appears, without storing a colour on it. These are FLAT
 * tints rather than gradients — section 22 rules gradients out explicitly, and
 * the reference's own third card is a flat navy panel with a white icon, which
 * is exactly this.
 */
const COVER_TONES = [
  "bg-primary-700 text-white/90",
  "bg-slate-800 text-white/90",
  "bg-primary-600 text-white/90",
  "bg-slate-700 text-white/90",
  "bg-primary-800 text-white/90",
];

const COVER_ICONS = {
  video: PlayCircle,
  pdf: FileText,
  document: FileText,
  link: Link2,
  quiz: ClipboardList,
  compliance: ShieldCheck,
  path: BookOpen,
};

/**
 * The image slot on a path, course or certificate card.
 *
 * ---------------------------------------------------------------------------
 * 🔴 WHY THIS IS GENERATED RATHER THAN AN UPLOAD
 * ---------------------------------------------------------------------------
 * The design reference shows a photograph on each card. No model in this module
 * carries a cover image — not `LearningPath`, not `Course`, not `AcademyContent`
 * — so rendering one would mean inventing an upload pipeline, a storage
 * category, a presigned-URL route and a validation rule that nobody asked for,
 * on three collections.
 *
 * So the SLOT is real and the artwork is derived: same aspect ratio, same
 * position, same weight in the card, tinted per path and carrying the icon for
 * what the thing is. The layout the reference specifies is reproduced exactly;
 * only the asset is synthetic.
 *
 * `src` is honoured when present, so the day a cover field is added this
 * component starts showing real images with no change to any caller.
 */
export function CoverTile({ name = "", kind = "path", src, className, icon: IconOverride }) {
  const text = String(name);
  const tone = COVER_TONES[text.length % COVER_TONES.length];
  const Icon = IconOverride ?? COVER_ICONS[kind] ?? COVER_ICONS.path;

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={twMerge("w-full h-full object-cover bg-slate-100", className)}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={twMerge(
        "relative w-full h-full flex items-center justify-center overflow-hidden",
        tone,
        className,
      )}
    >
      {/* A single soft highlight, not a gradient wash — it stops a large flat
          panel reading as a loading placeholder. */}
      <span className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/[0.07]" />
      <span className="absolute -left-8 -bottom-8 w-28 h-28 rounded-full bg-white/[0.05]" />
      <Icon size={30} strokeWidth={1.5} className="relative" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip filters
// ---------------------------------------------------------------------------

/**
 * The pill row the reference uses to filter a list.
 *
 * It replaces a row of clickable stat tiles. The tiles answered "how many are
 * overdue"; the chips answer the same question AND read as controls, which the
 * tiles never quite did — a tile that is also a button is an ambiguous object,
 * and five of them took a whole band of the screen to say what one row says.
 *
 * Selection lives with the caller. This is a control, not a state machine.
 */
export function FilterChips({ options, value, onChange, className, ariaLabel = "Filter" }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={twMerge("flex flex-wrap items-center gap-2", className)}
    >
      {options.map((option) => {
        const active = option.key === value;
        const hasCount = option.count !== undefined && option.count !== null;

        return (
          <button
            key={option.key ?? "all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.key)}
            className={twMerge(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
              active
                ? "bg-primary-600 border-primary-600 text-white"
                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900",
            )}
          >
            {option.label}
            {hasCount && (
              <span
                className={twMerge(
                  "tabular-nums",
                  active ? "text-white/80" : "text-slate-400",
                )}
              >
                ({option.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/**
 * A completion ring.
 *
 * Hand-drawn SVG, following `LoginTrendChart` — the one chart this portal
 * already ships, which records the reasoning: a single proportion does not
 * need a charting library, a responsive container and a tooltip portal.
 *
 * One circle with a `stroke-dasharray`. The figure is repeated as text in the
 * middle, so the value is readable rather than estimated from an arc, and the
 * whole thing carries an accessible name for a reader that cannot see either.
 */
export function DonutChart({ percent = 0, label, size = 148, tone = "primary", className }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));

  const { radius, circumference, dash } = useMemo(() => {
    const r = 54;
    const c = 2 * Math.PI * r;
    return { radius: r, circumference: c, dash: (value / 100) * c };
  }, [value]);

  const stroke =
    tone === "success"
      ? "stroke-success-600"
      : tone === "warning"
        ? "stroke-warning-500"
        : tone === "danger"
          ? "stroke-error-500"
          : "stroke-primary-600";

  return (
    <div
      className={twMerge("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${value}% ${label ?? "complete"}`}
    >
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          strokeWidth="12"
          className="stroke-slate-100"
        />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          className={twMerge("transition-all duration-500", stroke)}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-slate-900 tabular-nums leading-none">
          {value}%
        </span>
        {label && (
          <span className="mt-1 text-[11px] text-slate-500 text-center px-4 leading-tight">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

const BAR_TONE = {
  neutral: "bg-slate-300",
  primary: "bg-primary-500",
  success: "bg-success-600",
  warning: "bg-warning-500",
  danger: "bg-error-500",
};

/**
 * Vertical bars with a value above each — the reference's "Assignments by
 * Status" panel.
 *
 * Scaled against the largest value rather than a fixed ceiling, so a set of
 * small numbers still fills the panel and stays comparable.
 */
export function MiniBars({ data = [], className, height = 128 }) {
  const peak = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className={twMerge("flex items-end justify-around gap-3", className)} style={{ height }}>
      {data.map((item) => {
        const ratio = item.value / peak;
        return (
          <div key={item.label} className="flex-1 flex flex-col items-center gap-1.5 min-w-0 h-full">
            <span className="text-xs font-bold text-slate-900 tabular-nums">{item.value}</span>

            <div className="flex-1 w-full flex items-end justify-center">
              <div
                className={twMerge(
                  "w-full max-w-[38px] rounded-t-md transition-all duration-500",
                  BAR_TONE[item.tone] ?? BAR_TONE.neutral,
                )}
                /* A zero still draws a 2px stub. A bar of no height is
                   indistinguishable from a missing category. */
                style={{ height: `${Math.max(ratio * 100, 2)}%` }}
              />
            </div>

            <span className="text-[10px] font-semibold text-slate-500 text-center leading-tight truncate w-full">
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A labelled horizontal bar — the reference's "Completion by Department".
 *
 * The label and the figure sit on the same line above the track rather than in
 * a column beside it, so a long department name does not squeeze every bar into
 * a sliver.
 */
export function MeterRow({ label, percent = 0, tone = "primary", meta, className }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div className={twMerge("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-slate-700 truncate">{label}</span>
        <span className="text-xs font-bold text-slate-900 tabular-nums shrink-0">{value}%</span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${value}%`}
        className="h-2 w-full rounded-full bg-slate-100 overflow-hidden"
      >
        <div
          className={twMerge("h-full rounded-full transition-all duration-500", BAR_TONE[tone])}
          style={{ width: `${value}%` }}
        />
      </div>

      {meta && <span className="text-[11px] text-slate-400">{meta}</span>}
    </div>
  );
}

export default { CoverTile, FilterChips, DonutChart, MiniBars, MeterRow };
