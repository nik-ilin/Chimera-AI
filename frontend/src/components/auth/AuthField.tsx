"use client";
/**
 * Shared text field for the sign-in and register forms.
 *
 * Wraps a native input so react-hook-form's `register()` spread still works and
 * the browser's own autofill / password-manager integration is untouched.
 * Styling follows the Chimera widget language: warm card surface, pill-free
 * rounded rect, clay focus ring.
 *
 * Accessibility: the label is a real <label htmlFor>, errors are wired via
 * aria-describedby and announced with role="alert", and aria-invalid flips on
 * error so screen readers and the focus ring agree.
 */
import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Field-level error. Renders below the input and sets aria-invalid. */
  error?: string;
  /** Persistent helper text shown when there is no error. */
  hint?: ReactNode;
}

const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { label, error, hint, id, className, ...props },
  ref
) {
  const fieldId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="u-label text-muted-foreground">
        {label}
      </label>

      <input
        {...props}
        id={fieldId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          "w-full rounded-2xl border bg-card px-4 py-3 text-sm text-foreground",
          "placeholder:text-muted-foreground/50",
          "transition-all duration-200 ease-smooth",
          "focus:outline-none focus:ring-2 focus:ring-chimera-clay/35 focus:border-chimera-clay/50",
          error ? "border-destructive/60" : "border-border",
          className ?? "",
        ].join(" ")}
      />

      {error ? (
        <p
          id={`${fieldId}-error`}
          role="alert"
          className="text-xs text-destructive animate-fade-in"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground/80 leading-relaxed">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default AuthField;
