-- 00202 — in-app notifications for candidates.
--
-- The Atlas dashboard greets a live candidate with "We'll notify you here when
-- something happens", and its topbar carries a bell. Shipping that shell over
-- a platform with NO in-app notification system would make the greeting a lie
-- on day one — the recurring defect this rebuild keeps finding (copy that
-- claims what the code does not do), built fresh.
--
-- It also closes real gaps the step-17 notification matrix documented: with
-- candidate email frozen, photo_rejected and interview_cancelled reached the
-- candidate through NOTHING, and for photo_rejected the rejection reason was
-- never stored anywhere at all — the reviewer's note existed only inside a
-- suppressed email body. A notification row is both the delivery surface and
-- the record.
--
-- Writes are service-role only: every event site runs server-side, and letting
-- the browser insert rows would let any candidate manufacture their own
-- "you've been approved" banner. Reads follow the 00194 pattern — one SELECT
-- policy admitting the owner. Mark-as-read goes through a SECURITY DEFINER RPC
-- rather than an UPDATE grant, so the ONLY mutation a browser can express is
-- "stamp read_at=now() on my own rows": no grant to widen later, no column
-- list to forget.

create table public.candidate_notifications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  -- Rendering hint for the bell's icon, not a behavior switch.
  category text not null check (category in
    ('offer','message','contract','review','profile','payout','interview','system')),
  title text not null,
  body text,
  -- Where clicking it lands. App-relative, and the client refuses anything
  -- else — a stored absolute URL would let a compromised writer send
  -- candidates off-platform.
  route text check (route is null or route like '/%'),
  -- Idempotency for retry-prone sites (webhooks, crons). NULL for one-shot
  -- writes; the partial unique index makes a repeat a no-op.
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create unique index candidate_notifications_dedupe_key
  on public.candidate_notifications (candidate_id, dedupe_key)
  where dedupe_key is not null;

-- The bell reads "latest N for me, unread first" — one index serves both the
-- list and the badge count.
create index candidate_notifications_owner_idx
  on public.candidate_notifications (candidate_id, created_at desc);

alter table public.candidate_notifications enable row level security;

revoke all on public.candidate_notifications from anon, authenticated;
grant select on public.candidate_notifications to authenticated;

create policy "Read own notifications" on public.candidate_notifications
  for select to authenticated
  using (exists (select 1 from public.candidates c
                  where c.id = candidate_notifications.candidate_id
                    and c.user_id = (select auth.uid())));

-- p_ids null = mark everything; otherwise just those rows. Either way the
-- candidate join means nobody can mark anyone else's.
create or replace function public.mark_my_notifications_read(p_ids uuid[] default null)
returns int language sql security definer set search_path = '' as $$
  with mine as (
    update public.candidate_notifications n
       set read_at = now()
      from public.candidates c
     where c.id = n.candidate_id
       and c.user_id = (select auth.uid())
       and n.read_at is null
       and (p_ids is null or n.id = any(p_ids))
    returning 1
  )
  select count(*)::int from mine;
$$;

revoke all on function public.mark_my_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_my_notifications_read(uuid[]) to authenticated;
