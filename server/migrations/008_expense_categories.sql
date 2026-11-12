CREATE TABLE expense_categories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, name)
);

CREATE INDEX expense_categories_by_organization
  ON expense_categories(organization_id, is_active, sort_order, name);

INSERT INTO expense_categories(
  id, organization_id, name, is_active, sort_order, created_at, updated_at
)
SELECT
  'cat_' || lower(hex(randomblob(16))),
  organizations.id,
  defaults.name,
  1,
  defaults.sort_order,
  organizations.created_at,
  organizations.created_at
FROM organizations
CROSS JOIN (
  SELECT 'Топливо' AS name, 10 AS sort_order
  UNION ALL SELECT 'Запчасти', 20
  UNION ALL SELECT 'Ремонт', 30
  UNION ALL SELECT 'Техническое обслуживание', 40
  UNION ALL SELECT 'Гостиница', 50
  UNION ALL SELECT 'Стоянка', 60
  UNION ALL SELECT 'Платная дорога', 70
  UNION ALL SELECT 'Мойка', 80
  UNION ALL SELECT 'Шиномонтаж', 90
  UNION ALL SELECT 'Эвакуатор', 100
  UNION ALL SELECT 'Расходные материалы', 110
  UNION ALL SELECT 'Антифриз', 120
  UNION ALL SELECT 'Масло', 130
  UNION ALL SELECT 'Инструменты', 140
  UNION ALL SELECT 'Прочее', 1000
) AS defaults;
