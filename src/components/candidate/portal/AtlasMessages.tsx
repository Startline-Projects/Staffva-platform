"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ThreadMessage } from "@/lib/recruiterThread";

/**
 * The Atlas messages view (4.18): one conversation list — the assigned
 * specialist plus every client thread — with filters, search, day dividers,
 * bubbles, and system cards, in the prototype's own markup (.msg-* classes
 * extracted to atlas-live.css).
 *
 * Realtime: a postgres_changes subscription on both message tables, filtered
 * to this candidate — RLS decides row by row whether the subscriber may see
 * it, exactly as it does for a SELECT. Events trigger REFETCHES through the
 * existing APIs rather than trusting the payload: the API is where names are
 * contact-masked and read_at gets stamped, and a second rendering path is a
 * second place for those rules to rot. A 60s poll stays underneath as the
 * fallback for a dropped socket, paused while the tab is hidden.
 *
 * Two things the prototype has that this deliberately does not:
 *  - the composer paperclip: it has NO handler in Atlas — a decorative
 *    button. A control that does nothing is a promise, so it's omitted, and
 *    real attachments are an owner decision (storage, retention, and a
 *    contact-leak channel the write-side filter can't read).
 *  - read receipts ("Seen"): read_at means "a page was loaded", not "a
 *    person read this" — five of the nine candidates waiting on a specialist
 *    reply are marked read and were never answered.
 */

interface ClientThreadRow {
  thread_id: string;
  other_party_name: string;
  other_party_id: string;
  unread_count: number;
  latest_message: { body: string; created_at: string; sender_type: string };
}

interface ClientMessage {
  id: string;
  body: string;
  sender_type: string;
  created_at: string;
}

type Filter = "all" | "unread" | "clients" | "specialist";

type ActiveConv = { type: "client"; threadId: string } | { type: "specialist" } | null;

function timeShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  // Year included outside the current year: "Mon, Apr 14" is ambiguous on a
  // thread going back to April, and duplicate labels would double as
  // duplicate React keys.
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { weekday: "short", month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString("en-US", opts);
}

