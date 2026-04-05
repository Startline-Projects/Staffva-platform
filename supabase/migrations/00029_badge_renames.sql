-- Add new enum values to english_written_tier_type
ALTER TYPE english_written_tier_type ADD VALUE IF NOT EXISTS 'advanced';
ALTER TYPE english_written_tier_type ADD VALUE IF NOT EXISTS 'professional';

-- Add new enum value to speaking_level_type
ALTER TYPE speaking_level_type ADD VALUE IF NOT EXISTS 'developing';

-- Migrate existing candidate records to new labels
UPDATE candidates SET english_written_tier = 'advanced' WHERE english_written_tier = 'proficient';
UPDATE candidates SET english_written_tier = 'professional' WHERE english_written_tier = 'competent';
UPDATE candidates SET speaking_level = 'developing' WHERE speaking_level = 'basic';
