-- screening_queue.alerted_at
--
-- `processed_at` answered two different questions. The happy path stamps it
-- when a candidate is screened; alertPermanentFailures ALSO stamped it on
-- rows that had failed five times, purely as a "we have emailed about this"
-- marker. A permanently failed screening therefore carried the same evidence
-- as a successful one, and anything asking "when was this candidate last
-- screened?" — including the staleness check that decides whether a tag still
-- describes the record it was computed from — got an answer for a screening
-- that never happened.
--
-- Splitting the two. `processed_at` means screened, and only that.
--
-- No backfill is needed: every one of the 253 rows is 'complete', so no row
-- currently carries an alert stamp. Had any failed row existed, its
-- processed_at would have to be cleared here.

alter table public.screening_queue
  add column if not exists alerted_at timestamptz;

comment on column public.screening_queue.alerted_at is
  'When staff were emailed that this screening permanently failed. Never means the candidate was screened — that is processed_at.';

comment on column public.screening_queue.processed_at is
  'When the candidate was actually screened by the model. Null on anything that has not completed.';

create index if not exists screening_queue_alert_idx
  on public.screening_queue (status, retry_count)
  where alerted_at is null;
