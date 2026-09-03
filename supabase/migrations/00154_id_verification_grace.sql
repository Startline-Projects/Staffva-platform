-- ID VERIFICATION MOVES OUT OF THE APPLICATION FLOW (owner's call,
-- 2026-09-03). The old design gated test results and approval on a passed
-- ID check mid-application. The new rule: candidates finish the English
-- test and the interview first, THEN get 14 days to verify their ID.
-- Inside the window they can go live unverified; past it, an unverified
-- profile is hidden from clients until they verify. Enforcement is the
-- visibility predicate itself — checked live at read time, no cron to lag.

-- 1. The deadline stamp.
alter table public.candidates
  add column if not exists id_verification_due_at timestamptz;

-- 2. The clock starts when assessments complete: both English scores pass
--    AND the interview flag flips. BEFORE UPDATE so the stamp rides the
--    same write, whichever app performs it.
create or replace function public.stamp_id_verification_due()
returns trigger
language plpgsql
as $$
begin
  if new.id_verification_due_at is null
     and coalesce(new.english_mc_score, 0) >= 70
     and coalesce(new.english_comprehension_score, 0) >= 70
     and new.ai_interview_passed is true
     and new.id_verification_status is distinct from 'passed'
  then
    new.id_verification_due_at := now() + interval '14 days';
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_id_verification_due on public.candidates;
create trigger stamp_id_verification_due
  before update on public.candidates
  for each row execute function public.stamp_id_verification_due();

-- 3. Approval no longer requires a passed ID. promote_candidate_if_ready
--    loses that one condition; everything else in 00116/00117 stands.
--    (The app-side checkApprovalGates loses the same gate in code.)
-- 4. Client-facing reads hide overdue-unverified candidates:
--    candidate_hire_card and the browse RPC gain the predicate
--      id_verification_status = 'passed'
--      OR id_verification_due_at IS NULL      -- clock not started
--      OR id_verification_due_at > now()      -- inside the window
--    The RPC/view bodies are re-issued in full in the applied migration.
