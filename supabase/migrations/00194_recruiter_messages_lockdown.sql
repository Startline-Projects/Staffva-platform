-- A candidate could forge, rewrite and delete messages from their own recruiter.
--
-- "Candidates can manage their messages" is FOR ALL with a NULL WITH CHECK, so
-- Postgres reuses USING as the write check — and USING constrains only
-- candidate_id. It says nothing about sender_role. Verified by probing as a real
-- candidate at aal1, each rolled back:
--
--   forge a reply attributed to their recruiter  -> ALLOWED
--   rewrite the recruiter's message body         -> ALLOWED
--   delete the recruiter's message               -> ALLOWED
--
-- Step 15 is the change that puts a candidate's eyes on this table, so it is the
-- change that must close this. A candidate could otherwise fabricate "your
-- application is approved, please pay the placement fee" under their named
-- specialist's real name and photo, and then delete the evidence.
--
-- The restrictive aal2 policy does not help: mfa_satisfied() returns true for
-- anyone with no verified factor.
--
-- Revoking write is free. Every write already goes through the service role —
-- the only browser access to this table in the entire codebase is a SELECT count
-- at LegacyDashboard.tsx:700. Revoking beats patching the policy, because grants
-- are table-level and RLS cannot constrain a column value like sender_role.

begin;

revoke insert, update, delete on public.recruiter_messages from authenticated, anon;

-- Replaced by one read policy. The old pair were FOR ALL, and the recruiter one
-- additionally required profiles.role = 'recruiter' — which locked the
-- recruiting_manager out of the three threads she is assigned, holding 9 of the
-- 10 unread messages. She has never been able to read them on any screen.
drop policy if exists "Candidates can manage their messages" on public.recruiter_messages;
drop policy if exists "Recruiters can manage their messages" on public.recruiter_messages;

create policy "Read own thread" on public.recruiter_messages
  for select to authenticated
  using (
    -- the candidate whose thread it is
    candidate_id in (select id from public.candidates where user_id = (select auth.uid()))
    -- the staff member the message was addressed to when it was written
    or recruiter_id = (select auth.uid())
    -- whoever is assigned to that candidate NOW (assigned_recruiter is TEXT
    -- holding a profiles.id, a known identity split in this schema)
    or candidate_id in (
      select c.id from public.candidates c
      where c.assigned_recruiter = ((select auth.uid()))::text
    )
    or public.is_admin()
  );

commit;
