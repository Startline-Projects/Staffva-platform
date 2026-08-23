-- Let a candidate actually get (re-)screened after stage 2.
--
-- 00097 moved the screening enqueue from stage 1 to stage 2, because at stage 1
-- the record still holds placeholders and the AI was scoring empty answers --
-- that is what tagged 85% of candidates "Hold". The client does:
--
--   upsert({candidate_id, status:'pending'}, {onConflict:'candidate_id'})
--
-- which Postgres executes as INSERT ... ON CONFLICT DO UPDATE. screening_queue
-- has exactly one policy -- candidates_insert_own_screening, INSERT only -- so
-- RLS permits the INSERT arm and denies the UPDATE arm.
--
-- All 251 existing rows are already status='complete', one per candidate. So
-- the denied arm is the one that matters: every candidate who returns to stage 2
-- to correct the answers that were mis-screened hits the conflict, is refused,
-- and is never re-screened. It fails silently for precisely the population the
-- stage-2 move existed to rescue.
--
-- The obvious fix -- add an UPDATE policy -- is wrong. RLS constrains ROWS, not
-- COLUMNS (the same trap as the `revoke update (role)` no-op in 00095). An
-- UPDATE policy on one's own row also permits status='complete', which is a
-- self-serve way to skip screening entirely.
--
-- So: no UPDATE grant to candidates at all. A SECURITY DEFINER function owns the
-- transition, checks ownership itself, and writes a fixed set of values that the
-- caller cannot influence.
create or replace function public.request_screening(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Ownership is enforced here rather than by a policy, because this function
  -- runs as definer and therefore bypasses RLS entirely.
  if not exists (
    select 1
      from public.candidates
     where id = p_candidate_id
       and user_id = auth.uid()
  ) then
    raise exception 'not authorized to request screening for this candidate'
      using errcode = '42501';
  end if;

  insert into public.screening_queue (candidate_id, status)
  values (p_candidate_id, 'pending')
  on conflict (candidate_id) do update
     set status        = 'pending',
         -- A resubmit is a fresh attempt at fresh answers, so the previous
         -- run's backoff and failure state must not carry over and suppress it.
         retry_count   = 0,
         next_retry_at = null,
         error_text    = null,
         claimed_at    = null,
         processed_at  = null;
end;
$$;

revoke all on function public.request_screening(uuid) from public, anon;
grant execute on function public.request_screening(uuid) to authenticated;
