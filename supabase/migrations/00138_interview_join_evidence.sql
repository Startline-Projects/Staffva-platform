-- Step 14: per-party join evidence. Stamped the first time each party is
-- issued a join token; the transcripts cron uses the pair to tell a
-- completed interview from a one-sided or total no-show, which frees the
-- one-live-booking-per-pair index honestly instead of leaving it locked.
alter table public.interview_bookings
  add column if not exists client_joined_at    timestamptz,
  add column if not exists candidate_joined_at timestamptz;

-- Grandfather rooms provisioned before stamping existed: those tokens were
-- minted by a route that recorded nothing, so the old rule (a finished
-- recording means completed) must keep applying to them. Without this, an
-- interview mid-flight at deploy would be retro-labeled a no-show.
update public.interview_bookings
   set client_joined_at    = starts_at,
       candidate_joined_at = starts_at
 where room_name is not null
   and status = 'booked'
   and transcript_status is null
   and client_joined_at is null
   and candidate_joined_at is null;
