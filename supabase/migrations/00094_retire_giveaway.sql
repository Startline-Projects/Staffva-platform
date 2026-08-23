-- Retires the launch giveaway. Verified against production before writing:
-- 132 giveaway_entries (0 eligible, 0 tag_verified, 0 with tickets),
-- 0 giveaway_winner_log rows, 0 candidates with the awarded flag set.
-- No draw was ever run in the app.
--
-- Ordering matters, and it is the reverse of the dependency order: the
-- application code that reads these objects must already be live without
-- them. In particular PostgREST returns a hard error for an unknown column
-- in a select list, so dropping the candidates column while the old
-- admin/video-review is still deployed would break video approval -- not
-- merely the retired giveaway. Steps 1-3 are safe as soon as the giveaway
-- routes are gone; step 4 requires the edited video-review to be live.

-- == 1. Snapshot first. `create table as` materialises the generated
--       `eligible` column as a plain boolean, which is what an archive
--       wants. PostgREST exposes only `public`, so `archive` is not
--       reachable over the API; RLS is enabled regardless.
create schema if not exists archive;

create table if not exists archive.giveaway_entries_20260822 as
  select * from public.giveaway_entries;
create table if not exists archive.giveaway_winner_log_20260822 as
  select * from public.giveaway_winner_log;

alter table archive.giveaway_entries_20260822    enable row level security;
alter table archive.giveaway_winner_log_20260822 enable row level security;

-- == 2. Function before tables: its body updates giveaway_entries, so if
--       the table went first the function would abort mid-statement and
--       roll back the candidates compare-and-swap -- invisibly, because
--       the old caller discarded `error`.
drop function if exists public.award_video_intro_raffle_tickets(uuid, integer);

-- == 3. Tables. Each drop takes its own indexes, the generated `eligible`
--       column, the UNIQUE(candidate_id) constraint, the RLS enablement
--       from 00069, and the single-active partial index + superseded_at
--       added in 00093.
drop table if exists public.giveaway_winner_log;
drop table if exists public.giveaway_entries;

-- == 4. The candidates column. Applied separately and last, once the
--       edited api/admin/video-review was confirmed live in production --
--       verified by /raffle serving the 307 to /signup/candidate, a
--       redirect that only this deploy has. The outage window the ordering
--       exists to prevent therefore never opened. Note that commit 63f4a9e's
--       message predates that check: it says this step is still held and
--       that eight video_intro_* columns remain. Seven remain.
alter table public.candidates
  drop column if exists video_intro_raffle_tickets_awarded;
