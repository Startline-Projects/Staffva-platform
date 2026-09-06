-- 00210 — negotiation history + the pause lifecycle. Owner decisions
-- 2026-09-05: "build counters, add pause/resume".
--
-- COUNTERS (Atlas 4.19). The offer row stays the envelope holding the
-- CURRENT terms — which is what the accept path already reads, so an offer
-- accepted after three rounds creates the engagement and the contract from
-- the last counter's terms with no changes to that code. This table is the
-- round history: who proposed what, in order, forever. Each counter also
-- resets sent_at, so the 5-day expiry window is per round.
--
-- PAUSE (Atlas 4.20/1.19). Either party may pause a signed engagement; only
-- the pauser may resume it (the other side's protection is the 30-day
-- auto-end, and notice stays available while paused). While paused, no new
-- payment periods can be created or funded; already-funded money keeps its
-- normal release path. Paused 30 consecutive days -> the completion cron
-- ends the engagement. The contract template gains the matching clause in
-- the same commit — product and document move together, per step 20's rule.
-- (Zero fully-executed contracts exist today, so no signed document predates
-- the clause; the handful of generated-but-unsigned ones are nearly all
-- blocked by the step-16 terms gate anyway.)

create table public.offer_counters (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.engagement_offers(id) on delete cascade,
  round int not null check (round >= 1),
  proposed_by text not null check (proposed_by in ('client','candidate')),
  hourly_rate numeric not null check (hourly_rate >= 1 and hourly_rate <= 500),
  hours_per_week int not null check (hours_per_week >= 1 and hours_per_week <= 60),
  contract_length text not null,
  start_date date not null,
  message text,
  created_at timestamptz not null default now(),
  unique (offer_id, round)
);

-- Service-role only, like every negotiation-adjacent table: the API verifies
-- the party and whose turn it is; a browser-writable history would let either
-- side forge the other's proposals.
alter table public.offer_counters enable row level security;
revoke all on public.offer_counters from anon, authenticated;

alter table public.engagements
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by text
    check (paused_by is null or paused_by in ('client','candidate'));

alter table public.engagements
  add constraint engagements_pause_complete check (
    (paused_at is null and paused_by is null)
    or (paused_at is not null and paused_by is not null)
  );
