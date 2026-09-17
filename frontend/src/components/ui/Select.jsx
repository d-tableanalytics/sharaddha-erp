import React from "react";
import { ChevronDown } from "lucide-react";
import { twMerge } from "tailwind-merge";

import {
  fieldClass, fieldLabelClass, fieldHintClass, fieldErrorClass,
} from "./fieldClasses";

/**
 * A native `<select>`, wearing the same clothes as `Input`.
 *
 * ---------------------------------------------------------------------------
 * NATIVE, NOT A CUSTOM DROPDOWN
 * ---------------------------------------------------------------------------
 * `components/hrms/SearchableSelect` already exists for the case that needs
 * searching and async options. This is the other case — a short, fixed list of
 * three or four choices — and for that the native control is better: it is
 * keyboard-accessible for free, it renders as the platform picker on a phone
 * rather than as a dropdown somebody has to scroll inside a scrolling drawer,
 * and it costs no JavaScript.
 *
 * What it was NOT, before this file, was consistent: every screen that needed
 * one hand-copied Input's class string.
 *
 * The chevron is drawn rather than left to the browser, because the native one
 * differs per platform and sits at a different inset — which is visible the
 * moment a select is beside an Input in the same form. `appearance-none` and
 * the right padding make room for it; `pointer-events-none` on the icon keeps
 * the whole control clickable.
 */
export const Select = React.forwardRef(
  ({ className, label, error, helperText, disabled, children, ...props }, ref) => (
    <div className="w-full flex flex-col gap-1.5">
      {label && <label className={fieldLabelClass}>{label}</label>}

      <div className="relative">
        <select
          ref={ref}
          disabled={disabled}
          className={twMerge(
            fieldClass(error),
            "appearance-none pr-9 cursor-pointer disabled:cursor-not-allowed",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
      </div>

      {error && <span className={fieldErrorClass}>{error}</span>}
      {!error && helperText && <span className={fieldHintClass}>{helperText}</span>}
    </div>
  ),
);
Select.displayName = "Select";

export default Select;
