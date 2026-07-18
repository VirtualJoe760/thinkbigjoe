import type { ComponentPropsWithoutRef, ReactNode } from "react";

// Shared form primitives — the label/hint/error scaffold plus the control-class source of truth.
// Replaces the ~56 hand-rolled `<label>` blocks and ~35 `w-full rounded border …` controls.
// `inputClass()` is the className-only lever: swap a control deep in a form without a JSX rewrite.

type FieldTone = "light" | "onDark";

const INPUT_TONES: Record<FieldTone, string> = {
  light: "border-line bg-background text-ink",
  onDark: "border-white/15 bg-white/5 text-white placeholder:text-white/40",
};

export function inputClass({ tone = "light", className = "" }: { tone?: FieldTone; className?: string } = {}): string {
  return `mt-2 w-full rounded-xl border ${INPUT_TONES[tone]} px-3.5 py-2.5 text-sm focus:border-brand focus:outline-none ${className}`.trim();
}

type FieldProps = {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
};

// The control is nested inside the <label>, so clicking the label focuses it (htmlFor optional).
export function Field({ label, htmlFor, required, hint, error, children }: FieldProps & { children: ReactNode }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="text-sm font-semibold text-ink">
        {label}
        {required ? <span className="text-brand"> *</span> : null}
      </span>
      {hint ? <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span> : null}
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

type ControlProps<T> = FieldProps & { tone?: FieldTone } & Omit<T, "className"> & { className?: string };

export function TextField({ label, htmlFor, required, hint, error, tone, className, ...rest }: ControlProps<ComponentPropsWithoutRef<"input">>) {
  return (
    <Field label={label} htmlFor={htmlFor} required={required} hint={hint} error={error}>
      <input className={inputClass({ tone, className })} {...rest} />
    </Field>
  );
}

export function TextArea({ label, htmlFor, required, hint, error, tone, className, ...rest }: ControlProps<ComponentPropsWithoutRef<"textarea">>) {
  return (
    <Field label={label} htmlFor={htmlFor} required={required} hint={hint} error={error}>
      <textarea className={inputClass({ tone, className })} {...rest} />
    </Field>
  );
}

export function SelectField({ label, htmlFor, required, hint, error, tone, className, children, ...rest }: ControlProps<ComponentPropsWithoutRef<"select">>) {
  return (
    <Field label={label} htmlFor={htmlFor} required={required} hint={hint} error={error}>
      <select className={inputClass({ tone, className })} {...rest}>
        {children}
      </select>
    </Field>
  );
}
