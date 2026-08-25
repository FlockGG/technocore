"use client";

import { useId, type ComponentProps, type ReactNode } from "react";

const control =
  "w-full rounded-md border border-[var(--line-strong)] bg-ink-870 px-3 text-sm text-chalk " +
  "placeholder:text-chalk-ghost transition-colors " +
  "focus:border-[var(--line-accent)] focus:outline-none focus-visible:outline-none " +
  "disabled:opacity-50";

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  counter,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | null;
  readonly children: ReactNode;
  readonly htmlFor?: string;
  readonly counter?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="label-micro">
          {label}
        </label>
        {counter ? <span className="font-mono text-2xs text-chalk-ghost">{counter}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="text-[0.75rem] leading-relaxed text-signal-error">{error}</p>
      ) : hint ? (
        <p className="text-[0.75rem] leading-relaxed text-chalk-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({
  label,
  hint,
  error,
  counter,
  mono,
  className,
  ...rest
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | null;
  readonly counter?: ReactNode;
  readonly mono?: boolean;
  readonly className?: string;
} & Omit<ComponentProps<"input">, "className">) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id} counter={counter}>
      <input
        id={id}
        className={`${control} h-9.5 ${mono ? "font-mono text-[0.8125rem]" : ""} ${className ?? ""}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  counter,
  mono,
  rows = 4,
  className,
  ...rest
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | null;
  readonly counter?: ReactNode;
  readonly mono?: boolean;
  readonly className?: string;
} & Omit<ComponentProps<"textarea">, "className">) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id} counter={counter}>
      <textarea
        id={id}
        rows={rows}
        className={`${control} resize-y py-2.5 leading-relaxed ${mono ? "font-mono text-[0.8125rem]" : ""} ${className ?? ""}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  children,
  className,
  ...rest
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | null;
  readonly children: ReactNode;
  readonly className?: string;
} & Omit<ComponentProps<"select">, "className" | "children">) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <select id={id} className={`${control} h-9.5 pr-8 ${className ?? ""}`} {...rest}>
        {children}
      </select>
    </Field>
  );
}

/** Multi-select over a fixed vocabulary, as toggles rather than a native multiple. */
export function ChipGroup<T extends string>({
  label,
  hint,
  options,
  selected,
  onToggle,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly options: readonly { readonly id: T; readonly label: string }[];
  readonly selected: readonly string[];
  readonly onToggle: (id: T) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {options.map((option) => {
          const active = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(option.id)}
              className={`rounded border px-2.5 py-1 text-[0.75rem] transition-colors ${
                active
                  ? "border-[var(--line-accent)] bg-[rgba(91,155,213,0.09)] text-agent-400"
                  : "border-[var(--line-strong)] text-chalk-dim hover:border-[var(--line-accent)] hover:text-chalk"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  readonly options: readonly { readonly id: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (id: T) => void;
  readonly label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex rounded-md border border-[var(--line-strong)] bg-ink-870 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded px-3 py-1.5 text-[0.8125rem] transition-colors ${
            value === option.id
              ? "bg-ink-750 text-chalk"
              : "text-chalk-faint hover:text-chalk-dim"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
