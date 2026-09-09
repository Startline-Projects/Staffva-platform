-- Paid access to interview transcripts and scorecard feedback.
--
-- $10/month or $50/year, per client account, unlocking every candidate's
-- interview transcript and the SHAREABLE half of their scorecard.
--
-- WHAT IS SOLD, exactly: transcript, strengths, weaknesses, and the five
-- per-category feedback fields. ai_notes is NOT included and must never be.
-- The scoring prompt defines it as "internal observations — especially any
-- claimed skill or tool that FAILED verification when probed, contradictions"
-- — the interviewer's private red-flag field. It was once rendered to every
-- logged-in client as "Screening notes" and was deliberately removed; selling
-- it would be re-opening that leak and charging for it. src/lib/
-- transcriptAccess.ts holds the column list so there is one place to check.
--
-- Note the four columns dropped by 20260908100200_client_signup_capture were
-- the $99/mo messaging subscription, retired because it had no callers and no
-- subscriber. These are deliberately NOT those columns reused: a generic
-- `subscription_status` invites the next feature to share it, and then two
-- products write one field. These are named for the one thing they gate.

alter table public.clients
  add column if not exists transcript_access_status text not null default 'none',
  -- The instant access lapses. THIS IS THE WHOLE ACCESS RULE — see below.
  add column if not exists transcript_access_until timestamptz,
  add column if not exists transcript_access_interval text,
  add column if not exists transcript_stripe_subscription_id text;

alter table public.clients
  drop constraint if exists clients_transcript_access_status_check;
alter table public.clients
  add constraint clients_transcript_access_status_check check (
    transcript_access_status in ('none', 'active', 'past_due', 'canceled')
  );

alter table public.clients
  drop constraint if exists clients_transcript_access_interval_check;
alter table public.clients
  add constraint clients_transcript_access_interval_check check (
    transcript_access_interval is null or transcript_access_interval in ('month', 'year')
  );

-- The webhook finds the client by subscription id on renewal and cancellation.
create index if not exists clients_transcript_subscription_idx
  on public.clients (transcript_stripe_subscription_id)
  where transcript_stripe_subscription_id is not null;

comment on column public.clients.transcript_access_until is
  'Access is granted while now() < this, and by nothing else. Status is for the UI. '
  'A cancelled subscription keeps its paid-for period: Stripe holds status ''active'' '
  'until the end, and on deletion we set status ''canceled'' but LEAVE this alone — '
  'the client paid for the period. A failed renewal leaves Stripe''s period_end where '
  'it was, so access lapses on its own without needing a status check.';

comment on column public.clients.transcript_access_status is
  'Informational, for what the billing page shows. Never the access gate — one rule, '
  'one column, and it is transcript_access_until.';
