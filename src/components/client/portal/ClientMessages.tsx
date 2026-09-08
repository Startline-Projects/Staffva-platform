"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The client's messages view (Atlas step 9) — the mirror of the candidate's
 * AtlasMessages, in the same extracted `.msg-*` markup.
 *
 * Realtime: a postgres_changes subscription on `messages` filtered to this
 * client. Events trigger REFETCHES through the existing APIs rather than
 * trusting the payload — the API is where names get contact-masked and
 * read_at is stamped, and a second rendering path is a second place for those
 * rules to rot. A 60s poll stays underneath for a dropped socket, paused
 * while the tab is hidden. The client side previously polled every 30s with
 * no socket at all, so the two halves of the same conversation updated at
 * different speeds.
 *
 * Deliberately NOT built, matching the candidate side's decisions:
 *  - READ RECEIPTS. read_at is stamped by loading a thread, so it means "a
 *    page was opened", not "a person read this". Atlas prints "Read" under
 *    every outgoing bubble unconditionally; showing it from this column would
 *    be the same claim with a database behind it and no more truth in it.
 *  - PRESENCE ("Active 1 hr ago", live dots). Nothing tracks presence.
 *  - The attach and emoji buttons: decorative in the prototype, and real
 *    attachments are an owner decision — storage, retention, and a
 *    contact-leak channel the write-side filter cannot read.
 *  - An Archived filter. There is no thread entity to archive against
 *    (thread_id is a text column on messages), so it would need a new table;
 *    worth doing when a client has enough threads to want it.
 *  - Atlas's inline proposal/interview/video cards. They are inert there, and
 *    faking a message that was never sent is worse than linking to the real
 *    thing — the header does that instead.
 *  - The pinned "Alex (Atlas Specialist)" conversation, per the owner's D5,
 *    the same cut the rail records for its specialist row.
 *  - The composer quick-action row (Schedule interview / Send proposal /
 *    Share availability). The first two are header links instead; the third
 *    has no home anywhere in the product, so it is not drawn.
 *  - The `+` new-chat button: handler-less in Atlas, and a client starts a
 *    conversation from a candidate's profile.
 *  - Country flags, the per-conversation role line, and the candidate's rate
 *    in the chat header. All are real columns; they are omitted to keep the
 *    list scannable, and the profile is one click away. Not for want of data.
 *
 * The composer is NOT verification-gated. Atlas locks "Send proposal" behind
 * identity checks; the owner's D1 gates escrow funding only.
 */

interface Thread {
  thread_id: string;
  other_party_name: string;
  other_party_id: string;
  unread_count: number;
  latest_message: { body: string; created_at: string; sender_type: string };
}

interface Message {
  id: string;
  body: string;
  sender_type: string;
  created_at: string;
}

type Filter = "all" | "unread";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function timeShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function groupByDay<T extends { created_at: string }>(items: T[]) {
  const out: { day: string; items: T[] }[] = [];
  for (const it of items) {
    const d = new Date(it.created_at);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    // The year is carried outside the current one. Without it a message from
    // last September is indistinguishable from this one — and two such labels
    // collide as React keys, because the key IS the label.
    const sameYear = d.getFullYear() === today.getFullYear();
    const opts: Intl.DateTimeFormatOptions = sameYear
      ? { weekday: "long", month: "long", day: "numeric" }
      : { weekday: "long", month: "long", day: "numeric", year: "numeric" };
    const day = isToday
      ? `Today · ${d.toLocaleDateString("en-US", opts)}`
      : d.toLocaleDateString("en-US", opts);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, items: [it] });
  }
  return out;
}

