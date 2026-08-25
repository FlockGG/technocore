"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge, StatusDot } from "./Feedback";

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

function useCopy(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false),
    );
  }, []);

  return [copied, copy];
}

export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  readonly value: string;
  readonly label?: string;
  readonly className?: string;
}) {
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      className={`shrink-0 font-mono text-2xs text-chalk-faint transition-colors hover:text-agent-400 ${className ?? ""}`}
    >
      {copied ? "copied" : label.toLowerCase()}
    </button>
  );
}

/**
 * A public value, shown in full and copyable.
 *
 * Used for DIDs, room names, and note paths, everything an agent publishes. The
 * `public` marker is not decoration: the difference between this component and
 * `SecretReveal` below is the difference the user has to be able to see at a glance.
 */
export function Copyable({
  value,
  label,
  className,
  truncate = false,
}: {
  readonly value: string;
  readonly label?: string;
  readonly className?: string;
  readonly truncate?: boolean;
}) {
  return (
    <div className={className}>
      {label ? (
        <div className="mb-1.5 flex items-center gap-2">
          <span className="label-micro">{label}</span>
          <Badge tone="muted">public</Badge>
        </div>
      ) : null}
      <div className="flex items-center gap-3 rounded-md border border-[var(--line)] bg-ink-870 px-3 py-2">
        <code
          className={`min-w-0 flex-1 font-mono text-[0.75rem] leading-relaxed text-chalk ${
            truncate ? "truncate" : "break-all"
          }`}
        >
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Secrets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Private key material.
 *
 * The value is a thunk, not a string: nothing secret enters this component's props
 * or React's tree until the user asks for it, and it is dropped again on unmount and
 * after a timeout. It is never written to the console, never sent anywhere, and the
 * surrounding chrome states what it is every time it appears.
 */
export function SecretReveal({
  read,
  label = "Private key",
  className,
}: {
  readonly read: () => string;
  readonly label?: string;
  readonly className?: string;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    setShown(null);
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => hide, [hide]);

  const reveal = () => {
    setShown(read());
    if (timer.current) clearTimeout(timer.current);
    // Long enough to copy or transcribe, short enough not to be left on screen.
    timer.current = setTimeout(() => setShown(null), 45_000);
  };

  return (
    <div
      className={`rounded-md border border-[rgba(211,162,96,0.32)] bg-[rgba(211,162,96,0.04)] p-3.5 ${className ?? ""}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[0.8125rem] font-medium text-signal-warn">
          <StatusDot tone="warn" />
          {label}
        </span>
        <Badge tone="warn">never share</Badge>
      </div>

      {shown === null ? (
        <>
          <p className="mb-3 text-[0.75rem] leading-relaxed text-chalk-faint">
            This is the secret half of the agent&apos;s identity. Anyone holding it can sign
            messages as this agent, forever. Folester never transmits it, revealing it here
            only draws it on this screen.
          </p>
          <button
            type="button"
            onClick={reveal}
            className="rounded border border-[rgba(211,162,96,0.4)] px-2.5 py-1 font-mono text-2xs text-signal-warn transition-colors hover:bg-[rgba(211,162,96,0.08)]"
          >
            reveal for 45s
          </button>
        </>
      ) : (
        <>
          <code className="block break-all rounded bg-ink-950 px-3 py-2 font-mono text-[0.75rem] leading-relaxed text-signal-warn select-all">
            {shown}
          </code>
          <div className="mt-2.5 flex items-center gap-3">
            <CopyButton value={shown} label="Copy" className="hover:text-signal-warn" />
            <button
              type="button"
              onClick={hide}
              className="font-mono text-2xs text-chalk-faint transition-colors hover:text-chalk"
            >
              hide now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
