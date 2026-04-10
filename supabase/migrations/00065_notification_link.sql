-- Add optional navigation link to recruiter notifications
-- Used for photo-approval queue links and other actionable notifications
ALTER TABLE recruiter_notifications ADD COLUMN IF NOT EXISTS link TEXT;

NOTIFY pgrst, 'reload schema';
