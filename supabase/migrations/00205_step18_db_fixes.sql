-- 00205 — four database defects the step-18 audit confirmed.
--
-- 1. handle_new_user HAS NEVER WORKED IN PRODUCTION. SECURITY DEFINER with no
--    search_path; GoTrue's supabase_auth_admin runs with search_path=auth, so
--    the unqualified '::user_role_type' cast throws 42704 on every signup and
--    the catch-all EXCEPTION swallows it — no profile row from the trigger,
--    ever (proven: profiles.created_at lags auth.users.created_at by 0.5-16s
--    on all recent signups; the app-layer /api/ensure-profile has been the
--    sole creator). Fixed with an empty search_path and full qualification.
--    The exception handler stays — failing the trigger aborts the AUTH signup
--    itself, and ensure-profile remains the belt — but the body works now, so
--    OAuth/invited users get their row without the app-layer path.
--
-- 2. THE 14-DAY ID WINDOW COULD SILENTLY NEVER START. promote_candidate_if_ready
--    approves off the ai_interviews TABLE, but stamp_id_verification_due keys
--    on candidates.ai_interview_passed — a swallowed writeback means approval
--    with id_verification_due_at NULL forever, and every visibility filter
--    treats a NULL due date as compliant. The promote UPDATE now stamps the
--    window itself.
--
-- 3. EITHER PARTY COULD REWRITE THE OTHER'S MESSAGES. "Users can mark messages
--    as read" is FOR UPDATE with a NULL WITH CHECK (the step-15 trap on a
--    second table) and its USING admits both parties on EVERY column — a
--    client could rewrite a candidate's words over PostgREST, and vice versa.
--    Latent (0 rows today), closed before it isn't: the browser keeps UPDATE
--    on read_at alone, and only for messages sent by the OTHER side.
--
-- 4. APPROVALS LEFT NO AUDIT TRAIL. candidate_status_events records every
--    rejection but no approval site writes a row — "who approved this and
--    when" was unanswerable from the table built to answer it. A trigger on
--    the transition covers all five approval sites (and the ones not written
--    yet), same pattern as the 00203 notification.

-- ── 1. the signup trigger ────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role, full_name)
  values (
    new.id,
    new.email,
    (new.raw_user_meta_data->>'role')::public.user_role_type,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;

  if new.raw_user_meta_data->>'role' = 'client' then
    insert into public.clients (user_id, full_name, email, company_name)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      new.email,
      new.raw_user_meta_data->>'company_name'
    )
    on conflict do nothing;
  end if;

  return new;
exception when others then
  raise log 'handle_new_user failed: % %', sqlerrm, sqlstate;
  return new;
end;
$$;

-- ── 2. promote stamps the ID window it enforces ─────────────────────────────
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
         -- The backstop 00155 intended: the window starts AT approval when the
         -- BEFORE-trigger's ai_interview_passed condition missed (swallowed
         -- writeback). Idempotent — an existing stamp or a passed ID wins.
         id_verification_due_at = coalesce(
           c.id_verification_due_at,
           case when c.id_verification_status is distinct from 'passed'
                then now() + interval '14 days' end)
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

  return coalesce(v_new, v_status);
end;
$$;

-- ── 3. messages: read-marking only, on the other side's rows ────────────────
drop policy if exists "Users can mark messages as read" on public.messages;
revoke update on public.messages from anon, authenticated;
grant update (read_at) on public.messages to authenticated;

create policy "Mark received messages read" on public.messages
  for update to authenticated
  using (
    (sender_type = 'candidate' and exists (select 1 from public.clients cl
       where cl.id = messages.client_id and cl.user_id = (select auth.uid())))
    or
    (sender_type = 'client' and exists (select 1 from public.candidates ca
       where ca.id = messages.candidate_id and ca.user_id = (select auth.uid())))
  )
  with check (
    (sender_type = 'candidate' and exists (select 1 from public.clients cl
       where cl.id = messages.client_id and cl.user_id = (select auth.uid())))
    or
    (sender_type = 'client' and exists (select 1 from public.candidates ca
       where ca.id = messages.candidate_id and ca.user_id = (select auth.uid())))
  );

-- ── 4. approvals enter the decision history ─────────────────────────────────
create or replace function public.record_candidate_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.candidate_status_events
    (candidate_id, from_status, to_status, actor_id, actor_role, reason)
  values
    (new.id, old.admin_status::text, 'approved',
     (select auth.uid()),
     -- Approvals arrive via authed staff routes AND service-role machinery
     -- (promote_candidate_if_ready under the candidate's own session). Record
     -- what is knowable; NULL actor + 'system' beats inventing a person.
     case when (select auth.uid()) is null then 'system' else 'staff_or_system' end,
     'admin_status transition recorded by trigger 00205');
  return new;
end $$;

create trigger candidate_approved_status_event
  after update of admin_status on public.candidates
  for each row
  when (new.admin_status = 'approved' and old.admin_status is distinct from 'approved')
  execute function public.record_candidate_approval();
