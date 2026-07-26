const DB_NAME = "driver-expenses-db";
const DB_VERSION = 1;
const STORE = "expenses";
const SETTINGS_KEY = "driver-expenses-settings";
const encoder = new TextEncoder();

const els = {
  form: document.querySelector("#expenseForm"),
  date: document.querySelector("#date"),
  amount: document.querySelector("#amount"),
  driver: document.querySelector("#driver"),
  vehicle: document.querySelector("#vehicle"),
  vehicleStatus: document.querySelector("#vehicleStatus"),
  route: document.querySelector("#route"),
  category: document.querySelector("#category"),
  payment: document.querySelector("#payment"),
  supplier: document.querySelector("#supplier"),
  receipt: document.querySelector("#receipt"),
  receiptLabel: document.querySelector("#receiptLabel"),
  receiptPreview: document.querySelector("#receiptPreview"),
  receiptPreviewImage: document.querySelector("#receiptPreviewImage"),
  receiptPreviewTitle: document.querySelector("#receiptPreviewTitle"),
  receiptPreviewMeta: document.querySelector("#receiptPreviewMeta"),
  receiptPreviewOpen: document.querySelector("#receiptPreviewOpen"),
  note: document.querySelector("#note"),
  tabs: document.querySelectorAll(".tab-button"),
  panels: document.querySelectorAll(".tab-panel"),
  todayTotal: document.querySelector("#todayTotal"),
  monthTotal: document.querySelector("#monthTotal"),
  entryCount: document.querySelector("#entryCount"),
  list: document.querySelector("#expenseList"),
  emptyState: document.querySelector("#emptyState"),
  search: document.querySelector("#search"),
  clearSearch: document.querySelector("#clearSearch"),
  exportExcel: document.querySelector("#exportExcel"),
  exportArchive: document.querySelector("#exportArchive"),
  reportForm: document.querySelector("#reportForm"),
  reportPeriod: document.querySelector("#reportPeriod"),
  reportCustomRange: document.querySelector("#reportCustomRange"),
  reportFrom: document.querySelector("#reportFrom"),
  reportTo: document.querySelector("#reportTo"),
  reportSummary: document.querySelector("#reportSummary"),
  shareReport: document.querySelector("#shareReport"),
  downloadReport: document.querySelector("#downloadReport"),
  platformLabel: document.querySelector("#platformLabel"),
  shareModeLabel: document.querySelector("#shareModeLabel"),
  profileForm: document.querySelector("#profileForm"),
  profileDriver: document.querySelector("#profileDriver"),
  profileVehicle: document.querySelector("#profileVehicle"),
  driverSummary: document.querySelector("#driverSummary"),
  openProfile: document.querySelector("#openProfile"),
  currentTripTitle: document.querySelector("#currentTripTitle"),
  currentTripMeta: document.querySelector("#currentTripMeta"),
  startTrip: document.querySelector("#startTrip"),
  endTrip: document.querySelector("#endTrip"),
  tripDialog: document.querySelector("#tripDialog"),
  tripForm: document.querySelector("#tripForm"),
  closeTripDialog: document.querySelector("#closeTripDialog"),
  tripNumber: document.querySelector("#tripNumber"),
  tripFrom: document.querySelector("#tripFrom"),
  tripTo: document.querySelector("#tripTo"),
  tripStartStatus: document.querySelector("#tripStartStatus"),
  placeSuggestions: document.querySelector("#placeSuggestions"),
  recentPlaces: document.querySelector("#recentPlaces"),
  correctionBanner: document.querySelector("#correctionBanner"),
  correctionSourceLabel: document.querySelector("#correctionSourceLabel"),
  correctionReason: document.querySelector("#correctionReason"),
  cancelCorrection: document.querySelector("#cancelCorrection"),
  saveExpenseButton: document.querySelector("#saveExpenseButton"),
  toast: document.querySelector("#toast"),
  storageStatus: document.querySelector("#storageStatus")
};

let db;
let expenses = [];
let toastTimer;
let selectedReceipt = null;
let selectedReceiptPreviewUrl = "";
let receiptProcessing = false;
let correctionSource = null;

const IMAGE_MAX_SIDE = 1900;
const IMAGE_QUALITY = 0.86;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllExpenses() {
  const rows = await requestToPromise(transaction().getAll());
  return rows.sort((a, b) => `${b.date}T${b.createdAt}`.localeCompare(`${a.date}T${a.createdAt}`));
}

