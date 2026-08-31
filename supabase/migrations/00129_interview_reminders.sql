-- Reminder bookkeeping for interview emails: one send each, idempotent by
-- flag, so the 15-minute cron can never double-remind however it overlaps.
alter table public.interview_bookings
  add column if not exists reminder_24h_sent_at timestamptz,
  add column if not exists reminder_1h_sent_at timestamptz;
