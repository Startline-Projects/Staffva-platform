-- Increase bio character limit from 300 to 400 to match the UI field maximum
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_bio_check;
ALTER TABLE candidates ADD CONSTRAINT candidates_bio_check CHECK (char_length(bio) <= 400);
