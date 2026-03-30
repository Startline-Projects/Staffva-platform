ALTER TABLE candidates ADD COLUMN IF NOT EXISTS interview_consent_at TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS interview_consent_version TEXT;
