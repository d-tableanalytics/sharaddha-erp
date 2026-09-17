import React from "react";
import { twMerge } from "tailwind-merge";

import {
  fieldClass, fieldLabelClass, fieldHintClass, fieldErrorClass,
} from "./fieldClasses";

/**
 * A multi-line field, wearing the same clothes as `Input`.
 *
 * `resize-y` rather than the browser default `resize: both`: a textarea the
 * user can drag WIDER escapes the column it sits in and, inside a modal, the
 * modal itself. Vertical is the axis anybody actually wants.
 *
 * `rows` defaults to 3 — the size every caller in the app was already passing
 * or wanted — so the common case needs no prop.
 */
export const Textarea = React.forwardRef(
  ({ className, label, error, helperText, disabled, rows = 3, ...props }, ref) => (
    <div className="w-full flex flex-col gap-1.5">
      {label && <label className={fieldLabelClass}>{label}</label>}

      <textarea
        ref={ref}
        rows={rows}
        disabled={disabled}
        className={twMerge(fieldClass(error), "resize-y leading-relaxed", className)}
        {...props}
      />

      {error && <span className={fieldErrorClass}>{error}</span>}
      {!error && helperText && <span className={fieldHintClass}>{helperText}</span>}
    </div>
  ),
);
Textarea.displayName = "Textarea";

export default Textarea;
