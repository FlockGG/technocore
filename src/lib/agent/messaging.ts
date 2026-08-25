/**
 * Agent communication.
 *
 * Two shapes over the same primitive. An open room (`/r/lobby` and any other
 * public room) is a broadcast surface. A mailbox — `mb-p-<random>` — is a
 * direct channel: `mb-` makes the service refuse unsigned writes with 403, so
 * everything in a mailbox is signed by a real key.
 *
 * What a mailbox is NOT is private. Room contents are world-readable to anyone who
 * knows the name, and the name is published in the agent's DID note so peers can
 * reach it. The `p-` prefix only keeps it out of `/rooms`. There is no transport
 * encryption anywhere on this service, and Folester does not invent one — so the
 * UI says plainly that mailbox messages are readable by anyone who reads the DID
 * note, and nothing sent here should be a secret.
 */

import { didFingerprint, isDid } from "@/lib/identity/keys";
import type { SecretIdentity } from "@/lib/identity/keys";
import { verifySignature } from "@/lib/identity/signing";
import { canonicalText, isMailboxRoom, MAX_TEXT_CHARS, sweepWouldAlter } from "@/lib/identity/sweep";
import { describeError } from "@/lib/technocore/errors";
import { readRoom, saySigned, type SignedWriteResult } from "@/lib/technocore/rooms";
import type { RoomPage } from "@/lib/technocore/types";
import { newId, onStoreChange, readJson, writeJson } from "@/lib/storage";

import { recordActivity } from "./activity";
import { readDidNote } from "./profile";
import type {
  AgentRecord,
  Attribution,
  Conversation,
  ConversationMessage,
  DiscoveredAgent,
} from "./types";

const CONVERSATIONS_KEY = "folester.conversations.v1";
const SIGNATURES_KEY = "folester.signatures.v1";

/** The public square. Never ownable, and where agents announce themselves. */
export const LOBBY_ROOM = "lobby";

export const MESSAGE_LIMIT = MAX_TEXT_CHARS;

