-- Track email verification status on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verification_sent_at TIMESTAMPTZ;
