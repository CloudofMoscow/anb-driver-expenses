CREATE TABLE company_expenses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('company', 'rig')),
  rig_id TEXT REFERENCES rigs(id),
  amount_kopecks INTEGER NOT NULL CHECK (amount_kopecks > 0),
  category TEXT NOT NULL,
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('bank', 'cash', 'card_transfer', 'company_card')),
  occurred_at TEXT NOT NULL,
  description TEXT NOT NULL,
  attachment_id TEXT REFERENCES attachments(id),
  client_mutation_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  reversed_at TEXT,
  reversed_by TEXT REFERENCES users(id),
  reversal_reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (scope_type = 'company' AND rig_id IS NULL)
    OR (scope_type = 'rig' AND rig_id IS NOT NULL)
  ),
  UNIQUE (organization_id, client_mutation_id)
);

CREATE INDEX company_expenses_by_period
  ON company_expenses(organization_id, occurred_at);
CREATE INDEX company_expenses_by_rig_period
  ON company_expenses(rig_id, occurred_at)
  WHERE rig_id IS NOT NULL;
