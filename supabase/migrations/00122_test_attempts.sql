-- Server-held test attempts: the server decides what was served, holds the
-- permutation, and grades against the served set.
--
-- What this closes, all verified against the code as it stood:
--   * SELECTIVE SUBMISSION. /api/test/submit graded Object.keys(answers) — the
--     set the CANDIDATE chose to send. Answer only the ten questions you are
--     sure of and you scored 10/10. The server kept no record of what it had
--     served, so it could not know twenty were asked.
--   * THE COSMETIC SHUFFLE. The answer-option permutation was generated
--     server-side and then SENT TO THE CLIENT (shuffled_indices), which
--     unmapped it before submitting. A shared answer key of original indices
--     plus a ten-line userscript translated per-candidate automatically.
--   * PERMANENT ITEM IDS. Real question uuids went to the browser, so a key
--     accumulated across candidates stayed valid forever. Ids are now minted
--     per attempt.
--   * BANK FARMING BY REFRESH. Every fetch dealt a fresh random 20, so
--     refreshing the page walked the whole bank. An unexpired attempt now
--     re-serves the same set.
--   * CLIENT-SIDE TIME LIMIT. The deadline now lives on the attempt row and
--     is enforced at grading.
create table public.test_attempts (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references public.candidates(id) on delete cascade,
  -- The served set, server-side only: array of
  --   { "qid": <real question uuid>, "eph": <per-attempt uuid>,
  --     "map": [display position -> original option index] }
  questions     jsonb not null,
  passage_id    uuid,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  submitted_at  timestamptz
);

create index idx_test_attempts_candidate
  on public.test_attempts (candidate_id, created_at desc);

alter table public.test_attempts enable row level security;
revoke all on public.test_attempts from public, anon, authenticated;

-- Passages get a table instead of a client-side hardcode. The single existing
-- passage shipped in the JS bundle — readable by anyone, served to everyone,
-- on every attempt.
create table public.english_test_passages (
  id            uuid primary key default gen_random_uuid(),
  passage_text  text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table public.english_test_passages enable row level security;
revoke all on public.english_test_passages from public, anon, authenticated;

alter table public.english_test_questions
  add column if not exists passage_id uuid references public.english_test_passages(id);

-- Attempt discriminators for the per-item analytics tables. 53 candidates have
-- retaken and their rows interleave with only created_at to separate attempts.
alter table public.candidate_test_answers
  add column if not exists attempt_id uuid references public.test_attempts(id);
alter table public.question_time_tracking
  add column if not exists attempt_id uuid references public.test_attempts(id);

-- question_time_tracking was written straight from the browser (the one
-- anon-client write that happened to work). It now goes through
-- /api/test/track-time, which translates the per-attempt id and stamps the
-- attempt. Browser write access is revoked; the write policy goes with it.
revoke all on public.question_time_tracking from anon, authenticated;
drop policy if exists "Candidates can insert own time tracking" on public.question_time_tracking;

-- Seed the passages table with the passage that was hardcoded in
-- EnglishTest.tsx, and link the five existing comprehension questions to it.
do $$
declare
  v_passage uuid;
begin
  insert into public.english_test_passages (passage_text)
  values ('Our client submitted a request last Tuesday asking for a revised version of the contract. The original document included a clause that both parties had agreed to remove during the last call. Since then, our team has been waiting on confirmation from the legal department before sending the updated file. We want to make sure all changes are reviewed and approved before anything is shared externally. Please follow up with the client to let them know we expect to have everything ready by end of week.')
  returning id into v_passage;

  update public.english_test_questions
     set passage_id = v_passage
   where section = 'comprehension';
end $$;
