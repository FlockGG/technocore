/**
 * The Technocore edge.
 *
 * technocore.chat sends no `Access-Control-Allow-Origin` (its `CHAT_CORS_ORIGINS`
 * default is empty, so no browser origin is trusted), which means the browser
 * cannot read a response from it directly. Every Folester call therefore goes
 * through this route.
 *
 * What this route is NOT: a place where anything is invented. It forwards one
 * request, and returns the upstream status and the upstream body byte-for-byte.
 * It never substitutes a success for a failure, never retries silently, and
 * never synthesises a response when the service is down.
 *
 * What it does add:
 *   - a strict allowlist over the paths it will fetch, so it cannot be turned
 *     into a general-purpose SSRF proxy;
 *   - percent-encoding done here from structured segments, so a message body can
 *     contain slashes without the caller having to reason about path parsing;
 *   - a request timeout, and a ceiling on the response size it will buffer.
 *
 * Rate-limit note, stated because it is a real property of this design: the
 * service's buckets are per client IP, and to Technocore this deployment is one
 * IP. Every Folester user shares the same read and write budget. The remaining
 * budget is surfaced in the UI from the service's own `# budget:` footer, and
 * `TECHNOCORE_BASE_URL` can be pointed at a self-hosted instance.
 */

import { NextResponse } from "next/server";

import { NAME_PATTERN, DID_PATTERN, SIG_PATTERN, NONCE_PATTERN } from "@/lib/identity/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BASE = "https://technocore.chat";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export interface ProxyRequest {
  /** Decoded path segments. Encoded here, so callers never build a URL. */
  segments: string[];
  query?: Record<string, string | number | undefined>;
  method?: "GET" | "POST";
  /** JSON body for the POST lanes. */
  json?: unknown;
}

export interface ProxyResult {
  /** Upstream HTTP status, or 0 when the request never completed. */
  status: number;
  ok: boolean;
  body: string;
  contentType: string | null;
  retryAfter: string | null;
  elapsedMs: number;
  /** The upstream path that was fetched, for display in the activity log. */
  path: string;
  /** Set only when this route itself failed before or during the fetch. */
  transportError?: string;
}

function baseUrl(): URL {
  const raw = process.env.TECHNOCORE_BASE_URL?.trim() || DEFAULT_BASE;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`TECHNOCORE_BASE_URL must be http(s), got ${url.protocol}`);
  }
  return url;
}

const isName = (value: string | undefined) => typeof value === "string" && NAME_PATTERN.test(value);

/**
 * Every path shape this route is willing to fetch, as a predicate over decoded
 * segments. Anything not described here is refused — an allowlist, so a new
 * upstream route cannot be reached by accident.
 */
function isAllowed(segments: string[], method: "GET" | "POST"): boolean {
  const [head, ...rest] = segments;

  if (method === "GET") {
    if (segments.length === 1) {
      if (["healthz", "llms.txt", "skill.md", "patterns.md", "auth.md", "openapi.json"].includes(head))
        return true;
      if (head === "rooms") return true;
    }
    if (segments.length === 2 && head === ".well-known" && rest[0] === "agent.json") return true;
  }

  // Rooms -------------------------------------------------------------------
  if (head === "r") {
    // /r/events and /r/<room>
    if (rest.length === 1 && (rest[0] === "events" || isName(rest[0]))) {
      return method === "GET" || (method === "POST" && rest[0] !== "events");
    }
    if (method !== "GET") return false;
    // /r/<room>/say/<nick>/<text>
    if (rest.length === 4 && isName(rest[0]) && rest[1] === "say" && isName(rest[2])) return true;
    // /r/<room>/say-signed/<did>/<sig>/<nonce>/<text>
    if (
      rest.length === 6 &&
      isName(rest[0]) &&
      rest[1] === "say-signed" &&
      DID_PATTERN.test(rest[2]) &&
      SIG_PATTERN.test(rest[3]) &&
      NONCE_PATTERN.test(rest[4])
    )
      return true;
    return false;
  }

  // Notes -------------------------------------------------------------------
  if (head === "kv") {
    // /kv/<ns> and /kv/<ns>/<key>
    if (rest.length === 1 && isName(rest[0])) return method === "GET";
    if (rest.length === 2 && isName(rest[0]) && isName(rest[1])) return true;
    if (method !== "GET") return false;
    // /kv/<ns>/<key>/set/<value>
    if (rest.length === 4 && isName(rest[0]) && isName(rest[1]) && rest[2] === "set") return true;
    // /kv/<ns>/<key>/set-signed/<did>/<sig>/<nonce>/<value>
    if (
      rest.length === 7 &&
      isName(rest[0]) &&
      isName(rest[1]) &&
      rest[2] === "set-signed" &&
      DID_PATTERN.test(rest[3]) &&
      SIG_PATTERN.test(rest[4]) &&
      NONCE_PATTERN.test(rest[5])
    )
      return true;
    return false;
  }

  return false;
}

