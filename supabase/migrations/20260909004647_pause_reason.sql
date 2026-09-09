-- 20260909004647_pause_reason — the pause modal's two fields, actually stored.
--
-- Atlas's pause modal collects a reason (Slow season / Vacation / Project
-- pivot / Other) and an "expected resume date", and its JS reads neither: the
-- recon records both inputs as "read by nobody". The engagement already
-- carries paused_at and paused_by (00210); these are the two facts the person
-- pausing is asked for and nothing kept.
--
-- Why they are worth storing rather than dropping the inputs:
--   * The candidate is told their engagement stopped and, today, not why. A
--     reason is the difference between "slow season, back in March" and
--     silence — and silence is what the pause notification currently is.
--   * A 30-day auto-END runs on every pause (PAUSE_AUTO_END_DAYS). An
--     expected return date lets both sides see whether the plan fits inside
--     that window before it quietly ends the agreement.
--
-- ⚠️ THE DATE DOES NOT AUTO-RESUME ANYTHING. Atlas promises "contract
-- auto-resumes on the date you set", and we have the opposite automation:
-- 30 days paused terminates the agreement as though notice had run. Nothing
-- here schedules a resume, so every surface must call this an EXPECTATION,
-- never a commitment. Building auto-resume would need its own owner decision
-- — it silently restarts billing.

alter table public.engagements
  add column if not exists pause_reason text
    check (pause_reason is null or pause_reason in
      ('slow_season', 'vacation', 'project_pivot', 'other')),
  -- A DATE, not a timestamp: nobody means 09:00 UTC by "back on the 24th".
  add column if not exists pause_resume_expected date,
  -- Free text only when the reason is 'other', capped so it cannot become a
  -- second message channel. Masked at every read, like every other free-text
  -- field that crosses between the two parties.
  add column if not exists pause_note text
    check (pause_note is null or length(pause_note) <= 300);

-- Both are facts about the CURRENT pause and must not outlive it. Without
-- this, a resumed engagement keeps last winter's "slow season · back Mar 3"
-- and the next pause inherits it — the kind of stale row that makes a
-- displayed fact indefensible.
alter table public.engagements
  drop constraint if exists engagements_pause_reason_scope;
alter table public.engagements
  add constraint engagements_pause_reason_scope check (
    paused_at is not null
    or (pause_reason is null and pause_resume_expected is null and pause_note is null)
  );

comment on column public.engagements.pause_resume_expected is
  'What the pausing party EXPECTS, not a schedule. Nothing auto-resumes; a pause left 30 days ends the agreement (PAUSE_AUTO_END_DAYS).';
