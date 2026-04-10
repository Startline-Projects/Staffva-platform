-- ============================================================
-- 00064 — Recruiter photo upload + approval flow columns
-- ============================================================

-- Photo columns on profiles (for all recruiters incl. Admin)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recruiter_photo_url             TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recruiter_photo_pending_url     TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recruiter_photo_pending_uploaded_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recruiter_photo_status          TEXT
  CHECK (recruiter_photo_status IN ('pending_review', 'approved', 'rejected'));

-- Index for fast queue lookups (admin/manager approval queue)
CREATE INDEX IF NOT EXISTS idx_profiles_recruiter_photo_status
  ON profiles (recruiter_photo_status)
  WHERE recruiter_photo_status IS NOT NULL;

-- Recruiter bio on profiles (separate from candidate bio)
-- calendar_link already exists (00044); recruiter_photo_url added above
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;

NOTIFY pgrst, 'reload schema';
