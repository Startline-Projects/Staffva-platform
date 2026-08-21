import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const role = user?.app_metadata?.role;
  if (!user || (role !== "recruiter" && role !== "recruiting_manager")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { calendar_link } = await req.json();
  const admin = getAdminClient();

  // Get current profile for the recruiter name
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, calendar_link")
    .eq("id", user.id)
    .single();

  const recruiterName = profile?.full_name || "Unknown recruiter";
  const isClearing = !calendar_link || calendar_link.trim() === "";
  const isSetting = !isClearing;

  // Build the update payload
  const update: Record<string, unknown> = {
    calendar_link: isSetting ? calendar_link.trim() : null,
  };

  if (isSetting) {
    update.calendar_link_last_set_at = new Date().toISOString();
    update.calendar_link_cleared_at = null;
  } else {
    update.calendar_link_cleared_at = new Date().toISOString();
  }

  const { error } = await admin
    .from("profiles")
    .update(update)
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If clearing, trigger alert flow
  if (isClearing && profile?.calendar_link) {
    // 1. Insert dashboard alert
    await admin.from("calendar_link_alerts").insert({
      recruiter_id: user.id,
      recruiter_name: recruiterName,
    });

    // 2. Send email alerts — to Ahmed + recruiting manager
    const { data: manager } = await admin
      .from("profiles")
      .select("email")
      .eq("role", "recruiting_manager")
      .limit(1)
      .single();

    const recipients = ["sam@glostaffing.com"];
    if (manager?.email && manager.email !== "sam@glostaffing.com") {
      recipients.push(manager.email);
    }

    const subject = `Action required — ${recruiterName} removed their calendar link`;
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <p>${recruiterName} has removed their Google Calendar booking link from their StaffVA profile.</p>
      <p>Candidates assigned to them cannot currently book their second interview.</p>
      <p>Please follow up with ${recruiterName} to restore their calendar link. You can update it directly in the admin panel at <a href="https://staffva.com/admin/recruiters">staffva.com/admin/recruiters</a>.</p>
      <p style="color:#999;margin-top:32px;font-size:12px;border-top:1px solid #e0e0e0;padding-top:16px;">— The StaffVA Team</p>
    </div>`;

    await Promise.all(
      recipients.map((to) =>
        resend.emails.send({
          from: "StaffVA <notifications@staffva.com>",
          to,
          subject,
          html,
        })
      )
    );
  }

  return NextResponse.json({ success: true });
}
