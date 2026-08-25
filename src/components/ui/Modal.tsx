"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A modal dialog built on the native `<dialog>` element, so focus containment, the
 * top layer, and Escape-to-close come from the platform rather than from a hand-rolled
 * focus trap.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      // Clicking the backdrop closes; clicks inside the panel stop at the panel.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100vw-2rem)] ${widths[width]} rounded-xl border border-[var(--line-strong)] bg-ink-900 p-0 text-chalk backdrop:bg-ink-950/80 backdrop:backdrop-blur-sm`}
    >
      <div className="border-b border-[var(--line)] px-5 py-4">
        <h2 className="text-[0.9375rem] font-medium">{title}</h2>
        {description ? (
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-chalk-faint">{description}</p>
        ) : null}
      </div>
      <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3.5">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
