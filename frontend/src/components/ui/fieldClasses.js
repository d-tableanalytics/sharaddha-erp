/**
 * The look of a form control, in one place.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `Input` had these classes inline, and it was the only form primitive the kit
 * shipped — so every screen needing a `<select>` or a `<textarea>` hand-copied
 * the string. SI Academy alone carried NINE copies across five files, and a
 * copy is a control that stops matching the moment somebody adjusts the focus
 * ring on one of them.
 *
 * Splitting the string out rather than adding a `variant` prop to `Input`:
 * a select needs its own element for the native picker, and a textarea needs
 * `rows` and vertical resize. They are three elements that must LOOK the same,
 * not one element with three modes.
 */

import { clsx } from "clsx";

/** Shared by the input, select and textarea. Nothing else should use it. */
export const fieldBase = [
  "w-full px-3 py-2 text-sm bg-white border rounded-lg shadow-sm outline-none transition-all",
  "border-slate-300 placeholder-slate-400 text-slate-900",
  "focus:border-primary-500 focus:ring-1 focus:ring-primary-500",
  "disabled:bg-slate-50 disabled:text-slate-500 disabled:border-slate-200 disabled:cursor-not-allowed disabled:shadow-none",
];

/**
 * The full class list for a control.
 *
 * `error` swaps the border and ring to the error palette — the red one is
 * `error-500`; only its Tailwind PALETTE is called `error`, and writing
 * `danger` here silently renders an unstyled control, which is the trap
 * `HrmsStatusBadge` documents for Badge variants.
 */
export const fieldClass = (error) =>
  clsx(fieldBase, error && "border-error-500 focus:border-error-500 focus:ring-error-500");

/** The label above a control. */
export const fieldLabelClass = "text-xs font-semibold text-slate-700 select-none";

/** The line under it — an error if there is one, otherwise the hint. */
export const fieldHintClass = "text-xs text-slate-500";
export const fieldErrorClass = "text-xs text-error-500 font-medium";

export default { fieldBase, fieldClass, fieldLabelClass, fieldHintClass, fieldErrorClass };
