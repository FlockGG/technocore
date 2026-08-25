/**
 * Text canonicalisation that mirrors Technocore's `clean_text` exactly.
 *
 * This matters more than it looks. A signed write's signature covers the text
 * *after* the server's single-line sweep — the bytes that actually get stored —
 * so if our sweep and theirs disagree by one character the server computes a
 * different payload and the write is refused with 403.
 *
 * Reference: technocore-chat `src/store.py::clean_text`
 *   INVISIBLE_CATEGORIES = ("Cc", "Cf", "Cs", "Co", "Zl", "Zp")
 *   -> each such code point becomes a space, then `str.strip()`, then length check.
 */

/** Message body ceiling, in Unicode code points. */
export const MAX_TEXT_CHARS = 4096;
/** Note value ceiling, in Unicode code points. */
export const MAX_NOTE_CHARS = 8192;

/**
 * The Unicode general categories the server replaces with a space:
 * control, format, surrogate, private-use, line separator, paragraph separator.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;

/** `/^[a-z0-9][a-z0-9_-]{0,47}$/` — rooms, nicks, namespaces and keys all share it. */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** 48 base58btc characters after `did:key:`, always tagged `z6Mk` for ed25519-pub. */
export const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;

/** 86 unpadded base64url characters. */
export const SIG_PATTERN = /^[A-Za-z0-9_-]{86}$/;

/** 1–19 digits (int64 ceiling). */
export const NONCE_PATTERN = /^[0-9]{1,19}$/;

export class SweepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SweepError";
  }
}

/** Code-point length, matching Python's `len()` rather than UTF-16 `.length`. */
export function codePointLength(text: string): number {
  let n = 0;
  // The iterator yields whole code points; only the count matters here.
  for (const _char of text) void _char, (n += 1);
  return n;
}

/**
 * Apply the server's sweep without enforcing the limits — useful for showing the
 * user a live preview of what will actually be stored.
 *
 * JS `String.prototype.trim()` trims the WhiteSpace + LineTerminator set, which
 * differs from Python's `str.strip()` only on code points (\x1c-\x1f, \x85,
 * ﻿) that the category pass above has already turned into spaces — so after
 * the replace the two are equivalent.
 */
export function sweepText(text: string): string {
  return text.replace(INVISIBLE, " ").trim();
}

/** True when sweeping would change the string, i.e. the user typed something invisible. */
export function sweepWouldAlter(text: string): boolean {
  return sweepText(text) !== text;
}

/**
 * Sweep and enforce the ceiling, throwing the same distinctions the server makes.
 * Returns the exact string that will be stored — and therefore the exact string
 * that must go into the signature payload.
 */
export function canonicalText(text: string, limit: number = MAX_TEXT_CHARS): string {
  const swept = sweepText(text);
  if (!swept) {
    throw new SweepError(
      "Nothing visible was left after the single-line sweep. Control, format, " +
        "zero-width, bidi and line-separator characters are all replaced with a space.",
    );
  }
  const length = codePointLength(swept);
  if (length > limit) {
    throw new SweepError(`Too long: ${length} characters, limit is ${limit}.`);
  }
  return swept;
}

export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/**
 * Coerce arbitrary user input into a legal Technocore name, or return null when
 * nothing usable survives. Used to derive default room names from agent names.
 */
export function toValidName(input: string): string | null {
  const slug = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+/, "")
    .replace(/[-_]+$/, "")
    .slice(0, 48);
  return isValidName(slug) ? slug : null;
}

/** Room class markers, composed by prefix: `mb-p-x` is both a mailbox and unlisted. */
const ROOM_CLASSES = new Set(["p", "mb", "d", "e"]);
const UNOWNABLE_ROOMS = new Set(["lobby", "meta"]);

export function roomClasses(name: string): Set<string> {
  const classes = new Set<string>();
  const segments = name.split("-");
  for (const segment of segments.slice(0, -1)) {
    if (!ROOM_CLASSES.has(segment)) break;
    classes.add(segment);
  }
  return classes;
}

export const isUnlistedRoom = (name: string) => roomClasses(name).has("p");
export const isMailboxRoom = (name: string) => roomClasses(name).has("mb");
export const isEphemeralRoom = (name: string) => roomClasses(name).has("e");
export const isOwnableRoom = (name: string) =>
  roomClasses(name).has("d") && !UNOWNABLE_ROOMS.has(name);

/**
 * ~150 bits of entropy in the 30 remaining name characters. The URL *is* the
 * secret, so this is the only thing standing between a private room and a
 * stranger — it must come from a CSPRNG, never Math.random().
 */
export function unguessableSuffix(length = 26): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}
