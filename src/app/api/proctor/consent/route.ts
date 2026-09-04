import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { PROCTOR_CONSENT_VERSION } from "@/lib/proctorConsent";

/**
 * POST /api/proctor/consent — record the candidate's affirmative act.
 * Versioned and timestamped at the moment of the act (counsel-reviewed
 * pattern; never a column default). Re-consent overwrites with the newer
 * version — the latest affirmative act is the operative one.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { version?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.version !== PROCTOR_CONSENT_VERSION) {
    return NextResponse.json({ error: "Unknown consent version" }, { status: 400 });
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await admin
    .from("candidates")
    .update({ proctor_consent_version: PROCTOR_CONSENT_VERSION, proctor_consent_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .select("id");
  if (error || !data?.length) {
    return NextResponse.json({ error: "Could not record consent" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
