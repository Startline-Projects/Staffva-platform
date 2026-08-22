-- Migration 00090 — add_client_subscription_columns
--
-- The paid-messaging gate (api/messages, api/stripe/checkout, (main)/inbox)
-- reads clients.subscription_status, but the column was never created — so the
-- read errored and the subscription feature could not work at all. Adding it,
-- plus the subscription id and current period end for bookkeeping, so the
-- customer.subscription.* webhook handlers have somewhere to write.
--
-- Deliberately left NULL by default: the gate checks
-- `subscription_status !== 'active'`, so a client with no subscription is
-- correctly denied (fail-closed).
alter table public.clients
  add column if not exists subscription_status text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_current_period_end timestamptz;

create index if not exists clients_stripe_subscription_id_idx
  on public.clients (stripe_subscription_id)
  where stripe_subscription_id is not null;
