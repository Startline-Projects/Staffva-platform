-- 00170 taught promote_candidate_if_ready about ai_interviews.kind, but two
-- sibling functions that ask the SAME question ("has this candidate passed
-- the interview?") were left kind-blind. Both now mean the skills exam,
-- like the promote RPC and the app-side approval gate.
--
-- count_ready_but_unapproved: the alarm that watches for a stalled
-- promotion path. Kind-blind, it would count every candidate sitting in
-- the intended Interview 1 → Interview 2 gap as "passed the interview but
-- not approved" and fire a CRITICAL "the promotion path is not running"
-- alert that no action could ever clear.
create or replace function public.count_ready_but_unapproved(p_older_than interval default '01:00:00'::interval)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)::int
    from public.candidates c
   where c.admin_status::text = 'active'
     and coalesce(c.permanently_blocked, false) = false
     and exists (
       select 1 from public.ai_interviews i
        where i.candidate_id = c.id
          and i.kind = 'skills'
          and i.status = 'completed'
          and i.passed
          and i.completed_at < now() - p_older_than
     )
     and c.english_mc_score >= 70
     and c.english_comprehension_score >= 70
     and c.voice_recording_1_url is not null
     and c.voice_recording_2_url is not null
     and c.profile_photo_url is not null
     and c.resume_url is not null
     and c.tagline is not null
     and c.bio is not null
     and c.payout_method is not null
     and c.interview_consent_at is not null;
$function$;

-- promote_ready_candidates: the sweep. Its `ready` CTE narrows kind-blind
-- and then takes LIMIT 500 ordered by id, so behavioral-only passers (who
-- can never be promoted) would permanently occupy slots in the batch and
-- crowd out candidates who genuinely are ready.
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
       and exists (
         select 1 from public.ai_interviews i
          where i.candidate_id = c.id
            and i.kind = 'skills'
            and i.status = 'completed'
            and i.passed
       )
     order by c.id
     limit greatest(coalesce(p_limit, 500), 0)
  )
  select r.id, public.promote_candidate_if_ready(r.id)
    from ready r;
end;
$function$;
