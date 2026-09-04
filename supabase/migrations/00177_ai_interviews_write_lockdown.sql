-- 00174 tried to keep candidates out of the task columns with a column-level
-- REVOKE. It was a no-op, and the review caught it: a column-level revoke
-- cannot narrow a table-level grant, so all ten task_* columns stayed writable
-- by anon and authenticated. Verified after 00174 shipped —
-- information_schema.column_privileges still listed every one of them.
--
-- Nothing was actually exploitable, because RLS is what holds the line here:
-- ai_interviews has SELECT policies for candidates and recruiters and an ALL
-- policy for service_role, and NO permissive UPDATE or INSERT policy for
-- authenticated at all. An UPDATE from a candidate matches no policy and is
-- denied before the grant is ever consulted.
--
-- Which is exactly why this is worth fixing rather than shrugging at. The grant
-- says a candidate may write their own interview row; only the absence of a
-- policy stops them. The day somebody adds a permissive UPDATE policy for a
-- good reason, they inherit write access to overall_score, passed, task_score_pct
-- and the transcript, and nothing in the migration they are writing will say so.
--
-- Every write to this table already goes through the service-role client in the
-- interview app. Taking INSERT and UPDATE away from anon and authenticated
-- changes no behaviour today and removes the trap.

revoke insert, update on public.ai_interviews from authenticated, anon;

-- SELECT stays. It is policy-protected and load-bearing: candidates read their
-- own scorecard through candidates_select_own_ai_interviews, and recruiters
-- read scoped rows through recruiters_select_scoped_ai_interviews.
--
-- Known and accepted: that SELECT also exposes task_seed, task_variant and
-- task_score_pct to the candidate who owns the row. The seed and variant are
-- not secrets — they only regenerate the brief the candidate is looking at, and
-- the answer key lives in application code, not in the row. task_score_pct is a
-- single number, and the per-item detail that would actually be an answer key
-- lives in interview_task_results, which is service-role only (00175).

comment on table public.ai_interviews is
  'Writes are service-role only. anon and authenticated hold SELECT only, gated '
  'by the candidate/recruiter policies. Do NOT add a permissive UPDATE policy '
  'here without first re-reading which columns it would expose: overall_score, '
  'passed and task_score_pct are all on this table.';
