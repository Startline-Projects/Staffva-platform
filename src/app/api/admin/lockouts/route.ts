import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { selectIn } from "@/lib/selectIn";

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
  return (profile?.role === "admin" || profile?.role === "recruiting_manager") ? user : null;
}

// GET — List all active lockouts
export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const supabase = getAdminClient();

  const { data: lockouts } = await supabase
    .from("english_test_lockouts")
    .select("*")
    .order("failed_at", { ascending: false });

  if (!lockouts || lockouts.length === 0) {
    return NextResponse.json({ lockouts: [], active: 0, total: 0 });
  }

  // Get candidate details
  const candidateIds = [...new Set(lockouts.map((l) => l.candidate_id).filter(Boolean))];
  const { data: candidates } = await selectIn(candidateIds, (chunk) =>
    supabase
      .from("candidates")
      .select("id, display_name, full_name, email, country, role_category, permanently_blocked")
      .in("id", chunk)
  );

  const candidateMap = new Map((candidates || []).map((c) => [c.id, c]));

  const now = Date.now();
  const enriched = lockouts.map((l) => {
    const expiresAt = l.lockout_expires_at ? new Date(l.lockout_expires_at).getTime() : 0;
    const isActive = expiresAt > now;
    const daysRemaining = isActive ? Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)) : 0;

    return {
      ...l,
      candidate: candidateMap.get(l.candidate_id) || null,
      is_active: isActive,
      days_remaining: daysRemaining,
    };
  });

  return NextResponse.json({
    lockouts: enriched,
    active: enriched.filter((l) => l.is_active).length,
    total: enriched.length,
  });
}

// POST — Override a lockout
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { lockoutId, reason } = await req.json();
  if (!lockoutId || !reason) {
    return NextResponse.json({ error: "lockoutId and reason required" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Expire the lockout immediately
  await supabase
    .from("english_test_lockouts")
    .update({ lockout_expires_at: new Date().toISOString() })
    .eq("id", lockoutId);

  // Also unblock the candidate if permanently blocked
  const { data: lockout } = await supabase
    .from("english_test_lockouts")
    .select("candidate_id")
    .eq("id", lockoutId)
    .single();

  if (lockout?.candidate_id) {
    await supabase
      .from("candidates")
      .update({ permanently_blocked: false, retake_available_at: null })
      .eq("id", lockout.candidate_id);
  }

  // Log the override for audit (parameterized insert — no SQL injection)
  await supabase.from("webhook_log").insert({
    provider: "admin_override",
    event_type: "lockout_override",
    event_id: lockoutId,
    payload: { admin_id: admin.id, reason, lockout_id: lockoutId, timestamp: new Date().toISOString() },
    processed: true,
    processed_at: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, overriddenBy: admin.id });
}
