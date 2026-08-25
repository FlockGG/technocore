/**
 * Local custody for agent private keys.
 *
 * Rules this module exists to enforce:
 *   - the 32-byte secret key is generated in the browser and never crosses a
 *     network boundary — not to Folester's own proxy, not to Technocore;
 *   - at rest it is AES-256-GCM ciphertext, keyed by PBKDF2 over a passphrase
 *     the user chooses and this app never stores;
 *   - unlocked key material lives in module memory for the page session. An
 *     explicit opt-in mirrors it into tab-scoped `sessionStorage` so a reload
 *     does not force a re-unlock; that is weaker, so it is labelled as such in
 *     the UI rather than made the default.
 *
 * There is no server-side custody and no recovery path. A lost passphrase means
 * a lost agent identity, which is stated in the UI at creation time.
 */

import { base64urlnopad } from "@scure/base";

import {
  decodeSecretKey,
  encodeSecretKey,
  identityFromSecretKey,
  wipe,
  type SecretIdentity,
} from "./keys";

const VAULT_PREFIX = "folester.vault.v1.";
const SESSION_PREFIX = "folester.session.v1.";

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = "SHA-256";
const SALT_BYTES = 16;
const IV_BYTES = 12;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

export interface VaultRecord {
  readonly version: 1;
  readonly did: string;
  readonly createdAt: string;
  readonly kdf: {
    readonly name: "PBKDF2";
    readonly hash: typeof PBKDF2_HASH;
    readonly iterations: number;
    readonly salt: string;
  };
  readonly cipher: { readonly name: "AES-GCM"; readonly iv: string };
  readonly ciphertext: string;
}

/* -------------------------------------------------------------------------- */
/* Crypto helpers                                                             */
/* -------------------------------------------------------------------------- */

function requireSubtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new VaultError(
      "Web Crypto is unavailable. Folester needs a secure context (HTTPS or localhost) " +
        "to encrypt agent keys.",
    );
  }
  return crypto.subtle;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const subtle = requireSubtle();
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: PBKDF2_HASH },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/* -------------------------------------------------------------------------- */
/* Vault storage                                                              */
/* -------------------------------------------------------------------------- */

const vaultKey = (did: string) => `${VAULT_PREFIX}${did}`;

export function hasVault(did: string): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(vaultKey(did)) !== null;
}

export function readVault(did: string): VaultRecord | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(vaultKey(did));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VaultRecord;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function listVaultDids(): string[] {
  if (typeof localStorage === "undefined") return [];
  const dids: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(VAULT_PREFIX)) dids.push(key.slice(VAULT_PREFIX.length));
  }
  return dids;
}

/** Encrypt an identity under a passphrase and persist the ciphertext. */
export async function createVault(
  identity: SecretIdentity,
  passphrase: string,
): Promise<VaultRecord> {
  if (passphrase.length < 8) {
    throw new VaultError("Passphrase must be at least 8 characters.");
  }
  const subtle = requireSubtle();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    identity.secretKey as BufferSource,
  );

  const record: VaultRecord = {
    version: 1,
    did: identity.did,
    createdAt: new Date().toISOString(),
    kdf: {
      name: "PBKDF2",
      hash: PBKDF2_HASH,
      iterations: PBKDF2_ITERATIONS,
      salt: base64urlnopad.encode(salt),
    },
    cipher: { name: "AES-GCM", iv: base64urlnopad.encode(iv) },
    ciphertext: base64urlnopad.encode(new Uint8Array(ciphertext)),
  };

  if (typeof localStorage === "undefined") {
    throw new VaultError("No local storage available to hold the encrypted key.");
  }
  localStorage.setItem(vaultKey(identity.did), JSON.stringify(record));
  return record;
}

/** Re-encrypt an already-unlocked identity under a new passphrase. */
export async function changePassphrase(
  did: string,
  currentPassphrase: string,
  nextPassphrase: string,
): Promise<void> {
  const identity = await unlockVault(did, currentPassphrase);
  await createVault(identity, nextPassphrase);
  unlockedKeys.set(did, identity);
}

export function destroyVault(did: string): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(vaultKey(did));
  lock(did);
}

