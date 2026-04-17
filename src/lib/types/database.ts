// ============================================================
// StaffVA v5 — Database Types
// ============================================================

// -- Enums --

export type UserRole = "candidate" | "client" | "admin" | "recruiter" | "recruiting_manager";

export type USExperience =
  | "full_time"
  | "part_time_contract"
  | "international_only"
  | "none";

export type AdminStatus = "pending_2nd_interview" | "pending_speaking_review" | "pending_review" | "ai_interview_failed" | "approved";

export type EnglishWrittenTier = "exceptional" | "proficient" | "competent";

export type AvailabilityStatus =
  | "available_now"
  | "available_by_date"
  | "not_available";

export type SenderType = "client" | "candidate";

export type TestEventType =
  | "mouse_leave"
  | "tab_switch"
  | "paste_attempt"
  | "fullscreen_exit";

export type TestSection = "grammar" | "comprehension";

export type IDVerificationStatus =
  | "pending"
  | "passed"
  | "failed"
  | "manual_review";

export type ContractType = "ongoing" | "project";

export type PaymentCycle = "weekly" | "biweekly" | "monthly";

export type EngagementStatus =
  | "active"
  | "payment_failed"
  | "released"
  | "completed";

export type MilestoneStatus =
  | "pending"
  | "funded"
  | "candidate_marked_complete"
  | "approved"
  | "disputed"
  | "released"
  | "refunded";

export type PeriodStatus = "funded" | "released" | "disputed" | "refunded";

export type DisputeDecision =
  | "full_client_refund"
  | "full_candidate_release"
  | "split_50_50"
  | "pro_rata"
  | "fraud_ban";

export type FiledBy = "client" | "candidate";

export type PayoutMethod = "payoneer" | "wise" | "bank_transfer";

export type BadgeType = "90_day" | "180_day" | "365_day";

// -- Table interfaces --

export interface Profile {
  id: string;
  role: UserRole;
  email: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Candidate {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;

  // Identity
  full_name: string;
  display_name: string; // auto-generated: "First L."
  email: string;
  country: string;
  role_category: string;
  years_experience: string;
  hourly_rate: number;
  time_zone: string;
  linkedin_url: string | null;
  bio: string | null;

  // US experience
  us_client_experience: USExperience;
  us_client_description: string | null;

  // English test
  english_mc_score: number | null;
  english_comprehension_score: number | null;
  english_percentile: number | null;
  english_written_tier: EnglishWrittenTier | null;

  // Recordings
  voice_recording_1_url: string | null;
  voice_recording_2_url: string | null;

  // Anti-cheat
  cheat_flag_count: number;
  score_mismatch_flag: boolean;

  // ID verification
  id_verification_status: IDVerificationStatus;

  // Admin
  admin_status: AdminStatus;

  // Availability & lock
  availability_status: AvailabilityStatus;
  availability_date: string | null;
  lock_status: string; // "available" | "locked"
  locked_by_client_id: string | null;

  // Profile assets
  resume_url: string | null;

  // Payout
  payout_method: PayoutMethod | null;
  payout_account_id: string | null;

  // Verified earnings
  total_earnings_usd: number;

  // Test metadata
  test_started_at: string | null;
  test_completed_at: string | null;
  test_time_remaining_seconds: number | null;
  retake_count: number;
  retake_available_at: string | null;
  permanently_blocked: boolean;
}

export interface Client {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  email: string;
  company_name: string | null;
  stripe_customer_id: string | null;
}

export interface Engagement {
  id: string;
  created_at: string;
  client_id: string;
  candidate_id: string;
  contract_type: ContractType;
  payment_cycle: PaymentCycle | null;
  candidate_rate_usd: number;
  platform_fee_usd: number;
  client_total_usd: number;
  status: EngagementStatus;
  lock_activated_at: string | null;
  lock_released_at: string | null;
  is_direct_contract: boolean;
}

export interface Milestone {
  id: string;
  engagement_id: string;
  title: string;
  description: string | null;
  amount_usd: number;
  status: MilestoneStatus;
  funded_at: string | null;
  marked_complete_at: string | null;
  approved_at: string | null;
  released_at: string | null;
  auto_release_at: string | null;
  created_at: string;
}

export interface PaymentPeriod {
  id: string;
  engagement_id: string;
  period_start: string;
  period_end: string;
  amount_usd: number;
  status: PeriodStatus;
  funded_at: string | null;
  released_at: string | null;
  dispute_filed_at: string | null;
  auto_release_at: string | null;
  created_at: string;
}

export interface Dispute {
  id: string;
  engagement_id: string;
  period_id: string | null;
  milestone_id: string | null;
  filed_by: FiledBy;
  filed_at: string;
  amount_in_escrow_usd: number;
  client_statement: string | null;
  candidate_statement: string | null;
  client_evidence_url: string | null;
  candidate_evidence_url: string | null;
  decision: DisputeDecision | null;
  decision_notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface Review {
  id: string;
  engagement_id: string;
  client_id: string;
  candidate_id: string;
  rating: number;
  body: string | null;
  eligible_at: string;
  submitted_at: string;
  published: boolean;
  created_at: string;
}

export interface TenureBadge {
  id: string;
  engagement_id: string;
  candidate_id: string;
  client_id: string;
  badge_type: BadgeType;
  awarded_at: string;
}

export interface PortfolioItem {
  id: string;
  candidate_id: string;
  file_url: string;
  file_type: string;
  description: string | null;
  display_order: number;
  created_at: string;
}

export interface Message {
  id: string;
  created_at: string;
  engagement_id: string | null;
  thread_id: string;
  client_id: string;
  candidate_id: string;
  sender_type: SenderType;
  sender_id: string;
  body: string;
  read_at: string | null;
}

export interface SavedCandidate {
  id: string;
  client_id: string;
  candidate_id: string;
  created_at: string;
}

export interface TestEvent {
  id: string;
  candidate_id: string;
  event_type: TestEventType;
  question_number: number | null;
  created_at: string;
}

export interface EnglishTestQuestion {
  id: string;
  section: TestSection;
  question_text: string;
  options: string[];
  correct_answer: number;
  display_order: number;
  active: boolean;
  created_at: string;
}

export interface CandidateTestAnswer {
  id: string;
  candidate_id: string;
  question_id: string;
  selected_answer: number;
  is_correct: boolean;
  created_at: string;
}

export interface QuestionTimeTracking {
  id: string;
  candidate_id: string;
  question_id: string;
  time_spent_seconds: number;
  created_at: string;
}

export interface PlatformSettings {
  id: string;
  settings: Record<string, unknown>;
  updated_at: string;
}
