-- ════════════════════════════════════════════════════════════════════════════
-- Migration 00080 — US Client Experience refactor
-- Branch: us-experience-refactor
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY:
--   The old us_experience_type enum (full_time, part_time_contract,
--   international_only, none) is being replaced with five tenure buckets
--   (less_than_6_months, 6_months_to_1_year, 1_to_2_years, 2_to_5_years,
--   5_plus_years) plus the unchanged international_only and none. The
--   us_client_description text column is being dropped (no longer collected
--   in the application form). After this migration the column becomes
--   NULLable so the new hard-gate middleware can route any candidate with
--   us_client_experience IS NULL to /apply/us-experience to re-answer.
--
-- DATA IMPACT (verified against prod 2026-04-19, 246 rows):
--   full_time:           117  → NULL   (must re-enter via gate)
--   part_time_contract:   21  → NULL   (must re-enter via gate)
--   international_only:   21  → unchanged
--   none:                 87  → unchanged
--   total NULLed:        138 rows
--
-- READY TO APPLY:
--   Policy discovery confirmed zero RLS policies reference the column or
--   enum. Sections 1 and 8 are no-ops. Safe to apply.
--
-- TRANSACTION:
--   Run this entire file via the exec_sql RPC in a single call. Do NOT add
--   explicit BEGIN/COMMIT — exec_sql provides an implicit transaction and
--   we learned in 00079 that explicit transaction control breaks it.
-- ════════════════════════════════════════════════════════════════════════════


-- ─── 1. DROP RLS POLICIES ─────────────────────────────────────────────────
-- Policy discovery query confirmed zero policies reference us_client_experience
-- or us_experience_type. Nothing to drop. (Verified 2026-04-19 via SQL Editor.)


-- ─── 2. Drop us_client_description column ───────────────────────────────────
-- The application form no longer collects this free-text field; it has been
-- removed from every read path in Phase 2A.
ALTER TABLE candidates DROP COLUMN IF EXISTS us_client_description;


-- ─── 3. Drop the us_experience index ────────────────────────────────────────
-- Must be dropped before the enum rebuild because the index references the
-- column type. Recreated in section 7 once the new enum is in place.
DROP INDEX IF EXISTS idx_candidates_us_experience;


-- ─── 4. Make us_client_experience nullable ──────────────────────────────────
-- Currently NOT NULL DEFAULT 'none'. Both constraints have to go: the gate
-- requires NULL to be a valid signal, the default would mask un-answered
-- rows, and the section 5 backfill below cannot insert NULLs while the
-- column is still NOT NULL.
ALTER TABLE candidates ALTER COLUMN us_client_experience DROP DEFAULT;
ALTER TABLE candidates ALTER COLUMN us_client_experience DROP NOT NULL;


-- ─── 5. Backfill: NULL out the 138 rows we want re-collected ────────────────
-- 117 full_time + 21 part_time_contract → NULL. After this migration the
-- middleware gate will route these candidates to /apply/us-experience to
-- pick a tenure bucket. The 87 'none' and 21 'international_only' rows are
-- left untouched — both values exist in the new enum.
--
-- Now safe because NOT NULL was dropped in section 4. Must still run BEFORE
-- the enum rebuild in section 6, since after the swap the legacy labels
-- ('full_time', 'part_time_contract') no longer exist in the type and the
-- WHERE clause would not match anything.
UPDATE candidates
   SET us_client_experience = NULL
 WHERE us_client_experience IN ('full_time', 'part_time_contract');
-- Expected: 138 rows updated.


-- ─── 6. Enum rebuild (create-new, swap, rename) ─────────────────────────────
-- Same pattern as migration 00079 used for admin_status_type. We can't
-- ALTER an enum to remove values, so we create a parallel type, cast the
-- column over, drop the original, and rename the new one to match.

CREATE TYPE us_experience_type_new AS ENUM (
  'less_than_6_months',
  '6_months_to_1_year',
  '1_to_2_years',
  '2_to_5_years',
  '5_plus_years',
  'international_only',
  'none'
);

ALTER TABLE candidates
  ALTER COLUMN us_client_experience
  TYPE us_experience_type_new
  USING us_client_experience::text::us_experience_type_new;

DROP TYPE us_experience_type;

ALTER TYPE us_experience_type_new RENAME TO us_experience_type;


-- ─── 7. Recreate the us_experience index ────────────────────────────────────
-- Browse and admin queries filter on this column.
CREATE INDEX idx_candidates_us_experience ON candidates(us_client_experience);


-- ─── 8. RECREATE RLS POLICIES ──────────────────────────────────────────────
-- No policies were dropped in section 1. Nothing to recreate.


-- ─── 9. Rebuild get_candidates_with_skills RPC ──────────────────────────────
-- Last rebuilt in migration 00079 with a 12-parameter signature. The only
-- change here is the p_us_experience filter clause: 'yes' must now match the
-- five new tenure buckets instead of the legacy two values. All other
-- parameters, filters, sort logic, and return fields are byte-identical to
-- the 00079 version.

DROP FUNCTION IF EXISTS get_candidates_with_skills(
  text, text, text, numeric, numeric, text, text, text, text[], text, integer, integer
);

CREATE OR REPLACE FUNCTION get_candidates_with_skills(
  p_search text default null,
  p_role text default null,
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
      video_intro_status, skills, tools, tagline, ai_insight_1, ai_insight_2,
      english_percentile
    FROM candidates
    WHERE admin_status = 'approved'::admin_status_type
      AND (
        p_search IS NULL
        OR display_name ILIKE '%' || p_search || '%'
        OR role_category ILIKE '%' || p_search || '%'
        OR country ILIKE '%' || p_search || '%'
        OR bio ILIKE '%' || p_search || '%'
      )
      AND (p_role IS NULL OR role_category ILIKE '%' || p_role || '%')
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
        OR skills @> to_jsonb(p_skills)
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
      video_intro_status, skills, tools, tagline, ai_insight_1, ai_insight_2
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
