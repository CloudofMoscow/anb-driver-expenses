const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body != null && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    body,
    credentials: "same-origin"
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = response.status === 413
      ? "Файл слишком большой. Максимальный размер — 12 МБ. Выберите оригинал меньшего размера."
      : payload?.error || `Ошибка ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.code || "REQUEST_FAILED";
    throw error;
  }
  return payload;
}

export async function uploadAttachment(file, kind) {
  if (!file) throw new Error("Выберите файл");
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Файл слишком большой. Максимальный размер — 12 МБ. Выберите оригинал меньшего размера.");
  }
  return api("/api/files", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-ANB-Kind": kind,
      "X-File-Name": encodeURIComponent(file.name || "file")
    },
    body: file
  });
}

export async function currentUser(expectedRole) {
  try {
    const { user } = await api("/api/me");
    if (expectedRole && user.role !== expectedRole) {
      location.replace(user.role === "office" ? "/office.html" : "/driver.html");
      return null;
    }
    return user;
  } catch (error) {
    if (error.status === 401) location.replace("/login.html");
    throw error;
  }
}

export async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  location.replace("/login.html");
}

export function rublesToKopecks(value) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) throw new Error("Проверьте сумму");
  const [rubles, fraction = ""] = normalized.split(".");
  const kopecks = Number(rubles) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(kopecks)) throw new Error("Сумма слишком большая");
  return kopecks;
}

export function formatRubles(kopecks) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: Number(kopecks) % 100 === 0 ? 0 : 2
  }).format(Number(kopecks || 0) / 100);
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function formatDate(value) {
  if (!value) return "—";
  const source = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? `${value}T12:00:00`
    : value;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function showToast(element, message, isError = false) {
  clearTimeout(showToast.timer);
  element.textContent = message;
  element.classList.toggle("toast-error", isError);
  element.setAttribute("role", isError ? "alert" : "status");
  element.setAttribute("aria-live", isError ? "assertive" : "polite");
  element.dataset.kind = isError ? "error" : "success";
  element.classList.add("visible");
  showToast.timer = setTimeout(() => element.classList.remove("visible"), isError ? 8000 : 4200);
}
