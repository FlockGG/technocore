/**
 * Agent-to-agent tasks.
 *
 * What this layer does: carries a structured request from one agent's key to
 * another agent's mailbox as a signed message, tracks its state, and verifies the
 * result came from the key it was addressed to.
 *
 * What it does NOT do: execute anything. Folester has no model backend and no
 * sandbox, so an incoming task is presented to the operator, who answers it; the
 * answer is then signed and returned. Autonomous execution is a later stage of the
 * roadmap and the UI says so on the page rather than implying a worker exists.
 *
 * The wire format is a single line, because a note or message is a single line:
 *
 *     fol/1 task.request {"id":"…","cap":"research","text":"…"}
 *     fol/1 task.result  {"id":"…","ok":true,"text":"…"}
 *     fol/1 task.decline {"id":"…","reason":"…"}
 *
 * This envelope is Folester's own convention, not part of Technocore. It is
 * namespaced so that an agent which does not speak it sees an obviously-tagged line
 * it can ignore, and so Folester never mistakes an ordinary message for a task.
 */

import { isDid } from "@/lib/identity/keys";
import type { SecretIdentity } from "@/lib/identity/keys";
import { MAX_TEXT_CHARS } from "@/lib/identity/sweep";
import { newId, onStoreChange, readJson, writeJson } from "@/lib/storage";

import { recordActivity } from "./activity";
import { resolvePeer, sendMessage } from "./messaging";
import type { AgentRecord, AgentTask, ConversationMessage, TaskStatus } from "./types";

const TASKS_KEY = "folester.tasks.v1";

export const ENVELOPE_PREFIX = "fol/1";

export type EnvelopeType = "task.request" | "task.result" | "task.decline";

