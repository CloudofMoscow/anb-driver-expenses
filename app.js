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
  exportBackup: document.querySelector("#exportBackup"),
  importBackup: document.querySelector("#importBackup"),
  reportForm: document.querySelector("#reportForm"),
  reportPeriod: document.querySelector("#reportPeriod"),
  reportCustomRange: document.querySelector("#reportCustomRange"),
  reportFrom: document.querySelector("#reportFrom"),
  reportTo: document.querySelector("#reportTo"),
  reportSummary: document.querySelector("#reportSummary"),
  shareReport: document.querySelector("#shareReport"),
  downloadReport: document.querySelector("#downloadReport"),
  profileForm: document.querySelector("#profileForm"),
  profileDriver: document.querySelector("#profileDriver"),
  profileVehicle: document.querySelector("#profileVehicle"),
  clearAll: document.querySelector("#clearAll"),
  toast: document.querySelector("#toast"),
  storageStatus: document.querySelector("#storageStatus")
};

let db;
let expenses = [];
let toastTimer;

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

async function deleteExpense(id) {
  await requestToPromise(transaction("readwrite").delete(id));
}

async function clearExpenses() {
  await requestToPromise(transaction("readwrite").clear());
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

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
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
}

function collectForm() {
  const file = els.receipt.files[0] || null;
  const amount = Number(String(els.amount.value).replace(",", "."));

  return {
    id: crypto.randomUUID(),
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
    receiptName: file ? file.name : "",
    receiptType: file ? file.type : "",
    receiptSize: file ? file.size : 0,
    receiptBlob: file,
    createdAt: new Date().toISOString()
  };
}

function resetFormAfterSave() {
  els.amount.value = "";
  els.vehicleStatus.value = "В рейсе";
  els.route.value = "";
  els.supplier.value = "";
  els.note.value = "";
  els.receipt.value = "";
  els.receiptLabel.textContent = "Прикрепить файл или фото";
  els.date.value = todayIso();
}

function updateSummary() {
  const today = todayIso();
  const month = monthKey(today);
  const todayTotal = expenses
    .filter((expense) => expense.date === today)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const monthTotal = expenses
    .filter((expense) => monthKey(expense.date || "") === month)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  els.todayTotal.textContent = formatRub(todayTotal);
  els.monthTotal.textContent = formatRub(monthTotal);
  els.entryCount.textContent = String(expenses.length);
}

function matchesSearch(expense, query) {
  if (!query) return true;
  const haystack = [
    expense.date,
    expense.driver,
    expense.vehicle,
    statusOf(expense),
    expense.route,
    expense.category,
    expense.payment,
    expense.supplier,
    expense.note,
    expense.receiptName
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
    card.className = "expense-card";
    card.innerHTML = `
      <div class="expense-card-main">
        <div class="expense-title">
          <strong>${escapeHtml(expense.category)}</strong>
          <span>${escapeHtml(formatDate(expense.date))}</span>
        </div>
        <div class="expense-amount">${escapeHtml(formatRub(expense.amount))}</div>
      </div>
      <div class="tag-row">
        ${tag(expense.route || "Без рейса")}
        ${tag(statusOf(expense))}
        ${tag(expense.driver || "Водитель не указан")}
        ${tag(expense.vehicle || "Машина не указана")}
        ${tag(expense.payment)}
      </div>
      <div class="meta-line">${escapeHtml([expense.supplier, expense.note].filter(Boolean).join(" · "))}</div>
      <div class="card-actions">
        ${expense.receiptBlob ? '<button type="button" data-action="receipt">Скачать чек</button>' : ""}
        <button class="delete-button" type="button" data-action="delete">Удалить</button>
      </div>
    `;

    card.querySelector('[data-action="receipt"]')?.addEventListener("click", () => downloadReceipt(expense));
    card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      const ok = confirm("Удалить расход?");
      if (!ok) return;
      await deleteExpense(expense.id);
      await refresh();
      showToast("Расход удален");
    });

    fragment.append(card);
  });

  els.list.append(fragment);
}

