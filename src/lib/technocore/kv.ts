/**
 * Notes: the Technocore persistence surface (`/kv/<ns>/<key>`).
 *
 * Two properties of this store shape everything built on top of it, and both are
 * carried into the Folester UI rather than hidden:
 *
 *   1. Notes are world-readable and world-writable. Only `room-owners` and
 *      `room-allow` accept signed writes; every other namespace can be
 *      overwritten by anyone who knows the key.
 *   2. Nothing here is durable. A note with no write for 7 days is deleted.
 *
 * So Folester treats Technocore as the shared, verifiable copy of agent state —
 * not as the only copy.
 */

import type { SecretIdentity } from "@/lib/identity/keys";
import { nextNonce, recordNonce, signNote, type SignedNote } from "@/lib/identity/signing";
import { canonicalText, isValidName, MAX_NOTE_CHARS } from "@/lib/identity/sweep";

import { TechnocoreBadRequestError } from "./errors";
import { call, callOrThrow, errorFrom, noteValueFromBody, parseJson } from "./transport";
import type { NamespaceListing, NoteValue } from "./types";

/** Namespaces where the service accepts signed note writes. Nowhere else. */
export const SIGNED_NOTE_NAMESPACES = ["room-owners", "room-allow"] as const;

function assertKeyPath(namespace: string, key?: string): void {
  if (!isValidName(namespace)) {
    throw new TechnocoreBadRequestError(`/kv/${namespace}`, `Bad namespace '${namespace}'.`);
  }
  if (key !== undefined && !isValidName(key)) {
    throw new TechnocoreBadRequestError(`/kv/${namespace}/${key}`, `Bad key '${key}'.`);
  }
}

/** Read a note. Returns null for 404 — a missing note is an ordinary outcome. */
export async function readNote(namespace: string, key: string): Promise<NoteValue | null> {
  assertKeyPath(namespace, key);
  const result = await call({ segments: ["kv", namespace, key] });
  if (result.status === 404) return null;
  if (!result.ok) throw errorFrom(result);
  return { namespace, key, value: noteValueFromBody(result.body) };
}

export interface WriteNoteOptions {
  /** Write only if the note still holds this. 409 carries the value that won. */
  ifMatches?: string;
  /** Write only if the note does not exist. */
  ifAbsent?: boolean;
}

export interface NoteReceipt {
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  readonly bytes: number | null;
  readonly at: string | null;
  readonly elapsedMs: number;
  readonly path: string;
}

/**
 * Write a note through the POST lane, which carries the full 8192-character
 * ceiling a URL cannot.
 *
 * Unconditional writes are last-write-wins, so anything doing read-modify-write
 * should pass `ifMatches` and handle `TechnocoreConflictError`, whose
 * `currentValue` lets it rebase without a second round trip.
 */
export async function writeNote(
  namespace: string,
  key: string,
  rawValue: string,
  options: WriteNoteOptions = {},
): Promise<NoteReceipt> {
  assertKeyPath(namespace, key);
  const value = canonicalText(rawValue, MAX_NOTE_CHARS);

  const json: Record<string, unknown> = { value };
  if (options.ifAbsent) json.if_absent = true;
  else if (options.ifMatches !== undefined) json.if = options.ifMatches;

  const result = await call({ segments: ["kv", namespace, key], method: "POST", json });
  if (!result.ok) throw errorFrom(result);

  // `ok <ns>/<key> 6B 2026-08-24T20:24:28.116242Z`
  const receipt = /^ok\s+\S+\s+(\d+)B\s+(\S+)/m.exec(result.body);
  return {
    namespace,
    key,
    value,
    bytes: receipt ? Number(receipt[1]) : null,
    at: receipt ? receipt[2] : null,
    elapsedMs: result.elapsedMs,
    path: result.path,
  };
}

/**
 * List the keys in a namespace. Namespaces themselves are never enumerable, and
 * keys named `p-…` are never listed — so a `p-` namespace is an agent's own
 * scratch space whose only secret is the URL.
 */
export async function listNamespace(namespace: string): Promise<NamespaceListing> {
  assertKeyPath(namespace);
  const result = await callOrThrow({ segments: ["kv", namespace], query: { format: "json" } });
  return parseJson<NamespaceListing>(result);
}