async function saveExpense(expense) {
  await requestToPromise(transaction("readwrite").put(expense));
}

function formatRub(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`));
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} МБ`;
}

function detectPlatform() {
  const ua = navigator.userAgent || "";
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  const isIpadOs = /Mac/.test(platform) && navigator.maxTouchPoints > 1;

  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPod/i.test(ua)) return "iPhone / iOS";
  if (/iPad/i.test(ua) || isIpadOs) return "iPad / iPadOS";
  if (/Windows/i.test(platform) || /Windows/i.test(ua)) return "Windows";
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return "Mac";
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return "Linux";
  return "Устройство";
}

function updatePlatformInfo() {
  if (els.platformLabel) els.platformLabel.textContent = detectPlatform();
  if (els.shareModeLabel) {
    const canShareZip = typeof File === "function"
      && navigator.share
      && (!navigator.canShare || navigator.canShare({
        files: [new File([""], "report.zip", { type: "application/zip" })]
      }));
    els.shareModeLabel.textContent = canShareZip
      ? "Через меню отправки"
      : "Скачивание ZIP";
  }
}

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function createClientId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function monthKey(value) {
  return value.slice(0, 7);
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  toastTimer = setTimeout(() => els.toast.classList.remove("visible"), 2600);
}

function safeFileName(value, fallback = "file") {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120) || fallback;
}

function clearReceiptPreview() {
  if (selectedReceiptPreviewUrl) URL.revokeObjectURL(selectedReceiptPreviewUrl);
  selectedReceipt = null;
  selectedReceiptPreviewUrl = "";
  if (els.receiptPreview) els.receiptPreview.hidden = true;
  if (els.receiptPreviewImage) {
    els.receiptPreviewImage.removeAttribute("src");
    els.receiptPreviewImage.hidden = true;
  }
  if (els.receiptPreviewMeta) els.receiptPreviewMeta.textContent = "";
}

function imageName(name) {
  const base = String(name || "check").replace(/\.[a-z0-9]{2,8}$/i, "");
  return `${safeFileName(base, "check")}.jpg`;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось открыть фото чека"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Не удалось подготовить фото"));
    }, type, quality);
  });
}

