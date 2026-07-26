import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(serverDirectory, "..");

export async function createBackup({
  databasePath,
  uploadsDirectory,
  backupsDirectory,
  now = new Date()
}) {
  const sourceDatabase = resolve(databasePath);
  if (!existsSync(sourceDatabase)) throw new Error(`База не найдена: ${sourceDatabase}`);

  const backupRoot = resolve(backupsDirectory);
  mkdirSync(backupRoot, { recursive: true });
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const targetDirectory = resolve(backupRoot, timestamp);
  mkdirSync(targetDirectory);

  try {
    const targetDatabase = resolve(targetDirectory, "anb.sqlite");
    const database = new DatabaseSync(sourceDatabase, { readOnly: true });
    try {
      await sqliteBackup(database, targetDatabase);
    } finally {
      database.close();
    }

    const sourceUploads = resolve(uploadsDirectory);
    const targetUploads = resolve(targetDirectory, "uploads");
    if (existsSync(sourceUploads)) {
      cpSync(sourceUploads, targetUploads, { recursive: true, errorOnExist: true });
    }

    // Новые записи уже используют пути относительно uploads. Старые базы могли
    // хранить абсолютные пути; в копии переводим их в переносимый формат. Затем
    // проверяем, что каждый файл из БД действительно попал в резервную копию.
    let attachmentCount = 0;
    const copiedDatabase = new DatabaseSync(targetDatabase);
    try {
      const updatePath = copiedDatabase.prepare("UPDATE attachments SET storage_path = ? WHERE id = ?");
      const attachments = copiedDatabase.prepare(`
        SELECT id, storage_path, size_bytes, sha256 FROM attachments ORDER BY id
      `).all();
      attachmentCount = attachments.length;
      for (const attachment of attachments) {
        let storedPath = String(attachment.storage_path || "");
        if (isAbsolute(storedPath)) {
          const relativePath = relative(sourceUploads, resolve(storedPath));
          if (!isSafeRelativePath(relativePath)) {
            throw new Error(`Вложение ${attachment.id} находится вне каталога загрузок`);
          }
          storedPath = relativePath.split(sep).join("/");
          updatePath.run(storedPath, attachment.id);
        }

        const backupFile = resolvePortableAttachment(targetUploads, storedPath, attachment.id);
        if (!existsSync(backupFile) || !statSync(backupFile).isFile()) {
          throw new Error(`В резервной копии отсутствует вложение ${attachment.id}`);
        }
        if (statSync(backupFile).size !== Number(attachment.size_bytes)) {
          throw new Error(`Размер вложения ${attachment.id} не совпадает с записью в базе`);
        }
        const copiedSha256 = createHash("sha256").update(readFileSync(backupFile)).digest("hex");
        if (copiedSha256 !== attachment.sha256) {
          throw new Error(`Контрольная сумма вложения ${attachment.id} не совпадает с записью в базе`);
        }
      }
    } finally {
      copiedDatabase.close();
    }

    const manifest = {
      formatVersion: 2,
      createdAt: now.toISOString(),
      database: "anb.sqlite",
      uploads: attachmentCount > 0 ? "uploads" : null,
      attachmentPaths: "relative_to_uploads",
      attachmentsVerified: attachmentCount
    };
    writeFileSync(resolve(targetDirectory, "backup.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    return { targetDirectory, manifest };
  } catch (error) {
    rmSync(targetDirectory, { recursive: true, force: true });
    throw error;
  }
}

function isSafeRelativePath(value) {
  return Boolean(value)
    && value !== ".."
    && !value.startsWith(`..${sep}`)
    && !isAbsolute(value);
}

function resolvePortableAttachment(uploadsDirectory, storedPath, attachmentId) {
  if (!storedPath || isAbsolute(storedPath)) {
    throw new Error(`Вложение ${attachmentId} не имеет переносимого пути`);
  }
  const root = resolve(uploadsDirectory);
  const target = resolve(root, ...storedPath.split(/[\\/]+/));
  if (target === root || !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Некорректный путь вложения ${attachmentId}`);
  }
  return target;
}

async function main() {
  const localApplicationData = process.env.LOCALAPPDATA
    ? resolve(process.env.LOCALAPPDATA, "ANB Fleet Finance")
    : projectDirectory;
  const dataDirectory = resolve(process.env.ANB_DATA_DIR || resolve(localApplicationData, "data"));
  const result = await createBackup({
    databasePath: process.env.ANB_DATABASE_PATH || resolve(dataDirectory, "anb.sqlite"),
    uploadsDirectory: process.env.ANB_UPLOADS_DIR || resolve(dataDirectory, "uploads"),
    backupsDirectory: process.env.ANB_BACKUPS_DIR || resolve(localApplicationData, "backups")
  });
  console.log(`Резервная копия создана: ${result.targetDirectory}`);
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
