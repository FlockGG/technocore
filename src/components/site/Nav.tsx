"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { FolesterMark } from "@/components/brand/FolesterMark";

const LINKS = [
  { href: "/#network", label: "Network" },
  { href: "/#agents", label: "Agents" },
  { href: "/docs", label: "Docs" },
] as const;

/**
 * The floating navigation surface.
 *
 * Not a full-width bar: it is an inset translucent plate over the scene, so the
 * visualisation reads as the page's ground rather than as a banner image. It
 * compacts once the hero is behind it.
 */
export function Nav() {
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4">
      <nav
        aria-label="Primary"
        className={`pointer-events-auto mt-3 w-full max-w-5xl rounded-xl border border-[var(--line-strong)] backdrop-blur-xl transition-all duration-500 ${
          open ? "bg-ink-900/95 shadow-2xl shadow-black/60" : "bg-ink-900/70"
        } ${compact ? "sm:mt-2" : ""}`}
      >
        <div
          className={`flex items-center justify-between gap-4 px-3.5 transition-all duration-500 ${
            compact ? "h-11" : "h-13"
          }`}
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 text-chalk transition-opacity hover:opacity-80"
            onClick={() => setOpen(false)}
          >
            <FolesterMark size={18} className="text-agent-500" title="Folester" />
            <span className="text-[0.8125rem] font-medium tracking-[0.14em] uppercase">
              Folester
            </span>
          </Link>

          <div className="hidden items-center gap-1 sm:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group relative rounded px-2.5 py-1.5 text-[0.8125rem] text-chalk-dim transition-colors hover:text-chalk"
              >
                {link.label}
                <span className="absolute inset-x-2.5 -bottom-px h-px scale-x-0 bg-agent-500/70 transition-transform duration-300 group-hover:scale-x-100" />
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/app"
              className="rounded-md bg-agent-500 px-3 py-1.5 text-[0.8125rem] font-medium text-ink-950 transition-colors hover:bg-agent-400"
            >
              Launch App
            </Link>
            <button
              type="button"
              aria-expanded={open}
              aria-label="Menu"
              onClick={() => setOpen((value) => !value)}
              className={`grid size-8 place-items-center rounded border transition-colors sm:hidden ${
                open
                  ? "border-[var(--line-accent)] bg-ink-800 text-agent-500"
                  : "border-[var(--line-strong)] text-chalk-dim"
              }`}
            >
              <span className="space-y-1">
                <span className="block h-px w-3.5 bg-current" />
                <span className="block h-px w-3.5 bg-current" />
              </span>
            </button>
          </div>
        </div>

        {open ? (
          <div className="border-t border-[var(--line)] p-2 sm:hidden">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="block rounded px-2.5 py-2 text-[0.875rem] text-chalk-dim hover:bg-ink-850 hover:text-chalk"
              >
                {link.label}
              </Link>
            ))}
          </div>
        ) : null}
      </nav>
    </header>
  );
}
