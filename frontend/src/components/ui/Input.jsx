import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const Input = React.forwardRef(
  (
    { className, type = "text", label, error, helperText, disabled, ...props },
    ref,
  ) => {
    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label className="text-xs font-semibold text-slate-700 select-none">
            {label}
          </label>
        )}
        <input
          ref={ref}
          type={type}
          disabled={disabled}
          className={twMerge(
            clsx(
              "w-full px-3 py-2 text-sm bg-white border rounded-lg shadow-sm outline-none transition-all",
              "border-slate-300 placeholder-slate-400 text-slate-900",
              "focus:border-primary-500 focus:ring-1 focus:ring-primary-500",
              "disabled:bg-slate-50 disabled:text-slate-500 disabled:border-slate-200 disabled:cursor-not-allowed disabled:shadow-none",
              error &&
                "border-error-500 focus:border-error-500 focus:ring-error-500",
            ),
            className,
          )}
          {...props}
        />

        {error && (
          <span className="text-xs text-error-500 font-medium">{error}</span>
        )}
        {!error && helperText && (
          <span className="text-xs text-slate-500">{helperText}</span>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
