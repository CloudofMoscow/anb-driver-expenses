import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../server/database.js";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("version 1 database upgrades without data loss and backfills confirmed trip accruals", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "anb-migration-test-"));
  const databasePath = join(temporaryDirectory, "legacy.sqlite");
  let database;
  try {
    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    database.exec(readFileSync(join(projectDirectory, "server", "migrations", "001_initial.sql"), "utf8"));
    database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)").run("2026-01-01T00:00:00.000Z");

    const timestamp = "2026-01-01T00:00:00.000Z";
    database.prepare("INSERT INTO organizations(id, name, vat_rate_basis_points, created_at) VALUES (?, ?, 2200, ?)")
      .run("org-legacy", "Legacy ANB", timestamp);
    const insertUser = database.prepare(`
      INSERT INTO users(
        id, organization_id, role, login, password_hash, full_name,
        phone, is_active, created_at, updated_at
      ) VALUES (?, 'org-legacy', ?, ?, 'legacy-hash', ?, '', 1, ?, ?)
    `);
    insertUser.run("usr-office", "office", "owner", "Владелец", timestamp, timestamp);
    insertUser.run("usr-driver", "driver", "driver", "Водитель", timestamp, timestamp);
    database.prepare(`
      INSERT INTO tractors(id, organization_id, brand, model, plate_number, created_at, updated_at)
      VALUES ('trc-legacy', 'org-legacy', 'КамАЗ', 'К5', 'А001АА77', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO trailers(id, organization_id, brand, model, plate_number, created_at, updated_at)
      VALUES ('trl-legacy', 'org-legacy', 'Трал', '4 оси', 'В001ВВ77', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO rigs(id, organization_id, name, created_at, updated_at)
      VALUES ('rig-legacy', 'org-legacy', 'Сцепка', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO rig_periods(
        id, organization_id, rig_id, tractor_id, trailer_id, driver_id,
        valid_from, created_by, created_at
      ) VALUES ('rpe-legacy', 'org-legacy', 'rig-legacy', 'trc-legacy', 'trl-legacy',
        'usr-driver', ?, 'usr-office', ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO customers(
        id, organization_id, short_name, created_at, updated_at
      ) VALUES ('cus-legacy', 'org-legacy', 'Заказчик', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO trips(
        id, organization_id, number, customer_id, rig_id, rig_period_id,
        driver_id, tractor_id, trailer_id, loading_address, planned_loading_date,
        unloading_address, cargo_description, driver_instructions,
        agreed_rate_kopecks, vat_mode, vat_rate_basis_points,
        payment_method, payment_term_days, status, assigned_at, loaded_at,
        unloaded_at, confirmed_at, created_by, confirmed_by, created_at, updated_at
      ) VALUES (
        'trp-legacy', 'org-legacy', 'OLD-1', 'cus-legacy', 'rig-legacy', 'rpe-legacy',
        'usr-driver', 'trc-legacy', 'trl-legacy', 'Москва', '2026-01-01',
        'Казань', '', '', 10000000, 'with_vat', 2200,
        'bank', 14, 'confirmed', ?, ?, ?, ?, 'usr-office', 'usr-office', ?, ?
      )
    `).run(
      timestamp,
      "2026-01-01T06:00:00.000Z",
      "2026-01-03T15:00:00.000Z",
      "2026-01-03T16:00:00.000Z",
      timestamp,
      "2026-01-03T16:00:00.000Z"
    );
    const insertAttachment = database.prepare(`
      INSERT INTO attachments(
        id, organization_id, kind, storage_path, original_name, mime_type,
        size_bytes, sha256, created_by, created_at
      ) VALUES (?, 'org-legacy', ?, ?, ?, 'image/jpeg', 4, ?, 'usr-driver', ?)
    `);
    insertAttachment.run("att-start", "odometer_start", "legacy/start.jpg", "start.jpg", "sha-start", timestamp);
    insertAttachment.run("att-end", "odometer_end", "legacy/end.jpg", "end.jpg", "sha-end", timestamp);
    insertAttachment.run("att-receipt", "expense_receipt", "legacy/receipt.jpg", "receipt.jpg", "sha-receipt", timestamp);
    const insertOdometer = database.prepare(`
      INSERT INTO odometer_readings(
        id, organization_id, trip_id, tractor_id, driver_id, reading_type,
        entered_value_km, attachment_id, captured_at, created_at
      ) VALUES (?, 'org-legacy', 'trp-legacy', 'trc-legacy', 'usr-driver', ?, ?, ?, ?, ?)
    `);
    insertOdometer.run("odo-start", "start", 100000, "att-start", "2026-01-01T06:00:00.000Z", timestamp);
    insertOdometer.run("odo-end", "end", 100100, "att-end", "2026-01-03T15:00:00.000Z", timestamp);
    database.prepare(`
      INSERT INTO expenses(
        id, organization_id, trip_id, driver_id, rig_id, tractor_id, trailer_id,
        amount_kopecks, category, payment_method, payment_source, supplier,
        description, location_text, receipt_attachment_id, status,
        risk_flags_json, client_mutation_id, created_by, reviewed_by,
        reviewed_at, review_comment, created_at, updated_at
      ) VALUES (
        'exp-legacy', 'org-legacy', 'trp-legacy', 'usr-driver', 'rig-legacy',
        'trc-legacy', 'trl-legacy', 250000, 'Parts', 'card',
        'driver_personal', 'Shop', 'Belts', '', 'att-receipt',
        'confirmed', '[]', 'legacy-expense-1', 'usr-driver', 'usr-office',
        '2026-01-03T15:30:00.000Z', 'Receipt approved', ?, ?
      )
    `).run(timestamp, timestamp);
    const insertLegacyReviewAudit = database.prepare(`
      INSERT INTO audit_events(
        id, organization_id, actor_user_id, entity_type, entity_id,
        action, before_json, after_json, reason, created_at
      ) VALUES (?, 'org-legacy', 'usr-office', 'expense', 'exp-legacy',
        'reviewed', ?, ?, ?, ?)
    `);
    insertLegacyReviewAudit.run(
      "aud-review-request",
      JSON.stringify({ status: "pending_review", review_comment: "" }),
      JSON.stringify({ status: "needs_explanation", review_comment: "Need explanation" }),
      "Need explanation",
      "2026-01-03T15:00:00.000Z"
    );
    insertLegacyReviewAudit.run(
      "aud-review-confirm",
      JSON.stringify({ status: "pending_review", review_comment: "Need explanation" }),
      JSON.stringify({ status: "confirmed", review_comment: "Receipt approved" }),
      "Receipt approved",
      "2026-01-03T15:30:00.000Z"
    );
    database.close();
    database = null;

    const migrated = openDatabase(databasePath);
    database = migrated;
    assert.deepEqual(
      migrated.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    );
    const settings = migrated.prepare("SELECT * FROM organization_compensation_settings WHERE organization_id = 'org-legacy'").get();
    assert.equal(settings.default_salary_rate_kopecks_per_km, 1200);
    assert.equal(settings.default_daily_rate_kopecks, 150000);
    const accruals = migrated.prepare(`
      SELECT accrual_type, balance_effect_kopecks, quantity_units, unit_rate_kopecks
      FROM driver_accruals WHERE trip_id = 'trp-legacy' ORDER BY accrual_type
    `).all().map((row) => ({ ...row }));
    assert.deepEqual(accruals, [
      { accrual_type: "daily", balance_effect_kopecks: 450000, quantity_units: 3, unit_rate_kopecks: 150000 },
      { accrual_type: "salary", balance_effect_kopecks: 120000, quantity_units: 100, unit_rate_kopecks: 1200 }
    ]);
    assert.equal(migrated.prepare("SELECT number FROM trips WHERE id = 'trp-legacy'").get().number, "OLD-1");
    assert.equal(
      migrated.prepare("SELECT COUNT(*) AS count FROM company_expenses").get().count,
      0
    );
    assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM notifications").get().count, 0);
    assert.equal(
      migrated.prepare("SELECT risk_flags_json FROM odometer_readings WHERE id = 'odo-start'").get().risk_flags_json,
      "[]"
    );
    assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM trip_stops").get().count, 0);
    assert.equal(
      migrated.prepare("SELECT occurred_at FROM expenses WHERE id = 'exp-legacy'").get().occurred_at,
      timestamp
    );
    assert.equal(
      migrated.prepare("SELECT COUNT(*) AS count FROM expense_categories WHERE organization_id = 'org-legacy'").get().count,
      15
    );
    assert.deepEqual(
      migrated.prepare(`
        SELECT review_status, comment, created_at
        FROM expense_review_events
        WHERE expense_id = 'exp-legacy'
        ORDER BY created_at
      `).all().map((row) => ({ ...row })),
      [
        {
          review_status: "needs_explanation",
          comment: "Need explanation",
          created_at: "2026-01-03T15:00:00.000Z"
        },
        {
          review_status: "confirmed",
          comment: "Receipt approved",
          created_at: "2026-01-03T15:30:00.000Z"
        }
      ]
    );
    assert.throws(
      () => migrated.prepare("UPDATE expense_review_events SET comment = 'changed' WHERE expense_id = 'exp-legacy'").run(),
      /immutable/
    );
    assert.throws(
      () => migrated.prepare("DELETE FROM expense_review_events WHERE expense_id = 'exp-legacy'").run(),
      /immutable/
    );
  } finally {
    database?.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("version 9 migration preserves startup and quarantines duplicate active trailers", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "anb-migration-trailer-test-"));
  const databasePath = join(temporaryDirectory, "legacy.sqlite");
  let database;
  try {
    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    for (let version = 1; version <= 9; version += 1) {
      const fileName = `${String(version).padStart(3, "0")}_${[
        "initial",
        "driver_settlements",
        "company_expenses",
        "notifications",
        "odometer_risk_flags",
        "trip_stops",
        "expense_occurred_at",
        "expense_categories",
        "expense_explanations"
      ][version - 1]}.sql`;
      database.exec(readFileSync(join(projectDirectory, "server", "migrations", fileName), "utf8"));
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(version, "2026-01-01T00:00:00.000Z");
    }

    const timestamp = "2026-01-01T00:00:00.000Z";
    database.prepare("INSERT INTO organizations(id, name, vat_rate_basis_points, created_at) VALUES ('org-conflict', 'Conflict', 2200, ?)")
      .run(timestamp);
    const insertUser = database.prepare(`
      INSERT INTO users(
        id, organization_id, role, login, password_hash, full_name,
        phone, is_active, created_at, updated_at
      ) VALUES (?, 'org-conflict', ?, ?, 'legacy-hash', ?, '', 1, ?, ?)
    `);
    insertUser.run("usr-office-conflict", "office", "owner-conflict", "Владелец", timestamp, timestamp);
    insertUser.run("usr-driver-a", "driver", "driver-a", "Водитель А", timestamp, timestamp);
    insertUser.run("usr-driver-b", "driver", "driver-b", "Водитель Б", timestamp, timestamp);
    const insertTractor = database.prepare(`
      INSERT INTO tractors(id, organization_id, brand, plate_number, created_at, updated_at)
      VALUES (?, 'org-conflict', 'КамАЗ', ?, ?, ?)
    `);
    insertTractor.run("trc-a", "А001АА77", timestamp, timestamp);
    insertTractor.run("trc-b", "А002АА77", timestamp, timestamp);
    database.prepare(`
      INSERT INTO trailers(id, organization_id, brand, plate_number, created_at, updated_at)
      VALUES ('trl-shared', 'org-conflict', 'Трал', 'В001ВВ77', ?, ?)
    `).run(timestamp, timestamp);
    const insertRig = database.prepare(`
      INSERT INTO rigs(id, organization_id, name, created_at, updated_at)
      VALUES (?, 'org-conflict', ?, ?, ?)
    `);
    insertRig.run("rig-a", "Сцепка А", timestamp, timestamp);
    insertRig.run("rig-b", "Сцепка Б", timestamp, timestamp);
    database.prepare(`
      INSERT INTO rig_periods(
        id, organization_id, rig_id, tractor_id, trailer_id, driver_id,
        valid_from, valid_to, created_by, created_at
      ) VALUES (
        'rpe-a', 'org-conflict', 'rig-a', 'trc-a', 'trl-shared', 'usr-driver-a',
        '2025-12-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'usr-office-conflict', ?
      )
    `).run(timestamp);
    database.prepare(`
      INSERT INTO rig_periods(
        id, organization_id, rig_id, tractor_id, trailer_id, driver_id,
        valid_from, created_by, created_at
      ) VALUES (
        'rpe-b', 'org-conflict', 'rig-b', 'trc-b', 'trl-shared', 'usr-driver-b',
        '2026-01-02T00:00:00.000Z', 'usr-office-conflict', ?
      )
    `).run(timestamp);
    database.prepare(`
      INSERT INTO customers(id, organization_id, short_name, created_at, updated_at)
      VALUES ('cus-conflict', 'org-conflict', 'Заказчик', ?, ?)
    `).run(timestamp, timestamp);
    const insertTrip = database.prepare(`
      INSERT INTO trips(
        id, organization_id, number, customer_id, rig_id, rig_period_id,
        driver_id, tractor_id, trailer_id, loading_address, planned_loading_date,
        unloading_address, agreed_rate_kopecks, vat_mode, payment_method,
        status, assigned_at, loaded_at, created_by, created_at, updated_at
      ) VALUES (
        ?, 'org-conflict', ?, 'cus-conflict', ?, ?, ?, ?, 'trl-shared',
        'Москва', '2026-01-01', 'Казань', 10000000, 'with_vat', 'bank',
        'in_progress', ?, ?, 'usr-office-conflict', ?, ?
      )
    `);
    insertTrip.run(
      "trp-first", "FIRST", "rig-a", "rpe-a", "usr-driver-a", "trc-a",
      "2026-01-01T05:00:00.000Z", "2026-01-01T06:00:00.000Z", timestamp, timestamp
    );
    insertTrip.run(
      "trp-second", "SECOND", "rig-b", "rpe-b", "usr-driver-b", "trc-b",
      "2026-01-02T05:00:00.000Z", "2026-01-02T06:00:00.000Z", timestamp, timestamp
    );
    database.close();
    database = openDatabase(databasePath);

    assert.equal(database.prepare("SELECT status FROM trips WHERE id = 'trp-first'").get().status, "in_progress");
    assert.equal(database.prepare("SELECT status FROM trips WHERE id = 'trp-second'").get().status, "needs_explanation");
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM audit_events
      WHERE entity_id = 'trp-second' AND action = 'migration_active_trailer_conflict'
    `).get().count, 1);
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM notifications
      WHERE entity_id = 'trp-second' AND recipient_user_id = 'usr-driver-b'
    `).get().count, 1);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database?.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
