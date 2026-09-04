import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * POST /api/staff/references/erase — remove a reference's personal data.
 *
 * A reference is the only person in this product who never agreed to be here.
 * They did not sign up, they were typed in by somebody else, and the first
 * they will hear of us is a message we have not sent yet. The one thing we
 * cannot defer is the ability to take their details out again when they ask.
 *
 * Admin only, and the check is in the database (erase_candidate_reference is
 * SECURITY DEFINER and calls is_admin()), not here — so an added caller cannot
 * forget it.
 *
 * The row survives with its email_hash so the same address cannot be quietly
 * re-added by the same candidate, or by a different one.
 */

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { referenceId } = (await req.json().catch(() => ({}))) as { referenceId?: string };
  if (!referenceId || !/^[0-9a-f-]{36}$/i.test(referenceId)) {
    return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  }

  // Called through the user's own session, so is_admin() inside the function
  // evaluates against the caller rather than the service role.
  const { data, error } = await supabase.rpc("erase_candidate_reference", {
    p_reference_id: referenceId,
  });

  if (error) {
    const forbidden = /Only an admin/i.test(error.message);
    if (!forbidden) console.error("[reference-erase] failed:", error.message);
    return NextResponse.json(
      { error: forbidden ? "Not permitted" : "Could not erase that reference" },
      { status: forbidden ? 403 : 500 }
    );
  }

  // Log it where an auditor would look. Deliberately records WHO asked and
  // WHICH row, and never the address that was removed.
  console.warn(
    `[reference-erase] reference=${referenceId} erased by user=${user.id} at ${new Date().toISOString()}`
  );

  return NextResponse.json({ ok: true, erased: data === true });
}

/** GET — the masked view of one candidate's references, for staff. */
export async function GET(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const candidateId = req.nextUrl.searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "Missing candidate" }, { status: 400 });

  // Staff only. Reuses the same predicate the database uses.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) return NextResponse.json({ error: "Not permitted" }, { status: 403 });

  const { data } = await admin()
    .from("candidate_references")
    .select("id, employer_key, full_name, job_title, email, country_code, contact_state, erased_at, consent_asserted")
    .eq("candidate_id", candidateId)
    .order("created_at");

  return NextResponse.json({
    references: (data ?? []).map((r) => ({
      id: r.id,
      employer_key: r.employer_key,
      full_name: r.erased_at ? null : r.full_name,
      job_title: r.erased_at ? null : r.job_title,
      country_code: r.erased_at ? null : r.country_code,
      contact_state: r.contact_state,
      consent_asserted: r.consent_asserted,
      erased: !!r.erased_at,
      // MASKED, always. Plaintext has no reader: there is nothing to send, so
      // nothing needs the address, and a recruiter browsing profiles has no
      // business collecting former managers' inboxes.
      email_masked: r.erased_at || !r.email ? null : maskEmail(r.email),
    })),
  });
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 1);
  const dparts = domain.split(".");
  return `${head}•••@${dparts[0].slice(0, 1)}•••.${dparts.slice(1).join(".")}`;
}
