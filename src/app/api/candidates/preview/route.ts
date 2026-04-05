import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(req: NextRequest) {
  try {
    const candidateId = req.nextUrl.searchParams.get("id");
    if (!candidateId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const admin = getAdminClient();

    // Fetch candidate
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, display_name, first_name, last_name, country, role_category, time_zone, hourly_rate, bio, tagline, profile_photo_url, voice_recording_1_url, voice_recording_1_preview_url, skills, tools, work_experience, reputation_score, reputation_tier, total_earnings_usd, committed_hours, availability_status")
      .eq("id", candidateId)
      .eq("admin_status", "approved")
      .single();

    if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // AI interview scores
    const { data: aiInterview } = await admin
      .from("ai_interviews")
      .select("overall_score, technical_knowledge_score, problem_solving_score, communication_score, experience_depth_score, professionalism_score, passed")
      .eq("candidate_id", candidateId)
      .eq("status", "completed")
      .eq("passed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Most recent review
    const { data: review } = await admin
      .from("reviews")
      .select("rating, body, submitted_at, clients(full_name)")
      .eq("candidate_id", candidateId)
      .eq("published", true)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Review count
    const { count: reviewCount } = await admin
      .from("reviews")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidateId)
      .eq("published", true);

    // Check relationship with authenticated client
    let relationship = "none"; // none | messaged | engaged
    try {
      const supabase = await createServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata?.role === "client") {
        const { data: client } = await admin.from("clients").select("id").eq("user_id", user.id).single();
        if (client) {
          // Check active engagement
          const { data: engagement } = await admin.from("engagements").select("id").eq("client_id", client.id).eq("candidate_id", candidateId).eq("status", "active").limit(1).maybeSingle();
          if (engagement) { relationship = "engaged"; }
          else {
            // Check message thread
            const { data: msg } = await admin.from("messages").select("id").eq("client_id", client.id).eq("candidate_id", candidateId).limit(1).maybeSingle();
            if (msg) { relationship = "messaged"; }
          }
        }
      }
    } catch { /* unauthenticated */ }

    // Get signed URL for voice preview
    let voicePreviewSignedUrl: string | null = null;
    if (candidate.voice_recording_1_preview_url) {
      const { data: urlData } = await admin.storage.from("voice-recordings").createSignedUrl(candidate.voice_recording_1_preview_url, 3600);
      voicePreviewSignedUrl = urlData?.signedUrl || null;
    } else if (candidate.voice_recording_1_url) {
      const { data: urlData } = await admin.storage.from("voice-recordings").createSignedUrl(candidate.voice_recording_1_url, 3600);
      voicePreviewSignedUrl = urlData?.signedUrl || null;
    }

    return NextResponse.json({
      candidate,
      aiInterview: aiInterview || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      review: review ? { ...review, clientName: (review.clients as any)?.full_name || null } : null,
      reviewCount: reviewCount || 0,
      relationship,
      voicePreviewSignedUrl,
    });
  } catch (error) {
    console.error("Preview API error:", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
