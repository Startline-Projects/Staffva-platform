-- 20260911115148: the résumé is retired.
--
-- Candidates no longer upload a CV. A résumé carries a real person's full
-- name, address, phone number and email, and this marketplace deliberately
-- keeps a candidate's contact details away from clients until an engagement
-- exists — so the one document we required of everybody was the one document
-- that undermined that. Work history is already captured as structured
-- entries on the profile, and optional work samples cover the rest.
--
-- WHY THIS MIGRATION MUST LAND BEFORE THE CODE. Four live functions gate
-- going live on `c.resume_url is not null`. Ship the UI change first and
-- every new candidate is stranded permanently: nothing would ever set
-- resume_url again, so promote_candidate_if_ready could never promote them.
-- Removing a condition only ever loosens these gates, so no candidate who
-- passes today stops passing.
--
-- Existing resume_url values are LEFT ALONE. The column stays, the 46 rows
-- holding a value stay, and nothing here deletes a candidate's file. This
-- migration stops the column mattering; it does not destroy history.
-- (Those 46 URLs are dead anyway — they were built with getPublicUrl() on a
-- private bucket and every one returns HTTP 400. That is a separate bug.)
--
-- The candidate-facing mirror of the ranking arithmetic is
-- src/lib/searchRanking.ts, and the checklist is src/lib/profileCompleteness.ts.
-- Change one, change all three.
--
-- HOW THIS REACHED PRODUCTION, so the ledger and this file tell one story.
-- Applied 2026-09-11 in two MCP calls, recorded as:
--     20260911115446  retire_resume_requirement          (sections 1-3)
--     20260911115503  retire_resume_requirement_ranking  (section 4)
-- Section 4 was applied there as a surgical patch of the LIVE definition
-- rather than the literal below, so that nothing outside the two intended
-- edits could drift in an 8.7KB retyped body. The literal below is the
-- authoritative, replayable form: 00224's text (verified byte-identical to
-- the pre-change live definition) carrying exactly those two edits, and the
-- post-apply live definition was verified md5-identical to it.
--
-- NOTE for anyone replaying supabase/migrations from scratch: the folder
-- already aborts earlier, at 00223, which calls btrim() on candidates
-- .payout_method — an enum — so `btrim(payout_method_type) does not exist`.
-- 00223 is recorded in the ledger but its function bodies were never in the
-- database; the live functions this file rewrote were still 00221's. That is
-- a pre-existing defect, and it means the app/DB "what counts as present"
-- parity 00223 was written to fix is still open.

-- ── 1. Going live no longer needs a résumé ────────────────────────────────

