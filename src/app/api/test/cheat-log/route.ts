import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/test/cheat-log
 * Body: { candidateId, eventType, testSection }
 */
export async function POST(req: NextRequest) {
  try {
    const { candidateId, eventType, testSection } = await req.json();
    if (!candidateId || !eventType) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const admin = getAdminClient();

    // Insert log entry
    await admin.from("cheat_log").insert({
      candidate_id: candidateId,
      event_type: eventType,
      test_section: testSection || null,
    });

    // Increment cheat_flag_count on candidate
    await admin.rpc("exec_sql", {
      query: `UPDATE candidates SET cheat_flag_count = cheat_flag_count + 1 WHERE id = '${candidateId}'`,
    });

    // Check total count for this session — alert admin if >3
    const { count } = await admin
      .from("cheat_log")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidateId)
      .eq("event_type", "mouse_leave");

    if (count && count > 3 && process.env.RESEND_API_KEY) {
      // Only alert once at threshold (count === 4)
      if (count === 4) {
        const { data: candidate } = await admin.from("candidates").select("full_name, display_name, email").eq("id", candidateId).single();
        try {
          await resend.emails.send({
            from: "StaffVA <notifications@staffva.com>",
            to: "sam@glostaffing.com",
            subject: `Focus violation alert — ${candidate?.display_name || candidate?.full_name || "Unknown"}`,
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Test Focus Violation Alert</h2>
              <p style="color:#444;font-size:14px;"><strong>${candidate?.display_name || candidate?.full_name}</strong> (${candidate?.email}) has left the test screen <strong>${count} times</strong> during their English assessment.</p>
              <p style="color:#444;font-size:14px;">This may indicate the use of external resources. Review their test results carefully.</p>
              <a href="https://staffva.com/admin/candidates" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px;">Review in Admin</a>
            </div>`,
          });
        } catch { /* silent */ }
      }
    }

    return NextResponse.json({ logged: true, totalViolations: count || 0 });
  } catch (error) {
    console.error("Cheat log error:", error);
    return NextResponse.json({ error: "Failed to log" }, { status: 500 });
  }
}
