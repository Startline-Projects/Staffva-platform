-- AI proctor P1 (owner's go, 2026-09-01): camera capture during assessments.
-- The session row is the spine: capture writes chunks/frames under
-- storage_prefix, review (P2) walks pending_review rows, verdicts land in
-- verdict jsonb, and video_deleted_at proves the deletion promise
-- ("recordings are deleted unless flagged" — the consent copy's exact claim).
create table public.proctor_sessions (
  id               uuid primary key default gen_random_uuid(),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,
  session_kind     text not null check (session_kind in ('english_test','ai_interview')),
  attempt_id       uuid,
  storage_prefix   text not null,
  chunk_count      integer not null default 0,
  frame_count      integer not null default 0,
  camera_lost_count integer not null default 0,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  review_status    text not null default 'recording'
                   check (review_status in ('recording','pending_review','clear','flagged','cleared_by_human','confirmed_cheating')),
  verdict          jsonb,
  reviewed_at      timestamptz,
  video_deleted_at timestamptz,
  created_at       timestamptz not null default now()
);

create index idx_proctor_sessions_candidate on public.proctor_sessions (candidate_id, started_at desc);
create index idx_proctor_sessions_review on public.proctor_sessions (review_status, ended_at);

-- Browser never reads or writes this table directly; the upload routes hold
-- the only pen (service role bypasses RLS).
alter table public.proctor_sessions enable row level security;

-- Versioned, timestamped consent at the affirmative act — per the
-- counsel-reviewed draft; never a column default.
alter table public.candidates
  add column if not exists proctor_consent_version text,
  add column if not exists proctor_consent_at timestamptz;

-- Private bucket for the recordings and review frames.
insert into storage.buckets (id, name, public)
values ('proctor-recordings', 'proctor-recordings', false)
on conflict (id) do nothing;
