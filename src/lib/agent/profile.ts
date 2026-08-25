/**
 * Publishing and reading agent identity notes.
 *
 * Technocore's identity convention (patterns.md §3) is a single note at
 * `/kv/did/<fingerprint>`, where the fingerprint is the first 16 hex digits of
 * SHA-256 over the full `did:key` string, holding one space-separated line:
 *
 *     did:key:z6Mk… x25519:<b64url> mailbox:mb-p-<name>
 *
 * The `did` namespace is world-writable and the note is written unsigned, so the
 * note itself proves nothing — anyone can publish a well-formed note for a key
 * they do not hold. What proves possession is a signed message that verifies
 * against the DID inside it. Folester surfaces exactly that distinction rather
 * than treating a published note as an identity.
 */

import { didFingerprint, isDid } from "@/lib/identity/keys";
import { sweepText } from "@/lib/identity/sweep";
import { describeError } from "@/lib/technocore/errors";
import { readNote, writeNote } from "@/lib/technocore/kv";

import { recordActivity } from "./activity";
import { updateAgent } from "./store";
import type { AgentProfile, AgentRecord, DiscoveredAgent } from "./types";

export const DID_NAMESPACE = "did";

/** Where Folester's richer profile lives inside the agent's own namespace. */
export const PROFILE_KEY = "profile";

/**
 * A Folester extension token in the DID note: `fol:<namespace>` points at the
 * profile note above. Additive and prefixed like the convention's own tokens, so a
 * parser that only knows `x25519:` and `mailbox:` ignores it. Only published when
 * the namespace is public — advertising an unlistable `p-` namespace would tell
 * peers to read something they cannot.
 */
const FOLESTER_TOKEN = "fol:";

export function didNoteValue(agent: AgentRecord): string {
  const tokens = [agent.did, `mailbox:${agent.mailboxRoom}`];
  if (agent.memoryScope === "public") tokens.push(`${FOLESTER_TOKEN}${agent.memoryNamespace}`);
  return tokens.join(" ");
}

export function profileNoteValue(agent: AgentRecord): string {
  const profile: AgentProfile = {
    v: 1,
    name: agent.name,
    description: agent.description,
    capabilities: [...agent.capabilities],
    mailbox: agent.mailboxRoom,
    publishedAt: new Date().toISOString(),
  };
  // Single line by construction: JSON.stringify escapes every control character.
  return JSON.stringify(profile);
}

export interface PublishResult {
  readonly didNote: { ok: boolean; error: string | null; value: string; path: string };
  readonly profileNote: { ok: boolean; error: string | null; skipped: boolean };
}

/**
 * Publish the agent's identity. Two writes, reported separately, because the DID
 * note is the interoperable one — if the Folester profile write fails the agent is
 * still discoverable by every other Technocore agent.
 *
 * Takes no key, and that is not an oversight: the `did` namespace accepts unsigned
 * writes, so publishing a DID note requires nothing but the ability to reach the
 * service. It is an announcement, not an attestation.
 */
export async function publishProfile(agent: AgentRecord): Promise<PublishResult> {
  const fingerprint = didFingerprint(agent.did);
  const value = didNoteValue(agent);
  const path = `/kv/${DID_NAMESPACE}/${fingerprint}`;

  let didNote: PublishResult["didNote"];
  try {
    await writeNote(DID_NAMESPACE, fingerprint, value);
    didNote = { ok: true, error: null, value, path };
    updateAgent(agent.did, { profilePublishedAt: new Date().toISOString() });
    recordActivity({
      agentDid: agent.did,
      kind: "profile.published",
      summary: `Published DID note as ${fingerprint}`,
      path,
    });
  } catch (error) {
    const message = describeError(error);
    didNote = { ok: false, error: message, value, path };
    recordActivity({
      agentDid: agent.did,
      kind: "profile.published",
      summary: "Failed to publish DID note",
      status: "error",
      detail: message,
      path,
    });
  }

  if (agent.memoryScope !== "public") {
    return { didNote, profileNote: { ok: false, error: null, skipped: true } };
  }

  try {
    await writeNote(agent.memoryNamespace, PROFILE_KEY, profileNoteValue(agent));
    return { didNote, profileNote: { ok: true, error: null, skipped: false } };
  } catch (error) {
    const message = describeError(error);
    recordActivity({
      agentDid: agent.did,
      kind: "profile.published",
      summary: "Failed to publish Folester profile note",
      status: "error",
      detail: message,
      path: `/kv/${agent.memoryNamespace}/${PROFILE_KEY}`,
    });
    return { didNote, profileNote: { ok: false, error: message, skipped: false } };
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parse a DID note into what it actually tells us. Unknown tokens are dropped
 * rather than guessed at, and `selfConsistent` records only whether the note sits
 * under the fingerprint of the DID it contains.
 */
export function parseDidNote(fingerprint: string, raw: string): DiscoveredAgent | null {
  const line = sweepText(raw);
  if (!line) return null;

  const tokens = line.split(/\s+/);
  const did = tokens.find((token) => isDid(token));
  if (!did) return null;

  const tokenValue = (prefix: string): string | null => {
    const hit = tokens.find((token) => token.startsWith(prefix) && token.length > prefix.length);
    return hit ? hit.slice(prefix.length) : null;
  };

  return {
    fingerprint,
    did,
    mailbox: tokenValue("mailbox:"),
    x25519: tokenValue("x25519:"),
    folesterNamespace: tokenValue(FOLESTER_TOKEN),
    selfConsistent: didFingerprint(did) === fingerprint,
    signatureSeenAt: null,
    profile: null,
    noteRaw: line,
  };
}

export async function readDidNote(did: string): Promise<DiscoveredAgent | null> {
  const fingerprint = didFingerprint(did);
  const note = await readNote(DID_NAMESPACE, fingerprint);
  return note ? parseDidNote(fingerprint, note.value) : null;
}

/** Read a Folester profile note. Returns null when absent or not Folester's shape. */
export async function readProfileNote(namespace: string): Promise<AgentProfile | null> {
  const note = await readNote(namespace, PROFILE_KEY);
  return note ? parseProfileNote(note.value) : null;
}

export function parseProfileNote(raw: string): AgentProfile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AgentProfile>;
    if (parsed.v !== 1 || typeof parsed.name !== "string") return null;
    return {
      v: 1,
      name: parsed.name,
      description: typeof parsed.description === "string" ? parsed.description : "",
      capabilities: Array.isArray(parsed.capabilities)
        ? parsed.capabilities.filter((entry): entry is string => typeof entry === "string")
        : [],
      mailbox: typeof parsed.mailbox === "string" ? parsed.mailbox : null,
      publishedAt: typeof parsed.publishedAt === "string" ? parsed.publishedAt : "",
    };
  } catch {
    return null;
  }
}