create or replace function public.promote_candidate_if_ready(p_candidate_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_owner  uuid;
  v_status text;
  v_new    text;
begin
  select user_id, admin_status::text
    into v_owner, v_status
    from public.candidates
   where id = p_candidate_id;

  if not found then
    return null;
  end if;

  if v_uid is not null and v_owner is distinct from v_uid then
    raise exception 'not authorised to promote candidate %', p_candidate_id
      using errcode = '42501';
  end if;

  if v_status not in ('active', 'pending_2nd_interview') then
    return v_status;
  end if;

  update public.candidates c
     set admin_status = 'approved',
         profile_went_live_at = coalesce(c.profile_went_live_at, now()),
         -- The 14-day ID window still starts AT going live. It used to also
         -- be stamped by a BEFORE trigger keyed on passing assessments
         -- (00154); with assessments optional that trigger will rarely fire,
         -- so this backstop is now the primary start of the clock.
         id_verification_due_at = coalesce(
           c.id_verification_due_at,
           case when c.id_verification_status is distinct from 'passed'
                then now() + interval '14 days' end)
   where c.id = p_candidate_id
     and coalesce(c.permanently_blocked, false) = false
     and c.admin_status::text in ('active', 'pending_2nd_interview')
     and c.voice_recording_1_url is not null
     and c.voice_recording_2_url is not null
     and c.profile_photo_url is not null
     and c.tagline is not null
     and c.bio is not null
     and c.payout_method is not null
  returning c.admin_status::text into v_new;

  return coalesce(v_new, v_status);
end;
$function$;

create or replace function public.promote_ready_candidates(p_limit integer default 500)
returns table(candidate_id uuid, new_status text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  return query
  with ready as (
    select c.id
      from public.candidates c
     where c.admin_status::text in ('active', 'pending_2nd_interview')
       and coalesce(c.permanently_blocked, false) = false
       and c.voice_recording_1_url is not null
       and c.voice_recording_2_url is not null
       and c.profile_photo_url is not null
       and c.tagline is not null
       and c.bio is not null
       and c.payout_method is not null
     order by c.id
     limit greatest(coalesce(p_limit, 500), 0)
  )
  select r.id, public.promote_candidate_if_ready(r.id)
    from ready r;
end;
$function$;

-- ── 2. "Profile complete" no longer needs a résumé ────────────────────────

create or replace function public.mark_profile_complete()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_status text;
  v_complete boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select c.id, c.admin_status::text,
         ( c.voice_recording_1_url is not null
           and c.voice_recording_2_url is not null
           and c.profile_photo_url is not null
           and c.tagline is not null
           and c.bio is not null
           and c.payout_method is not null )
    into v_id, v_status, v_complete
    from public.candidates c
   where c.user_id = v_uid
   order by c.created_at desc
   limit 1;

  if v_id is null then
    return null;
  end if;

  if v_complete then
    update public.candidates
       set profile_completed_at = coalesce(profile_completed_at, now()),
           admin_status = case when admin_status::text = 'revision_required'
                               then 'active'::admin_status_type
                               else admin_status end
     where id = v_id;
  end if;

  select admin_status::text into v_status from public.candidates where id = v_id;
  return v_status;
end;
$function$;

-- ── 3. The admin "ready but unapproved" count ─────────────────────────────

create or replace function public.count_ready_but_unapproved(p_older_than interval default '01:00:00'::interval)
returns integer
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)::int
    from public.candidates c
   where c.admin_status::text = 'active'
     and coalesce(c.permanently_blocked, false) = false
     and coalesce(c.profile_completed_at, c.created_at) < now() - p_older_than
     and c.voice_recording_1_url is not null
     and c.voice_recording_2_url is not null
     and c.profile_photo_url is not null
     and c.tagline is not null
     and c.bio is not null
     and c.payout_method is not null;
$function$;

-- ── 4. Ranking: the résumé's 5 points move to work history ────────────────
-- Taken verbatim from 00224 with two edits: the resume_url term deleted, and
-- work_experience raised 8 -> 13 so the scale still tops out at exactly 100.
-- Leaving it at 95 would mean no profile could ever read "100% complete".

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
      ai_insight_1, ai_insight_2, english_percentile,
      -- Profile completeness, 0-100, derived at query time from what the
      -- candidate has actually filled in. No stored column: a score that
      -- lives in a column drifts the moment someone edits their profile
      -- without the writer remembering to recompute it.
      (
        CASE WHEN profile_photo_url IS NOT NULL THEN 30 ELSE 0 END
        + CASE WHEN video_intro_status = 'approved' AND video_intro_url IS NOT NULL THEN 15 ELSE 0 END
        + CASE WHEN voice_recording_1_url IS NOT NULL THEN 10 ELSE 0 END
        + CASE WHEN bio IS NOT NULL AND length(btrim(bio)) >= 80 THEN 12 ELSE 0 END
        + CASE WHEN tagline IS NOT NULL AND btrim(tagline) <> '' THEN 5 ELSE 0 END
        + CASE WHEN jsonb_array_length(coalesce(skills, '[]'::jsonb)) >= 3 THEN 10 ELSE 0 END
        + CASE WHEN jsonb_array_length(coalesce(tools, '[]'::jsonb)) >= 1 THEN 5 ELSE 0 END
        + CASE WHEN jsonb_array_length(coalesce(work_experience, '[]'::jsonb)) >= 1 THEN 13 ELSE 0 END
      ) AS profile_completeness,
      -- The assessment signal, ORDERING ONLY. Kept separate from
      -- profile_completeness so the "X% complete" a candidate is shown stays
      -- a statement about their PROFILE — adding interview points into that
      -- number would make it unexplainable to the person it describes.
      (
        CASE WHEN ai_interview_passed IS TRUE THEN 25 ELSE 0 END
        + CASE english_written_tier::text
            WHEN 'exceptional' THEN 12
            WHEN 'proficient'  THEN 8
            WHEN 'competent'   THEN 4
            ELSE 0 END
      ) AS assessment_bonus
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
      CASE WHEN p_sort = 'newest' THEN created_at END DESC NULLS LAST,
      -- DEFAULT. Photo is its own key rather than just 30 points, because a
      -- card with no photo renders as an anonymous tile: a fully-filled
      -- profile still can't be the first thing a client sees if there is
      -- nobody's face on it. Completeness then orders within each group.
      CASE WHEN p_sort = 'complete' OR p_sort IS NULL THEN (profile_photo_url IS NOT NULL) END DESC NULLS LAST,
      -- Assessments now move you, which is what makes "take them to rank
      -- higher" true. Deliberately ADDITIVE rather than a sort key of its
      -- own: a vetted candidate with a thin profile should not outrank a
      -- complete unassessed one, because the client is owed the best card
      -- first. Max bonus 37 against a 100-point profile, so assessments are
      -- a strong signal, never an override.
      CASE WHEN p_sort = 'complete' OR p_sort IS NULL
           THEN profile_completeness + assessment_bonus END DESC NULLS LAST,
      -- Stable tiebreak for EVERY sort. Without it the ORDER BY is
      -- non-unique, and LIMIT/OFFSET paging over a non-unique order can
      -- repeat a candidate on page 2 and skip another entirely.
      created_at DESC NULLS LAST,
      id
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
