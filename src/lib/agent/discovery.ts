/**
 * Agent discovery.
 *
 * Everything here reads the real network. There is no seeded directory and no
 * example agents: if Technocore has nothing to show, the UI shows nothing.
 *
 * Two independent sources, because they answer different questions:
 *
 *   The DID directory (`/kv/did`) answers "who has announced an identity". It is
 *   large — over ten thousand notes — and the service returns at most 5120 keys in
 *   one listing with no pagination parameters, so what Folester can show is a slice
 *   and is labelled as one. A note there proves nothing: the namespace is
 *   world-writable, so anyone can publish a well-formed note for a key they do not
 *   hold.
 *
 *   Public rooms answer "who is actually active". A signed message carries a nonce
 *   and a full did:key, which the service only emits after checking an Ed25519
 *   signature — so a DID seen writing in a room is evidence of a live key, which a
 *   directory entry is not.
 *
 * Folester keeps those two apart rather than blending them into a single score.
 * There is no reputation number here, because there is nothing real to compute one
 * from.
 */

import { didFingerprint, isDid } from "@/lib/identity/keys";
import { describeError } from "@/lib/technocore/errors";
import { listNamespace, readNote } from "@/lib/technocore/kv";
import { listRooms, readRoom } from "@/lib/technocore/rooms";
import type { RoomSummary } from "@/lib/technocore/types";
import { readJson, writeJson } from "@/lib/storage";

import { recordActivity } from "./activity";
import { LOBBY_ROOM } from "./messaging";
import { parseDidNote, parseProfileNote } from "./profile";
import { PROFILE_KEY } from "./profile";
import type { DiscoveredAgent } from "./types";

const PEERS_KEY = "folester.peers.v1";
const SEEN_KEY = "folester.seen-signatures.v1";

/**
 * The most keys `/kv/<ns>` will return. Not a Folester choice — the service caps
 * the listing and offers no offset, so a namespace larger than this cannot be
 * walked. The directory view says so instead of implying completeness.
 */
export const DIRECTORY_LISTING_CAP = 5120;

/** Resolving a peer costs one read each, so pages are small by default. */
export const DEFAULT_RESOLVE_PAGE = 24;

/* -------------------------------------------------------------------------- */
/* Local caches                                                                */
/* -------------------------------------------------------------------------- */

type PeerCache = Record<string, DiscoveredAgent>;
type SeenIndex = Record<string, string>;

const peerCache = (): PeerCache => readJson<PeerCache>(PEERS_KEY, {});
const seenIndex = (): SeenIndex => readJson<SeenIndex>(SEEN_KEY, {});

export function cachedPeers(): readonly DiscoveredAgent[] {
  const seen = seenIndex();
  return Object.values(peerCache()).map((peer) => ({
    ...peer,
    signatureSeenAt: seen[peer.did] ?? null,
  }));
}

export function cachedPeer(did: string): DiscoveredAgent | null {
  const peer = peerCache()[didFingerprint(did)];
  if (!peer) return null;
  return { ...peer, signatureSeenAt: seenIndex()[peer.did] ?? null };
}

function cachePeer(peer: DiscoveredAgent): void {
  writeJson(PEERS_KEY, { ...peerCache(), [peer.fingerprint]: peer });
}

/**
 * Record that a signed record from this DID was observed. This is the strongest
 * claim Folester can make about a peer it did not sign for: the service verified a
 * signature from that key at write time.
 */
export function recordSignatureSeen(did: string, at: string): void {
  if (!isDid(did)) return;
  const index = seenIndex();
  if ((index[did] ?? "") >= at) return;
  writeJson(SEEN_KEY, { ...index, [did]: at });
}

/* -------------------------------------------------------------------------- */
/* Directory                                                                   */
/* -------------------------------------------------------------------------- */

export interface DirectoryListing {
  readonly fingerprints: readonly string[];
  /** True when the listing hit the service's cap, so more identities exist. */
  readonly truncated: boolean;
  readonly fetchedAt: string;
}

