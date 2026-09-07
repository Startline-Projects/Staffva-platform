-- 00215: per-candidate notification mutes (the Atlas notification-settings
-- view, cut to the channels that exist here: in-app only — candidate email
-- is frozen and WhatsApp has no backend, so those columns render disabled or
-- not at all, and no preference row pretends otherwise).
--
-- 'contract' and 'payout' cannot be muted: under the email freeze the bell
-- is the ONLY delivery for candidate events, and "your contract is ready" /
-- "your payment is blocked" going silently nowhere is the audit's
-- swallow-and-continue pattern as a user preference. Atlas itself marks its
-- pause-warning and payment-issue rows "always on — important".
--
-- Enforcement lives in a BEFORE INSERT trigger on candidate_notifications so
-- EVERY writer respects it — the notifyCandidate lib, admin routes, and the
-- 00203 approval trigger alike — with no per-caller checks to forget.
alter table public.candidates
  add column if not exists muted_notification_categories text[] not null default '{}';

create or replace function public.candidate_notification_muted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.candidates c
    where c.id = new.candidate_id
      and new.category = any(c.muted_notification_categories)
  ) then
    return null; -- silently skip: a mute is the candidate's own choice
  end if;
  return new;
end;
$$;

drop trigger if exists candidate_notifications_mute on public.candidate_notifications;
create trigger candidate_notifications_mute
  before insert on public.candidate_notifications
  for each row execute function public.candidate_notification_muted();

-- The only writer of the preference itself. Validates against the mutable
-- set here (an array column can't CHECK a subquery), self-scoped, and gated
-- on mfa_satisfied() inside the definer (the 00204 lesson: definer functions
-- skip restrictive policies, so the aal2 gate must live in the body).
create or replace function public.set_notification_prefs(p_muted text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.mfa_satisfied()) then
    raise exception 'MFA is required to change notification settings';
  end if;
  if not (coalesce(p_muted, '{}') <@ array['offer','message','interview','profile','review','system']) then
    raise exception 'invalid notification category in mute list';
  end if;
  update public.candidates
     set muted_notification_categories = coalesce(p_muted, '{}')
   where user_id = auth.uid();
end;
$$;

revoke all on function public.set_notification_prefs(text[]) from public;
grant execute on function public.set_notification_prefs(text[]) to authenticated;
