CREATE TABLE IF NOT EXISTS application_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  section TEXT NOT NULL DEFAULT 'grammar',
  question_index INTEGER NOT NULL DEFAULT 0,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  timer_remaining INTEGER,
  recording_status TEXT,
  is_mobile BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_app_progress_candidate ON application_progress(candidate_id);
