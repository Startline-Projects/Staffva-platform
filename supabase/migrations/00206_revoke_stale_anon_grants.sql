-- 00206 — stale anon grants the step-18 security sweep flagged.
--
-- anon still holds INSERT/SELECT/UPDATE on engagement_contracts and SELECT on
-- recruiter_messages. Both are inert TODAY (neither table has an anon policy),
-- but this is precisely the trap the step-17 review documented on reviews:
-- a single future policy written role-blind ("for select using (...)") would
-- re-arm them, and contracts + the specialist thread are the last tables that
-- may greet the open internet. Grants should say what is meant.
revoke all on public.engagement_contracts from anon;
revoke all on public.recruiter_messages from anon;
