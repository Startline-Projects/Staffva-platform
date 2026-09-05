-- 00203 — two follow-ups to 00202, both found by recon rather than luck.
--
-- 1. PROFILE APPROVAL HAS FIVE WRITE SITES. admin_status flips to 'approved'
--    in five different routes (profile-review, recruiter/approve,
--    recruiting-manager/approve, admin/candidates/review, and
--    engagements/direct-invite), every one a separate compare-and-swap. Wiring
--    the "you're live" notification into each is five chances to drift and a
--    standing invitation for site number six to forget. A trigger on the
--    transition itself catches all of them, including the ones not written
--    yet. The dedupe key makes an approve → unapprove → approve sequence
--    produce one row, which is the right amount of fanfare.
--    (Scope note, added after review: an UPDATE trigger cannot see an INSERT
--    that arrives already approved — the direct-invite placeholder does this.
--    Fine today, and actually desirable: that placeholder's user_id is the
--    inviting CLIENT, so a notification would land in the client's read
--    scope. 00204 records the same caveat.)
--
-- 2. AAL2 PARITY. recruiter_messages carries the "MFA-enrolled must use aal2"
--    restrictive policy (00161); notification rows now hold previews of those
--    same messages (the staff-reply site copies the first 120 chars), so
--    reading the bell without aal2 would read the thread through the side
--    door. Same qual, same shape.

create or replace function public.notify_candidate_approved()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.candidate_notifications
    (candidate_id, category, title, body, route, dedupe_key)
  values
    (new.id, 'profile',
     'You''re live on StaffVA',
     'Your profile has been approved. Clients can find you in search right now.',
     '/candidate/dashboard',
     'profile-approved-' || new.id)
  on conflict (candidate_id, dedupe_key) where dedupe_key is not null do nothing;
  return new;
end $$;

create trigger candidate_approved_notification
  after update of admin_status on public.candidates
  for each row
  when (new.admin_status = 'approved' and old.admin_status is distinct from 'approved')
  execute function public.notify_candidate_approved();

create policy "MFA-enrolled must use aal2" on public.candidate_notifications
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied()));