/** Render a flat message list as day-divided groups. */
function groupByDay<T extends { created_at: string }>(items: T[]): Array<{ day: string; items: T[] }> {
  const groups: Array<{ day: string; items: T[] }> = [];
  for (const item of items) {
    const day = dayLabel(item.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

export default function AtlasMessages({
  candidateId,
  specialist,
  specialistMessages,
  specialistUnread,
  awaitingReply,
}: {
  candidateId: string;
  specialist: { assigneeId: string; assigneeName: string | null } | null;
  specialistMessages: ThreadMessage[];
  /** Counted server-side — ThreadMessage doesn't carry read_at. */
  specialistUnread: number;
  awaitingReply: boolean;
}) {
  const router = useRouter();
  const [threads, setThreads] = useState<ClientThreadRow[]>([]);
  const [active, setActive] = useState<ActiveConv>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  // Active client-thread state
  const [clientMessages, setClientMessages] = useState<ClientMessage[]>([]);
  const [clientName, setClientName] = useState("");
  const [contractExecutedAt, setContractExecutedAt] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);

  // Specialist thread state (server-seeded)
  const [specMessages, setSpecMessages] = useState<ThreadMessage[]>(specialistMessages);
  const [specUnread, setSpecUnread] = useState(specialistUnread);
  // Realtime-only preview override for the CLOSED specialist row (opening the
  // thread refetches and clears it).
  const [specPreview, setSpecPreview] = useState<{ body: string; at: string } | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Separate from loadFailed (which belongs to the OPEN thread): a failed
  // LIST fetch must never render as the authoritative "no conversations yet"
  // — that is the absence-vs-failure confusion the whole platform audit was
  // about, in the one place a candidate's client relationships are listed.
  const [listState, setListState] = useState<"loading" | "ok" | "failed">("loading");

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef<ActiveConv>(null);
  activeRef.current = active;

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/messages");
      if (!res.ok) {
        setListState((prev) => (prev === "ok" ? "ok" : "failed"));
        return;
      }
      const data = await res.json();
      setThreads(data.threads || []);
      setListState("ok");
    } catch {
      // The list keeps its last GOOD state; only a never-loaded list shows
      // the failure line instead of a confident empty state.
      setListState((prev) => (prev === "ok" ? "ok" : "failed"));
    }
  }, []);

  const loadClientThread = useCallback(async (threadId: string) => {
    // Commit-only-if-still-active: a slow fetch for thread A resolving after
    // the user opened thread B must not paint A's messages, name, and
    // contract banner over B — the composer would then send what the person
    // read in A's conversation to client B. The guard runs on EVERY setState
    // below, including the failure banner.
    const stillActive = () =>
      activeRef.current?.type === "client" && activeRef.current.threadId === threadId;
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
      setClientMessages(data.messages || []);
      setClientName(data.clientName || "Client");
      setContractExecutedAt(data.contractExecutedAt ?? null);
    } catch {
      // A failed refresh must not blank the history already on screen.
      if (stillActive()) setLoadFailed(true);
    } finally {
      if (stillActive()) setThreadLoading(false);
    }
  }, []);

  const loadSpecialist = useCallback(async () => {
    const stillActive = () => activeRef.current?.type === "specialist";
    try {
      const res = await fetch("/api/recruiter-messages");
      if (!stillActive()) return;
      if (!res.ok) {
        setLoadFailed(true);
        return;
      }
      const data = await res.json();
      if (!stillActive()) return;
      setLoadFailed(false);
      if (Array.isArray(data.messages)) {
        setSpecMessages(
          data.messages.map((m: Record<string, unknown>) => ({
            id: m.id as string,
            body: m.body as string,
            senderRole: m.sender_role === "recruiter" ? "recruiter" : "candidate",
            createdAt: m.created_at as string,
            messageType: (m.message_type as string) ?? "regular",
            authorId: (m.sender_profile_id as string) ?? null,
            // Carried through every refetch — nulling it would replace the
            // real author with "StaffVA", the misattribution 00195 prevents.
            authorName: (m.author_name as string) ?? null,
            authorPhoto: null,
          }))
        );
        setSpecUnread(0); // the GET stamps read for the caller
        setSpecPreview(null);
      }
    } catch {
      if (stillActive()) setLoadFailed(true);
    }
  }, []);

  // Initial list load
  useEffect(() => {
    const t = setTimeout(loadThreads, 0);
    return () => clearTimeout(t);
  }, [loadThreads]);

  // Realtime + fallback poll
  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      // The thread GETs stamp read_at as a side effect. A hidden tab must not
      // trigger them — a realtime event arriving while the candidate is on
      // another tab would otherwise mark messages read that nobody saw
      // (read_at already over-claims; a background stamp makes it a lie).
      // The LIST fetch stamps nothing, so it stays.
      loadThreads();
      if (document.visibilityState === "hidden") return;
      const a = activeRef.current;
      if (a?.type === "client") loadClientThread(a.threadId);
      if (a?.type === "specialist") loadSpecialist();
    };
    const channel = supabase
      .channel(`candidate-messages-${candidateId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `candidate_id=eq.${candidateId}` },
        refresh
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "recruiter_messages", filter: `candidate_id=eq.${candidateId}` },
        (payload) => {
          const a = activeRef.current;
          if (a?.type === "specialist") {
            refresh();
            return;
          }
          // Thread closed: refetching would stamp read_at on a message nobody
          // has seen. The event payload (RLS-filtered, same row a SELECT
          // returns) is enough to keep the LIST row honest: badge + preview.
          const row = payload.new as { body?: string; sender_role?: string; created_at?: string };
          if (row?.sender_role === "recruiter") {
            setSpecUnread((n) => n + 1);
            setSpecPreview(
              row.body ? { body: row.body, at: row.created_at ?? new Date().toISOString() } : null
            );
          }
        }
      )
      .subscribe();

    let poll: ReturnType<typeof setInterval> | null = setInterval(refresh, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        if (!poll) poll = setInterval(refresh, 60_000);
      } else if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      supabase.removeChannel(channel);
      if (poll) clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [candidateId, loadThreads, loadClientThread, loadSpecialist]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [clientMessages.length, specMessages.length, active]);

  function resetComposer() {
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function openClient(threadId: string) {
    setSendError(null);
    resetComposer();
    setThreadLoading(true);
    setClientMessages([]);
    setActive({ type: "client", threadId });
    loadClientThread(threadId);
    // Opening stamps read_at server-side; clear the row badge now (a "2"
    // beside a conversation being read is a lie) and reconcile the
    // layout-rendered chrome badges, which soft nav never re-runs.
    setThreads((prev) => prev.map((t) => (t.thread_id === threadId ? { ...t, unread_count: 0 } : t)));
    setTimeout(() => router.refresh(), 1200);
  }

  function openSpecialist() {
    setSendError(null);
    resetComposer();
    setActive({ type: "specialist" });
    loadSpecialist();
    setTimeout(() => router.refresh(), 1200);
  }

  async function send() {
    const body = draft.trim();
    // The target is what the person is LOOKING AT when they hit send —
    // captured once, so a thread switch during the round-trip can neither
    // redirect the message nor paint the old thread over the new one.
    const target = activeRef.current;
    if (!body || sending || !target) return;
    setSending(true);
    setSendError(null);
    try {
      if (target.type === "client") {
        const [cId] = [target.threadId.split(":")[0]];
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId, clientId: cId, body }),
        });
        if (!res.ok) {
          // The refusal must reach the person — the contact-info filter's
          // explanation especially. A silent no-op reads as "broken button".
          const j = await res.json().catch(() => ({}));
          setSendError(j.error || "Your message didn't send. Try again.");
          return;
        }
        resetComposer();
        await loadClientThread(target.threadId); // no-ops if the thread changed
        loadThreads();
      } else {
        const res = await fetch("/api/recruiter-messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setSendError(j.error || "Your message didn't send. Try again.");
          return;
        }
        resetComposer();
        const j = await res.json().catch(() => ({}));
        if (j.message) {
          // Guarded append: a realtime-triggered refetch may already have
          // landed this message — appending again would render it twice.
          setSpecMessages((prev) =>
            prev.some((m) => m.id === j.message.id) ? prev : [
            ...prev,
            {
              id: j.message.id,
              body: j.message.body,
              senderRole: "candidate",
              createdAt: j.message.created_at,
              messageType: j.message.message_type ?? "regular",
              authorId: null,
              authorName: null,
              authorPhoto: null,
            } as ThreadMessage,
          ]);
        }
      }
    } catch {
      setSendError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  function autogrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 100) + "px";
  }

  // ── Conversation list rows (specialist first, then clients by recency) ──
  const lastSpec = specMessages[specMessages.length - 1] ?? null;
  // The realtime override wins while the thread is closed — the loaded list
  // may be minutes stale, and the payload IS the newest row.
  const specialistPreview = specPreview
    ? { body: specPreview.body, createdAt: specPreview.at, senderRole: "recruiter" as const }
    : lastSpec;
  const q = search.trim().toLowerCase();

  const showSpecialist =
    specialist != null &&
    (filter === "all" || filter === "specialist" || (filter === "unread" && specUnread > 0)) &&
    (!q ||
      (specialist.assigneeName ?? "specialist").toLowerCase().includes(q) ||
      (specialistPreview?.body ?? "").toLowerCase().includes(q));

  const shownThreads = threads.filter((t) => {
    if (filter === "specialist") return false;
    if (filter === "unread" && t.unread_count === 0) return false;
    if (q && !t.other_party_name.toLowerCase().includes(q) && !t.latest_message.body.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  const totalUnread = specUnread + threads.reduce((n, t) => n + t.unread_count, 0);
  const listEmpty = !showSpecialist && shownThreads.length === 0;

  const specialistName = specialist?.assigneeName || "Your specialist";
  const activeThreadRow =
    active?.type === "client" ? threads.find((t) => t.thread_id === active.threadId) : null;

  return (
    <section className="live-messages-view">
      {/* ── Conversation list ── */}
      <aside className={`msg-conversations${active ? " hidden-mobile" : ""}`}>
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
          {(
            [
              ["all", "All"],
              ["unread", "Unread"],
              ["clients", "Clients"],
              ["specialist", "Specialist"],
            ] as Array<[Filter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`msg-conv-filter-pill${filter === key ? " active" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
              {key === "unread" && totalUnread > 0 && <span className="count">{totalUnread}</span>}
            </button>
          ))}
        </div>
        <div className="msg-conv-list">
          {showSpecialist && specialist && (
            <button
              type="button"
              className={`msg-conv-item${active?.type === "specialist" ? " active" : ""}${specUnread > 0 ? " unread" : ""}`}
              onClick={openSpecialist}
            >
              <div className="msg-conv-avatar specialist" aria-hidden>
                {specialistName.charAt(0).toUpperCase()}
              </div>
              <div className="msg-conv-body">
                <div className="msg-conv-toprow">
                  <span className="msg-conv-name">{specialistName}</span>
                  {specialistPreview && (
                    <span className="msg-conv-time">{timeShort(specialistPreview.createdAt)}</span>
                  )}
                </div>
                <div className="msg-conv-preview">
                  {specialistPreview
                    ? `${specialistPreview.senderRole === "candidate" ? "You: " : ""}${specialistPreview.body}`
                    : "Your talent specialist"}
                </div>
                {specUnread > 0 && (
                  <div className="msg-conv-meta-row">
                    <span className="msg-conv-unread">{specUnread}</span>
                  </div>
                )}
              </div>
            </button>
          )}
          {shownThreads.map((t) => (
            <button
              key={t.thread_id}
              type="button"
              className={`msg-conv-item${active?.type === "client" && active.threadId === t.thread_id ? " active" : ""}${t.unread_count > 0 ? " unread" : ""}`}
              onClick={() => openClient(t.thread_id)}
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
                  {t.latest_message.sender_type === "candidate" ? "You: " : ""}
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
                  : filter === "all"
                    ? "No conversations yet. Clients write first — when one does, the thread lands here."
                    : "Nothing here under this filter."}
            </p>
          )}
        </div>
      </aside>

      {/* ── Thread pane ── */}
      <main className={`msg-chat${active ? "" : " hidden-mobile"}`}>
        {!active ? (
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
                onClick={() => setActive(null)}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M11 7H3M7 3 3 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div
                className={`msg-conv-avatar${active.type === "specialist" ? " specialist" : ""}`}
                aria-hidden
              >
                {(active.type === "specialist" ? specialistName : clientName || "C").charAt(0).toUpperCase()}
              </div>
              <div className="msg-chat-header-meta">
                <div className="msg-chat-header-name">
                  {active.type === "specialist" ? specialistName : clientName || "Client"}
                </div>
                <div className="msg-chat-header-status">
                  {active.type === "specialist"
                    ? "Your talent specialist"
                    : contractExecutedAt
                      ? "Contract in place — contact details can be shared"
                      : "Contact details unlock once a contract is signed"}
                </div>
              </div>
              {active.type === "client" && activeThreadRow && (
                <div className="msg-chat-header-actions">
                  <Link
                    href={`/candidate/clients/${activeThreadRow.other_party_id}`}
                    style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", textDecoration: "underline" }}
                  >
                    View client profile
                  </Link>
                </div>
              )}
            </header>

            <div className="msg-chat-thread">
              {active.type === "client" ? (
                threadLoading ? (
                  <p style={{ padding: 20, fontSize: 13, color: "var(--ink-mute)" }}>Loading…</p>
                ) : (
                  groupByDay(
                    [
                      ...clientMessages.map((m) => ({ ...m, _kind: "msg" as const })),
                      ...(contractExecutedAt
                        ? [
                            {
                              id: "system-contract",
                              body: "",
                              sender_type: "system",
                              created_at: contractExecutedAt,
                              _kind: "system" as const,
                            },
                          ]
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
                              <strong>{clientName || "This client"}</strong> and you have a fully
                              executed contract. Contact details can now be shared in this
                              conversation.
                            </div>
                            <div className="system-time">{clockTime(m.created_at)}</div>
                          </div>
                        ) : (
                          <div
                            className={`msg-bubble ${m.sender_type === "candidate" ? "from-me" : "from-them"}`}
                            key={m.id}
                          >
                            <div className="bubble-content">{m.body}</div>
                            <div className="bubble-time">
                              {m.sender_type === "candidate" ? "You" : clientName || "Client"} ·{" "}
                              {clockTime(m.created_at)}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  ))
                )
              ) : (
                groupByDay(specMessages.map((m) => ({ ...m, created_at: m.createdAt }))).map((group) => (
                  <div key={group.day} style={{ display: "contents" }}>
                    <div className="msg-day-divider">{group.day}</div>
                    {group.items.map((m) =>
                      m.messageType === "edit_request" ? (
                        <div className="msg-system" key={m.id}>
                          <div className="system-icon" aria-hidden>
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M9 2l2 2-6.5 6.5L2 11l.5-2.5L9 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                            </svg>
                          </div>
                          <div>{m.body}</div>
                          <div className="system-time">{clockTime(m.createdAt)}</div>
                        </div>
                      ) : (
                        <div
                          className={`msg-bubble ${m.senderRole === "candidate" ? "from-me" : "from-them"}`}
                          key={m.id}
                        >
                          <div className="bubble-content">{m.body}</div>
                          <div className="bubble-time">
                            {m.senderRole === "candidate" ? "You" : m.authorName || "StaffVA"} ·{" "}
                            {clockTime(m.createdAt)}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ))
              )}
              {active.type === "specialist" && specMessages.length === 0 && (
                <p style={{ padding: 20, fontSize: 13, color: "var(--ink-mute)" }}>
                  Write to {specialistName} — questions about your application, profile, or
                  anything on the platform.
                </p>
              )}
              {active.type === "specialist" && awaitingReply && (
                <p style={{ padding: "4px 20px 12px", fontSize: 11.5, color: "var(--ink-mute)" }}>
                  {/* Says only what the code performs: the daily cron really
                      does send the waiting list to staff. "Reviewed daily"
                      would promise a person acts on it. */}
                  If nobody answers within two days, your message is added to a list that goes
                  to our team every day.
                </p>
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
              {/* No paperclip: the prototype's is decorative (no handler), and
                  a dead control is a broken promise. */}
              <textarea
                ref={textareaRef}
                rows={1}
                placeholder={`Reply to ${active.type === "specialist" ? specialistName : clientName || "the client"}…`}
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
