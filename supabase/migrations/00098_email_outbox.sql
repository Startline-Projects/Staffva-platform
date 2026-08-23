-- Email was sent inline, awaited, on the signup request path. Login is hard
-- gated on profiles.email_verified, and the only writer of that flag is the
-- link inside the verification email -- so one rejected send permanently
-- bricked an account, and at a spike's peak minute (~127 signups) the send
-- rate sits right on Resend's default limit. This is the durable buffer.
create table if not exists public.email_outbox (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- payload, stored rendered so a drain never has to reconstruct it
  to_email      text not null,
  from_email    text not null,
  subject       text not null,
  html          text not null,

  -- routing and observability
  email_type    text not null,
  candidate_id  uuid,
  -- Natural key for "this exact message". A unique index means an enqueue can
  -- be retried safely and a double submit cannot send twice.
  dedupe_key    text unique,

  -- delivery state
  status          text not null default 'pending',  -- pending | sending | sent | failed
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  last_error      text,

  constraint email_outbox_status_check
    check (status in ('pending','sending','sent','failed'))
);

-- The work query: what is due to send right now.
create index if not exists idx_email_outbox_due
  on public.email_outbox (next_attempt_at)
  where status = 'pending';

-- The reclaim query. Same lesson as screening_queue: a claim nothing reads
-- back is a row lost forever when an invocation is killed mid-send.
create index if not exists idx_email_outbox_stranded
  on public.email_outbox (claimed_at)
  where status = 'sending';

-- The observability query: is anything stuck or failing.
create index if not exists idx_email_outbox_status
  on public.email_outbox (status, created_at desc);

alter table public.email_outbox enable row level security;

-- service_role only. Rows contain rendered email bodies and recipient
-- addresses; nothing browser-scoped should read them.
revoke all on public.email_outbox from anon, authenticated;
