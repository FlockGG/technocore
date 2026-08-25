import type { ReactNode } from "react";

/**
 * The single container surface in the app. One hairline border, one flat fill, no
 * shadow stack, depth in this product comes from the scene behind the content, not
 * from layered cards.
 */
export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: "section" | "div" | "article" | "aside";
}) {
  return (
    <Tag
      className={`rounded-lg border border-[var(--line)] bg-ink-900/70 backdrop-blur-[2px] ${className ?? ""}`}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  hint,
  actions,
  className,
}: {
  readonly title: ReactNode;
  readonly hint?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5 ${className ?? ""}`}
    >
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-medium text-chalk">{title}</h2>
        {hint ? <p className="mt-1 text-[0.8125rem] leading-relaxed text-chalk-faint">{hint}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={`px-5 py-4 ${className ?? ""}`}>{children}</div>;
}

export function PanelFooter({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/** A label/value row for dense technical detail. Values are mono by default. */
export function DataRow({
  label,
  children,
  mono = true,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--line)] py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="label-micro sm:w-44 sm:shrink-0">{label}</dt>
      <dd
        className={`min-w-0 flex-1 break-words text-[0.8125rem] text-chalk ${mono ? "font-mono" : ""}`}
      >
        {children}
      </dd>
    </div>
  );
}

export function SectionLabel({ children }: { readonly children: ReactNode }) {
  return <p className="label-micro mb-3">{children}</p>;
}
