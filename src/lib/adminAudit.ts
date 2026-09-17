import { createClient } from "@supabase/supabase-js";

/**
 * Recording who did what.
 *
 * One writer for the whole admin panel, so the vocabulary stays consistent and
 * a new decision point cannot invent its own shape. Every call names an actor
 * unless it genuinely was the system — the type below is what makes that hard
 * to get wrong, and the CHECK in migration `admin_actions_audit` is the
 * backstop if it is got wrong anyway.
 *
 * This never throws. An audit write is not worth rolling back the decision it
 * describes — a ban that half-succeeded is worse than a ban nobody logged. But
 * it is never silent either: a failure goes to console.error with the action
 * that went unrecorded, so it shows up in the platform logs rather than
 * vanishing the way `recordStatusEvent` failures did.
 *
 * Returns true when the row landed, so a caller that wants to tell the user
 * "done, but not logged" can.
 */

export type AuditSubject = "candidate" | "review" | "dispute" | "engagement" | "client" | "profile";

export type AuditAction =
  | "candidate.approve"
  | "candidate.reject"
  | "candidate.revision_requested"
  | "candidate.reinstate"
  | "candidate.flag"
  | "candidate.appeal_decided"
  | "candidate.reassign_bulk"
  | "candidate.rescreen_queued"
  | "recording.viewed"
  | "ban.confirm"
  | "ban.dismiss"
  | "lockout.lift"
  | "review.takedown"
  | "review.restore"
  | "dispute.resolve";

interface BaseEntry {
  action: AuditAction;
  subjectType: AuditSubject;
  subjectId: string | null;
  /** One line a human can read without joining anything. */
  summary: string;
  detail?: Record<string, unknown>;
}

/**
 * A person did it: the id is required. A union rather than an optional field,
 * so `actorRole: "admin"` without an `actorId` does not compile.
 */
type PersonEntry = BaseEntry & {
  actorRole: "admin" | "recruiting_manager" | "recruiter";
  actorId: string;
};

type SystemEntry = BaseEntry & {
  actorRole: "system";
  actorId?: null;
};

export type AuditEntry = PersonEntry | SystemEntry;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function recordAdminAction(entry: AuditEntry): Promise<boolean> {
  try {
    const { error } = await serviceClient().from("admin_actions").insert({
      actor_id: entry.actorId ?? null,
      actor_role: entry.actorRole,
      action: entry.action,
      subject_type: entry.subjectType,
      subject_id: entry.subjectId,
      summary: entry.summary,
      detail: entry.detail ?? null,
    });

    if (error) {
      console.error(
        `[audit] NOT RECORDED: ${entry.action} on ${entry.subjectType}:${entry.subjectId} by ${entry.actorId ?? "system"} — ${error.message}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[audit] NOT RECORDED: ${entry.action} on ${entry.subjectType}:${entry.subjectId} —`,
      err
    );
    return false;
  }
}


/* ══════════════════════ READING THE LOG ══════════════════════ */

import { createClient as createServerClient } from "@/lib/supabase/server";

export interface AuditRow {
  id: number;
  actorId: string | null;
  actorName: string | null;
  actorRole: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  actions: string[];
}

export const AUDIT_PAGE_SIZE = 50;

/** null means the read failed — never an empty log. */
export async function loadAuditLog(opts: {
  page: number;
  action?: string | null;
  actorId?: string | null;
}): Promise<AuditPage | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) return null;

  const db = serviceClient();
  const from = (opts.page - 1) * AUDIT_PAGE_SIZE;

  let q = db.from("admin_actions").select("*", { count: "exact" });
  if (opts.action) q = q.eq("action", opts.action);
  if (opts.actorId) q = q.eq("actor_id", opts.actorId);

  const { data, count, error } = await q
    .order("created_at", { ascending: false })
    .range(from, from + AUDIT_PAGE_SIZE - 1);

  if (error) return null;

  const rows = data ?? [];
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: people } = actorIds.length
    ? await db.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));

  // The distinct verbs actually present, for the filter. Reading them from the
  // data rather than from the union type means a verb added by a route that
  // forgot to update the type still appears.
  const { data: allActions } = await db.from("admin_actions").select("action").limit(5000);
  const actions = [...new Set((allActions ?? []).map((a) => a.action))].sort();

  return {
    rows: rows.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      actorName: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
      actorRole: r.actor_role,
      action: r.action,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      summary: r.summary,
      detail: r.detail,
      createdAt: r.created_at,
    })),
    total: count ?? 0,
    page: opts.page,
    pageSize: AUDIT_PAGE_SIZE,
    actions,
  };
}
