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
  const { candidateId, recordingType, action, newUrl } = await req.json();

  if (!candidateId || !recordingType || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getAdminClient();

  if (action === "approve" && newUrl) {
    // Replace the live recording URL with the new one
    const updateField =
      recordingType === "oral_reading"
        ? {
            voice_recording_1_url: newUrl,
            pending_rerecord_oral: false,
            pending_oral_url: null,
          }
        : {
            voice_recording_2_url: newUrl,
            pending_rerecord_intro: false,
            pending_intro_url: null,
          };

    await supabase.from("candidates").update(updateField).eq("id", candidateId);
  } else {
    // Reject — clear pending flags
    const clearField =
      recordingType === "oral_reading"
        ? { pending_rerecord_oral: false, pending_oral_url: null }
        : { pending_rerecord_intro: false, pending_intro_url: null };

    await supabase.from("candidates").update(clearField).eq("id", candidateId);
  }

  return NextResponse.json({ success: true });
}
