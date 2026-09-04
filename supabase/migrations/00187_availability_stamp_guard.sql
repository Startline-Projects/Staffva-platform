-- Fixes to 00186, found by adversarial review before any of it shipped.
--
-- THE CRITICAL ONE. update_candidate_lock_on_engagement() (00004) writes
-- candidates.availability_status directly: 'not_available' when an engagement
-- goes active, 'available_now' when it is released. 00186's stamp trigger has
-- no depth guard, so it fired on those machine writes and recorded them as
-- "the candidate confirmed their availability today" — clearing the nudge flag
-- and resetting the freshness clock on an answer the candidate never gave.
--
-- That is the exact failure 00186 exists to remove, reintroduced one layer
-- down. It also matters right now, not hypothetically: of the three approved
-- candidates currently reading `not_available`, TWO have lock_status='locked',
-- meaning the engagement trigger set them, not the person.
--
-- pg_trigger_depth() is 1 for a trigger fired by a direct statement and 2+
-- when the statement was itself issued from inside another trigger function.
-- So the guard records human writes and ignores cascade writes.

begin;

create or replace function public.touch_availability_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Only a real change counts. Re-saving the same answer is not new
  -- information, and must not launder a stale answer into a fresh one.
  if new.availability_status is distinct from old.availability_status
     or new.availability_date is distinct from old.availability_date then

    -- ...and only a change the CANDIDATE made. A write arriving from inside
    -- another trigger (engagement lock/release) changes the column without
    -- anyone answering a question, so it must not touch the freshness stamp
    -- or settle the nudge. The column still changes; only the claim that
    -- someone confirmed it is withheld.
    if pg_trigger_depth() <= 1 then
      new.availability_last_updated_at := now();
      new.needs_availability_update := false;
      new.availability_nudge_sent_at := null;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.touch_availability_stamp() is
  'Records availability_last_updated_at for DIRECT writes only. Writes cascading '
  'from update_candidate_lock_on_engagement() change the status without being a '
  'candidate confirmation, so they are deliberately not stamped.';

-- ack_going_live(): the blanket revoke did not reach anon, which holds EXECUTE
-- through the default PUBLIC grant on new functions in some configurations.
-- Being explicit costs nothing and closes the question. (The function is
-- self-scoped by auth.uid(), so an anon call was already a no-op — this is
-- defence in depth, not a live hole.)
revoke all on function public.ack_going_live() from anon;

commit;
