-- Consent must be un-forgeable to be worth recording. 00120's column-level
-- grants let any authenticated session write id_verification_consent with an
-- arbitrary timestamp and version straight through PostgREST — including an
-- aal1 half-session on an MFA-protected account, since no RLS policy
-- inspects the JWT aal claim. The write moves to /api/identity/consent
-- (service role, behind the same AAL gate as the other identity routes) and
-- the browser loses the columns.
revoke update (id_verification_consent, id_verification_consent_at, id_verification_consent_version)
  on public.candidates
  from authenticated;
