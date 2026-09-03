-- send-code's cross-account collision check filters on phone_pending_number;
-- without an index that is a sequential scan of profiles on EVERY send —
-- fine at today's row count, wrong at the 10k-signups target. Partial:
-- claims are transient, so most rows hold NULL and stay out of the index.
create index if not exists profiles_phone_pending_number_idx
  on public.profiles (phone_pending_number)
  where phone_pending_number is not null;
