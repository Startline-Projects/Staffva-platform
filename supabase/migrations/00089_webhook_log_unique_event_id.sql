-- Migration 00089 — webhook_log_unique_event_id
--
-- Webhook idempotency backstop. Stripe delivers events at-least-once and
-- retries when a response is slow or non-2xx; the handler had no dedup, so a
-- redelivered payment_intent.succeeded could re-run and rewrite an already
-- RELEASED payment period back to 'funded' — re-arming the release path for a
-- second Stripe transfer and a second earnings increment.
--
-- This unique index makes the duplicate INSERT fail with 23505, which the
-- webhook handler uses as its "already processed" signal (acking 200 so Stripe
-- stops retrying). Scoped by provider so different providers cannot collide,
-- and partial so legacy rows without an event_id are unaffected.
--
-- Verified before applying: 10 rows, 10 distinct event_ids, 0 duplicates.
create unique index if not exists webhook_log_provider_event_id_key
  on public.webhook_log (provider, event_id)
  where event_id is not null;
