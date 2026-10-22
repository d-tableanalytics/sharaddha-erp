import { Link } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";

import { TILE_TONE } from "../../components/ui/tileTokens";

/**
 * The home dashboard's own building blocks.
 *
 * Only what the HRMS dashboard's pieces (components/hrms/dashboard/
 * DashboardPieces.jsx) do not already cover: a module card holding a few
 * metrics, and the cross-module attention list. Cards, section titles, person
 * rows and skeletons are imported from there, so the two dashboards cannot
 * drift into two looks.
 */

// ---------------------------------------------------------------------------
// Tones
// ---------------------------------------------------------------------------

/** Number colour per tone. Zero is never alarming, whatever the tone says. */
const VALUE_TONE = {
  danger: "text-error-600",
  warning: "text-warning-600",
  success: "text-success-600",
  primary: "text-primary-700",
  neutral: "text-slate-900",
};

const valueClass = (tone, value) =>
  value === 0 || value === null || value === undefined
    ? "text-slate-900"
    : VALUE_TONE[tone] ?? VALUE_TONE.neutral;

const formatValue = (value, suffix) => {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "number" ? value.toLocaleString("en-IN") : value;
  return suffix ? `${text}${suffix}` : text;
};

// ---------------------------------------------------------------------------
// Module card
// ---------------------------------------------------------------------------

/**
 * One module's headline numbers.
 *
 * Every metric links to the screen that lists what it counts, so a number on
 * the home page is always one click from the rows behind it.
 *
 * Renders its own loading and error states: each module loads independently
 * (see useHomeSources), and a failed module says so in place rather than
 * disappearing — a card that silently vanishes reads as "nothing to do".
 */
export function ModuleCard({ title, icon: Icon, to, linkLabel = "Open", status, onRetry, metrics = [], children, footer }) {
  return (
    <section className="flex flex-col bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && (
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-primary-50 text-primary-700 shrink-0">
              <Icon size={14} />
            </span>
          )}
          <h3 className="text-[13px] font-bold text-slate-900 truncate">{title}</h3>
        </div>
        {to && (
          <Link
            to={to}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-primary-700 hover:underline"
          >
            {linkLabel}
            <ArrowRight size={12} />
          </Link>
        )}
      </header>

      <div className="flex-1 p-4">
        {status === "loading" ? (
          <MetricSkeleton count={Math.max(metrics.length, 3)} />
        ) : status === "error" ? (
          <CardError onRetry={onRetry} />
        ) : (
          <>
            {metrics.length > 0 && (
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {metrics.map((m) => (
                  <Metric key={m.key} {...m} />
                ))}
              </dl>
            )}
            {children}
          </>
        )}
      </div>

      {footer && status === "ready" && (
        <footer className="px-4 py-2.5 border-t border-slate-100 text-[11px] text-slate-500">{footer}</footer>
      )}
    </section>
  );
}

/** A single figure inside a module card. */
export function Metric({ label, value, tone = "neutral", suffix, to, hint }) {
  const body = (
    <>
      <dt className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500 leading-tight">{label}</dt>
      <dd className={twMerge("text-xl font-bold tabular-nums mt-1", valueClass(tone, value))}>
        {formatValue(value, suffix)}
      </dd>
      {hint && <dd className="text-[10.5px] text-slate-400 leading-tight mt-0.5">{hint}</dd>}
    </>
  );

  const shell = "flex flex-col rounded-lg bg-slate-50 px-3 py-2.5 min-w-0";

  return to ? (
    <Link to={to} className={twMerge(shell, "transition-colors hover:bg-primary-50")} title={`Open ${label}`}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

function MetricSkeleton({ count }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 animate-pulse" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg bg-slate-50 px-3 py-2.5">
          <div className="h-2 w-2/3 bg-slate-200 rounded" />
          <div className="h-5 w-1/3 bg-slate-200 rounded mt-2" />
        </div>
      ))}
    </div>
  );
}

export function CardError({ onRetry, message = "Couldn't load this right now." }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-error-50/60 px-3 py-2.5">
      <span className="flex items-center gap-2 text-[12px] font-semibold text-error-600">
        <AlertTriangle size={14} className="shrink-0" />
        {message}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-slate-900"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Needs your attention
// ---------------------------------------------------------------------------

const SEVERITY_DOT = {
  danger: "bg-error-500",
  warning: "bg-warning-500",
  info: "bg-primary-500",
};

const SEVERITY_BADGE = {
  danger: "bg-error-50 text-error-600",
  warning: "bg-warning-50 text-warning-600",
  info: "bg-primary-50 text-primary-700",
};

/**
 * Everything waiting on this person, across every module they can open, most
 * urgent first.
 *
 * Items arrive already filtered — a module the viewer cannot see contributes
 * nothing — and already sorted by `rankAttention`. An empty list is a real
 * answer and is said out loud, because "all clear" is the best news this page
 * can give and should not look like a broken widget.
 */
export function AttentionList({ items, loading }) {
  if (items.length === 0 && loading) {
    return (
      <div className="flex flex-col gap-2 animate-pulse" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 rounded-lg bg-slate-50" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-success-50/70 px-4 py-3.5">
        <CheckCircle2 size={18} className="text-success-600 shrink-0" />
        <div>
          <p className="text-[13px] font-bold text-slate-900">You're all caught up</p>
          <p className="text-[11.5px] text-slate-600">Nothing overdue or waiting on you right now.</p>
        </div>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            to={item.to}
            className="group flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5 transition-colors hover:border-primary-200 hover:bg-primary-50/40"
          >
            <span className={twMerge("w-2 h-2 rounded-full shrink-0", SEVERITY_DOT[item.severity] ?? SEVERITY_DOT.info)} />
            <span className="flex flex-col min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-slate-900 truncate">{item.label}</span>
              <span className="text-[11px] text-slate-500 truncate">{item.module}</span>
            </span>
            {item.count !== undefined && (
              <span
                className={twMerge(
                  "shrink-0 min-w-7 text-center rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                  SEVERITY_BADGE[item.severity] ?? SEVERITY_BADGE.info,
                )}
              >
                {item.count.toLocaleString("en-IN")}
              </span>
            )}
            <ArrowRight size={14} className="shrink-0 text-slate-300 group-hover:text-primary-600" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

/**
 * A one-tap shortcut. Rendered only for actions the viewer may take — the
 * list is built from the same permission checks the target screens use.
 */
export function QuickAction({ action }) {
  const Icon = action.icon;
  return (
    <Link
      to={action.to}
      className="group inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-enterprise transition-colors hover:border-primary-300"
    >
      <span
        className={twMerge(
          "inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors",
          TILE_TONE[action.tone] ?? TILE_TONE.neutral,
        )}
      >
        {Icon && <Icon size={14} />}
      </span>
      <span className="text-[12.5px] font-semibold text-slate-700 whitespace-nowrap">{action.label}</span>
    </Link>
  );
}
