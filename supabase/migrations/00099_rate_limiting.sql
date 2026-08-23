-- There was no rate limiting anywhere in either app, and the expensive paths
-- are all paid: an interview turn costs an Anthropic call, an ElevenLabs
-- synthesis and a Deepgram transcription. Reopening signup makes that
-- reachable, so a loop against the interview endpoints spends real money.
--
-- Backed by Postgres rather than Redis on purpose: no new vendor, no new
-- environment variable to forget, and at the modelled peak (~22 signups/min)
-- the write volume is negligible next to what these routes already do.
create table if not exists public.rate_limit_hits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);

create index if not exists idx_rate_limit_hits_window
  on public.rate_limit_hits (window_start);

alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

-- Fixed-window counter. The INSERT ... ON CONFLICT DO UPDATE ... RETURNING is
-- a single atomic statement, so concurrent callers cannot both read the same
-- pre-increment value -- the read-modify-write race this codebase has hit
-- repeatedly elsewhere.
--
-- Returns true when the call is ALLOWED.
create or replace function public.check_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limit_hits (bucket, window_start, hits)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start)
    do update set hits = rate_limit_hits.hits + 1
  returning hits into v_hits;

  -- Opportunistic cleanup so the table cannot grow unbounded. Cheap because it
  -- runs on roughly one call in a thousand and the index makes it a range scan.
  if random() < 0.001 then
    delete from rate_limit_hits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
