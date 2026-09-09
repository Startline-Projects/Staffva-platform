import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { runReadinessChecks } from "@/lib/readiness";

/**
 * GET /api/admin/readiness
 *
 * Whether the paid-assessment system can actually run, and if not, which
 * specific thing is stopping it.
 *
 * Gated on an ADMIN SESSION rather than CRON_SECRET, and that is the point:
 * the single most likely thing to be missing IS CRON_SECRET, and a check that
 * cannot report its own precondition is not a check. An admin can always sign
 * in, so this answers no matter how badly the environment is configured.
 *
 * The response carries no secret values — only which names are unset and what
 * breaks as a result. It is meant to be safe to screenshot.
 *
 * Returns 503 when anything is blocked, so an uptime monitor pointed here goes
 * red on a misconfiguration instead of reporting a healthy 200 over a system
 * that is quietly taking money and delivering nothing.
 */
export async function GET() {
  const user = await getUser();
  if (!user || user.app_metadata?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const report = await runReadinessChecks();
  return NextResponse.json(report, { status: report.ready ? 200 : 503 });
}
