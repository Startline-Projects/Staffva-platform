-- The review outcome: what is recorded when a person's application is decided.
--
-- Today rejection is a single-column write. `update candidates set
-- admin_status='rejected'` — no reason, no actor, no date, no hold, no audit,
-- and the result of the update is discarded so nobody notices if it fails. It
-- is the most consequential thing this product does to a person and it leaves
-- less of a record than a profile edit.

alter table public.candidates
  -- The candidate reads this. There is deliberately no second "internal"
  -- reason field: a candidate holds SELECT on their own row through RLS, so a
  -- column labelled internal would be a leak with a misleading name.
  add column if not exists rejection_reason     text,
  add column if not exists rejected_at          timestamptz,
  add column if not exists rejected_by          uuid references auth.users(id),
  -- The six-month hold. A timestamp rather than a flag, so it expires itself:
  -- permanently_blocked has promised "you may reapply in 90 days" since it
  -- shipped, with no expiry and no cron, and that has never been true.
  add column if not exists reapply_eligible_at  timestamptz,
  -- When the candidate entered human review. An anchor for an internal alarm,
  -- NOT a countdown shown to anybody — see 00185.
  add column if not exists review_entered_at    timestamptz;

-- A rejection must carry its reasons. Enforced here rather than in a route so
-- that every path — the review route, a dispute resolution, a future admin
-- screen, a hand-run UPDATE — has to supply them.
--
-- NOT VALID so the 256 existing rows are untouched; no live row is rejected.
alter table public.candidates
  drop constraint if exists candidates_rejection_is_recorded;
alter table public.candidates
  add constraint candidates_rejection_is_recorded check (
    admin_status <> 'rejected'
    or (
      rejected_at is not null
      and rejected_by is not null
      and rejection_reason is not null
      and length(btrim(rejection_reason)) >= 20
    )
  ) not valid;

comment on column public.candidates.rejection_reason is
  'Shown to the candidate verbatim. Minimum 20 characters, enforced by '
  'candidates_rejection_is_recorded — a decision somebody cannot explain in a '
  'sentence is not one they should be able to record.';

comment on column public.candidates.reapply_eligible_at is
  'When this ACCOUNT may apply again. Binds an account, not a person: nothing '
  'in this platform identifies a human at signup — verified_identities is '
  'empty and phone_verified_at is null for every profile — so a second email '
  'address defeats it. Say "you can apply again on <date>", never "one '
  'application per person".';

-- ── The audit trail ──────────────────────────────────────────────────────
-- Append-only. Every status change that a person caused, with who and why.
create table if not exists public.candidate_status_events (
  id           bigserial primary key,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  actor_id     uuid references auth.users(id),
  -- 'system' for the promotion sweep, 'admin'/'recruiter' for a person.
  actor_role   text not null default 'system',
  reason       text,
  created_at   timestamptz not null default now()
);

create index if not exists candidate_status_events_candidate_idx
  on public.candidate_status_events (candidate_id, created_at desc);

alter table public.candidate_status_events enable row level security;
revoke all on public.candidate_status_events from anon, authenticated;

comment on table public.candidate_status_events is
  'Append-only decision history. Service-role only: it names the reviewer, and '
  'a candidate reading who decided and when — before anyone has decided how to '
  'answer that — is not a conversation we can currently hold. Staff read it '
  'through the review route.';

-- None of the new candidate columns are granted to `authenticated`.
-- public.candidates has no table-level UPDATE grant (00120, 00183): grants are
-- column-by-column, so omitting them IS the lock. Every one of these is written
-- by a staff route or by /api/candidate/{appeal,reapply} under the service
-- role, and a candidate must never be able to set their own hold date.
