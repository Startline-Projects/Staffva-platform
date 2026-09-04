import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * The profile builder's autosave.
 *
 * Every piece of builder state lived in useState and nowhere else, so a
 * refresh, a closed tab, a dead battery or a dropped connection erased all of
 * it — and the Atlas step set roughly triples how much "all of it" is. A
 * candidate on a phone, on mobile data, filling in eight steps, is exactly the
 * person this loses.
 *
 * The draft is scratch space. It is not the profile: nothing reads it except
 * the builder repopulating itself, no gate consults it, and nothing in it is
 * published until the candidate submits. That separation is why it can be
 * written freely on every step change without any of the care a real save
 * needs.
 */

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// A draft is a form, not a filesystem. Bounded so an autosave loop or a pasted
// novel cannot fill the row.
const MAX_DRAFT_BYTES = 96 * 1024;

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data } = await admin()
    .from("candidates")
    .select("profile_draft, profile_draft_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    draft: data?.profile_draft ?? null,
    savedAt: data?.profile_draft_at ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("draft" in body)) {
    return NextResponse.json({ error: "Missing draft" }, { status: 400 });
  }

  const serialized = JSON.stringify((body as { draft: unknown }).draft ?? {});
  if (serialized.length > MAX_DRAFT_BYTES) {
    // Not an error the candidate should see — their typing is fine, our
    // envelope is small. Accept the request, skip the write, and let the next
    // autosave carry a trimmed payload.
    return NextResponse.json({ ok: true, skipped: "too_large" });
  }

  const { error } = await admin()
    .from("candidates")
    .update({
      profile_draft: JSON.parse(serialized),
      profile_draft_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (error) {
    // A failed autosave must never interrupt the candidate. Their work is
    // still on screen; the next save will try again.
    console.error("[profile-draft] save failed:", error.message);
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}

/** DELETE — clear the draft once the profile is really saved. */
export async function DELETE() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await admin()
    .from("candidates")
    .update({ profile_draft: null, profile_draft_at: null })
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
