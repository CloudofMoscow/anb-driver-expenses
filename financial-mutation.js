const memoryFallback = new Map();

export async function submitIdempotentMutation({
  storage,
  storageKey,
  key,
  draft,
  createId,
  prepareBody,
  send,
  now = () => new Date()
}) {
  const fingerprint = stableJson(draft);
  const pending = readPending(storage, storageKey, now());
  let entry = pending[key];
  if (entry && entry.fingerprint !== fingerprint && entry.body) {
    try {
      await send(entry.body);
      clearPending(storage, storageKey, key, entry.id, now());
      const reconciled = new Error(
        "Предыдущая операция была подтверждена с прежними данными. Проверьте журнал и затем сохраните новую операцию."
      );
      reconciled.code = "PREVIOUS_MUTATION_RECONCILED";
      throw reconciled;
    } catch (error) {
      if (error?.code === "PREVIOUS_MUTATION_RECONCILED") throw error;
      if (isDeterministicRejection(error)) clearPending(storage, storageKey, key, entry.id, now());
      throw error;
    }
  }
  if (!entry || entry.fingerprint !== fingerprint) {
    entry = {
      id: createId(),
      fingerprint,
      body: null,
      createdAt: now().toISOString()
    };
    pending[key] = entry;
    writePending(storage, storageKey, pending);
  }

  try {
    if (!entry.body) {
      entry.body = await prepareBody(entry.id);
      pending[key] = entry;
      writePending(storage, storageKey, pending);
    }
    const result = await send(entry.body);
    clearPending(storage, storageKey, key, entry.id, now());
    return result;
  } catch (error) {
    // Только детерминированный 4xx означает, что команду можно исправлять с
    // новым ID. При обрыве, timeout/rate-limit или 5xx сервер мог уже записать
    // событие, поэтому повтор обязан сохранить прежние ID и тело.
    if (isDeterministicRejection(error)) clearPending(storage, storageKey, key, entry.id, now());
    throw error;
  }
}

function isDeterministicRejection(error) {
  const status = Number(error?.status || 0);
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readPending(storage, storageKey, currentDate) {
  let parsed = memoryFallback.get(storageKey) || {};
  try {
    const stored = storage?.getItem(storageKey);
    if (stored) parsed = JSON.parse(stored);
  } catch {
    // Safari private mode can deny storage; memory fallback still protects this tab.
  }
  const cutoff = currentDate.getTime() - 7 * 86400000;
  return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
    const created = new Date(value?.createdAt || 0).getTime();
    return value?.id && value?.fingerprint && Number.isFinite(created) && created >= cutoff;
  }));
}

function writePending(storage, storageKey, value) {
  memoryFallback.set(storageKey, value);
  try {
    storage?.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Защита текущей вкладки остаётся в memoryFallback.
  }
}

function clearPending(storage, storageKey, key, id, currentDate) {
  const pending = readPending(storage, storageKey, currentDate);
  if (pending[key]?.id !== id) return;
  delete pending[key];
  writePending(storage, storageKey, pending);
}