async function compressReceiptImage(file) {
  const image = await loadImageFromFile(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, "image/jpeg", IMAGE_QUALITY);
  if (blob.size >= file.size && file.type === "image/jpeg") return file;

  return new File([blob], imageName(file.name), {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}

async function prepareReceipt(file) {
  if (!file) {
    clearReceiptPreview();
    return;
  }

  receiptProcessing = true;
  clearReceiptPreview();
  els.receiptLabel.textContent = "Готовим чек...";

  try {
    const isImage = file.type.startsWith("image/");
    const prepared = isImage ? await compressReceiptImage(file) : file;
    selectedReceipt = prepared;
    selectedReceiptPreviewUrl = URL.createObjectURL(prepared);
    els.receiptLabel.textContent = prepared.name;
    els.receiptPreviewTitle.textContent = isImage ? "Фото чека готово" : "Файл чека готов";
    if (els.receiptPreviewImage) {
      els.receiptPreviewImage.src = isImage ? selectedReceiptPreviewUrl : "";
      els.receiptPreviewImage.hidden = !isImage;
    }
    els.receiptPreviewMeta.textContent = isImage && prepared.size < file.size
      ? `${formatBytes(file.size)} → ${formatBytes(prepared.size)}`
      : `${formatBytes(prepared.size)}, без сжатия`;
    els.receiptPreview.hidden = false;
  } catch (error) {
    selectedReceipt = file;
    selectedReceiptPreviewUrl = URL.createObjectURL(file);
    els.receiptLabel.textContent = file.name;
    els.receiptPreviewTitle.textContent = "Чек сохранится без сжатия";
    if (els.receiptPreviewImage) {
      els.receiptPreviewImage.src = file.type.startsWith("image/") ? selectedReceiptPreviewUrl : "";
      els.receiptPreviewImage.hidden = !file.type.startsWith("image/");
    }
    els.receiptPreviewMeta.textContent = `${formatBytes(file.size)}, ${error.message}`;
    els.receiptPreview.hidden = false;
  } finally {
    receiptProcessing = false;
  }
}

async function sha256Blob(blob) {
  if (!blob || !crypto.subtle) return "";
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function setSettings(next) {
  const settings = { ...getSettings(), ...next };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function hydrateSettings() {
  const settings = getSettings();
  const driver = settings.profileDriver || settings.driver || "";
  const vehicle = settings.profileVehicle || settings.vehicle || "";
  els.driver.value = driver;
  els.vehicle.value = vehicle;
  els.profileDriver.value = driver;
  els.profileVehicle.value = vehicle;
  els.driverSummary.textContent = [driver, vehicle].filter(Boolean).join(" · ") || "Профиль не заполнен";
  const activeTrip = getActiveTrip();
  els.vehicleStatus.value = settings.currentVehicleStatus || activeTrip?.currentStatus || "Стоянка";
  renderCurrentTrip();
}

function getActiveTrip() {
  return getSettings().activeTrip || null;
}

function setActiveTrip(activeTrip) {
  setSettings({ activeTrip });
  renderCurrentTrip();
}

function renderCurrentTrip() {
  const trip = getActiveTrip();
  if (!trip) {
    els.currentTripTitle.textContent = "Вне рейса";
    els.currentTripMeta.textContent = "Расход будет записан без привязки к рейсу.";
    els.startTrip.hidden = false;
    els.endTrip.hidden = true;
    return;
  }

  els.currentTripTitle.textContent = `${trip.from} → ${trip.to}`;
  const details = [trip.number ? `№ ${trip.number}` : "", trip.startedAt ? `начат ${formatDateTime(trip.startedAt)}` : ""];
  els.currentTripMeta.textContent = details.filter(Boolean).join(" · ");
  els.startTrip.hidden = true;
  els.endTrip.hidden = false;
}

function tripSnapshot() {
  const trip = getActiveTrip();
  if (!trip) return null;
  return {
    tripId: trip.id,
    tripNumber: trip.number || "",
    tripFrom: trip.from || "",
    tripTo: trip.to || "",
    tripStartedAt: trip.startedAt || ""
  };
}

function expenseTripLabel(expense) {
  if (expense.tripFrom || expense.tripTo) {
    return `${expense.tripFrom || "—"} → ${expense.tripTo || "—"}`;
  }
  return "Вне рейса";
}

function updatePlaceSuggestions() {
  const values = [];
  expenses.forEach((expense) => {
    [expense.route, expense.tripFrom, expense.tripTo].forEach((value) => {
      const clean = String(value || "").trim();
      if (clean && !values.includes(clean)) values.push(clean);
    });
  });

  els.placeSuggestions.innerHTML = values.slice(0, 30)
    .map((value) => `<option value="${escapeHtml(value)}"></option>`)
    .join("");

  const recent = values.slice(0, 4);
  els.recentPlaces.hidden = recent.length === 0;
  els.recentPlaces.innerHTML = "";
  recent.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = value;
    button.addEventListener("click", () => {
      els.route.value = value;
      els.route.focus();
    });
    els.recentPlaces.append(button);
  });
}

async function collectForm() {
  const fallbackReceipt = correctionSource?.receiptBlob || null;
  const file = selectedReceipt || els.receipt.files[0] || fallbackReceipt;
  const receiptName = selectedReceipt?.name
    || els.receipt.files[0]?.name
    || correctionSource?.receiptName
    || "";
  const receiptType = file?.type || correctionSource?.receiptType || "";
  const amount = Number(String(els.amount.value).replace(",", "."));
  const sourceTrip = correctionSource ? {
    tripId: correctionSource.tripId || "",
    tripNumber: correctionSource.tripNumber || "",
    tripFrom: correctionSource.tripFrom || "",
    tripTo: correctionSource.tripTo || "",
    tripStartedAt: correctionSource.tripStartedAt || ""
  } : tripSnapshot();

  return {
    id: createClientId(),
    date: els.date.value,
    amount,
    driver: els.driver.value.trim(),
    vehicle: els.vehicle.value.trim(),
    vehicleStatus: els.vehicleStatus.value,
    route: els.route.value.trim(),
    category: els.category.value,
    payment: els.payment.value,
    supplier: els.supplier.value.trim(),
    note: els.note.value.trim(),
    receiptName,
    receiptType,
    receiptSize: file ? file.size : 0,
    receiptBlob: file,
    receiptHash: await sha256Blob(file),
    ...(sourceTrip || {
      tripId: "",
      tripNumber: "",
      tripFrom: "",
      tripTo: "",
      tripStartedAt: ""
    }),
    correctionOf: correctionSource?.id || "",
    correctionReason: correctionSource ? els.correctionReason.value.trim() : "",
    recordType: correctionSource ? "correction" : "original",
    createdAt: new Date().toISOString()
  };
}

function resetFormAfterSave() {
  els.amount.value = "";
  els.route.value = "";
  els.supplier.value = "";
  els.note.value = "";
  els.receipt.value = "";
  els.receiptLabel.textContent = "Прикрепить файл или фото";
  clearReceiptPreview();
  els.date.value = todayIso();
  cancelCorrectionMode();
}

function isSuperseded(expense) {
  return expenses.some((candidate) => candidate.correctionOf === expense.id);
}

function effectiveExpenses(source = expenses) {
  const sourceIds = new Set(source.map((expense) => expense.id));
  const superseded = new Set(
    expenses
      .filter((expense) => expense.correctionOf && sourceIds.has(expense.correctionOf))
      .map((expense) => expense.correctionOf)
  );
  return source.filter((expense) => !superseded.has(expense.id));
}

function recordStatus(expense) {
  if (isSuperseded(expense)) return "Исправлена";
  if (expense.correctionOf) return "Исправление";
  return "Первоначальная";
}

function showStoredReceipt(expense) {
  clearReceiptPreview();
  if (!expense.receiptBlob) return;
  selectedReceiptPreviewUrl = URL.createObjectURL(expense.receiptBlob);
  els.receiptPreviewTitle.textContent = "Исходный чек сохранён";
  els.receiptPreviewMeta.textContent = `${formatBytes(expense.receiptSize || expense.receiptBlob.size)} · можно прикрепить новый`;
  const isImage = String(expense.receiptType || "").startsWith("image/");
  els.receiptPreviewImage.src = isImage ? selectedReceiptPreviewUrl : "";
  els.receiptPreviewImage.hidden = !isImage;
  els.receiptPreview.hidden = false;
}

function startCorrection(expense) {
  resetFormAfterSave();
  correctionSource = expense;
  els.correctionBanner.hidden = false;
  els.correctionSourceLabel.textContent = `${expense.category} · ${formatRub(expense.amount)} · ${formatDate(expense.date)}`;
  els.saveExpenseButton.textContent = "Сохранить исправление";
  els.date.value = expense.date || todayIso();
  els.amount.value = expense.amount || "";
  els.driver.value = expense.driver || "";
  els.vehicle.value = expense.vehicle || "";
  els.driverSummary.textContent = [expense.driver, expense.vehicle].filter(Boolean).join(" · ") || "Профиль не заполнен";
  els.vehicleStatus.value = statusOf(expense);
  els.route.value = expense.route || "";
  els.category.value = expense.category || els.category.value;
  els.payment.value = expense.payment || els.payment.value;
  els.supplier.value = expense.supplier || "";
  els.note.value = expense.note || "";
  showStoredReceipt(expense);
  switchTab("entry");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cancelCorrectionMode() {
  correctionSource = null;
  els.correctionBanner.hidden = true;
  els.correctionReason.value = "";
  els.saveExpenseButton.textContent = "Сохранить расход";
}

function updateSummary() {
  const today = todayIso();
  const month = monthKey(today);
  const currentExpenses = effectiveExpenses();
  const todayTotal = currentExpenses
    .filter((expense) => expense.date === today)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const monthTotal = currentExpenses
    .filter((expense) => monthKey(expense.date || "") === month)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  els.todayTotal.textContent = formatRub(todayTotal);
  els.monthTotal.textContent = formatRub(monthTotal);
  els.entryCount.textContent = String(currentExpenses.length);
}

function matchesSearch(expense, query) {
  if (!query) return true;
  const haystack = [
    expense.date,
    expense.driver,
    expense.vehicle,
    statusOf(expense),
    expense.route,
    expense.tripNumber,
    expense.tripFrom,
    expense.tripTo,
    expense.category,
    expense.payment,
    expense.supplier,
    expense.note,
    expense.receiptName,
    expense.correctionReason,
    recordStatus(expense)
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function statusOf(expense) {
  const raw = expense.vehicleStatus || expense.expenseStage || "В рейсе";
  if (raw === "Стоянка / ожидание" || raw === "До рейса" || raw === "После рейса" || raw === "Без привязки к рейсу") {
    return "Стоянка";
  }
  return raw;
}

function renderExpenses() {
  const query = els.search.value.trim();
  const rows = expenses.filter((expense) => matchesSearch(expense, query));

  els.list.innerHTML = "";
  els.emptyState.classList.toggle("visible", rows.length === 0);

  const fragment = document.createDocumentFragment();
  rows.forEach((expense) => {
    const card = document.createElement("article");
    const status = recordStatus(expense);
    card.className = `expense-card ${status === "Исправлена" ? "superseded" : ""}`;
    card.innerHTML = `
      <div class="expense-card-main">
        <div class="expense-title">
          <strong>${escapeHtml(expense.category)}</strong>
          <span>${escapeHtml(formatDate(expense.date))}</span>
        </div>
        <div class="expense-amount">${escapeHtml(formatRub(expense.amount))}</div>
      </div>
      <div class="tag-row">
        ${tag(status, status === "Исправлена" ? "muted" : status === "Исправление" ? "accent" : "")}
        ${tag(expenseTripLabel(expense))}
        ${tag(statusOf(expense))}
        ${expense.route ? tag(expense.route) : ""}
        ${tag(expense.driver || "Водитель не указан")}
        ${tag(expense.vehicle || "Машина не указана")}
        ${tag(expense.payment)}
      </div>
      ${expense.correctionReason ? `<div class="correction-note"><strong>Причина:</strong> ${escapeHtml(expense.correctionReason)}</div>` : ""}
      <div class="meta-line">${escapeHtml([expense.supplier, expense.note].filter(Boolean).join(" · "))}</div>
      <div class="card-actions">
        ${expense.receiptBlob ? '<button type="button" data-action="receipt">Скачать чек</button>' : ""}
        ${!isSuperseded(expense) ? '<button type="button" data-action="correct">Исправить</button>' : ""}
      </div>
    `;

    card.querySelector('[data-action="receipt"]')?.addEventListener("click", () => downloadReceipt(expense));
    card.querySelector('[data-action="correct"]')?.addEventListener("click", () => startCorrection(expense));

    fragment.append(card);
  });

  els.list.append(fragment);
}

function tag(value, variant = "") {
  return `<span class="tag ${variant ? `tag-${variant}` : ""}">${escapeHtml(value)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function refresh() {
  expenses = await getAllExpenses();
  updateSummary();
  renderExpenses();
  updatePlaceSuggestions();
  updateReportSummary();
}

function switchTab(tabName) {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tabName));
  if (tabName === "export") updateReportSummary();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function downloadReceipt(expense) {
  if (!expense.receiptBlob) return;
  const name = safeFileName(expense.receiptName, `receipt-${expense.id}`);
  downloadBlob(expense.receiptBlob, name);
}

function rowsForExport(source = expenses) {
  return source
    .slice()
    .sort((a, b) => `${a.date}T${a.createdAt}`.localeCompare(`${b.date}T${b.createdAt}`))
    .map((expense, index) => ({
      "№": index + 1,
      "ID записи": expense.id || "",
      "Версия записи": recordStatus(expense),
      "Исправляет ID": expense.correctionOf || "",
      "Причина исправления": expense.correctionReason || "",
      "Учитывать в итогах": isSuperseded(expense) ? "Нет" : "Да",
      "Дата": expense.date || "",
      "Водитель": expense.driver || "",
      "Машина": expense.vehicle || "",
      "Номер рейса": expense.tripNumber || "",
      "Откуда": expense.tripFrom || "",
      "Куда": expense.tripTo || "",
      "Статус машины": statusOf(expense),
      "Место расхода": expense.route || "",
      "Категория": expense.category || "",
      "Сумма, ₽": Number(expense.amount || 0),
      "Оплата": expense.payment || "",
      "Кому оплачено": expense.supplier || "",
      "Комментарий": expense.note || "",
      "Чек": expense.receiptName || "",
      "SHA-256 чека": expense.receiptHash || "",
      "Создано": expense.createdAt || ""
    }));
}

async function buildWorkbookBlob(source = expenses) {
  const rows = rowsForExport(source);
  const headers = Object.keys(rows[0] || {
    "№": "",
    "ID записи": "",
    "Версия записи": "",
    "Исправляет ID": "",
    "Причина исправления": "",
    "Учитывать в итогах": "",
    "Дата": "",
    "Водитель": "",
    "Машина": "",
    "Номер рейса": "",
    "Откуда": "",
    "Куда": "",
    "Статус машины": "",
    "Место расхода": "",
    "Категория": "",
    "Сумма, ₽": "",
    "Оплата": "",
    "Кому оплачено": "",
    "Комментарий": "",
    "Чек": "",
    "SHA-256 чека": "",
    "Создано": ""
  });

  const sheetRows = [
    headers.map((header) => cell(header, "s", 1)),
    ...rows.map((row) => headers.map((header) => {
      const value = row[header];
      return typeof value === "number" ? cell(value, "n") : cell(value, "s");
    }))
  ];

  const sheetXml = worksheetXml(sheetRows);
  const files = {
    "[Content_Types].xml": contentTypesXml(),
    "_rels/.rels": rootRelsXml(),
    "xl/workbook.xml": workbookXml(),
    "xl/_rels/workbook.xml.rels": workbookRelsXml(),
    "xl/worksheets/sheet1.xml": sheetXml,
    "xl/styles.xml": stylesXml()
  };

  return zipBlob(files, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function cell(value, type, style = 0) {
  return { value, type, style };
}

function worksheetXml(rows) {
  const body = rows.map((row, rowIndex) => {
    const r = rowIndex + 1;
    const cells = row.map((item, colIndex) => {
      const ref = `${columnName(colIndex + 1)}${r}`;
      const style = item.style ? ` s="${item.style}"` : "";
      if (item.type === "n") {
        const number = Number.isFinite(Number(item.value)) ? Number(item.value) : 0;
        return `<c r="${ref}"${style}><v>${number}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${style}><is><t>${xml(item.value)}</t></is></c>`;
    }).join("");
    return `<row r="${r}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="6" customWidth="1"/>
    <col min="2" max="2" width="13" customWidth="1"/>
    <col min="3" max="10" width="22" customWidth="1"/>
    <col min="11" max="11" width="14" customWidth="1"/>
    <col min="12" max="22" width="24" customWidth="1"/>
  </cols>
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Расходы" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function workbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;
}

function columnName(index) {
  let name = "";
  while (index > 0) {
    const modulo = (index - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    index = Math.floor((index - modulo) / 26);
  }
  return name;
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function exportExcel() {
  if (!expenses.length) {
    showToast("Нет записей для выгрузки");
    return;
  }
  const blob = await buildWorkbookBlob();
  downloadBlob(blob, `rashody-${todayIso()}.xlsx`);
  showToast("Excel-файл скачан");
}

async function exportArchive() {
  if (!expenses.length) {
    showToast("Нет записей для архива");
    return;
  }

  const archive = await buildArchiveBlob(expenses);
  downloadBlob(archive, `rashody-s-chekami-${todayIso()}.zip`);
  showToast("Архив скачан");
}

async function buildArchiveBlob(source = expenses) {
  const workbook = await buildWorkbookBlob(source);
  const workbookBytes = new Uint8Array(await workbook.arrayBuffer());
  const files = {
    "expenses.xlsx": workbookBytes,
    "expenses.json": encoder.encode(JSON.stringify(await serializableExpenses(source), null, 2))
  };

  for (const expense of source) {
    if (!expense.receiptBlob) continue;
    const extension = extensionFromName(expense.receiptName);
    const name = safeFileName(`${expense.date}-${expense.category}-${expense.id}${extension}`, `receipt-${expense.id}${extension}`);
    files[`receipts/${name}`] = new Uint8Array(await expense.receiptBlob.arrayBuffer());
  }

  return zipBlob(files, "application/zip");
}

function setupReportControls() {
  if (!els.reportPeriod) return;
  const today = todayIso();
  const monthStart = startOfMonth(dateFromIso(today));
  els.reportFrom.value = isoFromDate(monthStart);
  els.reportTo.value = today;
  updateReportSummary();
}

function selectedReportRange() {
  const today = dateFromIso(todayIso());
  const period = els.reportPeriod?.value || "current-month";

  if (period === "current-week") {
    const from = startOfWeek(today);
    return { from: isoFromDate(from), to: isoFromDate(today), label: "Текущая неделя" };
  }

  if (period === "previous-week") {
    const currentStart = startOfWeek(today);
    const from = addDays(currentStart, -7);
    const to = addDays(currentStart, -1);
    return { from: isoFromDate(from), to: isoFromDate(to), label: "Прошлая неделя" };
  }

  if (period === "previous-month") {
    const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12);
    return { from: isoFromDate(startOfMonth(previous)), to: isoFromDate(endOfMonth(previous)), label: "Прошлый месяц" };
  }

  if (period === "custom") {
    let from = els.reportFrom.value || isoFromDate(startOfMonth(today));
    let to = els.reportTo.value || todayIso();
    if (from > to) [from, to] = [to, from];
    return { from, to, label: "Свои даты" };
  }

  return { from: isoFromDate(startOfMonth(today)), to: isoFromDate(today), label: "Текущий месяц" };
}

function reportExpenses() {
  const range = selectedReportRange();
  const rows = expenses.filter((expense) => {
    const date = expense.date || "";
    return date >= range.from && date <= range.to;
  });
  return { range, rows };
}

function updateReportSummary() {
  if (!els.reportSummary) return;
  const custom = els.reportPeriod.value === "custom";
  els.reportCustomRange.hidden = !custom;
  const { range, rows } = reportExpenses();
  const currentRows = effectiveExpenses(rows);
  const total = currentRows.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const receipts = rows.filter((expense) => expense.receiptBlob).length;
  const corrections = rows.filter((expense) => expense.correctionOf).length;
  els.reportSummary.textContent = rows.length
    ? `${range.label}: ${formatDate(range.from)} - ${formatDate(range.to)} · действующих: ${currentRows.length} · ${formatRub(total)} · чеков: ${receipts}${corrections ? ` · исправлений: ${corrections}` : ""}`
    : `${range.label}: за выбранный период расходов нет`;
}

async function buildReportArchive() {
  const { range, rows } = reportExpenses();
  if (!rows.length) {
    showToast("За выбранный период расходов нет");
    return null;
  }
  const blob = await buildArchiveBlob(rows);
  return {
    blob,
    range,
    rows,
    fileName: reportFileName(range)
  };
}

async function shareReport() {
  const report = await buildReportArchive();
  if (!report) return;

  if (typeof File === "function" && navigator.share) {
    const file = new File([report.blob], report.fileName, { type: "application/zip" });
    const shareData = {
      title: "Отчет расходов",
      text: `Отчет расходов ${formatDate(report.range.from)} - ${formatDate(report.range.to)}`,
      files: [file]
    };
    if (!navigator.canShare || navigator.canShare(shareData)) {
      await navigator.share(shareData);
      showToast("Отчет передан для отправки");
      return;
    }
  }

  downloadBlob(report.blob, report.fileName);
  showToast("Архив скачан, отправьте его из загрузок");
}

async function downloadReport() {
  const report = await buildReportArchive();
  if (!report) return;
  downloadBlob(report.blob, report.fileName);
  showToast("Отчет скачан");
}

function reportFileName(range) {
  const settings = getSettings();
  const driver = settings.profileDriver || settings.driver || "voditel";
  const vehicle = settings.profileVehicle || settings.vehicle || "mashina";
  return safeFileName(`${driver}-${vehicle}-${range.from}-${range.to}.zip`, `rashody-${range.from}-${range.to}.zip`);
}

function dateFromIso(value) {
  return new Date(`${value}T12:00:00`);
}

function isoFromDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfWeek(date) {
  const day = date.getDay() || 7;
  return addDays(date, 1 - day);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
}

function extensionFromName(name) {
  const match = String(name || "").match(/\.[a-z0-9]{2,8}$/i);
  return match ? match[0] : "";
}

async function serializableExpenses(source = expenses) {
  return source.map((expense) => {
    const copy = { ...expense };
    delete copy.receiptBlob;
    return copy;
  });
}

function zipBlob(files, type) {
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const { dosTime, dosDate } = dosDateTime(now);

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = content instanceof Uint8Array ? content : encoder.encode(String(content));
    const crc = crc32(data);

    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes
    ]);

    parts.push(local, data);

    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes
    ]);

    central.push(centralHeader);
    offset += local.length + data.length;
  });

  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const centralOffset = offset;
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(central.length),
    u16(central.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0)
  ]);

  return new Blob([...parts, ...central, end], { type });
}

