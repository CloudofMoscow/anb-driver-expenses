import { api, uploadAttachment } from "./api-client.js";

const DATABASE_NAME = "anb-driver-outbox-v1";
const DATABASE_VERSION = 1;
const OPERATION_STORE = "operations";
const activeFlushes = new Map();
let databasePromise;

export async function enqueueDriverOperation({
  ownerUserId,
  type,
  tripId,
  payload,
  file,
  attachmentKind
}) {
  if (!ownerUserId) throw new Error("Не удалось определить водителя");
  if (!['start_trip', 'expense', 'complete_trip'].includes(type)) {
    throw new Error("Неизвестный тип офлайн-операции");
  }
  if (!tripId || !payload?.clientMutationId) {
    throw new Error("Не удалось подготовить операцию к отправке");
  }
  if (!(file instanceof Blob)) throw new Error("Выберите подтверждающий файл");

  const record = {
    ownerUserId,
    type,
    tripId,
    clientMutationId: payload.clientMutationId,
    payload,
    file,
    fileName: file.name || `${attachmentKind || type}.bin`,
    fileType: file.type || "application/octet-stream",
    attachmentKind,
    attachmentId: null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null
  };

  const database = await openDatabase();
  const queueId = await addRecord(database, record);
  return { ...record, queueId };
}

export async function listDriverOperations(ownerUserId) {
  if (!ownerUserId) return [];
  const database = await openDatabase();
  const records = await getAllByOwner(database, ownerUserId);
  return records.sort((left, right) => left.queueId - right.queueId);
}

export async function countDriverOperations(ownerUserId) {
  return (await listDriverOperations(ownerUserId)).length;
}

export async function clearDriverOperations(ownerUserId) {
  if (!ownerUserId) return;
  const database = await openDatabase();
  const records = await getAllByOwner(database, ownerUserId);
  await Promise.all(records.map((record) => deleteRecord(database, record.queueId)));
}

export async function discardDriverOperation(ownerUserId, queueId) {
  if (!ownerUserId || !Number.isInteger(Number(queueId))) return null;
  const database = await openDatabase();
  const records = await getAllByOwner(database, ownerUserId);
  const record = records.find((item) => Number(item.queueId) === Number(queueId));
  if (!record) return null;
  await deleteRecord(database, record.queueId);
  return record;
}

export function flushDriverOperations(ownerUserId, onProgress = () => {}) {
  if (!ownerUserId) return Promise.resolve({ sent: 0, pending: 0, error: null });
  const existing = activeFlushes.get(ownerUserId);
  if (existing) return existing;

  const flush = runFlush(ownerUserId, onProgress).finally(() => {
    activeFlushes.delete(ownerUserId);
  });
  activeFlushes.set(ownerUserId, flush);
  return flush;
}

async function runFlush(ownerUserId, onProgress) {
  const database = await openDatabase();
  const records = await listDriverOperations(ownerUserId);
  let sent = 0;

  for (const initialRecord of records) {
    let record = initialRecord;
    try {
      if (!record.attachmentId) {
        const uploaded = await uploadAttachment(uploadableFile(record), record.attachmentKind);
        record = {
          ...record,
          attachmentId: uploaded.attachmentId,
          attempts: Number(record.attempts || 0),
          lastError: null,
          lastErrorStatus: null,
          lastErrorCode: null
        };
        await putRecord(database, record);
        onProgress({ phase: "attachment_uploaded", record, sent, pending: records.length - sent });
      }

      await deliverOperation(record);
      await deleteRecord(database, record.queueId);
      sent += 1;
      onProgress({ phase: "operation_sent", record, sent, pending: records.length - sent });
    } catch (error) {
      record = {
        ...record,
        attempts: Number(record.attempts || 0) + 1,
        lastError: String(error?.message || "Не удалось отправить"),
        lastErrorStatus: Number(error?.status || 0) || null,
        lastErrorCode: String(error?.code || "") || null,
        lastAttemptAt: new Date().toISOString()
      };
      await putRecord(database, record);
      onProgress({ phase: "operation_failed", record, sent, pending: records.length - sent, error });
      return { sent, pending: records.length - sent, error };
    }
  }

  return { sent, pending: 0, error: null };
}

async function deliverOperation(record) {
  if (record.type === "start_trip") {
    return api(`/api/driver/trips/${encodeURIComponent(record.tripId)}/start`, {
      method: "POST",
      body: { ...record.payload, attachmentId: record.attachmentId }
    });
  }
  if (record.type === "expense") {
    return api(`/api/driver/trips/${encodeURIComponent(record.tripId)}/expenses`, {
      method: "POST",
      body: { ...record.payload, receiptAttachmentId: record.attachmentId }
    });
  }
  return api(`/api/driver/trips/${encodeURIComponent(record.tripId)}/complete`, {
    method: "POST",
    body: { ...record.payload, attachmentId: record.attachmentId }
  });
}

function uploadableFile(record) {
  if (typeof File === "function" && !(record.file instanceof File)) {
    return new File([record.file], record.fileName, { type: record.fileType });
  }
  return record.file;
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("На этом устройстве недоступно надёжное офлайн-хранилище"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error || new Error("Не удалось открыть офлайн-хранилище"));
    request.onblocked = () => reject(new Error("Закройте другие вкладки приложения и повторите"));
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(OPERATION_STORE, {
        keyPath: "queueId",
        autoIncrement: true
      });
      store.createIndex("ownerUserId", "ownerUserId", { unique: false });
      store.createIndex("ownerMutation", ["ownerUserId", "clientMutationId"], { unique: true });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
  });
  databasePromise.catch(() => { databasePromise = null; });
  return databasePromise;
}

function addRecord(database, record) {
  return requestInTransaction(database, "readwrite", (store) => store.add(record));
}

function putRecord(database, record) {
  return requestInTransaction(database, "readwrite", (store) => store.put(record));
}

function deleteRecord(database, queueId) {
  return requestInTransaction(database, "readwrite", (store) => store.delete(queueId));
}

function getAllByOwner(database, ownerUserId) {
  return requestInTransaction(database, "readonly", (store) => store.index("ownerUserId").getAll(ownerUserId));
}

function requestInTransaction(database, mode, makeRequest) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OPERATION_STORE, mode);
    const store = transaction.objectStore(OPERATION_STORE);
    let result;
    let request;
    try {
      request = makeRequest(store);
    } catch (error) {
      reject(error);
      return;
    }
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error("Ошибка офлайн-хранилища"));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error("Ошибка офлайн-хранилища"));
    transaction.onabort = () => reject(transaction.error || new Error("Операция офлайн-хранилища отменена"));
  });
}
