ALTER TABLE expenses ADD COLUMN occurred_at TEXT;

UPDATE expenses SET occurred_at = created_at WHERE occurred_at IS NULL;

CREATE INDEX expenses_by_occurred_at
  ON expenses(organization_id, occurred_at);