function dosDateTime(date) {
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function u16(value) {
  const bytes = new Uint8Array(2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

async function init() {
  db = await openDb();
  els.date.value = todayIso();
  hydrateSettings();
  updatePlatformInfo();
  setupReportControls();
  await refresh();
  els.storageStatus.textContent = "На телефоне";

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        els.storageStatus.textContent = "Готово офлайн";
      })
      .catch(() => {
        els.storageStatus.textContent = "На телефоне";
      });
  }
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (receiptProcessing) {
    showToast("Подождите, чек еще готовится");
    return;
  }
  if (correctionSource && !els.correctionReason.value.trim()) {
    showToast("Укажите причину исправления");
    els.correctionReason.focus();
    return;
  }
  const wasCorrection = Boolean(correctionSource);
  const expense = await collectForm();
  if (!expense.date || !Number.isFinite(expense.amount) || expense.amount <= 0) {
    showToast("Проверьте дату и сумму");
    return;
  }
  setSettings({
    driver: expense.driver,
    vehicle: expense.vehicle,
    currentVehicleStatus: wasCorrection ? getSettings().currentVehicleStatus : expense.vehicleStatus
  });
  if (!wasCorrection) {
    const activeTrip = getActiveTrip();
    if (activeTrip) setActiveTrip({ ...activeTrip, currentStatus: expense.vehicleStatus });
  }
  await saveExpense(expense);
  resetFormAfterSave();
  hydrateSettings();
  await refresh();
  switchTab("journal");
  showToast(wasCorrection ? "Исправление сохранено" : "Расход сохранен");
});

