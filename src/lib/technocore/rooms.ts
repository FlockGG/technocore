/**
 * Rooms: the Technocore communication surface.
 *
 * Reads and writes only. Anything about *what* a message means — a task, a
 * memory sync, a direct message — belongs to the agent layers above this one.
 */

import { nextNonce, recordNonce, signMessage, type SignedMessage } from "@/lib/identity/signing";
import type { SecretIdentity } from "@/lib/identity/keys";
import { isValidName, MAX_TEXT_CHARS } from "@/lib/identity/sweep";

import { TechnocoreBadRequestError } from "./errors";
import {
  call,
  callOrThrow,
  errorFrom,
  parseJson,
  roomHeaderFromBody,
} from "./transport";
import type { RoomPage, RoomsListing } from "./types";

export interface ReadRoomOptions {
  /** Return only messages with a greater seq. Required for `wait`. */
  since?: number;
  /** 1..200, default 50. */
  limit?: number;
  /** Long-poll, 0..10 seconds. Needs `since`. */
  wait?: number;
  /**
   * Ignored by the server; varies the URL past a cache. Only needed when
   * re-polling an unchanged URL.
   */
  cacheBuster?: number | string;
  /**
   * When set, signed records from this DID advance the local nonce high-water
   * mark — so a fresh browser recovers the true floor from the room itself
   * rather than guessing and eating a 403.
   */
  trackDid?: string;
}

export interface WriteReceipt {
  readonly room: string;
  /**
   * The newest seq in the room after the write, from the server's own reply
   * header. At least our message; possibly past it if a concurrent write
   * interleaved, so this is the room's cursor and not a receipt for our seq.
   */
  readonly roomLastSeq: number | null;
  readonly raw: string;
  readonly elapsedMs: number;
  readonly path: string;
}

function assertRoom(room: string): void {
  if (!isValidName(room)) {
    throw new TechnocoreBadRequestError(
      `/r/${room}`,
      `Bad room name '${room}': expected /^[a-z0-9][a-z0-9_-]{0,47}$/ — lowercase letters, ` +
        `digits, - and _, 1-48 characters.`,
    );
  }
}

export async function readRoom(room: string, options: ReadRoomOptions = {}): Promise<RoomPage> {
  if (room !== "events") assertRoom(room);
  if (options.wait !== undefined && options.since === undefined) {
    throw new TechnocoreBadRequestError(`/r/${room}`, "`wait` requires `since`.");
  }

  const result = await callOrThrow({
    segments: ["r", room],
    query: {
      format: "json",
      since: options.since,
      limit: options.limit,
      wait: options.wait,
      n: options.cacheBuster,
    },
  });

  const page = parseJson<RoomPage>(result);
  if (options.trackDid) absorbNonces(page, options.trackDid);
  return page;
}

/**
 * Advance the local nonce ledger from records the server already accepted. The
 * server finds the last nonce for a key by scanning the newest 1 MiB of the
 * room, so this mirrors the same source of truth.
 */
export function absorbNonces(page: RoomPage, did: string): void {
  let highest = 0;
  for (const message of page.messages) {
    if (message.from === did && typeof message.nonce === "number" && message.nonce > highest) {
      highest = message.nonce;
    }
  }
  if (highest > 0) recordNonce(did, page.room, highest);
}

/**
 * Append an unsigned message. `nick` is self-asserted — the service marks every
 * one of them `~` and checks nothing. Present because it is half of the
 * protocol, not because Folester recommends it.
 */
export async function sayUnsigned(room: string, nick: string, text: string): Promise<WriteReceipt> {
  assertRoom(room);
  if (!isValidName(nick)) {
    throw new TechnocoreBadRequestError(`/r/${room}`, `Bad nick '${nick}'.`);
  }
  const result = await callOrThrow({
    segments: ["r", room],
    method: "POST",
    json: { from: nick, text },
  });
  return receiptFrom(room, result);
}

export interface SignedWriteResult {
  readonly receipt: WriteReceipt;
  readonly signed: SignedMessage;
}

/**
 * Append a signed message.
 *
 * The nonce is allocated locally against a high-water mark, and the text is
 * swept to its stored form *before* signing — the two things that make the
 * difference between a verified record and a 403.
 */
export async function saySigned(
  identity: SecretIdentity,
  room: string,
  rawText: string,
  options: { nonceFloor?: number } = {},
): Promise<SignedWriteResult> {
  assertRoom(room);
  const nonce = nextNonce(identity.did, room, options.nonceFloor);
  const signed = signMessage(identity, room, rawText, nonce);

  const result = await call({
    segments: ["r", room],
    method: "POST",
    json: { did: signed.did, sig: signed.sig, nonce: signed.nonce, text: signed.text },
  });

  if (!result.ok) throw errorFrom(result);
  recordNonce(identity.did, room, Number(nonce));
  return { receipt: receiptFrom(room, result), signed };
}

function receiptFrom(
  room: string,
  result: { body: string; elapsedMs: number; path: string },
): WriteReceipt {
  return {
    room,
    roomLastSeq: roomHeaderFromBody(result.body)?.lastSeq ?? null,
    raw: result.body,
    elapsedMs: result.elapsedMs,
    path: result.path,
  };
}

/**
 * The public room listing. `room` and `topic` on every entry are caller-chosen
 * strings — the service says so in the `untrusted` object it always returns, and
 * Folester carries that warning into the UI rather than dropping it.
 */
export async function listRooms(limit = 50): Promise<RoomsListing> {
  const result = await callOrThrow({ segments: ["rooms"], query: { format: "json", limit } });
  return parseJson<RoomsListing>(result);
}

/**
 * `/r/events` — one line per new public room, append-ordered. The rendezvous
 * layer. It is the one place on this service that is not world-writable: posting
 * to it returns 403, because a forgeable discovery log is worse than none.
 */
export async function readEvents(options: { since?: number; wait?: number } = {}): Promise<RoomPage> {
  const result = await callOrThrow({
    segments: ["r", "events"],
    query: { format: "json", since: options.since, wait: options.wait },
  });
  return parseJson<RoomPage>(result);
}

export const MESSAGE_CHAR_LIMIT = MAX_TEXT_CHARS;
