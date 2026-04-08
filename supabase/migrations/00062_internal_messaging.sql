-- Internal team messaging system
-- Creates threads, members, and messages tables for staff-only communication

CREATE TABLE IF NOT EXISTS internal_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  is_group boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS internal_thread_members (
  thread_id uuid NOT NULL REFERENCES internal_threads(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  PRIMARY KEY (thread_id, profile_id)
);

CREATE TABLE IF NOT EXISTS internal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES internal_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_messages_thread_created_idx
  ON internal_messages (thread_id, created_at);

-- Seed: StaffVA Team group thread (fixed UUID for idempotency)
INSERT INTO internal_threads (id, name, is_group)
VALUES ('00000000-0000-0000-0000-000000000001', 'StaffVA Team', true)
ON CONFLICT (id) DO NOTHING;

-- Add all current team members to the group thread
INSERT INTO internal_thread_members (thread_id, profile_id)
SELECT '00000000-0000-0000-0000-000000000001', id
FROM profiles
WHERE role IN ('recruiter', 'recruiting_manager', 'admin')
ON CONFLICT DO NOTHING;