/**
 * Percent-encode a segment. `encodeURIComponent` leaves `.` alone, so a
 * free-form value of `.` or `..` would become a real path traversal — those two
 * get their dots escaped explicitly rather than relying on the allowlist to
 * have caught every free-form position.
 */
function encodeSegment(segment: string): string {
  if (segment === "." || segment === "..") return segment.replace(/\./g, "%2E");
  return encodeURIComponent(segment);
}

function badRequest(message: string) {
  return NextResponse.json(
    { status: 0, ok: false, body: "", contentType: null, retryAfter: null, elapsedMs: 0, path: "", transportError: message } satisfies ProxyResult,
    { status: 400 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return badRequest(`Request body over ${MAX_REQUEST_BODY_BYTES} bytes.`);
  }

  let payload: ProxyRequest;
  try {
    payload = (await request.json()) as ProxyRequest;
  } catch {
    return badRequest("Body must be JSON.");
  }

  const method = payload.method === "POST" ? "POST" : "GET";
  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  if (segments.length === 0 || segments.some((s) => typeof s !== "string" || s.includes("/"))) {
    return badRequest("`segments` must be a non-empty array of strings containing no slashes.");
  }
  if (!isAllowed(segments, method)) {
    return badRequest(`Path /${segments.join("/")} is not on this proxy's allowlist.`);
  }

  let target: URL;
  try {
    const base = baseUrl();
    target = new URL(base);
    target.pathname = `/${segments.map(encodeSegment).join("/")}`;
    for (const [key, value] of Object.entries(payload.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      target.searchParams.set(key, String(value));
    }
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Bad upstream URL.");
  }

  const displayPath = `${target.pathname}${target.search}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method,
      // Only the two headers this protocol needs. Nothing from the browser is
      // forwarded: no cookies, no auth, no user agent fingerprint.
      headers:
        method === "POST"
          ? { "content-type": "application/json", accept: "text/plain, application/json" }
          : { accept: "text/plain, application/json" },
      body: method === "POST" ? JSON.stringify(payload.json ?? {}) : undefined,
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });

    const upstreamLength = Number.parseInt(upstream.headers.get("content-length") ?? "0", 10);
    if (Number.isFinite(upstreamLength) && upstreamLength > MAX_RESPONSE_BYTES) {
      return NextResponse.json({
        status: upstream.status,
        ok: false,
        body: "",
        contentType: upstream.headers.get("content-type"),
        retryAfter: null,
        elapsedMs: Date.now() - startedAt,
        path: displayPath,
        transportError: `Upstream response is ${upstreamLength} bytes, over this proxy's ${MAX_RESPONSE_BYTES}-byte ceiling. Narrow the request with ?limit= or ?since=.`,
      } satisfies ProxyResult);
    }

    const body = await upstream.text();
    return NextResponse.json({
      status: upstream.status,
      ok: upstream.ok,
      body: body.length > MAX_RESPONSE_BYTES ? body.slice(0, MAX_RESPONSE_BYTES) : body,
      contentType: upstream.headers.get("content-type"),
      retryAfter: upstream.headers.get("retry-after"),
      elapsedMs: Date.now() - startedAt,
      path: displayPath,
    } satisfies ProxyResult);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({
      status: 0,
      ok: false,
      body: "",
      contentType: null,
      retryAfter: null,
      elapsedMs: Date.now() - startedAt,
      path: displayPath,
      transportError: aborted
        ? `No response from Technocore within ${REQUEST_TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : "Unknown transport failure.",
    } satisfies ProxyResult);
  } finally {
    clearTimeout(timer);
  }
}

/** A tiny GET so the health check can be done without a body. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    proxy: "folester/technocore",
    upstream: (() => {
      try {
        return baseUrl().origin;
      } catch {
        return null;
      }
    })(),
    note: "POST { segments, query?, method?, json? } to reach an allowlisted Technocore path.",
  });
}
