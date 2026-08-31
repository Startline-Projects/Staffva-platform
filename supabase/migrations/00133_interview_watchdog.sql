-- Step 8 of the interview feature: the transcript watchdog's state.
-- watchdog_status: null -> 'done' | 'flagged' | 'error'. The verdict jsonb
-- holds what the model found (categories, quotes, summary) and, for flagged
-- rows, alerted_at once the Slack notice actually went out — kept inside
-- the jsonb so a failed Slack post is retried, not forgotten.
alter table public.interview_bookings
  add column if not exists watchdog_status text,
  add column if not exists watchdog        jsonb;
