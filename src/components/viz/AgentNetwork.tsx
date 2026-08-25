"use client";

import { useEffect, useRef, useState } from "react";

import { AgentNetworkScene } from "@/lib/viz/network-scene";

/**
 * The canvas the marketing site is built around.
 *
 * This component owns lifecycle only, the scene itself is framework-free. Its job
 * is to keep the GPU quiet when the scene cannot be seen: it stops on scroll-out,
 * stops on a hidden tab, drops to a reduced topology on small screens, and renders a
 * single static frame when the visitor has asked for reduced motion.
 *
 * Scroll progress is read from the element's own position rather than from a global
 * scroll listener, so the narrative advances relative to the section it belongs to.
 *
 * The caller owns positioning: `className` must carry a position utility, because the
 * canvas and its backdrop are absolutely positioned against this host. The root does
 * not assert `relative` of its own, Tailwind resolves competing `position` utilities
 * by stylesheet order rather than attribute order, so a hardcoded `relative` here
 * silently beats a caller's `fixed` and the host takes real layout space.
 */
export function AgentNetwork({
  className = "relative",
  /** Element whose scroll extent drives the five stages. Defaults to the canvas host. */
  driverId,
  /**
   * Drive the stages from the whole document instead of one element, so the scene
   * spans the entire page: progress is 0 at the top and exactly 1 at the bottom.
   */
  spanPage = false,
}: {
  readonly className?: string;
  readonly driverId?: string;
  readonly spanPage?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<AgentNetworkScene | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compactQuery = window.matchMedia("(max-width: 820px)");

    let scene: AgentNetworkScene | null = null;
    let visible = false;
    let disposed = false;

    /* -- progress ---------------------------------------------------------- */

    const driver = driverId ? document.getElementById(driverId) : null;

    const readProgress = () => {
      if (spanPage) {
        // The scene is pinned across the whole document: map total scroll extent
        // onto 0..1 so every stage gets a share of the page rather than of the hero.
        const extent = document.documentElement.scrollHeight - window.innerHeight;
        if (extent <= 0) return 0;
        return Math.min(1, Math.max(0, window.scrollY / extent));
      }
      const target = driver ?? host;
      const rect = target.getBoundingClientRect();
      // Travel is the distance the element moves from "top just entered" to
      // "bottom just left", so progress reaches 1 exactly as it exits.
      const travel = rect.height + window.innerHeight;
      if (travel <= 0) return 0;
      const scrolled = window.innerHeight - rect.top;
      return Math.min(1, Math.max(0, scrolled / travel));
    };

    let queued = false;
    const pushProgress = () => {
      if (queued || !scene) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        scene?.setProgress(readProgress());
      });
    };

    /* -- build ------------------------------------------------------------- */

    const build = () => {
      try {
        scene = new AgentNetworkScene({
          canvas,
          compact: compactQuery.matches,
          reducedMotion: motionQuery.matches,
        });
      } catch (error) {
        // A machine without a usable WebGL context is a real outcome, not an error
        // worth shouting about: the page falls back to the CSS gradient underneath.
        console.warn("Folester: agent network scene unavailable.", error);
        setFailed(true);
        return;
      }
      sceneRef.current = scene;
      scene.resize(host.clientWidth, host.clientHeight);
      scene.setProgress(readProgress());
      if (visible && !document.hidden) scene.start();
    };

    const teardown = () => {
      scene?.dispose();
      scene = null;
      sceneRef.current = null;
    };

    build();

    /* -- observers --------------------------------------------------------- */

    const resizeObserver = new ResizeObserver(() => {
      if (host.clientWidth > 0) scene?.resize(host.clientWidth, host.clientHeight);
    });
    resizeObserver.observe(host);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !document.hidden) scene?.start();
        else scene?.stop();
      },
      { rootMargin: "120px" },
    );
    intersectionObserver.observe(host);

    const onVisibility = () => {
      if (document.hidden) scene?.stop();
      else if (visible) scene?.start();
    };

    // Rebuild rather than mutate: topology and pixel ratio are fixed at construction,
    // so crossing the breakpoint means a new scene at the correct complexity.
    const onEnvironmentChange = () => {
      if (disposed) return;
      teardown();
      setFailed(false);
      build();
    };

    window.addEventListener("scroll", pushProgress, { passive: true });
    window.addEventListener("resize", pushProgress, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    motionQuery.addEventListener("change", onEnvironmentChange);
    compactQuery.addEventListener("change", onEnvironmentChange);

    return () => {
      disposed = true;
      window.removeEventListener("scroll", pushProgress);
      window.removeEventListener("resize", pushProgress);
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery.removeEventListener("change", onEnvironmentChange);
      compactQuery.removeEventListener("change", onEnvironmentChange);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      teardown();
    };
  }, [driverId, spanPage]);

  return (
    <div ref={hostRef} className={`overflow-hidden ${className}`} aria-hidden>
      {/* Behind the canvas: the scene's own background, so a failed context degrades
          to a plausible surface instead of a white hole. */}
      <div className="absolute inset-0 bg-ink-950" />
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 size-full transition-opacity duration-700 ${
          failed ? "opacity-0" : "opacity-100"
        }`}
      />
      {failed ? <div className="absolute inset-0 grid-fade" /> : null}
    </div>
  );
}
