-- Allow candidates to read their assigned recruiter's profile
-- Needed so the dashboard can display recruiter name, photo, and calendar link
CREATE POLICY "Candidates can read assigned recruiter profile"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM candidates
      WHERE candidates.user_id = auth.uid()
        AND candidates.assigned_recruiter = profiles.id
    )
  );