export default function ClientMessages({ clientId }: { clientId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkCandidate = searchParams.get("candidate");

  const [threads, setThreads] = useState<Thread[]>([]);
  const [listState, setListState] = useState<"loading" | "ok" | "failed">("loading");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [candidateName, setCandidateName] = useState("");
  const [contractExecutedAt, setContractExecutedAt] = useState<string | null>(null);
  // Whether the profile/booking/offer surfaces will actually open for this
  // candidate. Messaging outlives approval; those pages do not.
  const [candidateReachable, setCandidateReachable] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Mirrors activeThreadId for the realtime callback, which is registered once
  // and would otherwise close over the value at subscribe time.
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    activeRef.current = activeThreadId;
  }, [activeThreadId]);

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/messages");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setThreads(data.threads || []);
      setListState("ok");
    } catch {
      // "Failed" is not "empty": telling a client they have no conversations
      // because a fetch died is the wrong sentence entirely. And a list that
      // HAS loaded is not downgraded by a transient poll failure.
      setListState((prev) => (prev === "ok" ? "ok" : "failed"));
    }
  }, []);

  const loadThread = useCallback(async (threadId: string) => {
    // Commit-only-if-still-active. A slow fetch for thread A resolving after
    // the client opened thread B must not paint A's messages, name and
    // contract banner over B — the composer sends to B, so they would be
    // replying to what they read in A's conversation. The guard runs on
    // EVERY setState below, the failure banner included.
    const stillActive = () => activeRef.current === threadId;
    try {
      const res = await fetch(`/api/messages/thread?threadId=${encodeURIComponent(threadId)}`);
      if (!stillActive()) return;
      if (!res.ok) {
        setLoadFailed(true);
        return;
      }
      const data = await res.json();
      if (!stillActive()) return;
      setLoadFailed(false);
      setMessages(data.messages || []);
      setCandidateName(data.candidateName || "");
      setContractExecutedAt(data.contractExecutedAt ?? null);
      setCandidateReachable(data.candidateReachable !== false);
    } catch {
      // A failed refresh must not blank history already on screen.
      if (stillActive()) setLoadFailed(true);
    } finally {
      if (stillActive()) setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  /**
   * Opening a thread. Everything belonging to the previous one is cleared
   * FIRST, because none of it is true about the new thread:
   *  - messages, or the old history renders under the new name while the
   *    fetch is in flight (and stays there forever if it fails);
   *  - contractExecutedAt, which would otherwise tell a client they have an
   *    executed contract with someone they don't — an invitation to type a
   *    phone number the message filter will then reject;
   *  - the draft and the send error, or a message written to A leaves with
   *    one Enter press aimed at B, under A's rejection notice.
   */
  const openThread = useCallback(
    (threadId: string) => {
      setSendError(null);
      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setMessages([]);
      setCandidateName("");
      setContractExecutedAt(null);
      setCandidateReachable(true);
      setLoadFailed(false);
      setThreadLoading(true);
      setActiveThreadId(threadId);
      activeRef.current = threadId;
      loadThread(threadId);
      // Opening stamps read_at server-side, so clear the row badge now — a
      // "2" beside the conversation being read is a lie — and reconcile the
      // rail/topbar badges, which the layout rendered and soft nav never
      // re-runs.
      setThreads((prev) =>
        prev.map((t) => (t.thread_id === threadId ? { ...t, unread_count: 0 } : t))
      );
      setTimeout(() => router.refresh(), 1200);
    },
    [loadThread, router]
  );

  // The deep link picks the STARTING thread, once. Re-applying it on every
  // load pinned the inbox: clicking another conversation snapped back.
  const pickedRef = useRef(false);
  useEffect(() => {
    if (pickedRef.current || listState !== "ok") return;
    pickedRef.current = true;
    // Shape-checked: ?candidate=foo would build "<uuid>:foo", which the thread
    // route rejects with a 22P02 — leaving the client stranded on a dead
    // thread with their real conversations never opened, because this
    // one-shot had already been spent. A value containing a colon is worse
    // than useless: split(":")[1] here and the route's parse disagree about
    // which candidate it names.
    if (deepLinkCandidate && UUID_RE.test(deepLinkCandidate)) {
      openThread(`${clientId}:${deepLinkCandidate}`);
      return;
    }
    if (threads.length > 0) openThread(threads[0].thread_id);
  }, [listState, threads, deepLinkCandidate, clientId, openThread]);

  // Realtime, with a poll underneath.
  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      // The list fetch stamps nothing, so it always runs. The THREAD fetch
      // stamps read_at, so a hidden tab must not trigger it — marking
      // messages read that nobody saw would make an already over-claiming
      // column into a lie.
      loadThreads();
      if (document.visibilityState === "hidden") return;
      const a = activeRef.current;
      if (a) loadThread(a);
    };
    const channel = supabase
      .channel(`client-messages-${clientId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `client_id=eq.${clientId}` },
        refresh
      )
      .subscribe();

    let poll: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!poll) poll = setInterval(refresh, 60_000);
    };
    const stop = () => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };
    // Cleared while hidden rather than left ticking as a no-op, and refreshed
    // on RETURN — otherwise a client coming back to the tab reads up to a
    // minute of stale thread with no socket having fired meanwhile.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      supabase.removeChannel(channel);
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clientId, loadThreads, loadThread]);

  // Keyed on the COUNT, not the array: loadThread always sets a fresh
  // reference, so depending on `messages` yanked the client to the bottom on
  // every 60s poll and every realtime event, mid-read.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeThreadId]);

  function autogrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending || !activeThreadId) return;
    const candidateId = activeThreadId.split(":")[1];
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, clientId, body }),
      });
      if (!res.ok) {
        // The refusal has to reach the person: the contact filter returns a
        // real explanation, and swallowing it turns a rule into a broken
        // button.
        const j = await res.json().catch(() => ({}));
        setSendError(j.error || "Your message didn't send. Try again.");
        return;
      }
      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      // loadThread no-ops if the thread changed while this was in flight.
      await Promise.all([loadThread(activeThreadId), loadThreads()]);
    } catch {
      setSendError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  // Threads, not messages: the pill labels a filter that selects CONVERSATIONS,
  // so summing unread messages made "5" sit beside a filter producing one row.
  const unreadThreads = threads.filter((t) => t.unread_count > 0).length;

  const shownThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads.filter((t) => {
      if (filter === "unread" && t.unread_count === 0) return false;
      if (!q) return true;
      return (
        t.other_party_name.toLowerCase().includes(q) ||
        t.latest_message.body.toLowerCase().includes(q)
      );
    });
  }, [threads, search, filter]);

  const activeThread = threads.find((t) => t.thread_id === activeThreadId) || null;
  const activeCandidateId = activeThreadId ? activeThreadId.split(":")[1] : "";
  const listEmpty = shownThreads.length === 0;

  return (
    <section className="live-messages-view">
      <aside className={`msg-conversations${activeThreadId ? " hidden-mobile" : ""}`}>
        <div className="msg-conv-header">
          <h2>Messages</h2>
        </div>
        <div className="msg-conv-search">
          <svg className="msg-conv-search-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" />
            <path d="m9 9 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            className="msg-conv-search-input"
            placeholder="Search conversations"
            aria-label="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="msg-conv-filters" role="tablist">
          {([["all", "All"], ["unread", "Unread"]] as Array<[Filter, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`msg-conv-filter-pill${filter === key ? " active" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
              {key === "unread" && unreadThreads > 0 && <span className="count">{unreadThreads}</span>}
            </button>
          ))}
        </div>
        <div className="msg-conv-list">
          {shownThreads.map((t) => (
            <button
              key={t.thread_id}
              type="button"
              className={`msg-conv-item${t.thread_id === activeThreadId ? " active" : ""}${t.unread_count > 0 ? " unread" : ""}`}
              onClick={() => openThread(t.thread_id)}
            >
              <div className="msg-conv-avatar" aria-hidden>
                {t.other_party_name.charAt(0).toUpperCase()}
              </div>
              <div className="msg-conv-body">
                <div className="msg-conv-toprow">
                  <span className="msg-conv-name">{t.other_party_name}</span>
                  <span className="msg-conv-time">{timeShort(t.latest_message.created_at)}</span>
                </div>
                <div className="msg-conv-preview">
                  {t.latest_message.sender_type === "client" ? "You: " : ""}
                  {t.latest_message.body}
                </div>
                {t.unread_count > 0 && (
                  <div className="msg-conv-meta-row">
                    <span className="msg-conv-unread">{t.unread_count}</span>
                  </div>
                )}
              </div>
            </button>
          ))}
          {listEmpty && (
            <p
              style={{ padding: "22px 18px", fontSize: 13, color: "var(--ink-mute)" }}
              role={listState === "failed" ? "alert" : undefined}
            >
              {listState === "failed"
                ? "Your conversations couldn't load. Check your connection and reload — this list may not be empty."
                : listState === "loading"
                  ? "Loading conversations…"
                  : threads.length === 0
                    ? "No conversations yet. Message anyone from their profile and the thread lands here."
                    : "Nothing here under this filter."}
            </p>
          )}
        </div>
      </aside>

      <main className={`msg-chat${activeThreadId ? "" : " hidden-mobile"}`}>
        {!activeThreadId ? (
          <div className="msg-chat-empty">
            <p>Pick a conversation on the left.</p>
          </div>
        ) : (
          <>
            <header className="msg-chat-header">
              <button
                type="button"
                className="msg-chat-back"
                aria-label="Back to conversations"
                onClick={() => {
                  setActiveThreadId(null);
                  activeRef.current = null;
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M9 2 4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div className="msg-chat-header-avatar" aria-hidden>
                {(activeThread?.other_party_name || candidateName || "?").charAt(0).toUpperCase()}
              </div>
              <div className="msg-chat-header-meta">
                <div className="msg-chat-header-name">
                  {activeThread?.other_party_name || candidateName || "Candidate"}
                </div>
                {/* Atlas puts "Active 1 hr ago · $8/hr" here. Nothing tracks
                    presence, so this carries the one per-thread fact we do
                    hold — and the one that changes what may be typed below.
                    The first draft put a constant here ("Messages are kept on
                    StaffVA"), which is a custody claim with no policy behind
                    it and identical on every thread. */}
                <div className="msg-chat-header-status">
                  {contractExecutedAt
                    ? "Contract in place — contact details can be shared"
                    : "Contact details unlock once both sides sign"}
                </div>
              </div>
              {activeCandidateId && (
                <div className="msg-chat-header-actions">
                  {candidateReachable ? (
                    <>
                      <Link href={`/candidate/${activeCandidateId}`} className="btn btn-outline">Profile</Link>
                      {/* Neither is verification-locked: D1 gates escrow
                          funding only. Atlas padlocks the proposal button. */}
                      <Link href={`/candidate/${activeCandidateId}#schedule`} className="btn btn-outline">Schedule</Link>
                      <Link href={`/hire/${activeCandidateId}/offer`} className="btn btn-outline">Send proposal</Link>
                    </>
                  ) : (
                    // Say why rather than draw three buttons that all land on
                    // "Profile Not Found". The conversation stays open on
                    // purpose; the rest of the product does not.
                    <span className="msg-chat-header-note">
                      Not currently listed — you can still talk here
                    </span>
                  )}
                </div>
              )}
            </header>

            <div className="msg-chat-thread">
              {threadLoading && messages.length === 0 ? (
                <p style={{ padding: 20, fontSize: 13, color: "var(--ink-mute)" }}>Loading…</p>
              ) : messages.length === 0 ? (
                <p style={{ padding: 20, fontSize: 13, color: "var(--ink-mute)" }}>
                  {/* No "everything else is fair game": the filter refuses
                      emails, phone numbers and messaging handles, and the
                      unlock is a FULLY EXECUTED contract — one signature is
                      not enough. Promising more than that put the refusal a
                      client's first sentence away. */}
                  Start the conversation. Email addresses, phone numbers and messaging handles are
                  held back until both sides have signed a contract.
                </p>
              ) : (
                groupByDay(
                  [
                    ...messages.map((m) => ({ ...m, _kind: "msg" as const })),
                    ...(contractExecutedAt
                      ? [{
                          id: "system-contract",
                          body: "",
                          sender_type: "system",
                          created_at: contractExecutedAt,
                          _kind: "system" as const,
                        }]
                      : []),
                  ].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
                ).map((group) => (
                  <div key={group.day} style={{ display: "contents" }}>
                    <div className="msg-day-divider">{group.day}</div>
                    {group.items.map((m) =>
                      m._kind === "system" ? (
                        <div className="msg-system" key={m.id}>
                          <div className="system-icon" aria-hidden>
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M2.5 7l3 3 5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                          <div>
                            You and <strong>{candidateName || "this candidate"}</strong> have a fully
                            executed contract. Contact details can now be shared in this conversation.
                          </div>
                          <div className="system-time">{clockTime(m.created_at)}</div>
                        </div>
                      ) : (
                        <div
                          className={`msg-bubble ${m.sender_type === "client" ? "from-me" : "from-them"}`}
                          key={m.id}
                        >
                          <div className="bubble-content">{m.body}</div>
                          <div className="bubble-time">
                            {m.sender_type === "client" ? "You" : candidateName || "Candidate"} ·{" "}
                            {clockTime(m.created_at)}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {loadFailed && (
              <p role="alert" style={{ padding: "6px 20px", fontSize: 12, color: "var(--danger, #C2412B)" }}>
                Couldn&apos;t refresh this conversation — what you see may be behind.
              </p>
            )}
            {sendError && (
              <p role="alert" style={{ padding: "6px 20px", fontSize: 12, color: "var(--danger, #C2412B)" }}>
                {sendError}
              </p>
            )}

            <div className="msg-composer">
              <textarea
                ref={textareaRef}
                rows={1}
                placeholder={`Message ${candidateName || activeThread?.other_party_name || "this candidate"}…`}
                aria-label="Message"
                value={draft}
                maxLength={4000}
                onChange={(e) => {
                  setDraft(e.target.value);
                  autogrow();
                }}
                onKeyDown={(e) => {
                  // Desktop convention only. On touch keyboards Enter is how
                  // people write paragraphs — hijacking it fires half-typed
                  // messages; the send button is the mobile path.
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !window.matchMedia("(pointer: coarse)").matches
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button
                type="button"
                className="msg-composer-send"
                aria-label="Send message"
                disabled={!draft.trim() || sending}
                onClick={send}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M13 1 6.5 7.5M13 1 8.8 13l-2.3-5.5L1 5.2 13 1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </>
        )}
      </main>
    </section>
  );
}
