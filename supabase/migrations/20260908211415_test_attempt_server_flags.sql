-- Facts about a sitting that only the SERVER can know.
--
-- Grading already honours a candidate-reported "the prompt audio never
-- played" flag, and that flag lives in open_answers, which the client
-- overwrites wholesale on submit. That is correct for anything the candidate
-- reports, and useless for anything they cannot.
--
-- The case it misses: minting the signed URL for a listening prompt fails.
-- The client then renders no <audio> element at all, so its onError never
-- fires, so the candidate has no way to report a failure they were never
-- shown. Grading sees no recording and scores the part 0 — a keyed zero that
-- counts in the composite denominator, costing 15% of the comprehension score
-- to someone who did nothing wrong.
--
-- The server is the party that knows the mint failed. This is where it says so.
alter table public.test_attempts
  add column if not exists server_flags jsonb not null default '{}'::jsonb;

comment on column public.test_attempts.server_flags is
  'Server-observed problems with this sitting, keyed by the per-attempt '
  'question id (eph). Written only by the deal/resume route; never by the '
  'client, which is the whole point — unlike open_answers.flags it cannot be '
  'overwritten on submit.';
