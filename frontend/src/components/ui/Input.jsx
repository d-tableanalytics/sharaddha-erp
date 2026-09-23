import React from "react";
import { twMerge } from "tailwind-merge";

import {
  fieldClass, fieldLabelClass, fieldHintClass, fieldErrorClass,
} from "./fieldClasses";

export const Input = React.forwardRef(
  (
    { className, type = "text", id, label, error, helperText, disabled, ...props },
    ref,
  ) => {
    /*
     * The `label` prop used to render a bare <label> with no `htmlFor`, so it
     * named the field visually and was attached to nothing: clicking it did not
     * focus the input, and a screen reader read the control as unlabelled.
     * `useId` supplies an id when the caller has not, so this is an addition
     * for every existing usage rather than a change to any of them.
     */
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className={fieldLabelClass}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          disabled={disabled}
          // The SAME tokens as before, now read from ./fieldClasses so the
          // input, the select and the textarea cannot drift apart.
          className={twMerge(fieldClass(error), className)}
          {...props}
        />

        {error && <span className={fieldErrorClass}>{error}</span>}
        {!error && helperText && <span className={fieldHintClass}>{helperText}</span>}
      </div>
    );
  },
);

Input.displayName = "Input";
