# Proctoring consent — DRAFT v1 for counsel review

**Status: NOT shipped. Nothing shows this to candidates yet.**

This is the consent copy for the AI proctor (continuous video + audio capture
during the English test and the AI interview, biometric face matching against
the Stripe-verified selfie, and voice matching against the candidate's own
recordings). It must be reviewed by counsel before any capture ships —
candidates are in ~15 countries (67% Philippines, 14% Egypt, the rest across
Pakistan, Nigeria, India and others), so biometric-consent requirements from
multiple regimes apply, including the Philippine Data Privacy Act (RA 10173)
and, where applicable, the GDPR.

Design constraints this copy must respect (from the proctor spec):

- We CANNOT truthfully say "we only record you if you cheat." Everything is
  captured, analysed, and the unflagged majority deleted quickly. The true
  sentence is "recordings are deleted unless flagged."
- The AI never rejects anyone. A person reviews flagged sessions and decides.
- Flagged evidence is kept until a decision, then 7 days from the decision.
- The candidate is told why if rejected, and shown their recording.
- Consent must be VERSIONED (follow the existing
  `id_verification_consent_version` pattern) and recorded with a timestamp at
  the moment of the affirmative act — never a column default. The existing
  `interview_consent` column is DEFAULT TRUE and records nothing; do not reuse
  it.
- Consent must be collected in BOTH apps (the pledge currently exists only
  before the English test; the interview runs in a different app with none).

---

## Proposed consent screen copy (v1)

**Before you begin: this session is recorded**

To keep StaffVA fair for everyone, your test and interview sessions are
monitored:

- **Your camera and microphone record the whole session.** Before starting,
  you'll be asked to briefly show your room.
- **We confirm it's you.** Your face is compared with the ID photo you
  verified with Stripe, and your voice with the recordings you submitted.
- **A person makes any decision.** Automated checks can flag a session for
  review, but only a member of the StaffVA team can decide an integrity issue,
  after watching the recording. If that happens, you'll be told why and shown
  the recording.
- **Recordings are deleted unless flagged.** If your session isn't flagged,
  the recording is deleted within [X days — operational value, keep short].
  If it is flagged, it's kept until a decision is made and for 7 days after.
- Recording, face comparison and voice comparison happen only with this
  consent. If you'd rather not proceed, you can stop here — but these checks
  are required to join the marketplace.

☐ I agree to the recording and identity checks described above
  (consent v2.0, recorded with timestamp)

[Continue]   [Read the full Privacy Policy]

---

## Open questions for counsel

1. Is bundled consent (recording + face match + voice match in one checkbox)
   acceptable in PH/EG/PK/NG/IN, or must biometric matching be a separate
   affirmative act?
2. Retention: is "7 days from decision" defensible for REJECTED candidates,
   who may dispute later? Is a longer hold for rejections required or wiser?
3. Third parties in frame (family members in shared homes, including minors):
   what notice/handling is required when a reviewer sees them, and when the
   candidate is shown a recording containing them?
4. Cross-border: capture stored on US infrastructure (Supabase/Vercel),
   biometric comparison possibly via a US vendor — what transfer language is
   needed per regime?
5. Is "required to join the marketplace" permissible framing for biometric
   consent (consent as condition of service) in each major jurisdiction, or
   does PH DPA / GDPR require an alternative path?
6. The $10 retake fee after a human cheating rejection: any consumer-law
   exposure per jurisdiction, given no appeal process is planned?
