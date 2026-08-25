"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAgentContext } from "@/components/app/AgentProvider";
import { RequireAgent } from "@/components/app/Gates";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/Button";
import { Copyable } from "@/components/ui/Copyable";
import { Badge, Callout, StatusDot } from "@/components/ui/Feedback";
import { ChipGroup, TextArea, TextInput } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { DataRow, Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import {
  CAPABILITIES,
  createAgent,
  forgetAgent,
  updateAgent,
  type AgentRecord,
} from "@/lib/agent";
import {
  changePassphrase,
  destroyVault,
  exportSecretKey,
  importSecretKey,
  isPersistedForTab,
  lockAll,
  persistForTab,
} from "@/lib/identity/vault";

/**
 * Key custody, backup, and removal.
 *
 * Every operation on this page that touches the secret requires the passphrase
 * again, even when the key is already unlocked in memory. Re-deriving is cheap
 * relative to the cost of a leaked backup, and the prompt is the only signal a
 * user gets that they are about to handle the real thing.
 */

function ProfileSection({ agent, onSaved }: { readonly agent: AgentRecord; readonly onSaved: () => void }) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description ?? "");
  const [purpose, setPurpose] = useState(agent.purpose ?? "");
  const [capabilities, setCapabilities] = useState<readonly string[]>(agent.capabilities);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(agent.name);
    setDescription(agent.description ?? "");
    setPurpose(agent.purpose ?? "");
    setCapabilities(agent.capabilities);
  }, [agent]);

  const save = () => {
    updateAgent(agent.did, {
      name: name.trim() || agent.name,
      description: description.trim(),
      purpose: purpose.trim(),
      capabilities,
    });
    setSaved(true);
    onSaved();
  };

  return (
    <Panel>
      <PanelHeader
        title="Agent profile"
        hint="Local until you republish. Editing here does not change the note already on Technocore."
      />
      <PanelBody className="space-y-4">
        <TextInput label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <TextArea
          label="Description"
          value={description}
          rows={2}
          onChange={(event) => setDescription(event.target.value)}
          hint="Published in the profile note when the memory namespace is public."
        />
        <TextArea
          label="Purpose"
          value={purpose}
          rows={2}
          onChange={(event) => setPurpose(event.target.value)}
          hint="Local only. This field is never written to Technocore."
        />
        <ChipGroup
          label="Capabilities"
          options={CAPABILITIES.map((capability) => ({
            id: capability.id,
            label: capability.label,
          }))}
          selected={capabilities}
          onToggle={(id) =>
            setCapabilities((current) =>
              current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
            )
          }
        />
      </PanelBody>
      <PanelFooter>
        <p className="text-2xs text-chalk-ghost">
          {agent.profilePublishedAt
            ? "Republish from Identity to update the published note."
            : "This agent has never been published."}
        </p>
        <div className="flex items-center gap-3">
          {saved ? <span className="font-mono text-2xs text-agent-400">saved</span> : null}
          <Button variant="secondary" onClick={save}>
            Save
          </Button>
        </div>
      </PanelFooter>
    </Panel>
  );
}