/* -------------------------------------------------------------------------- */
/* Unlock / session state                                                     */
/* -------------------------------------------------------------------------- */

/** Decrypted keys for this page session. Cleared on reload unless mirrored below. */
const unlockedKeys = new Map<string, SecretIdentity>();

export async function unlockVault(did: string, passphrase: string): Promise<SecretIdentity> {
  const record = readVault(did);
  if (!record) throw new VaultError(`No encrypted key stored for ${did} on this device.`);

  const subtle = requireSubtle();
  const key = await deriveKey(
    passphrase,
    base64urlnopad.decode(record.kdf.salt),
    record.kdf.iterations,
  );

  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle.decrypt(
      { name: "AES-GCM", iv: base64urlnopad.decode(record.cipher.iv) as BufferSource },
      key,
      base64urlnopad.decode(record.ciphertext) as BufferSource,
    );
  } catch {
    // AES-GCM authentication failure is indistinguishable from a wrong passphrase,
    // which is the whole point: there is nothing else it could be.
    throw new VaultError("Wrong passphrase.");
  }

  const identity = identityFromSecretKey(new Uint8Array(plaintext));
  if (identity.did !== did) {
    throw new VaultError("Decrypted key does not match the stored DID. Vault is corrupt.");
  }
  unlockedKeys.set(did, identity);
  return identity;
}

/** The unlocked identity, or null. Never throws — callers gate on it. */
export function getUnlocked(did: string): SecretIdentity | null {
  const inMemory = unlockedKeys.get(did);
  if (inMemory) return inMemory;

  // Tab-scoped mirror, only present when the user opted in.
  if (typeof sessionStorage !== "undefined") {
    const cached = sessionStorage.getItem(`${SESSION_PREFIX}${did}`);
    if (cached) {
      try {
        const identity = identityFromSecretKey(decodeSecretKey(cached));
        if (identity.did === did) {
          unlockedKeys.set(did, identity);
          return identity;
        }
      } catch {
        sessionStorage.removeItem(`${SESSION_PREFIX}${did}`);
      }
    }
  }
  return null;
}

export function isUnlocked(did: string): boolean {
  return getUnlocked(did) !== null;
}

/**
 * Opt-in: mirror the unlocked key into tab-scoped storage so a reload does not
 * force a re-unlock. Weaker than memory-only — `sessionStorage` is readable by
 * any script on this origin — so the UI names that trade-off where it is offered.
 */
export function persistForTab(did: string, enabled: boolean): void {
  if (typeof sessionStorage === "undefined") return;
  const storageKey = `${SESSION_PREFIX}${did}`;
  if (!enabled) {
    sessionStorage.removeItem(storageKey);
    return;
  }
  const identity = unlockedKeys.get(did);
  if (identity) sessionStorage.setItem(storageKey, encodeSecretKey(identity.secretKey));
}

export function isPersistedForTab(did: string): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(`${SESSION_PREFIX}${did}`) !== null;
}

export function lock(did: string): void {
  const identity = unlockedKeys.get(did);
  if (identity) wipe(identity.secretKey as Uint8Array);
  unlockedKeys.delete(did);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(`${SESSION_PREFIX}${did}`);
  }
}

export function lockAll(): void {
  for (const did of [...unlockedKeys.keys()]) lock(did);
}

/**
 * The only function that turns a private key back into a string, and it exists
 * solely for the user's own backup flow. It requires the passphrase again even
 * when the vault is already unlocked, so a stray call cannot leak the key.
 */
export async function exportSecretKey(did: string, passphrase: string): Promise<string> {
  const identity = await unlockVault(did, passphrase);
  return encodeSecretKey(identity.secretKey);
}

/** Restore from a backup string produced by `exportSecretKey`. */
export async function importSecretKey(
  encodedSecretKey: string,
  passphrase: string,
): Promise<SecretIdentity> {
  let identity: SecretIdentity;
  try {
    identity = identityFromSecretKey(decodeSecretKey(encodedSecretKey.trim()));
  } catch {
    throw new VaultError("That is not a valid Ed25519 secret key backup.");
  }
  await createVault(identity, passphrase);
  unlockedKeys.set(identity.did, identity);
  return identity;
}
