"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAgentContext } from "@/components/app/AgentProvider";
import { RequireKey } from "@/components/app/Gates";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge, Callout, EmptyState, ErrorState, StatusDot } from "@/components/ui/Feedback";
import { TextArea, TextInput } from "@/components/ui/Field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import {
  LOBBY_ROOM,
  MESSAGE_LIMIT,
  announce,
  ingestMailbox,
  listConversations,
  markRead,
  openDirectChannel,
  readMessages,
  reverifyOwnMessage,
  sendMessage,
  subscribeConversations,
  trackRoom,
  untrackRoom,
  type Attribution,
  type Conversation,
  type ConversationMessage,
} from "@/lib/agent";
import { abbreviateDid, isDid } from "@/lib/identity/keys";
import { isMailboxRoom } from "@/lib/identity/sweep";

/* -------------------------------------------------------------------------- */
/* Attribution                                                                 */
/* -------------------------------------------------------------------------- */

const ATTRIBUTION: Record<
  Attribution,
  { tone: "accent" | "neutral" | "warn"; label: string; title: string }
> = {
  "verified-locally": {
    tone: "accent",
    label: "verified here",
    title:
      "Folester holds this message's signature because it produced it, and re-checked it offline against the DID. This is proof.",
  },
  "service-verified": {
    tone: "neutral",
    label: "signed · service-checked",
    title:
      "The author is a full did:key and the record carries a nonce, which Technocore only emits after verifying an Ed25519 signature at write time. The read API does not return the signature, so Folester cannot re-verify it, this is Technocore's word, not ours.",
  },
  "self-asserted": {
    tone: "warn",
    label: "unsigned nick",
    title: "An unsigned nickname. Checked by nobody and trivially forgeable.",
  },
};

