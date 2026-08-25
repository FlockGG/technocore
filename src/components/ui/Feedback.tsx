import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export type Tone = "neutral" | "accent" | "warn" | "error" | "muted";

const toneText: Record<Tone, string> = {
  neutral: "text-chalk-dim",
  accent: "text-agent-400",
  warn: "text-signal-warn",
  error: "text-signal-error",
  muted: "text-chalk-ghost",
};

const toneDot: Record<Tone, string> = {
  neutral: "bg-chalk-dim",
  accent: "bg-agent-500",
  warn: "bg-signal-warn",
  error: "bg-signal-error",
  muted: "bg-chalk-ghost",
};

const toneEdge: Record<Tone, string> = {
  neutral: "border-[var(--line-strong)]",
  accent: "border-[var(--line-accent)]",
  warn: "border-[rgba(211,162,96,0.32)]",
  error: "border-[rgba(212,121,107,0.32)]",
  muted: "border-[var(--line)]",
};

export function StatusDot({
  tone = "neutral",
  pulse = false,
  className,
}: {
  readonly tone?: Tone;
  readonly pulse?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block size-1.5 shrink-0 rounded-full ${toneDot[tone]} ${pulse ? "animate-pulse-dot" : ""} ${className ?? ""}`}
    />
  );
}

export function Badge({
  children,
  tone = "muted",
  className,
}: {
  readonly children: ReactNode;
  readonly tone?: Tone;
  readonly className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-2xs ${toneEdge[tone]} ${toneText[tone]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Callouts                                                                    */
/* -------------------------------------------------------------------------- */

const calloutFill: Record<Tone, string> = {
  neutral: "bg-ink-850",
  accent: "bg-[rgba(91,155,213,0.05)]",
  warn: "bg-[rgba(211,162,96,0.05)]",
  error: "bg-[rgba(212,121,107,0.05)]",
  muted: "bg-ink-870",
};

/**
 * The component the honest parts of this product are made of: limits, warnings, and
 * the difference between what is public and what is not. It is deliberately plain
 * so it reads as information rather than as decoration to be skipped.
 */
export function Callout({
  tone = "neutral",
  title,
  children,
  className,
}: {
  readonly tone?: Tone;
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={`rounded-md border px-3.5 py-3 text-[0.8125rem] leading-relaxed ${toneEdge[tone]} ${calloutFill[tone]} ${className ?? ""}`}
    >
      {title ? (
        <p className={`mb-1 font-medium ${tone === "neutral" ? "text-chalk" : toneText[tone]}`}>
          {title}
        </p>
      ) : null}
      <div className="text-chalk-dim [&_a]:text-agent-400 [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-chalk">
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty and error states                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Shown when there is genuinely nothing. Never filled with sample rows: an empty
 * network is a real answer, and inventing activity to fill the space would make
 * every other number in the product untrustworthy.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={`px-5 py-10 text-center ${className ?? ""}`}>
      <p className="text-[0.875rem] text-chalk-dim">{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-md text-[0.8125rem] leading-relaxed text-chalk-faint">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * A failed call, shown with the service's own words.
 *
 * `detail` is upstream text. It is rendered as plain text inside a mono block, never
 * as markup, because it is third-party content.
 */
export function ErrorState({
  title = "Technocore connection failed",
  detail,
  action,
  className,
}: {
  readonly title?: string;
  readonly detail?: string | null;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={`rounded-md border border-[rgba(212,121,107,0.32)] bg-[rgba(212,121,107,0.05)] px-4 py-3.5 ${className ?? ""}`}
    >
      <p className="flex items-center gap-2 text-[0.875rem] font-medium text-signal-error">
        <StatusDot tone="error" />
        {title}
      </p>
      {detail ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-chalk-dim">
          {detail}
        </pre>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Neutral placeholder while a real request is in flight. Never fake content. */
export function LoadingLines({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-3 animate-pulse-dot rounded bg-ink-800"
          style={{ width: `${88 - index * 13}%` }}
        />
      ))}
    </div>
  );
}
