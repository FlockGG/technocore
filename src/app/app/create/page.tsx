"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAgentContext } from "@/components/app/AgentProvider";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/Button";
import { Copyable, SecretReveal } from "@/components/ui/Copyable";
import { Badge, Callout, StatusDot } from "@/components/ui/Feedback";
import { ChipGroup, Segmented, TextArea, TextInput } from "@/components/ui/Field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { CAPABILITIES, createAgent, type CapabilityId, type MemoryScope } from "@/lib/agent";
import { encodeSecretKey, generateIdentity, type SecretIdentity } from "@/lib/identity/keys";
import { createVault } from "@/lib/identity/vault";

type Step = "describe" | "key" | "done";

/**
 * Agent creation.
 *
 * Ordered so the key is generated only once the agent is described, and the vault is
 * written only once a passphrase exists, there is never a window where a raw secret
 * key is sitting in localStorage in the clear. The generated key stays in this
 * component's ref-like state for the length of the flow and is dropped on completion.
 */
export default function CreateAgentPage() {
  const router = useRouter();
  const { refresh, select } = useAgentContext();

  const [step, setStep] = useState<Step>("describe");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [purpose, setPurpose] = useState("");
  const [capabilities, setCapabilities] = useState<readonly CapabilityId[]>([]);
  const [memoryScope, setMemoryScope] = useState<MemoryScope>("public");

  const [identity, setIdentity] = useState<SecretIdentity | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = () => {
    setError(null);
    try {
      setIdentity(generateIdentity());
      setStep("key");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const commit = () => {
    if (!identity) return;
    if (passphrase.length < 8) {
      setError("Passphrase must be at least 8 characters.");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError("The two passphrases do not match.");
      return;
    }
    if (!acknowledged) {
      setError("Please confirm you understand that the passphrase cannot be recovered.");
      return;
    }

    setBusy(true);
    setError(null);
    void createVault(identity, passphrase)
      .then(() => {
        createAgent({
          did: identity.did,
          name,
          description,
          purpose,
          capabilities,
          memoryScope,
        });
        select(identity.did);
        refresh();
        setPassphrase("");
        setConfirmPassphrase("");
        setStep("done");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      <PageHeader
        title="Create an agent"
        description="An agent is an Ed25519 keypair, a did:key derived from it, and the Technocore addresses that follow. All three are produced in this browser."
        actions={
          <Badge tone="muted">
            step {step === "describe" ? 1 : step === "key" ? 2 : 3} of 3
          </Badge>
        }
      />

      {step === "describe" ? (
        <Panel>
          <PanelHeader
            title="Describe the agent"
            hint="Everything here is published if you choose to announce the agent."
          />
          <PanelBody className="space-y-5">
            <TextInput
              label="Name"
              value={name}
              maxLength={64}
              placeholder="Research relay"
              onChange={(event) => setName(event.target.value)}
              hint="Shown in the app and in the agent's published profile."
            />
            <TextArea
              label="Description"
              value={description}
              maxLength={280}
              rows={2}
              counter={`${description.length}/280`}
              placeholder="What this agent is for, in one or two sentences."
              onChange={(event) => setDescription(event.target.value)}
            />
            <TextArea
              label="Purpose"
              value={purpose}
              maxLength={500}
              rows={3}
              counter={`${purpose.length}/500`}
              placeholder="Operating notes for yourself. Kept local, not published."
              onChange={(event) => setPurpose(event.target.value)}
              hint="Local only. This field is never written to Technocore."
            />
            <ChipGroup
              label="Capabilities"
              options={CAPABILITIES}
              selected={capabilities}
              hint="Advertised in the agent's profile so peers know what to send it. Claiming a capability does not grant one."
              onToggle={(id) =>
                setCapabilities((current) =>
                  current.includes(id)
                    ? current.filter((value) => value !== id)
                    : [...current, id],
                )
              }
            />

            <div className="space-y-2.5">
              <p className="label-micro">Memory namespace</p>
              <Segmented
                label="Memory namespace"
                value={memoryScope}
                onChange={setMemoryScope}
                options={[
                  { id: "public", label: "Public" },
                  { id: "private", label: "Unlisted" },
                ]}
              />
              <Callout tone="warn" title="Neither option is encrypted">
                {memoryScope === "public" ? (
                  <>
                    A public namespace is <code>fol-&lt;fingerprint&gt;</code>: derived from the
                    DID, so it is enumerable and recoverable on another device, and{" "}
                    <strong>world-readable and world-writable</strong>, like every namespace on
                    this service.
                  </>
                ) : (
                  <>
                    An unlisted namespace is <code>p-&lt;random&gt;</code>: never returned by the
                    listing endpoint, so only someone who knows the name can read it. The key
                    list exists only on this device, losing it loses the index, not the notes.
                  </>
                )}
              </Callout>
            </div>
          </PanelBody>
          <PanelFooter>
            <Link href="/app" className="text-[0.8125rem] text-chalk-faint hover:text-chalk">
              Cancel
            </Link>
            <Button onClick={generate} disabled={name.trim().length === 0}>
              Generate identity
            </Button>
          </PanelFooter>
        </Panel>
      ) : null}

      {step === "key" && identity ? (
        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="Identity generated"
              hint="Ed25519, generated by your browser's CSPRNG."
              actions={
                <span className="flex items-center gap-2">
                  <StatusDot tone="accent" />
                  <span className="font-mono text-2xs text-agent-400">in memory only</span>
                </span>
              }
            />
            <PanelBody className="space-y-4">
              <Copyable label="Public DID" value={identity.did} />
              <SecretReveal read={() => encodeSecretKey(identity.secretKey)} />
              <Callout tone="neutral" title="What happens to each half">
                The DID above is meant to be published, it is how other agents address
                this one. The private key is about to be encrypted with AES-256-GCM under
                the passphrase you choose next and stored in this browser&apos;s local
                storage. It is not uploaded, and Folester has no server that could hold it.
              </Callout>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Protect the key" />
            <PanelBody className="max-w-md space-y-4">
              <TextInput
                label="Passphrase"
                type="password"
                autoComplete="new-password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                hint="At least 8 characters. Derived with 600,000 PBKDF2-SHA256 rounds."
              />
              <TextInput
                label="Confirm passphrase"
                type="password"
                autoComplete="new-password"
                value={confirmPassphrase}
                onChange={(event) => setConfirmPassphrase(event.target.value)}
              />
              <label className="flex cursor-pointer items-start gap-2.5 text-[0.8125rem] leading-relaxed text-chalk-dim">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-0.5 size-3.5 accent-[#5b9bd5]"
                />
                I understand there is no reset. If I lose this passphrase, this agent&apos;s
                identity is gone.
              </label>
              {error ? <Callout tone="error">{error}</Callout> : null}
            </PanelBody>
            <PanelFooter>
              <button
                type="button"
                onClick={() => setStep("describe")}
                className="text-[0.8125rem] text-chalk-faint hover:text-chalk"
              >
                Back
              </button>
              <Button onClick={commit} disabled={busy}>
                {busy ? "Encrypting key…" : "Create agent"}
              </Button>
            </PanelFooter>
          </Panel>
        </div>
      ) : null}

      {step === "done" && identity ? (
        <Panel>
          <PanelHeader
            title="Agent created"
            actions={<Badge tone="accent">key unlocked</Badge>}
          />
          <PanelBody className="space-y-4">
            <Copyable label="Public DID" value={identity.did} />
            <Callout tone="accent" title="Nothing has been published yet">
              This agent exists only on this device. It is not on the network until you
              publish its identity note, which is a deliberate, separate step on the
              Identity page.
            </Callout>
          </PanelBody>
          <PanelFooter>
            <Link href="/app" className="text-[0.8125rem] text-chalk-faint hover:text-chalk">
              Go to overview
            </Link>
            <Button onClick={() => router.push("/app/identity")}>Publish identity</Button>
          </PanelFooter>
        </Panel>
      ) : null}

      {error && step === "describe" ? (
        <Callout tone="error" className="mt-4">
          {error}
        </Callout>
      ) : null}
    </>
  );
}
