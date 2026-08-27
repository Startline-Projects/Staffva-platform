-- Measure-only device capability report, written by /api/apply/device-report.
--
-- The proctor design requires a webcam, but has_webcam is unknown for 254 of
-- 255 candidates -- the application form never asked, and DeviceCheck never
-- probed. Enforcing "camera required" without knowing the real exclusion rate
-- means finding it out by watching signups fall. So: measure first, block
-- nobody, decide with data. enumerateDevices() reports device KINDS without
-- any permission prompt and without capturing anything, which is why this
-- sits outside the biometric-consent gate.
alter table public.candidates
  add column if not exists device_report jsonb;
