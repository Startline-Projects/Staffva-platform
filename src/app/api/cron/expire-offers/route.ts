import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Runs daily — expires offers older than 5 days with no response
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const { data: expired } = await supabase
    .from("engagement_offers")
    .select("id, client_id, candidate_id, clients(email, full_name), candidates(display_name)")
    .in("status", ["sent", "viewed"])
    .lt("sent_at", fiveDaysAgo);

  if (!expired || expired.length === 0) {
    return NextResponse.json({ message: "No offers to expire", count: 0 });
  }

  for (const offer of expired) {
    await supabase.from("engagement_offers").update({ status: "expired" }).eq("id", offer.id);

    const clientInfo = offer.clients as unknown as { email: string; full_name: string } | null;
    const candInfo = offer.candidates as unknown as { display_name: string } | null;

    if (process.env.RESEND_API_KEY && clientInfo?.email) {
      try {
        await sendEmail({
          from: "StaffVA <notifications@staffva.com>",
          to: clientInfo.email,
          subject: `Your offer to ${candInfo?.display_name || "a candidate"} has expired`,
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Offer Expired</h2>
            <p style="color:#444;font-size:14px;">Your offer to ${candInfo?.display_name || "a candidate"} expired after 5 days with no response. You can send a new offer or browse other candidates.</p>
            <a href="https://staffva.com/browse" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Browse Talent</a>
          </div>`,
        });
      } catch { /* silent */ }
    }
  }

  return NextResponse.json({ message: `Expired ${expired.length} offers`, count: expired.length });
}
