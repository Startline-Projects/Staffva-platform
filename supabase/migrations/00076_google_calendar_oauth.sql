-- ============================================================
-- Migration 00076: Google Calendar OAuth integration
-- ============================================================
-- Adds columns to profiles that store a recruiter's Google OAuth
-- tokens and watch-channel metadata so the platform can read their
-- interview bookings and receive push notifications from Google.
--
-- Step 1 of the Google Calendar integration only touches the token
-- columns (access_token, refresh_token, token_expiry,
-- google_calendar_id, google_calendar_connected). The watch-channel
-- columns (watch_channel_id, watch_expiry) are created now so later
-- steps can populate them without another migration.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS google_access_token        text,
  ADD COLUMN IF NOT EXISTS google_refresh_token       text,
  ADD COLUMN IF NOT EXISTS google_token_expiry        timestamptz,
  ADD COLUMN IF NOT EXISTS google_calendar_id         text    DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS google_calendar_connected  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_watch_channel_id    text,
  ADD COLUMN IF NOT EXISTS google_watch_expiry        timestamptz;

NOTIFY pgrst, 'reload schema';
