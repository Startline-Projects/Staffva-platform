ALTER TABLE candidates ADD COLUMN IF NOT EXISTS results_display_unlocked BOOLEAN DEFAULT false;

-- Unlock results for all candidates who already passed ID verification
UPDATE candidates SET results_display_unlocked = true WHERE id_verification_status = 'passed';
