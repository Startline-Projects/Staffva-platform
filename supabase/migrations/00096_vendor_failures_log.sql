-- A retired Anthropic model took the AI interview down for ten weeks without
-- anyone noticing, because every vendor error was caught and replaced with a
-- friendly message. There was nowhere for a failure to be recorded and nothing
-- to look at. This is that place.
--
-- Deliberately one table for both apps and every vendor: the point is that a
-- single query answers "is anything failing right now", without knowing in
-- advance which integration broke.
create table if not exists public.vendor_failures (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  app          text not null,        -- 'interview' | 'platform'
  vendor       text not null,        -- 'anthropic' | 'deepgram' | 'elevenlabs' | 'resend' | 'stripe' | 'supabase'
  operation    text not null,        -- e.g. 'interview.session.turn'
  fatal        boolean not null default false,  -- config/auth/model errors that every request will hit
  status_code  integer,
  message      text not null,
  context      jsonb
);

-- The two questions actually asked of this table: "what just broke" and
-- "is anything systematically broken".
create index if not exists idx_vendor_failures_recent
  on public.vendor_failures (occurred_at desc);

create index if not exists idx_vendor_failures_fatal
  on public.vendor_failures (occurred_at desc)
  where fatal;

alter table public.vendor_failures enable row level security;

-- Written by service_role only. No policy for anon/authenticated, so RLS
-- denies them by default -- failure messages can carry vendor detail that
-- should not reach a browser.
revoke all on public.vendor_failures from anon, authenticated;