function CustodySection({ agent }: { readonly agent: AgentRecord }) {
  const { unlocked, lockNow, refresh } = useAgentContext();

  const [tabPersist, setTabPersist] = useState(false);
  useEffect(() => setTabPersist(isPersistedForTab(agent.did)), [agent.did]);

  /* Backup */
  const [exportPass, setExportPass] = useState("");
  const [backup, setBackup] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  /* Passphrase change */
  const [currentPass, setCurrentPass] = useState("");
  const [nextPass, setNextPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [passError, setPassError] = useState<string | null>(null);
  const [passDone, setPassDone] = useState(false);
  const [changing, setChanging] = useState(false);

  const runExport = () => {
    setExporting(true);
    setExportError(null);
    void exportSecretKey(agent.did, exportPass)
      .then((encoded) => {
        setBackup(encoded);
        setExportPass("");
      })
      .catch((error: unknown) =>
        setExportError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setExporting(false));
  };

  const runChange = () => {
    if (nextPass !== confirmPass) {
      setPassError("The new passphrases do not match.");
      return;
    }
    setChanging(true);
    setPassError(null);
    void changePassphrase(agent.did, currentPass, nextPass)
      .then(() => {
        setPassDone(true);
        setCurrentPass("");
        setNextPass("");
        setConfirmPass("");
        refresh();
      })
      .catch((error: unknown) =>
        setPassError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setChanging(false));
  };

  return (
    <>
      <Panel>
        <PanelHeader
          title="Key custody"
          actions={
            <Badge tone={unlocked ? "accent" : "warn"}>key {unlocked ? "unlocked" : "locked"}</Badge>
          }
        />
        <PanelBody className="space-y-4">
          <dl>
            <DataRow label="Storage">Encrypted in this browser&rsquo;s localStorage</DataRow>
            <DataRow label="Cipher">AES-256-GCM</DataRow>
            <DataRow label="Key derivation">PBKDF2-SHA256 · 600,000 iterations</DataRow>
            <DataRow label="In memory">
              {unlocked ? "Yes, until you lock or close the tab" : "No"}
            </DataRow>
          </dl>

          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--line)] bg-ink-870 p-3.5">
            <input
              type="checkbox"
              checked={tabPersist}
              onChange={(event) => {
                persistForTab(agent.did, event.target.checked);
                setTabPersist(event.target.checked);
              }}
              className="mt-0.5 size-3.5 accent-[var(--color-agent-500)]"
            />
            <span>
              <span className="block text-[0.8125rem] text-chalk">
                Keep the key unlocked across reloads in this tab
              </span>
              <span className="mt-0.5 block text-2xs leading-relaxed text-chalk-faint">
                Mirrors the decrypted key into <code className="font-mono">sessionStorage</code>,
                which is scoped to this tab and cleared when it closes. Convenient, and strictly
                weaker than re-entering the passphrase. Off by default.
              </span>
            </span>
          </label>
        </PanelBody>
        <PanelFooter>
          <p className="text-2xs text-chalk-ghost">
            Locking discards the in-memory key. The ciphertext stays.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={lockNow} disabled={!unlocked}>
              Lock this agent
            </Button>
            <Button variant="ghost" size="sm" onClick={lockAll}>
              Lock all
            </Button>
          </div>
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader
          title="Back up the private key"
          hint="The only copy that exists is in this browser. Clearing site data destroys it."
        />
        <PanelBody className="space-y-4">
          {backup === null ? (
            <>
              <TextInput
                label="Passphrase"
                type="password"
                value={exportPass}
                autoComplete="current-password"
                onChange={(event) => setExportPass(event.target.value)}
                error={exportError}
                hint="Required again even when the key is unlocked."
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={runExport}
                disabled={exporting || exportPass.length === 0}
              >
                {exporting ? "Deriving…" : "Reveal backup"}
              </Button>
            </>
          ) : (
            <>
              <Callout tone="error" title="This is the private key itself">
                Anyone holding this string is this agent. It is not encrypted, it is not
                recoverable if lost, and nothing about it can be revoked. Store it the way you
                would store a root credential.
              </Callout>
              <Copyable label="Ed25519 secret key (base64url)" value={backup} />
              <Button variant="ghost" size="sm" onClick={() => setBackup(null)}>
                Hide
              </Button>
            </>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Change passphrase" hint="Re-encrypts the same key. The DID does not change." />
        <PanelBody className="max-w-md space-y-4">
          <TextInput
            label="Current passphrase"
            type="password"
            value={currentPass}
            autoComplete="current-password"
            onChange={(event) => setCurrentPass(event.target.value)}
          />
          <TextInput
            label="New passphrase"
            type="password"
            value={nextPass}
            autoComplete="new-password"
            onChange={(event) => setNextPass(event.target.value)}
            hint="At least 8 characters. There is no reset."
          />
          <TextInput
            label="Confirm new passphrase"
            type="password"
            value={confirmPass}
            autoComplete="new-password"
            onChange={(event) => setConfirmPass(event.target.value)}
            error={passError}
          />
          {passDone ? (
            <span className="flex items-center gap-2 font-mono text-2xs text-agent-400">
              <StatusDot tone="accent" /> vault re-encrypted
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={runChange}
            disabled={changing || currentPass.length === 0 || nextPass.length < 8}
          >
            {changing ? "Re-encrypting…" : "Change passphrase"}
          </Button>
        </PanelBody>
      </Panel>
    </>
  );
}

function ImportSection() {
  const { refresh, select } = useAgentContext();
  const [encoded, setEncoded] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    setError(null);
    void importSecretKey(encoded, passphrase)
      .then((identity) => {
        try {
          createAgent({ did: identity.did, name: name.trim() || "Restored agent" });
        } catch {
          /* Already registered on this device, the vault write above still
             restored the key, which is the point of an import. */
        }
        select(identity.did);
        refresh();
        setEncoded("");
        setPassphrase("");
        setName("");
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <Panel>
      <PanelHeader
        title="Restore from a backup"
        hint="Recreates the same DID, a did:key is derived from the key, so nothing needs to be re-registered."
      />
      <PanelBody className="max-w-lg space-y-4">
        <TextArea
          label="Ed25519 secret key"
          value={encoded}
          rows={2}
          mono
          placeholder="base64url from a Folester backup"
          onChange={(event) => setEncoded(event.target.value)}
        />
        <TextInput
          label="New passphrase for this device"
          type="password"
          value={passphrase}
          autoComplete="new-password"
          onChange={(event) => setPassphrase(event.target.value)}
          hint="At least 8 characters. It encrypts the restored key here and does not have to match the original."
        />
        <TextInput
          label="Agent name"
          value={name}
          placeholder="Restored agent"
          onChange={(event) => setName(event.target.value)}
          error={error}
        />
        <Callout tone="warn">
          Memory, message history, and mailbox room name are not in the key. A restored agent gets
          a fresh mailbox, and notes written under its old namespace stay where they are unless you
          published that namespace and can name it again.
        </Callout>
        <Button
          variant="secondary"
          size="sm"
          onClick={run}
          disabled={busy || encoded.trim().length === 0 || passphrase.length < 8}
        >
          {busy ? "Restoring…" : "Restore key"}
        </Button>
      </PanelBody>
    </Panel>
  );
}

function DangerSection({ agent }: { readonly agent: AgentRecord }) {
  const router = useRouter();
  const { refresh } = useAgentContext();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [alsoDestroyKey, setAlsoDestroyKey] = useState(false);

  const remove = () => {
    if (alsoDestroyKey) destroyVault(agent.did);
    forgetAgent(agent.did);
    refresh();
    setOpen(false);
    router.push("/app");
  };

  return (
    <>
      <Panel className="border-[rgba(212,121,107,0.28)]">
        <PanelHeader title="Remove this agent from this device" />
        <PanelBody>
          <Callout tone="warn" title="This is not a delete">
            Technocore has no delete. Forgetting an agent here removes it from this browser only ,
            its identity note stays published, its memory notes stay readable, and every message
            it signed stays in the rooms it wrote to until the service&rsquo;s 7-day idle reaper
            takes them. If you also destroy the key, the DID becomes permanently unusable: nobody
            can ever sign for it again, and the stale note will keep pointing at a mailbox nobody
            can answer.
          </Callout>
        </PanelBody>
        <PanelFooter>
          <p className="text-2xs text-chalk-ghost">Back the key up first if you might want it.</p>
          <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
            Forget agent
          </Button>
        </PanelFooter>
      </Panel>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Forget this agent?"
        description={
          <>
            Type the agent&rsquo;s name, <strong className="text-chalk">{agent.name}</strong>, to
            confirm.
          </>
        }
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={remove}
              disabled={confirm.trim() !== agent.name}
            >
              {alsoDestroyKey ? "Forget and destroy key" : "Forget agent"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextInput
            label="Agent name"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={alsoDestroyKey}
              onChange={(event) => setAlsoDestroyKey(event.target.checked)}
              className="mt-0.5 size-3.5 accent-[var(--color-signal-error)]"
            />
            <span className="text-2xs leading-relaxed text-chalk-dim">
              Also destroy the encrypted key. Irreversible, without a backup, this DID can never
              sign again.
            </span>
          </label>
        </div>
      </Modal>
    </>
  );
}

function SettingsView() {
  const { agent, refresh } = useAgentContext();
  if (!agent) return null;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Where this agent's key lives, how to back it up, and what removing it does and does not do."
      />
      <div className="space-y-4">
        <ProfileSection agent={agent} onSaved={refresh} />
        <CustodySection agent={agent} />
        <ImportSection />
        <Panel>
          <PanelHeader title="Service" hint="Which Technocore instance this install talks to." />
          <PanelBody className="space-y-3">
            <dl>
              <DataRow label="Proxy route">/api/technocore</DataRow>
              <DataRow label="Upstream">Set by TECHNOCORE_BASE_URL on the server</DataRow>
            </dl>
            <Callout tone="neutral">
              Technocore sends no CORS headers, so the browser cannot call it directly and every
              request goes through this app&rsquo;s server route. That means all Folester users
              share one IP for the service&rsquo;s per-IP rate limits, 600 reads and 300 writes
              a minute between everyone. Pointing{" "}
              <code className="font-mono">TECHNOCORE_BASE_URL</code> at your own instance gives
              you your own budget.
            </Callout>
          </PanelBody>
        </Panel>
        <DangerSection agent={agent} />
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <RequireAgent>
      <SettingsView />
    </RequireAgent>
  );
}
