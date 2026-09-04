-- Roll a passed "available from" date forward to "available now".
--
-- Step 13 promoted availability_status from a dead signal to the truth every
-- client surface reads. That exposes a gap nothing previously noticed: a
-- candidate who says "available from 1 October" still reads
-- `available_by_date` on 2 October, and nothing in the platform rolls it
-- forward. Every reader matches the raw enum — get_candidates_with_skills's
-- 'available' branch, both /api/jobs pools, /api/match — so that candidate is
-- excluded from immediate-start work indefinitely, while their card advertises
-- a start date in the past.
--
-- The alternative was to teach four readers to compare dates. That is the
-- shape this codebase keeps getting wrong: N readers, N chances to disagree.
-- Normalising the column instead means every reader is correct for free.
--
-- Write-time coercion in /api/candidate/update-availability stops new lapsed
-- rows being created. This handles rows that lapse with the passage of time,
-- which is not an UPDATE and so has no other trigger.

begin;

create or replace function public.roll_lapsed_availability()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_rows integer := 0;
begin
  -- Two separate statements per row, deliberately. Postgres does not support
  -- updating the same row twice within one statement — data-modifying CTEs all
  -- see the pre-statement snapshot and only one modification takes effect — so
  -- the obvious single-statement "roll, then restore the stamp from a CTE"
  -- silently loses the restore. Verified: it reported success while leaving the
  -- stamp overwritten, which is the exact falsehood this function exists to
  -- avoid. The row count here is tiny by construction.
  for r in
    select id, availability_last_updated_at, needs_availability_update,
           availability_nudge_sent_at
      from candidates
     where availability_status = 'available_by_date'::availability_status_type
       and availability_date is not null
       and availability_date <= current_date
  loop
    update candidates
       set availability_status = 'available_now'::availability_status_type,
           availability_date = null
     where id = r.id;

    -- Put the freshness stamp back. A date passing is the platform noticing,
    -- not the candidate telling us anything, and this column is read as "when
    -- this person last told us". This UPDATE touches neither availability_status
    -- nor availability_date, so touch_availability_stamp() ignores it.
    update candidates
       set availability_last_updated_at = r.availability_last_updated_at,
           needs_availability_update = r.needs_availability_update,
           availability_nudge_sent_at = r.availability_nudge_sent_at
     where id = r.id;

    v_rows := v_rows + 1;
  end loop;

  return v_rows;
end;
$$;

comment on function public.roll_lapsed_availability() is
  'Flips available_by_date rows whose date has passed to available_now, keeping '
  'the freshness stamp intact — the date passing is not a candidate confirmation.';

revoke all on function public.roll_lapsed_availability() from public, anon, authenticated;

commit;
