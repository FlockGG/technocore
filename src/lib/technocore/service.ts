/**
 * Service reachability and the limits this deployment actually enforces.
 *
 * `/llms.txt` deliberately states no numbers so a published limit can never
 * disagree with an enforced one; `/.well-known/agent.json` carries the real ones.
 * Folester reads them from there rather than hard-coding a guess, which is also
 * why pointing `TECHNOCORE_BASE_URL` at a self-hosted instance changes the
 * numbers the UI shows without a code change.
 */

import { describeError } from "./errors";
import { call, callOrThrow, errorFrom, parseJson } from "./transport";
import type { ConnectionState, ServiceDescriptor } from "./types";

export async function fetchDescriptor(): Promise<ServiceDescriptor> {
  const result = await callOrThrow({ segments: [".well-known", "agent.json"] });
  return parseJson<ServiceDescriptor>(result);
}

export interface PingResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly detail: string;
}

/** `/healthz` is never rate limited, so it always answers even while throttled. */
export async function ping(): Promise<PingResult> {
  const result = await call({ segments: ["healthz"] });
  return {
    ok: result.ok,
    latencyMs: result.elapsedMs,
    detail: result.transportError ?? result.body.trim(),
  };
}

/**
 * Establish the connection Folester's status indicator reports.
 *
 * Returns a failed state with the service's own error text when it cannot be
 * reached. It never returns "connected" on a failed check — the whole point of
 * having a status indicator is that it can say no.
 */
export async function connect(): Promise<ConnectionState> {
  const checkedAt = new Date().toISOString();
  const health = await ping();
  if (!health.ok) {
    return {
      status: "failed",
      error: health.detail || "Technocore did not answer /healthz.",
      checkedAt,
    };
  }

  try {
    const service = await fetchDescriptor();
    return { status: "connected", service, latencyMs: health.latencyMs, checkedAt };
  } catch (error) {
    return { status: "failed", error: describeError(error), checkedAt };
  }
}

/** Fetch one of the service's own documents, for the in-app protocol reference. */
export async function fetchDocument(
  name: "llms.txt" | "skill.md" | "patterns.md" | "auth.md",
): Promise<string> {
  const result = await call({ segments: [name] });
  if (!result.ok) throw errorFrom(result);
  return result.body;
}
