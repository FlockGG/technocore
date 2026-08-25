"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useAgentContext } from "@/components/app/AgentProvider";
import { FolesterMark } from "@/components/brand/FolesterMark";
import { StatusDot, type Tone } from "@/components/ui/Feedback";
import { abbreviateDid } from "@/lib/identity/keys";

const NAV = [
  { href: "/app", label: "Overview" },
  { href: "/app/identity", label: "Identity" },
  { href: "/app/memory", label: "Memory" },
  { href: "/app/messages", label: "Messages" },
  { href: "/app/network", label: "Network" },
  { href: "/app/tasks", label: "Tasks" },
  { href: "/app/activity", label: "Activity" },
  { href: "/app/settings", label: "Settings" },
] as const;

/** The connection indicator. Reports what the last real request returned. */
export function ConnectionBadge({ compact = false }: { readonly compact?: boolean }) {
  const { connection, reconnect } = useAgentContext();

  const tone: Tone =
    connection.status === "connected"
      ? "accent"
      : connection.status === "failed"
        ? "error"
        : "muted";

  const label =
    connection.status === "connected"
      ? `technocore ${connection.service.version} · ${connection.latencyMs}ms`
      : connection.status === "failed"
        ? "technocore connection failed"
        : connection.status === "connecting"
          ? "connecting…"
          : "idle";

  return (
    <button
      type="button"
      onClick={reconnect}
      title={connection.status === "failed" ? connection.error : "Re-check the connection"}
      className={`flex items-center gap-2 rounded border border-[var(--line-strong)] px-2 py-1 font-mono text-2xs transition-colors hover:border-[var(--line-accent)] ${
        tone === "error" ? "text-signal-error" : "text-chalk-faint"
      }`}
    >
      <StatusDot tone={tone} pulse={connection.status === "connecting"} />
      <span className={compact ? "hidden sm:inline" : ""}>{label}</span>
    </button>
  );
}

function AgentSwitcher() {
  const { agents, agent, select } = useAgentContext();
  const [open, setOpen] = useState(false);

  if (!agent) {
    return (
      <Link
        href="/app/create"
        className="block rounded-md border border-dashed border-[var(--line-strong)] px-2.5 py-2 text-[0.8125rem] text-chalk-dim hover:border-[var(--line-accent)] hover:text-chalk"
      >
        Create an agent
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full rounded-md border border-[var(--line)] bg-ink-870 px-2.5 py-2 text-left transition-colors hover:border-[var(--line-strong)]"
      >
        <span className="block truncate text-[0.8125rem] text-chalk">{agent.name}</span>
        <span className="mt-0.5 block truncate font-mono text-2xs text-chalk-ghost">
          {abbreviateDid(agent.did)}
        </span>
      </button>

      {open ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-[var(--line-strong)] bg-ink-850">
          {agents.map((candidate) => (
            <button
              key={candidate.did}
              type="button"
              onClick={() => {
                select(candidate.did);
                setOpen(false);
              }}
              className={`block w-full px-2.5 py-2 text-left text-[0.8125rem] hover:bg-ink-800 ${
                candidate.did === agent.did ? "text-agent-400" : "text-chalk-dim"
              }`}
            >
              <span className="block truncate">{candidate.name}</span>
              <span className="block truncate font-mono text-2xs text-chalk-ghost">
                {abbreviateDid(candidate.did)}
              </span>
            </button>
          ))}
          <Link
            href="/app/create"
            onClick={() => setOpen(false)}
            className="block border-t border-[var(--line)] px-2.5 py-2 text-[0.8125rem] text-chalk-faint hover:bg-ink-800 hover:text-chalk"
          >
            + New agent
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { unlocked, agent } = useAgentContext();

  return (
    <aside className="flex h-full w-full flex-col gap-4 p-3">
      <Link href="/" className="flex items-center gap-2.5 px-1.5 pt-1">
        <FolesterMark size={17} className="text-agent-500" title="Folester" />
        <span className="text-2xs tracking-[0.14em] text-chalk-dim uppercase">Folester</span>
      </Link>

      <AgentSwitcher />

      <nav className="flex-1 space-y-0.5" aria-label="App">
        {NAV.map((item) => {
          const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded px-2 py-1.5 text-[0.8125rem] transition-colors ${
                active ? "bg-ink-850 text-chalk" : "text-chalk-faint hover:text-chalk-dim"
              }`}
            >
              <span
                className={`h-3.5 w-px transition-colors ${active ? "bg-agent-500" : "bg-transparent"}`}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {agent ? (
        <div className="rounded-md border border-[var(--line)] px-2.5 py-2">
          <span className="flex items-center gap-2 font-mono text-2xs">
            <StatusDot tone={unlocked ? "accent" : "warn"} />
            <span className={unlocked ? "text-chalk-dim" : "text-signal-warn"}>
              key {unlocked ? "unlocked" : "locked"}
            </span>
          </span>
        </div>
      ) : null}
    </aside>
  );
}
