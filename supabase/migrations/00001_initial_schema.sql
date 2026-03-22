-- ============================================================
-- StaffVA — Full Database Schema (Phase 1)
-- Idempotent — safe to re-run on a partially created database.
-- Run this in the Supabase SQL Editor to set up all tables.
-- ============================================================

-- --------------------------------------------------------
-- Custom ENUM types (idempotent via DO blocks)
-- --------------------------------------------------------

DO $$ BEGIN CREATE TYPE us_experience_type AS ENUM ('full_time','part_time_contract','international_only','none'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE admin_status_type AS ENUM ('pending_speaking_review','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE english_written_tier_type AS ENUM ('exceptional','proficient','competent'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE speaking_level_type AS ENUM ('basic','conversational','proficient','fluent'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE availability_status_type AS ENUM ('available_now','available_by_date','not_available'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE sender_type AS ENUM ('client','candidate'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE test_event_type AS ENUM ('mouse_leave','tab_switch','paste_attempt','fullscreen_exit'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE test_section_type AS ENUM ('grammar','comprehension'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE user_role_type AS ENUM ('candidate','client','admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- profiles — extends Supabase auth.users
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role_type NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- candidates
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  country TEXT NOT NULL,
  role_category TEXT NOT NULL,
  years_experience TEXT NOT NULL,
  monthly_rate INTEGER NOT NULL,
  time_zone TEXT NOT NULL,
  linkedin_url TEXT,
  bio TEXT CHECK (char_length(bio) <= 300),

  us_client_experience us_experience_type NOT NULL DEFAULT 'none',
  us_client_description TEXT CHECK (char_length(us_client_description) <= 200),

  english_mc_score INTEGER,
  english_comprehension_score INTEGER,
  english_percentile INTEGER,
  english_written_tier english_written_tier_type,
  speaking_level speaking_level_type,

  voice_recording_1_url TEXT,
  voice_recording_2_url TEXT,

  cheat_flag_count INTEGER NOT NULL DEFAULT 0,
  score_mismatch_flag BOOLEAN NOT NULL DEFAULT false,

  admin_status admin_status_type NOT NULL DEFAULT 'pending_speaking_review',

  activation_fee_paid BOOLEAN NOT NULL DEFAULT true,

  availability_status availability_status_type NOT NULL DEFAULT 'available_now',
  availability_date DATE,

  resume_url TEXT,

  test_started_at TIMESTAMPTZ,
  test_completed_at TIMESTAMPTZ,
  test_time_remaining_seconds INTEGER,
  retake_count INTEGER NOT NULL DEFAULT 0,
  retake_available_at TIMESTAMPTZ,
  permanently_blocked BOOLEAN NOT NULL DEFAULT false,

  UNIQUE(user_id),
  UNIQUE(email)
);

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Approved candidates are publicly visible" ON candidates FOR SELECT USING (admin_status = 'approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Candidates can read own record" ON candidates FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Candidates can insert own record" ON candidates FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Candidates can update own record" ON candidates FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- clients
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company_name TEXT,

  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'inactive',
  subscription_started_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,

  UNIQUE(user_id),
  UNIQUE(email),
  UNIQUE(stripe_customer_id)
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Clients can read own record" ON clients FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Clients can update own record" ON clients FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Clients can insert own record" ON clients FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- test_events — anti-cheat logging
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS test_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  event_type test_event_type NOT NULL,
  question_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE test_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Candidates can insert own test events" ON test_events FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM candidates WHERE candidates.id = test_events.candidate_id AND candidates.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- question_time_tracking — time spent per question
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS question_time_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE question_time_tracking ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Candidates can insert own time tracking" ON question_time_tracking FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM candidates WHERE candidates.id = question_time_tracking.candidate_id AND candidates.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- english_test_questions — question bank
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS english_test_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section test_section_type NOT NULL,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_answer INTEGER NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE english_test_questions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "No direct public access to questions" ON english_test_questions FOR SELECT USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- candidate_test_answers — stores each answer
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS candidate_test_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES english_test_questions(id) ON DELETE CASCADE,
  selected_answer INTEGER NOT NULL,
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE candidate_test_answers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Candidates can insert own answers" ON candidate_test_answers FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM candidates WHERE candidates.id = candidate_test_answers.candidate_id AND candidates.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- messages — direct messaging between client and candidate
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  thread_id TEXT NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  sender_type sender_type NOT NULL,
  sender_id UUID NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_client ON messages(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_candidate ON messages(candidate_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Clients can read own messages" ON messages FOR SELECT
    USING (EXISTS (SELECT 1 FROM clients WHERE clients.id = messages.client_id AND clients.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Candidates can read own messages" ON messages FOR SELECT
    USING (EXISTS (SELECT 1 FROM candidates WHERE candidates.id = messages.candidate_id AND candidates.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Active clients can send messages" ON messages FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM clients WHERE clients.id = messages.client_id AND clients.user_id = auth.uid() AND clients.subscription_status = 'active'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Candidates can reply to messages" ON messages FOR INSERT
    WITH CHECK (
      EXISTS (SELECT 1 FROM candidates WHERE candidates.id = messages.candidate_id AND candidates.user_id = auth.uid())
      AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = messages.thread_id AND m.sender_type = 'client')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can mark messages as read" ON messages FOR UPDATE
    USING (
      EXISTS (SELECT 1 FROM clients WHERE clients.id = messages.client_id AND clients.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM candidates WHERE candidates.id = messages.candidate_id AND candidates.user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- saved_candidates — client bookmarks
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS saved_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, candidate_id)
);

ALTER TABLE saved_candidates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Clients can manage saved candidates" ON saved_candidates FOR ALL
    USING (EXISTS (SELECT 1 FROM clients WHERE clients.id = saved_candidates.client_id AND clients.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- platform_settings — admin-controlled settings
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_fee_enabled BOOLEAN NOT NULL DEFAULT false,
  activation_fee_amount INTEGER NOT NULL DEFAULT 19,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can read settings" ON platform_settings FOR SELECT
    USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Insert default row only if table is empty
INSERT INTO platform_settings (activation_fee_enabled, activation_fee_amount)
SELECT false, 19
WHERE NOT EXISTS (SELECT 1 FROM platform_settings);

-- --------------------------------------------------------
-- Indexes for performance
-- --------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_candidates_admin_status ON candidates(admin_status);
CREATE INDEX IF NOT EXISTS idx_candidates_role_category ON candidates(role_category);
CREATE INDEX IF NOT EXISTS idx_candidates_country ON candidates(country);
CREATE INDEX IF NOT EXISTS idx_candidates_availability ON candidates(availability_status);
CREATE INDEX IF NOT EXISTS idx_candidates_monthly_rate ON candidates(monthly_rate);
CREATE INDEX IF NOT EXISTS idx_candidates_english_percentile ON candidates(english_percentile);
CREATE INDEX IF NOT EXISTS idx_candidates_english_written_tier ON candidates(english_written_tier);
CREATE INDEX IF NOT EXISTS idx_candidates_speaking_level ON candidates(speaking_level);
CREATE INDEX IF NOT EXISTS idx_candidates_us_experience ON candidates(us_client_experience);

CREATE INDEX IF NOT EXISTS idx_clients_subscription_status ON clients(subscription_status);
CREATE INDEX IF NOT EXISTS idx_clients_stripe_customer ON clients(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_test_events_candidate ON test_events(candidate_id);

-- --------------------------------------------------------
-- Functions: auto-update updated_at
-- --------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_candidates_updated_at ON candidates;
CREATE TRIGGER set_candidates_updated_at
  BEFORE UPDATE ON candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_clients_updated_at ON clients;
CREATE TRIGGER set_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_platform_settings_updated_at ON platform_settings;
CREATE TRIGGER set_platform_settings_updated_at
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- --------------------------------------------------------
-- Storage buckets
-- --------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('resumes', 'resumes', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-recordings', 'voice-recordings', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Candidates can upload resumes" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'resumes' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can read resumes" ON storage.objects FOR SELECT
    USING (bucket_id = 'resumes' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Candidates can upload voice recordings" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'voice-recordings' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can read voice recordings" ON storage.objects FOR SELECT
    USING (bucket_id = 'voice-recordings' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
