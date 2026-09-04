-- Step 13: make the marketplace tell the truth about availability.
--
-- Three claims the product already makes and the database does not keep:
--
--   1. Browse shows every approved candidate as "AVAILABLE NOW", because every
--      client-facing availability signal reads `committed_hours` — a column
--      that is 0 for all 256 rows and is written by nothing. The three live
--      candidates whose availability_status says not_available are advertised
--      as available, and the availability filter is decorative: 'available'
--      matches everyone and 'partially_available' matches nobody.
--
--   2. The dashboard tells an ID-overdue candidate "your profile is hidden
--      from clients". Nothing hides it. Dormant today (all 31 approved have
--      passed) but it is a promise with no mechanism.
--
--   3. `availability_last_updated_at` is supposed to mean "when this person
--      last told us". It has never diverged from created_at for any of the 31,
--      and the browser can write availability_status directly while the stamp
--      stays frozen, so the value can lie by construction.
--
-- (3) is fixed with a trigger rather than in the route, deliberately: the
-- browser holds a direct UPDATE grant on availability_status (ProfileBuilder
-- needs it during the application), so any app-layer stamping is one client
-- away from being bypassed. A trigger is the only place the rule holds for
-- every writer.

begin;

-- ── 1. Availability freshness maintains itself ──────────────────────────────

create or replace function public.touch_availability_stamp()
returns trigger
language plpgsql
as $$
begin
  -- Only a real change counts. Re-saving the same answer is not new
  -- information, and must not launder a stale answer into a fresh one.
  if new.availability_status is distinct from old.availability_status
     or new.availability_date is distinct from old.availability_date then
    new.availability_last_updated_at := now();
    -- Answering settles the nudge loop, whoever did the writing.
    new.needs_availability_update := false;
    new.availability_nudge_sent_at := null;
  end if;
  return new;
end;
$$;

comment on function public.touch_availability_stamp() is
  'Keeps availability_last_updated_at honest for every writer, including the '
  'browser''s direct grant on availability_status.';

-- Note for anyone repairing data later: this fires on the UNDO too. Restoring
-- a row by setting availability_status back re-stamps it and clears the flag,
-- so an "exact" restore silently is not one. Repair the stamp and the flag in
-- a separate UPDATE that touches neither availability_status nor
-- availability_date — the trigger stays out of that one.

drop trigger if exists candidates_touch_availability on public.candidates;
create trigger candidates_touch_availability
  before update on public.candidates
  for each row
  execute function public.touch_availability_stamp();

-- ── 2. A rate has to be a rate ──────────────────────────────────────────────

-- One legacy row sits at 0.00: an `active` applicant from 11 April, before the
-- application form began writing its own placeholder. Moved to 5.00, which is
-- the exact value ApplicationForm writes for every applicant today, so this
-- normalises the row rather than inventing a price for anyone.
update public.candidates set hourly_rate = 5.00 where hourly_rate < 1;

alter table public.candidates
  add constraint candidates_hourly_rate_range
  check (hourly_rate >= 1 and hourly_rate <= 500);

-- ── 3. Going-live acknowledgement ───────────────────────────────────────────

alter table public.candidates
  add column if not exists going_live_ack_at timestamptz;

comment on column public.candidates.going_live_ack_at is
  'When the candidate saw the going-live welcome. Write-once via ack_going_live().';

-- Backfilled for everyone already live: 31 people who have been on the
-- marketplace for months must not be greeted as if they were approved today.
update public.candidates
   set going_live_ack_at = now()
 where admin_status = 'approved'
   and going_live_ack_at is null;

-- Write-once, self-scoped, no column grant. A candidate can mark their own
-- welcome seen and cannot unsee it, cannot touch anyone else's.
create or replace function public.ack_going_live()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.candidates
     set going_live_ack_at = now()
   where user_id = auth.uid()
     and going_live_ack_at is null;
end;
$$;

revoke all on function public.ack_going_live() from public;
grant execute on function public.ack_going_live() to authenticated;

-- ── 4. Marketplace availability reads the answer the candidate gave ─────────