function tag(value) {
  return `<span class="tag">${escapeHtml(value)}</span>`;
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
      "Дата": expense.date || "",
      "Водитель": expense.driver || "",
      "Машина": expense.vehicle || "",
      "Статус машины": statusOf(expense),
      "Рейс / место": expense.route || "",
      "Категория": expense.category || "",
      "Сумма, ₽": Number(expense.amount || 0),
      "Оплата": expense.payment || "",
      "Кому оплачено": expense.supplier || "",
      "Комментарий": expense.note || "",
      "Чек": expense.receiptName || "",
      "Создано": expense.createdAt || ""
    }));
}

async function buildWorkbookBlob(source = expenses) {
  const rows = rowsForExport(source);
  const headers = Object.keys(rows[0] || {
    "№": "",
    "Дата": "",
    "Водитель": "",
    "Машина": "",
    "Статус машины": "",
    "Рейс / место": "",
    "Категория": "",
    "Сумма, ₽": "",
    "Оплата": "",
    "Кому оплачено": "",
    "Комментарий": "",
    "Чек": "",
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
    <col min="3" max="7" width="22" customWidth="1"/>
    <col min="8" max="8" width="14" customWidth="1"/>
    <col min="9" max="13" width="24" customWidth="1"/>
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
    "expenses.json": encoder.encode(JSON.stringify(await serializableExpenses(false, source), null, 2))
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
  const total = rows.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const receipts = rows.filter((expense) => expense.receiptBlob).length;
  els.reportSummary.textContent = rows.length
    ? `${range.label}: ${formatDate(range.from)} - ${formatDate(range.to)} · ${rows.length} записей · ${formatRub(total)} · чеков: ${receipts}`
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

async function serializableExpenses(includeReceipts, source = expenses) {
  const rows = [];
  for (const expense of source) {
    const copy = { ...expense };
    delete copy.receiptBlob;
    if (includeReceipts && expense.receiptBlob) {
      copy.receiptDataUrl = await blobToDataUrl(expense.receiptBlob);
    }
    rows.push(copy);
  }
  return rows;
}

async function exportBackup() {
  const data = {
    app: "driver-expenses",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    expenses: await serializableExpenses(true)
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `rezerv-rashody-${todayIso()}.json`);
  showToast("Резервная копия скачана");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, content] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function importBackupFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data.app !== "driver-expenses" || !Array.isArray(data.expenses)) {
    throw new Error("Неверный файл резервной копии");
  }

  if (!confirm("Заменить текущий журнал данными из копии?")) return;

  await clearExpenses();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data.settings || {}));
  for (const expense of data.expenses) {
    const copy = { ...expense };
    copy.receiptBlob = copy.receiptDataUrl ? dataUrlToBlob(copy.receiptDataUrl) : null;
    delete copy.receiptDataUrl;
    await saveExpense(copy);
  }
  hydrateSettings();
  await refresh();
  showToast("Резервная копия загружена");
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
  const expense = collectForm();
  if (!expense.date || !Number.isFinite(expense.amount) || expense.amount <= 0) {
    showToast("Проверьте дату и сумму");
    return;
  }
  setSettings({
    driver: expense.driver,
    vehicle: expense.vehicle
  });
  await saveExpense(expense);
  resetFormAfterSave();
  await refresh();
  switchTab("journal");
  showToast("Расход сохранен");
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
  showToast("Профиль сохранен");
  switchTab("entry");
});

els.receipt.addEventListener("change", () => {
  const file = els.receipt.files[0];
  els.receiptLabel.textContent = file ? file.name : "Прикрепить файл или фото";
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
els.exportBackup.addEventListener("click", exportBackup);

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

els.importBackup.addEventListener("change", async () => {
  const file = els.importBackup.files[0];
  if (!file) return;
  try {
    await importBackupFile(file);
  } catch (error) {
    showToast(error.message || "Не удалось загрузить копию");
  } finally {
    els.importBackup.value = "";
  }
});

els.clearAll.addEventListener("click", async () => {
  if (!expenses.length) return;
  const ok = confirm("Удалить все записи?");
  if (!ok) return;
  await clearExpenses();
  await refresh();
  showToast("Журнал очищен");
});

init().catch((error) => {
  console.error(error);
  showToast("Не удалось открыть локальное хранилище");
});
