-- Add second interview tracking fields to candidates
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS second_interview_status TEXT DEFAULT 'none';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS second_interview_scheduled_at TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS second_interview_completed_at TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ;

-- Index for recruiter priority queue
CREATE INDEX IF NOT EXISTS idx_candidates_waiting_since ON candidates(waiting_since) WHERE waiting_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_second_interview ON candidates(second_interview_status);
