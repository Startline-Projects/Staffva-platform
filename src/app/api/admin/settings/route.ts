import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.user_metadata?.role === "admin" ? user : null;
}

// GET — fetch current settings
export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getAdminClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("*")
    .limit(1)
    .single();

  return NextResponse.json({ settings: data });
}

// POST — update settings
export async function POST(request: Request) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { activationFeeEnabled, activationFeeAmount } = await request.json();

  const supabase = getAdminClient();

  // Get the settings row ID
  const { data: current } = await supabase
    .from("platform_settings")
    .select("id")
    .limit(1)
    .single();

  if (!current) {
    return NextResponse.json({ error: "Settings not found" }, { status: 500 });
  }

  const updateData: Record<string, unknown> = {};
  if (typeof activationFeeEnabled === "boolean") {
    updateData.activation_fee_enabled = activationFeeEnabled;
  }
  if (typeof activationFeeAmount === "number" && activationFeeAmount > 0) {
    updateData.activation_fee_amount = activationFeeAmount;
  }

  const { data: updated } = await supabase
    .from("platform_settings")
    .update(updateData)
    .eq("id", current.id)
    .select()
    .single();

  return NextResponse.json({ settings: updated });
}
