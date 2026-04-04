import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST — Record a profile view
export async function POST(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { candidate_id } = await req.json();
    if (!candidate_id) {
      return NextResponse.json({ error: "Missing candidate_id" }, { status: 400 });
    }

    // Check if user is a client
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      // Not a client — don't record view (candidates/admins don't count)
      return NextResponse.json({ success: true, recorded: false });
    }

    // Upsert — update viewed_at if same client+candidate pair already exists
    await supabase.from("profile_views").upsert(
      {
        candidate_id,
        client_id: client.id,
        viewed_at: new Date().toISOString(),
      },
      { onConflict: "client_id,candidate_id" }
    );

    return NextResponse.json({ success: true, recorded: true });
  } catch (err) {
    console.error("Profile view error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET — Get view stats for a candidate
export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get candidate record
    const { data: candidate } = await supabase
      .from("candidates")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const now = new Date();

    // Views this week (last 7 days)
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: weekViews } = await supabase
      .from("profile_views")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidate.id)
      .gte("viewed_at", weekAgo);

    // Views this month (last 30 days)
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: monthViews } = await supabase
      .from("profile_views")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidate.id)
      .gte("viewed_at", monthAgo);

    // Total views all time
    const { count: totalViews } = await supabase
      .from("profile_views")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidate.id);

    return NextResponse.json({
      weekViews: weekViews || 0,
      monthViews: monthViews || 0,
      totalViews: totalViews || 0,
    });
  } catch (err) {
    console.error("Profile views stats error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
