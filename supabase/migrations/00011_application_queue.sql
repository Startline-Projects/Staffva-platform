DO $$ BEGIN CREATE TYPE application_queue_status AS ENUM ('pending', 'processing', 'complete', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS application_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status application_queue_status NOT NULL DEFAULT 'pending',
  application_data JSONB NOT NULL,
  user_id UUID NOT NULL,
  error_text TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_app_queue_status ON application_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_app_queue_created ON application_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_app_queue_user ON application_queue(user_id);
