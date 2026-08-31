-- Step 7 hardening, from the adversarial review of the first pipeline cut:
--  * transcript_claimed_at — a lease on the 'transcribing' claim, so a run
--    killed between claiming and writing job ids leaves a row the next run
--    can reclaim instead of a permanent wedge.
--  * transcript_segments — a call that drops and rejoins produces MULTIPLE
--    recordings; transcribing only the newest fragment would hand the
--    safety review a sliver labeled as the whole interview. Every finished
--    segment's {recording_id, job_id, ...} lives here so all of them get
--    transcribed, merged in order, and eventually deleted.
alter table public.interview_bookings
  add column if not exists transcript_claimed_at timestamptz,
  add column if not exists transcript_segments   jsonb;