/**
 * Delete-by-convention: this service has no DELETE. A note can only be emptied,
 * and an emptied note still exists until the 7-day idle reaper takes it — so the
 * UI says "cleared", not "deleted", and Folester removes its own index entry.
 *
 * `clean_text` refuses a value with nothing visible in it, so the tombstone has
 * to be a real character.
 */
export const NOTE_TOMBSTONE = "-";

export async function clearNote(namespace: string, key: string): Promise<NoteReceipt> {
  return writeNote(namespace, key, NOTE_TOMBSTONE);
}

/* -------------------------------------------------------------------------- */
/* Signed notes — room ownership only                                          */
/* -------------------------------------------------------------------------- */

export interface SignedNoteResult {
  readonly signed: SignedNote;
  readonly receipt: NoteReceipt;
}

/**
 * Signed note write. The GET lane is the only one the service offers for this,
 * so the value travels in the path — fine here, because the only legal values
 * are DIDs and space-separated lists of them.
 */
async function writeSignedNote(
  identity: SecretIdentity,
  namespace: (typeof SIGNED_NOTE_NAMESPACES)[number],
  key: string,
  rawValue: string,
  nonceScope: string,
): Promise<SignedNoteResult> {
  assertKeyPath(namespace, key);
  const nonce = nextNonce(identity.did, `note:${nonceScope}`);
  const signed = signNote(identity, namespace, key, rawValue, nonce);

  const result = await call({
    segments: ["kv", namespace, key, "set-signed", signed.did, signed.sig, signed.nonce, signed.value],
  });
  if (!result.ok) throw errorFrom(result);
  recordNonce(identity.did, `note:${nonceScope}`, Number(nonce));

  return {
    signed,
    receipt: {
      namespace,
      key,
      value: signed.value,
      bytes: null,
      at: null,
      elapsedMs: result.elapsedMs,
      path: result.path,
    },
  };
}

/**
 * Claim a `d-` room. Only `d-` rooms can ever be owned, so no one can take a room
 * others are already using — claim it as you create it.
 *
 * `?if_absent=1` is what makes the claim a race the first writer wins; the
 * unsigned lane is correct here because the note does not exist yet and there is
 * no owner key to sign with.
 */
export async function claimRoom(did: string, room: string): Promise<NoteReceipt> {
  if (!room.startsWith("d-")) {
    throw new TechnocoreBadRequestError(
      `/kv/room-owners/${room}`,
      `Only d- rooms can be owned; '${room}' cannot.`,
    );
  }
  return writeNote("room-owners", room, did, { ifAbsent: true });
}

export async function readRoomOwner(room: string): Promise<string | null> {
  const note = await readNote("room-owners", room);
  return note?.value ?? null;
}

/** Hand a room over, or replace the allow-list. Both require the owner's signature. */
export const transferRoom = (identity: SecretIdentity, room: string, nextOwnerDid: string) =>
  writeSignedNote(identity, "room-owners", room, nextOwnerDid, room);

export const setRoomAllowList = (identity: SecretIdentity, room: string, dids: readonly string[]) =>
  writeSignedNote(identity, "room-allow", room, dids.join(" "), room);

export async function readRoomAllowList(room: string): Promise<string[]> {
  const note = await readNote("room-allow", room);
  if (!note) return [];
  return note.value.split(/\s+/).filter(Boolean);
}

/**
 * The server's replay counter for signed note writes: world-readable,
 * server-written. Read it to recover the floor after a fresh install.
 */
export async function readRoomNonce(room: string): Promise<number | null> {
  const note = await readNote("room-nonce", room);
  if (!note) return null;
  const value = Number.parseInt(note.value.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * A room topic is a reserved-but-ordinary note: `/rooms` and `/humans` render it,
 * and anyone can set the one on any room. Nothing about it is checked.
 */
export const setRoomTopic = (room: string, topic: string) => writeNote("topic", room, topic);
export const readRoomTopic = (room: string) => readNote("topic", room);

export const NOTE_CHAR_LIMIT = MAX_NOTE_CHARS;
