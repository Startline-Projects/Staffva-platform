-- One definition of "this candidate is ready to go live", callable from
-- everywhere that can make it true.
--
-- Removing the second interview left a hole. Passing the AI interview used to
-- move a candidate to 'pending_2nd_interview', where a recruiter picked them up
-- and clicked approve. With the recruiter step gone, nothing moves anyone to
-- 'approved', so every future candidate would strand exactly the way the 21 in
-- 00115 did -- passing everything and waiting forever.
--
-- Two events can complete a candidate, in either order: passing the interview,
-- and finishing Build Your Profile. Whichever happens second is the one that
-- should promote them, so both call this and it decides. Idempotent by
-- construction: it promotes only a candidate who genuinely qualifies, so a
-- redundant call is a no-op rather than a double-approval.
--
-- It lives in the database rather than in either app because there are three
-- call sites across two repositories, and the last time an approval rule was
-- duplicated across two routes they drifted -- one required the interview and
-- the other silently did not, leaving 41 candidates approvable through one door
-- and refused at the other.
--
-- The requirements are the same ten profile gates plus a passed interview that
-- checkApprovalGates and checkApprovalPreconditions enforce in the app, and
-- that 00115 used. Deliberately keyed on ai_interviews.passed alone rather than
-- a second hardcoded score floor: interview_config.pass_threshold is 60 today
-- and across all 52 completed interviews `passed` has never once disagreed with
-- a >= 60 rule, so a second definition would add drift risk and no safety.
create or replace function public.promote_candidate_if_ready(p_candidate_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
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

  -- A signed-in candidate may only promote themselves. The API routes call this
  -- as service_role, which has no auth.uid(); anon cannot call it at all (see
  -- the grants below), so a null uid here means a trusted server caller.
  if v_uid is not null and v_owner is distinct from v_uid then
    raise exception 'not authorised to promote candidate %', p_candidate_id
      using errcode = '42501';
  end if;

  -- Only ever promote out of the two states that mean "still working through
  -- the funnel". Never resurrect someone a human deliberately put somewhere
  -- else: rejected, deactivated, duplicate_blocked, changes_requested,
  -- under_review and revision_required all stay exactly where they are.
  if v_status not in ('active', 'pending_2nd_interview') then
    return v_status;
  end if;

  update public.candidates c
     set admin_status = 'approved',
         profile_went_live_at = coalesce(c.profile_went_live_at, now())
   where c.id = p_candidate_id
     and coalesce(c.permanently_blocked, false) = false
     and c.admin_status::text in ('active', 'pending_2nd_interview')
     and exists (
       select 1 from public.ai_interviews i
        where i.candidate_id = c.id and i.status = 'completed' and i.passed
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
     and c.interview_consent_at is not null
  returning c.admin_status::text into v_new;

  -- Not promoted is a normal outcome, not a failure: it just means one of the
  -- gates is still open. Return the unchanged status so callers can tell.
  return coalesce(v_new, v_status);
end;
$fn$;

revoke all on function public.promote_candidate_if_ready(uuid) from public, anon;
grant execute on function public.promote_candidate_if_ready(uuid) to authenticated, service_role;
