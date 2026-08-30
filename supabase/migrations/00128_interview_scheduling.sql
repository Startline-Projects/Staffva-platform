-- Client-candidate interview scheduling: availability, bookings, and the
-- atomic booking engine.
--
-- Shape decisions, all deliberate:
--  * Availability is stored as recurring weekly windows in the CANDIDATE'S
--    OWN timezone (minutes-from-midnight per weekday), converted to UTC at
--    slot-generation time. Storing UTC windows would silently shift a
--    Manila candidate's "evenings only" across DST boundaries of the
--    VIEWER'S zone; local-wall-time windows never drift.
--  * Bookings are INSTANT: a slot published on the calendar is bookable
--    without candidate confirmation. The race is settled by a partial unique
--    index, not application logic — two clients claiming the same slot
--    resolve to exactly one row, the loser gets a clean "just taken" error.
--  * All writes go through SECURITY DEFINER RPCs; the browser holds no
--    INSERT/UPDATE grant on bookings. Reads are plain RLS: each party sees
--    their own bookings.
--  * candidate_interviews (the admin-mediated relic where clients asked
--    admin to interview candidates FOR them) is superseded by this and gets
--    removed in a later step.

-- ── Availability ───────────────────────────────────────────────────────────
create table public.candidate_availability (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references public.candidates(id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6), -- 0 = Sunday, JS convention
  start_minute  smallint not null check (start_minute between 0 and 1410),
  end_minute    smallint not null check (end_minute between 30 and 1440),
  created_at    timestamptz not null default now(),
  constraint window_ordered check (start_minute < end_minute),
  constraint window_on_half_hour check (start_minute % 30 = 0 and end_minute % 30 = 0)
);
create index idx_avail_candidate on public.candidate_availability (candidate_id, weekday);

create table public.candidate_availability_blackouts (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references public.candidates(id) on delete cascade,
  day           date not null,  -- in the candidate's own timezone
  created_at    timestamptz not null default now(),
  unique (candidate_id, day)
);

-- Candidates manage their own schedule directly (it is their calendar);
-- column surface is tiny and harmless.
alter table public.candidate_availability enable row level security;
alter table public.candidate_availability_blackouts enable row level security;

create policy "candidate manages own availability" on public.candidate_availability
  for all
  using (exists (select 1 from public.candidates c where c.id = candidate_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.candidates c where c.id = candidate_id and c.user_id = auth.uid()));

create policy "candidate manages own blackouts" on public.candidate_availability_blackouts
  for all
  using (exists (select 1 from public.candidates c where c.id = candidate_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.candidates c where c.id = candidate_id and c.user_id = auth.uid()));

revoke all on public.candidate_availability from anon;
revoke all on public.candidate_availability_blackouts from anon;

-- ── Bookings ───────────────────────────────────────────────────────────────
create table public.interview_bookings (
  id                     uuid primary key default gen_random_uuid(),
  candidate_id           uuid not null references public.candidates(id) on delete cascade,
  client_id              uuid not null references public.clients(id) on delete cascade,
  starts_at              timestamptz not null,
  duration_minutes       integer not null default 30 check (duration_minutes = 30),
  status                 text not null default 'booked'
                         check (status in ('booked','cancelled_by_client','cancelled_by_candidate','completed','no_show')),
  rescheduled_from       uuid references public.interview_bookings(id),
  cancelled_at           timestamptz,
  cancel_reason          text,
  -- Later steps fill these (room, consent, recording, transcript, review):
  room_name              text,
  client_consented_at    timestamptz,
  candidate_consented_at timestamptz,
  recording_path         text,
  transcript             jsonb,
  transcript_status      text,
  created_at             timestamptz not null default now()
);

-- The race-settler: one live booking per candidate-slot, and one upcoming
-- booking per client-candidate pair (finish or cancel one interview before
-- booking the next with the same person).
create unique index uq_booking_slot on public.interview_bookings (candidate_id, starts_at)
  where status = 'booked';
