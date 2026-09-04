import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createHash } from "node:crypto";

/**
 * The candidate's own employment references.
 *
 * Everything here runs under the service role because candidate_references has
 * RLS on with zero policies and no grants — the table holds a third party's
 * contact details and has no client-reachable reader. This route is the only
 * door, and it only ever opens onto the caller's own rows.
 *
 * There is NO send. Nothing in this file, or anywhere in the product, composes
 * or queues a message to a reference. The database refuses to record that one
 * was contacted (00179's no-contact-before-release constraint), and the email
 * freeze would suppress it anyway (src/lib/emailFreeze.ts). That is what makes
 * "we are not contacting anyone yet" a fact rather than a promise.
 */

const CONSENT_COPY_VERSION = "ref-v1";
const MAX_REFERENCES = 5;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Addresses that must never be stored as a "reference". */
function isDisallowedAddress(email: string): boolean {
  const lower = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(lower)) return true;
  // Our own domains: a candidate naming StaffVA as their own referee, or
  // pointing outreach back at our support inbox.
  if (/@(staffva\.com|.*\.staffva\.com)$/.test(lower)) return true;
  // Role addresses reach a shared inbox, not the person who was named.
  const local = lower.split("@")[0];
  if (["admin", "support", "info", "help", "noreply", "no-reply", "postmaster",
       "abuse", "security", "billing", "contact"].includes(local)) return true;
  return false;
}

async function candidateFor(userId: string) {
  const { data } = await admin()
    .from("candidates")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.id as string | undefined;
}

/** GET — the caller's own references. Plaintext email included: it is theirs,
 *  they typed it, and they need to be able to correct a typo. */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const candidateId = await candidateFor(user.id);
  if (!candidateId) return NextResponse.json({ references: [] });

  const { data } = await admin()
    .from("candidate_references")
    .select("id, employer_key, full_name, job_title, email, country_code, consent_asserted, contact_state, erased_at")
    .eq("candidate_id", candidateId)
    .order("created_at");

  return NextResponse.json({
    references: (data ?? []).map((r) => ({
      ...r,
      // Erased rows keep their shape so the candidate sees what happened
      // rather than a reference silently vanishing.
      email: r.erased_at ? null : r.email,
    })),
  });
}

/**
 * PUT — replace the reference attached to one employer.
 *
 * Idempotent per employer, which is what the one-per-employer unique
 * constraint is for. Editing is always open: outreach is deferred until after
 * approval, which is precisely the window in which the profile-edit-request
 * flow locks a candidate out, and the candidate is the only person who knows
 * the right address.
 */
export async function PUT(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const candidateId = await candidateFor(user.id);
  if (!candidateId) return NextResponse.json({ error: "No candidate profile" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { employerKey, fullName, jobTitle, email, countryCode, consent } = body as {
    employerKey?: string; fullName?: string; jobTitle?: string;
    email?: string; countryCode?: string; consent?: boolean;
  };

  if (typeof employerKey !== "string" || !employerKey.trim()) {
    return NextResponse.json({ error: "Missing employer" }, { status: 400 });
  }

  const db = admin();

  // A blank submission removes the reference for that employer.
  const wantsRemoval = !fullName?.trim() && !email?.trim();
  if (wantsRemoval) {
    await db.from("candidate_references")
      .delete()
      .eq("candidate_id", candidateId)
      .eq("employer_key", employerKey)
      .is("released_at", null); // never delete one already released for outreach
    return NextResponse.json({ ok: true, removed: true });
  }

  if (typeof email !== "string" || isDisallowedAddress(email)) {
    return NextResponse.json(
      { error: "Enter a work email for a person who agreed to be your reference." },
      { status: 400 }
    );
  }
  if (!consent) {
    return NextResponse.json(
      { error: "Please confirm this person agreed to be your reference." },
      { status: 400 }
    );
  }
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    return NextResponse.json({ error: "Invalid country" }, { status: 400 });
  }

  // The cap is enforced by a trigger too; checking here gives a usable message
  // instead of a 500 from a raised exception.
  const { count } = await db
    .from("candidate_references")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", candidateId)
    .neq("employer_key", employerKey);
  if ((count ?? 0) >= MAX_REFERENCES) {
    return NextResponse.json(
      { error: `You can add up to ${MAX_REFERENCES} references.` },
      { status: 400 }
    );
  }

  const normalized = email.trim().toLowerCase();

  // A tombstone from an erasure request. If this address has asked to be
  // forgotten, it does not come back because a different candidate typed it.
  const hash = createHash("sha256").update(normalized).digest("hex");
  const { data: erased } = await db
    .from("candidate_references")
    .select("id")
    .eq("email_hash", hash)
    .not("erased_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (erased) {
    return NextResponse.json(
      { error: "We can't store this contact. Please use a different reference." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const { error } = await db.from("candidate_references").upsert(
    {
      candidate_id: candidateId,
      employer_key: employerKey,
      full_name: fullName?.trim() || null,
      job_title: jobTitle?.trim() || null,
      email: normalized,
      email_hash: hash,
      country_code: countryCode || null,
      consent_asserted: true,
      consent_asserted_at: now,
      consent_copy_version: CONSENT_COPY_VERSION,
      updated_at: now,
      // contact_state and released_at are deliberately never written here.
      // Their defaults are the promise.
    },
    { onConflict: "candidate_id,employer_key" }
  );

  if (error) {
    console.error("[references] upsert failed:", error.message);
    return NextResponse.json({ error: "We couldn't save that reference." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
