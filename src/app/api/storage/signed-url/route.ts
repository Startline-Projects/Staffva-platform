import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// voice-recordings are shown publicly (landing + browse previews), so they stay
// open. All other buckets hold sensitive documents (resumes, ID/portfolio,
// signed contracts, video intros) and may only be signed for an authenticated
// staff member — the sole legitimate callers. This closes the previous hole
// where anyone could fetch any private file with no authentication.
const PUBLIC_BUCKETS = new Set(["voice-recordings"]);
const STAFF_BUCKETS = new Set(["resumes", "portfolio", "contracts", "video-intros"]);
const STAFF_ROLES = new Set(["recruiter", "recruiting_manager", "admin"]);

export async function POST(req: NextRequest) {
  const { bucket, path } = await req.json();

  if (!bucket || !path) {
    return NextResponse.json({ error: "Missing bucket or path" }, { status: 400 });
  }

  if (STAFF_BUCKETS.has(bucket)) {
    const user = await getUser();
    const role = user?.app_metadata?.role as string | undefined;
    if (!user || !role || !STAFF_ROLES.has(role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (!PUBLIC_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Invalid bucket" }, { status: 400 });
  }

  // voice-recordings is public ONLY for profile audio. The assessment's
  // answer recordings and the unheard listening prompts live in the same
  // bucket under excluded prefixes (migration 00163) — this route must not
  // become the bypass that signs them for anyone holding a path.
  if (
    typeof path !== "string" ||
    path.includes("..") ||
    path.includes("/assessment/") ||
    path.startsWith("assessment-prompts/")
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Generate a signed URL valid for 1 hour
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 3600);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl });
}
