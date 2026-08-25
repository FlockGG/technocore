"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getActiveAgentDid,
  listAgents,
  setActiveAgent,
  subscribeAgents,
  type AgentRecord,
} from "@/lib/agent";
import { getUnlocked, hasVault, lock, unlockVault } from "@/lib/identity/vault";
import type { SecretIdentity } from "@/lib/identity/keys";
import { connect } from "@/lib/technocore";
import type { ConnectionState } from "@/lib/technocore/types";

/**
 * The app's shared state: which agents exist on this device, which one is active,
 * whether its key is currently unlocked, and whether Technocore is reachable.
 *
 * The unlocked key is deliberately not stored in React state. It is read from the
 * vault module on demand through `identity()`, so a secret never sits in a component
 * tree, a devtools snapshot, or a serialised state dump. What lives in state is the
 * boolean `unlocked`, enough to render, useless if leaked.
 */
interface AgentContextValue {
  readonly ready: boolean;
  readonly agents: readonly AgentRecord[];
  readonly agent: AgentRecord | null;
  readonly select: (did: string) => void;
  readonly refresh: () => void;

  readonly unlocked: boolean;
  readonly hasKey: boolean;
  /** Returns the in-memory key, or null when locked. Never held in state. */
  readonly identity: () => SecretIdentity | null;
  readonly unlock: (passphrase: string) => Promise<{ ok: boolean; error: string | null }>;
  readonly lockNow: () => void;

  readonly connection: ConnectionState;
  readonly reconnect: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { readonly children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [agents, setAgents] = useState<readonly AgentRecord[]>([]);
  const [activeDid, setActiveDid] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>({ status: "idle" });

  const reload = useCallback(() => {
    const next = listAgents();
    const did = getActiveAgentDid();
    setAgents(next);
    setActiveDid(did);
    setUnlocked(did ? getUnlocked(did) !== null : false);
  }, []);

  // Everything here reads localStorage, so it must not run during SSR. `ready`
  // gates the tree on the first client pass to keep hydration honest.
  useEffect(() => {
    reload();
    setReady(true);
    return subscribeAgents(reload);
  }, [reload]);

  const reconnect = useCallback(() => {
    setConnection({ status: "connecting" });
    void connect().then(setConnection);
  }, []);

  useEffect(() => {
    reconnect();
  }, [reconnect]);

  const agent = useMemo(
    () => agents.find((candidate) => candidate.did === activeDid) ?? null,
    [agents, activeDid],
  );

  const value = useMemo<AgentContextValue>(
    () => ({
      ready,
      agents,
      agent,
      select: (did: string) => {
        setActiveAgent(did);
        reload();
      },
      refresh: reload,

      unlocked,
      hasKey: agent ? hasVault(agent.did) : false,
      identity: () => (agent ? getUnlocked(agent.did) : null),
      unlock: async (passphrase: string) => {
        if (!agent) return { ok: false, error: "No agent selected." };
        try {
          await unlockVault(agent.did, passphrase);
          setUnlocked(true);
          return { ok: true, error: null };
        } catch (error) {
          setUnlocked(false);
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
      lockNow: () => {
        if (agent) lock(agent.did);
        setUnlocked(false);
      },

      connection,
      reconnect,
    }),
    [ready, agents, agent, unlocked, connection, reload, reconnect],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgentContext(): AgentContextValue {
  const value = useContext(AgentContext);
  if (!value) throw new Error("useAgentContext must be used inside <AgentProvider>.");
  return value;
}
