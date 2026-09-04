-- A permanent block must close the listing, in one place.
--
-- Every client-facing surface filters admin_status = 'approved'. Only two also
-- filter permanently_blocked: get_candidates_with_skills (00186) and
-- /api/match. The landing page, autocomplete, the preview API, both /api/jobs
-- pools, dashboard stats, the public profile page and the candidate_hire_card
-- view all do not — so a row that is `approved` AND `permanently_blocked`
-- stays listed, stays shortlisted, and stays fundable at /hire/<id>/offer,
-- while its own dashboard says "This account is closed".
--
-- That combination is reachable today. The two writers that set
-- permanently_blocked from staff actions also set admin_status in the same
-- UPDATE, so they never produce it. The third does not: src/lib/gradeAttempt.ts
-- (:371 and :419, where permanently_blocked = retakeCount >= 5) writes the flag
-- and never touches admin_status. Nothing in the assessment path gates on
-- admin_status, and 30 of the 31 live candidates have a NULL English score
-- after the reverification reset — i.e. they are the cohort expected to retake.
-- One approved candidate is at retake_count 2 with no cooldown remaining.
--
-- Fixing this by adding `.eq("permanently_blocked", false)` to seven more
-- queries would be seven more places to forget, and could not fix the SQL view
-- at all. The invariant belongs at the write, where it makes the
-- admin_status='approved' filter every surface already has sufficient.

begin;

create or replace function public.block_closes_listing()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.permanently_blocked
     and not coalesce(old.permanently_blocked, false)
     and new.admin_status = 'approved'::admin_status_type then
    -- 'deactivated' is already terminal everywhere that matters: the candidate
    -- dashboard treats it as a closed application, and every client surface
    -- filters admin_status = 'approved'. So the listing and the candidate's own
    -- view of it close in the same statement instead of drifting apart.
    new.admin_status := 'deactivated'::admin_status_type;
  end if;
  return new;
end;
$$;

comment on function public.block_closes_listing() is
  'A permanently blocked candidate cannot remain admin_status=approved. Writers '
  'that set the flag without setting a status (gradeAttempt) would otherwise '
  'leave the profile listed and hireable while the candidate is told it is closed.';

drop trigger if exists candidates_block_closes_listing on public.candidates;
create trigger candidates_block_closes_listing
  before update on public.candidates
  for each row
  execute function public.block_closes_listing();

commit;
