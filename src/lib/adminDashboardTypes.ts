/**
 * The shape of /api/admin/command-center, in ONE place.
 *
 * The dashboard used to keep its own hand-written copy of this, which meant
 * the route could change what it returned and the page would go on compiling
 * against a description of something else. That is what made "a failed count
 * renders as zero" invisible to the compiler: `number` on one side of a fetch
 * proves nothing about the other.
 *
 * Both sides import this now. The route builds its response `satisfies
 * DashboardData`, so making a figure nullable there is a compile error on the
 * dashboard until the dashboard says what it shows instead.
 *
 * Figures are `number | null`: null means the read failed, never zero.
 */

export interface Pipeline {
  applied: number | null;
  englishPass: number | null;
  idVerified: number | null;
  profileBuilt: number | null;
  aiInterview: number | null;
  pendingProfileReview: number | null;
  live: number | null;
}

export interface PendingCandidate {
  id: string;
  full_name: string;
  display_name: string;
  role_category: string;
  country: string;
  hourly_rate: number;
  english_written_tier: string;
  english_mc_score: number;
  english_comprehension_score: number;
  ai_interview_score: number;
  years_experience: number;
  voice_recording_1_url: string | null;
  voice_recording_2_url: string | null;
  id_verification_status: string;
  profile_photo_url: string | null;
}

export interface WarmLead {
  id: string;
  name: string;
  activity: string;
  daysCold: number;
  isNew: boolean;
}

export interface ClientRow {
  id: string;
  name: string;
  email: string;
  lastLogin: string;
  daysSinceLogin: number;
  browseActivity: string;
  activeEngagements: number;
  totalFees: number;
  joined: string;
  status: string;
}

export interface RouteCandidate {
  id: string;
  full_name: string;
  display_name: string;
  role_category: string;
  country: string;
  hourly_rate: number;
  created_at: string;
}

export interface DashboardData {
  mrr: number | null;
  mrrSparkline: number[];
  liveCandidates: number | null;
  activeEngagements: number | null;
  newEngThisWeek: number | null;
  platformFeeThisMonth: number | null;
  /** null = the client or engagement read failed; not "no warm leads". */
  warmLeadsCount: number | null;
  pipeline: Pipeline;
  pendingCandidates: PendingCandidate[];
  warmLeads: WarmLead[];
  recruiterAlerts: { needsRouting: number | null };
  screening: { screenedToday: number | null };
  identity: { lockouts: number | null; flagged: number | null; verified: number | null };
  pulse: {
    applicationsThisWeek: number | null;
    applicationsLastWeek: number | null;
    appChangePercent: number | null;
    clientsThisWeek: number | null;
    clientsLastWeek: number | null;
    clientWeekChange: number | null;
    activeConversations: number | null;
    newCandidatesMonth: number | null;
  };
  clientHealth: ClientRow[];
  clientsThisMonth: number | null;
  totalClients: number | null;
  talentPoolHealth: { liveCandidates: number | null; rolesBelow2: number | null };
  routeCandidates: RouteCandidate[];
  recruiters: { id: string; name: string }[];
  /** Rail counters. null = unread, and the rail shows no number rather than none. */
  badges: {
    pendingProfileReview: number | null;
    pendingReview: number | null;
    clients: number | null;
    talentPool: number | null;
    triage: number | null;
    teamInbox: number | null;
    pendingBans: number | null;
  };
  /**
   * Every read this payload depended on that failed, named for a person. A
   * null figure above says "this one is unknown"; this says WHY the lists
   * (warm leads, client health, routing) may be short — those cannot be null
   * without a rewrite of every section that maps over them.
   */
  failedReads: string[];
}
