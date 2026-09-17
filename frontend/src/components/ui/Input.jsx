import React from "react";
import { twMerge } from "tailwind-merge";

import {
  fieldClass, fieldLabelClass, fieldHintClass, fieldErrorClass,
} from "./fieldClasses";

export const Input = React.forwardRef(
  (
    { className, type = "text", label, error, helperText, disabled, ...props },
    ref,
  ) => {
    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && <label className={fieldLabelClass}>{label}</label>}
        <input
          ref={ref}
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
