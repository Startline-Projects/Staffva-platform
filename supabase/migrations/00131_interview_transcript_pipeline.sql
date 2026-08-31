-- Step 7 of the interview feature: the transcription pipeline's state.
-- transcript_status (00128) walks: null -> 'transcribing' -> 'done',
-- with 'no_recording' and 'error' as terminal detours. These columns carry
-- the vendor-side ids the cron needs to poll jobs and later delete the
-- recording once its retention window closes.
alter table public.interview_bookings
  add column if not exists recording_id         text,
  add column if not exists transcript_job_id    text,
  add column if not exists recording_deleted_at timestamptz;

create index if not exists idx_bookings_transcript_sweep
  on public.interview_bookings (transcript_status, starts_at)
  where room_name is not null;
