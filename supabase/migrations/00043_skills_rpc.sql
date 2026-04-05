create or replace function get_candidates_with_skills(
  p_search text default null,
  p_role text default null,
  p_country text default null,
  p_min_rate numeric default null,
  p_max_rate numeric default null,
  p_availability text default null,
  p_tier text default null,
  p_speaking_level text default null,
  p_us_experience text default null,
  p_skills text[] default null,
  p_sort text default 'newest',
  p_page integer default 1,
  p_page_size integer default 24
)
returns json
language plpgsql
as $$
declare
  v_offset integer;
  v_result json;
begin
  v_offset := (p_page - 1) * p_page_size;

  with filtered as (
    select
      id, display_name, country, role_category, hourly_rate,
      english_written_tier, speaking_level, availability_status,
      availability_date, us_client_experience, bio, total_earnings_usd,
      committed_hours, profile_photo_url, needs_availability_update,
      voice_recording_1_preview_url, created_at, english_mc_score,
      english_comprehension_score, reputation_score, reputation_tier,
      video_intro_status, skills, tools, tagline, ai_insight_1, ai_insight_2,
      english_percentile
    from candidates
    where admin_status = 'approved'::admin_status_type
      and (
        p_search is null
        or display_name ilike '%' || p_search || '%'
        or role_category ilike '%' || p_search || '%'
        or country ilike '%' || p_search || '%'
        or bio ilike '%' || p_search || '%'
      )
      and (p_role is null or role_category ilike '%' || p_role || '%')
      and (p_country is null or country ilike '%' || p_country || '%')
      and (p_min_rate is null or hourly_rate >= p_min_rate)
      and (p_max_rate is null or hourly_rate <= p_max_rate)
      and (
        p_availability is null
        or (p_availability = 'available' and committed_hours = 0)
        or (p_availability = 'partially_available' and committed_hours > 0 and committed_hours < 40)
      )
      and (p_tier is null or p_tier = 'any' or english_written_tier = p_tier::english_written_tier_type)
      and (p_speaking_level is null or p_speaking_level = 'any' or speaking_level = p_speaking_level::speaking_level_type)
      and (
        p_us_experience is null
        or (p_us_experience = 'yes' and us_client_experience in ('full_time'::us_experience_type, 'part_time_contract'::us_experience_type))
        or (p_us_experience = 'no' and us_client_experience in ('international_only'::us_experience_type, 'none'::us_experience_type))
      )
      and (
        p_skills is null
        or array_length(p_skills, 1) is null
        or skills @> to_jsonb(p_skills)
      )
  ),
  counted as (
    select count(*) as total from filtered
  ),
  skill_agg as (
    select
      s.skill,
      count(*) as count
    from filtered f, jsonb_array_elements_text(f.skills) as s(skill)
    group by s.skill
    order by count desc, s.skill asc
    limit 15
  ),
  sorted as (
    select
      id, display_name, country, role_category, hourly_rate,
      english_written_tier, speaking_level, availability_status,
      availability_date, us_client_experience, bio, total_earnings_usd,
      committed_hours, profile_photo_url, needs_availability_update,
      voice_recording_1_preview_url, created_at, english_mc_score,
      english_comprehension_score, reputation_score, reputation_tier,
      video_intro_status, skills, tools, tagline, ai_insight_1, ai_insight_2
    from filtered
    order by
      case when p_sort = 'rate_low' then hourly_rate end asc nulls last,
      case when p_sort = 'rate_high' then hourly_rate end desc nulls last,
      case when p_sort = 'earnings' then total_earnings_usd end desc nulls last,
      case when p_sort = 'tier' then english_percentile end desc nulls last,
      case when p_sort = 'newest' or p_sort is null then created_at end desc nulls last
    limit p_page_size
    offset v_offset
  )
  select json_build_object(
    'candidates', coalesce((select json_agg(row_to_json(s)) from sorted s), '[]'::json),
    'total', (select total from counted),
    'skill_aggregation', coalesce((select json_agg(json_build_object('skill', sa.skill, 'count', sa.count)) from skill_agg sa), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;
