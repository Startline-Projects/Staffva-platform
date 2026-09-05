-- 00204 — three fixes the adversarial review confirmed against 00202/00203.
--
-- 1. THE ROUTE CHECK ADMITTED '/\evil.com'. `route like '/%'` was written to
--    keep clicks on-platform, but WHATWG URL parsing treats a backslash as a
--    slash in special schemes, so router.push('/\evil.com') resolves to
--    https://evil.com/ and Next hard-navigates cross-origin. Verified live:
--    the old CHECK accepted both '//evil.com' and '/\evil.com'. The new one
--    requires an alphanumeric after the slash, which kills both forms.
--
-- 2. THE MARK-READ RPC BYPASSED THE AAL2 GATE. SECURITY DEFINER runs as the
--    table owner, so the restrictive policy 00203 added is not evaluated
--    inside it: an aal1 session for an MFA-enrolled victim could read nothing
--    but still zero the unread badge — and with candidate email frozen, the
--    badge IS the delivery. The function now applies the same predicate.
--
-- 3. THE APPROVAL NOTIFICATION OVERCLAIMED. "Clients can find you in search
--    right now" is false for a candidate approved while (say) ID-overdue —
--    and the dedupe key means the wrong sentence is the only one they ever
--    get. The copy now states only what the transition guarantees and lets
--    the dashboard, which computes real visibility, say the rest.
--    (Also: the 00203 comment said the trigger covers "all five" approval
--    sites — an INSERT with admin_status already 'approved', as the
--    direct-invite placeholder does, never fires an UPDATE trigger. True
--    today and fine today: that placeholder's user_id is the inviting
--    client, so notifying it would leak into the client's read scope.)

alter table public.candidate_notifications
  drop constraint if exists candidate_notifications_route_check;
alter table public.candidate_notifications
  add constraint candidate_notifications_route_check
  check (route is null or route ~ '^/[A-Za-z0-9]');

create or replace function public.mark_my_notifications_read(p_ids uuid[] default null)
returns int language sql security definer set search_path = '' as $$
  with mine as (
    update public.candidate_notifications n
       set read_at = now()
      from public.candidates c
     where c.id = n.candidate_id
       and c.user_id = (select auth.uid())
       -- Same gate the SELECT policy applies. Without it, this definer
       -- function was the one browser-reachable write that skipped aal2.
       and (select public.mfa_satisfied())
       and n.read_at is null
       and (p_ids is null or n.id = any(p_ids))
    returning 1
  )
  select count(*)::int from mine;
$$;

revoke all on function public.mark_my_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_my_notifications_read(uuid[]) to authenticated;

create or replace function public.notify_candidate_approved()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.candidate_notifications
    (candidate_id, category, title, body, route, dedupe_key)
  values
    (new.id, 'profile',
     'Your profile has been approved',
     'You''re on StaffVA. Your dashboard shows exactly what clients can see and whether anything still hides you from search.',
     '/candidate/dashboard',
     'profile-approved-' || new.id)
  on conflict (candidate_id, dedupe_key) where dedupe_key is not null do nothing;
  return new;
end $$;
