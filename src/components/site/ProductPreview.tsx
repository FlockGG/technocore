import { FolesterMark } from "@/components/brand/FolesterMark";
import { Badge, EmptyState, StatusDot } from "@/components/ui/Feedback";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";

const SIDEBAR: readonly { readonly label: string; readonly active?: boolean }[] = [
  { label: "Overview", active: true },
  { label: "Identity" },
  { label: "Memory" },
  { label: "Messages" },
  { label: "Network" },
  { label: "Tasks" },
  { label: "Activity" },
];

/**
 * A framed view of the real app chrome.
 *
 * The components are the ones the app itself uses, and the state shown is the state
 * a new device is genuinely in: no agent, so no numbers. Populating it with an
 * invented agent would make the first real screen a disappointment and every figure
 * elsewhere on this page suspect.
 */
export function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line-strong)] bg-ink-900">
      {/* Window chrome */}
      <div className="flex items-center gap-3 border-b border-[var(--line)] bg-ink-870 px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2 rounded-full bg-ink-700" />
          <span className="size-2 rounded-full bg-ink-700" />
          <span className="size-2 rounded-full bg-ink-700" />
        </div>
        <code className="ml-1 truncate font-mono text-2xs text-chalk-ghost">folester.app/app</code>
      </div>

      <div className="flex min-h-[26rem]">
        {/* Sidebar */}
        <aside className="hidden w-48 shrink-0 border-r border-[var(--line)] p-3 sm:block">
          <div className="mb-4 flex items-center gap-2 px-1.5">
            <FolesterMark size={15} className="text-agent-500" />
            <span className="text-2xs tracking-[0.14em] text-chalk-dim uppercase">Folester</span>
          </div>
          <nav className="space-y-0.5" aria-hidden>
            {SIDEBAR.map((item) => (
              <div
                key={item.label}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-[0.8125rem] ${
                  item.active ? "bg-ink-850 text-chalk" : "text-chalk-faint"
                }`}
              >
                {item.active ? (
                  <span className="h-3 w-px bg-agent-500" />
                ) : (
                  <span className="h-3 w-px" />
                )}
                {item.label}
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.9375rem] font-medium text-chalk">Overview</p>
              <p className="text-2xs text-chalk-faint">No agent on this device</p>
            </div>
            <span className="flex items-center gap-2 rounded border border-[var(--line-strong)] px-2 py-1">
              <StatusDot tone="muted" />
              <span className="font-mono text-2xs text-chalk-faint">technocore idle</span>
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {["Signed messages", "Memory notes", "Tasks"].map((label) => (
              <div
                key={label}
                className="rounded-lg border border-[var(--line)] bg-ink-870 px-4 py-3.5"
              >
                <p className="label-micro">{label}</p>
                <p className="mt-1.5 font-mono text-lg text-chalk-ghost">0</p>
              </div>
            ))}
          </div>

          <Panel>
            <PanelHeader
              title="Identity"
              actions={<Badge tone="muted">not created</Badge>}
            />
            <PanelBody className="p-0">
              <EmptyState
                title="No agent identity yet"
                description="Creating one generates an Ed25519 keypair in your browser and encrypts it under a passphrase you choose."
              />
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
