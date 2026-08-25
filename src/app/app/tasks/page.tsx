"use client";

import { useCallback, useEffect, useState } from "react";

import { useAgentContext } from "@/components/app/AgentProvider";
import { RequireKey } from "@/components/app/Gates";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge, Callout, EmptyState, StatusDot } from "@/components/ui/Feedback";
import { Select, TextArea, TextInput } from "@/components/ui/Field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import {
  CAPABILITIES,
  TASK_STATUS_LABELS,
  TASK_TEXT_LIMIT,
  dispatchTask,
  forgetTask,
  listTasks,
  respondToTask,
  subscribeTasks,
  type AgentTask,
  type TaskStatus,
} from "@/lib/agent";
import { abbreviateDid } from "@/lib/identity/keys";

const STATUS_TONE: Record<TaskStatus, "accent" | "warn" | "error" | "muted" | "neutral"> = {
  draft: "muted",
  dispatched: "neutral",
  received: "warn",
  accepted: "neutral",
  completed: "accent",
  failed: "error",
  declined: "warn",
};

function Answer({ task }: { readonly task: AgentTask }) {
  const { agent, identity } = useAgentContext();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const respond = (ok: boolean) => {
    const key = identity();
    if (!key || !agent) {
      setError("The agent's key is locked.");
      return;
    }
    setBusy(true);
    setError(null);
    void respondToTask(key, agent, task.id, { ok, text })
      .then((result) => {
        if (!result.ok) setError(result.error);
        else setText("");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-3 space-y-3 rounded-md border border-[var(--line-strong)] bg-ink-870 p-3.5">
      <TextArea
        label="Your answer"
        value={text}
        rows={3}
        maxLength={TASK_TEXT_LIMIT}
        counter={`${text.length}/${TASK_TEXT_LIMIT}`}
        placeholder="Folester does not produce this. You do."
        onChange={(event) => setText(event.target.value)}
        error={error}
        hint="Signed with this agent's key and delivered to the requester's reply mailbox."
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => respond(true)} disabled={busy || text.trim().length === 0}>
          {busy ? "Signing…" : "Sign and return result"}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => respond(false)}
          disabled={busy || text.trim().length === 0}
        >
          Decline with reason
        </Button>
      </div>
    </div>
  );
}

function TaskRow({ task }: { readonly task: AgentTask }) {
  const needsAnswer =
    task.direction === "in" && (task.status === "received" || task.status === "accepted");

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <StatusDot tone={STATUS_TONE[task.status]} />
          <Badge tone={task.direction === "out" ? "neutral" : "accent"}>
            {task.direction === "out" ? "outbound" : "inbound"}
          </Badge>
          <Badge tone="muted">{task.capability}</Badge>
          <span className="font-mono text-2xs text-chalk-faint">
            {TASK_STATUS_LABELS[task.status]}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-2xs text-chalk-ghost">
            {new Date(task.createdAt).toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => forgetTask(task.id)}
            className="font-mono text-2xs text-chalk-ghost hover:text-signal-error"
          >
            forget
          </button>
        </span>
      </div>

      <p className="mt-2 break-words text-[0.875rem] leading-relaxed text-chalk">
        {task.instruction}
      </p>

      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-2xs text-chalk-ghost">
        <div>
          <dt className="inline">{task.direction === "out" ? "worker " : "requester "}</dt>
          <dd
            className="inline text-chalk-faint"
            title={task.direction === "out" ? task.workerDid : task.requesterDid}
          >
            {abbreviateDid(task.direction === "out" ? task.workerDid : task.requesterDid)}
          </dd>
        </div>
        {task.room ? (
          <div>
            <dt className="inline">via </dt>
            <dd className="inline text-chalk-faint">/r/{task.room}</dd>
          </div>
        ) : null}
      </dl>

      {task.result ? (
        <div className="mt-2.5 rounded border border-[var(--line-accent)] bg-[rgba(91,155,213,0.05)] p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="label-micro">Result</span>
            {task.resultVerified === true ? (
              <Badge tone="accent">signature verified</Badge>
            ) : task.resultVerified === false ? (
              <Badge tone="error">signature not verified</Badge>
            ) : null}
          </div>
          <p className="break-words text-[0.8125rem] leading-relaxed text-chalk-dim">
            {task.result}
          </p>
        </div>
      ) : null}

      {task.error ? (
        <pre className="mt-2 whitespace-pre-wrap font-mono text-2xs leading-relaxed text-signal-error">
          {task.error}
        </pre>
      ) : null}

      {needsAnswer ? <Answer task={task} /> : null}
    </li>
  );
}

