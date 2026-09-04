import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = getAdminClient();

  // Get candidate
  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, permanently_blocked, retake_count")
    .eq("user_id", user.id)
    .single();

  if (!candidate) {
    return NextResponse.json({ locked: false });
  }

  if (candidate.permanently_blocked) {
    return NextResponse.json({
      locked: true,
      permanent: true,
      attempt_number: candidate.retake_count,
      message: "After multiple attempts, your English assessment access has been suspended. Contact support@staffva.com if you think this is wrong.",
    });
  }

  // Check identity hash lockout
  const { data: identityRecord } = await supabase
    .from("verified_identities")
    .select("identity_hash")
    .eq("candidate_id", candidate.id)
    .eq("is_duplicate", false)
    .single();

  if (!identityRecord?.identity_hash) {
    return NextResponse.json({ locked: false });
  }

  const { data: lockoutResult } = await supabase.rpc("check_identity_lockout", {
    p_identity_hash: identityRecord.identity_hash,
  });

  const lockout = lockoutResult as { is_locked: boolean; lockout_expires_at: string | null } | null;

  if (lockout?.is_locked) {
    // Get attempt count
    const { count } = await supabase
      .from("english_test_lockouts")
      .select("*", { count: "exact", head: true })
      .eq("identity_hash", identityRecord.identity_hash);

    return NextResponse.json({
      locked: true,
      permanent: false,
      lockout_expires_at: lockout.lockout_expires_at,
      attempt_number: count || 1,
    });
  }

  return NextResponse.json({ locked: false });
}
