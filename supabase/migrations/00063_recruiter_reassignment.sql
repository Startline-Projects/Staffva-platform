-- Recruiter reassignment log
CREATE TABLE IF NOT EXISTS recruiter_reassignment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  reassigned_by UUID NOT NULL REFERENCES profiles(id),
  from_recruiter_id UUID REFERENCES profiles(id),
  to_recruiter_id UUID NOT NULL REFERENCES profiles(id),
  reason TEXT,
  reassigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reassignment_log_candidate ON recruiter_reassignment_log(candidate_id);
CREATE INDEX IF NOT EXISTS idx_reassignment_log_at ON recruiter_reassignment_log(reassigned_at DESC);

-- Soft-deactivation flag on profiles (used to exclude deactivated recruiters from dropdown)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Priority column on recruiter_notifications (used for red badge)
ALTER TABLE recruiter_notifications ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';

NOTIFY pgrst, 'reload schema';
