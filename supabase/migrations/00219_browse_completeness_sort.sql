-- 00219: browse defaults to the profiles a client can actually judge.
--
-- Context: the 2026-09-07 relist listed the whole pipeline, and 202 of the
-- 223 promoted candidates have no profile photo. Under the previous default
-- sort (newest first) browse opened on a wall of anonymous tiles, which
-- serves neither the client nor the candidates who did finish their profile.
--
-- Ordering only. No filtering: nobody is hidden by this, and the pool count
-- is unchanged — a candidate without a photo is further down, not gone.
--
-- Recreated from 00186 with the select-list and ORDER BY extended; the
-- signature is identical, so existing grants (00137 revoked execute from
-- anon/authenticated; the route calls it as service_role) carry over.

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
        + CASE WHEN jsonb_array_length(coalesce(work_experience, '[]'::jsonb)) >= 1 THEN 8 ELSE 0 END
        + CASE WHEN resume_url IS NOT NULL THEN 5 ELSE 0 END
      ) AS profile_completeness
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
      CASE WHEN p_sort = 'complete' OR p_sort IS NULL THEN profile_completeness END DESC NULLS LAST,
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
