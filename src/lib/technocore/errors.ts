/**
 * Typed Technocore failures.
 *
 * These exist so the UI can show what actually went wrong. Every one of them
 * carries the service's own response body, because that body is where this
 * service puts the useful part — the retry delay, the value that beat you to a
 * CAS, the exact reason a name was rejected.
 *
 * Nothing here is ever swallowed into a generic "something went wrong", and
 * nothing is ever downgraded into a fake success.
 */

export class TechnocoreError extends Error {
  readonly status: number;
  readonly path: string;
  /** The service's raw response body, trimmed. Safe to show the user verbatim. */
  readonly detail: string;

  constructor(message: string, options: { status: number; path: string; detail?: string }) {
    super(message);
    this.name = "TechnocoreError";
    this.status = options.status;
    this.path = options.path;
    this.detail = (options.detail ?? "").trim();
  }
}

/** The service could not be reached at all, or answered 502/503/504. */
export class TechnocoreUnavailableError extends TechnocoreError {
  constructor(path: string, detail: string, status = 0) {
    super("Technocore connection failed", { status, path, detail });
    this.name = "TechnocoreUnavailableError";
  }
}

/** 400 — malformed name, nonce or parameter. The body names the cause. */
export class TechnocoreBadRequestError extends TechnocoreError {
  constructor(path: string, detail: string) {
    super("Technocore rejected the request as malformed", { status: 400, path, detail });
    this.name = "TechnocoreBadRequestError";
  }
}

/**
 * 403 — a well-formed DID whose signature does not cover this message, an
 * unsigned write to a `mb-` mailbox, a write to an owned `d-` room by a key that
 * is neither the owner nor on the allow-list, or a post to `/r/events`.
 */
export class TechnocoreForbiddenError extends TechnocoreError {
  constructor(path: string, detail: string) {
    super("Technocore refused the write", { status: 403, path, detail });
    this.name = "TechnocoreForbiddenError";
  }
}

/** 404 — no such note. Rooms are created by writing, so they do not 404. */
export class TechnocoreNotFoundError extends TechnocoreError {
  constructor(path: string, detail = "") {
    super("Not found on Technocore", { status: 404, path, detail });
    this.name = "TechnocoreNotFoundError";
  }
}

/**
 * 409 — a compare-and-set lost the race. The body carries the value that is
 * actually there, so the caller can rebase without re-reading.
 */
export class TechnocoreConflictError extends TechnocoreError {
  /** The value the note currently holds, extracted from the 409 body. */
  readonly currentValue: string | null;

  constructor(path: string, detail: string) {
    super("Note changed since you read it", { status: 409, path, detail });
    this.name = "TechnocoreConflictError";
    this.currentValue = parseConflictValue(detail);
  }
}

/** 429 — a token bucket ran dry. Reads and writes have separate buckets, per IP. */
export class TechnocoreRateLimitError extends TechnocoreError {
  /** Seconds to wait, from `Retry-After` or from the body. */
  readonly retryAfterSeconds: number | null;

  constructor(path: string, detail: string, retryAfterHeader?: string | null) {
    super("Technocore rate limit reached", { status: 429, path, detail });
    this.name = "TechnocoreRateLimitError";
    this.retryAfterSeconds = parseRetryAfter(retryAfterHeader, detail);
  }
}

/** 413 — POST body over the service's ceiling. */
export class TechnocorePayloadTooLargeError extends TechnocoreError {
  constructor(path: string, detail: string) {
    super("Payload too large for Technocore", { status: 413, path, detail });
    this.name = "TechnocorePayloadTooLargeError";
  }
}

/**
 * The 409 body ends with `current value follows (<n> chars):` and then the value.
 * Parsed positionally off that marker rather than by guessing at line counts.
 */
function parseConflictValue(detail: string): string | null {
  const marker = /current value follows \(\d+ chars?\):\s*\n/i.exec(detail);
  if (!marker) return null;
  return detail.slice(marker.index + marker[0].length).replace(/\n+$/, "");
}

function parseRetryAfter(header: string | null | undefined, detail: string): number | null {
  if (header) {
    const asSeconds = Number.parseInt(header, 10);
    if (Number.isFinite(asSeconds)) return asSeconds;
  }
  // The body states the delay in seconds; harnesses show bodies, not headers.
  const fromBody = /(?:retry|wait)\D{0,24}?(\d+(?:\.\d+)?)\s*s/i.exec(detail);
  return fromBody ? Math.ceil(Number.parseFloat(fromBody[1])) : null;
}

/** Map a proxied status onto the typed error the UI knows how to render. */
export function technocoreErrorFor(
  status: number,
  path: string,
  detail: string,
  retryAfter?: string | null,
): TechnocoreError {
  switch (status) {
    case 400:
      return new TechnocoreBadRequestError(path, detail);
    case 403:
      return new TechnocoreForbiddenError(path, detail);
    case 404:
      return new TechnocoreNotFoundError(path, detail);
    case 409:
      return new TechnocoreConflictError(path, detail);
    case 413:
      return new TechnocorePayloadTooLargeError(path, detail);
    case 429:
      return new TechnocoreRateLimitError(path, detail, retryAfter);
    default:
      if (status === 0 || status >= 500) return new TechnocoreUnavailableError(path, detail, status);
      return new TechnocoreError(`Technocore returned HTTP ${status}`, { status, path, detail });
  }
}

/**
 * A short, human-readable line for a failure — used in activity entries and
 * inline status. Always includes the service's own words when it gave any.
 */
export function describeError(error: unknown): string {
  if (error instanceof TechnocoreRateLimitError) {
    const wait = error.retryAfterSeconds;
    return wait ? `Rate limited — retry in ${wait}s` : "Rate limited by Technocore";
  }
  if (error instanceof TechnocoreError) {
    const firstLine = error.detail.split("\n").find((line) => line.trim().length > 0);
    return firstLine ? `${error.message}: ${firstLine.trim()}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