export async function readDirectory(): Promise<DirectoryListing> {
  const listing = await listNamespace("did");
  const fingerprints = listing.keys ?? [];
  return {
    fingerprints,
    truncated: fingerprints.length >= DIRECTORY_LISTING_CAP,
    fetchedAt: new Date().toISOString(),
  };
}

export interface ResolveReport {
  readonly resolved: readonly DiscoveredAgent[];
  /** Keys whose note was missing, empty, or not a DID note. Reported, not hidden. */
  readonly unreadable: readonly string[];
  readonly error: string | null;
}

/**
 * Read the DID notes for a page of fingerprints. Sequential on purpose: the read
 * budget is per-IP and Folester shares one proxy IP across all of its users, so a
 * burst of parallel reads would throttle everybody.
 */
export async function resolveDirectoryPage(
  fingerprints: readonly string[],
): Promise<ResolveReport> {
  const resolved: DiscoveredAgent[] = [];
  const unreadable: string[] = [];
  let firstError: string | null = null;

  for (const fingerprint of fingerprints) {
    try {
      const note = await readNote("did", fingerprint);
      const peer = note ? parseDidNote(fingerprint, note.value) : null;
      if (!peer) {
        unreadable.push(fingerprint);
        continue;
      }
      cachePeer(peer);
      resolved.push({ ...peer, signatureSeenAt: seenIndex()[peer.did] ?? null });
    } catch (error) {
      firstError ??= describeError(error);
      unreadable.push(fingerprint);
    }
  }

  return { resolved, unreadable, error: firstError };
}

/** Look up one agent by did:key or by the 16-hex fingerprint of its note. */
export async function lookupAgent(
  input: string,
): Promise<{ agent: DiscoveredAgent | null; error: string | null }> {
  const query = input.trim();
  const fingerprint = isDid(query)
    ? didFingerprint(query)
    : /^[0-9a-f]{16}$/.test(query.toLowerCase())
      ? query.toLowerCase()
      : null;

  if (!fingerprint) {
    return {
      agent: null,
      error: "Enter a did:key identifier or the 16-character hex fingerprint of one.",
    };
  }

  try {
    const note = await readNote("did", fingerprint);
    if (!note) {
      return { agent: null, error: `No identity note published at /kv/did/${fingerprint}.` };
    }
    const peer = parseDidNote(fingerprint, note.value);
    if (!peer) {
      return {
        agent: null,
        error: `The note at /kv/did/${fingerprint} exists but contains no did:key. It reads: ${note.value.slice(0, 120)}`,
      };
    }

    let profile = null;
    if (peer.folesterNamespace) {
      try {
        const profileNote = await readNote(peer.folesterNamespace, PROFILE_KEY);
        profile = profileNote ? parseProfileNote(profileNote.value) : null;
      } catch {
        // A missing or unreadable profile is not a failure to find the agent.
      }
    }

    const agent: DiscoveredAgent = {
      ...peer,
      profile,
      signatureSeenAt: seenIndex()[peer.did] ?? null,
    };
    cachePeer(agent);
    return { agent, error: null };
  } catch (error) {
    return { agent: null, error: describeError(error) };
  }
}

/* -------------------------------------------------------------------------- */
/* Live activity                                                               */
/* -------------------------------------------------------------------------- */

export interface ActiveAgent {
  readonly did: string;
  readonly fingerprint: string;
  readonly lastSeenAt: string;
  readonly messages: number;
  readonly rooms: readonly string[];
}

export interface NetworkScan {
  readonly rooms: readonly RoomSummary[];
  readonly roomsTotal: number;
  readonly roomsCapacity: number;
  readonly notesTotal: number;
  readonly notesCapacity: number;
  readonly sampled: readonly string[];
  readonly active: readonly ActiveAgent[];
  /** Distinct unsigned nicks seen. Attributable to nobody; counted separately. */
  readonly unsignedWriters: number;
  readonly scannedAt: string;
  readonly error: string | null;
  /**
   * The service returns `room` and `topic` as caller-chosen strings and says so in
   * every `/rooms` response. Carried through so the UI can mark them untrusted.
   */
  readonly untrustedFields: readonly string[];
}

