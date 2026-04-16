-- ============================================================
-- Migration 00077: Google Calendar event matching
-- ============================================================
-- Adds columns to candidates for tracking scheduled interviews
-- linked to Google Calendar events, and a table for bookings
-- that could not be automatically matched to a candidate.
-- ============================================================

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS second_interview_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_calendar_event_id text;

CREATE TABLE IF NOT EXISTS calendar_unmatched_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event_start timestamptz,
  attendee_name text,
  created_at timestamptz DEFAULT now()
);

NOTIFY pgrst, 'reload schema';
