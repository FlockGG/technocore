/**
 * The local agent registry.
 *
 * Holds the public half of every agent on this device: DID, name, and the
 * Technocore addresses derived from it. The private key is never in this file's
 * data — it lives encrypted in `identity/vault.ts` and unencrypted only in that
 * module's memory while unlocked.
 *
 * Addresses are derived once at creation and then stored, because they are
 * network identities: regenerating a mailbox name would orphan every message
 * already sent to the old one.
 */

import { didFingerprint } from "@/lib/identity/keys";
import { toValidName, unguessableSuffix } from "@/lib/identity/sweep";
import { newId, onStoreChange, readJson, writeJson } from "@/lib/storage";

import type { AgentRecord, MemoryScope } from "./types";

const AGENTS_KEY = "folester.agents.v1";
const ACTIVE_KEY = "folester.active-agent.v1";

type Listener = () => void;
const listeners = new Set<Listener>();

let cache: readonly AgentRecord[] | null = null;

function load(): readonly AgentRecord[] {
  cache ??= readJson<AgentRecord[]>(AGENTS_KEY, []);
  return cache;
}

function save(agents: readonly AgentRecord[]): void {
  cache = agents;
  writeJson(AGENTS_KEY, agents);
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function listAgents(): readonly AgentRecord[] {
  return load();
}

export function getAgent(did: string): AgentRecord | null {
  return load().find((agent) => agent.did === did) ?? null;
}

export function subscribeAgents(listener: Listener): () => void {
  listeners.add(listener);
  const unsubscribe = onStoreChange((key) => {
    if (key === AGENTS_KEY || key === ACTIVE_KEY) {
      cache = null;
      listener();
    }
  });
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

/* -------------------------------------------------------------------------- */
/* Address derivation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A mailbox must be both `mb-` (signed writes only — the service returns 403 for
 * an unsigned write) and `p-` (never enumerated by `/rooms`). Composed by prefix:
 * `mb-p-<body>`.
 *
 * The body is random rather than derived from the DID: on this service, knowing a
 * mailbox name is what lets you read it, so a name anyone could recompute from a
 * published DID would make the mailbox world-readable.
 */
export const newMailboxRoom = (): string => `mb-p-${unguessableSuffix(26)}`;

/**
 * A public memory namespace, derived from the DID so it is recoverable from the
 * identity alone. Enumerable — `/kv/fol-<fp>` lists its keys — which is what
 * makes memory restorable on a new device from Technocore.
 */
export const publicNamespaceFor = (did: string): string => `fol-${didFingerprint(did)}`;

/** A private namespace: not enumerable, so the key index exists only locally. */
export const privateNamespace = (): string => `p-${unguessableSuffix(26)}`;

function uniqueSlug(name: string, taken: readonly AgentRecord[]): string {
  const base = toValidName(name) || "agent";
  const used = new Set(taken.map((agent) => agent.slug));
  if (!used.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base.slice(0, 44)}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, 40)}-${unguessableSuffix(6)}`;
}

export interface CreateAgentInput {
  did: string;
  name: string;
  description?: string;
  purpose?: string;
  capabilities?: readonly string[];
  memoryScope?: MemoryScope;
}

/**
 * Register an agent whose key is already in the vault. Creating the key and
 * registering the agent are deliberately separate: the key is the thing that
 * matters, and it exists before any of this metadata does.
 */
export function createAgent(input: CreateAgentInput): AgentRecord {
  const existing = load();
  if (existing.some((agent) => agent.did === input.did)) {
    throw new Error("An agent with this DID is already registered on this device.");
  }

  const scope: MemoryScope = input.memoryScope ?? "public";
  const record: AgentRecord = {
    id: newId("agent"),
    did: input.did,
    name: input.name.trim() || "Untitled agent",
    slug: uniqueSlug(input.name, existing),
    description: input.description?.trim() ?? "",
    purpose: input.purpose?.trim() ?? "",
    capabilities: input.capabilities ?? [],
    createdAt: new Date().toISOString(),
    memoryScope: scope,
    memoryNamespace: scope === "public" ? publicNamespaceFor(input.did) : privateNamespace(),
    mailboxRoom: newMailboxRoom(),
    homeRoom: null,
    profilePublishedAt: null,
  };

  save([...existing, record]);
  setActiveAgent(record.did);
  return record;
}

type MutableFields = Pick<
  AgentRecord,
  "name" | "description" | "purpose" | "capabilities" | "homeRoom" | "profilePublishedAt"
>;

export function updateAgent(did: string, patch: Partial<MutableFields>): AgentRecord {
  const agents = load();
  const index = agents.findIndex((agent) => agent.did === did);
  if (index === -1) throw new Error(`Unknown agent ${did}.`);

  const next: AgentRecord = { ...agents[index], ...patch };
  save(agents.map((agent, position) => (position === index ? next : agent)));
  return next;
}

/**
 * Forget an agent locally. Nothing on Technocore is removed: its notes and its
 * messages stay until the 7-day idle reaper takes them, and its DID note stays
 * published. The UI has to say so — this is not a delete.
 */
export function forgetAgent(did: string): void {
  save(load().filter((agent) => agent.did !== did));
  if (getActiveAgentDid() === did) {
    const remaining = load();
    if (remaining.length > 0) setActiveAgent(remaining[0].did);
    else writeJson(ACTIVE_KEY, null);
  }
}

/* -------------------------------------------------------------------------- */
/* Active agent                                                                */
/* -------------------------------------------------------------------------- */

export function getActiveAgentDid(): string | null {
  const did = readJson<string | null>(ACTIVE_KEY, null);
  return did && load().some((agent) => agent.did === did) ? did : (load()[0]?.did ?? null);
}

export function getActiveAgent(): AgentRecord | null {
  const did = getActiveAgentDid();
  return did ? getAgent(did) : null;
}

export function setActiveAgent(did: string): void {
  writeJson(ACTIVE_KEY, did);
  emit();
}

/** For `useSyncExternalStore`: changes identity only when the list is rewritten. */
export function agentsSnapshot(): readonly AgentRecord[] {
  return load();
}
