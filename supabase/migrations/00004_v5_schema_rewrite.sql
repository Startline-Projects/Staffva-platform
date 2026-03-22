-- ============================================================
-- StaffVA v5 — Schema Migration
-- Transforms v3 schema to v5 FINAL.
-- Idempotent — safe to re-run.
-- Run this in the Supabase SQL Editor after 00001-00003.
-- ============================================================

-- --------------------------------------------------------
-- New ENUM types
-- --------------------------------------------------------

DO $$ BEGIN CREATE TYPE id_verification_status_type AS ENUM ('pending','passed','failed','manual_review'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE contract_type AS ENUM ('ongoing','project'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_cycle_type AS ENUM ('weekly','biweekly','monthly'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE engagement_status_type AS ENUM ('active','payment_failed','released','completed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE milestone_status_type AS ENUM ('pending','funded','candidate_marked_complete','approved','disputed','released','refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE period_status_type AS ENUM ('funded','released','disputed','refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE dispute_decision_type AS ENUM ('full_client_refund','full_candidate_release','split_50_50','pro_rata','fraud_ban'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE filed_by_type AS ENUM ('client','candidate'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payout_method_type AS ENUM ('payoneer','wise','bank_transfer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE badge_type AS ENUM ('90_day','180_day','365_day'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- Alter candidates table — add v5 columns
-- --------------------------------------------------------

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS id_verification_status id_verification_status_type DEFAULT 'pending';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS payout_method payout_method_type;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS payout_account_id TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS total_earnings_usd NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS lock_status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS locked_by_client_id UUID;

-- Auto-generate display_name for existing rows
UPDATE candidates
SET display_name = CONCAT(
  SPLIT_PART(full_name, ' ', 1),
  ' ',
  LEFT(SPLIT_PART(full_name, ' ', 2), 1),
  '.'
)
WHERE display_name IS NULL AND full_name IS NOT NULL;

-- Function to auto-generate display_name on insert/update
CREATE OR REPLACE FUNCTION generate_display_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.full_name IS NOT NULL THEN
    NEW.display_name := CONCAT(
      SPLIT_PART(NEW.full_name, ' ', 1),
      ' ',
      LEFT(SPLIT_PART(NEW.full_name, ' ', 2), 1),
      '.'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_candidate_display_name ON candidates;
CREATE TRIGGER set_candidate_display_name
  BEFORE INSERT OR UPDATE OF full_name ON candidates
  FOR EACH ROW EXECUTE FUNCTION generate_display_name();

-- --------------------------------------------------------
-- Alter clients table — remove subscription fields, add v5 fields
-- --------------------------------------------------------

-- Drop subscription columns (v5 has no subscriptions)
ALTER TABLE clients DROP COLUMN IF EXISTS stripe_subscription_id;
ALTER TABLE clients DROP COLUMN IF EXISTS subscription_status;
ALTER TABLE clients DROP COLUMN IF EXISTS subscription_started_at;
ALTER TABLE clients DROP COLUMN IF EXISTS subscription_ends_at;

-- Drop the now-unused index
DROP INDEX IF EXISTS idx_clients_subscription_status;

-- --------------------------------------------------------
-- Alter messages table — add engagement_id
-- --------------------------------------------------------

ALTER TABLE messages ADD COLUMN IF NOT EXISTS engagement_id UUID;
-- client_id and candidate_id kept for backward compat; engagement_id is the v5 primary link

-- --------------------------------------------------------
-- Portfolio items table
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS portfolio_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL, -- 'pdf' or 'image'
  description TEXT CHECK (char_length(description) <= 100),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Candidates can manage own portfolio" ON portfolio_items FOR ALL
    USING (EXISTS (SELECT 1 FROM candidates WHERE candidates.id = portfolio_items.candidate_id AND candidates.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Portfolio items publicly visible for approved candidates" ON portfolio_items FOR SELECT
    USING (EXISTS (SELECT 1 FROM candidates WHERE candidates.id = portfolio_items.candidate_id AND candidates.admin_status = 'approved'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- Engagements table
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  contract_type contract_type NOT NULL,
  payment_cycle payment_cycle_type, -- ongoing contracts only
  candidate_rate_usd NUMERIC(10,2) NOT NULL,
  platform_fee_usd NUMERIC(10,2) NOT NULL,
  client_total_usd NUMERIC(10,2) NOT NULL,
  status engagement_status_type NOT NULL DEFAULT 'active',
  lock_activated_at TIMESTAMPTZ,
  lock_released_at TIMESTAMPTZ,
  is_direct_contract BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Clients can read own engagements" ON engagements FOR SELECT
    USING (EXISTS (SELECT 1 FROM clients WHERE clients.id = engagements.client_id AND clients.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Candidates can read own engagements" ON engagements FOR SELECT
    USING (EXISTS (SELECT 1 FROM candidates WHERE candidates.id = engagements.candidate_id AND candidates.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_engagements_client ON engagements(client_id);
CREATE INDEX IF NOT EXISTS idx_engagements_candidate ON engagements(candidate_id);
CREATE INDEX IF NOT EXISTS idx_engagements_status ON engagements(status);

-- --------------------------------------------------------
-- Milestones table (Project contracts)
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  amount_usd NUMERIC(10,2) NOT NULL,
  status milestone_status_type NOT NULL DEFAULT 'pending',
  funded_at TIMESTAMPTZ,
  marked_complete_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  auto_release_at TIMESTAMPTZ, -- 7 days after marked_complete_at
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Engagement parties can read milestones" ON milestones FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM engagements e
      JOIN clients c ON c.id = e.client_id
      WHERE e.id = milestones.engagement_id AND c.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM engagements e
      JOIN candidates ca ON ca.id = e.candidate_id
      WHERE e.id = milestones.engagement_id AND ca.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_milestones_engagement ON milestones(engagement_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status ON milestones(status);
CREATE INDEX IF NOT EXISTS idx_milestones_auto_release ON milestones(auto_release_at) WHERE status = 'candidate_marked_complete';

-- --------------------------------------------------------
-- Payment periods table (Ongoing contracts)
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount_usd NUMERIC(10,2) NOT NULL,
  status period_status_type NOT NULL DEFAULT 'funded',
  funded_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  dispute_filed_at TIMESTAMPTZ,
  auto_release_at TIMESTAMPTZ, -- 48 hours after period_end
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payment_periods ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Engagement parties can read payment periods" ON payment_periods FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM engagements e
      JOIN clients c ON c.id = e.client_id
      WHERE e.id = payment_periods.engagement_id AND c.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM engagements e
      JOIN candidates ca ON ca.id = e.candidate_id
      WHERE e.id = payment_periods.engagement_id AND ca.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_payment_periods_engagement ON payment_periods(engagement_id);
CREATE INDEX IF NOT EXISTS idx_payment_periods_status ON payment_periods(status);
CREATE INDEX IF NOT EXISTS idx_payment_periods_auto_release ON payment_periods(auto_release_at) WHERE status = 'funded';

-- --------------------------------------------------------
-- Disputes table
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  period_id UUID REFERENCES payment_periods(id),
  milestone_id UUID REFERENCES milestones(id),
  filed_by filed_by_type NOT NULL,
  filed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount_in_escrow_usd NUMERIC(10,2) NOT NULL,
  client_statement TEXT,
  candidate_statement TEXT,
  client_evidence_url TEXT,
  candidate_evidence_url TEXT,
  decision dispute_decision_type,
  decision_notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID, -- admin user id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Engagement parties can read disputes" ON disputes FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM engagements e
      JOIN clients c ON c.id = e.client_id
      WHERE e.id = disputes.engagement_id AND c.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM engagements e
      JOIN candidates ca ON ca.id = e.candidate_id
      WHERE e.id = disputes.engagement_id AND ca.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_disputes_engagement ON disputes(engagement_id);
CREATE INDEX IF NOT EXISTS idx_disputes_decision ON disputes(decision) WHERE decision IS NULL;

-- --------------------------------------------------------
-- Reviews table
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body TEXT,
  eligible_at TIMESTAMPTZ NOT NULL, -- 30 days after first payment released
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Reviews publicly readable" ON reviews FOR SELECT
    USING (published = true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Clients can insert own reviews" ON reviews FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM clients WHERE clients.id = reviews.client_id AND clients.user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_reviews_candidate ON reviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_reviews_engagement ON reviews(engagement_id);

-- --------------------------------------------------------
-- Tenure badges table
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenure_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  badge_type badge_type NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(engagement_id, badge_type)
);

ALTER TABLE tenure_badges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Tenure badges publicly readable" ON tenure_badges FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_tenure_badges_candidate ON tenure_badges(candidate_id);

-- --------------------------------------------------------
-- Storage bucket for portfolio and dispute evidence
-- --------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('portfolio', 'portfolio', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('dispute-evidence', 'dispute-evidence', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Candidates can upload portfolio" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'portfolio' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can read portfolio" ON storage.objects FOR SELECT
    USING (bucket_id = 'portfolio' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can upload dispute evidence" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'dispute-evidence' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can read dispute evidence" ON storage.objects FOR SELECT
    USING (bucket_id = 'dispute-evidence' AND auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------
-- New indexes for v5
-- --------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_candidates_lock_status ON candidates(lock_status);
CREATE INDEX IF NOT EXISTS idx_candidates_total_earnings ON candidates(total_earnings_usd);
CREATE INDEX IF NOT EXISTS idx_candidates_id_verification ON candidates(id_verification_status);

-- --------------------------------------------------------
-- Update platform_settings — remove activation fee, keep table for future use
-- --------------------------------------------------------

ALTER TABLE platform_settings DROP COLUMN IF EXISTS activation_fee_enabled;
ALTER TABLE platform_settings DROP COLUMN IF EXISTS activation_fee_amount;

-- Add a generic settings JSONB column for future flexibility
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

-- --------------------------------------------------------
-- Engagement-related triggers
-- --------------------------------------------------------

CREATE OR REPLACE FUNCTION update_candidate_lock_on_engagement()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' AND (OLD.status IS NULL OR OLD.status != 'active') THEN
    -- Lock candidate
    UPDATE candidates SET
      lock_status = 'locked',
      locked_by_client_id = NEW.client_id,
      availability_status = 'not_available'
    WHERE id = NEW.candidate_id;
  END IF;

  IF NEW.status IN ('released', 'completed', 'payment_failed')
     AND OLD.status = 'active' THEN
    -- Check if candidate has any other active engagements
    IF NOT EXISTS (
      SELECT 1 FROM engagements
      WHERE candidate_id = NEW.candidate_id
        AND status = 'active'
        AND id != NEW.id
    ) THEN
      UPDATE candidates SET
        lock_status = 'available',
        locked_by_client_id = NULL,
        availability_status = 'available_now'
      WHERE id = NEW.candidate_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS engagement_lock_trigger ON engagements;
CREATE TRIGGER engagement_lock_trigger
  AFTER INSERT OR UPDATE OF status ON engagements
  FOR EACH ROW EXECUTE FUNCTION update_candidate_lock_on_engagement();

-- Trigger to update verified earnings on payment release
CREATE OR REPLACE FUNCTION update_verified_earnings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'released' AND OLD.status != 'released' THEN
    UPDATE candidates SET
      total_earnings_usd = total_earnings_usd + NEW.amount_usd
    WHERE id = (SELECT candidate_id FROM engagements WHERE id = NEW.engagement_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS payment_period_earnings_trigger ON payment_periods;
CREATE TRIGGER payment_period_earnings_trigger
  AFTER UPDATE OF status ON payment_periods
  FOR EACH ROW EXECUTE FUNCTION update_verified_earnings();

DROP TRIGGER IF EXISTS milestone_earnings_trigger ON milestones;
CREATE TRIGGER milestone_earnings_trigger
  AFTER UPDATE OF status ON milestones
  FOR EACH ROW EXECUTE FUNCTION update_verified_earnings();
