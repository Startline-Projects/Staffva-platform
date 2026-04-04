-- Rename monthly_rate to hourly_rate
ALTER TABLE candidates RENAME COLUMN monthly_rate TO hourly_rate;

-- Change type to numeric(10,2)
ALTER TABLE candidates ALTER COLUMN hourly_rate TYPE numeric(10,2);

-- Convert existing monthly values to hourly (divide by 160)
UPDATE candidates SET hourly_rate = ROUND(hourly_rate / 160, 2) WHERE hourly_rate > 500;

-- Add check constraint
ALTER TABLE candidates ADD CONSTRAINT hourly_rate_range CHECK (hourly_rate > 0 AND hourly_rate <= 500);
