ALTER TABLE odometer_readings
  ADD COLUMN risk_flags_json TEXT NOT NULL DEFAULT '[]';
