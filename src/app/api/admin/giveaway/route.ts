import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = getAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? user : null;
}

// GET — List all giveaway entries with candidate info
export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const supabase = getAdminClient();

  const { data: entries } = await supabase
    .from("giveaway_entries")
    .select("*, candidates(id, display_name, full_name, email, country, role_category, profile_photo_url, admin_status)")
    .order("created_at", { ascending: false });

  const { count: eligibleCount } = await supabase
    .from("giveaway_entries")
    .select("*", { count: "exact", head: true })
    .eq("eligible", true);

  const { data: pastWinners } = await supabase
    .from("giveaway_winner_log")
    .select("*")
    .order("selected_at", { ascending: false })
    .limit(5);

  return NextResponse.json({
    entries: entries || [],
    eligibleCount: eligibleCount || 0,
    totalEntries: entries?.length || 0,
    pastWinners: pastWinners || [],
  });
}

// POST — Toggle tag_verified or select winners
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { action, entryId, candidateId } = await req.json();
  const supabase = getAdminClient();

  if (action === "toggle_tag") {
    if (!entryId) return NextResponse.json({ error: "Missing entryId" }, { status: 400 });

    const { data: entry } = await supabase
      .from("giveaway_entries")
      .select("tag_verified, candidate_id")
      .eq("id", entryId)
      .single();

    if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    const newValue = !entry.tag_verified;

    const { data: updated } = await supabase
      .from("giveaway_entries")
      .update({
        tag_verified: newValue,
        tag_verified_at: newValue ? new Date().toISOString() : null,
      })
      .eq("id", entryId)
      .select("*")
      .single();

    // Check if candidate just became fully eligible
    if (updated && updated.eligible) {
      // Send congratulations email
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
      try {
        await fetch(`${siteUrl}/api/candidate-emails`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: entry.candidate_id,
            emailType: "giveaway_eligible",
            data: {},
          }),
        });
      } catch { /* non-fatal */ }

      // Fallback direct email if the email type isn't in the template
      if (process.env.RESEND_API_KEY) {
        const { data: candidate } = await supabase
          .from("candidates")
          .select("email, display_name, full_name")
          .eq("id", entry.candidate_id)
          .single();

        if (candidate) {
          const firstName = (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";
          try {
            await resend.emails.send({
              from: "StaffVA <notifications@staffva.com>",
              to: candidate.email,
              subject: "You are eligible for the $3,000 StaffVA giveaway!",
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                <h2 style="color:#1C1B1A;">Congratulations, ${firstName}!</h2>
                <p style="color:#444;font-size:14px;line-height:1.6;">You have completed all three steps and are now officially eligible for the <strong>$3,000 StaffVA launch giveaway</strong>.</p>
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0;">
                  <p style="margin:0;color:#166534;font-weight:600;">Your eligibility is confirmed</p>
                  <ul style="margin:8px 0 0;padding-left:20px;color:#166534;font-size:13px;">
                    <li>Application submitted ✓</li>
                    <li>Profile approved and live ✓</li>
                    <li>Tagged 3 friends in launch post ✓</li>
                  </ul>
                </div>
                <p style="color:#444;font-size:14px;">Winners will be announced on the first of the month. Good luck!</p>
                <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View Dashboard</a>
                <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
              </div>`,
            });
          } catch { /* silent */ }
        }
      }
    }

    return NextResponse.json({ entry: updated });
  }

  if (action === "select_winners") {
    // Get all eligible candidates
    const { data: eligible } = await supabase
      .from("giveaway_entries")
      .select("candidate_id")
      .eq("eligible", true);

    if (!eligible || eligible.length < 2) {
      return NextResponse.json({ error: `Need at least 2 eligible candidates. Currently: ${eligible?.length || 0}` }, { status: 400 });
    }

    // Cryptographically random selection
    const seed = crypto.randomBytes(32).toString("hex");
    const shuffled = [...eligible].sort(() => {
      const hash = crypto.createHash("sha256").update(seed + Math.random().toString()).digest("hex");
      return parseInt(hash.slice(0, 8), 16) - 0x7FFFFFFF;
    });

    const winner1 = shuffled[0].candidate_id;
    const winner2 = shuffled[1].candidate_id;

    // Log selection
    const { data: logEntry } = await supabase
      .from("giveaway_winner_log")
      .insert({
        winner_1_candidate_id: winner1,
        winner_2_candidate_id: winner2,
        selection_method: `random_verified_eligible (seed: ${seed.slice(0, 16)}..., pool: ${eligible.length})`,
        selected_by: admin.id,
      })
      .select()
      .single();

    // Get winner details
    const { data: winners } = await supabase
      .from("candidates")
      .select("id, display_name, full_name, email, country, role_category")
      .in("id", [winner1, winner2]);

    return NextResponse.json({
      winners,
      logEntry,
      poolSize: eligible.length,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
