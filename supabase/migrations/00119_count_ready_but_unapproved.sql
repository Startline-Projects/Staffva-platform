-- The alert that replaces 'second_interview_unrouted'.
--
-- That check watched for a candidate who passed the AI interview and was never
-- routed to a human interviewer. There is no human interviewer now, so it can
-- only ever fire falsely -- and it would, on every future pass, because the
-- column it reads (ai_interviews.second_interviewer_email) no longer has a
-- writer. But deleting it outright would leave NOTHING watching the most
-- important transition in the funnel: passing the interview and going live.
--
-- This is the modern equivalent. A candidate who has passed and meets all ten
-- profile gates should be 'approved' within the hour -- promote_candidate_if_ready
-- runs on the pass itself, on profile completion, and hourly via the
-- promote-ready sweep. If one is still sitting unapproved after all three, the
-- promotion path is broken and somebody needs to know. This is the same class of
-- failure as the old check: qualified, invisible, and waiting forever.
--
-- Deliberately counts only 'active': a candidate a human deliberately rejected or
-- deactivated is not a failure, and promote_candidate_if_ready would not touch
-- them either.
create or replace function public.count_ready_but_unapproved(p_older_than interval default '1 hour')
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select count(*)::int
    from public.candidates c
   where c.admin_status::text = 'active'
     and coalesce(c.permanently_blocked, false) = false
     and exists (
       select 1 from public.ai_interviews i
        where i.candidate_id = c.id
          and i.status = 'completed'
          and i.passed
          and i.completed_at < now() - p_older_than
     )
     and c.english_mc_score >= 70
     and c.english_comprehension_score >= 70
     and c.voice_recording_1_url is not null
     and c.voice_recording_2_url is not null
     and c.id_verification_status = 'passed'
     and c.profile_photo_url is not null
     and c.resume_url is not null
     and c.tagline is not null
     and c.bio is not null
     and c.payout_method is not null
     and c.interview_consent_at is not null;
$fn$;

revoke all on function public.count_ready_but_unapproved(interval) from public, anon, authenticated;
grant execute on function public.count_ready_but_unapproved(interval) to service_role;
