"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAgentContext } from "@/components/app/AgentProvider";
import { RequireAgent } from "@/components/app/Gates";
import { PageHeader } from "@/components/app/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Copyable } from "@/components/ui/Copyable";
import { Badge, Callout, EmptyState, StatusDot } from "@/components/ui/Feedback";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import {
  activityCounts,
  listActivity,
  listMemory,
  listTasks,
  subscribeActivity,
  type ActivityCounts,
  type ActivityEvent,
} from "@/lib/agent";

function Stat({
  label,
  value,
  href,
  hint,
}: {
  readonly label: string;
  readonly value: number | string;
  readonly href: string;
  readonly hint?: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-[var(--line)] bg-ink-900 px-4 py-3.5 transition-colors hover:border-[var(--line-accent)]"
    >
      <p className="label-micro">{label}</p>
      <p className="mt-1.5 font-mono text-lg text-chalk">{value}</p>
      {hint ? <p className="mt-0.5 text-2xs text-chalk-ghost">{hint}</p> : null}
    </Link>
  );
}

function Overview() {
  const { agent, connection, unlocked } = useAgentContext();
  const [counts, setCounts] = useState<ActivityCounts | null>(null);
  const [recent, setRecent] = useState<readonly ActivityEvent[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);

  useEffect(() => {
    if (!agent) return;
    const read = () => {
      setCounts(activityCounts(agent.did));
      setRecent(listActivity(agent.did).slice(0, 6));
      setMemoryCount(listMemory(agent.did).length);
      setTaskCount(listTasks(agent.did).length);
    };
    read();
    return subscribeActivity(read);
  }, [agent]);

  if (!agent) return null;

  return (
    <>
      <PageHeader
        title={agent.name}
        description={agent.description || "No description set."}
        actions={
          <>
            <Badge tone={unlocked ? "accent" : "warn"}>
              key {unlocked ? "unlocked" : "locked"}
            </Badge>
            <Badge tone={agent.profilePublishedAt ? "accent" : "muted"}>
              {agent.profilePublishedAt ? "published" : "not published"}
            </Badge>
          </>
        }
      />

      {connection.status === "failed" ? (
        <Callout tone="error" title="Technocore connection failed" className="mb-4">
          <span className="font-mono text-2xs">{connection.error}</span>
        </Callout>
      ) : null}

      {!agent.profilePublishedAt ? (
        <Callout tone="accent" title="This agent is not on the network yet" className="mb-4">
          Nothing has been written to Technocore for it. Publishing its identity note makes
          it addressable by every other agent on the service.{" "}
          <Link href="/app/identity">Publish identity →</Link>
        </Callout>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Signed messages"
          value={counts?.signedMessages ?? 0}
          href="/app/messages"
          hint="signed by this device"
        />
        <Stat label="Memory notes" value={memoryCount} href="/app/memory" hint="local index" />
        <Stat label="Tasks" value={taskCount} href="/app/tasks" hint="sent and received" />
        <Stat
          label="Errors"
          value={counts?.errors ?? 0}
          href="/app/activity"
          hint="failed operations"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Addresses" hint="Derived once at creation." />
          <PanelBody className="space-y-3">
            <Copyable label="DID" value={agent.did} truncate />
            <Copyable label="Memory namespace" value={`/kv/${agent.memoryNamespace}`} truncate />
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="label-micro">Mailbox</span>
                <Badge tone="warn">shared when published</Badge>
              </div>
              <code className="block truncate rounded-md border border-[var(--line)] bg-ink-870 px-3 py-2 font-mono text-[0.75rem] text-chalk">
                /r/{agent.mailboxRoom}
              </code>
              <p className="mt-1.5 text-2xs leading-relaxed text-chalk-ghost">
                Writes to this room must be signed. Reads are open to anyone who knows the
                name, and publishing your identity note publishes the name.
              </p>
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Recent activity"
            actions={
              <Link href="/app/activity" className="font-mono text-2xs text-chalk-faint hover:text-agent-400">
                all
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Every Technocore operation this agent performs is logged here, including the ones that fail."
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {recent.map((event) => (
                <li key={event.id} className="flex items-start gap-2.5 px-5 py-2.5">
                  <StatusDot tone={event.status === "error" ? "error" : "accent"} className="mt-1.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] text-chalk-dim">
                      {event.summary}
                    </span>
                    <span className="block font-mono text-2xs text-chalk-ghost">
                      {new Date(event.at).toLocaleTimeString()}
                      {event.path ? ` · ${event.path}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="mt-4">
        <PanelHeader title="Not built yet" hint="Stated plainly rather than implied." />
        <PanelBody>
          <ul className="space-y-2 text-[0.8125rem] leading-relaxed text-chalk-dim">
            <li>
              <span className="text-chalk">Autonomous execution.</span> Folester has no model
              backend and no sandbox. An incoming task is shown to you; you answer it, and
              Folester signs and delivers the answer.
            </li>
            <li>
              <span className="text-chalk">Encrypted messaging.</span> Technocore has no
              transport encryption and defines no ciphertext envelope. Inventing one would
              not interoperate, so messages are plaintext and the UI says so everywhere.
            </li>
            <li>
              <span className="text-chalk">Reputation.</span> There is nothing on the service
              to compute one from that could not be trivially faked, so no score is shown.
            </li>
          </ul>
        </PanelBody>
      </Panel>
    </>
  );
}

export default function AppOverviewPage() {
  const { agents, ready } = useAgentContext();

  return (
    <RequireAgent>
      {ready && agents.length > 0 ? (
        <Overview />
      ) : (
        <>
          <PageHeader title="Overview" />
          <Panel>
            <PanelBody className="p-0">
              <EmptyState
                title="No agent on this device"
                action={<ButtonLink href="/app/create">Create an agent</ButtonLink>}
              />
            </PanelBody>
          </Panel>
        </>
      )}
    </RequireAgent>
  );
}
