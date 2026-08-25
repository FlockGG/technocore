"use client";

import { useEffect, useRef, useState, type Ref } from "react";

/**
 * Text that decodes itself when it scrolls into view.
 *
 * The visible characters are generated at runtime, one frame at a time: each
 * position starts as random noise and locks to its real glyph on a staggered
 * schedule, so what you see is genuinely being produced rather than revealed by
 * an opacity fade over pre-painted text.
 *
 * Accessibility and crawlers get the finished string regardless, it is rendered
 * once in a visually-hidden span, and the animating layer is `aria-hidden`. With
 * `prefers-reduced-motion` the scramble is skipped entirely and the final text is
 * painted on first frame.
 */

/* Glyphs biased toward monospace-ish forms so the noise keeps the line's width
   roughly stable while it resolves. */
const NOISE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/\\|<>[]{}#*+=-_$%&@";

function noiseChar(random: () => number): string {
  return NOISE[Math.floor(random() * NOISE.length)];
}

/* Deterministic per-instance PRNG: two mounts of the same string scramble
   differently, but a given mount is stable across its own frames. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function GlitchText({
  children,
  className,
  /** Milliseconds between one character locking and the next. */
  stagger = 26,
  /** How long each character churns before it locks. */
  churn = 240,
  /** Delay after the line enters the viewport before decoding starts. */
  delay = 0,
  as: Tag = "span",
}: {
  readonly children: string;
  readonly className?: string;
  readonly stagger?: number;
  readonly churn?: number;
  readonly delay?: number;
  readonly as?: "span" | "h1" | "h2" | "h3" | "p" | "div";
}) {
  const hostRef = useRef<HTMLElement>(null);
  const [rendered, setRendered] = useState("");
  const [decoding, setDecoding] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRendered(children);
      return;
    }

    let frame = 0;
    let timer = 0;
    let started = false;

    const run = () => {
      const random = makeRandom(children.length * 2654435761 + children.charCodeAt(0));
      const total = children.length;
      const start = performance.now();
      setDecoding(true);

      const tick = () => {
        const elapsed = performance.now() - start;
        let out = "";
        let done = true;

        for (let index = 0; index < total; index += 1) {
          const glyph = children[index];
          // Whitespace is structural: locking it immediately keeps word shapes
          // from thrashing while the rest of the line is still noise.
          if (glyph === " " || glyph === "\n") {
            out += glyph;
            continue;
          }
          const lockAt = index * stagger + churn;
          if (elapsed >= lockAt) {
            out += glyph;
          } else if (elapsed >= index * stagger) {
            out += noiseChar(random);
            done = false;
          } else {
            done = false;
          }
        }

        setRendered(out);
        if (done) {
          setDecoding(false);
          return;
        }
        frame = requestAnimationFrame(tick);
      };

      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started) return;
        started = true;
        observer.disconnect();
        timer = window.setTimeout(run, delay);
      },
      /* Fires a little before the line is fully on screen so the decode is
         already underway by the time it is comfortably readable. */
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 },
    );
    observer.observe(host);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [children, stagger, churn, delay]);

  return (
    <Tag
      ref={hostRef as Ref<HTMLHeadingElement>}
      /* No display utility here: the element keeps its natural box, so an h1/h2/p
         stays block-level and does not get pulled into a line box with whatever
         inline-level element precedes it. */
      className={`relative ${className ?? ""}`}
    >
      {/* The real string, for screen readers, copy-paste and crawlers. */}
      <span className="sr-only">{children}</span>

      <span aria-hidden className="relative block whitespace-pre-wrap">
        {rendered}
        {decoding ? (
          <>
            <span
              aria-hidden
              className="glitch-tear pointer-events-none absolute inset-0 block whitespace-pre-wrap opacity-70"
            >
              {rendered}
            </span>
            <span
              aria-hidden
              className="glitch-tear pointer-events-none absolute inset-0 block whitespace-pre-wrap opacity-40 [animation-delay:-0.21s]"
            >
              {rendered}
            </span>
          </>
        ) : null}
      </span>
    </Tag>
  );
}