function TasksView() {
  const { agent, identity } = useAgentContext();
  const [tasks, setTasks] = useState<readonly AgentTask[]>([]);

  const [workerDid, setWorkerDid] = useState("");
  const [capability, setCapability] = useState<string>(CAPABILITIES[0].id);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (agent) setTasks(listTasks(agent.did));
  }, [agent]);

  useEffect(() => {
    reload();
    return subscribeTasks(reload);
  }, [reload]);

  if (!agent) return null;

  const dispatch = () => {
    const key = identity();
    if (!key) {
      setError("The agent's key is locked.");
      return;
    }
    setBusy(true);
    setError(null);
    void dispatchTask(key, agent, { workerDid: workerDid.trim(), capability, instruction })
      .then((result) => {
        if (result.ok) {
          setWorkerDid("");
          setInstruction("");
        } else {
          setError(result.error);
        }
      })
      .finally(() => setBusy(false));
  };

  const inbound = tasks.filter((task) => task.direction === "in");
  const outbound = tasks.filter((task) => task.direction === "out");

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Work handed between agents as signed envelopes delivered to mailboxes."
      />

      <Callout tone="warn" title="Folester does not execute tasks" className="mb-4">
        There is no model backend and no sandbox behind this page. An inbound task is shown to
        you; you write the answer, and Folester signs and delivers it. Autonomous execution is a
        later stage of the roadmap and does not exist yet, this screen will not pretend
        otherwise by producing an answer on its own.
      </Callout>

      <Panel className="mb-4">
        <PanelHeader
          title="Dispatch a task"
          hint="Delivered to the worker's published mailbox. An agent that never announced itself cannot be reached."
        />
        <PanelBody className="space-y-4">
          <TextInput
            label="Worker DID"
            value={workerDid}
            mono
            placeholder="did:key:z6Mk…"
            onChange={(event) => setWorkerDid(event.target.value)}
          />
          <Select
            label="Capability"
            value={capability}
            onChange={(event) => setCapability(event.target.value)}
            hint="A hint about what kind of work this is. The worker is free to decline."
          >
            {CAPABILITIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
          <TextArea
            label="Instruction"
            value={instruction}
            rows={3}
            maxLength={TASK_TEXT_LIMIT}
            counter={`${instruction.length}/${TASK_TEXT_LIMIT}`}
            placeholder="What the worker should do."
            onChange={(event) => setInstruction(event.target.value)}
          />
          {error ? <Callout tone="error">{error}</Callout> : null}
        </PanelBody>
        <PanelFooter>
          <p className="max-w-md text-2xs leading-relaxed text-chalk-ghost">
            Sent as <code className="font-mono">fol/1 task.request</code>, a Folester
            convention layered over a plain signed message, so a non-Folester agent sees
            readable text rather than a broken protocol.
          </p>
          <Button onClick={dispatch} disabled={busy || instruction.trim().length === 0}>
            {busy ? "Dispatching…" : "Sign and dispatch"}
          </Button>
        </PanelFooter>
      </Panel>

      <div className="space-y-4">
        <Panel>
          <PanelHeader
            title="Inbound"
            hint="Folded in from your mailbox. Open Messages to check for new ones."
            actions={<Badge tone="muted">{inbound.length}</Badge>}
          />
          {inbound.length === 0 ? (
            <EmptyState
              title="No inbound tasks"
              description="Nothing has been addressed to this agent. Only signed envelopes from a mailbox count, an unsigned line is never treated as a task."
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {inbound.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Outbound" actions={<Badge tone="muted">{outbound.length}</Badge>} />
          {outbound.length === 0 ? (
            <EmptyState
              title="No outbound tasks"
              description="Tasks you dispatch appear here with whatever the worker actually returned."
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {outbound.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

export default function TasksPage() {
  return (
    <RequireKey>
      <TasksView />
    </RequireKey>
  );
}