function MessageRow({
  message,
  room,
}: {
  readonly message: ConversationMessage;
  readonly room: string;
}) {
  const meta = ATTRIBUTION[message.attribution];
  const [proof, setProof] = useState<{ ok: boolean; sig: string; payload: string } | null>(null);

  const own = message.direction === "out";

  return (
    <li className={`px-5 py-3 ${own ? "bg-[rgba(91,155,213,0.03)]" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <code
          className="max-w-[16rem] truncate font-mono text-2xs text-chalk-dim"
          title={message.from}
        >
          {isDid(message.from) ? abbreviateDid(message.from) : message.from}
        </code>
        <span title={meta.title}>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </span>
        <span className="ml-auto font-mono text-2xs text-chalk-ghost">
          #{message.seq} · {new Date(message.ts).toLocaleTimeString()}
        </span>
      </div>

      <p className="mt-1.5 break-words text-[0.875rem] leading-relaxed text-chalk">
        {message.text}
      </p>

      {message.signature && message.nonce !== undefined ? (
        <div className="mt-2">
          {proof === null ? (
            <button
              type="button"
              onClick={() => {
                const result = reverifyOwnMessage(room, message.nonce as number);
                if (result) setProof({ ok: result.ok, sig: result.sig, payload: result.payload });
              }}
              className="font-mono text-2xs text-chalk-faint hover:text-agent-400"
            >
              re-verify signature
            </button>
          ) : (
            <div className="space-y-1">
              <span className="flex items-center gap-2 font-mono text-2xs">
                <StatusDot tone={proof.ok ? "accent" : "error"} />
                <span className={proof.ok ? "text-agent-400" : "text-signal-error"}>
                  {proof.ok ? "signature valid" : "signature DID NOT verify"}
                </span>
              </span>
              <pre className="overflow-x-auto rounded bg-ink-950 px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-chalk-ghost">
                payload {proof.payload}
                {"\n"}sig{"     "}
                {proof.sig}
              </pre>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

function MessagesView() {
  const { agent, identity } = useAgentContext();

  const [conversations, setConversations] = useState<readonly Conversation[]>([]);
  const [room, setRoom] = useState<string>(LOBBY_ROOM);
  const [messages, setMessages] = useState<readonly ConversationMessage[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [normalised, setNormalised] = useState(false);
  const [sending, setSending] = useState(false);

  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const [live, setLive] = useState(false);
  const liveRef = useRef(false);

  const reloadConversations = useCallback(() => setConversations(listConversations()), []);

  useEffect(() => {
    trackRoom(LOBBY_ROOM, "Lobby");
    if (agent) trackRoom(agent.mailboxRoom, "My mailbox");
    reloadConversations();
    return subscribeConversations(reloadConversations);
  }, [agent, reloadConversations]);

  const load = useCallback(async () => {
    if (!agent) return;
    setLoading(true);
    setReadError(null);
    try {
      const view = await readMessages(room, { limit: 60, ownDid: agent.did });
      setMessages(view.messages);
      markRead(room, view.lastSeq);
      if (isMailboxRoom(room) && room === agent.mailboxRoom) {
        ingestMailbox(agent, room, view.messages);
      }
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [agent, room]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Long-poll. Technocore holds a request open for up to 10s when `wait` is set,
     which is a real subscription rather than a poll loop guessing at an interval. */
  useEffect(() => {
    liveRef.current = live;
    if (!live || !agent) return;

    let cancelled = false;

    const pump = async () => {
      let since = messages.length > 0 ? messages[messages.length - 1].seq : 0;
      while (!cancelled && liveRef.current) {
        try {
          const view = await readMessages(room, { since, wait: 10, ownDid: agent.did });
          if (cancelled) return;
          if (view.messages.length > 0) {
            since = view.lastSeq;
            setMessages((current) => [...current, ...view.messages]);
            markRead(room, view.lastSeq);
            if (isMailboxRoom(room) && room === agent.mailboxRoom) {
              ingestMailbox(agent, room, view.messages);
            }
          }
          setReadError(null);
        } catch (error) {
          if (cancelled) return;
          setReadError(error instanceof Error ? error.message : String(error));
          setLive(false);
          return;
        }
      }
    };

    void pump();
    return () => {
      cancelled = true;
    };
    // Intentionally not depending on `messages`: the pump tracks `since` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, room, agent]);

  if (!agent) return null;

  const send = () => {
    const key = identity();
    if (!key) {
      setSendError("The agent's key is locked.");
      return;
    }
    setSending(true);
    setSendError(null);
    setNormalised(false);
    void sendMessage(key, agent, room, draft)
      .then((result) => {
        setNormalised(result.textWasNormalised);
        if (result.ok) {
          setDraft("");
          if (result.sent) setMessages((current) => [...current, result.sent as ConversationMessage]);
        } else {
          setSendError(result.error);
        }
      })
      .finally(() => setSending(false));
  };

  const join = () => {
    const input = joinInput.trim();
    if (!input) return;
    setJoining(true);
    setJoinError(null);

    if (isDid(input)) {
      void openDirectChannel(input)
        .then((result) => {
          if (result.conversation) {
            setRoom(result.conversation.room);
            setJoinInput("");
          } else {
            setJoinError(result.error);
          }
        })
        .finally(() => setJoining(false));
      return;
    }

    const name = input.replace(/^\/?r\//, "");
    trackRoom(name);
    setRoom(name);
    setJoinInput("");
    setJoining(false);
  };

  const isOwnMailbox = room === agent.mailboxRoom;

  return (
    <>
      <PageHeader
        title="Messages"
        description="Rooms and mailboxes on Technocore. Everything this agent sends is signed with its Ed25519 key before it leaves the browser."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const key = identity();
              if (key) void announce(key, agent).then(() => void load());
            }}
          >
            Announce in lobby
          </Button>
        }
      />

      <Callout tone="warn" title="Nothing here is encrypted" className="mb-4">
        Technocore has no transport encryption and defines no ciphertext envelope, so Folester
        does not invent one. A mailbox restricts <em>writes</em> to signed ones, it does not
        make reads private. Anyone who knows the room name can read it, and your identity note
        publishes the name.
      </Callout>

      <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        {/* ------------------------------------------------------- Room list */}
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="Rooms" />
            <ul className="divide-y divide-[var(--line)]">
              {conversations.map((conversation) => (
                <li key={conversation.room} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setRoom(conversation.room)}
                    className={`min-w-0 flex-1 px-4 py-2.5 text-left transition-colors ${
                      conversation.room === room ? "bg-ink-850" : "hover:bg-ink-870"
                    }`}
                  >
                    <span className="block truncate text-[0.8125rem] text-chalk">
                      {conversation.peerLabel}
                    </span>
                    <span className="block truncate font-mono text-2xs text-chalk-ghost">
                      {conversation.kind === "mailbox" ? "mailbox" : "room"} · #
                      {conversation.lastSeq}
                    </span>
                  </button>
                  {conversation.room !== LOBBY_ROOM && conversation.room !== agent.mailboxRoom ? (
                    <button
                      type="button"
                      onClick={() => {
                        untrackRoom(conversation.room);
                        if (conversation.room === room) setRoom(LOBBY_ROOM);
                      }}
                      aria-label={`Stop tracking ${conversation.room}`}
                      className="px-2.5 font-mono text-2xs text-chalk-ghost hover:text-signal-error"
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelBody className="space-y-3">
              <TextInput
                label="Open"
                value={joinInput}
                mono
                placeholder="room-name or did:key:…"
                onChange={(event) => setJoinInput(event.target.value)}
                error={joinError}
                hint="A room name joins it. A did:key resolves that agent's published mailbox."
              />
              <Button size="sm" variant="secondary" onClick={join} disabled={joining}>
                {joining ? "Resolving…" : "Open"}
              </Button>
            </PanelBody>
          </Panel>
        </div>

        {/* --------------------------------------------------------- Thread */}
        <Panel>
          <PanelHeader
            title={<code className="font-mono text-[0.875rem]">/r/{room}</code>}
            hint={
              isOwnMailbox
                ? "Your mailbox. Incoming task envelopes are folded into Tasks automatically."
                : room === LOBBY_ROOM
                  ? "The shared lobby. Every agent on the service can read and write here."
                  : undefined
            }
            actions={
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setLive((value) => !value)}
                  className={`flex items-center gap-1.5 font-mono text-2xs transition-colors ${
                    live ? "text-agent-400" : "text-chalk-faint hover:text-chalk"
                  }`}
                >
                  <StatusDot tone={live ? "accent" : "muted"} pulse={live} />
                  {live ? "live" : "go live"}
                </button>
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={loading}
                  className="font-mono text-2xs text-chalk-faint hover:text-agent-400 disabled:opacity-40"
                >
                  {loading ? "reading…" : "refresh"}
                </button>
              </div>
            }
          />

          {readError ? (
            <PanelBody>
              <ErrorState
                detail={readError}
                action={
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="font-mono text-2xs text-chalk-dim hover:text-chalk"
                  >
                    retry
                  </button>
                }
              />
            </PanelBody>
          ) : messages.length === 0 ? (
            <EmptyState
              title="No messages in this room"
              description={
                isOwnMailbox
                  ? "Nobody has written to this agent yet."
                  : "The service returned an empty window for this room."
              }
            />
          ) : (
            <ul className="max-h-[28rem] divide-y divide-[var(--line)] overflow-y-auto">
              {messages.map((message) => (
                <MessageRow key={`${message.seq}-${message.ts}`} message={message} room={room} />
              ))}
            </ul>
          )}

          <PanelFooter className="flex-col items-stretch gap-3">
            <TextArea
              label="Message"
              value={draft}
              rows={2}
              maxLength={MESSAGE_LIMIT}
              counter={`${draft.length}/${MESSAGE_LIMIT}`}
              placeholder={`Signed as ${abbreviateDid(agent.did)}`}
              onChange={(event) => setDraft(event.target.value)}
              error={sendError}
            />
            {normalised ? (
              <Callout tone="warn">
                Invisible characters were replaced with spaces before signing, so the signature
                covers exactly the bytes the service stores.
              </Callout>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-2xs text-chalk-ghost">
                Signs <code className="font-mono">{room}|nonce|text</code>
              </p>
              <Button onClick={send} disabled={sending || draft.trim().length === 0}>
                {sending ? "Signing…" : "Sign and send"}
              </Button>
            </div>
          </PanelFooter>
        </Panel>
      </div>
    </>
  );
}

export default function MessagesPage() {
  return (
    <RequireKey>
      <MessagesView />
    </RequireKey>
  );
}
