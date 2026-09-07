-- 00217: DB fixes from the step-23 adversarial review.
--
-- (1) The supabase_realtime publication published UPDATE/DELETE/TRUNCATE
-- too. Supabase's postgres_changes does not RLS-filter DELETE events (only
-- the replica-identity key is available), so a subscriber could watch
-- deletion activity on messages it may not read — and nothing in the app
-- subscribes to anything but INSERT. Publish inserts only.
alter publication supabase_realtime set (publish = 'insert');

-- (2) Tighten the mutable notification categories. The review's finding:
-- muting 'profile' doesn't skip a bell, it DESTROYS the photo reviewer's
-- note — the notification row is that note's only storage (the fallback
-- email is freeze-suppressed). 'interview' is the only channel a cancelled
-- booking reaches a candidate through. 'system' now carries the 2FA-removal
-- security alarm, which must not be mutable by definition. Mutable set is
-- now offer/message/review only.
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
  if not (coalesce(p_muted, '{}') <@ array['offer','message','review']) then
    raise exception 'invalid notification category in mute list';
  end if;
  update public.candidates
     set muted_notification_categories = coalesce(p_muted, '{}')
   where user_id = auth.uid();
end;
$$;

-- Anyone who muted the now-locked categories while 00215 allowed it: unmute.
-- (The feature is unshipped, so this should touch zero rows — belt and
-- braces against the trigger silently eating a reviewer's note.)
update public.candidates
   set muted_notification_categories = (
     select coalesce(array_agg(c), '{}')
     from unnest(muted_notification_categories) as c
     where c in ('offer','message','review')
   )
 where muted_notification_categories && array['contract','payout','profile','interview','system'];

-- (3) ack_dashboard_tour gets the same inline mfa_satisfied() gate as every
-- other definer RPC (the 00204 lesson: definer functions skip the
-- restrictive aal2 policies, so the gate must live in the body). The write
-- is a harmless write-once timestamp, but an aal1 half-session having ANY
-- reachable write is a pattern worth refusing uniformly.
create or replace function public.ack_dashboard_tour()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.mfa_satisfied()) then
    raise exception 'MFA is required';
  end if;
  update public.candidates
     set tour_seen_at = now()
   where user_id = auth.uid()
     and tour_seen_at is null;
end;
$$;
