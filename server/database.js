import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./security.js";

const migrations = [
  [1, fileURLToPath(new URL("./migrations/001_initial.sql", import.meta.url))],
  [2, fileURLToPath(new URL("./migrations/002_driver_settlements.sql", import.meta.url))],
  [3, fileURLToPath(new URL("./migrations/003_company_expenses.sql", import.meta.url))],
  [4, fileURLToPath(new URL("./migrations/004_notifications.sql", import.meta.url))],
  [5, fileURLToPath(new URL("./migrations/005_odometer_risk_flags.sql", import.meta.url))],
  [6, fileURLToPath(new URL("./migrations/006_trip_stops.sql", import.meta.url))],
  [7, fileURLToPath(new URL("./migrations/007_expense_occurred_at.sql", import.meta.url))],
  [8, fileURLToPath(new URL("./migrations/008_expense_categories.sql", import.meta.url))],
  [9, fileURLToPath(new URL("./migrations/009_expense_explanations.sql", import.meta.url))],
  [10, fileURLToPath(new URL("./migrations/010_active_trip_trailer.sql", import.meta.url))],
  [11, fileURLToPath(new URL("./migrations/011_global_login_uniqueness.sql", import.meta.url))],
  [12, fileURLToPath(new URL("./migrations/012_financial_idempotency.sql", import.meta.url))],
  [13, fileURLToPath(new URL("./migrations/013_expense_review_events.sql", import.meta.url))],
  [14, fileURLToPath(new URL("./migrations/014_push_notifications.sql", import.meta.url))]
];

const defaultExpenseCategories = [
  "Топливо", "Запчасти", "Ремонт", "Техническое обслуживание",
  "Гостиница", "Стоянка", "Платная дорога", "Мойка",
  "Шиномонтаж", "Эвакуатор", "Расходные материалы", "Антифриз",
  "Масло", "Инструменты", "Прочее"
];

export function openDatabase(databasePath) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  migrate(database);
  return database;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    database.prepare("SELECT version FROM schema_migrations").all().map((row) => Number(row.version))
  );
  for (const [version, migrationPath] of migrations) {
    if (applied.has(version)) continue;
    transaction(database, () => {
      database.exec(readFileSync(migrationPath, "utf8"));
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(version, nowIso());
    });
  }
}

export function bootstrapOrganization(database, {
  organizationName = "ANB Group",
  adminLogin,
  adminPassword,
  adminFullName = "Владелец ANB"
}) {
  const existing = database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'office'").get();
  if (Number(existing.count) > 0) return null;
  if (!adminLogin || !adminPassword) {
    throw new Error("Для первого запуска задайте ANB_BOOTSTRAP_LOGIN и ANB_BOOTSTRAP_PASSWORD");
  }

  const organizationId = entityId("org");
  const userId = entityId("usr");
  const createdAt = nowIso();

  transaction(database, () => {
    database.prepare(`
      INSERT INTO organizations(id, name, vat_rate_basis_points, created_at)
      VALUES (?, ?, 2200, ?)
    `).run(organizationId, organizationName, createdAt);
    database.prepare(`
      INSERT INTO organization_compensation_settings(
        organization_id, default_salary_rate_kopecks_per_km,
        default_daily_rate_kopecks, updated_at
      ) VALUES (?, 1200, 150000, ?)
    `).run(organizationId, createdAt);
    database.prepare(`
      INSERT INTO users(
        id, organization_id, role, login, password_hash, full_name,
        phone, is_active, created_at, updated_at
      ) VALUES (?, ?, 'office', ?, ?, ?, '', 1, ?, ?)
    `).run(
      userId,
      organizationId,
      normalizeLogin(adminLogin),
      hashPassword(adminPassword),
      adminFullName,
      createdAt,
      createdAt
    );
    const insertCategory = database.prepare(`
      INSERT INTO expense_categories(
        id, organization_id, name, is_active, sort_order,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `);
    defaultExpenseCategories.forEach((name, index) => insertCategory.run(
      entityId("cat"), organizationId, name, (index + 1) * 10,
      userId, createdAt, createdAt
    ));
  });

  return { organizationId, userId };
}

export function transaction(database, callback) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function audit(database, {
  organizationId,
  actorUserId,
  entityType,
  entityId: targetId,
  action,
  before = null,
  after = null,
  reason = ""
}) {
  database.prepare(`
    INSERT INTO audit_events(
      id, organization_id, actor_user_id, entity_type, entity_id,
      action, before_json, after_json, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entityId("aud"),
    organizationId,
    actorUserId || null,
    entityType,
    targetId,
    action,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
    reason,
    nowIso()
  );
}

export function entityId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeLogin(value) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU");
}

export function toKopecks(value) {
  if (Number.isInteger(value)) return value;
  throw new Error("Сумма должна передаваться целым числом копеек");
}
