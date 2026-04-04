ALTER TABLE candidates ADD COLUMN IF NOT EXISTS reputation_score INTEGER;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS reputation_tier TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS reputation_percentile INTEGER;

CREATE INDEX IF NOT EXISTS idx_candidates_reputation_score ON candidates(reputation_score);
