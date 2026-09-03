-- The browse card shows a candidate's video intro where the photo sits — but
-- video intro upload is optional, so the card needs to know whether one
-- exists and what to paint. Adds video_intro_thumbnail_url to the browse RPC
-- (video_intro_status was already returned). The raw video path stays out of
-- this public endpoint: playback happens on the profile page behind its own
-- access path. Body otherwise identical to 00141; grants are retained by
-- CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION get_candidates_with_skills(
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
      video_intro_status, video_intro_thumbnail_url, skills, tools, tagline,
      ai_insight_1, ai_insight_2, english_percentile
    FROM candidates
    WHERE admin_status = 'approved'::admin_status_type
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
      AND (
        p_availability IS NULL
        OR (p_availability = 'available' AND committed_hours = 0)
        OR (p_availability = 'partially_available' AND committed_hours > 0 AND committed_hours < 40)
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
