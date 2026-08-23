-- == 1. One screening row per candidate.
-- Required by the upsert that now enqueues screening at the end of stage 2,
-- so a resubmitted stage 2 cannot enqueue the same candidate twice. No
-- duplicates existed (verified: 0 across 251 rows).
alter table public.screening_queue
  add constraint screening_queue_candidate_id_key unique (candidate_id);

-- == 2. Make a stranded claim recoverable.
--
-- process-screening-queue claims a row by setting status='processing' just
-- before the Claude call, and every normal exit writes a terminal state. If
-- the invocation dies in between -- maxDuration expiry, a deploy replacing the
-- running instance, a crash -- the row keeps status='processing' forever.
-- Nothing read it back: the work query matches only pending/rate_limited, the
-- bulk reset matches only failed, and the permanent-failure alert matches only
-- failed. The candidate was never screened, never retried, never alerted on.
--
-- created_at is enqueue time, not claim time, so a sweep based on it would
-- wrongly reclaim rows that are legitimately in flight. Hence a real claim
-- timestamp.
alter table public.screening_queue   add column if not exists claimed_at timestamptz;
alter table public.application_queue add column if not exists claimed_at timestamptz;

create index if not exists idx_screening_queue_stranded
  on public.screening_queue (claimed_at) where status = 'processing';

create index if not exists idx_application_queue_stranded
  on public.application_queue (claimed_at) where status = 'processing';

-- One-time safety net. 0 rows were 'processing' at apply time, so this is a
-- no-op; it only matters for anything stranded before the code change deploys.
update public.screening_queue   set status = 'pending' where status = 'processing';
update public.application_queue set status = 'pending' where status = 'processing';
