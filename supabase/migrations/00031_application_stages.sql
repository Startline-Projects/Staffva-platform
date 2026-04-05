ALTER TABLE candidates ADD COLUMN IF NOT EXISTS application_stage INTEGER DEFAULT 0;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS stage1_completed_at TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS stage2_completed_at TIMESTAMPTZ;

-- Mark all existing candidates as fully complete (stage 3)
UPDATE candidates SET application_stage = 3 WHERE application_stage IS NULL OR application_stage = 0;
