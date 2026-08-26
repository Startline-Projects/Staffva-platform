-- Record the RESULT of every vendor health check, not just the failures.
--
-- /api/health/vendors calls Anthropic, Deepgram and ElevenLabs every 15 minutes
-- and writes to vendor_failures only when one of them fails. Two consequences,
-- both hit while diagnosing a live outage today:
--
-- 1. A SUCCESSFUL run leaves no trace, so "no failure row" is ambiguous — it
--    means either "everything is healthy" or "the cron did not run". Those need
--    very different responses, and the table could not tell them apart. Vercel's
--    schedule also drifts by a few minutes, so you cannot infer a run from the
--    clock either.
--
-- 2. The ElevenLabs check reads /v1/user, which returns the TIER and the
--    CHARACTER QUOTA — the single number the capacity plan hangs on, since the
--    campaign needs ~7.4M characters and every tier below Business falls short.
--    That number was being computed every 15 minutes and discarded, leaving the
--    only way to read it a hand-rolled curl with the cron secret.
--
-- One row per vendor, upserted each run. Small, bounded, and answers both
-- questions: when did this last actually run, and what did it say.
create table if not exists public.vendor_health (
  vendor      text primary key,
  checked_at  timestamptz not null default now(),
  ok          boolean     not null,
  detail      text,
  duration_ms integer
);

comment on table public.vendor_health is
  'Latest result per vendor from /api/health/vendors. A stale checked_at means the health cron is not running — which is itself the outage.';

alter table public.vendor_health enable row level security;

-- Written by the cron with the service key; nothing client-side needs it.
revoke all on table public.vendor_health from anon, authenticated;
