/**
 * Agent memory: persistent notes, plus a local index of them.
 *
 * Memory is written to Technocore notes so it survives the browser and is visible
 * to other agents. Three properties of that store are load-bearing and are carried
 * into the UI rather than smoothed over:
 *
 *   1. Notes are world-writable. Outside `room-owners` and `room-allow` the
 *      service accepts any write to any key, so memory is public and tamperable.
 *      Folester says so on the page; it does not imply private storage.
 *   2. A note with no write for 7 days is deleted. There is no durable tier.
 *   3. A `p-` namespace is never enumerated. Memory kept there is reachable only
 *      through this device's key index, so losing the browser loses the list.
 *
 * Every entry therefore has a sync state. A write that the service rejected stays
 * in the index marked `failed` with the service's own words, because silently
 * dropping it would be a lie about what the agent remembers.
 */

import { describeError, TechnocoreConflictError } from "@/lib/technocore/errors";
import { clearNote, listNamespace, NOTE_CHAR_LIMIT, NOTE_TOMBSTONE, readNote, writeNote } from "@/lib/technocore/kv";
import { isValidName, toValidName } from "@/lib/identity/sweep";
import { onStoreChange, readJson, writeJson } from "@/lib/storage";

import { recordActivity } from "./activity";
import { PROFILE_KEY } from "./profile";
import type { AgentRecord, MemoryEntry } from "./types";

const MEMORY_KEY = "folester.memory.v1";

/** Keys Folester uses for its own bookkeeping, hidden from the memory list. */
export const RESERVED_MEMORY_KEYS: readonly string[] = [PROFILE_KEY];

/** A sync reads one note per key; capped so a restore cannot burn the read budget. */
export const SYNC_KEY_LIMIT = 60;

export const MEMORY_VALUE_LIMIT = NOTE_CHAR_LIMIT;

type MemoryIndex = Record<string, MemoryEntry[]>;

type Listener = () => void;
const listeners = new Set<Listener>();

let cache: MemoryIndex | null = null;

function load(): MemoryIndex {
  cache ??= readJson<MemoryIndex>(MEMORY_KEY, {});
  return cache;
}

function save(index: MemoryIndex): void {
  cache = index;
  writeJson(MEMORY_KEY, index);
  for (const listener of listeners) listener();
}

function put(agentDid: string, entry: MemoryEntry): void {
  const index = load();
  const entries = index[agentDid] ?? [];
  const position = entries.findIndex((candidate) => candidate.key === entry.key);
  const next = position === -1 ? [...entries, entry] : entries.map((c, i) => (i === position ? entry : c));
  save({ ...index, [agentDid]: next });
}