/** Room for the envelope tag and JSON braces, so `text` cannot overflow the line. */
export const TASK_TEXT_LIMIT = MAX_TEXT_CHARS - 256;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeTasks(listener: Listener): () => void {
  listeners.add(listener);
  const unsubscribe = onStoreChange((key) => {
    if (key === TASKS_KEY) listener();
  });
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

function load(): AgentTask[] {
  return readJson<AgentTask[]>(TASKS_KEY, []);
}

function save(tasks: readonly AgentTask[]): void {
  writeJson(TASKS_KEY, tasks);
  emit();
}

export function listTasks(agentDid?: string): readonly AgentTask[] {
  const tasks = load();
  const scoped = agentDid
    ? tasks.filter((task) => task.requesterDid === agentDid || task.workerDid === agentDid)
    : tasks;
  return scoped.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTask(id: string): AgentTask | null {
  return load().find((task) => task.id === id) ?? null;
}

function upsert(task: AgentTask): AgentTask {
  const tasks = load();
  const position = tasks.findIndex((candidate) => candidate.id === task.id);
  save(position === -1 ? [...tasks, task] : tasks.map((c, i) => (i === position ? task : c)));
  return task;
}

/* -------------------------------------------------------------------------- */
/* Envelope                                                                    */
/* -------------------------------------------------------------------------- */

export interface Envelope {
  readonly type: EnvelopeType;
  readonly body: Record<string, unknown>;
}

export function encodeEnvelope(type: EnvelopeType, body: Record<string, unknown>): string {
  return `${ENVELOPE_PREFIX} ${type} ${JSON.stringify(body)}`;
}

/**
 * Parse a message that may be a Folester envelope. Returns null for anything else,
 * including a malformed envelope — a line Folester cannot read is not a task.
 */
export function decodeEnvelope(text: string): Envelope | null {
  if (!text.startsWith(`${ENVELOPE_PREFIX} `)) return null;
  const rest = text.slice(ENVELOPE_PREFIX.length + 1);
  const split = rest.indexOf(" ");
  if (split === -1) return null;

  const type = rest.slice(0, split);
  if (type !== "task.request" && type !== "task.result" && type !== "task.decline") return null;

  try {
    const body = JSON.parse(rest.slice(split + 1)) as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    return { type, body: body as Record<string, unknown> };
  } catch {
    return null;
  }
}

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

/* -------------------------------------------------------------------------- */
/* Outbound                                                                    */
/* -------------------------------------------------------------------------- */

export interface DispatchResult {
  readonly task: AgentTask | null;
  readonly ok: boolean;
  readonly error: string | null;
  readonly signature: { sig: string; payload: string } | null;
}

/**
 * Send a task request to a peer's mailbox.
 *
 * The peer's mailbox comes from its published DID note; there is no directory to
 * fall back on, so an agent that never announced itself simply cannot be given
 * work, and that is what the error says.
 */
export async function dispatchTask(
  identity: SecretIdentity,
  agent: AgentRecord,
  input: { workerDid: string; capability: string; instruction: string },
): Promise<DispatchResult> {
  const instruction = input.instruction.trim();
  if (!instruction) return { task: null, ok: false, error: "A task needs an instruction.", signature: null };
  if (!isDid(input.workerDid)) {
    return { task: null, ok: false, error: "The worker must be a did:key identifier.", signature: null };
  }
  if (input.workerDid === agent.did) {
    return { task: null, ok: false, error: "An agent cannot dispatch a task to itself.", signature: null };
  }

  const now = new Date().toISOString();
  const task: AgentTask = {
    id: newId("task"),
    direction: "out",
    requesterDid: agent.did,
    workerDid: input.workerDid,
    capability: input.capability,
    instruction,
    status: "draft",
    createdAt: now,
    dispatchedAt: null,
    settledAt: null,
    result: null,
    error: null,
    room: null,
    resultVerified: null,
  };
  upsert(task);

  const { channel, error: resolveError } = await resolvePeer(input.workerDid);
  if (!channel) {
    const failed: AgentTask = { ...task, status: "failed", error: resolveError, settledAt: new Date().toISOString() };
    upsert(failed);
    recordActivity({
      agentDid: agent.did,
      kind: "task.failed",
      summary: "Could not reach worker agent",
      status: "error",
      detail: resolveError ?? undefined,
    });
    return { task: failed, ok: false, error: resolveError, signature: null };
  }

  const line = encodeEnvelope("task.request", {
    id: task.id,
    cap: input.capability,
    text: instruction.slice(0, TASK_TEXT_LIMIT),
    reply: agent.mailboxRoom,
  });

  const sent = await sendMessage(identity, agent, channel.mailbox, line);
  if (!sent.ok) {
    const failed: AgentTask = {
      ...task,
      status: "failed",
      error: sent.error,
      room: channel.mailbox,
      settledAt: new Date().toISOString(),
    };
    upsert(failed);
    recordActivity({
      agentDid: agent.did,
      kind: "task.failed",
      summary: `Failed to dispatch task to ${channel.mailbox}`,
      status: "error",
      detail: sent.error ?? undefined,
    });
    return { task: failed, ok: false, error: sent.error, signature: null };
  }

  const dispatched: AgentTask = {
    ...task,
    status: "dispatched",
    dispatchedAt: new Date().toISOString(),
    room: channel.mailbox,
  };
  upsert(dispatched);
  recordActivity({
    agentDid: agent.did,
    kind: "task.dispatched",
    summary: `Dispatched ${input.capability} task to ${channel.peer.fingerprint}`,
    path: `/r/${channel.mailbox}`,
  });

  return {
    task: dispatched,
    ok: true,
    error: null,
    signature: sent.signature ? { sig: sent.signature.sig, payload: sent.signature.payload } : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Inbound                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Fold mailbox messages into the task list.
 *
 * Only signed records are considered. A `self-asserted` line in a mailbox should be
 * impossible — the service rejects unsigned writes to `mb-` rooms with 403 — but
 * treating attribution as a precondition here rather than assuming it means a
 * change in room class can never turn into a forged task.
 */
export function ingestMailbox(
  agent: AgentRecord,
  room: string,
  messages: readonly ConversationMessage[],
): { received: AgentTask[]; settled: AgentTask[] } {
  const received: AgentTask[] = [];
  const settled: AgentTask[] = [];

  for (const message of messages) {
    if (message.attribution === "self-asserted") continue;
    const envelope = decodeEnvelope(message.text);
    if (!envelope) continue;

    const id = asString(envelope.body.id);
    if (!id) continue;

    if (envelope.type === "task.request") {
      if (message.from === agent.did) continue; // our own dispatch echoing back
      if (getTask(id)) continue;
      const task: AgentTask = {
        id,
        direction: "in",
        requesterDid: message.from,
        workerDid: agent.did,
        capability: asString(envelope.body.cap) ?? "unspecified",
        instruction: asString(envelope.body.text) ?? "",
        status: "received",
        createdAt: message.ts,
        dispatchedAt: message.ts,
        settledAt: null,
        result: null,
        error: null,
        room: asString(envelope.body.reply) ?? room,
        resultVerified: null,
      };
      received.push(upsert(task));
      recordActivity({
        agentDid: agent.did,
        kind: "task.received",
        summary: `Task request received: ${task.capability}`,
        path: `/r/${room}`,
      });
      continue;
    }

    const existing = getTask(id);
    if (!existing || existing.direction !== "out") continue;
    // A result only counts from the key the task was addressed to.
    if (message.from !== existing.workerDid) continue;
    if (existing.status === "completed" || existing.status === "declined") continue;

    if (envelope.type === "task.result") {
      const ok = envelope.body.ok !== false;
      const task: AgentTask = {
        ...existing,
        status: ok ? "completed" : "failed",
        result: asString(envelope.body.text),
        error: ok ? null : (asString(envelope.body.text) ?? "The worker reported a failure."),
        settledAt: message.ts,
        // Reached only for a signed record (unsigned lines are skipped above) whose
        // author matches the worker this task was addressed to. The service checked
        // that signature at write time; the read API does not return it, so this
        // records Technocore's verification, not Folester's own.
        resultVerified: true,
      };
      settled.push(upsert(task));
      recordActivity({
        agentDid: agent.did,
        kind: ok ? "task.completed" : "task.failed",
        summary: ok ? `Task ${existing.capability} completed by worker` : `Worker reported task failure`,
        status: ok ? "ok" : "error",
        path: `/r/${room}`,
      });
    } else {
      const task: AgentTask = {
        ...existing,
        status: "declined",
        error: asString(envelope.body.reason) ?? "Declined by the worker.",
        settledAt: message.ts,
      };
      settled.push(upsert(task));
      recordActivity({
        agentDid: agent.did,
        kind: "task.failed",
        summary: `Task declined by worker`,
        status: "error",
        path: `/r/${room}`,
      });
    }
  }

  return { received, settled };
}

/**
 * Answer an incoming task.
 *
 * The operator writes the result. Folester signs and delivers it — it does not
 * produce it, and the UI must not suggest otherwise.
 */
export async function respondToTask(
  identity: SecretIdentity,
  agent: AgentRecord,
  taskId: string,
  outcome: { ok: boolean; text: string },
): Promise<{ ok: boolean; error: string | null; task: AgentTask | null }> {
  const task = getTask(taskId);
  if (!task) return { ok: false, error: "Unknown task.", task: null };
  if (task.direction !== "in") return { ok: false, error: "This task was not addressed to this agent.", task };
  if (!task.room) return { ok: false, error: "This task carries no reply mailbox.", task };

  const line = outcome.ok
    ? encodeEnvelope("task.result", { id: task.id, ok: true, text: outcome.text.slice(0, TASK_TEXT_LIMIT) })
    : encodeEnvelope("task.decline", { id: task.id, reason: outcome.text.slice(0, TASK_TEXT_LIMIT) });

  const sent = await sendMessage(identity, agent, task.room, line);
  if (!sent.ok) {
    recordActivity({
      agentDid: agent.did,
      kind: "task.failed",
      summary: "Failed to return task result",
      status: "error",
      detail: sent.error ?? undefined,
      path: `/r/${task.room}`,
    });
    return { ok: false, error: sent.error, task };
  }

  const updated = upsert({
    ...task,
    status: outcome.ok ? "completed" : "declined",
    result: outcome.ok ? outcome.text : null,
    error: outcome.ok ? null : outcome.text,
    settledAt: new Date().toISOString(),
    resultVerified: true,
  });
  recordActivity({
    agentDid: agent.did,
    kind: outcome.ok ? "task.completed" : "task.failed",
    summary: outcome.ok ? `Returned signed result for ${task.capability} task` : "Declined task",
    path: `/r/${task.room}`,
  });
  return { ok: true, error: null, task: updated };
}

export function forgetTask(id: string): void {
  save(load().filter((task) => task.id !== id));
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  draft: "Draft",
  dispatched: "Dispatched",
  received: "Awaiting response",
  accepted: "Accepted",
  completed: "Completed",
  failed: "Failed",
  declined: "Declined",
};
