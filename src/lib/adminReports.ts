import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Reports over what StaffVA can actually measure.
 *
 * Every dimension here is a column with data behind it, chosen after reading
 * the tables rather than from a wishlist. Two consequences worth knowing:
 *
 *  · There is deliberately no revenue report. Platform fees are recorded on
 *    engagements, but no escrow row on the platform has ever been funded or
 *    released, so a "revenue" chart would be a column of numbers nobody has
 *    been paid. Money reporting belongs with the finance surfaces, and those
 *    do not exist yet.
 *  · A dimension whose column is empty for every row still appears, and says
 *    so. `english_written_tier` is null on all 252 candidates; hiding it would
 *    make the gap invisible, and showing an empty chart would imply a
 *    measurement was taken.
 *
 * Aggregation happens in JS over a single selected column. At 252 candidates
 * that is free; past a few thousand rows this wants a grouped view in the
 * database instead.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 */

export type ReportPopulation = "candidates" | "clients" | "engagements";

export interface Dimension {
  id: string;
  label: string;
  population: ReportPopulation;
  /** Column to group by, or "__month" for a monthly series on created_at. */
  column: string;
  /** How to read a raw value for display. */
  kind?: "bool" | "month";
  note?: string;
}

export const DIMENSIONS: Dimension[] = [
  { id: "cand_status", label: "Candidates by status", population: "candidates", column: "admin_status" },
  { id: "cand_month", label: "Candidates by month applied", population: "candidates", column: "__month", kind: "month" },
  { id: "cand_role", label: "Candidates by role category", population: "candidates", column: "role_category" },
  { id: "cand_country", label: "Candidates by country", population: "candidates", column: "country" },
  { id: "cand_screening", label: "Candidates by screening tag", population: "candidates", column: "screening_tag" },
  { id: "cand_id", label: "Candidates by ID verification", population: "candidates", column: "id_verification_status" },
  { id: "cand_ai", label: "Candidates by AI interview result", population: "candidates", column: "ai_interview_passed", kind: "bool" },
  { id: "cand_english", label: "Candidates by written English tier", population: "candidates", column: "english_written_tier" },
  { id: "cand_availability", label: "Candidates by availability", population: "candidates", column: "availability_status" },
  { id: "cand_payout", label: "Candidates by payout method", population: "candidates", column: "payout_method" },
  { id: "client_month", label: "Clients by month joined", population: "clients", column: "__month", kind: "month" },
  { id: "client_id", label: "Clients by ID verification", population: "clients", column: "id_verification_status" },
  { id: "eng_status", label: "Engagements by status", population: "engagements", column: "status" },
  { id: "eng_type", label: "Engagements by contract type", population: "engagements", column: "contract_type" },
  { id: "eng_cycle", label: "Engagements by payment cycle", population: "engagements", column: "payment_cycle" },
];

export interface ReportRow {
  value: string;
  /** True when the underlying column was null for these rows. */
  missing: boolean;
  count: number;
  share: number;
}

export interface Report {
  dimension: Dimension;
  rows: ReportRow[];
  total: number;
  /** How many rows had no value at all for this column. */
  missingCount: number;
  from: string | null;
  to: string | null;
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

export function findDimension(id: string | undefined): Dimension {
  return DIMENSIONS.find((d) => d.id === id) ?? DIMENSIONS[0];
}

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export async function loadReport(
  dimension: Dimension,
  from: string | null,
  to: string | null
): Promise<Report | null> {
  if (!(await assertStaff())) return null;

  const db = serviceClient();
  const column = dimension.column === "__month" ? "created_at" : dimension.column;

  // `created_at` is always needed for the date window; when the dimension IS
  // created_at, asking for it twice is a malformed select.
  const columns = column === "created_at" ? "created_at" : `${column}, created_at`;
  let query = db.from(dimension.population).select(columns);
  if (from) query = query.gte("created_at", from);
  // `to` is a date; take the whole of that day by asking for anything before
  // the next one, rather than before midnight of the day itself.
  if (to) query = query.lt("created_at", `${to}T23:59:59.999Z`);

  const { data, error } = await query.limit(20000);
  if (error || !data) return null;

  const buckets = new Map<string, number>();
  let missingCount = 0;

  const rows_raw = data as unknown as Record<string, unknown>[];

  for (const row of rows_raw) {
    const raw = dimension.column === "__month" ? row.created_at : row[column];

    if (raw === null || raw === undefined || raw === "") {
      missingCount += 1;
      continue;
    }

    let key: string;
    if (dimension.kind === "month") {
      key = MONTH_FMT.format(new Date(String(raw)));
    } else if (dimension.kind === "bool") {
      key = raw ? "Passed" : "Not passed";
    } else {
      key = String(raw);
    }
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const total = rows_raw.length;

  const rows: ReportRow[] = [...buckets.entries()]
    .map(([value, count]) => ({ value, missing: false, count, share: total ? count / total : 0 }))
    .sort((a, b) =>
      dimension.kind === "month"
        ? new Date(a.value).getTime() - new Date(b.value).getTime()
        : b.count - a.count
    );

  if (missingCount > 0) {
    rows.push({
      value: "not recorded",
      missing: true,
      count: missingCount,
      share: total ? missingCount / total : 0,
    });
  }

  return { dimension, rows, total, missingCount, from, to };
}
