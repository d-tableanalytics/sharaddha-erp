import React from "react";
import { twMerge } from "tailwind-merge";

export const Card = React.forwardRef(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={twMerge(
          "bg-white border border-slate-200 rounded-xl shadow-enterprise overflow-hidden",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Card.displayName = "Card";

export const CardHeader = ({ className, children, ...props }) => (
  <div
    className={twMerge(
      "px-6 py-4 border-b border-slate-100 bg-slate-50/50",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export const CardTitle = ({ className, children, ...props }) => (
  <h3
    className={twMerge("text-base font-semibold text-slate-900", className)}
    {...props}
  >
    {children}
  </h3>
);

export const CardContent = ({ className, children, ...props }) => (
  <div className={twMerge("p-6", className)} {...props}>
    {children}
  </div>
);

export const CardFooter = ({ className, children, ...props }) => (
  <div
    className={twMerge(
      "px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-end gap-2",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