create or replace function get_candidates_with_skills(
  p_search text default null,
  p_roles text[] default null,
  p_country text default null,
  p_min_rate numeric default null,
  p_max_rate numeric default null,
  p_availability text default null,
  p_tier text default null,
  p_us_experience text default null,
  p_skills text[] default null,
  p_sort text default 'newest',
  p_page integer default 1,
  p_page_size integer default 24
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_offset integer;
  v_result json;
BEGIN
  v_offset := (p_page - 1) * p_page_size;

  WITH filtered AS (
    SELECT
      id, display_name, country, role_category, hourly_rate,
      english_written_tier, availability_status,
      availability_date, us_client_experience, bio, total_earnings_usd,
      committed_hours, profile_photo_url, needs_availability_update,
      voice_recording_1_preview_url, created_at, english_mc_score,
      english_comprehension_score, reputation_score, reputation_tier,
      video_intro_status,
      CASE WHEN video_intro_status = 'approved'
           THEN video_intro_thumbnail_url END AS video_intro_thumbnail_url,
      skills, tools, tagline,
      ai_insight_1, ai_insight_2, english_percentile
    FROM candidates
    WHERE admin_status = 'approved'::admin_status_type
      -- A closed account is not a listing.
      AND permanently_blocked = false
      -- The 14-day ID window, enforced where the dashboard already promises
      -- it: overdue and unverified means genuinely absent from the
      -- marketplace, not just told they are. `manual_review` stays listed —
      -- the candidate did their part and is waiting on us.
      AND (
        id_verification_status = 'passed'::id_verification_status_type
        OR id_verification_status = 'manual_review'::id_verification_status_type
        OR id_verification_due_at IS NULL
        OR id_verification_due_at >= now()
      )
      AND (
        p_search IS NULL
        OR display_name ILIKE '%' || p_search || '%'
        OR role_category ILIKE '%' || p_search || '%'
        OR country ILIKE '%' || p_search || '%'
        OR bio ILIKE '%' || p_search || '%'
      )
      AND (
        p_roles IS NULL
        OR array_length(p_roles, 1) IS NULL
        OR EXISTS (SELECT 1 FROM unnest(p_roles) AS pat WHERE role_category ILIKE pat)
      )
      AND (p_country IS NULL OR country ILIKE '%' || p_country || '%')
      AND (p_min_rate IS NULL OR hourly_rate >= p_min_rate)
      AND (p_max_rate IS NULL OR hourly_rate <= p_max_rate)
      -- Availability now means what the candidate said, not a dead column.
      -- 'available'  → ready now. 'partially_available' → free from a date.
      -- Neither matches not_available, which is the whole point: a client
      -- filtering for availability must stop seeing people who said no.
      AND (
        p_availability IS NULL
        OR (p_availability = 'available'
            AND availability_status = 'available_now'::availability_status_type)
        OR (p_availability = 'partially_available'
            AND availability_status = 'available_by_date'::availability_status_type)
      )
      AND (p_tier IS NULL OR p_tier = 'any' OR english_written_tier = p_tier::english_written_tier_type)
      AND (
        p_us_experience IS NULL
        OR (
          p_us_experience = 'yes'
          AND us_client_experience IN (
            'less_than_6_months'::us_experience_type,
            '6_months_to_1_year'::us_experience_type,
            '1_to_2_years'::us_experience_type,
            '2_to_5_years'::us_experience_type,
            '5_plus_years'::us_experience_type
          )
        )
        OR (
          p_us_experience = 'no'
          AND us_client_experience IN (
            'international_only'::us_experience_type,
            'none'::us_experience_type
          )
        )
      )
      AND (
        p_skills IS NULL
        OR array_length(p_skills, 1) IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(p_skills) AS req(term)
          WHERE NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              coalesce(skills, '[]'::jsonb) || coalesce(tools, '[]'::jsonb)
            ) AS x(v)
            WHERE x.v ILIKE '%' || req.term || '%'
          )
        )
      )
  ),
  counted AS (
    SELECT count(*) AS total FROM filtered
  ),
  skill_agg AS (
    SELECT
      s.skill,
      count(*) AS count
    FROM filtered f, jsonb_array_elements_text(f.skills) AS s(skill)
    GROUP BY s.skill
    ORDER BY count DESC, s.skill ASC
    LIMIT 15
  ),
  sorted AS (
    SELECT
      id, display_name, country, role_category, hourly_rate,
      english_written_tier, availability_status,
      availability_date, us_client_experience, bio, total_earnings_usd,
      committed_hours, profile_photo_url, needs_availability_update,
      voice_recording_1_preview_url, created_at, english_mc_score,
      english_comprehension_score, reputation_score, reputation_tier,
      video_intro_status, video_intro_thumbnail_url, skills, tools, tagline,
      ai_insight_1, ai_insight_2
    FROM filtered
    ORDER BY
      CASE WHEN p_sort = 'rate_low' THEN hourly_rate END ASC NULLS LAST,
      CASE WHEN p_sort = 'rate_high' THEN hourly_rate END DESC NULLS LAST,
      CASE WHEN p_sort = 'earnings' THEN total_earnings_usd END DESC NULLS LAST,
      CASE WHEN p_sort = 'tier' THEN english_percentile END DESC NULLS LAST,
      CASE WHEN p_sort = 'newest' OR p_sort IS NULL THEN created_at END DESC NULLS LAST
    LIMIT p_page_size
    OFFSET v_offset
  )
  SELECT json_build_object(
    'candidates', coalesce((SELECT json_agg(row_to_json(s)) FROM sorted s), '[]'::json),
    'total', (SELECT total FROM counted),
    'skill_aggregation', coalesce((SELECT json_agg(json_build_object('skill', sa.skill, 'count', sa.count)) FROM skill_agg sa), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

commit;
