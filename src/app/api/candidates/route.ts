import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const search = searchParams.get("search");
  const role = searchParams.get("role");
  const country = searchParams.get("country");
  const minRate = searchParams.get("minRate");
  const maxRate = searchParams.get("maxRate");
  const availability = searchParams.get("availability");
  const tier = searchParams.get("tier");
  const speakingLevel = searchParams.get("speakingLevel");
  const usExperience = searchParams.get("usExperience");
  const sort = searchParams.get("sort") || "newest";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = 24;
  const offset = (page - 1) * limit;

  const supabase = getAdminClient();

  let query = supabase
    .from("candidates")
    .select(
      "id, display_name, country, role_category, hourly_rate, english_written_tier, speaking_level, availability_status, availability_date, us_client_experience, bio, total_earnings_usd, committed_hours, profile_photo_url, needs_availability_update, voice_recording_1_preview_url, created_at",
      { count: "exact" }
    )
    .eq("admin_status", "approved");

  // Text search
  if (search) {
    query = query.or(
      `role_category.ilike.%${search}%,display_name.ilike.%${search}%,country.ilike.%${search}%,bio.ilike.%${search}%`
    );
  }

  if (role) {
    query = query.ilike("role_category", `%${role}%`);
  }

  if (country) {
    query = query.ilike("country", `%${country}%`);
  }

  if (minRate) {
    query = query.gte("hourly_rate", parseInt(minRate));
  }

  if (maxRate && parseInt(maxRate) < 150) {
    query = query.lte("hourly_rate", parseInt(maxRate));
  }

  // Availability filter based on committed_hours
  if (availability === "available") {
    query = query.eq("committed_hours", 0);
  } else if (availability === "partially_available") {
    query = query.gt("committed_hours", 0).lt("committed_hours", 40);
  }
  // "all" shows everyone including not available

  if (tier && tier !== "any") {
    query = query.eq("english_written_tier", tier);
  }

  if (speakingLevel && speakingLevel !== "any") {
    query = query.eq("speaking_level", speakingLevel);
  }

  if (usExperience === "yes") {
    query = query.in("us_client_experience", ["full_time", "part_time_contract"]);
  } else if (usExperience === "no") {
    query = query.in("us_client_experience", ["international_only", "none"]);
  }

  // Sorting
  switch (sort) {
    case "rate_low":
      query = query.order("hourly_rate", { ascending: true });
      break;
    case "rate_high":
      query = query.order("hourly_rate", { ascending: false });
      break;
    case "earnings":
      query = query.order("total_earnings_usd", { ascending: false });
      break;
    case "tier":
      query = query.order("english_percentile", { ascending: false });
      break;
    case "newest":
    default:
      query = query.order("created_at", { ascending: false });
      break;
  }

  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    candidates: data || [],
    total: count || 0,
    page,
    totalPages: Math.ceil((count || 0) / limit),
  });
}
