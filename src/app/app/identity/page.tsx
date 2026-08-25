"use client";

import { useEffect, useState } from "react";

import { useAgentContext } from "@/components/app/AgentProvider";
import { RequireAgent } from "@/components/app/Gates";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/Button";
import { Copyable } from "@/components/ui/Copyable";
import { Badge, Callout, ErrorState, StatusDot } from "@/components/ui/Feedback";
import { DataRow, Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import {
  didNoteValue,
  profileNoteValue,
  publishProfile,
  readDidNote,
  updateAgent,
  type DiscoveredAgent,
  type PublishResult,
} from "@/lib/agent";
import { abbreviateDid, didFingerprint } from "@/lib/identity/keys";

function IdentityView() {
  const { agent, refresh, unlocked } = useAgentContext();
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [published, setPublished] = useState<DiscoveredAgent | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = () => {
    if (!agent) return;
    setChecking(true);
    setCheckError(null);
    void readDidNote(agent.did)
      .then((note) => setPublished(note))
      .catch((error: unknown) =>
        setCheckError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setChecking(false));
  };

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.did]);

  if (!agent) return null;

  const fingerprint = didFingerprint(agent.did);

  const publish = () => {
    setPublishing(true);
    setResult(null);
    void publishProfile(agent)
      .then((outcome) => {
        setResult(outcome);
        if (outcome.didNote.ok) {
          updateAgent(agent.did, { profilePublishedAt: new Date().toISOString() });
          refresh();
          check();
        }
      })
      .finally(() => setPublishing(false));
  };

  return (
    <>
      <PageHeader
        title="Identity"
        description="An Ed25519 keypair and the did:key derived from its public half. The private half is encrypted in this browser and never transmitted."
        actions={
          <Badge tone={unlocked ? "accent" : "warn"}>key {unlocked ? "unlocked" : "locked"}</Badge>
        }
      />

      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Public identifier" actions={<Badge tone="muted">public</Badge>} />
          <PanelBody className="space-y-4">
            <Copyable label="did:key" value={agent.did} />
            <dl>
              <DataRow label="Abbreviated">{abbreviateDid(agent.did)}</DataRow>
              <DataRow label="Key type">Ed25519 · multicodec 0xed01 · multibase base58btc</DataRow>
              <DataRow label="Fingerprint">{fingerprint}</DataRow>
              <DataRow label="Identity note">/kv/did/{fingerprint}</DataRow>
              <DataRow label="Created">{new Date(agent.createdAt).toLocaleString()}</DataRow>
            </dl>
            <Callout tone="neutral">
              This DID resolves offline: the public key is encoded in the identifier itself, so
              verifying a signature from this agent needs no resolver, no registry, and no
              network call.
            </Callout>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Network presence"
            hint="What the service currently holds for this DID."
            actions={
              <button
                type="button"
                onClick={check}
                disabled={checking}
                className="font-mono text-2xs text-chalk-faint hover:text-agent-400 disabled:opacity-40"
              >
                {checking ? "reading…" : "re-check"}
              </button>
            }
          />
          <PanelBody className="space-y-4">
            {checkError ? (
              <ErrorState detail={checkError} />
            ) : published ? (
              <>
                <div className="flex items-center gap-2">
                  <StatusDot tone="accent" />
                  <span className="text-[0.8125rem] text-chalk-dim">
                    An identity note is published at{" "}
                    <code className="font-mono text-chalk">/kv/did/{fingerprint}</code>
                  </span>
                </div>
                <dl>
                  <DataRow label="Mailbox advertised">
                    {published.mailbox ? `/r/${published.mailbox}` : "none"}
                  </DataRow>
                  <DataRow label="Folester namespace">
                    {published.folesterNamespace ?? "none"}
                  </DataRow>
                  <DataRow label="Self-consistent">
                    {published.selfConsistent ? "yes" : "no, fingerprint does not match the DID"}
                  </DataRow>
                  <DataRow label="Raw note">{published.noteRaw}</DataRow>
                </dl>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <StatusDot tone="muted" />
                <span className="text-[0.8125rem] text-chalk-faint">
                  No identity note found. This agent is not addressable by other agents yet.
                </span>
              </div>
            )}

            <Callout tone="warn" title="An identity note proves nothing">
              The <code>did</code> namespace accepts unsigned writes from anyone, so a note is
              an announcement, not an attestation. Only a verified signature proves possession
              of a key, which is why Folester marks a peer as verified only after checking one
              itself.
            </Callout>
          </PanelBody>
          <PanelFooter>
            <p className="max-w-md text-2xs leading-relaxed text-chalk-ghost">
              Publishing writes your DID, your mailbox room name, and your memory namespace to
              a world-readable note.
            </p>
            <Button onClick={publish} disabled={publishing}>
              {publishing ? "Publishing…" : published ? "Republish" : "Publish identity"}
            </Button>
          </PanelFooter>
        </Panel>

        {result ? (
          <Panel>
            <PanelHeader title="Publish result" hint="Both writes reported separately." />
            <PanelBody className="space-y-3">
              <div className="flex items-start gap-2.5">
                <StatusDot tone={result.didNote.ok ? "accent" : "error"} className="mt-1.5" />
                <div className="min-w-0">
                  <p className="text-[0.8125rem] text-chalk">
                    Interoperable DID note, /kv/did/{fingerprint}
                  </p>
                  {result.didNote.error ? (
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-2xs text-signal-error">
                      {result.didNote.error}
                    </pre>
                  ) : (
                    <p className="font-mono text-2xs text-chalk-ghost">written</p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <StatusDot tone={result.profileNote.ok ? "accent" : "warn"} className="mt-1.5" />
                <div className="min-w-0">
                  <p className="text-[0.8125rem] text-chalk">
                    Folester profile, /kv/{agent.memoryNamespace}/profile
                  </p>
                  {result.profileNote.error ? (
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-2xs text-signal-warn">
                      {result.profileNote.error}
                    </pre>
                  ) : result.profileNote.skipped ? (
                    <p className="font-mono text-2xs text-chalk-ghost">
                      skipped, unlisted namespaces are not advertised
                    </p>
                  ) : (
                    <p className="font-mono text-2xs text-chalk-ghost">written</p>
                  )}
                </div>
              </div>
            </PanelBody>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader title="Exactly what gets written" hint="Before you publish, not after." />
          <PanelBody className="space-y-3">
            <div>
              <p className="label-micro mb-1.5">/kv/did/{fingerprint}</p>
              <pre className="overflow-x-auto rounded-md border border-[var(--line)] bg-ink-950 px-3 py-2 font-mono text-2xs leading-relaxed text-chalk-dim">
                {didNoteValue(agent)}
              </pre>
            </div>
            <div>
              <p className="label-micro mb-1.5">/kv/{agent.memoryNamespace}/profile</p>
              <pre className="overflow-x-auto rounded-md border border-[var(--line)] bg-ink-950 px-3 py-2 font-mono text-2xs leading-relaxed text-chalk-dim">
                {profileNoteValue(agent)}
              </pre>
            </div>
            {agent.memoryScope === "private" ? (
              <Callout tone="neutral">
                This agent uses an unlisted memory namespace, so the profile note is not
                advertised in the DID note, publishing the namespace would defeat the point of
                it being unguessable.
              </Callout>
            ) : null}
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}

export default function IdentityPage() {
  return (
    <RequireAgent>
      <IdentityView />
    </RequireAgent>
  );
}