els.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const profileDriver = els.profileDriver.value.trim();
  const profileVehicle = els.profileVehicle.value.trim();
  setSettings({
    profileDriver,
    profileVehicle,
    driver: profileDriver,
    vehicle: profileVehicle
  });
  els.driver.value = profileDriver;
  els.vehicle.value = profileVehicle;
  els.driverSummary.textContent = [profileDriver, profileVehicle].filter(Boolean).join(" · ") || "Профиль не заполнен";
  showToast("Профиль сохранен");
  switchTab("entry");
});

els.receipt.addEventListener("change", async () => {
  const file = els.receipt.files[0];
  await prepareReceipt(file);
});

els.receiptPreviewOpen?.addEventListener("click", () => {
  if (!selectedReceiptPreviewUrl) return;
  window.open(selectedReceiptPreviewUrl, "_blank", "noopener");
});

els.openProfile.addEventListener("click", () => switchTab("profile"));

els.cancelCorrection.addEventListener("click", () => {
  resetFormAfterSave();
  hydrateSettings();
  showToast("Исправление отменено");
});

els.vehicleStatus.addEventListener("change", () => {
  if (correctionSource) return;
  const status = els.vehicleStatus.value;
  setSettings({ currentVehicleStatus: status });
  const activeTrip = getActiveTrip();
  if (activeTrip) setActiveTrip({ ...activeTrip, currentStatus: status });
});

