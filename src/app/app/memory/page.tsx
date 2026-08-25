"use client";

import { useCallback, useEffect, useState } from "react";

import { useAgentContext } from "@/components/app/AgentProvider";
import { RequireAgent } from "@/components/app/Gates";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/Copyable";
import { Badge, Callout, EmptyState, ErrorState, StatusDot } from "@/components/ui/Feedback";
import { TextArea, TextInput } from "@/components/ui/Field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import {
  MEMORY_VALUE_LIMIT,
  RESERVED_MEMORY_KEYS,
  SYNC_KEY_LIMIT,
  clearMemory,
  listMemory,
  memoryKeyFrom,
  subscribeMemory,
  syncMemory,
  writeMemory,
  type MemoryEntry,
  type SyncReport,
  type SyncState,
} from "@/lib/agent";

const SYNC_TONE: Record<SyncState, "accent" | "warn" | "error" | "muted"> = {
  synced: "accent",
  local: "warn",
  pending: "muted",
  failed: "error",
};

const SYNC_LABEL: Record<SyncState, string> = {
  synced: "on technocore",
  local: "local only",
  pending: "writing",
  failed: "write failed",
};

function MemoryView() {
  const { agent } = useAgentContext();
  const [entries, setEntries] = useState<readonly MemoryEntry[]>([]);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ key: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(() => {
    if (agent) setEntries(listMemory(agent.did));
  }, [agent]);

  useEffect(() => {
    reload();
    return subscribeMemory(reload);
  }, [reload]);

  if (!agent) return null;

  const derived = memoryKeyFrom(label);
  const targetKey = editing ?? derived.key;
  const reserved = targetKey !== null && RESERVED_MEMORY_KEYS.includes(targetKey);

  const submit = () => {
    if (!targetKey) {
      setError("That label has no valid key form. Use letters, digits, - or _.");
      return;
    }
    if (reserved) {
      setError(`'${targetKey}' is reserved, it holds this agent's published profile.`);
      return;
    }
    setBusy(true);
    setError(null);
    setConflict(null);
    const existing = entries.find((entry) => entry.key === targetKey);
    void writeMemory(agent, targetKey, value, {
      expectedValue: editing && existing ? existing.value : undefined,
    })
      .then((result) => {
        if (result.ok) {
          setLabel("");
          setValue("");
          setEditing(null);
        } else {
          setError(result.error);
          if (result.conflictValue !== null) {
            setConflict({ key: targetKey, value: result.conflictValue });
          }
        }
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const sync = () => {
    setSyncing(true);
    void syncMemory(agent)
      .then(setReport)
      .finally(() => setSyncing(false));
  };

  return (
    <>
      <PageHeader
        title="Memory"
        description="Notes in Technocore's key-value store. They outlive the tab, the session, and this device."
        actions={
          <>
            <Badge tone={agent.memoryScope === "public" ? "muted" : "accent"}>
              {agent.memoryScope === "public" ? "enumerable" : "unlisted"}
            </Badge>
            <Button variant="secondary" size="sm" onClick={sync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync"}
            </Button>
          </>
        }
      />

      <Callout tone="warn" title="Memory here is not private and not permanent" className="mb-4">
        Every namespace on this service is world-readable and world-writable, Folester cannot
        change that, and does not pretend to. Notes are also deleted after 7 days of inactivity
        on the whole namespace. Do not put anything here you would not publish.
      </Callout>

      <Panel className="mb-4">
        <PanelHeader
          title={editing ? `Edit ${editing}` : "Write a note"}
          hint={
            <code className="font-mono">
              /kv/{agent.memoryNamespace}/{targetKey ?? "…"}
            </code>
          }
          actions={
            editing ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setLabel("");
                  setValue("");
                }}
                className="font-mono text-2xs text-chalk-faint hover:text-chalk"
              >
                cancel
              </button>
            ) : null
          }
        />
        <PanelBody className="space-y-4">
          {editing === null ? (
            <TextInput
              label="Key"
              value={label}
              mono
              maxLength={48}
              placeholder="last-run-summary"
              onChange={(event) => setLabel(event.target.value)}
              hint={
                derived.adjusted && derived.key
                  ? `Stored as '${derived.key}', Technocore keys are lowercase letters, digits, - and _.`
                  : "Lowercase letters, digits, - and _. Up to 48 characters."
              }
            />
          ) : null}
          <TextArea
            label="Value"
            value={value}
            rows={5}
            maxLength={MEMORY_VALUE_LIMIT}
            counter={`${value.length}/${MEMORY_VALUE_LIMIT}`}
            placeholder="What this agent should remember."
            onChange={(event) => setValue(event.target.value)}
            hint="Control characters are replaced with spaces before the write, the service stores a single line."
          />
          {error ? <Callout tone="error">{error}</Callout> : null}
          {conflict ? (
            <Callout tone="warn" title="The note changed under you">
              Someone else wrote to <code>{conflict.key}</code> after you read it. The value the
              service currently holds:
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-ink-950 px-2.5 py-2 font-mono text-2xs text-chalk">
                {conflict.value}
              </pre>
            </Callout>
          ) : null}
        </PanelBody>
        <PanelFooter>
          <p className="text-2xs text-chalk-ghost">
            {editing
              ? "Written with compare-and-set, so a concurrent write surfaces as a conflict."
              : "Written unsigned, note namespaces outside room-owners accept no signatures."}
          </p>
          <Button onClick={submit} disabled={busy || value.length === 0 || !targetKey}>
            {busy ? "Writing…" : editing ? "Update note" : "Write note"}
          </Button>
        </PanelFooter>
      </Panel>

      {report ? (
        <Panel className="mb-4">
          <PanelHeader
            title="Sync report"
            actions={
              <button
                type="button"
                onClick={() => setReport(null)}
                className="font-mono text-2xs text-chalk-faint hover:text-chalk"
              >
                dismiss
              </button>
            }
          />
          <PanelBody className="space-y-3">
            {report.error ? <ErrorState detail={report.error} /> : null}
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-2xs text-chalk-dim sm:grid-cols-4">
              <li>read {report.read}</li>
              <li>restored {report.restored}</li>
              <li>updated {report.updated}</li>
              <li>cleared {report.cleared}</li>
            </ul>
            <p className="text-2xs leading-relaxed text-chalk-ghost">
              {report.enumerable
                ? `The service listed ${report.remoteKeys.length} key${report.remoteKeys.length === 1 ? "" : "s"} in this namespace, so notes written on another device were restored here.`
                : "This namespace is unlisted, so the service returns no key list. Only keys already known to this device were re-read, notes written elsewhere cannot be found."}
            </p>
            {report.skipped.length > 0 ? (
              <Callout tone="warn" title={`${report.skipped.length} keys skipped`}>
                A sync reads at most {SYNC_KEY_LIMIT} keys, because the read budget is per-IP and
                shared by everyone using Folester through one proxy. Skipped:{" "}
                <code>{report.skipped.join(", ")}</code>
              </Callout>
            ) : null}
          </PanelBody>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title="Notes"
          hint={`${entries.length} in the local index`}
        />
        {entries.length === 0 ? (
          <EmptyState
            title="No memory yet"
            description="Nothing has been written for this agent. When it has, each note shows whether the service actually holds it."
          />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {entries.map((entry) => (
              <li key={entry.key} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <StatusDot tone={SYNC_TONE[entry.sync]} />
                    <code className="truncate font-mono text-[0.8125rem] text-chalk">
                      {entry.key}
                    </code>
                    <span className="font-mono text-2xs text-chalk-ghost">
                      {SYNC_LABEL[entry.sync]}
                      {entry.bytes !== null ? ` · ${entry.bytes}B` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <CopyButton value={entry.value} />
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(entry.key);
                        setValue(entry.value);
                        setError(null);
                        setConflict(null);
                      }}
                      className="font-mono text-2xs text-chalk-faint hover:text-agent-400"
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void clearMemory(agent, entry.key)}
                      className="font-mono text-2xs text-chalk-faint hover:text-signal-error"
                    >
                      clear
                    </button>
                  </span>
                </div>
                <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-chalk-dim">
                  {entry.value}
                </pre>
                {entry.error ? (
                  <pre className="mt-1.5 whitespace-pre-wrap font-mono text-2xs text-signal-error">
                    {entry.error}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <PanelFooter>
          <p className="text-2xs leading-relaxed text-chalk-ghost">
            &ldquo;Clear&rdquo; overwrites the note with a tombstone, the service has no delete.
            The row leaves this index; the note itself remains until the reaper takes it.
          </p>
        </PanelFooter>
      </Panel>
    </>
  );
}

export default function MemoryPage() {
  return (
    <RequireAgent>
      <MemoryView />
    </RequireAgent>
  );
}
