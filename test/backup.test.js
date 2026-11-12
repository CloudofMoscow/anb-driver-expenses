import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createBackup } from "../server/backup.js";
import { bootstrapOrganization, openDatabase } from "../server/database.js";

test("backup creates a consistent SQLite copy together with private uploads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "anb-backup-test-"));
  try {
    const databasePath = join(directory, "data", "anb.sqlite");
    const backupsDirectory = join(directory, "backups");
    const database = openDatabase(databasePath);
    const bootstrap = bootstrapOrganization(database, {
      adminLogin: "backup-owner",
      adminPassword: "backup-owner-password",
      adminFullName: "Backup Owner"
    });
    const organizationUploads = join(directory, "data", "uploads", bootstrap.organizationId);
    const originalFile = join(organizationUploads, "receipt.jpg");
    const contents = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    mkdirSync(organizationUploads, { recursive: true });
    writeFileSync(originalFile, contents);
    database.prepare(`
      INSERT INTO attachments(
        id, organization_id, kind, storage_path, original_name, mime_type,
        size_bytes, sha256, created_by, created_at
      ) VALUES ('att-backup', ?, 'expense_receipt', ?, 'receipt.jpg',
        'image/jpeg', 4, ?, ?, '2026-07-21T11:00:00.000Z')
    `).run(
      bootstrap.organizationId,
      originalFile,
      createHash("sha256").update(contents).digest("hex"),
      bootstrap.userId
    );

    const result = await createBackup({
      databasePath,
      uploadsDirectory: join(directory, "data", "uploads"),
      backupsDirectory,
      now: new Date("2026-07-21T12:00:00.000Z")
    });
    database.close();

    assert.equal(existsSync(join(result.targetDirectory, "anb.sqlite")), true);
    assert.equal(existsSync(join(result.targetDirectory, "uploads", bootstrap.organizationId, "receipt.jpg")), true);
    const manifest = JSON.parse(readFileSync(join(result.targetDirectory, "backup.json"), "utf8"));
    assert.equal(manifest.createdAt, "2026-07-21T12:00:00.000Z");
    assert.equal(manifest.attachmentsVerified, 1);

    const restored = new DatabaseSync(join(result.targetDirectory, "anb.sqlite"), { readOnly: true });
    assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
    assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const restoredPath = restored.prepare("SELECT storage_path FROM attachments WHERE id = 'att-backup'").get().storage_path;
    assert.equal(restoredPath, `${bootstrap.organizationId}/receipt.jpg`);
    assert.equal(existsSync(join(result.targetDirectory, "uploads", ...restoredPath.split("/"))), true);
    restored.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup refuses to report success when a referenced upload is missing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "anb-backup-missing-test-"));
  let database;
  try {
    const databasePath = join(directory, "data", "anb.sqlite");
    database = openDatabase(databasePath);
    const bootstrap = bootstrapOrganization(database, {
      adminLogin: "missing-owner",
      adminPassword: "missing-owner-password",
      adminFullName: "Missing Owner"
    });
    database.prepare(`
      INSERT INTO attachments(
        id, organization_id, kind, storage_path, original_name, mime_type,
        size_bytes, sha256, created_by, created_at
      ) VALUES ('att-missing', ?, 'expense_receipt', ?, 'missing.jpg',
        'image/jpeg', 4, ?, ?, '2026-07-21T11:00:00.000Z')
    `).run(
      bootstrap.organizationId,
      `${bootstrap.organizationId}/missing.jpg`,
      createHash("sha256").update(Buffer.from([0xff, 0xd8, 0xff, 0xd9])).digest("hex"),
      bootstrap.userId
    );

    await assert.rejects(
      createBackup({
        databasePath,
        uploadsDirectory: join(directory, "data", "uploads"),
        backupsDirectory: join(directory, "backups"),
        now: new Date("2026-07-21T12:00:00.000Z")
      }),
      /отсутствует вложение/
    );
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup detects same-size attachment corruption by SHA-256", async () => {
  const directory = mkdtempSync(join(tmpdir(), "anb-backup-hash-test-"));
  let database;
  try {
    const databasePath = join(directory, "data", "anb.sqlite");
    database = openDatabase(databasePath);
    const bootstrap = bootstrapOrganization(database, {
      adminLogin: "hash-owner",
      adminPassword: "hash-owner-password",
      adminFullName: "Hash Owner"
    });
    const organizationUploads = join(directory, "data", "uploads", bootstrap.organizationId);
    const originalFile = join(organizationUploads, "receipt.jpg");
    mkdirSync(organizationUploads, { recursive: true });
    writeFileSync(originalFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    database.prepare(`
      INSERT INTO attachments(
        id, organization_id, kind, storage_path, original_name, mime_type,
        size_bytes, sha256, created_by, created_at
      ) VALUES ('att-corrupt', ?, 'expense_receipt', ?, 'receipt.jpg',
        'image/jpeg', 4, ?, ?, '2026-07-21T11:00:00.000Z')
    `).run(
      bootstrap.organizationId,
      `${bootstrap.organizationId}/receipt.jpg`,
      createHash("sha256").update(Buffer.from([0xff, 0xd8, 0xff, 0xd9])).digest("hex"),
      bootstrap.userId
    );
    writeFileSync(originalFile, Buffer.from([0xff, 0xd8, 0x00, 0xd9]));

    await assert.rejects(
      createBackup({
        databasePath,
        uploadsDirectory: join(directory, "data", "uploads"),
        backupsDirectory: join(directory, "backups"),
        now: new Date("2026-07-21T12:00:00.000Z")
      }),
      /Контрольная сумма/
    );
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
