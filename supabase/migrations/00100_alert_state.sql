-- vendor_failures and email_outbox both record problems, and nothing read
-- either one: two writers, zero readers. A signal nobody looks at is the same
-- as no signal, which is how a retired model went unnoticed for ten weeks.
--
-- This table exists purely to stop the alerter becoming noise. Without it an
-- unresolved problem re-alerts every 15 minutes until people mute the channel,
-- which is a slower way of arriving back at no signal at all.
create table if not exists public.alert_state (
  check_key       text primary key,
  last_alerted_at timestamptz not null default now(),
  last_count      integer not null default 0
);

alter table public.alert_state enable row level security;
revoke all on public.alert_state from anon, authenticated;
