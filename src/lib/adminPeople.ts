import { createClient } from "@supabase/supabase-js";
import { countOrNull } from "@/lib/readCount";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Records for the two smaller populations: one client, one talent specialist.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY. Do not import from a
 * "use client" module.
 */

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function assertStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) return null;
  return { user, role };
}

/* ══════════════════════════ CLIENT ══════════════════════════ */

export interface ClientRecord {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: Record<string, any>;
  lastSignInAt: string | null;
  engagements: { id: string; status: string; createdAt: string; platformFeeUsd: number | null }[];
  jobPosts: { id: string; title: string | null; status: string | null; createdAt: string }[];
  /** null = could not be read. */
  profileViews: number | null;
  /** null = could not be read. */
  shortlists: number | null;
  /**
   * Columns that exist on `clients` but are unset for every client on the
   * platform. The record lists them so a reader can tell "this client has not
   * filled it in" from "nobody has, because nothing writes it".
   */
  unusedAcrossPlatform: string[];
}

const CLIENT_OPTIONAL_FIELDS: { column: string; label: string }[] = [
  { column: "headline", label: "Headline" },
  { column: "bio", label: "Bio" },
  { column: "website_url", label: "Website" },
  { column: "hiring_for", label: "Hiring for" },
  { column: "referral_source", label: "Referral source" },
];

export async function loadClientRecord(id: string): Promise<ClientRecord | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const { data: c, error } = await db.from("clients").select("*").eq("id", id).maybeSingle();
  if (error || !c) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = c as Record<string, any>;

  const [engRes, jobRes, viewRes, shortRes, unusedCounts] = await Promise.all([
    db.from("engagements").select("id, status, created_at, platform_fee_usd").eq("client_id", id).order("created_at", { ascending: false }),
    db.from("job_posts").select("id, title, status, created_at").eq("client_id", id).order("created_at", { ascending: false }),
    db.from("profile_views").select("id", { count: "exact", head: true }).eq("client_id", id),
    db.from("client_shortlists").select("id", { count: "exact", head: true }).eq("client_id", id),
    Promise.all(
      CLIENT_OPTIONAL_FIELDS.map(async (f) => {
        const res = await db.from("clients").select("id", { count: "exact", head: true }).not(f.column, "is", null);
        // null, not 0, when unread. The filter below is strictly `=== 0`, so an
        // unread column is never reported as one nobody on the platform uses —
        // which is a claim about every client, made from a query that failed.
        return { label: f.label, used: countOrNull(res) };
      })
    ),
  ]);

  let lastSignInAt: string | null = null;
  if (client.user_id) {
    const { data: authUser } = await db.auth.admin.getUserById(client.user_id);
    lastSignInAt = authUser?.user?.last_sign_in_at ?? null;
  }

  return {
    c: client,
    lastSignInAt,
    engagements: (engRes.data ?? []).map((e) => ({
      id: e.id, status: e.status, createdAt: e.created_at,
      platformFeeUsd: e.platform_fee_usd === null ? null : Number(e.platform_fee_usd),
    })),
    jobPosts: (jobRes.data ?? []).map((j) => ({ id: j.id, title: j.title, status: j.status, createdAt: j.created_at })),
    profileViews: countOrNull(viewRes),
    shortlists: countOrNull(shortRes),
    unusedAcrossPlatform: unusedCounts.filter((u) => u.used === 0).map((u) => u.label),
  };
}

/* ══════════════════════ TALENT SPECIALIST ══════════════════════ */

export interface SpecialistRecord {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: Record<string, any>;
  lastSignInAt: string | null;
  mfaFactors: number | null;
  /** Candidates pointed at this person by `candidates.assigned_recruiter`. */
  directQueue: {
    total: number;
    byStatus: Record<string, number>;
    byScreeningTag: Record<string, number>;
    recent: { id: string; name: string; status: string | null; createdAt: string }[];
  };
  /** Role categories claimed through the `recruiter_assignments` table. */
  categories: string[];
  /**
   * Candidates matching those categories. StaffVA decides "whose queue is
   * this" two different ways and they do not agree; see the record.
   */
  /** null = could not be read. */
  categoryQueueTotal: number | null;
  /** null = could not be read. */
  messagesSent: number | null;
}

export async function loadSpecialistRecord(id: string): Promise<SpecialistRecord | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const { data: p, error } = await db
    .from("profiles")
    .select("id, full_name, email, role, is_active, suspended_at, created_at, recruiter_photo_url, recruiter_type, daily_interview_target, bio")
    .eq("id", id)
    .in("role", ["recruiter", "recruiting_manager"])
    .maybeSingle();

  if (error || !p) return null;

  const [directRes, catRes, msgRes, authRes] = await Promise.all([
    db.from("candidates").select("id, full_name, display_name, admin_status, screening_tag, created_at").eq("assigned_recruiter", id),
    db.from("recruiter_assignments").select("role_category").eq("recruiter_id", id),
    db.from("recruiter_messages").select("id", { count: "exact", head: true }).eq("recruiter_id", id),
    db.auth.admin.getUserById(id),
  ]);

  const direct = directRes.data ?? [];
  const byStatus: Record<string, number> = {};
  const byScreeningTag: Record<string, number> = {};
  for (const c of direct) {
    const s = c.admin_status ?? "unknown";
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    if (c.screening_tag) byScreeningTag[c.screening_tag] = (byScreeningTag[c.screening_tag] ?? 0) + 1;
  }

  const categories = [...new Set((catRes.data ?? []).map((r) => r.role_category).filter(Boolean))];

  // No categories claimed is a true zero. A count that failed is not.
  let categoryQueueTotal: number | null = 0;
  if (categories.length > 0) {
    categoryQueueTotal = countOrNull(await db
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .in("role_category", categories));
  }

  const authUser = authRes.data?.user;

  return {
    p,
    lastSignInAt: authUser?.last_sign_in_at ?? null,
    mfaFactors: authUser ? (authUser.factors ?? []).filter((f) => f.status === "verified").length : null,
    directQueue: {
      total: direct.length,
      byStatus,
      byScreeningTag,
      recent: direct
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 8)
        .map((c) => ({
          id: c.id,
          name: c.full_name || c.display_name || "—",
          status: c.admin_status,
          createdAt: c.created_at,
        })),
    },
    categories,
    categoryQueueTotal,
    messagesSent: countOrNull(msgRes),
  };
}
