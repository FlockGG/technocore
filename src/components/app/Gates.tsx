"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { useAgentContext } from "@/components/app/AgentProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, EmptyState, LoadingLines } from "@/components/ui/Feedback";
import { TextInput } from "@/components/ui/Field";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";

/** Holds the tree back until localStorage has been read once on the client. */
export function AppReady({ children }: { readonly children: ReactNode }) {
  const { ready } = useAgentContext();
  if (!ready) {
    return (
      <Panel>
        <PanelBody>
          <LoadingLines rows={3} />
        </PanelBody>
      </Panel>
    );
  }
  return <>{children}</>;
}

/** Pages that operate on an agent. Without one, the honest screen is the empty one. */
export function RequireAgent({ children }: { readonly children: ReactNode }) {
  const { ready, agent } = useAgentContext();
  if (!ready) return <AppReady>{children}</AppReady>;
  if (!agent) {
    return (
      <Panel>
        <PanelBody className="p-0">
          <EmptyState
            title="No agent on this device"
            description="An agent is an Ed25519 keypair plus the addresses derived from it. Creating one takes a few seconds and never leaves your browser."
            action={<ButtonLink href="/app/create">Create an agent</ButtonLink>}
          />
        </PanelBody>
      </Panel>
    );
  }
  return <>{children}</>;
}

/**
 * The unlock form.
 *
 * The passphrase is held in local component state only for as long as it takes to
 * derive the key, and is cleared on success. Nothing here is logged, and the field
 * is a real password input so browsers treat it as one.
 */
export function UnlockPanel() {
  const { agent, unlock, hasKey } = useAgentContext();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!agent) return null;

  if (!hasKey) {
    return (
      <Panel>
        <PanelHeader title="No key on this device" />
        <PanelBody className="space-y-4">
          <Callout tone="error" title="This agent's private key is not here">
            The agent record exists locally but its encrypted key does not, most likely it
            was created in another browser, or the vault was destroyed. Folester cannot sign
            for it. Restore the key from a backup in{" "}
            <Link href="/app/settings">Settings</Link>, or create a new agent.
          </Callout>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="Unlock this agent"
        hint="The key is decrypted in this tab's memory. It is never sent anywhere."
      />
      <PanelBody>
        <form
          className="max-w-sm space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void unlock(passphrase).then((result) => {
              setBusy(false);
              if (result.ok) setPassphrase("");
              else setError(result.error);
            });
          }}
        >
          <TextInput
            label="Passphrase"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            error={error}
            hint="Key derivation runs 600,000 PBKDF2 rounds, so this takes a moment."
          />
          <Button type="submit" disabled={busy || passphrase.length === 0}>
            {busy ? "Deriving key…" : "Unlock"}
          </Button>
        </form>
      </PanelBody>
    </Panel>
  );
}

/** Wraps anything that needs to sign. Signing without the key is not possible. */
export function RequireKey({ children }: { readonly children: ReactNode }) {
  const { unlocked } = useAgentContext();
  return (
    <RequireAgent>
      {unlocked ? <>{children}</> : <UnlockPanel />}
    </RequireAgent>
  );
}
