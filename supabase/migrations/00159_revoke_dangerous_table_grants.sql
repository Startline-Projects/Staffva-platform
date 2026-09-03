-- Every public table carried the Supabase default blanket GRANT ALL for the
-- PostgREST roles: anon and authenticated held TRUNCATE, REFERENCES, TRIGGER
-- (and MAINTAIN) on all ~64 relations, none of which PostgREST can ever
-- issue — but any credential that reaches raw SQL as those roles could
-- empty tables, since TRUNCATE ignores RLS entirely. This project has
-- already had one anon-executable raw-SQL door (exec_sql, since locked to
-- service_role), so the lurking grants go.
--
-- DELETE is revoked wherever no row-security policy gives a real user a
-- delete path. "Real" means a delete-capable (DELETE/ALL) policy whose
-- qual is scoped to auth.uid(); the nine tables below keep authenticated
-- DELETE for exactly those policies (three of them are exercised by app
-- code today: candidate_availability, candidate_availability_blackouts,
-- application_progress). The "Admin can manage ..." ALL policies are
-- USING (true) TO public — with the DELETE grant they let ANY key holder
-- delete every row, and no app code uses them with a user client, so those
-- tables lose DELETE too. (The UPDATE half of that hole is a policy bug,
-- tracked separately — grants stay as designed for UPDATE.)
--
-- anon keeps no DELETE anywhere: the only anon-intended write on the
-- platform is the waitlist INSERT.
--
-- Default ACLs for role postgres are trimmed the same way so future tables
-- don't re-grow the hazard (authenticated keeps DELETE in the default so a
-- future scoped delete policy works without a surprise grant hunt).
-- supabase_admin's identical default ACL cannot be altered from here
-- (postgres is not a member); tables are created by migrations running as
-- postgres, so in practice the postgres default is the one that applies.

-- 1. Privileges PostgREST never uses: gone everywhere, both roles.
revoke truncate, references, trigger, maintain on table
  public.ai_interviews,
  public.application_progress,
  public.application_queue,
  public.availability_notifications,
  public.candidate_availability,
  public.candidate_availability_blackouts,
  public.candidate_change_requests,
  public.candidate_emails,
  public.candidate_interviews,
  public.candidate_test_answers,
  public.candidates,
  public.capacity_log,
  public.cheat_log,
  public.clients,
  public.disputes,
  public.engagement_contracts,
  public.engagement_offers,
  public.engagements,
  public.english_test_lockouts,
  public.english_test_questions,
  public.internal_messages,
  public.internal_thread_members,
  public.internal_threads,
  public.interview_attempts,
  public.interview_config,
  public.interview_requests,
  public.interviewer_delegation,
  public.job_post_matches,
  public.job_posts,
  public.lockout_overrides,
  public.manager_notifications,
  public.match_queries,
  public.message_blocks,
  public.messages,
  public.migration_00083_audit,
  public.milestones,
  public.payment_periods,
  public.platform_settings,
  public.portfolio_items,
  public.proctor_sessions,
  public.profile_edit_requests,
  public.profile_revisions,
  public.profile_views,
  public.profiles,
  public.recruiter_assignments,
  public.recruiter_messages,
  public.recruiter_notifications,
  public.recruiter_reassignment_log,
  public.reviews,
  public.saved_candidates,
  public.screening_log,
  public.screening_queue,
  public.service_orders,
  public.service_packages,
  public.social_posts,
  public.tenure_badges,
  public.test_events,
  public.trolley_log,
  public.unrouted_alerts,
  public.verified_identities,
  public.video_intro_reviews,
  public.waitlist_users,
  public.webhook_failures,
  public.webhook_log
from anon, authenticated;

-- 2. anon: no delete path is designed anywhere.
revoke delete on table
  public.ai_interviews,
  public.application_progress,
  public.application_queue,
  public.availability_notifications,
  public.candidate_availability,
  public.candidate_availability_blackouts,
  public.candidate_change_requests,
  public.candidate_emails,
  public.candidate_interviews,
  public.candidate_test_answers,
  public.candidates,
  public.capacity_log,
  public.cheat_log,
  public.clients,
  public.disputes,
  public.engagement_contracts,
  public.engagement_offers,
  public.engagements,
  public.english_test_lockouts,
  public.english_test_questions,
  public.internal_messages,
  public.internal_thread_members,
  public.internal_threads,
  public.interview_attempts,
  public.interview_config,
  public.interview_requests,
  public.interviewer_delegation,
  public.job_post_matches,
  public.job_posts,
  public.lockout_overrides,
  public.manager_notifications,
  public.match_queries,
  public.message_blocks,
  public.messages,
  public.migration_00083_audit,
  public.milestones,
  public.payment_periods,
  public.platform_settings,
  public.portfolio_items,
  public.proctor_sessions,
  public.profile_edit_requests,
  public.profile_revisions,
  public.profile_views,
  public.profiles,
  public.recruiter_assignments,
  public.recruiter_messages,
  public.recruiter_notifications,
  public.recruiter_reassignment_log,
  public.reviews,
  public.saved_candidates,
  public.screening_log,
  public.screening_queue,
  public.service_orders,
  public.service_packages,
  public.social_posts,
  public.tenure_badges,
  public.test_events,
  public.trolley_log,
  public.unrouted_alerts,
  public.verified_identities,
  public.video_intro_reviews,
  public.waitlist_users,
  public.webhook_failures,
  public.webhook_log
from anon;

-- 3. authenticated: DELETE stays only where a scoped policy designs it —
--    application_progress, availability_notifications, candidate_availability,
--    candidate_availability_blackouts, job_posts, portfolio_items,
--    recruiter_messages, saved_candidates, service_packages.
revoke delete on table
  public.ai_interviews,
  public.application_queue,
  public.candidate_change_requests,
  public.candidate_emails,
  public.candidate_interviews,
  public.candidate_test_answers,
  public.candidates,
  public.capacity_log,
  public.cheat_log,
  public.clients,
  public.disputes,
  public.engagement_contracts,
  public.engagement_offers,
  public.engagements,
  public.english_test_lockouts,
  public.english_test_questions,
  public.internal_messages,
  public.internal_thread_members,
  public.internal_threads,
  public.interview_attempts,
  public.interview_config,
  public.interview_requests,
  public.interviewer_delegation,
  public.job_post_matches,
  public.lockout_overrides,
  public.manager_notifications,
  public.match_queries,
  public.message_blocks,
  public.messages,
  public.migration_00083_audit,
  public.milestones,
  public.payment_periods,
  public.platform_settings,
  public.proctor_sessions,
  public.profile_edit_requests,
  public.profile_revisions,
  public.profile_views,
  public.profiles,
  public.recruiter_assignments,
  public.recruiter_notifications,
  public.recruiter_reassignment_log,
  public.reviews,
  public.screening_log,
  public.screening_queue,
  public.service_orders,
  public.social_posts,
  public.tenure_badges,
  public.test_events,
  public.trolley_log,
  public.unrouted_alerts,
  public.verified_identities,
  public.video_intro_reviews,
  public.waitlist_users,
  public.webhook_failures,
  public.webhook_log
from authenticated;

-- 4. Future tables created by postgres (i.e. by migrations) start without
--    the hazard privileges.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke delete on tables from anon;
