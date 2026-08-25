import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.25rem] font-medium tracking-[-0.01em] text-chalk">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[0.8125rem] leading-relaxed text-chalk-faint">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
