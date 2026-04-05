-- Recruiter AI scoring results
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS recruiter_ai_score_results JSONB;

-- Spoken English scoring
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS spoken_english_score INTEGER;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS spoken_english_result TEXT;

-- Change requests table
CREATE TABLE IF NOT EXISTS candidate_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  recruiter_id UUID,
  change_items JSONB NOT NULL DEFAULT '[]',
  general_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_change_requests_candidate ON candidate_change_requests(candidate_id);

-- Add changes_requested to admin_status enum if not exists
-- (admin_status is already flexible text, no enum change needed)
