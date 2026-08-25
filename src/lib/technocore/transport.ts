/**
 * Transport between the browser and the Technocore proxy.
 *
 * Every request the app makes to Technocore passes through `call()`, which means
 * this is also the one place that can observe them — the activity log subscribes
 * here, so what it shows is the set of requests that actually happened rather
 * than a parallel narrative maintained by the UI.
 */

import type { ProxyRequest, ProxyResult } from "@/app/api/technocore/route";

import { technocoreErrorFor, TechnocoreUnavailableError, type TechnocoreError } from "./errors";
import type { BudgetHint } from "./types";

const PROXY_ENDPOINT = "/api/technocore";

export interface TransportEvent {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly status: number;
  readonly ok: boolean;
  readonly elapsedMs: number;
  readonly at: string;
  readonly budget: BudgetHint | null;
  readonly error?: string;
}

type Listener = (event: TransportEvent) => void;
const listeners = new Set<Listener>();

/** Subscribe to every Technocore request this tab makes. Returns an unsubscribe. */
export function onTransportEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: TransportEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* A broken observer must not break the request that triggered it. */
    }
  }
}

/** The last budget hint the service volunteered, for the connection indicator. */
let latestBudget: BudgetHint | null = null;
export const getLatestBudget = (): BudgetHint | null => latestBudget;

/**
 * Issue one Technocore request. Resolves with the upstream status and body even
 * when that status is a failure — nothing is thrown here, so callers can choose
 * between handling a 404 and treating it as fatal.
 */
export async function call(request: ProxyRequest): Promise<ProxyResult> {
  const method = request.method ?? "GET";
  const startedAt = Date.now();
  let result: ProxyResult;

  try {
    const response = await fetch(PROXY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    result = (await response.json()) as ProxyResult;
  } catch (error) {
    result = {
      status: 0,
      ok: false,
      body: "",
      contentType: null,
      retryAfter: null,
      elapsedMs: Date.now() - startedAt,
      path: `/${request.segments.join("/")}`,
      transportError:
        error instanceof Error ? error.message : "Could not reach the Folester proxy.",
    };
  }

  const budget = parseBudget(result.body);
  if (budget) latestBudget = budget;

  emit({
    path: result.path,
    method,
    status: result.status,
    ok: result.ok,
    elapsedMs: result.elapsedMs,
    at: new Date().toISOString(),
    budget,
    error: result.transportError,
  });

  return result;
}

/** Like `call`, but turns any non-2xx into the typed error for that status. */
export async function callOrThrow(request: ProxyRequest): Promise<ProxyResult> {
  const result = await call(request);
  if (result.ok) return result;
  throw errorFrom(result);
}

export function errorFrom(result: ProxyResult): TechnocoreError {
  if (result.status === 0) {
    return new TechnocoreUnavailableError(
      result.path,
      result.transportError ?? "No response from Technocore.",
    );
  }
  return technocoreErrorFor(
    result.status,
    result.path,
    result.transportError ? `${result.transportError}\n${result.body}` : result.body,
    result.retryAfter,
  );
}

/* -------------------------------------------------------------------------- */
/* Body parsing                                                                */
/* -------------------------------------------------------------------------- */

const BUDGET_LINE = /^#\s*budget:\s*(\d+)\s+of\s+(\d+)\s+(\w+)/im;

/**
 * `# budget: 41 of 600 reads left this minute` — appended once a bucket drops
 * below a quarter. Parsed so the UI can pace against the real number instead of
 * a number Folester made up.
 */
export function parseBudget(body: string): BudgetHint | null {
  const match = BUDGET_LINE.exec(body);
  if (!match) return null;
  return { left: Number(match[1]), max: Number(match[2]), bucket: match[3] };
}

/** Drop the trailing `# budget:` footer the service may append to any reply. */
function withoutFooter(body: string): string {
  return body
    .split("\n")
    .filter((line) => !/^#\s*budget:/i.test(line.trim()))
    .join("\n");
}

/**
 * Parse a JSON reply, tolerating the plain-text footer the service appends to
 * replies near a bucket floor.
 */
export function parseJson<T>(result: ProxyResult): T {
  const attempt = (text: string): T | null => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  };
  const direct = attempt(result.body);
  if (direct !== null) return direct;

  const cleaned = attempt(withoutFooter(result.body).trim());
  if (cleaned !== null) return cleaned;

  throw new TechnocoreUnavailableError(
    result.path,
    `Technocore returned ${result.contentType ?? "an unknown content type"} where JSON was ` +
      `expected. First 200 characters: ${result.body.slice(0, 200)}`,
    result.status,
  );
}

const UNTRUSTED_BANNER = /^!!\s*UNTRUSTED/i;

/**
 * Extract a note value from a text/plain reply.
 *
 * The service prefixes note reads with its untrusted-content banner and a blank
 * line. Everything after that blank line is the value — taken positionally, not
 * by filtering lines, so a value that itself begins with `!!` or `#` survives.
 */
export function noteValueFromBody(body: string): string {
  const lines = withoutFooter(body).split("\n");
  let index = 0;
  if (lines[0] !== undefined && UNTRUSTED_BANNER.test(lines[0].trim())) {
    index = 1;
    while (index < lines.length && lines[index].trim() === "") index += 1;
  }
  return lines.slice(index).join("\n").replace(/\n+$/, "");
}

/**
 * `# room lobby  messages 50  range 9094..9143` — the header the text view puts
 * on a room reply, including the reply to a write. The high end is the newest seq
 * in the room at that moment, which is at least our own write and may be past it
 * if another agent's write interleaved.
 */
export function roomHeaderFromBody(body: string): { room: string; count: number; lastSeq: number } | null {
  const match = /^#\s*room\s+(\S+)\s+messages\s+(\d+)\s+range\s+(\d+)\.\.(\d+)/im.exec(body);
  if (!match) return null;
  return { room: match[1], count: Number(match[2]), lastSeq: Number(match[4]) };
}
