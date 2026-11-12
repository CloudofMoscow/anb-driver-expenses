CREATE TABLE expense_review_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  expense_id TEXT NOT NULL REFERENCES expenses(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  review_status TEXT NOT NULL CHECK (
    review_status IN ('confirmed', 'rejected', 'needs_explanation', 'suspicious')
  ),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX expense_review_events_by_expense
  ON expense_review_events(expense_id, created_at);

-- Existing versions already wrote every office decision to audit_events. Rebuild
-- the append-only timeline from that durable source so repeated review cycles are
-- not collapsed to the latest expenses.review_comment value.
INSERT OR IGNORE INTO expense_review_events(
  id, organization_id, expense_id, reviewer_id,
  review_status, comment, created_at
)
SELECT
  'erv_backfill_' || a.id,
  a.organization_id,
  a.entity_id,
  a.actor_user_id,
  json_extract(a.after_json, '$.status'),
  COALESCE(a.reason, ''),
  a.created_at
FROM audit_events a
JOIN expenses e
  ON e.id = a.entity_id AND e.organization_id = a.organization_id
WHERE a.entity_type = 'expense'
  AND a.action = 'reviewed'
  AND a.actor_user_id IS NOT NULL
  AND json_valid(a.after_json)
  AND json_extract(a.after_json, '$.status') IN (
    'confirmed', 'rejected', 'needs_explanation', 'suspicious'
  );

-- Defensive fallback for imported/legacy rows that have review columns but no
-- matching audit record. A pending row with a submitted explanation necessarily
-- came from a needs_explanation office decision.
INSERT OR IGNORE INTO expense_review_events(
  id, organization_id, expense_id, reviewer_id,
  review_status, comment, created_at
)
SELECT
  'erv_legacy_' || e.id,
  e.organization_id,
  e.id,
  e.reviewed_by,
  CASE
    WHEN e.status = 'pending_review' THEN 'needs_explanation'
    ELSE e.status
  END,
  COALESCE(e.review_comment, ''),
  e.reviewed_at
FROM expenses e
WHERE e.reviewed_by IS NOT NULL
  AND e.reviewed_at IS NOT NULL
  AND (
    e.status IN ('confirmed', 'rejected', 'needs_explanation', 'suspicious')
    OR (
      e.status = 'pending_review'
      AND EXISTS (
        SELECT 1 FROM expense_explanations ee
        WHERE ee.expense_id = e.id AND ee.created_at >= e.reviewed_at
      )
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM expense_review_events re WHERE re.expense_id = e.id
  );

CREATE TRIGGER expense_review_events_no_update
BEFORE UPDATE ON expense_review_events
BEGIN
  SELECT RAISE(ABORT, 'expense review events are immutable');
END;

CREATE TRIGGER expense_review_events_no_delete
BEFORE DELETE ON expense_review_events
BEGIN
  SELECT RAISE(ABORT, 'expense review events are immutable');
END;
