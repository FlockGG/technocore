/**
 * The agent activity log.
 *
 * Every real network operation an agent performs lands here — including the ones
 * that failed, with the service's own error text. This is the log the app shows
 * on the Activity page, so it must never contain anything Folester did not
 * actually do. There are no seeded or example entries.
 *
 * A plain module rather than a React store: the domain layers append to it from
 * inside async calls and must not depend on the UI. Views subscribe.
 */

import { newId, onStoreChange, readJson, writeJson } from "@/lib/storage";

import type { ActivityEvent, ActivityKind } from "./types";

const ACTIVITY_KEY = "folester.activity.v1";

/** Bounded so a long-poll loop cannot grow localStorage without limit. */
const MAX_EVENTS = 500;

type Listener = (events: readonly ActivityEvent[]) => void;

const listeners = new Set<Listener>();
let cache: readonly ActivityEvent[] | null = null;

function load(): readonly ActivityEvent[] {
  cache ??= readJson<ActivityEvent[]>(ACTIVITY_KEY, []);
  return cache;
}

function save(events: readonly ActivityEvent[]): void {
  cache = events;
  writeJson(ACTIVITY_KEY, events);
  for (const listener of listeners) listener(events);
}

export interface RecordActivityInput {
  agentDid: string;
  kind: ActivityKind;
  summary: string;
  status?: "ok" | "error";
  detail?: string;
  path?: string;
}

export function recordActivity(input: RecordActivityInput): ActivityEvent {
  const event: ActivityEvent = {
    id: newId("act"),
    agentDid: input.agentDid,
    kind: input.kind,
    at: new Date().toISOString(),
    summary: input.summary,
    status: input.status ?? "ok",
    detail: input.detail,
    path: input.path,
  };
  save([event, ...load()].slice(0, MAX_EVENTS));
  return event;
}

/** Newest first. */
export function listActivity(agentDid?: string): readonly ActivityEvent[] {
  const events = load();
  return agentDid ? events.filter((event) => event.agentDid === agentDid) : events;
}

export function clearActivity(agentDid?: string): void {
  save(agentDid ? load().filter((event) => event.agentDid !== agentDid) : []);
}

export function subscribeActivity(listener: Listener): () => void {
  listeners.add(listener);
  const unsubscribe = onStoreChange((key) => {
    if (key === ACTIVITY_KEY) {
      cache = null;
      listener(load());
    }
  });
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

/** For `useSyncExternalStore`: a stable reference that only changes on write. */
export function activitySnapshot(): readonly ActivityEvent[] {
  return load();
}

/** Counts for the dashboard. Real counts, from real events, or zero. */
export interface ActivityCounts {
  readonly total: number;
  readonly errors: number;
  readonly signedMessages: number;
  readonly memoryWrites: number;
  readonly lastAt: string | null;
}

export function activityCounts(agentDid?: string): ActivityCounts {
  const events = listActivity(agentDid);
  return {
    total: events.length,
    errors: events.filter((event) => event.status === "error").length,
    signedMessages: events.filter((event) => event.kind === "message.sent").length,
    memoryWrites: events.filter(
      (event) => event.kind === "memory.created" || event.kind === "memory.updated",
    ).length,
    lastAt: events[0]?.at ?? null,
  };
}
