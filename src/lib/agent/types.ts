/**
 * Agent domain types.
 *
 * An "agent" in Folester is a local record plus a key in the vault. Everything
 * that gives it presence on the network — a mailbox, a profile note, memory — is
 * a Technocore address derived here and written by the layers below.
 */

/** The capability vocabulary discovery filters on. Values are legal Technocore names. */
export const CAPABILITIES = [
  { id: "research", label: "Research" },
  { id: "coding", label: "Coding" },
  { id: "verification", label: "Verification" },
  { id: "data-analysis", label: "Data Analysis" },
  { id: "execution", label: "Execution" },
  { id: "coordination", label: "Coordination" },
] as const;

export type CapabilityId = (typeof CAPABILITIES)[number]["id"];

/**
 * Where an agent's memory notes live.
 *
 * `public` — a `fol-<fingerprint>` namespace. Enumerable, so memory is
 *            recoverable from Technocore alone on a new device. World-readable
 *            *and world-writable*, like every note outside `room-owners` and
 *            `room-allow`.
 * `private` — a `p-<unguessable>` namespace. Never enumerated, so the key list
 *            exists only on this device; lose it and the notes are unreachable.
 */
export type MemoryScope = "public" | "private";

export interface AgentRecord {
  readonly id: string;
  /** The agent's verifiable identity. The private half lives in the vault. */
  readonly did: string;
  readonly name: string;
  /** A legal Technocore name derived from `name`, used for unsigned nicks. */
  readonly slug: string;
  readonly description: string;
  /** Free text: what this agent is for. Not executed by Folester — see tasks. */
  readonly purpose: string;
  readonly capabilities: readonly string[];
  readonly createdAt: string;

  readonly memoryScope: MemoryScope;
  readonly memoryNamespace: string;
  /** `mb-p-<unguessable>`: signed writes only, and never enumerated. */
  readonly mailboxRoom: string;
  /** An owned `d-` room, once claimed. */
  readonly homeRoom: string | null;
  readonly profilePublishedAt: string | null;
}

export type ActivityKind =
  | "identity.generated"
  | "identity.imported"
  | "identity.unlocked"
  | "identity.locked"
  | "technocore.connected"
  | "technocore.failed"
  | "profile.published"
  | "message.signed"
  | "message.sent"
  | "message.received"
  | "memory.created"
  | "memory.updated"
  | "memory.cleared"
  | "memory.synced"
  | "room.joined"
  | "room.claimed"
  | "task.created"
  | "task.dispatched"
  | "task.received"
  | "task.completed"
  | "task.failed"
  | "discovery.scanned";

export interface ActivityEvent {
  readonly id: string;
  readonly agentDid: string;
  readonly kind: ActivityKind;
  readonly at: string;
  readonly summary: string;
  readonly status: "ok" | "error";
  /** The service's own words when a call failed, or the path that was called. */
  readonly detail?: string;
  readonly path?: string;
}

export type SyncState = "synced" | "local" | "failed" | "pending";

export interface MemoryEntry {
  readonly key: string;
  readonly value: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly agentDid: string;
  readonly namespace: string;
  readonly sync: SyncState;
  readonly syncedAt: string | null;
  readonly error: string | null;
  /** Byte length the service reported on the last accepted write. */
  readonly bytes: number | null;
}

/**
 * How much is actually known about who wrote a message.
 *
 * `verified-locally` — Folester holds the signature (because it produced it) and
 *      re-checked it offline against the DID. The only tier that is proof to us.
 * `service-verified` — `from` is a full did:key and the record carries a nonce,
 *      which the service only emits after checking an Ed25519 signature at write
 *      time. The read API does not return the signature, so Folester cannot
 *      re-verify it and does not claim to: this is Technocore's word, not ours.
 * `self-asserted` — an unsigned nick. Checked by nobody, trivially forgeable.
 */
export type Attribution = "verified-locally" | "service-verified" | "self-asserted";

/** A message as Folester holds it: the record plus what is known about its author. */
export interface ConversationMessage {
  readonly seq: number;
  readonly ts: string;
  readonly from: string;
  readonly text: string;
  readonly nonce?: number;
  readonly attribution: Attribution;
  readonly direction: "in" | "out";
  /** Present only for messages this device signed, so the UI can show the proof. */
  readonly signature?: { readonly sig: string; readonly payload: string };
}

export interface Conversation {
  readonly id: string;
  /** The Technocore room this conversation is carried in. */
  readonly room: string;
  readonly kind: "mailbox" | "room";
  /** Counterparty DID for a mailbox conversation; null for an open room. */
  readonly peerDid: string | null;
  readonly peerLabel: string;
  readonly lastSeq: number;
  readonly updatedAt: string;
}

export type TaskStatus =
  | "draft"
  | "dispatched"
  | "received"
  | "accepted"
  | "completed"
  | "failed"
  | "declined";

export interface AgentTask {
  readonly id: string;
  /** `out` — we asked someone. `in` — someone asked us. */
  readonly direction: "out" | "in";
  readonly requesterDid: string;
  readonly workerDid: string;
  readonly capability: string;
  readonly instruction: string;
  readonly status: TaskStatus;
  readonly createdAt: string;
  readonly dispatchedAt: string | null;
  readonly settledAt: string | null;
  readonly result: string | null;
  readonly error: string | null;
  /** The mailbox the request was carried in. */
  readonly room: string | null;
  /**
   * Whether the result line verified against the worker's DID. Null while the
   * task has no result yet.
   */
  readonly resultVerified: boolean | null;
}

/** A discovered peer, assembled from its published DID note. */
export interface DiscoveredAgent {
  /** `/kv/did/<fingerprint>` — the note key it was found under. */
  readonly fingerprint: string;
  readonly did: string;
  readonly mailbox: string | null;
  readonly x25519: string | null;
  /** A Folester namespace, when the note advertises one. */
  readonly folesterNamespace: string | null;
  /**
   * True when `fingerprint` equals the first 16 hex of SHA-256 of `did` — the note
   * is internally consistent. It is NOT proof of anything: the `did` namespace is
   * world-writable, so anyone can publish a well-formed note for a key they do
   * not hold. Only a verified signature proves possession.
   */
  readonly selfConsistent: boolean;
  /** Set once Folester has verified a signed message from this DID itself. */
  readonly signatureSeenAt: string | null;
  readonly profile: AgentProfile | null;
  readonly noteRaw: string;
}

/**
 * The richer profile Folester publishes alongside the standard DID note, at
 * `/kv/<memory namespace>/profile`. A convention of this app, not of the
 * protocol — so a peer that does not know Folester still gets a usable DID note.
 */
export interface AgentProfile {
  readonly v: 1;
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly mailbox: string | null;
  readonly publishedAt: string;
}
