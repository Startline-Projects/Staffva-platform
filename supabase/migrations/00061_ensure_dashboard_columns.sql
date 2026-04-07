-- Ensure all columns referenced by the candidate dashboard select query exist
-- These columns may have been created outside of tracked migrations
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '[]'::jsonb;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS assigned_recruiter UUID REFERENCES profiles(id);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS application_step TEXT;