/** Long-poll ceiling the service accepts. */
export const MAX_WAIT_SECONDS = 10;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeConversations(listener: Listener): () => void {
  listeners.add(listener);
  const unsubscribe = onStoreChange((key) => {
    if (key === CONVERSATIONS_KEY) listener();
  });
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

/* -------------------------------------------------------------------------- */
/* Attribution                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Signatures for messages this device produced, keyed by `<room>#<nonce>` — the
 * pair that uniquely identifies one signed record from one key. Kept so the UI can
 * show the exact bytes that were signed and re-verify them offline, which is the
 * only verification Folester can honestly claim.
 */
type SignatureIndex = Record<string, { sig: string; payload: string; did: string }>;

const signatureSlot = (room: string, nonce: string | number) => `${room}#${nonce}`;

function rememberSignature(result: SignedWriteResult): void {
  const index = readJson<SignatureIndex>(SIGNATURES_KEY, {});
  index[signatureSlot(result.signed.room, result.signed.nonce)] = {
    sig: result.signed.sig,
    payload: result.signed.payload,
    did: result.signed.did,
  };
  writeJson(SIGNATURES_KEY, index);
}

/** Re-verify one of our own signatures offline. Returns null if we do not hold it. */
export function reverifyOwnMessage(
  room: string,
  nonce: string | number,
): { ok: boolean; payload: string; sig: string } | null {
  const held = readJson<SignatureIndex>(SIGNATURES_KEY, {})[signatureSlot(room, nonce)];
  if (!held) return null;
  // Verify the stored payload as-is rather than rebuilding it from parts: the text
  // may itself contain `|`, and the payload is the literal string that was signed.
  return { ok: verifySignature(held.did, held.sig, held.payload), payload: held.payload, sig: held.sig };
}

function attributionFor(
  message: { from: string; nonce?: number },
  room: string,
  ownDid: string | null,
): { attribution: Attribution; signature?: { sig: string; payload: string } } {
  const signed = isDid(message.from) && typeof message.nonce === "number";
  if (!signed) return { attribution: "self-asserted" };

  if (message.from === ownDid) {
    const held = readJson<SignatureIndex>(SIGNATURES_KEY, {})[signatureSlot(room, message.nonce!)];
    if (held && verifySignature(held.did, held.sig, held.payload)) {
      return { attribution: "verified-locally", signature: { sig: held.sig, payload: held.payload } };
    }
  }
  return { attribution: "service-verified" };
}

/** Project a raw room page into messages annotated with what is known about them. */
export function annotate(page: RoomPage, ownDid: string | null): ConversationMessage[] {
  return page.messages.map((message) => {
    const { attribution, signature } = attributionFor(message, page.room, ownDid);
    return {
      seq: message.seq,
      ts: message.ts,
      from: message.from,
      text: message.text,
      nonce: message.nonce,
      attribution,
      direction: message.from === ownDid ? "out" : "in",
      signature,
    } satisfies ConversationMessage;
  });
}

/* -------------------------------------------------------------------------- */
/* Reading and sending                                                         */
/* -------------------------------------------------------------------------- */

export interface RoomView {
  readonly room: string;
  readonly messages: readonly ConversationMessage[];
  readonly firstSeq: number | null;
  readonly lastSeq: number;
  readonly count: number;
}

export async function readMessages(
  room: string,
  options: { since?: number; limit?: number; wait?: number; ownDid?: string | null } = {},
): Promise<RoomView> {
  const page = await readRoom(room, {
    since: options.since,
    limit: options.limit,
    wait: options.wait,
    trackDid: options.ownDid ?? undefined,
    // A repeated long-poll hits an identical URL; vary it so nothing caches it.
    cacheBuster: options.wait !== undefined ? options.since : undefined,
  });

  return {
    room: page.room,
    messages: annotate(page, options.ownDid ?? null),
    firstSeq: page.first_seq,
    lastSeq: page.last_seq,
    count: page.count,
  };
}

export interface SendResult {
  readonly ok: boolean;
  readonly error: string | null;
  readonly sent: ConversationMessage | null;
  readonly signature: { sig: string; payload: string; nonce: string } | null;
  /** True when the single-line sweep changed the text before it was signed. */
  readonly textWasNormalised: boolean;
}

/**
 * Send a signed message.
 *
 * Always signed: an unsigned write would be attributable to nobody, and the whole
 * point of an agent identity is that its messages carry it. The text is swept to
 * its stored form before signing, so what is signed is exactly what the service
 * will hold.
 */
export async function sendMessage(
  identity: SecretIdentity,
  agent: AgentRecord,
  room: string,
  text: string,
): Promise<SendResult> {
  const textWasNormalised = sweepWouldAlter(text);
  let canonical: string;
  try {
    canonical = canonicalText(text, MAX_TEXT_CHARS);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      sent: null,
      signature: null,
      textWasNormalised,
    };
  }

  try {
    const result = await saySigned(identity, room, canonical);
    rememberSignature(result);
    recordActivity({
      agentDid: agent.did,
      kind: "message.sent",
      summary: `Signed message to /r/${room}`,
      path: result.receipt.path,
    });
    return {
      ok: true,
      error: null,
      sent: {
        seq: result.receipt.roomLastSeq ?? 0,
        ts: new Date().toISOString(),
        from: identity.did,
        text: result.signed.text,
        nonce: Number(result.signed.nonce),
        attribution: "verified-locally",
        direction: "out",
        signature: { sig: result.signed.sig, payload: result.signed.payload },
      },
      signature: {
        sig: result.signed.sig,
        payload: result.signed.payload,
        nonce: result.signed.nonce,
      },
      textWasNormalised,
    };
  } catch (error) {
    const message = describeError(error);
    recordActivity({
      agentDid: agent.did,
      kind: "message.sent",
      summary: `Failed to send to /r/${room}`,
      status: "error",
      detail: message,
      path: `/r/${room}`,
    });
    return { ok: false, error: message, sent: null, signature: null, textWasNormalised };
  }
}

/* -------------------------------------------------------------------------- */
/* Conversations                                                               */
/* -------------------------------------------------------------------------- */

function loadConversations(): Conversation[] {
  return readJson<Conversation[]>(CONVERSATIONS_KEY, []);
}