export function listMemory(agentDid: string): readonly MemoryEntry[] {
  return (load()[agentDid] ?? [])
    .filter((entry) => !RESERVED_MEMORY_KEYS.includes(entry.key))
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getMemory(agentDid: string, key: string): MemoryEntry | null {
  return (load()[agentDid] ?? []).find((entry) => entry.key === key) ?? null;
}

export function subscribeMemory(listener: Listener): () => void {
  listeners.add(listener);
  const unsubscribe = onStoreChange((key) => {
    if (key === MEMORY_KEY) {
      cache = null;
      listener();
    }
  });
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

export function memorySnapshot(): MemoryIndex {
  return load();
}

/**
 * Turn a human label into a legal note key. Returns `null` for a label with nothing
 * usable in it — an all-punctuation or all-emoji label has no valid form, and
 * silently inventing one would put memory under a key the user did not choose.
 */
export function memoryKeyFrom(label: string): { key: string | null; adjusted: boolean } {
  const key = toValidName(label);
  return { key, adjusted: key !== null && key !== label.trim().toLowerCase() };
}

export interface WriteMemoryResult {
  readonly entry: MemoryEntry;
  readonly ok: boolean;
  readonly error: string | null;
  /** Set when the service refused because the note changed under us. */
  readonly conflictValue: string | null;
}

/**
 * Write a memory entry.
 *
 * `expectedValue` opts into the service's compare-and-set: pass the value the
 * entry held when it was read, and a concurrent write by anyone else surfaces as a
 * conflict carrying the value that won, instead of being silently overwritten.
 */
export async function writeMemory(
  agent: AgentRecord,
  key: string,
  value: string,
  options: { expectedValue?: string } = {},
): Promise<WriteMemoryResult> {
  if (!isValidName(key)) {
    throw new Error(
      `'${key}' is not a valid note key: lowercase letters, digits, - and _, 1-48 characters, ` +
        `starting with a letter or digit.`,
    );
  }

  const existing = getMemory(agent.did, key);
  const now = new Date().toISOString();
  const path = `/kv/${agent.memoryNamespace}/${key}`;

  const base: MemoryEntry = {
    key,
    value,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    agentDid: agent.did,
    namespace: agent.memoryNamespace,
    sync: "pending",
    syncedAt: existing?.syncedAt ?? null,
    error: null,
    bytes: existing?.bytes ?? null,
  };
  put(agent.did, base);

  try {
    const receipt = await writeNote(agent.memoryNamespace, key, value, {
      ifMatches: options.expectedValue,
    });
    const entry: MemoryEntry = {
      ...base,
      // The stored value is the swept one; keep what the service actually holds.
      value: receipt.value,
      sync: "synced",
      syncedAt: receipt.at ?? new Date().toISOString(),
      bytes: receipt.bytes,
      error: null,
    };
    put(agent.did, entry);
    recordActivity({
      agentDid: agent.did,
      kind: existing ? "memory.updated" : "memory.created",
      summary: `${existing ? "Updated" : "Stored"} memory ${key}`,
      path,
    });
    return { entry, ok: true, error: null, conflictValue: null };
  } catch (error) {
    const message = describeError(error);
    const entry: MemoryEntry = { ...base, sync: "failed", error: message };
    put(agent.did, entry);
    recordActivity({
      agentDid: agent.did,
      kind: existing ? "memory.updated" : "memory.created",
      summary: `Failed to store memory ${key}`,
      status: "error",
      detail: message,
      path,
    });
    return {
      entry,
      ok: false,
      error: message,
      conflictValue: error instanceof TechnocoreConflictError ? error.currentValue : null,
    };
  }
}

/**
 * Clear a memory entry. The service has no DELETE, so the note is overwritten with
 * a tombstone and remains until the idle reaper takes it. Folester drops its index
 * entry, which is why the UI says "cleared" rather than "deleted".
 */
export async function clearMemory(
  agent: AgentRecord,
  key: string,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    await clearNote(agent.memoryNamespace, key);
    const index = load();
    save({ ...index, [agent.did]: (index[agent.did] ?? []).filter((entry) => entry.key !== key) });
    recordActivity({
      agentDid: agent.did,
      kind: "memory.cleared",
      summary: `Cleared memory ${key}`,
      path: `/kv/${agent.memoryNamespace}/${key}`,
    });
    return { ok: true, error: null };
  } catch (error) {
    const message = describeError(error);
    recordActivity({
      agentDid: agent.did,
      kind: "memory.cleared",
      summary: `Failed to clear memory ${key}`,
      status: "error",
      detail: message,
      path: `/kv/${agent.memoryNamespace}/${key}`,
    });
    return { ok: false, error: message };
  }
}

export interface SyncReport {
  readonly ok: boolean;
  readonly error: string | null;
  /** Keys the service holds. Empty for a `p-` namespace — it does not enumerate. */
  readonly remoteKeys: readonly string[];
  readonly enumerable: boolean;
  readonly read: number;
  readonly restored: number;
  readonly updated: number;
  readonly cleared: number;
  /** Keys skipped because the read cap was hit, so the UI can say what it missed. */
  readonly skipped: readonly string[];
}

/**
 * Reconcile local memory with the service.
 *
 * For a public namespace the key list comes from `/kv/<ns>`, so memory an agent
 * wrote on another device is genuinely restored here. For a `p-` namespace the
 * listing is empty by design and only locally known keys are re-read — the report
 * says which of the two happened.
 */
export async function syncMemory(agent: AgentRecord): Promise<SyncReport> {
  const local = load()[agent.did] ?? [];
  const enumerable = agent.memoryScope === "public";
  let remoteKeys: readonly string[] = [];

  if (enumerable) {
    try {
      const listing = await listNamespace(agent.memoryNamespace);
      remoteKeys = listing.keys ?? [];
    } catch (error) {
      const message = describeError(error);
      recordActivity({
        agentDid: agent.did,
        kind: "memory.synced",
        summary: "Memory sync failed",
        status: "error",
        detail: message,
        path: `/kv/${agent.memoryNamespace}`,
      });
      return {
        ok: false,
        error: message,
        remoteKeys: [],
        enumerable,
        read: 0,
        restored: 0,
        updated: 0,
        cleared: 0,
        skipped: [],
      };
    }
  }

  const candidates = [...new Set([...remoteKeys, ...local.map((entry) => entry.key)])].filter(
    (key) => !RESERVED_MEMORY_KEYS.includes(key),
  );
  const targets = candidates.slice(0, SYNC_KEY_LIMIT);
  const skipped = candidates.slice(SYNC_KEY_LIMIT);

  let read = 0;
  let restored = 0;
  let updated = 0;
  let cleared = 0;
  let firstError: string | null = null;

  for (const key of targets) {
    try {
      const note = await readNote(agent.memoryNamespace, key);
      read += 1;
      const existing = local.find((entry) => entry.key === key);
      const now = new Date().toISOString();

      if (note === null || note.value === NOTE_TOMBSTONE) {
        if (existing) {
          const index = load();
          save({
            ...index,
            [agent.did]: (index[agent.did] ?? []).filter((entry) => entry.key !== key),
          });
          cleared += 1;
        }
        continue;
      }

      if (!existing) restored += 1;
      else if (existing.value !== note.value) updated += 1;
      else continue;

      put(agent.did, {
        key,
        value: note.value,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        agentDid: agent.did,
        namespace: agent.memoryNamespace,
        sync: "synced",
        syncedAt: now,
        error: null,
        bytes: existing?.bytes ?? null,
      });
    } catch (error) {
      firstError ??= describeError(error);
    }
  }

  recordActivity({
    agentDid: agent.did,
    kind: "memory.synced",
    summary: enumerable
      ? `Synced memory: ${read} note${read === 1 ? "" : "s"} read, ${restored} restored`
      : `Re-read ${read} locally known note${read === 1 ? "" : "s"} (private namespace does not list keys)`,
    status: firstError ? "error" : "ok",
    detail: firstError ?? undefined,
    path: `/kv/${agent.memoryNamespace}`,
  });

  return {
    ok: firstError === null,
    error: firstError,
    remoteKeys,
    enumerable,
    read,
    restored,
    updated,
    cleared,
    skipped,
  };
}
