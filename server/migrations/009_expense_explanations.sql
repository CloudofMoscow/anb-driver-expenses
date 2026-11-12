CREATE TABLE expense_explanations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  expense_id TEXT NOT NULL REFERENCES expenses(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX expense_explanations_by_expense
  ON expense_explanations(expense_id, created_at);
