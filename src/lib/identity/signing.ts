/**
 * Signature payload construction and Ed25519 signing/verification.
 *
 * Two payload shapes, both published by the service in
 * `/.well-known/agent.json` under `identity`:
 *
 *   message : <room>|<nonce>|<text>
 *   note    : <namespace>|<key>|<nonce>|<value>
 *
 * In both cases the signed bytes are the *stored* bytes — the text after the
 * single-line sweep. Sign the raw input instead and the server refuses with 403.
 */

import * as ed25519 from "@noble/ed25519";
import { base64urlnopad } from "@scure/base";

import {
  IdentityError,
  publicKeyFromDid,
  type SecretIdentity,
} from "./keys";
import {
  canonicalText,
  MAX_NOTE_CHARS,
  MAX_TEXT_CHARS,
  NONCE_PATTERN,
  SIG_PATTERN,
} from "./sweep";

export interface SignedMessage {
  readonly did: string;
  readonly room: string;
  /** The canonical text: exactly what the server will store. */
  readonly text: string;
  readonly nonce: string;
  /** 86 unpadded base64url characters. */
  readonly sig: string;
  /** The literal string that was signed. Kept so the UI can show it. */
  readonly payload: string;
}

export interface SignedNote {
  readonly did: string;
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  readonly nonce: string;
  readonly sig: string;
  readonly payload: string;
}

export const messageSignaturePayload = (room: string, nonce: string, text: string): string =>
  `${room}|${nonce}|${text}`;

export const noteSignaturePayload = (
  namespace: string,
  key: string,
  nonce: string,
  value: string,
): string => `${namespace}|${key}|${nonce}|${value}`;

function signBytes(payload: string, secretKey: Uint8Array): string {
  const signature = ed25519.sign(new TextEncoder().encode(payload), secretKey);
  return base64urlnopad.encode(signature);
}

/**
 * Sign a room message. `text` is swept first, so the returned `text` — not the
 * caller's input — is what must be sent on the wire.
 */
export function signMessage(
  identity: SecretIdentity,
  room: string,
  rawText: string,
  nonce: string,
): SignedMessage {
  assertNonce(nonce);
  const text = canonicalText(rawText, MAX_TEXT_CHARS);
  const payload = messageSignaturePayload(room, nonce, text);
  return { did: identity.did, room, text, nonce, sig: signBytes(payload, identity.secretKey), payload };
}

/**
 * Sign a note write. Only `room-owners` and `room-allow` accept signed notes;
 * every other namespace is world-writable and needs no signature.
 */
export function signNote(
  identity: SecretIdentity,
  namespace: string,
  key: string,
  rawValue: string,
  nonce: string,
): SignedNote {
  assertNonce(nonce);
  const value = canonicalText(rawValue, MAX_NOTE_CHARS);
  const payload = noteSignaturePayload(namespace, key, nonce, value);
  return {
    did: identity.did,
    namespace,
    key,
    value,
    nonce,
    sig: signBytes(payload, identity.secretKey),
    payload,
  };
}

/**
 * Verify a signature offline. The identifier *is* the key, so this needs no
 * resolver and no network — which is what lets Folester re-check a record it
 * read back from the service instead of trusting the rendering.
 */
export function verifySignature(did: string, sig: string, payload: string): boolean {
  if (!SIG_PATTERN.test(sig)) return false;
  try {
    return ed25519.verify(
      base64urlnopad.decode(sig),
      new TextEncoder().encode(payload),
      publicKeyFromDid(did),
    );
  } catch {
    return false;
  }
}

export const verifyMessage = (
  did: string,
  sig: string,
  room: string,
  nonce: string,
  text: string,
): boolean => verifySignature(did, sig, messageSignaturePayload(room, nonce, text));

function assertNonce(nonce: string): void {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new IdentityError(`Bad nonce ${JSON.stringify(nonce)}: expected 1-19 digits.`);
  }
}

/* -------------------------------------------------------------------------- */
/* Nonce allocation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A nonce must be strictly greater than the last one that key used in that room.
 * A millisecond clock satisfies that on its own until two writes land in the same
 * millisecond, so we keep a local high-water mark per (key, room) and also accept
 * a floor observed from the server — `?format=json` exposes `nonce` on every
 * signed record, so a fresh client can recover the true high-water mark instead
 * of guessing and eating a 403.
 */
const NONCE_KEY = "folester.nonce.v1";

type NonceLedger = Record<string, number>;

function readLedger(): NonceLedger {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(NONCE_KEY);
    return raw ? (JSON.parse(raw) as NonceLedger) : {};
  } catch {
    return {};
  }
}

function writeLedger(ledger: NonceLedger): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(NONCE_KEY, JSON.stringify(ledger));
  } catch {
    /* Quota or private-mode failure is not fatal: the clock alone still advances. */
  }
}

const slot = (did: string, scope: string) => `${did}::${scope}`;

/**
 * Allocate the next nonce for a (key, scope) pair. `scope` is the room for
 * messages and the room the note governs for signed notes.
 */
export function nextNonce(did: string, scope: string, serverFloor?: number): string {
  const ledger = readLedger();
  const id = slot(did, scope);
  const previous = Math.max(ledger[id] ?? 0, serverFloor ?? 0);
  const nonce = Math.max(Date.now(), previous + 1);
  ledger[id] = nonce;
  writeLedger(ledger);
  return String(nonce);
}

/** Record a nonce we know the server accepted, so the next one clears it. */
export function recordNonce(did: string, scope: string, nonce: number): void {
  const ledger = readLedger();
  const id = slot(did, scope);
  if ((ledger[id] ?? 0) < nonce) {
    ledger[id] = nonce;
    writeLedger(ledger);
  }
}
