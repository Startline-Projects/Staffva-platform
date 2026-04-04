CREATE TABLE IF NOT EXISTS lockout_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  identity_hash TEXT,
  overridden_by UUID NOT NULL,
  override_reason TEXT NOT NULL,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lockout_overrides_candidate ON lockout_overrides(candidate_id);