create unique index uq_booking_pair on public.interview_bookings (client_id, candidate_id)
  where status = 'booked';
create index idx_bookings_candidate on public.interview_bookings (candidate_id, starts_at desc);
create index idx_bookings_client on public.interview_bookings (client_id, starts_at desc);

alter table public.interview_bookings enable row level security;

create policy "client reads own bookings" on public.interview_bookings
  for select
  using (exists (select 1 from public.clients cl where cl.id = client_id and cl.user_id = auth.uid()));

create policy "candidate reads own bookings" on public.interview_bookings
  for select
  using (exists (select 1 from public.candidates c where c.id = candidate_id and c.user_id = auth.uid()));

revoke all on public.interview_bookings from anon, authenticated;
grant select on public.interview_bookings to authenticated;

-- ── Helpers ────────────────────────────────────────────────────────────────

-- A timezone that Postgres will definitely accept. Candidates' stored zones
-- are clean IANA names today, but one bad value must degrade to UTC, not
-- take the whole calendar down.
create or replace function public.iv_safe_tz(p_tz text)
returns text
language plpgsql
immutable
as $fn$
begin
  perform ('2026-01-01 00:00:00'::timestamp) at time zone p_tz;
  return p_tz;
exception when others then
  return 'UTC';
end;
$fn$;

-- Booking constants, in one place.
create or replace function public.iv_lead_time() returns interval
language sql immutable as $$ select interval '12 hours' $$;
create or replace function public.iv_horizon() returns interval
language sql immutable as $$ select interval '14 days' $$;

