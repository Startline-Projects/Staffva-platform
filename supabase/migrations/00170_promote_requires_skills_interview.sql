-- The interview split (00168) gave ai_interviews a `kind`. This RPC's
-- interview check didn't know that, so a passed Interview 1 (behavioral)
-- would satisfy the gate that exists to prove someone can do the WORK —
-- promoting a candidate to approved on half the vetting. Pre-split rows
-- default to 'skills', so history reads exactly as before.
--
-- Everything else in 00154/00155 stands verbatim.
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

  -- A signed-in candidate may only promote themselves. The API routes call
  -- this as service_role, which has no auth.uid(); anon cannot call it at
  -- all, so a null uid here means a trusted server caller.
  if v_uid is not null and v_owner is distinct from v_uid then
    raise exception 'not authorised to promote candidate %', p_candidate_id
      using errcode = '42501';
  end if;

  -- Only ever promote out of the two states that mean "still working
  -- through the funnel". Never resurrect someone a human deliberately put
  -- somewhere else.
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
        where i.candidate_id = c.id
          and i.kind = 'skills'
          and i.status = 'completed'
          and i.passed
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
     and c.interview_consent_at is not null
  returning c.admin_status::text into v_new;

  -- Not promoted is a normal outcome, not a failure: it just means one of
  -- the gates is still open. Return the unchanged status so callers can tell.
  return coalesce(v_new, v_status);
end;
$fn$;
