CREATE TABLE organization_compensation_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  default_salary_rate_kopecks_per_km INTEGER NOT NULL DEFAULT 1200
    CHECK (default_salary_rate_kopecks_per_km >= 0),
  default_daily_rate_kopecks INTEGER NOT NULL DEFAULT 150000
    CHECK (default_daily_rate_kopecks >= 0),
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

INSERT INTO organization_compensation_settings(
  organization_id, default_salary_rate_kopecks_per_km,
  default_daily_rate_kopecks, updated_at
)
SELECT id, 1200, 150000, created_at
FROM organizations;

CREATE TABLE driver_compensation_settings (
  driver_id TEXT PRIMARY KEY REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  salary_rate_kopecks_per_km INTEGER
    CHECK (salary_rate_kopecks_per_km IS NULL OR salary_rate_kopecks_per_km >= 0),
  daily_rate_kopecks INTEGER
    CHECK (daily_rate_kopecks IS NULL OR daily_rate_kopecks >= 0),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);

ALTER TABLE trips ADD COLUMN salary_rate_override_kopecks_per_km INTEGER
  CHECK (salary_rate_override_kopecks_per_km IS NULL OR salary_rate_override_kopecks_per_km >= 0);
ALTER TABLE trips ADD COLUMN daily_rate_override_kopecks INTEGER
  CHECK (daily_rate_override_kopecks IS NULL OR daily_rate_override_kopecks >= 0);

CREATE TABLE driver_accruals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  trip_id TEXT REFERENCES trips(id),
  accrual_type TEXT NOT NULL
    CHECK (accrual_type IN ('salary', 'daily', 'manual_adjustment')),
  balance_category TEXT NOT NULL
    CHECK (balance_category IN ('salary', 'daily', 'general')),
  balance_effect_kopecks INTEGER NOT NULL CHECK (balance_effect_kopecks != 0),
  quantity_units INTEGER,
  unit_rate_kopecks INTEGER,
  period_from TEXT,
  period_to TEXT,
  comment TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('trip_confirmation', 'manual', 'migration')),
  created_by TEXT REFERENCES users(id),
  reversed_at TEXT,
  reversed_by TEXT REFERENCES users(id),
  reversal_reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (period_to IS NULL OR period_from IS NULL OR period_to >= period_from)
);

CREATE UNIQUE INDEX driver_accruals_one_active_trip_type
  ON driver_accruals(trip_id, accrual_type)
  WHERE trip_id IS NOT NULL
    AND accrual_type IN ('salary', 'daily')
    AND reversed_at IS NULL;
CREATE INDEX driver_accruals_by_driver
  ON driver_accruals(driver_id, created_at);

INSERT INTO driver_accruals(
  id, organization_id, driver_id, trip_id, accrual_type, balance_category,
  balance_effect_kopecks, quantity_units, unit_rate_kopecks,
  period_from, period_to, comment, source_type, created_by, created_at
)
SELECT
  'acc_' || lower(hex(randomblob(16))), t.organization_id, t.driver_id, t.id,
  'salary', 'salary',
  (finish.entered_value_km - start.entered_value_km) * 1200,
  finish.entered_value_km - start.entered_value_km, 1200,
  date(t.loaded_at, '+3 hours'), date(t.unloaded_at, '+3 hours'),
  'Начислено при обновлении системы', 'migration',
  COALESCE(t.confirmed_by, t.created_by), COALESCE(t.confirmed_at, t.updated_at)
FROM trips t
JOIN odometer_readings start ON start.trip_id = t.id AND start.reading_type = 'start'
JOIN odometer_readings finish ON finish.trip_id = t.id AND finish.reading_type = 'end'
WHERE t.status IN ('confirmed', 'closed')
  AND finish.entered_value_km > start.entered_value_km;

INSERT INTO driver_accruals(
  id, organization_id, driver_id, trip_id, accrual_type, balance_category,
  balance_effect_kopecks, quantity_units, unit_rate_kopecks,
  period_from, period_to, comment, source_type, created_by, created_at
)
SELECT
  'acc_' || lower(hex(randomblob(16))), t.organization_id, t.driver_id, t.id,
  'daily', 'daily',
  (CAST(julianday(date(t.unloaded_at, '+3 hours')) - julianday(date(t.loaded_at, '+3 hours')) AS INTEGER) + 1) * 150000,
  CAST(julianday(date(t.unloaded_at, '+3 hours')) - julianday(date(t.loaded_at, '+3 hours')) AS INTEGER) + 1,
  150000,
  date(t.loaded_at, '+3 hours'), date(t.unloaded_at, '+3 hours'),
  'Начислено при обновлении системы', 'migration',
  COALESCE(t.confirmed_by, t.created_by), COALESCE(t.confirmed_at, t.updated_at)
FROM trips t
WHERE t.status IN ('confirmed', 'closed')
  AND t.loaded_at IS NOT NULL
  AND t.unloaded_at IS NOT NULL;

CREATE TABLE driver_transfers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  direction TEXT NOT NULL
    CHECK (direction IN ('company_to_driver', 'driver_to_company')),
  amount_kopecks INTEGER NOT NULL CHECK (amount_kopecks > 0),
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('bank', 'cash', 'card_transfer')),
  occurred_at TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  attachment_id TEXT REFERENCES attachments(id),
  client_mutation_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  reversed_at TEXT,
  reversed_by TEXT REFERENCES users(id),
  reversal_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, client_mutation_id)
);

CREATE INDEX driver_transfers_by_driver
  ON driver_transfers(driver_id, occurred_at);

CREATE TABLE driver_transfer_allocations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  transfer_id TEXT NOT NULL REFERENCES driver_transfers(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  trip_id TEXT REFERENCES trips(id),
  allocation_type TEXT NOT NULL
    CHECK (allocation_type IN ('salary', 'daily', 'expense_advance', 'expense_reimbursement')),
  amount_kopecks INTEGER NOT NULL CHECK (amount_kopecks > 0),
  coverage_through TEXT,
  comment TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK (allocation_type = 'daily' OR coverage_through IS NULL)
);

CREATE INDEX driver_transfer_allocations_by_driver
  ON driver_transfer_allocations(driver_id, allocation_type, created_at);
