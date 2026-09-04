-- Interview 2 gains a role-specific performance task.
--
-- The conversation already probes the role by voice. What nothing in either app
-- has ever observed is the candidate OPERATING A COMPUTER to produce a correct
-- record — reading a messy client artifact and getting the dates, names, money
-- and references right. That is the job, and unlike an answer it cannot be
-- delivered fluently. The task is scored by our own code against a key we hold,
-- so it costs no vendor call, survives an outage, and an appeal can be re-run.
--
-- Every column here is NULLABLE and nothing reads them yet. The 58 existing
-- rows (1 completed, 52 failed_technical from the 00143 re-verification reset,
-- 5 in_progress from April-June) read exactly as they do today.
--
-- INVARIANT for whoever writes 00177 and after: NO SECURITY DEFINER function
-- may reference a task_* column. promote_candidate_if_ready (00170),
-- count_ready_but_unapproved and promote_ready_candidates (00171) are pinned to
-- kind='skills' and must stay task-BLIND. 30 of the 31 approved candidates
-- already fail the existing EXISTS clause — they were approved by 00151 off
-- candidates.ai_interview_passed, not off this table — so a second clause they
-- would also fail turns a latent inconsistency into a delisting.

alter table public.ai_interviews
  add column if not exists task_key               text,
  add column if not exists task_variant           text,
  add column if not exists task_seed              text,
  add column if not exists task_role_category     text,
  add column if not exists task_mapping_rule      text,
  add column if not exists task_mapping_confident boolean,
  add column if not exists task_status            text,
  add column if not exists task_score_pct         numeric(5,2),
  add column if not exists task_served_at         timestamptz,
  add column if not exists task_submitted_at      timestamptz;

-- NOT VALID: constrains every new write without rewriting the table and
-- without failing on the legacy rows, which are all NULL here by construction.
alter table public.ai_interviews
  drop constraint if exists ai_interviews_task_status_check;
alter table public.ai_interviews
  add constraint ai_interviews_task_status_check
  check (task_status is null
         or task_status in ('served', 'submitted', 'scored', 'abandoned'))
  not valid;

-- Every sibling score column on this table is range-checked: overall_score
-- 0..100 and five dimension columns 0..20. This one is too, before any reader
-- does arithmetic on it.
alter table public.ai_interviews
  drop constraint if exists ai_interviews_task_score_pct_check;
alter table public.ai_interviews
  add constraint ai_interviews_task_score_pct_check
  check (task_score_pct is null
         or (task_score_pct >= 0 and task_score_pct <= 100))
  not valid;

-- 'not_run' is deliberately NOT a status value. NULL already means it, and
-- encoding one fact two ways is exactly what 00173 did to parked_reason — the
-- alert has carried .or("parked_reason.is.null,parked_reason.neq.…") and a
-- five-line comment ever since.
comment on column public.ai_interviews.task_status is
  'NULL = no task phase existed (every pre-00174 row, and any interview where '
  'the task was never served). Readers MUST treat NULL as absence of evidence, '
  'never as a zero. A real 0.00 in task_score_pct is a score; NULL is not.';

comment on column public.ai_interviews.task_role_category is
  'The role the task was CHOSEN for, snapshotted at serve time. The router reads '
  'ai_interviews.role_category and NEVER candidates.role_category: 00120 grants '
  'authenticated UPDATE on that column, so a candidate could otherwise change '
  'their role between seeing the task description and being served it, and pick '
  'their own exam.';

comment on column public.ai_interviews.task_mapping_rule is
  'How the router decided: exact | phrase:<phrase> | default | conjunction | '
  'ambiguous | empty. Stored so "which candidates did we guess at?" is one '
  'query rather than a re-derivation.';

comment on column public.ai_interviews.task_seed is
  'Authoritative. Generated once at serve and read back on every resume, never '
  'recomputed — deriving it from the interview id would put the seed in the '
  'candidate''s own URL bar.';

-- Deliberately NOT backfilled: task_role_category means "the role this task was
-- chosen for", and for a row where no task was ever served there is no such
-- role. Filling it from role_category would invent an answer to a question
-- nobody asked, and it is the same mistake as making 'not_run' a status — a
-- value that means "there is nothing here" is worse than the NULL that already
-- says so.

-- Only ever queried for rows that HAVE a task, which is none of the legacy
-- rows and will stay a minority for a while. Partial keeps it small.
create index if not exists ai_interviews_task_status_idx
  on public.ai_interviews (task_status, task_key)
  where task_status is not null;

-- NOTE: an earlier version of this migration ended with a column-level
-- `revoke update (task_*) ... from authenticated, anon`. It was a no-op — a
-- column-level revoke cannot narrow a table-level grant, and every task column
-- stayed writable. 00177 does it properly by revoking INSERT and UPDATE on the
-- table, which is what actually holds. Left documented here because the next
-- person to reach for a column-level revoke deserves the warning.