els.startTrip.addEventListener("click", () => {
  els.tripForm.reset();
  els.tripStartStatus.value = "Ожидание загрузки";
  if (typeof els.tripDialog.showModal === "function") els.tripDialog.showModal();
  else els.tripDialog.setAttribute("open", "");
});

els.closeTripDialog.addEventListener("click", () => els.tripDialog.close());

els.tripForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const from = els.tripFrom.value.trim();
  const to = els.tripTo.value.trim();
  if (!from || !to) {
    showToast("Укажите откуда и куда едем");
    return;
  }
  const status = els.tripStartStatus.value;
  const trip = {
    id: createClientId(),
    number: els.tripNumber.value.trim(),
    from,
    to,
    startedAt: new Date().toISOString(),
    currentStatus: status
  };
  setSettings({ activeTrip: trip, currentVehicleStatus: status });
  els.vehicleStatus.value = status;
  renderCurrentTrip();
  els.tripDialog.close();
  showToast("Рейс начат");
});

els.endTrip.addEventListener("click", () => {
  const trip = getActiveTrip();
  if (!trip) return;
  if (!confirm(`Завершить рейс ${trip.from} → ${trip.to}?`)) return;
  setSettings({ activeTrip: null, currentVehicleStatus: "Стоянка" });
  els.vehicleStatus.value = "Стоянка";
  renderCurrentTrip();
  showToast("Рейс завершён, машина на стоянке");
});

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

els.search.addEventListener("input", renderExpenses);
els.clearSearch.addEventListener("click", () => {
  els.search.value = "";
  renderExpenses();
});

els.exportExcel.addEventListener("click", exportExcel);
els.exportArchive.addEventListener("click", exportArchive);

els.reportForm?.addEventListener("submit", (event) => event.preventDefault());
els.reportPeriod?.addEventListener("change", updateReportSummary);
els.reportFrom?.addEventListener("change", updateReportSummary);
els.reportTo?.addEventListener("change", updateReportSummary);
els.shareReport?.addEventListener("click", () => {
  shareReport().catch((error) => {
    showToast(error.name === "AbortError" ? "Отправка отменена" : error.message || "Не удалось отправить отчет");
  });
});
els.downloadReport?.addEventListener("click", () => {
  downloadReport().catch((error) => showToast(error.message || "Не удалось скачать отчет"));
});

init().catch((error) => {
  console.error(error);
  showToast("Не удалось открыть локальное хранилище");
});
