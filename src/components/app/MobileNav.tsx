"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { Sidebar } from "@/components/app/Sidebar";
import { FolesterMark } from "@/components/brand/FolesterMark";

/** The sidebar as a slide-over, for screens too narrow for a permanent rail. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // A navigation is the signal the drawer's job is done.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded px-1 py-1 text-chalk-dim hover:text-chalk"
      >
        <FolesterMark size={16} className="text-agent-500" />
        <span className="text-2xs tracking-[0.14em] uppercase">Folester</span>
        <span className="ml-1 space-y-0.5" aria-hidden>
          <span className="block h-px w-3 bg-current" />
          <span className="block h-px w-3 bg-current" />
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 w-60 border-r border-[var(--line-strong)] bg-black">
            <Sidebar />
          </div>
        </div>
      ) : null}
    </>
  );
}
