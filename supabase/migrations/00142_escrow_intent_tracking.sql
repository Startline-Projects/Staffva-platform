-- Escrow payment-sheet review fixes:
--  * stripe_payment_intent_id on periods and milestones — the fund route
--    reuses one PaymentIntent per fundable row (two tabs share one intent;
--    an intent that already succeeded can never be minted around), and the
--    webhook can tell "second intent for a paid row" from a replay.
--  * unique (engagement_id, period_start) — two concurrent "Fund Next
--    Period" clicks both derived the same dates from the same latest
--    period and inserted twin rows the client could pay twice; the DB now
--    refuses the twin, settling the race the app-level check cannot.
alter table public.payment_periods
  add column if not exists stripe_payment_intent_id text;
alter table public.milestones
  add column if not exists stripe_payment_intent_id text;

create unique index if not exists uq_period_engagement_start
  on public.payment_periods (engagement_id, period_start);
