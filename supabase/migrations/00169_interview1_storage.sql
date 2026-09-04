-- Interview 1 answer recordings live in voice-recordings under
-- {candidateId}/interview1/{interviewId}/ — same class of content as the
-- assessment answers 00167 locked down, same exclusion from the blanket
-- authenticated read/insert. Served only via service-role signing.
drop policy if exists "Candidates can upload voice recordings" on storage.objects;
create policy "Candidates can upload voice recordings"
  on storage.objects for insert
  with check (
    bucket_id = 'voice-recordings'
    and auth.role() = 'authenticated'
    and name not like '%/assessment/%'
    and name not like 'assessment-prompts/%'
    and name not like '%/interview1/%'
  );

drop policy if exists "Authenticated users can read voice recordings" on storage.objects;
create policy "Authenticated users can read voice recordings"
  on storage.objects for select
  using (
    bucket_id = 'voice-recordings'
    and auth.role() = 'authenticated'
    and name not like '%/assessment/%'
    and name not like 'assessment-prompts/%'
    and name not like '%/interview1/%'
  );
