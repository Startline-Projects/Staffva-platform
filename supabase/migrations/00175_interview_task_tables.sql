-- The three side tables the Interview 2 task needs.
--
-- These are separate tables rather than more jsonb on ai_interviews for one
-- measured reason: session/route.ts does .select("*") on ai_interviews on EVERY
-- conversational turn, and score/route.ts does it again. A 12-turn interview
-- would drag the full per-field result set and the whole event stream across
-- the wire twelve times, inside a 60-second function budget, for data no turn
-- needs.

-- ── Exposure: which variant has this candidate already seen? ──
--
-- Everyone in the marketplace is re-qualifying right now (00143 reset every
-- interview and every English score), so retakes are the common case, not the
-- edge case. Serving the same variant to someone on their second attempt three
-- days later measures memory, not skill.
create table if not exists public.interview_task_exposure (
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  task_key     text not null,
  variant      text not null,
  served_at    timestamptz not null default now(),
  primary key (candidate_id, task_key, variant)
);

comment on table public.interview_task_exposure is
  'One row per (candidate, task, variant) ever served. The serve route prefers '
  'an unseen variant and only repeats when the pool is exhausted.';

-- ── Results: the per-field detail behind the score ──
--
-- The whole argument for a deterministic task is that "you missed rows 3, 7 and
-- 11" is defensible in a way "11/20 technical_knowledge" is not. That argument
-- is worth nothing if the detail is not stored where a recruiter can read it.
create table if not exists public.interview_task_results (
  interview_id uuid primary key references public.ai_interviews(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  task_key     text not null,
  variant      text not null,
  seed         text not null,
  score_pct    numeric(5,2),
  max_points   numeric(6,2),
  earned       numeric(6,2),
  -- The candidate's raw answers, exactly as submitted.
  submission   jsonb not null default '{}'::jsonb,
  -- Per-item verdicts: what was asked, what they said, what was right.
  detail       jsonb not null default '{}'::jsonb,
  elapsed_ms   integer,
  created_at   timestamptz not null default now(),
  constraint interview_task_results_score_check
    check (score_pct is null or (score_pct >= 0 and score_pct <= 100))
);

create index if not exists interview_task_results_candidate_idx
  on public.interview_task_results (candidate_id, created_at desc);

comment on column public.interview_task_results.submission is
  'Raw candidate answers. Treat as untrusted text everywhere it is rendered or '
  'sent to a model — it is free input from the person being scored.';

-- ── Events: focus and paste telemetry, for a human, never for a score ──
--
-- Read this comment before wiring anything to it. This table exists ONLY to
-- give a person context when they are already reviewing a session. Nothing
-- automatic may read it, and nothing may turn a count in it into a rejection.
--
-- Two receipts for why. First, the platform's own /api/proctor/events
-- recomputes anticheat_lockout_triggered from leave events counted by
-- candidate_id with NO session_kind filter at >= 4 — so writing task telemetry
-- there would manufacture strikes that pool with English-test strikes and lock
-- people out of an exam they are passing. That is why this is its own table.
-- Second, StaffVA has already shipped one detector that punished honest
-- candidates: a silence guard that auto-rejected 29% of them for OUR audio
-- failures. A candidate on a shared laptop with a toddler in the room produces
-- exactly the event pattern a cheat does.
create table if not exists public.interview_task_events (
  id           bigserial primary key,
  interview_id uuid not null references public.ai_interviews(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  kind         text not null check (kind in ('blur', 'focus', 'paste', 'visibility_hidden', 'visibility_visible')),
  at           timestamptz not null default now(),
  detail       jsonb
);

create index if not exists interview_task_events_interview_idx
  on public.interview_task_events (interview_id, at);

comment on table public.interview_task_events is
  'Focus/paste telemetry for HUMAN review only. No automatic reader, no score '
  'input, no lockout. Deliberately NOT written to proctor_events, whose lockout '
  'counter is candidate-wide and session-kind-blind.';

-- ── RLS: service-role writes, nobody else reads ──
--
-- Candidates must not read their own results: the per-field detail IS the
-- answer key, and a retake opens three days after a failure.
alter table public.interview_task_exposure enable row level security;
alter table public.interview_task_results  enable row level security;
alter table public.interview_task_events   enable row level security;

-- No permissive policy is created for authenticated or anon on any of the
-- three. With RLS on and no policy, PostgREST returns nothing to them; the
-- service-role client used by the interview app bypasses RLS entirely.
revoke all on public.interview_task_exposure from authenticated, anon;
revoke all on public.interview_task_results  from authenticated, anon;
revoke all on public.interview_task_events   from authenticated, anon;

-- Admins read results through the recruiter UI, which runs server-side under
-- the service role. Kept explicit so a future "why can't I query this?" has an
-- answer in the migration rather than in someone's memory.
comment on table public.interview_task_results is
  'Service-role only. The per-field detail is the answer key — a candidate who '
  'could read their own row could read exactly which planted defects they '
  'missed, three days before their retake.';
