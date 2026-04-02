ALTER TABLE candidates ADD COLUMN IF NOT EXISTS id_verification_consent BOOLEAN DEFAULT false;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS id_verification_consent_at TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS id_verification_consent_version TEXT;
