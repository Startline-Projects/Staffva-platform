import { createClient } from "@supabase/supabase-js";

/**
 * The conversation between a candidate and the staff member assigned to them.
 *
 * One definition, used by the candidate's page, the staff triage screen and the
 * escalation cron, so none of them can disagree about who is waiting.
 *
 * The numbers that made this step necessary, measured on live data: ten
 * candidates have written to their recruiter. Seven have never had any reply.
 * Nine are waiting now, eight of them since April. The longest has waited 141
 * days; the average is 124.
 */

export interface ThreadMessage {
  id: string;
  body: string;
  senderRole: "candidate" | "recruiter";
  createdAt: string;
  messageType: string;
  /** Who actually typed a staff message (00195). Null for candidate messages. */
  authorId: string | null;
  authorName: string | null;
  authorPhoto: string | null;
}

export interface ThreadState {
  candidateId: string;
  candidateName: string | null;
  /** candidates.assigned_recruiter — the CURRENT owner, not the message's. */
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  assigneeRole: string | null;
  /** The last message is from the candidate: somebody owes them a reply. */
  awaitingReply: boolean;
  /** Oldest unanswered candidate message — NOT the newest. See below. */
  waitingSince: string | null;
  daysWaiting: number | null;
  unansweredCount: number;
  everReplied: boolean;
  /** Staff messages this candidate has not opened. */
  unreadByCandidate: number;
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * How long someone has been waiting.
 *
 * Measured from the OLDEST candidate message that has had no staff reply after
 * it — never from their most recent one. Measuring from the newest understates
 * badly: one candidate here has written seven times since April, and the naive
 * measure reported his wait as 24 days rather than 136, because he wrote again
 * while still unanswered. Writing twice does not restart anyone's clock.
 */
export function computeWaiting(
  msgs: { senderRole: string; createdAt: string; messageType: string }[]
): { since: string | null; count: number; everReplied: boolean; awaiting: boolean } {
  const lastReply = msgs
    .filter((m) => m.senderRole === "recruiter")
    .reduce<string | null>((acc, m) => (!acc || m.createdAt > acc ? m.createdAt : acc), null);

  const unanswered = msgs.filter(
    (m) =>
      m.senderRole === "candidate" &&
      // An edit request is a system event the candidate triggered elsewhere,
      // not a message anyone can reply to. The approve, decline and cancel
      // routes only rewrite this row's body — none of them inserts a reply — so
      // counting it here would leave the thread waiting forever on a request
      // that was resolved within the hour: false copy on the candidate's page,
      // a queue entry with no clearing action, and a cron pinned at 503 mailing
      // every admin daily. MessageThread already renders these as system
      // events; this is the same rule, in the predicate.
      m.messageType !== "edit_request" &&
      (!lastReply || m.createdAt > lastReply)
  );
  const since = unanswered.reduce<string | null>(
    (acc, m) => (!acc || m.createdAt < acc ? m.createdAt : acc),
    null
  );

  return {
    since,
    count: unanswered.length,
    everReplied: !!lastReply,
    // Deliberately NOT derived from read_at. The GET handler stamps read_at as a
    // side effect of opening the pane, so "read" means a page was loaded, not
    // that anyone answered — five of the nine waiting show zero unread and have
    // never had a reply. An obligation you can discharge by looking is not one.
    awaiting: unanswered.length > 0,
  };
}

function days(since: string | null): number | null {
  if (!since) return null;
  return Math.floor((Date.now() - Date.parse(since)) / 86_400_000);
}

/** Just what the waiting predicate needs — no bodies over the wire. */
type ScanRow = {
  candidate_id: string;
  sender_role: string;
  created_at: string;
  message_type: string | null;
  read_at: string | null;
};

interface RawRow {
  id: string;
  body: string;
  sender_role: string;
  created_at: string;
  message_type: string | null;
  read_at: string | null;
  sender_profile_id: string | null;
  candidate_id: string;
}

/** One candidate's thread, for their own page. */
export async function loadCandidateThread(candidateId: string): Promise<{
  messages: ThreadMessage[];
  state: ThreadState;
}> {
  const db = admin();

  const [msgRes, candRes] = await Promise.all([
    db
      .from("recruiter_messages")
      .select("id, body, sender_role, created_at, message_type, read_at, sender_profile_id, candidate_id")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: true }),
    db
      .from("candidates")
      .select("id, display_name, first_name, assigned_recruiter")
      .eq("id", candidateId)
      .maybeSingle(),
  ]);

  // A failed read must never render as "no messages yet" over a 141-day
  // history. That sentence is the one this page must not get wrong.
  if (msgRes.error) throw new Error(`thread read failed: ${msgRes.error.message}`);
  if (candRes.error) throw new Error(`candidate read failed: ${candRes.error.message}`);

  const rows = (msgRes.data ?? []) as RawRow[];

  // Resolve staff authors in one go. Falls back to "StaffVA" and never to the
  // assignee: attributing a message to someone who did not write it is the
  // failure 00195 exists to prevent.
  const authorIds = [...new Set(rows.map((r) => r.sender_profile_id).filter(Boolean))] as string[];
  const authors = new Map<string, { full_name: string | null; recruiter_photo_url: string | null }>();
  if (authorIds.length > 0) {
    const { data } = await db
      .from("profiles")
      .select("id, full_name, recruiter_photo_url")
      .in("id", authorIds);
    for (const a of data ?? []) authors.set(a.id, a);
  }

  const assigneeId = candRes.data?.assigned_recruiter ?? null;
  let assignee: { full_name: string | null; email: string | null; role: string | null } | null = null;
  if (assigneeId) {
    const { data } = await db
      .from("profiles")
      .select("full_name, email, role")
      .eq("id", assigneeId)
      .maybeSingle();
    assignee = data ?? null;
  }

  const messages: ThreadMessage[] = rows.map((r) => {
    const a = r.sender_profile_id ? authors.get(r.sender_profile_id) : undefined;
    return {
      id: r.id,
      body: r.body,
      senderRole: r.sender_role === "recruiter" ? "recruiter" : "candidate",
      createdAt: r.created_at,
      messageType: r.message_type ?? "regular",
      authorId: r.sender_profile_id,
      authorName: a?.full_name ?? null,
      authorPhoto: a?.recruiter_photo_url ?? null,
    };
  });

  const w = computeWaiting(
    messages.map((m) => ({
      senderRole: m.senderRole,
      createdAt: m.createdAt,
      messageType: m.messageType,
    }))
  );

  return {
    messages,
    state: {
      candidateId,
      candidateName: candRes.data?.display_name ?? candRes.data?.first_name ?? null,
      assigneeId,
      assigneeName: assignee?.full_name ?? null,
      assigneeEmail: assignee?.email ?? null,
      assigneeRole: assignee?.role ?? null,
      awaitingReply: w.awaiting,
      waitingSince: w.since,
      daysWaiting: days(w.since),
      unansweredCount: w.count,
      everReplied: w.everReplied,
      unreadByCandidate: rows.filter((r) => r.sender_role === "recruiter" && !r.read_at).length,
    },
  };
}

