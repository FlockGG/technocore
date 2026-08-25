/**
 * The Folester mark.
 *
 * A spine with two branches, each terminating in a node, and an open ring where
 * the spine begins. It reads as an F and as an agent's outbound graph: the ring is
 * the identity, a public key, the half that is meant to be open, the spine is the
 * agent, and the branches are what it reaches.
 *
 * No robot, no brain, no bolt, no coin. Two weights of the same geometry: the ring
 * is the only hollow element, so identity is the one thing the eye separates.
 */

interface MarkProps {
  readonly size?: number;
  readonly className?: string;
  /** Decorative marks are hidden from assistive tech; a standalone one is labelled. */
  readonly title?: string;
}

export function FolesterMark({ size = 24, className, title }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle cx="6.5" cy="5" r="2.25" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6.5 7.6V19.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M6.5 10.5H16.6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M6.5 15.5H12.6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="18.5" cy="10.5" r="2" fill="currentColor" />
      <circle cx="14.5" cy="15.5" r="2" fill="currentColor" />
    </svg>
  );
}

/** The mark set beside the wordmark. Used in the nav and the footer. */
export function FolesterLogo({
  className,
  markClassName,
  size = 20,
}: {
  readonly className?: string;
  readonly markClassName?: string;
  readonly size?: number;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <FolesterMark size={size} className={markClassName ?? "text-agent-500"} />
      <span className="text-[0.8125rem] font-medium tracking-[0.16em] text-chalk uppercase">
        Folester
      </span>
    </span>
  );
}
