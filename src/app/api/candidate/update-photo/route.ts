import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const supabaseAuth = await createServerClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();

  if (!user || user.user_metadata?.role !== "candidate") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { photoUrl } = await req.json();

  if (!photoUrl) {
    return NextResponse.json({ error: "Missing photo URL" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Get candidate record
  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, profile_photo_url")
    .eq("user_id", user.id)
    .single();

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // If candidate has no existing photo (first upload during profile build), set directly
  if (!candidate.profile_photo_url) {
    await supabase
      .from("candidates")
      .update({ profile_photo_url: photoUrl })
      .eq("id", candidate.id);

    return NextResponse.json({ success: true, immediate: true });
  }

  // If candidate already has a photo, save as pending for admin review
  await supabase
    .from("candidates")
    .update({
      pending_photo_url: photoUrl,
      photo_pending_review: true,
    })
    .eq("id", candidate.id);

  return NextResponse.json({ success: true, pending: true });
}
