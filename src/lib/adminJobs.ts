import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Job postings, from the admin side.
 *
 * `job_posts` carries two generations of fields at once: an older
 * `budget_range` / `hours_per_week` free-text pair and a newer structured set
 * (`rate_type`, `hourly_rate_min`/`max`, `fixed_budget`,
 * `hours_per_week_estimate`). Both are read here and the detail page shows
 * whichever a given row actually filled in, rather than picking one schema and
 * rendering the other as missing.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 */

export interface JobRow {
  id: string;
  title: string | null;
  roleCategory: string | null;
  status: string;
  clientId: string | null;
  clientName: string | null;
  createdAt: string;
  publishedAt: string | null;
  budgetLabel: string | null;
  hoursLabel: string | null;
  matches: number;
}

export interface JobDetail extends JobRow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  j: Record<string, any>;
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function assertStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) return null;
  return true;
}

const money = (v: unknown) =>
  v === null || v === undefined ? null : `$${Number(v).toLocaleString()}`;

/** Whichever pay shape this row actually filled in, as one line. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function budgetLabel(j: Record<string, any>): string | null {
  if (j.rate_type === "fixed" && j.fixed_budget !== null && j.fixed_budget !== undefined) {
    return `${money(j.fixed_budget)} fixed`;
  }
  if (j.hourly_rate_min !== null && j.hourly_rate_min !== undefined) {
    const max = j.hourly_rate_max !== null && j.hourly_rate_max !== undefined ? `–${money(j.hourly_rate_max)}` : "";
    return `${money(j.hourly_rate_min)}${max}/hr`;
  }
  return j.budget_range ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hoursLabel(j: Record<string, any>): string | null {
  if (j.hours_per_week_estimate !== null && j.hours_per_week_estimate !== undefined) {
    return `${j.hours_per_week_estimate} hrs/week`;
  }
  return j.hours_per_week ? `${j.hours_per_week} hrs/week` : null;
}

export async function loadJobs(): Promise<JobRow[] | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const { data: jobs, error } = await db.from("job_posts").select("*").order("created_at", { ascending: false });
  if (error || !jobs) return null;

  const clientIds = [...new Set(jobs.map((j) => j.client_id).filter(Boolean))] as string[];
  const [clientsRes, matchesRes] = await Promise.all([
    clientIds.length ? db.from("clients").select("id, full_name, company_name").in("id", clientIds) : Promise.resolve({ data: [] }),
    jobs.length ? db.from("job_post_matches").select("job_post_id").in("job_post_id", jobs.map((j) => j.id)) : Promise.resolve({ data: [] }),
  ]);

  const clients = new Map((clientsRes.data ?? []).map((c) => [c.id, c.company_name || c.full_name]));

  return jobs.map((j) => ({
    id: j.id,
    title: j.title,
    roleCategory: j.role_category,
    status: j.status,
    clientId: j.client_id,
    clientName: j.client_id ? (clients.get(j.client_id) ?? null) : null,
    createdAt: j.created_at,
    publishedAt: j.published_at,
    budgetLabel: budgetLabel(j),
    hoursLabel: hoursLabel(j),
    matches: (matchesRes.data ?? []).filter((m) => m.job_post_id === j.id).length,
  }));
}

export async function loadJob(id: string): Promise<JobDetail | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const { data: j, error } = await db.from("job_posts").select("*").eq("id", id).maybeSingle();
  if (error || !j) return null;

  const [clientRes, matchesRes] = await Promise.all([
    j.client_id ? db.from("clients").select("id, full_name, company_name").eq("id", j.client_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("job_post_matches").select("id", { count: "exact", head: true }).eq("job_post_id", id),
  ]);

  const client = clientRes.data as { full_name?: string | null; company_name?: string | null } | null;

  return {
    j,
    id: j.id,
    title: j.title,
    roleCategory: j.role_category,
    status: j.status,
    clientId: j.client_id,
    clientName: client ? (client.company_name || client.full_name || null) : null,
    createdAt: j.created_at,
    publishedAt: j.published_at,
    budgetLabel: budgetLabel(j),
    hoursLabel: hoursLabel(j),
    matches: matchesRes.count ?? 0,
  };
}
