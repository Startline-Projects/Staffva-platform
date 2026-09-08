-- 00221: going live is about the PROFILE. Assessments become optional.
--
-- Owner's model change (2026-09-08): a candidate builds a profile and is
-- listed. The English test and the AI interview are optional from here —
-- they raise ranking (00219) and tell the candidate where to improve, and
-- the Vetted badge (2026-09-07) is what separates those who took them.
--
-- The app enforces the same rules in src/lib/approvalGates.ts. These two
-- copies must move together or they will disagree about who may go live —
-- which is exactly the split this file's ancestors were written to close.
--
-- Removed from every function below: the passed `kind='skills'` interview,
-- english_mc_score >= 70, english_comprehension_score >= 70, and
-- interview_consent_at. That column is misnamed: the checkbox behind it is
-- consent to show your VOICE RECORDINGS to clients, not consent to the AI
-- interview (which takes its own consent at interview time). The profile
-- builder still requires it and should — the recordings are mandatory
-- profile content. It is dropped as an approval-gate condition only.
--
-- Retained everywhere: the seven profile conditions — both voice recordings,
-- photo, résumé, tagline, bio, payout method. That set is now precisely
-- "is this profile fit to show a client".

-- ── 1. The promotion judge ────────────────────────────────────────────────
create or replace function public.promote_candidate_if_ready(p_candidate_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
     and c.resume_url is not null
     and c.tagline is not null
     and c.bio is not null
     and c.payout_method is not null
  returning c.admin_status::text into v_new;

  return coalesce(v_new, v_status);
end;
$$;

-- ── 2. The hourly sweep ───────────────────────────────────────────────────
-- The narrowing CTE used to filter on a passed skills interview, for a
-- stated reason: it takes LIMIT 500 ordered by id, so candidates who can
-- never be promoted would permanently occupy slots and crowd out the ready.
-- That reason still holds — so the CTE now narrows on the PROFILE conditions
-- instead. Dropping the filter entirely (rather than replacing it) would
-- have quietly reintroduced the very starvation 00171 fixed.
create or replace function public.promote_ready_candidates(p_limit integer default 500)
returns table(candidate_id uuid, new_status text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
       and c.resume_url is not null
       and c.tagline is not null
       and c.bio is not null
       and c.payout_method is not null
     order by c.id
     limit greatest(coalesce(p_limit, 500), 0)
  )
  select r.id, public.promote_candidate_if_ready(r.id)
    from ready r;
end;
$$;

-- ── 3. The watchdog (plan step 4) ─────────────────────────────────────────
-- alert-health reads this and fires CRITICAL "the promotion path is not
-- running". It could only ever count candidates with a passed skills
-- interview, so leaving it alone while assessments went optional would have
-- made it count zero for ever — a silent watchdog on the funnel's most
-- important transition, looking exactly like everything is fine.
--
-- "Ready and waiting" is now: profile complete, still not approved, and it
-- has been that way for longer than p_older_than. The age comes from
-- profile_completed_at, falling back to created_at so a candidate whose
-- completion was never stamped still trips the alarm rather than hiding.
create or replace function public.count_ready_but_unapproved(p_older_than interval default '01:00:00'::interval)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select count(*)::int
    from public.candidates c
   where c.admin_status::text = 'active'
     and coalesce(c.permanently_blocked, false) = false
     and coalesce(c.profile_completed_at, c.created_at) < now() - p_older_than
     and c.voice_recording_1_url is not null
     and c.voice_recording_2_url is not null
     and c.profile_photo_url is not null
     and c.resume_url is not null
     and c.tagline is not null
     and c.bio is not null
     and c.payout_method is not null;
$$;

-- ── 4. Profile completion ─────────────────────────────────────────────────
-- Required English >= 70 to consider a profile complete, so an unassessed
-- candidate could never get profile_completed_at stamped — which the
-- watchdog above now reads. interview_consent is dropped here as a GATE; the
-- profile builder still requires the underlying consent, which is about
-- publishing voice recordings (see the note at the top of this file).
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
         ( c.voice_recording_1_url is not null
           and c.voice_recording_2_url is not null
           and c.profile_photo_url is not null
           and c.resume_url is not null
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
$fn$;

revoke all on function public.mark_profile_complete() from public, anon;
grant execute on function public.mark_profile_complete() to authenticated, service_role;
