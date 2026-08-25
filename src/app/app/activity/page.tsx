"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentContext } from "@/components/app/AgentProvider";
import { RequireAgent } from "@/components/app/Gates";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, StatusDot } from "@/components/ui/Feedback";
import { Segmented } from "@/components/ui/Field";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import {
  activityCounts,
  clearActivity,
  listActivity,
  subscribeActivity,
  type ActivityEvent,
} from "@/lib/agent";

/**
 * The log of what this agent actually did.
 *
 * Entries are appended by the domain layer at the moment a call returns, which
 * means failures are recorded with the service's own error text rather than a
 * friendlier paraphrase. Nothing is seeded: a new install shows an empty log,
 * because a new install has done nothing.
 */

const GROUP: Record<string, string> = {
  identity: "identity",
  technocore: "network",
  profile: "identity",
  message: "messages",
  memory: "memory",
  room: "messages",
  task: "tasks",
  discovery: "network",
};

const GROUP_TONE: Record<string, "accent" | "neutral" | "muted"> = {
  identity: "accent",
  messages: "neutral",
  memory: "neutral",
  tasks: "neutral",
  network: "muted",
};

function groupOf(event: ActivityEvent): string {
  return GROUP[event.kind.split(".")[0]] ?? "other";
}

function relative(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function ActivityView() {
  const { agent } = useAgentContext();
  const [events, setEvents] = useState<readonly ActivityEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "errors">("all");
  const [now, setNow] = useState<number | null>(null);

  const reload = useCallback(() => {
    if (agent) setEvents(listActivity(agent.did));
  }, [agent]);

  useEffect(() => {
    reload();
    return subscribeActivity(reload);
  }, [reload]);

  /* Timestamps are rendered relative to a clock read after mount, so the server
     and the first client render agree. */
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const counts = useMemo(() => (agent ? activityCounts(agent.did) : null), [agent, events]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!agent || !counts) return null;

  const visible = filter === "errors" ? events.filter((e) => e.status === "error") : events;

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every network operation this agent performed, including the ones that failed."
        actions={
          <Segmented
            label="Filter"
            value={filter}
            onChange={setFilter}
            options={[
              { id: "all", label: `All ${counts.total}` },
              { id: "errors", label: `Errors ${counts.errors}` },
            ]}
          />
        }
      />

      <Panel className="mb-4">
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
          {[
            { label: "Events", value: counts.total },
            { label: "Signed messages", value: counts.signedMessages },
            { label: "Memory writes", value: counts.memoryWrites },
            { label: "Errors", value: counts.errors },
          ].map((stat) => (
            <div key={stat.label} className="px-5 py-3.5">
              <p className="label-micro">{stat.label}</p>
              <p
                className={`mt-1 font-mono text-base ${
                  stat.label === "Errors" && stat.value > 0 ? "text-signal-error" : "text-chalk"
                }`}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Log"
          hint={
            counts.lastAt && now !== null
              ? `Last event ${relative(counts.lastAt, now)}`
              : "Newest first. Kept to the last 500 events on this device."
          }
          actions={
            events.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => clearActivity(agent.did)}>
                Clear log
              </Button>
            ) : null
          }
        />

        {visible.length === 0 ? (
          <EmptyState
            title={filter === "errors" ? "No failures recorded" : "Nothing has happened yet"}
            description={
              filter === "errors"
                ? "No call this agent made has come back as an error."
                : "This log fills up as the agent signs messages, writes memory, and talks to Technocore. It starts empty because nothing has been done."
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {visible.map((event) => (
              <li key={event.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusDot tone={event.status === "error" ? "error" : "accent"} />
                  <code className="font-mono text-2xs text-chalk-faint">{event.kind}</code>
                  <Badge tone={GROUP_TONE[groupOf(event)] ?? "muted"}>{groupOf(event)}</Badge>
                  <span className="ml-auto font-mono text-2xs text-chalk-ghost">
                    {now === null ? "" : relative(event.at, now)}
                  </span>
                </div>

                <p
                  className={`mt-1.5 break-words text-[0.8125rem] leading-relaxed ${
                    event.status === "error" ? "text-signal-error" : "text-chalk"
                  }`}
                >
                  {event.summary}
                </p>

                {event.path ? (
                  <code className="mt-1 block truncate font-mono text-2xs text-chalk-ghost">
                    {event.path}
                  </code>
                ) : null}

                {event.detail ? (
                  <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-ink-950 px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-chalk-dim">
                    {event.detail}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <PanelFooter>
          <p className="max-w-lg text-2xs leading-relaxed text-chalk-ghost">
            Failures show the service&rsquo;s own response text, not a rewritten one. The log
            lives in this browser only, clearing it removes nothing from Technocore, because
            Technocore never received it.
          </p>
        </PanelFooter>
      </Panel>
    </>
  );
}

export default function ActivityPage() {
  return (
    <RequireAgent>
      <ActivityView />
    </RequireAgent>
  );
}
