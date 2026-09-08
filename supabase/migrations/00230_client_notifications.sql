-- 00230 — in-app notifications for clients (client vertical step 3).
--
-- The client side has had no in-app notification of any kind. Every event
-- that happens TO a client — a candidate counters their offer, accepts it,
-- signs the contract, marks a milestone complete and starts the seven-day
-- auto-release clock, cancels an interview, replies to a message — surfaces
-- only if the client happens to reload /team and notice a changed row. Some
-- of those send email; several send nothing at all (milestone marked
-- complete and a candidate's message reply are the starkest: money and
-- conversation moving with no signal anywhere).
--
-- Note for anyone writing copy against this: milestone AUTO-RELEASE is seven
-- days from marked_complete_at; the 48-hour figure in this codebase is the
-- separate DISPUTE window. Review caught the first draft of this step
-- conflating them in three places, including a client email that would have
-- talked someone past their own deadline.
--
-- This is the candidate stack (00202/00203/00204/00215) rebuilt for clients
-- with its four hard-won corrections folded in from the start rather than
-- discovered again:
--   • the route CHECK is the 00204 regex, not `like '/%'` — WHATWG URL
--     parsing treats a backslash as a slash, so '/\evil.com' resolved
--     cross-origin under the naive check;
--   • the mark-read function repeats the aal2 predicate INSIDE the body,
--     because SECURITY DEFINER does not evaluate the restrictive policy —
--     without it an aal1 session could zero the badge it cannot read;
--   • mute enforcement is a BEFORE INSERT trigger, so every writer obeys it
--     with no per-caller check to forget;
--   • the preference writer validates against the mutable set in the body,
--     since an array column cannot CHECK a subquery.
--
-- One difference from the candidate side, and it changes a judgement call:
-- CLIENT EMAIL IS NOT FROZEN. The bell is an addition to a real email
-- channel, not the only messenger. Muting is therefore less dangerous here —
-- but 'contract' and 'payment' still cannot be muted, because a signature
-- request and money moving are the two things a person must not be able to
-- switch off by accident.
--
-- Writes are service-role only. A client who could insert their own rows
-- could manufacture "your candidate accepted" — the browser gets SELECT and
-- one definer function that stamps read_at on its own rows, nothing else.

create table public.client_notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Rendering hint for the bell's icon, not a behavior switch.
  category text not null check (category in
    ('offer','message','contract','engagement','payment','interview','system')),
  title text not null,
  body text,
  -- Where clicking it lands. App-relative, enforced by the hardened pattern.
  route text check (route is null or route ~ '^/[A-Za-z0-9]'),
  -- Idempotency for retry-prone sites (webhooks, crons). NULL for one-shot
  -- writes; the partial unique index makes a repeat a no-op.
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create unique index client_notifications_dedupe_key
  on public.client_notifications (client_id, dedupe_key)
  where dedupe_key is not null;

-- The bell reads the latest N for this client, newest first, and counts the
-- unread separately (the count is NOT derived from the capped list, which
-- would stick at the cap). One index serves both.
create index client_notifications_owner_idx
  on public.client_notifications (client_id, created_at desc);

alter table public.client_notifications enable row level security;

revoke all on public.client_notifications from anon, authenticated;
grant select on public.client_notifications to authenticated;

create policy "Read own client notifications" on public.client_notifications
  for select to authenticated
  using (exists (select 1 from public.clients c
                  where c.id = client_notifications.client_id
                    and c.user_id = (select auth.uid())));

-- Notification bodies quote message previews and contract terms, so they sit
-- behind the same aal2 gate as the tables they summarise (00161).
create policy "MFA-enrolled must use aal2" on public.client_notifications
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied()));

-- p_ids null = mark everything; otherwise just those rows. The clients join
-- means nobody can mark anyone else's, and the aal2 predicate is repeated
-- here because a definer function does not evaluate the policy above.
create or replace function public.mark_my_client_notifications_read(p_ids uuid[] default null)
returns int language sql security definer set search_path = '' as $$
  with mine as (
    update public.client_notifications n
       set read_at = now()
      from public.clients c
     where c.id = n.client_id
       and c.user_id = (select auth.uid())
       and (select public.mfa_satisfied())
       and n.read_at is null
       and (p_ids is null or n.id = any(p_ids))
    returning 1
  )
  select count(*)::int from mine;
$$;

revoke all on function public.mark_my_client_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_my_client_notifications_read(uuid[]) to authenticated;

-- ── Preferences ─────────────────────────────────────────────────────────────
alter table public.clients
  add column if not exists muted_notification_categories text[] not null default '{}';

-- The "contract and payment cannot be muted" rule above is enforced in
-- set_client_notification_prefs — which is worth nothing while the column
-- itself is writable from a browser. clients still carries 00001's
-- `FOR UPDATE USING (auth.uid() = user_id)` policy WITH NO `WITH CHECK`, and
-- never got the lockdown candidates received in 00120, so today a client can
-- PATCH /rest/v1/clients and set muted_notification_categories to anything —
-- including the two categories the trigger would then silently drop. Review
-- caught it.
--
-- Nothing in the browser updates this table (every write goes through a
-- service-role route), so the grant goes rather than being narrowed to a
-- column list: an empty grant cannot be widened by forgetting a column.
revoke insert, update, delete on public.clients from anon, authenticated;

create or replace function public.client_notification_muted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.clients c
    where c.id = new.client_id
      and new.category = any(c.muted_notification_categories)
  ) then
    return null; -- silently skip: a mute is the client's own choice
  end if;
  return new;
end;
$$;

drop trigger if exists client_notifications_mute on public.client_notifications;
create trigger client_notifications_mute
  before insert on public.client_notifications
  for each row execute function public.client_notification_muted();

-- The only writer of the preference. 'contract' and 'payment' are absent
-- from the mutable list on purpose — see the header.
create or replace function public.set_client_notification_prefs(p_muted text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.mfa_satisfied()) then
    raise exception 'MFA is required to change notification settings';
  end if;
  if not (coalesce(p_muted, '{}') <@ array['offer','message','engagement','interview','system']) then
    raise exception 'invalid notification category in mute list';
  end if;
  update public.clients
     set muted_notification_categories = coalesce(p_muted, '{}')
   where user_id = auth.uid();
  -- A caller with no clients row updated nothing. Without this the RPC
  -- returns success and the settings page leaves the switch flipped over a
  -- preference that was never stored.
  if not found then
    raise exception 'no client account for this user';
  end if;
end;
$$;

revoke all on function public.set_client_notification_prefs(text[]) from public;
grant execute on function public.set_client_notification_prefs(text[]) to authenticated;