-- Is this exact UTC instant an open, bookable slot for this candidate?
-- The single source of truth: the slot picker lists what this returns true
-- for, and book_interview refuses anything it returns false for.
create or replace function public.iv_slot_is_open(p_candidate_id uuid, p_starts_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tz text;
  v_local timestamp;
  v_minute int;
begin
  -- half-hour grid only
  if extract(second from p_starts_at) <> 0 or (extract(minute from p_starts_at))::int % 30 <> 0 then
    return false;
  end if;
  if p_starts_at < now() + iv_lead_time() or p_starts_at > now() + iv_horizon() then
    return false;
  end if;

  select iv_safe_tz(coalesce(c.time_zone, 'UTC')) into v_tz
    from public.candidates c
   where c.id = p_candidate_id and c.admin_status::text = 'approved';
  if v_tz is null then
    return false; -- unknown or unapproved candidate
  end if;

  v_local := p_starts_at at time zone v_tz;
  v_minute := (extract(hour from v_local))::int * 60 + (extract(minute from v_local))::int;

  -- inside a published window (the whole 30 minutes must fit)
  if not exists (
    select 1 from public.candidate_availability a
     where a.candidate_id = p_candidate_id
       and a.weekday = (extract(dow from v_local))::int
       and a.start_minute <= v_minute
       and a.end_minute >= v_minute + 30
  ) then
    return false;
  end if;

  -- not blacked out (candidate-local date)
  if exists (
    select 1 from public.candidate_availability_blackouts b
     where b.candidate_id = p_candidate_id and b.day = v_local::date
  ) then
    return false;
  end if;

  -- not already taken
  if exists (
    select 1 from public.interview_bookings ib
     where ib.candidate_id = p_candidate_id
       and ib.starts_at = p_starts_at
       and ib.status = 'booked'
  ) then
    return false;
  end if;

  return true;
end;
$fn$;

-- Every open slot in the horizon, for the profile calendar. Public read:
-- the calendar is on the public profile by design; it exposes nothing but
-- times, and booking still requires a signed-in client.
create or replace function public.candidate_open_slots(p_candidate_id uuid)
returns table(starts_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tz text;
  v_day date;
  v_win record;
  v_min int;
  v_slot timestamptz;
begin
  select iv_safe_tz(coalesce(c.time_zone, 'UTC')) into v_tz
    from public.candidates c
   where c.id = p_candidate_id and c.admin_status::text = 'approved';
  if v_tz is null then return; end if;

  -- iterate candidate-local days across the horizon (one extra day each side
  -- so timezone offset never clips the edges)
  for v_day in
    select generate_series(
      (now() at time zone v_tz)::date - 1,
      ((now() + iv_horizon()) at time zone v_tz)::date + 1,
      interval '1 day'
    )::date
  loop
    for v_win in
      select a.start_minute, a.end_minute
        from public.candidate_availability a
       where a.candidate_id = p_candidate_id
         and a.weekday = (extract(dow from v_day))::int
    loop
      v_min := v_win.start_minute;
      while v_min + 30 <= v_win.end_minute loop
        -- local wall time -> UTC instant, DST-correct for dated conversions
        v_slot := (v_day + make_interval(mins => v_min)) at time zone v_tz;
        if iv_slot_is_open(p_candidate_id, v_slot) then
          starts_at := v_slot;
          return next;
        end if;
        v_min := v_min + 30;
      end loop;
    end loop;
  end loop;
  return;
end;
$fn$;

-- ── The booking engine ─────────────────────────────────────────────────────
create or replace function public.book_interview(p_candidate_id uuid, p_starts_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_client uuid;
  v_id uuid;
begin
  select cl.id into v_client
    from public.clients cl
   where cl.user_id = auth.uid();
  if v_client is null then
    raise exception 'Only a signed-in client can book an interview.'
      using errcode = '42501';
  end if;

  if not public.iv_slot_is_open(p_candidate_id, p_starts_at) then
    raise exception 'That time is not available. Please pick another slot.'
      using errcode = 'P0001';
  end if;

  begin
    insert into public.interview_bookings (candidate_id, client_id, starts_at)
    values (p_candidate_id, v_client, p_starts_at)
    returning id into v_id;
  exception
    when unique_violation then
      -- either the slot was claimed a moment ago, or this client already has
      -- an upcoming interview with this candidate
      if exists (
        select 1 from public.interview_bookings ib
         where ib.client_id = v_client and ib.candidate_id = p_candidate_id
           and ib.status = 'booked'
      ) then
        raise exception 'You already have an upcoming interview with this candidate.'
          using errcode = 'P0001';
      end if;
      raise exception 'That slot was just taken. Please pick another time.'
        using errcode = 'P0001';
  end;

  return v_id;
end;
$fn$;

create or replace function public.cancel_interview(p_booking_id uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row public.interview_bookings;
  v_new_status text;
begin
  select * into v_row from public.interview_bookings where id = p_booking_id;
  if v_row.id is null then
    raise exception 'Booking not found.' using errcode = 'P0001';
  end if;
  if v_row.status <> 'booked' then
    raise exception 'This booking is no longer active.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.clients cl where cl.id = v_row.client_id and cl.user_id = v_uid) then
    v_new_status := 'cancelled_by_client';
  elsif exists (select 1 from public.candidates c where c.id = v_row.candidate_id and c.user_id = v_uid) then
    v_new_status := 'cancelled_by_candidate';
  else
    raise exception 'Not your booking.' using errcode = '42501';
  end if;

  update public.interview_bookings
     set status = v_new_status,
         cancelled_at = now(),
         cancel_reason = left(coalesce(p_reason, ''), 300)
   where id = p_booking_id and status = 'booked';

  return v_new_status;
end;
$fn$;

revoke all on function public.iv_slot_is_open(uuid, timestamptz) from public, anon;
revoke all on function public.book_interview(uuid, timestamptz) from public, anon;
revoke all on function public.cancel_interview(uuid, text) from public, anon;
grant execute on function public.candidate_open_slots(uuid) to anon, authenticated, service_role;
grant execute on function public.iv_slot_is_open(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.book_interview(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.cancel_interview(uuid, text) to authenticated, service_role;
