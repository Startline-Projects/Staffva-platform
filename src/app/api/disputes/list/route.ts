import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.user_metadata?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "open";

  const admin = getAdminClient();

  let query = admin
    .from("disputes")
    .select("*")
    .order("filed_at", { ascending: false });

  if (status === "open") {
    query = query.is("resolved_at", null);
  } else {
    query = query.not("resolved_at", "is", null);
  }

  const { data: disputes } = await query;

  // Enrich with engagement, client, and candidate info
  const engagementIds = [...new Set((disputes || []).map((d) => d.engagement_id))];

  const { data: engagements } = await admin
    .from("engagements")
    .select("id, client_id, candidate_id, contract_type")
    .in("id", engagementIds.length > 0 ? engagementIds : ["none"]);

  const engMap = Object.fromEntries(
    (engagements || []).map((e) => [e.id, e])
  );

  // Get names
  const clientIds = [...new Set((engagements || []).map((e) => e.client_id))];
  const candidateIds = [...new Set((engagements || []).map((e) => e.candidate_id))];

  const { data: clients } = await admin
    .from("clients")
    .select("id, full_name")
    .in("id", clientIds.length > 0 ? clientIds : ["none"]);

  const { data: candidates } = await admin
    .from("candidates")
    .select("id, display_name")
    .in("id", candidateIds.length > 0 ? candidateIds : ["none"]);

  const clientMap = Object.fromEntries(
    (clients || []).map((c) => [c.id, c.full_name])
  );
  const candidateMap = Object.fromEntries(
    (candidates || []).map((c) => [c.id, c.display_name])
  );

  const enriched = (disputes || []).map((d) => {
    const eng = engMap[d.engagement_id];
    return {
      ...d,
      contract_type: eng?.contract_type || "unknown",
      client_name: eng ? clientMap[eng.client_id] || "Unknown" : "Unknown",
      candidate_name: eng
        ? candidateMap[eng.candidate_id] || "Unknown"
        : "Unknown",
    };
  });

  return NextResponse.json({ disputes: enriched });
}
