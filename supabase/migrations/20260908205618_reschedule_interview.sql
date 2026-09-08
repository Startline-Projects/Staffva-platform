-- 20260908205618_reschedule_interview — the writer rescheduled_from never had.
--
-- interview_bookings.rescheduled_from has existed since 00128 and is named in
-- 00135's column grant, but NOTHING in the application has ever written it.
-- That is not an oversight so much as a consequence: a reschedule cannot be
-- done correctly from the app layer, because of the two partial unique
-- indexes 00128 created.
--
--   uq_booking_pair  (client_id, candidate_id) where status = 'booked'
--
-- Book-then-cancel violates that index — a client may hold only one booked
-- interview per candidate. Cancel-then-book does not, but it is two round
-- trips: if the second fails (slot taken in between, candidate withdrew their
-- availability, network), the client has just lost an interview they were
-- only trying to move, and there is nothing left to roll back to. Atlas has
-- Reschedule buttons on three card states and no flow behind any of them, so
-- there was no reference implementation to copy either.
--
-- Doing it inside one function makes it one transaction: every failure path
-- below raises, which aborts the statement and rolls the cancellation back
-- with it, leaving the original interview standing.
--
-- Validation is NOT reimplemented here — iv_slot_is_open is the same
-- predicate book_interview uses (half-hour grid, lead time, horizon, the
-- candidate's published windows and blackouts, approved candidates only). A
-- second copy of those rules is how the approval gates drifted apart.
--
-- CLIENT-ONLY, deliberately. cancel_interview lets either side act, and
-- mirroring that here looked symmetric but is not: cancelling releases a time,
-- whereas rescheduling WRITES A NEW COMMITMENT into someone else's calendar.
-- A candidate who could do that would move a client's interview without
-- asking, and every notice this sends is phrased from the client's side. A
-- candidate who cannot make the time still has cancel.

create or replace function public.reschedule_interview(
  p_booking_id uuid,
  p_new_starts_at timestamptz,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row public.interview_bookings;
  v_new uuid;
begin
  -- FOR UPDATE, so a concurrent cancel_interview on the same row waits here
  -- rather than interleaving with the checks below.
  select * into v_row
    from public.interview_bookings
   where id = p_booking_id
     for update;
  if v_row.id is null then
    raise exception 'Booking not found.' using errcode = 'P0001';
  end if;
  if v_row.status <> 'booked' then
    raise exception 'This booking is no longer active.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.clients cl
     where cl.id = v_row.client_id and cl.user_id = v_uid
  ) then
    raise exception 'Only the client who booked this interview can move it.'
      using errcode = '42501';
  end if;

  -- Once the room can be opened the call may already be under way, and the
  -- route tears the room down on success — which would eject both parties
  -- mid-interview. Past that line the honest action is cancel, not move.
  -- (15 minutes matches JOIN_EARLY_MS in src/lib/daily.ts.)
  if now() >= v_row.starts_at - interval '15 minutes' then
    raise exception 'This interview is about to start or already has — cancel it instead.'
      using errcode = 'P0001';
  end if;

  if p_new_starts_at = v_row.starts_at then
    raise exception 'That is the time it is already booked for.' using errcode = 'P0001';
  end if;

  -- Retire the old row FIRST. Both partial unique indexes are scoped to
  -- status = 'booked', so this frees the pair slot and stops the booking from
  -- colliding with itself — and it must happen before the check below, or a
  -- move to an adjacent slot would be refused by its own existing row.
  --
  -- The status predicate is not decoration: without it this UPDATE re-evaluates
  -- only on `id` after waiting on the row lock, so a cancellation that
  -- committed while we waited would be silently overwritten and the client
  -- would end up with a new booked interview they had just called off.
  -- cancel_interview carries the same guard.
  update public.interview_bookings
     set status = 'cancelled_by_client',
         cancelled_at = now(),
         cancel_reason = left(coalesce(p_reason, ''), 300)
   where id = p_booking_id
     and status = 'booked';
  if not found then
    raise exception 'This booking just changed — reload and try again.'
      using errcode = 'P0001';
  end if;

  if not public.iv_slot_is_open(v_row.candidate_id, p_new_starts_at) then
    -- Raising rolls the cancellation back: the client keeps the interview
    -- they were trying to move.
    raise exception 'That time is not available. Please pick another slot.'
      using errcode = 'P0001';
  end if;

  begin
    insert into public.interview_bookings
      (candidate_id, client_id, starts_at, rescheduled_from)
    values
      (v_row.candidate_id, v_row.client_id, p_new_starts_at, p_booking_id)
    returning id into v_new;
  exception
    when unique_violation then
      raise exception 'That slot was just taken. Please pick another time.'
        using errcode = 'P0001';
  end;

  return v_new;
end;
$fn$;

-- Same grant shape as book_interview and cancel_interview: never anon.
revoke all on function public.reschedule_interview(uuid, timestamptz, text) from public, anon;
grant execute on function public.reschedule_interview(uuid, timestamptz, text) to authenticated, service_role;

-- Reading the chain backwards ("what was this moved from") is the only access
-- pattern, and it is per-booking; the FK gives no index of its own.
create index if not exists idx_bookings_rescheduled_from
  on public.interview_bookings (rescheduled_from)
  where rescheduled_from is not null;
