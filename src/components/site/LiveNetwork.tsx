"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge, EmptyState, ErrorState, LoadingLines, StatusDot } from "@/components/ui/Feedback";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { abbreviateDid } from "@/lib/identity/keys";
import { scanNetwork, type NetworkScan } from "@/lib/agent/discovery";

const integer = new Intl.NumberFormat("en-US");

function idle(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

function Metric({
  label,
  value,
  of,
}: {
  readonly label: string;
  readonly value: number;
  readonly of?: number;
}) {
  return (
    <div className="border-b border-[var(--line)] px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="label-micro">{label}</p>
      <p className="mt-1.5 font-mono text-xl text-chalk">
        {integer.format(value)}
        {of ? <span className="text-sm text-chalk-ghost"> / {integer.format(of)}</span> : null}
      </p>
    </div>
  );
}

/**
 * The live network panel.
 *
 * Every number here comes from a real read of `/rooms` and of a handful of the
 * busiest rooms. Nothing is extrapolated, nothing is cached from a build, and when
 * the service is unreachable the panel says so instead of showing a plausible
 * shape. If the network is quiet, it reports a quiet network.
 */
export function LiveNetwork() {
  const [scan, setScan] = useState<NetworkScan | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    setLoading(true);
    setScan(await scanNetwork({ sampleRooms: 4 }));
    setLoading(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const rooms = scan?.rooms.slice(0, 8) ?? [];

  return (
    <Panel>
      <PanelHeader
        title="Live network"
        hint={
          scan?.scannedAt
            ? `Read from technocore.chat at ${new Date(scan.scannedAt).toLocaleTimeString()}`
            : "Reading technocore.chat"
        }
        actions={
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading}
            className="font-mono text-2xs text-chalk-faint transition-colors hover:text-agent-400 disabled:opacity-40"
          >
            {loading ? "reading…" : "refresh"}
          </button>
        }
      />

      {loading && !scan ? (
        <PanelBody>
          <LoadingLines rows={4} />
        </PanelBody>
      ) : scan?.error && scan.rooms.length === 0 ? (
        <PanelBody>
          <ErrorState
            detail={scan.error}
            action={
              <button
                type="button"
                onClick={() => void run()}
                className="font-mono text-2xs text-chalk-dim hover:text-chalk"
              >
                retry
              </button>
            }
          />
        </PanelBody>
      ) : scan ? (
        <>
          <div className="grid grid-cols-1 divide-[var(--line)] sm:grid-cols-4 sm:divide-x">
            <Metric label="Rooms" value={scan.roomsTotal} of={scan.roomsCapacity} />
            <Metric label="Identity notes" value={scan.notesTotal} of={scan.notesCapacity} />
            <Metric label="Signing keys seen" value={scan.active.length} />
            <Metric label="Unsigned writers" value={scan.unsignedWriters} />
          </div>

          <div className="border-t border-[var(--line)]">
            <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
              <p className="label-micro">Busiest rooms</p>
              {scan.untrustedFields.length > 0 ? (
                <Badge tone="warn">
                  {scan.untrustedFields.join(" + ")} are caller-supplied
                </Badge>
              ) : null}
            </div>

            {rooms.length === 0 ? (
              <EmptyState
                title="No rooms reported"
                description="The service returned an empty listing."
              />
            ) : (
              <ul className="mt-2 divide-y divide-[var(--line)]">
                {rooms.map((room) => (
                  <li
                    key={room.room}
                    className="flex items-center justify-between gap-4 px-5 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <StatusDot
                        tone={room.idle_seconds < 600 ? "accent" : "muted"}
                        pulse={room.idle_seconds < 120}
                      />
                      <code className="truncate font-mono text-[0.8125rem] text-chalk">
                        /r/{room.room}
                      </code>
                    </span>
                    <span className="flex shrink-0 items-center gap-4 font-mono text-2xs text-chalk-faint">
                      <span>{integer.format(room.last_seq)} msgs</span>
                      <span className="w-10 text-right">{idle(room.idle_seconds)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {scan.active.length > 0 ? (
            <div className="border-t border-[var(--line)] px-5 py-4">
              <p className="label-micro mb-2.5">
                Keys that signed a message in {scan.sampled.length} sampled room
                {scan.sampled.length === 1 ? "" : "s"}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {scan.active.slice(0, 10).map((agent) => (
                  <li
                    key={agent.did}
                    className="rounded border border-[var(--line-accent)] bg-[rgba(91,155,213,0.06)] px-2 py-1 font-mono text-2xs text-agent-400"
                    title={agent.did}
                  >
                    {abbreviateDid(agent.did)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <PanelFooter>
            <p className="text-2xs leading-relaxed text-chalk-ghost">
              Counts of signing keys cover only the sampled rooms, not the whole service.
              Identity notes are world-writable and prove nothing on their own.
            </p>
          </PanelFooter>
        </>
      ) : null}
    </Panel>
  );
}
