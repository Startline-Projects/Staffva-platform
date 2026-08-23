-- Make "applied but never queued for screening" a visible state.
--
-- 00102 fixed the RLS gap that silently refused the re-screening enqueue, and the
-- form now refuses to advance when the enqueue fails. But the candidate row is
-- marked stage 2 BEFORE the enqueue runs, so someone who hits the error and
-- closes the tab is left having completed stage 2 with no screening_queue row.
--
-- That candidate is invisible to everything: they are not pending, so the stale-
-- queue alert cannot see them; they have no screening_tag, so no recruiter view
-- surfaces them; and they have no failure record, so vendor_failures is empty.
-- They simply never get looked at, which is the exact shape of every other
-- problem found in this codebase.
--
-- This is a function rather than a PostgREST query because the check is a NOT
-- EXISTS across two tables, which the client cannot express directly.
create or replace function public.count_unqueued_stage2_candidates(
  p_older_than_minutes integer default 30
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.candidates c
   where c.stage2_completed_at is not null
     and c.stage2_completed_at < now() - make_interval(mins => p_older_than_minutes)
     and not exists (
       select 1 from public.screening_queue q where q.candidate_id = c.id
     );
$$;

revoke all on function public.count_unqueued_stage2_candidates(integer) from public, anon, authenticated;
grant execute on function public.count_unqueued_stage2_candidates(integer) to service_role;
