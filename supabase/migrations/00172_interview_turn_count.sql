-- Interview 1 appends to ai_interviews.transcript with a read-modify-write.
-- Two overlapping submissions (a retry racing the original, a timer racing
-- a manual stop) both read the same array and the second's blind write
-- erased the first's answer — a question the candidate answered, silently
-- gone from the transcript they are scored on.
--
-- turn_count is the compare-and-set token: the writer includes the count it
-- observed, so the loser of a race updates nothing and the client resyncs
-- instead of clobbering.
alter table public.ai_interviews
  add column if not exists turn_count integer not null default 0;

comment on column public.ai_interviews.turn_count is
  'Length of transcript at the last successful write. Used as an optimistic-concurrency token by the Interview 1 answer route.';

-- Backfill so existing rows are consistent with their transcripts.
update public.ai_interviews
   set turn_count = coalesce(jsonb_array_length(transcript), 0)
 where transcript is not null
   and turn_count = 0;