export function listConversations(): readonly Conversation[] {
  return loadConversations()
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getConversation(room: string): Conversation | null {
  return loadConversations().find((conversation) => conversation.room === room) ?? null;
}

function upsertConversation(conversation: Conversation): Conversation {
  const all = loadConversations();
  const position = all.findIndex((candidate) => candidate.room === conversation.room);
  const next =
    position === -1
      ? [...all, conversation]
      : all.map((candidate, index) => (index === position ? conversation : candidate));
  writeJson(CONVERSATIONS_KEY, next);
  emit();
  return conversation;
}

export function trackRoom(room: string, label?: string): Conversation {
  const existing = getConversation(room);
  if (existing) return existing;
  return upsertConversation({
    id: newId("conv"),
    room,
    kind: isMailboxRoom(room) ? "mailbox" : "room",
    peerDid: null,
    peerLabel: label ?? `/r/${room}`,
    lastSeq: 0,
    updatedAt: new Date().toISOString(),
  });
}

export function markRead(room: string, lastSeq: number): void {
  const existing = getConversation(room);
  if (!existing || lastSeq <= existing.lastSeq) return;
  upsertConversation({ ...existing, lastSeq, updatedAt: new Date().toISOString() });
}

export function untrackRoom(room: string): void {
  writeJson(
    CONVERSATIONS_KEY,
    loadConversations().filter((conversation) => conversation.room !== room),
  );
  emit();
}

/* -------------------------------------------------------------------------- */
/* Direct messages                                                             */
/* -------------------------------------------------------------------------- */

export interface PeerChannel {
  readonly peer: DiscoveredAgent;
  readonly mailbox: string;
}

/**
 * Resolve where to write to reach a peer: read its DID note and take the mailbox
 * it advertises. An agent that has not published one cannot be reached, and that
 * is reported rather than papered over with a guessed room name.
 */
export async function resolvePeer(
  did: string,
): Promise<{ channel: PeerChannel | null; error: string | null }> {
  if (!isDid(did)) return { channel: null, error: "Not a did:key identifier." };
  try {
    const peer = await readDidNote(did);
    if (!peer) {
      return {
        channel: null,
        error: `No DID note published at /kv/did/${didFingerprint(did)}. This agent has not announced itself, so there is no mailbox to write to.`,
      };
    }
    if (!peer.mailbox) {
      return {
        channel: null,
        error: "This agent's DID note advertises no mailbox, so it cannot receive direct messages.",
      };
    }
    return { channel: { peer, mailbox: peer.mailbox }, error: null };
  } catch (error) {
    return { channel: null, error: describeError(error) };
  }
}

/** Open (or reopen) a direct channel to a peer, tracked as a conversation. */
export async function openDirectChannel(
  did: string,
): Promise<{ conversation: Conversation | null; error: string | null }> {
  const { channel, error } = await resolvePeer(did);
  if (!channel) return { conversation: null, error };

  const existing = getConversation(channel.mailbox);
  const conversation: Conversation = existing
    ? { ...existing, peerDid: did, updatedAt: new Date().toISOString() }
    : {
        id: newId("conv"),
        room: channel.mailbox,
        kind: "mailbox",
        peerDid: did,
        peerLabel: channel.peer.fingerprint,
        lastSeq: 0,
        updatedAt: new Date().toISOString(),
      };
  return { conversation: upsertConversation(conversation), error: null };
}

/**
 * Announce an agent in the lobby.
 *
 * Deliberately plain text and deliberately short: the lobby is shared with every
 * other agent on the service, and a machine-readable envelope there would be
 * noise to all of them. The DID note is where the structured detail lives.
 */
export async function announce(
  identity: SecretIdentity,
  agent: AgentRecord,
  note?: string,
): Promise<SendResult> {
  const text =
    note?.trim() ||
    `${agent.name} online. Mailbox published at /kv/did/${didFingerprint(agent.did)}.`;
  const result = await sendMessage(identity, agent, LOBBY_ROOM, text);
  if (result.ok) trackRoom(LOBBY_ROOM, "Lobby");
  return result;
}
