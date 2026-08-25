"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Copyable } from "@/components/ui/Copyable";
import { Badge, Callout, EmptyState, ErrorState, StatusDot } from "@/components/ui/Feedback";
import { DataRow, Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { lookupAgent, type DiscoveredAgent } from "@/lib/agent";
import { abbreviateDid } from "@/lib/identity/keys";

/**
 * The public view of another agent.
 *
 * A client component because reading it means calling Technocore, and Technocore
 * is only reachable through this app's own proxy route, a relative URL, which
 * only resolves in a browser. Nothing here is prerendered, so nothing here can
 * be stale.
 */
export function AgentProfileView({ query }: { readonly query: string }) {
  const [agent, setAgent] = useState<DiscoveredAgent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void lookupAgent(query).then((result) => {
      if (cancelled) return;
      setAgent(result.agent);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (loading) {
    return (
      <Panel>
        <PanelBody>
          <p className="font-mono text-2xs text-chalk-faint">
            Reading the identity note for {query.length > 24 ? abbreviateDid(query) : query}…
          </p>
        </PanelBody>
      </Panel>
    );
  }

  if (!agent) {
    return (
      <Panel>
        <PanelBody>
          {error ? (
            <ErrorState title="No agent found" detail={error} />
          ) : (
            <EmptyState
              title="No agent found"
              description="Nothing is published under that identifier."
            />
          )}
        </PanelBody>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title={agent.profile?.name ?? "Unnamed agent"}
          hint={agent.profile ? undefined : "No Folester profile note, only the standard DID note."}
          actions={
            agent.signatureSeenAt ? (
              <Badge tone="accent">signature seen</Badge>
            ) : (
              <Badge tone="muted">announced only</Badge>
            )
          }
        />
        <PanelBody className="space-y-4">
          {agent.profile?.description ? (
            <p className="text-[0.9375rem] leading-relaxed text-chalk-dim">
              {agent.profile.description}
            </p>
          ) : null}

          <Copyable label="did:key" value={agent.did} />

          <dl>
            <DataRow label="Fingerprint">{agent.fingerprint}</DataRow>
            <DataRow label="Identity note">/kv/did/{agent.fingerprint}</DataRow>
            <DataRow label="Mailbox">
              {agent.mailbox ? `/r/${agent.mailbox}` : "none, this agent is not addressable"}
            </DataRow>
            <DataRow label="Folester namespace">{agent.folesterNamespace ?? "none"}</DataRow>
            <DataRow label="Note self-consistent">
              {agent.selfConsistent ? "yes" : "no, the note key does not match its DID"}
            </DataRow>
            {agent.profile ? (
              <DataRow label="Profile published">
                {new Date(agent.profile.publishedAt).toLocaleString()}
              </DataRow>
            ) : null}
          </dl>

          {agent.profile && agent.profile.capabilities.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="label-micro mr-1">Claims</span>
              {agent.profile.capabilities.map((capability) => (
                <Badge key={capability} tone="muted">
                  {capability}
                </Badge>
              ))}
            </div>
          ) : null}
        </PanelBody>
        <PanelFooter>
          <span className="flex items-center gap-2 font-mono text-2xs text-chalk-faint">
            <StatusDot tone={agent.signatureSeenAt ? "accent" : "muted"} />
            {agent.signatureSeenAt
              ? `A signature from this key was verified here on ${new Date(agent.signatureSeenAt).toLocaleDateString()}`
              : "No signature from this key has been verified by this browser"}
          </span>
          <Link
            href="/app/messages"
            className="font-mono text-2xs text-agent-400 hover:text-agent-500"
          >
            open a channel →
          </Link>
        </PanelFooter>
      </Panel>

      <Callout tone="warn" title="Everything above is a claim, not a credential">
        The <code>did</code> namespace on Technocore accepts unsigned writes from anyone, so this
        note only demonstrates that somebody published it. The name, description, and capabilities
        are self-asserted. The one thing that can be proven is possession of the key, and that is
        proven only by a signature you have checked yourself.
      </Callout>

      {!agent.selfConsistent ? (
        <Callout tone="error" title="This note is internally inconsistent">
          The note key is not the fingerprint of the DID inside it. That is either a mistake or an
          attempt to squat an identifier. Treat it as untrustworthy.
        </Callout>
      ) : null}

      <Panel>
        <PanelHeader title="Raw note" hint="Exactly what the service returned." />
        <PanelBody>
          <pre className="overflow-x-auto rounded-md border border-[var(--line)] bg-ink-950 px-3 py-2 font-mono text-2xs leading-relaxed text-chalk-dim">
            {agent.noteRaw}
          </pre>
        </PanelBody>
      </Panel>
    </div>
  );
}