/**
 * Every thread waiting on a reply, oldest first — for the staff screen and the
 * escalation cron. Both read this, so the alert and the screen cannot disagree.
 */
export async function loadAwaitingThreads(): Promise<ThreadState[]> {
  const db = admin();

  // Paged explicitly, and only the four columns the predicate reads.
  //
  // This was one unbounded select of every column including `body`, which
  // loadAwaitingThreads never looks at. PostgREST applies its own max-rows cap
  // silently, so an unbounded scan does not fail when it outgrows the limit —
  // it quietly returns a prefix, and threads would start disappearing from the
  // escalation with no error anywhere. Small today at 27 rows; this is the one
  // query in the step that grows with every message ever sent.
  const PAGE = 1000;
  const scanned: ScanRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("recruiter_messages")
      .select("candidate_id, sender_role, created_at, message_type, read_at")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`thread scan failed: ${error.message}`);
    const batch = (data ?? []) as ScanRow[];
    scanned.push(...batch);
    if (batch.length < PAGE) break;
  }

  const byCandidate = new Map<string, ScanRow[]>();
  for (const r of scanned) {
    const list = byCandidate.get(r.candidate_id) ?? [];
    list.push(r);
    byCandidate.set(r.candidate_id, list);
  }

  const ids = [...byCandidate.keys()];
  if (ids.length === 0) return [];

  const { data: cands } = await db
    .from("candidates")
    .select("id, display_name, first_name, assigned_recruiter")
    .in("id", ids);
  const candMap = new Map((cands ?? []).map((c) => [c.id, c]));

  const assigneeIds = [
    ...new Set((cands ?? []).map((c) => c.assigned_recruiter).filter(Boolean)),
  ] as string[];
  const profMap = new Map<string, { full_name: string | null; email: string | null; role: string | null }>();
  if (assigneeIds.length > 0) {
    const { data } = await db
      .from("profiles")
      .select("id, full_name, email, role")
      .in("id", assigneeIds);
    for (const p of data ?? []) profMap.set(p.id, p);
  }

  const out: ThreadState[] = [];
  for (const [candidateId, msgs] of byCandidate) {
    const w = computeWaiting(
      msgs.map((m) => ({
        senderRole: m.sender_role,
        createdAt: m.created_at,
        messageType: m.message_type ?? "regular",
      }))
    );
    if (!w.awaiting) continue;

    const c = candMap.get(candidateId);
    const assigneeId = c?.assigned_recruiter ?? null;
    const p = assigneeId ? profMap.get(assigneeId) : undefined;

    out.push({
      candidateId,
      candidateName: c?.display_name ?? c?.first_name ?? null,
      assigneeId,
      assigneeName: p?.full_name ?? null,
      assigneeEmail: p?.email ?? null,
      assigneeRole: p?.role ?? null,
      awaitingReply: true,
      waitingSince: w.since,
      daysWaiting: days(w.since),
      unansweredCount: w.count,
      everReplied: w.everReplied,
      unreadByCandidate: msgs.filter((m) => m.sender_role === "recruiter" && !m.read_at).length,
    });
  }

  out.sort((a, b) => (a.waitingSince ?? "").localeCompare(b.waitingSince ?? ""));
  return out;
}
