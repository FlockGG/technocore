import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium " +
  "transition-[background-color,border-color,color,opacity] duration-200 " +
  "disabled:pointer-events-none disabled:opacity-45 whitespace-nowrap";

const variants: Record<Variant, string> = {
  // The one saturated surface in the product. Used for the single primary action.
  primary: "bg-agent-500 text-ink-950 hover:bg-agent-400",
  secondary:
    "border border-[var(--line-strong)] bg-ink-850 text-chalk hover:bg-ink-800 hover:border-[var(--line-accent)]",
  ghost: "text-chalk-dim hover:text-chalk hover:bg-ink-850",
  danger:
    "border border-[rgba(212,121,107,0.3)] bg-transparent text-signal-error hover:bg-[rgba(212,121,107,0.08)]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.8125rem]",
  md: "h-9.5 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

interface Shared {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: Shared & Omit<ComponentProps<"button">, "className" | "children">) {
  return (
    <button
      type="button"
      className={`${base} ${variants[variant]} ${sizes[size]} ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: Shared & Omit<ComponentProps<typeof Link>, "className" | "children">) {
  return (
    <Link
      className={`${base} ${variants[variant]} ${sizes[size]} ${className ?? ""}`}
      {...rest}
    >
      {children}
    </Link>
  );
}

/** A small square button for inline actions inside dense rows. */
export function IconButton({
  label,
  className,
  children,
  ...rest
}: { readonly label: string; readonly className?: string; readonly children: ReactNode } & Omit<
  ComponentProps<"button">,
  "className" | "children"
>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-7 items-center justify-center rounded text-chalk-faint transition-colors hover:bg-ink-800 hover:text-chalk disabled:opacity-40 ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}
