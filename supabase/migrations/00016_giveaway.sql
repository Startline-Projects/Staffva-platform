CREATE TABLE IF NOT EXISTS giveaway_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  application_complete BOOLEAN NOT NULL DEFAULT false,
  profile_approved BOOLEAN NOT NULL DEFAULT false,
  tag_verified BOOLEAN NOT NULL DEFAULT false,
  tag_verified_at TIMESTAMPTZ,
  eligible BOOLEAN GENERATED ALWAYS AS (application_complete AND profile_approved AND tag_verified) STORED,
  UNIQUE(candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_giveaway_candidate ON giveaway_entries(candidate_id);
CREATE INDEX IF NOT EXISTS idx_giveaway_eligible ON giveaway_entries(eligible) WHERE eligible = true;

CREATE TABLE IF NOT EXISTS giveaway_winner_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  winner_1_candidate_id UUID NOT NULL REFERENCES candidates(id),
  winner_2_candidate_id UUID NOT NULL REFERENCES candidates(id),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  selection_method TEXT NOT NULL DEFAULT 'random_verified_eligible',
  selected_by UUID NOT NULL
);
