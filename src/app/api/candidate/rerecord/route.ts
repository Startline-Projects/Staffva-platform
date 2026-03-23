"use server";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: Request) {
  const { candidateId, recordingType } = await req.json();

  if (!candidateId || !["oral_reading", "voice_intro"].includes(recordingType)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Verify candidate exists and is approved
  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, admin_status")
    .eq("id", candidateId)
    .single();

  if (!candidate || candidate.admin_status !== "approved") {
    return NextResponse.json(
      { error: "Only approved candidates can request re-recordings" },
      { status: 403 }
    );
  }

  // Set pending re-record flag
  const updateField =
    recordingType === "oral_reading"
      ? { pending_rerecord_oral: true }
      : { pending_rerecord_intro: true };

  await supabase.from("candidates").update(updateField).eq("id", candidateId);

  return NextResponse.json({ success: true });
}
