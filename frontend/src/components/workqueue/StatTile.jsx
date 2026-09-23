import { twMerge } from "tailwind-merge";

import { TILE_TONE } from "../ui/tileTokens";

/**
 * One Work Queue tile.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * My Work, Delegation, Loop Tasks, All Tasks and Checklist each grew their own
 * copy of a stat tile — five near-identical blocks of Tailwind, drifting apart
 * one edit at a time - `font-bold` here and `font-semibold` there, a 20% active
 * ring on one page and a 10% one on the next. Factored into one component, the
 * five screens cannot drift again, and the Work Queue reads as one module.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LOOKS LIKE THE HR DASHBOARD
 * ---------------------------------------------------------------------------
 *
 * The shell, the 40px toned icon chip, the label type and the `gap-3` grid are
 * the HR Dashboard's Quick Access tile — `QuickAccessTile` in
 * components/hrms/dashboard/DashboardPieces.jsx — and the chip tones are not a
 * copy of that tile's: both read the same `TILE_TONE` in ui/tileTokens.js.
 *
 * The one deliberate difference: Quick Access is pure navigation (chip, label)
 * while these tiles carry a COUNT, which is the thing people come to the page
 * to read. So the count sits between chip and label, and the tone lives in the
 * chip rather than in the number — colouring both would give the tile two
 * competing focal points and break the hierarchy this is meant to match.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  tone = "neutral",
  note,
  active = false,
  onClick,
  title,
}) {
  const interactive = typeof onClick === "function";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      title={title}
      aria-pressed={interactive ? active : undefined}
      className={twMerge(
        "group flex flex-col items-center gap-2 px-2 py-4 bg-white border rounded-xl shadow-enterprise transition-colors",
        "text-center disabled:cursor-default",
        interactive && "cursor-pointer hover:border-primary-300",
        active ? "border-primary-300 ring-2 ring-primary-500/20" : "border-slate-200",
      )}
    >
      <span
        className={twMerge(
          "inline-flex items-center justify-center w-10 h-10 rounded-xl transition-colors",
          TILE_TONE[tone] ?? TILE_TONE.neutral,
        )}
      >
        {Icon && <Icon size={18} />}
      </span>

      <span className="text-2xl font-semibold text-slate-900 leading-none">{value}</span>

      <span className="text-[11.5px] font-semibold text-slate-700 text-center leading-tight">
        {label}
      </span>

      {note && (
        <span className="text-[10px] text-slate-500 text-center leading-tight">{note}</span>
      )}
    </button>
  );
}

export default StatTile;
