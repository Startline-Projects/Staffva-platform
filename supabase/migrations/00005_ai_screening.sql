-- ============================================================
-- StaffVA — AI Candidate Screening
-- Adds screening columns and log table.
-- Idempotent — safe to re-run.
-- ============================================================

-- New columns on candidates
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS screening_tag TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS screening_score INTEGER;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS screening_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_candidates_screening_tag ON candidates(screening_tag);

-- Screening log table
CREATE TABLE IF NOT EXISTS screening_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  tag TEXT,
  score INTEGER,
  reason TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE screening_log ENABLE ROW LEVEL SECURITY;

-- Only admins read screening logs (via service role in API)
DO $$ BEGIN
  CREATE POLICY "No direct public access to screening log" ON screening_log FOR SELECT USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_screening_log_candidate ON screening_log(candidate_id);
