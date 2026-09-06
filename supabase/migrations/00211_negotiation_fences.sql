-- 00211 — the step-22 review's structural fixes, one migration.
--
-- 1. current_round: the version fence. Every accept/decline CAS was
--    status-only, and a counter landing between a party's turn-check and
--    their accept kept status='countered' — so the accept bound terms the
--    other side never proposed, saw, or agreed to (probed live: a candidate
--    could fire counter($499/hr) + accept concurrently and mint an ACTIVE
--    engagement and contract at $499 against a $10 offer). The envelope now
--    carries the round it represents; a counter bumps it CAS'd on the prior
--    value, and accept/decline fence on the round the acceptor's turn-check
--    saw. Any interleaving counter changes the number and the accept matches
--    zero rows.
--
-- 2. The one-live-offer backstop learns 'countered'. The partial unique
--    index guarded sent/viewed only, so the moment a candidate countered,
--    the client could send a SECOND live offer to the same pair — two
--    independently acceptable offers, two engagements, two contracts: the
--    step-11 double-offer bug reopened for every negotiation.
--
-- 3. last_resumed_at: "no new payment periods accrue while paused" was not
--    enforced ACROSS a pause — resume after four paused weeks and the next
--    period spanned the whole gap at full price. The periods route now
--    starts the next period no earlier than the resume.

alter table public.engagement_offers
  add column if not exists current_round int not null default 0;

drop index if exists engagement_offers_pending_key;
create unique index engagement_offers_pending_key
  on public.engagement_offers (client_id, candidate_id)
  where status in ('sent', 'viewed', 'countered');

alter table public.engagements
  add column if not exists last_resumed_at timestamptz;