/**
 * Scan the live network: the public room listing, plus the recent messages of a few
 * of the busiest rooms, reduced to the distinct keys that wrote them.
 *
 * `sampleRooms` bounds the number of reads. Nothing here is extrapolated to a
 * network-wide figure — the counts are for the rooms actually read, and the UI
 * names them.
 */
export async function scanNetwork(
  options: { sampleRooms?: number; ownDid?: string } = {},
): Promise<NetworkScan> {
  const scannedAt = new Date().toISOString();
  const sampleCount = Math.max(1, Math.min(options.sampleRooms ?? 4, 8));

  let listing;
  try {
    listing = await listRooms(60);
  } catch (error) {
    const message = describeError(error);
    if (options.ownDid) {
      recordActivity({
        agentDid: options.ownDid,
        kind: "discovery.scanned",
        summary: "Network scan failed",
        status: "error",
        detail: message,
        path: "/rooms",
      });
    }
    return {
      rooms: [],
      roomsTotal: 0,
      roomsCapacity: 0,
      notesTotal: 0,
      notesCapacity: 0,
      sampled: [],
      active: [],
      unsignedWriters: 0,
      scannedAt,
      error: message,
      untrustedFields: [],
    };
  }

  // Busiest-first by idle time. `lobby` is always included: it is the room the
  // convention points newcomers at, so it is where announcements land.
  const candidates = listing.rooms
    .filter((room) => room.room !== "events")
    .slice()
    .sort((a, b) => a.idle_seconds - b.idle_seconds)
    .map((room) => room.room);
  const sampled = [...new Set([LOBBY_ROOM, ...candidates])].slice(0, sampleCount);

  const byDid = new Map<string, { lastSeenAt: string; messages: number; rooms: Set<string> }>();
  const nicks = new Set<string>();
  let firstError: string | null = null;

  for (const room of sampled) {
    try {
      const page = await readRoom(room, { limit: 50 });
      for (const message of page.messages) {
        if (!isDid(message.from) || typeof message.nonce !== "number") {
          nicks.add(message.from);
          continue;
        }
        recordSignatureSeen(message.from, message.ts);
        const entry = byDid.get(message.from) ?? {
          lastSeenAt: message.ts,
          messages: 0,
          rooms: new Set<string>(),
        };
        entry.messages += 1;
        entry.rooms.add(room);
        if (message.ts > entry.lastSeenAt) entry.lastSeenAt = message.ts;
        byDid.set(message.from, entry);
      }
    } catch (error) {
      firstError ??= describeError(error);
    }
  }

  const active: ActiveAgent[] = [...byDid.entries()]
    .map(([did, entry]) => ({
      did,
      fingerprint: didFingerprint(did),
      lastSeenAt: entry.lastSeenAt,
      messages: entry.messages,
      rooms: [...entry.rooms],
    }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  if (options.ownDid) {
    recordActivity({
      agentDid: options.ownDid,
      kind: "discovery.scanned",
      summary: `Scanned ${sampled.length} room${sampled.length === 1 ? "" : "s"}: ${active.length} signing key${active.length === 1 ? "" : "s"} seen`,
      status: firstError ? "error" : "ok",
      detail: firstError ?? undefined,
      path: "/rooms",
    });
  }

  return {
    rooms: listing.rooms,
    roomsTotal: listing.total,
    roomsCapacity: listing.capacity,
    notesTotal: listing.notes?.total ?? 0,
    notesCapacity: listing.notes?.capacity ?? 0,
    sampled,
    active,
    unsignedWriters: nicks.size,
    scannedAt,
    error: firstError,
    untrustedFields: listing.untrusted?.fields ?? [],
  };
}

/** Filter resolved peers by an advertised capability, from their Folester profile. */
export function filterByCapability(
  peers: readonly DiscoveredAgent[],
  capability: string,
): readonly DiscoveredAgent[] {
  if (!capability) return peers;
  return peers.filter((peer) => peer.profile?.capabilities.includes(capability));
}

/** Peers that can actually be sent a task: they advertise a mailbox. */
export const reachablePeers = (peers: readonly DiscoveredAgent[]): readonly DiscoveredAgent[] =>
  peers.filter((peer) => peer.mailbox !== null);
