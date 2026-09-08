-- 00222: retire the assessment-keyed ID trigger (band B/C review, finding 4).
--
-- 00154 installed stamp_id_verification_due: a BEFORE UPDATE trigger that
-- sets id_verification_due_at = now() + 14 days when English >= 70 AND
-- ai_interview_passed, provided the column is still null.
--
-- With assessments optional (00221) that trigger is both redundant and
-- harmful:
--   * redundant, because the 14-day clock now starts AT GO-LIVE — in
--     promote_candidate_if_ready and, since this review, in the four human
--     approval routes as well;
--   * harmful, because 224 already-live candidates carry a NULL due date.
--     If one of them takes the now-OPTIONAL English test and passes, this
--     trigger opens a 14-day window on a profile that is already listed, and
--     the visibility predicate hides them on day 15. Passing a voluntary
--     assessment would cost them their listing — the same class of trap 00220
--     closed on the failure side.
--
-- Dropping it leaves exactly one place that starts the clock: going live.
drop trigger if exists stamp_id_verification_due on public.candidates;

-- The function is left in place, unreferenced, rather than dropped: 00155's
-- backstop comment and this file both describe it, and a future decision to
-- start clocks for the existing 224 may want it back. It cannot fire with no
-- trigger attached.
comment on function public.stamp_id_verification_due() is
  'UNUSED since 00222. Kept for reference only — the ID window now starts at '
  'go-live (promote_candidate_if_ready and the approval routes), never at '
  'passing an assessment.';
