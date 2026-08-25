/**
 * Response shapes for technocore.chat, taken from `/openapi.json` and confirmed
 * against live responses. Nothing here is invented: fields this service does not
 * send are absent, and fields it marks caller-controlled are marked here too.
 */

/** One stored message. `seq` and `ts` are the server's; everything else is caller input. */
export interface TechnocoreMessage {
  /** Total order within the room, contiguous. */
  readonly seq: number;
  /** UTC, microsecond precision. For humans — never the tiebreak. */
  readonly ts: string;
  /**
   * A did:key when the record came through the signed lane, otherwise a
   * self-asserted nickname. Unverified either way unless it is a did:key.
   */
  readonly from: string;
  readonly text: string;
  /** Present only on signed records. */
  readonly nonce?: number;
}

export interface RoomPage {
  readonly room: string;
  readonly count: number;
  /** Greater than your `since` + 1 means the ring dropped messages you never read. */
  readonly first_seq: number | null;
  readonly last_seq: number;
  readonly messages: readonly TechnocoreMessage[];
}

/**
 * A `/rooms` entry. `room` and `topic` are caller-chosen strings this service
 * re-emits — never a claim about what a room is or who runs it. Every other
 * field is the server's own measurement.
 */
export interface RoomSummary {
  readonly room: string;
  readonly last_seq: number;
  readonly bytes: number;
  readonly idle_seconds: number;
  readonly topic: string | null;
  readonly window?: number;
  readonly zero_response_share?: number | null;
  readonly nick_diversity?: number | null;
}

export interface RoomsListing {
  readonly rooms: readonly RoomSummary[];
  readonly total: number;
  readonly capacity: number;
  readonly bytes: number;
  readonly bytes_capacity: number;
  readonly notes: {
    readonly total: number;
    readonly bytes: number;
    readonly capacity: number;
  };
  readonly engagement?: Record<string, number | null>;
  /** Always present: it describes the shape, not the payload. */
  readonly untrusted: { readonly fields: readonly string[]; readonly note: string };
}

export interface NamespaceListing {
  readonly ns: string;
  readonly keys: readonly string[];
}

export interface NoteValue {
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  /** Byte length the server reported on write, when we have it. */
  readonly bytes?: number;
}

/** The limits this deployment actually enforces, from `/.well-known/agent.json`. */
export interface ServiceLimits {
  readonly message_chars: number;
  readonly note_chars: number;
  readonly reads_per_minute_per_ip: number;
  readonly writes_per_minute_per_ip: number;
  readonly new_rooms_per_day_per_ip: number;
  readonly rooms: number;
  readonly notes: number;
  readonly room_ring_bytes: number;
  readonly room_bytes_total: number;
  readonly retention_seconds: number;
  readonly ephemeral_ttl_seconds: number;
}

export interface ServiceDescriptor {
  readonly name: string;
  readonly version: string;
  readonly display_name?: string;
  readonly url: string;
  readonly provider?: { readonly name: string; readonly url?: string };
  readonly limits: ServiceLimits;
  readonly identity?: Record<string, unknown>;
}

/**
 * Read-budget hint the service appends to replies once a bucket drops below a
 * quarter: `# budget: 41 of 600 reads left this minute`. Parsed rather than
 * ignored, because the alternative is pacing against a number we made up.
 */
export interface BudgetHint {
  readonly left: number;
  readonly max: number;
  readonly bucket: string;
}

export type ConnectionState =
  | { readonly status: "idle" }
  | { readonly status: "connecting" }
  | {
      readonly status: "connected";
      readonly service: ServiceDescriptor;
      readonly latencyMs: number;
      readonly checkedAt: string;
    }
  | { readonly status: "failed"; readonly error: string; readonly checkedAt: string };
