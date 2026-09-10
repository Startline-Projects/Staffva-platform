import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Vendor health, the failure log behind it, and the email outbox.
 *
 * `vendor_health` holds the last check per vendor; `vendor_failures` is the
 * running record. The two answer different questions — "is it up right now"
 * and "how long has it been like this" — and a vendor page that only shows the
 * first cannot tell a blip from a fortnight.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 */

export interface VendorStatus {
  vendor: string;
  ok: boolean;
  detail: string | null;
  durationMs: number | null;
  checkedAt: string;
  /** Failures recorded for this vendor, and how far back they run. */
  failures: number;
  fatalFailures: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  /**
   * Whole days since this vendor's first recorded failure, or null if it has
   * never failed. Computed here because reading the clock inside a component —
   * a page component included — is impure, and the compiler rejects it.
   */
  daysFailing: number | null;
}

export interface OutboxRow {
  status: string;
  count: number;
}

export interface PlatformReport {
  vendors: VendorStatus[];
  totalFailures: number;
  outbox: OutboxRow[];
  outboxOldestUnsent: string | null;
  recentFailures: {
    id: string;
    vendor: string;
    operation: string | null;
    fatal: boolean;
    statusCode: number | null;
    message: string | null;
    occurredAt: string;
  }[];
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function assertStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  return Boolean(user) && (role === "admin" || role === "recruiting_manager");
}

/** null means the read failed — never "everything is fine". */
export async function loadPlatformReport(): Promise<PlatformReport | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const [healthRes, failuresRes, recentRes, outboxRes] = await Promise.all([
    db.from("vendor_health").select("*").order("vendor"),
    // Aggregated in JS: a few hundred rows, and grouping in PostgREST would
    // need a view. Revisit if this table grows past a few thousand.
    db.from("vendor_failures").select("vendor, fatal, occurred_at").order("occurred_at", { ascending: false }).limit(5000),
    db.from("vendor_failures").select("id, vendor, operation, fatal, status_code, message, occurred_at").order("occurred_at", { ascending: false }).limit(25),
    db.from("email_outbox").select("status, next_attempt_at, created_at"),
  ]);

  if (healthRes.error) return null;

  const failures = failuresRes.data ?? [];

  const now = Date.now();

  const vendors: VendorStatus[] = (healthRes.data ?? []).map((h) => {
    const mine = failures.filter((f) => f.vendor === h.vendor);
    const times = mine.map((f) => f.occurred_at).sort();
    const first = times[0] ?? null;
    return {
      vendor: h.vendor,
      ok: Boolean(h.ok),
      detail: h.detail,
      durationMs: h.duration_ms,
      checkedAt: h.checked_at,
      failures: mine.length,
      fatalFailures: mine.filter((f) => f.fatal).length,
      firstFailureAt: first,
      lastFailureAt: times[times.length - 1] ?? null,
      daysFailing: first ? Math.floor((now - new Date(first).getTime()) / 86_400_000) : null,
    };
  });

  const outboxRows = outboxRes.data ?? [];
  const byStatus = new Map<string, number>();
  for (const r of outboxRows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  const unsent = outboxRows
    .filter((r) => r.status !== "sent")
    .map((r) => r.created_at)
    .sort();

  return {
    vendors,
    totalFailures: failures.length,
    outbox: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    outboxOldestUnsent: unsent[0] ?? null,
    recentFailures: (recentRes.data ?? []).map((f) => ({
      id: f.id,
      vendor: f.vendor,
      operation: f.operation,
      fatal: Boolean(f.fatal),
      statusCode: f.status_code,
      message: f.message,
      occurredAt: f.occurred_at,
    })),
  };
}
