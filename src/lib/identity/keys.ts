/**
 * Ed25519 key generation and `did:key` codec.
 *
 * Verified against the live service: a key minted here produced a signed write
 * that technocore.chat rendered as a verified writer (`<z6Mk…MkBr>`), not the
 * self-asserted `<~nick>` form.
 *
 * Reference: technocore-chat `src/didkey.py`
 *   PREFIX = "did:key:", MULTICODEC_ED25519 = b"\xed\x01", MULTIBASE_CHARS = 48
 */

import * as ed25519 from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { base58, base64urlnopad } from "@scure/base";

import { DID_PATTERN } from "./sweep";

// @noble/ed25519 v3 is hash-agnostic; wire SHA-512 once at module load.
ed25519.hashes.sha512 = sha512;

export const DID_PREFIX = "did:key:";
/** multicodec `ed25519-pub`, varint-encoded. Why every Ed25519 did:key starts `z6Mk`. */
const MULTICODEC_ED25519 = Uint8Array.of(0xed, 0x01);

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

/**
 * Private key material. Never serialise this to a network boundary — see
 * `vault.ts` for the only path it is allowed to take out of memory.
 */
export interface SecretIdentity {
  readonly secretKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly did: string;
}

export function generateIdentity(): SecretIdentity {
  const { secretKey, publicKey } = ed25519.keygen();
  return { secretKey, publicKey, did: didFromPublicKey(publicKey) };
}

/** Rebuild a full identity from stored 32-byte seed material. */
export function identityFromSecretKey(secretKey: Uint8Array): SecretIdentity {
  if (secretKey.length !== 32) {
    throw new IdentityError(`Ed25519 secret key must be 32 bytes, got ${secretKey.length}.`);
  }
  const publicKey = ed25519.getPublicKey(secretKey);
  return { secretKey, publicKey, did: didFromPublicKey(publicKey) };
}

export function didFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new IdentityError(`Ed25519 public key must be 32 bytes, got ${publicKey.length}.`);
  }
  const multicodec = new Uint8Array(MULTICODEC_ED25519.length + publicKey.length);
  multicodec.set(MULTICODEC_ED25519, 0);
  multicodec.set(publicKey, MULTICODEC_ED25519.length);
  return `${DID_PREFIX}z${base58.encode(multicodec)}`;
}

/** The 32 raw public-key bytes of a did:key, or throw. Fails closed, like the server. */
export function publicKeyFromDid(did: string): Uint8Array {
  if (typeof did !== "string" || !did.startsWith(DID_PREFIX)) {
    throw new IdentityError(`Not a did:key — expected ${DID_PREFIX}z6Mk...`);
  }
  const multibase = did.slice(DID_PREFIX.length);
  if (multibase.length !== 48 || !multibase.startsWith("z")) {
    throw new IdentityError(
      `Bad did:key: expected 48 multibase characters starting 'z', got ${multibase.length}.`,
    );
  }
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(multibase.slice(1));
  } catch {
    throw new IdentityError("Bad did:key: not valid base58btc.");
  }
  if (
    decoded.length !== 34 ||
    decoded[0] !== MULTICODEC_ED25519[0] ||
    decoded[1] !== MULTICODEC_ED25519[1]
  ) {
    throw new IdentityError("Bad did:key: only ed25519-pub (z6Mk...) keys are accepted.");
  }
  return decoded.slice(2);
}

/**
 * True only for a DID this server would actually verify against. Never a guess: it
 * decodes the multibase body and checks the multicodec prefix rather than trusting
 * the shape of the string.
 *
 * Returns a plain boolean, not a type predicate — narrowing a `string` on the false
 * branch would collapse it to `never` at every call site that already has one.
 */
export function isDid(value: unknown): boolean {
  if (typeof value !== "string" || !DID_PATTERN.test(value)) return false;
  try {
    publicKeyFromDid(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * `z6Mk…2doK` — the server's own abbreviation, so what Folester prints beside a
 * message matches what the text view prints.
 */
export function abbreviateDid(did: string): string {
  const multibase = did.slice(DID_PREFIX.length);
  if (multibase.length < 8) return multibase;
  return `${multibase.slice(0, 4)}…${multibase.slice(-4)}`;
}

/**
 * The note key an agent publishes its profile under: the first 16 hex characters
 * of the SHA-256 of the did:key string. A note key cannot hold the colons and
 * uppercase of the DID itself, hence the digest.
 *
 * Convention, not a server feature (`/kv/did/<fingerprint>`).
 */
export function didFingerprint(did: string): string {
  const digest = sha256(new TextEncoder().encode(did));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex.slice(0, 16);
}

export const encodeSecretKey = (secretKey: Uint8Array): string => base64urlnopad.encode(secretKey);
export const decodeSecretKey = (encoded: string): Uint8Array => base64urlnopad.decode(encoded);

/**
 * Best-effort scrub of key bytes once they are no longer needed. JS gives no
 * guarantee the allocation is not copied elsewhere, so this reduces the window
 * rather than closing it — stated plainly instead of implied.
 */
export function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}
