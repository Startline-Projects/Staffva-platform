-- Close the self-approval hole.
--
-- The candidates UPDATE policy was USING (auth.uid() = user_id) with no
-- WITH CHECK and no column restriction, and `authenticated` held UPDATE on all
-- 131 columns. Any signed-in candidate could set their own admin_status to
-- 'approved', their English scores to 100, and id_verification_status to
-- 'passed' from the browser -- bypassing the English test, ID verification, the
-- AI interview, and promote_candidate_if_ready. The client code was in fact
-- already exercising a milder form of this: IDVerification.tsx wrote
-- id_verification_status='passed' from the browser in three places, one of them
-- an explicit "auto-pass after 30 seconds" fallback.
--
-- The fix is column-level grants: the browser keeps exactly the columns the
-- application flow legitimately writes, and loses everything that is a
-- decision. Server routes are unaffected -- every server-side write in the
-- repo uses the service role (verified: zero user-context server writers).
--
-- (1) The one admin_status transition the client performed moves into an RPC.
--
-- Completing the profile used to set admin_status='active' from the browser,
-- guarded by a JS status list. The default admin_status is already 'active',
-- so for the normal funnel this was a no-op; the statuses it COULD flip
-- included 'rejected' and 'deactivated' -- meaning a rejected candidate could
-- reactivate themselves by re-saving their profile. The RPC keeps the one
-- legitimate case: 'revision_required' -> 'active' (a candidate who was asked
-- to fix their profile, and has), and only when the profile is actually
-- complete. Everything else is a no-op. Notably 'ai_interview_failed' no
-- longer flips: finishing your profile should not clear an interview failure.
create or replace function public.mark_profile_complete()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
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
         ( c.english_mc_score >= 70
           and c.english_comprehension_score >= 70
           and c.voice_recording_1_url is not null
           and c.voice_recording_2_url is not null
           and c.profile_photo_url is not null
           and c.resume_url is not null
           and c.tagline is not null
           and c.bio is not null
           and c.payout_method is not null
           and coalesce(c.interview_consent, true) )
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
$fn$;

revoke all on function public.mark_profile_complete() from public, anon;
grant execute on function public.mark_profile_complete() to authenticated, service_role;

-- (2) The row policies.
--
-- The recruiter UPDATE policy is dropped outright: it had zero client-side
-- consumers (every recruiter surface writes through server routes with the
-- service role), and it let any recruiter session rewrite any column on any
-- assigned candidate from a browser. Unused privilege is attack surface.
drop policy if exists "Recruiters can update assigned candidates" on public.candidates;

-- The candidate UPDATE policy gains the WITH CHECK it always needed, so a row
-- cannot be handed to another user even if user_id ever re-enters the grant.
drop policy if exists "Candidates can update own record" on public.candidates;
create policy "Candidates can update own record"
  on public.candidates for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- (3) The column grants. This is the actual lock.
revoke insert, update, delete on public.candidates from anon, authenticated;

-- What the signup form inserts, and nothing else. admin_status, every score,
-- and every verification state fall to their column defaults.
grant insert (
  user_id, full_name, first_name, last_name, display_name, email, country,
  role_category, custom_role_description, years_experience, hourly_rate,
  time_zone, us_client_experience, application_stage, stage1_completed_at
) on public.candidates to authenticated;

-- What the application flow updates: identity-free profile fields, consent
-- attestations, progress markers, and the storage pointers for uploads the
-- candidate makes themselves. Conspicuously absent: admin_status,
-- english_mc_score, english_comprehension_score, id_verification_status,
-- ai_interview_*, anticheat_*, cheat_flag_count, test_lockout_until,
-- screening_*, assigned_recruiter, payout_status, permanently_blocked,
-- profile_went_live_at, stripe_*.
grant update (
  full_name, first_name, last_name, display_name, country, role_category,
  custom_role_description, application_stage, stage1_completed_at,
  years_experience, bio, skills, tools, us_client_experience, linkedin_url,
  stage2_completed_at, hourly_rate, time_zone, application_step,
  integrity_pledge_accepted, integrity_pledge_accepted_at,
  results_display_unlocked, test_started_at,
  id_verification_consent, id_verification_consent_at,
  id_verification_consent_version,
  voice_recording_1_url, voice_recording_2_url,
  tagline, work_experience, payout_method, availability_status,
  availability_date, profile_completed_at,
  interview_consent, interview_consent_at, interview_consent_version,
  profile_photo_url, resume_url
) on public.candidates to authenticated;
