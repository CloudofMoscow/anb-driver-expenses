import {
  api,
  currentUser,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatRubles,
  rublesToKopecks,
  showToast
} from "./api-client.js";
import {
  clearDriverOperations,
  countDriverOperations,
  discardDriverOperation,
  enqueueDriverOperation,
  flushDriverOperations,
  listDriverOperations
} from "./driver-outbox.js";
import { initializePushNotifications } from "./push-notifications.js";

const cacheKeyPrefix = "anb-driver-bootstrap-v2";
const selectedTripKeyPrefix = "anb-selected-trip-v2";
const lastUserKey = "anb-driver-last-user-v1";
const maxAttachmentBytes = 12 * 1024 * 1024;
const els = {
  driverName: document.querySelector("#driverName"),
  networkStatus: document.querySelector("#networkStatus"),
  pushNotificationsButton: document.querySelector("#pushNotificationsButton"),
  logoutButton: document.querySelector("#logoutButton"),
  changePasswordButton: document.querySelector("#changePasswordButton"),
  clearDeviceButton: document.querySelector("#clearDeviceButton"),
  activeTripSummary: document.querySelector("#activeTripSummary"),
  tripExpenseTotal: document.querySelector("#tripExpenseTotal"),
  tripExpenseCount: document.querySelector("#tripExpenseCount"),
  primaryShortcut: document.querySelector("#driverPrimaryShortcut"),
  tripDetailsShortcut: document.querySelector("#tripDetailsShortcut"),
  receiptPhotoShortcut: document.querySelector("#receiptPhotoShortcut"),
  tabs: document.querySelectorAll("[data-driver-tab]"),
  panels: document.querySelectorAll("[data-driver-panel]"),
  moneyTab: document.querySelector("[data-driver-tab='money']"),
  moneyPanel: document.querySelector("[data-driver-panel='money']"),
  notificationSection: document.querySelector("#driverNotificationSection"),
  notificationCount: document.querySelector("#driverNotificationCount"),
  notificationList: document.querySelector("#driverNotificationList"),
  syncQueueSection: document.querySelector("#driverSyncQueueSection"),
  syncQueueCount: document.querySelector("#driverSyncQueueCount"),
  syncQueueList: document.querySelector("#driverSyncQueueList"),
  tripList: document.querySelector("#tripList"),
  noTrips: document.querySelector("#noTrips"),
  tripDetail: document.querySelector("#tripDetail"),
  tripRoute: document.querySelector("#tripRoute"),
  tripStatus: document.querySelector("#tripStatus"),
  tripFacts: document.querySelector("#tripFacts"),
  startTripForm: document.querySelector("#startTripForm"),
  completeTripForm: document.querySelector("#completeTripForm"),
  loadedAt: document.querySelector("#loadedAt"),
  startOdometer: document.querySelector("#startOdometer"),
  startOdometerPhoto: document.querySelector("#startOdometerPhoto"),
  unloadedAt: document.querySelector("#unloadedAt"),
  endOdometer: document.querySelector("#endOdometer"),
  endOdometerPhoto: document.querySelector("#endOdometerPhoto"),
  expenseForm: document.querySelector("#driverExpenseForm"),
  expenseTripHint: document.querySelector("#expenseTripHint"),
  expenseAmount: document.querySelector("#expenseAmount"),
  expenseCategory: document.querySelector("#expenseCategory"),
  expenseOccurredAt: document.querySelector("#expenseOccurredAt"),
  expensePaymentMethod: document.querySelector("#expensePaymentMethod"),
  expensePaymentSource: document.querySelector("#expensePaymentSource"),
  expenseSupplier: document.querySelector("#expenseSupplier"),
  expenseLocation: document.querySelector("#expenseLocation"),
  expenseDescription: document.querySelector("#expenseDescription"),
  expenseReceipt: document.querySelector("#expenseReceipt"),
  saveDriverExpense: document.querySelector("#saveDriverExpense"),
  expenseList: document.querySelector("#driverExpenseList"),
  expenseStatusFilter: document.querySelector("#driverExpenseStatusFilter"),
  noExpenses: document.querySelector("#noExpenses"),
  balanceHeadline: document.querySelector("#driverBalanceHeadline"),
  balanceNote: document.querySelector("#driverBalanceNote"),
  salaryAccrued: document.querySelector("#driverSalaryAccrued"),
  salaryPaid: document.querySelector("#driverSalaryPaid"),
  dailyAccrued: document.querySelector("#driverDailyAccrued"),
  dailyPaid: document.querySelector("#driverDailyPaid"),
  advanceBalance: document.querySelector("#driverAdvanceBalance"),
  reimbursementBalance: document.querySelector("#driverReimbursementBalance"),
  dailyPeriod: document.querySelector("#driverDailyPeriod"),
  unconfirmedExpenses: document.querySelector("#driverUnconfirmedExpenses"),
  moneyHistory: document.querySelector("#driverMoneyHistory"),
  noMoneyHistory: document.querySelector("#noDriverMoneyHistory"),
  actionDialog: document.querySelector("#driverActionDialog"),
  actionForm: document.querySelector("#driverActionForm"),
  actionEyebrow: document.querySelector("#driverActionDialogEyebrow"),
  actionTitle: document.querySelector("#driverActionDialogTitle"),
  actionDescription: document.querySelector("#driverActionDialogDescription"),
  actionFields: document.querySelector("#driverActionDialogFields"),
  actionCancel: document.querySelector("#driverActionDialogCancel"),
  actionSubmit: document.querySelector("#driverActionDialogSubmit"),
  toast: document.querySelector("#toast")
};

let state = {
  user: null, trips: [], expenses: [], notifications: [], expenseCategories: [],
  capabilities: { compensationVisible: false },
  settlement: null, transfers: [], accruals: [],
  offline: false, pendingCount: 0, pendingOperations: [], syncing: false
};
let selectedTripId = "";
let driverActionResolver = null;
let geolocationNoticeShown = false;

init();

async function init() {
  let user;
  try {
    user = await currentUser("driver");
  } catch (error) {
    if (error.status === 401) return;
    user = readRememberedUser();
    if (!user) {
      setNetworkStatus(false);
      showToast(els.toast, "Нет связи. Сначала откройте приложение один раз с интернетом.", true);
      return;
    }
    state.offline = true;
  }
  if (!user) return;
  state.user = user;
  rememberUser(user);
  selectedTripId = localStorage.getItem(selectedTripStorageKey()) || "";
  els.driverName.textContent = compactDriverName(user.fullName);
  els.driverName.title = user.fullName;
  setDefaultDateTimes();
  bindEvents();
  await loadData();
  applyDriverRoute({ scroll: false, replaceInvalid: true });
  await flushPendingOperations();
  const serviceWorkerRegistration = await registerServiceWorker();
  if (serviceWorkerRegistration) {
    await initializePushNotifications({
      button: els.pushNotificationsButton,
      api,
      showMessage: (message, isError = false) => showToast(els.toast, message, isError)
    });
  }
  window.setInterval(refreshWhenVisible, 30_000);
}

async function refreshWhenVisible() {
  if (document.visibilityState !== "visible" || !navigator.onLine || state.syncing) return;
  await loadData();
  await flushPendingOperations();
}

async function loadData() {
  let operations = [];
  try {
    operations = await listDriverOperations(state.user?.id);
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
  try {
    const data = sanitizeDriverData(await api("/api/driver/bootstrap"));
    state = { ...state, ...data, offline: false };
    rememberUser(data.user);
  } catch (error) {
    const cached = readCache();
    state.offline = true;
    if (!cached) {
      state.pendingCount = operations.length;
      setNetworkStatus(false);
      render();
      showToast(els.toast, error.message, true);
      return;
    }
    state = { ...state, ...sanitizeDriverData(cached), offline: true };
  }
  applyQueuedOperations(operations);
  state.pendingCount = operations.length;
  state.pendingOperations = operations;
  writeCache(driverCacheSnapshot());
  setNetworkStatus(!state.offline);
  chooseTrip();
  render();
}

function chooseTrip() {
  const active = state.trips.find((trip) => trip.status === "in_progress");
  const selected = state.trips.find((trip) => trip.id === selectedTripId);
  const assigned = state.trips.find((trip) => ["assigned", "awaiting_loading"].includes(trip.status));
  const next = active || assigned || selected || state.trips[0];
  selectedTripId = next?.id || "";
  if (selectedTripId) localStorage.setItem(selectedTripStorageKey(), selectedTripId);
}

function render() {
  const trip = selectedTrip();
  const rejectedOperation = rejectedQueuedOperation();
  renderCapabilities();
  renderExpenseCategoryOptions();
  renderSyncQueue();
  renderNotifications();
  renderTripList();
  renderTrip(trip);
  renderExpenses();
  if (driverCompensationVisible()) renderMoney();
  const tripExpenses = trip ? state.expenses.filter((expense) => expense.trip_id === trip.id && expense.status !== "rejected") : [];
  els.activeTripSummary.textContent = state.trips.find((item) => item.status === "in_progress") ? "В пути" : trip ? statusLabel(trip.status) : "Нет";
  els.tripExpenseTotal.textContent = formatRubles(tripExpenses.reduce((sum, expense) => sum + expense.amount_kopecks, 0));
  els.tripExpenseCount.textContent = String(tripExpenses.length);
  renderDriverShortcuts(trip);
  els.expenseForm.querySelectorAll("input,select,textarea,button").forEach((control) => {
    control.disabled = state.syncing || Boolean(rejectedOperation) || trip?.status !== "in_progress";
  });
  els.expenseTripHint.textContent = rejectedOperation
    ? "Сначала исправьте ошибочную запись в очереди отправки."
    : trip?.status === "in_progress"
    ? `${tripRouteText(trip)}${state.offline ? " · без сети сохраним на телефоне" : ""}`
    : "Расход можно добавить после начала рейса.";
}

function renderDriverShortcuts(trip) {
  const hasTrip = Boolean(trip);
  els.tripDetailsShortcut.disabled = !hasTrip;
  els.receiptPhotoShortcut.disabled = trip?.status !== "in_progress";
  els.primaryShortcut.hidden = false;
  if (!trip) {
    els.primaryShortcut.textContent = "Рейс ещё не назначен";
    els.primaryShortcut.disabled = true;
    return;
  }
  els.primaryShortcut.disabled = false;
  if (trip.status === "in_progress") {
    els.primaryShortcut.textContent = "Добавить расход";
  } else if (["assigned", "awaiting_loading"].includes(trip.status)) {
    els.primaryShortcut.textContent = "Начать рейс";
    els.primaryShortcut.hidden = els.tripDetail.classList.contains("action-expanded");
  } else {
    els.primaryShortcut.textContent = "Посмотреть расходы";
  }
}

function driverCompensationVisible() {
  return state.capabilities?.compensationVisible === true;
}

function renderCapabilities() {
  const compensationVisible = driverCompensationVisible();
  els.moneyTab.hidden = !compensationVisible;
  els.moneyPanel.hidden = !compensationVisible;
  applyDriverRoute({ scroll: false, replaceInvalid: true });
}

function sanitizeDriverData(data) {
  const compensationVisible = data?.capabilities?.compensationVisible === true;
  return {
    ...data,
    capabilities: {
      ...(data?.capabilities || {}),
      compensationVisible
    },
    settlement: compensationVisible ? data?.settlement || null : null,
    transfers: compensationVisible && Array.isArray(data?.transfers) ? data.transfers : [],
    accruals: compensationVisible && Array.isArray(data?.accruals) ? data.accruals : []
  };
}

function renderExpenseCategoryOptions() {
  const current = els.expenseCategory.value;
  els.expenseCategory.innerHTML = "";
  if (!state.expenseCategories?.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Офис ещё не настроил категории";
    option.disabled = true;
    option.selected = true;
    els.expenseCategory.append(option);
    return;
  }
  state.expenseCategories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = category.name;
    els.expenseCategory.append(option);
  });
  if ([...els.expenseCategory.options].some((option) => option.value === current)) {
    els.expenseCategory.value = current;
  }
}

function renderSyncQueue() {
  const operations = state.pendingOperations || [];
  els.syncQueueSection.hidden = operations.length === 0;
  els.syncQueueCount.textContent = String(operations.length);
  els.syncQueueList.innerHTML = "";
  operations.forEach((operation) => {
    const card = document.createElement("article");
    card.className = "notification-card";
    card.innerHTML = `
      <div><strong>${escapeHtml(queueOperationLabel(operation.type))}</strong><span>${escapeHtml(formatDateTime(operation.createdAt))}</span></div>
      ${operation.lastErrorStatus
        ? `<p class="form-warning">Сервер не принял запись: ${escapeHtml(operation.lastError)}</p>`
        : operation.lastError
          ? `<p>Связь прервалась: ${escapeHtml(operation.lastError)}. Повторим автоматически.</p>`
          : "<p>Ожидает появления связи.</p>"}
      ${operation.lastErrorStatus ? '<button type="button" data-discard-operation>Отменить ошибочную запись</button>' : ""}
    `;
    card.querySelector("[data-discard-operation]")?.addEventListener("click", () => discardQueuedOperation(operation));
    els.syncQueueList.append(card);
  });
}

function queueOperationLabel(type) {
  return { start_trip: "Начало рейса", expense: "Расход", complete_trip: "Завершение рейса" }[type] || type;
}

async function discardQueuedOperation(operation) {
  if (!navigator.onLine) {
    showToast(els.toast, "Для безопасной отмены восстановите интернет", true);
    return;
  }
  const dependent = operation.type === "start_trip"
    ? (state.pendingOperations || []).filter((item) => item.tripId === operation.tripId
      && Number(item.queueId) >= Number(operation.queueId))
    : [operation];
  const warning = dependent.length > 1
    ? `Начало рейса не принято. Отменить его и ${dependent.length - 1} зависимых записей? Фотографии останутся на телефоне только до подтверждения.`
    : "Отменить эту неотправленную запись и вернуть данные рейса к состоянию сервера?";
  const confirmation = await requestDriverAction({
    eyebrow: "Очередь отправки",
    title: "Отменить ошибочную запись?",
    description: warning,
    confirmLabel: "Отменить запись",
    destructive: true,
    fields: []
  });
  if (!confirmation) return;
  try {
    for (const item of dependent) {
      if (item.attachmentId) {
        try {
          await api(`/api/files/${encodeURIComponent(item.attachmentId)}/discard`, { method: "POST" });
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }
      await discardDriverOperation(state.user.id, item.queueId);
    }
    await loadData();
    await flushPendingOperations();
    showToast(els.toast, "Ошибочная запись отменена");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

function renderNotifications() {
  const notifications = state.notifications || [];
  const unread = notifications.filter((notification) => !notification.read_at);
  els.notificationSection.hidden = unread.length === 0;
  els.notificationCount.textContent = `${unread.length} новых`;
  els.notificationCount.dataset.status = unread.length ? "needs_explanation" : "confirmed";
  els.notificationList.innerHTML = "";
  unread.slice(0, 20).forEach((notification) => {
    const actionLabel = ["trip_assigned", "trip_reassigned", "trip_route_updated"]
      .includes(notification.notification_type)
      ? "Рейс принят"
      : "Понятно";
    const card = document.createElement("article");
    card.className = `notification-card${notification.read_at ? " notification-read" : ""}`;
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(notification.title)}</strong>
        <span>${escapeHtml(formatDateTime(notification.created_at))}</span>
      </div>
      <p>${escapeHtml(notification.message)}</p>
      ${notification.read_at ? "" : `<button type="button" data-read-notification>${actionLabel}</button>`}
    `;
    card.querySelector("[data-read-notification]")?.addEventListener("click", () => markNotificationRead(notification));
    els.notificationList.append(card);
  });
}

async function markNotificationRead(notification) {
  if (state.offline) {
    showToast(els.toast, "Отметить сообщение прочитанным можно после восстановления связи", true);
    return;
  }
  try {
    const result = await api(`/api/driver/notifications/${notification.id}/read`, { method: "POST" });
    const index = state.notifications.findIndex((item) => item.id === notification.id);
    if (index >= 0) state.notifications[index] = result.notification;
    writeCache(driverCacheSnapshot());
    renderNotifications();
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

function renderTripList() {
  els.tripList.innerHTML = "";
  els.noTrips.classList.toggle("visible", state.trips.length === 0);
  const active = activeTrip();
  state.trips.forEach((trip) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `trip-choice ${trip.id === selectedTripId ? "active" : ""}`;
    button.disabled = Boolean(active && active.id !== trip.id);
    if (button.disabled) button.title = "Сначала завершите активный рейс";
    button.innerHTML = `
      <strong>${escapeHtml(tripRouteText(trip))}</strong>
      <span>${escapeHtml(trip._pendingSync ? "Ожидает отправки" : statusLabel(trip.status))} · ${escapeHtml(formatDate(trip.planned_loading_date))}</span>
    `;
    button.addEventListener("click", () => {
      selectedTripId = trip.id;
      localStorage.setItem(selectedTripStorageKey(), selectedTripId);
      els.tripDetail.classList.remove("action-expanded", "details-expanded");
      els.tripDetailsShortcut.textContent = "Детали рейса";
      render();
    });
    els.tripList.append(button);
  });
}

function renderTrip(trip) {
  els.tripDetail.hidden = !trip;
  if (!trip) return;
  els.tripRoute.textContent = tripRouteText(trip);
  els.tripStatus.textContent = trip._pendingSync ? "Ожидает отправки" : statusLabel(trip.status);
  els.tripStatus.dataset.status = trip._pendingSync ? "queued" : trip.status;
  els.tripFacts.innerHTML = [
    ["Погрузка", `${formatDate(trip.planned_loading_date)} · ${trip.loading_address}`],
    ["Разгрузка", `${trip.unloading_address}${trip.unloading_address_is_approximate ? " (примерно)" : ""}`],
    ["Транспорт", trip.tractor_label],
    ["Сцепка", trip.rig_name],
    ["Трал", trip.trailer_label],
    ...((trip.additional_unloading_stops || []).length
      ? [["Доп. точки", trip.additional_unloading_stops.map((stop) => stop.address).join(" → ")]]
      : []),
    ["Груз", trip.cargo_description || "Не указан"],
    ["Инструкции", trip.driver_instructions || "Нет дополнительных инструкций"],
    ["Начальный пробег", trip.start_odometer_km == null ? "—" : `${trip.start_odometer_km} км`],
    ["Конечный пробег", trip.end_odometer_km == null ? "—" : `${trip.end_odometer_km} км`]
  ].map(([label, value], index) => `<div class="trip-fact${index > 2 ? " trip-fact-secondary" : ""}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "—")}</dd></div>`).join("");
  const active = activeTrip();
  const anotherTripIsActive = Boolean(active && active.id !== trip.id);
  els.startTripForm.hidden = !["assigned", "awaiting_loading"].includes(trip.status) || anotherTripIsActive;
  els.completeTripForm.hidden = trip.status !== "in_progress";
  const blocked = state.syncing || Boolean(rejectedQueuedOperation());
  els.startTripForm.querySelectorAll("input,button").forEach((control) => { control.disabled = blocked; });
  els.completeTripForm.querySelectorAll("input,button").forEach((control) => { control.disabled = blocked; });
}

function renderExpenses() {
  const statusFilter = els.expenseStatusFilter.value;
  const expenses = state.expenses.filter((expense) => !statusFilter || expense.status === statusFilter);
  els.expenseList.innerHTML = "";
  els.noExpenses.classList.toggle("visible", expenses.length === 0);
  expenses.forEach((expense) => {
    const expenseTrip = state.trips.find((trip) => trip.id === expense.trip_id);
    const route = expenseTrip ? `${expenseTrip.loading_address} → ${expenseTrip.unloading_address}` : "Рейс";
    const card = document.createElement("article");
    card.className = "expense-card";
    card.innerHTML = `
      <div class="expense-card-main">
        <div class="expense-title">
          <strong>${escapeHtml(expense.category)}</strong>
          <span>${escapeHtml(route)} · ${escapeHtml(formatDateTime(expense.occurred_at || expense.created_at))}</span>
        </div>
        <div class="expense-amount">${escapeHtml(formatRubles(expense.amount_kopecks))}</div>
      </div>
      <div class="tag-row">
        <span class="tag">${escapeHtml(expenseStatusLabel(expense.status))}</span>
        <span class="tag">${escapeHtml(expensePaymentSourceLabel(expense.payment_source))}</span>
      </div>
      <p class="meta-line">${escapeHtml([expense.supplier, expense.description].filter(Boolean).join(" · "))}</p>
      ${expenseReviewTimelineMarkup(expense)}
      <div class="card-actions portal-card-actions">
        ${expense.receipt_attachment_id ? `<a class="button-link" href="/api/files/${encodeURIComponent(expense.receipt_attachment_id)}" target="_blank" rel="noopener">Открыть чек</a>` : ""}
        ${expense.status === "needs_explanation" ? '<button type="button" data-explain-expense>Ответить офису</button>' : ""}
      </div>
    `;
    card.querySelector("[data-explain-expense]")?.addEventListener("click", () => explainExpense(expense));
    els.expenseList.append(card);
  });
}

async function explainExpense(expense) {
  const values = await requestDriverAction({
    eyebrow: `${expense.category} · ${formatRubles(expense.amount_kopecks)}`,
    title: "Ответить офису",
    description: "Пояснение сохранится в истории проверки расхода.",
    confirmLabel: "Отправить пояснение",
    fields: [{
      name: "message",
      label: "Пояснение",
      type: "textarea",
      required: true,
      maxLength: 2000
    }]
  });
  if (!values) return;
  try {
    const result = await api(`/api/driver/expenses/${encodeURIComponent(expense.id)}/explanations`, {
      method: "POST",
      body: { message: values.message.trim() }
    });
    const index = state.expenses.findIndex((item) => item.id === expense.id);
    if (index >= 0) state.expenses[index] = result.expense;
    await loadData();
    showToast(els.toast, "Пояснение отправлено в офис");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

function requestDriverAction({
  eyebrow = "Подтверждение",
  title,
  description = "",
  confirmLabel = "Продолжить",
  destructive = false,
  fields = []
}) {
  if (driverActionResolver) closeDriverActionDialog(null);
  const previouslyFocused = document.activeElement;
  els.actionEyebrow.textContent = eyebrow;
  els.actionTitle.textContent = title;
  els.actionDescription.textContent = description;
  els.actionDescription.hidden = !description;
  els.actionSubmit.textContent = confirmLabel;
  els.actionSubmit.classList.toggle("danger-action", destructive);
  els.actionFields.replaceChildren();
  fields.forEach((field) => {
    const label = document.createElement("label");
    const control = document.createElement(field.type === "textarea" ? "textarea" : "input");
    control.id = `driverAction_${field.name}`;
    control.name = field.name;
    if (control instanceof HTMLInputElement) control.type = field.type || "text";
    control.value = field.value ?? "";
    control.required = Boolean(field.required);
    if (field.minLength != null) control.minLength = Number(field.minLength);
    if (field.maxLength != null) control.maxLength = Number(field.maxLength);
    if (field.autocomplete) control.autocomplete = field.autocomplete;
    label.innerHTML = `<span>${escapeHtml(field.label)}${field.required ? ' <span aria-hidden="true">*</span>' : ""}</span>`;
    label.append(control);
    if (field.hint) {
      const hint = document.createElement("small");
      hint.className = "field-hint";
      hint.textContent = field.hint;
      label.append(hint);
    }
    els.actionFields.append(label);
  });
  els.actionDialog.dataset.returnFocusId = previouslyFocused?.id || "";
  els.actionDialog.showModal();
  els.actionFields.querySelector("input, textarea")?.focus();
  return new Promise((resolve) => {
    driverActionResolver = resolve;
  });
}

function submitDriverActionDialog(event) {
  event.preventDefault();
  if (!els.actionForm.reportValidity()) return;
  const values = {};
  els.actionFields.querySelectorAll("input, textarea").forEach((control) => {
    values[control.name] = control.value;
  });
  closeDriverActionDialog(values);
}

function closeDriverActionDialog(result) {
  if (els.actionDialog.open) els.actionDialog.close();
  const resolve = driverActionResolver;
  driverActionResolver = null;
  resolve?.(result);
  const returnFocusId = els.actionDialog.dataset.returnFocusId;
  if (returnFocusId) document.getElementById(returnFocusId)?.focus();
}

function expenseReviewTimelineMarkup(expense) {
  const timeline = normalizedExpenseReviewTimeline(expense);
  if (!timeline.length) return "";
  return `<div class="expense-review-timeline" aria-label="История проверки расхода">
    ${timeline.map((entry) => {
      const isDriverAnswer = entry.entryType === "driver_explanation" || entry.actorRole === "driver";
      const actor = entry.actorName ? ` · ${entry.actorName}` : "";
      const status = !isDriverAnswer && entry.status ? ` · ${expenseStatusLabel(entry.status)}` : "";
      const occurredAt = validTimelineDate(entry.createdAt)
        ? ` · ${formatDateTime(entry.createdAt)}`
        : "";
      const label = `${isDriverAnswer ? "Ваш ответ" : "Решение офиса"}${actor}${status}${occurredAt}`;
      return `<p class="correction-note"><strong>${escapeHtml(label)}</strong>${entry.message ? `<br>${escapeHtml(entry.message)}` : ""}</p>`;
    }).join("")}
  </div>`;
}

function normalizedExpenseReviewTimeline(expense) {
  const timeline = Array.isArray(expense.review_timeline)
    ? expense.review_timeline.filter((entry) => entry && typeof entry === "object")
    : [];
  const entries = timeline.length ? timeline : [
    expense.review_comment ? {
      id: `legacy-review-${expense.id}`,
      entryType: "office_review",
      actorRole: "office",
      status: expense.status,
      message: expense.review_comment,
      createdAt: expense.reviewed_at || null
    } : null,
    expense.driver_explanation ? {
      id: `legacy-explanation-${expense.id}`,
      entryType: "driver_explanation",
      actorRole: "driver",
      status: null,
      message: expense.driver_explanation,
      createdAt: expense.driver_explained_at || null
    } : null
  ].filter(Boolean);
  return entries
    .map((entry, index) => ({
      ...entry,
      entryType: entry.entryType || entry.event_type || "",
      actorName: entry.actorName || entry.actor_name || null,
      actorRole: entry.actorRole || entry.actor_role || null,
      createdAt: entry.createdAt || entry.created_at || null,
      _index: index
    }))
    .sort((left, right) => timelineSortValue(left.createdAt) - timelineSortValue(right.createdAt)
      || left._index - right._index);
}

function timelineSortValue(value) {
  const timestamp = value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function validTimelineDate(value) {
  return Boolean(value) && Number.isFinite(new Date(value).getTime());
}

function renderMoney() {
  const settlement = state.settlement;
  if (!settlement) {
    els.balanceHeadline.textContent = "Расчёт ещё не сформирован";
    els.moneyHistory.innerHTML = "";
    els.noMoneyHistory.classList.add("visible");
    return;
  }
  if (settlement.companyOwesKopecks > 0) {
    els.balanceHeadline.textContent = `Компания должна вам ${formatRubles(settlement.companyOwesKopecks)}`;
    els.balanceNote.textContent = "Это начисления и подтверждённые личные расходы за вычетом выплат и остатка авансов.";
  } else if (settlement.driverOwesKopecks > 0) {
    els.balanceHeadline.textContent = `Вы должны компании ${formatRubles(settlement.driverOwesKopecks)}`;
    els.balanceNote.textContent = "Обычно это неиспользованный аванс или переплата. Подробности показаны ниже.";
  } else {
    els.balanceHeadline.textContent = "Взаиморасчёт закрыт";
    els.balanceNote.textContent = "Начисления, выплаты и подтверждённые авансы сейчас совпадают.";
  }
  els.balanceHeadline.classList.toggle("negative-value", settlement.driverOwesKopecks > 0);
  els.salaryAccrued.textContent = formatRubles(settlement.salaryAccruedKopecks);
  els.salaryPaid.textContent = formatRubles(settlement.salaryPaidKopecks);
  els.dailyAccrued.textContent = formatRubles(settlement.dailyAccruedKopecks);
  els.dailyPaid.textContent = formatRubles(settlement.dailyPaidKopecks);
  els.advanceBalance.textContent = formatRubles(settlement.advanceBalanceKopecks);
  els.reimbursementBalance.textContent = formatRubles(settlement.reimbursementBalanceKopecks);
  els.advanceBalance.classList.toggle("negative-value", settlement.advanceBalanceKopecks > 0);
  els.dailyPeriod.textContent = `Суточные начислены по: ${settlement.dailyAccruedThrough || "—"} · оплачены по: ${settlement.dailyPaidThrough || "—"}.`
    + (settlement.dailyProvisionalAccruedKopecks > 0
      ? ` Из начисленных суточных ${formatRubles(settlement.dailyProvisionalAccruedKopecks)} пока предварительные — по незакрытым рейсам.`
      : "");
  els.unconfirmedExpenses.hidden = settlement.unconfirmedExpensesKopecks <= 0;
  els.unconfirmedExpenses.textContent = settlement.unconfirmedExpensesKopecks > 0
    ? `На проверке расходов: ${formatRubles(settlement.unconfirmedExpensesKopecks)}. До подтверждения они не входят в баланс.`
    : "";

  const history = [
    ...state.accruals.map((item) => ({ kind: "accrual", date: item.created_at, item })),
    ...state.transfers.map((item) => ({ kind: "transfer", date: item.occurred_at, item }))
  ].sort((left, right) => String(right.date).localeCompare(String(left.date)));
  els.moneyHistory.innerHTML = "";
  els.noMoneyHistory.classList.toggle("visible", history.length === 0);
  history.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "compact-info-card money-history-card";
    if (entry.kind === "accrual") {
      const accrual = entry.item;
      const title = accrual.accrual_type === "salary"
        ? "Начислена зарплата"
        : accrual.accrual_type === "daily"
          ? "Начислены суточные"
          : "Корректировка баланса";
      const calculation = accrual.quantity_units != null && accrual.unit_rate_kopecks != null
        ? `${accrual.quantity_units} × ${formatRubles(accrual.unit_rate_kopecks)}`
        : accrual.comment;
      const route = accrual.loading_address
        ? `${accrual.loading_address} → ${accrual.unloading_address}`
        : "Без привязки к рейсу";
      card.innerHTML = `
        <div class="trip-card-heading">
          <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(formatDateTime(accrual.created_at))}</span></div>
          <strong>${escapeHtml(formatRubles(accrual.balance_effect_kopecks))}</strong>
        </div>
        <span>${escapeHtml(route)}</span>
        <span>${escapeHtml(calculation || accrual.comment || "")}</span>
      `;
    } else {
      const transfer = entry.item;
      const direction = transfer.direction === "company_to_driver" ? "Выплата вам" : "Возврат компании";
      const allocationText = transfer.allocations.map((allocation) => {
        const through = allocation.coverage_through ? ` по ${allocation.coverage_through}` : "";
        return `${driverAllocationLabel(allocation.allocation_type)} ${formatRubles(allocation.amount_kopecks)}${through}`;
      }).join(" · ");
      card.classList.toggle("reversed-entry", Boolean(transfer.reversed_at));
      card.innerHTML = `
        <div class="trip-card-heading">
          <div><strong>${escapeHtml(direction)}</strong><span>${escapeHtml(formatDateTime(transfer.occurred_at))}</span></div>
          <strong>${escapeHtml(formatRubles(transfer.amount_kopecks))}</strong>
        </div>
        <span>${escapeHtml(allocationText)}</span>
        ${transfer.comment ? `<span>${escapeHtml(transfer.comment)}</span>` : ""}
        ${transfer.reversed_at ? `<span class="correction-note">Запись отменена: ${escapeHtml(transfer.reversal_reason || "—")}</span>` : ""}
      `;
    }
    els.moneyHistory.append(card);
  });
}

function driverAllocationLabel(type) {
  return {
    salary: "зарплата",
    daily: "суточные",
    expense_advance: "аванс на расходы",
    expense_reimbursement: "компенсация расхода"
  }[type] || type;
}

function bindEvents() {
  els.logoutButton.addEventListener("click", handleLogout);
  els.changePasswordButton.addEventListener("click", changeOwnPassword);
  els.clearDeviceButton.addEventListener("click", clearThisDevice);
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.driverTab));
    tab.addEventListener("keydown", handleDriverTabKeydown);
  });
  window.addEventListener("hashchange", () => applyDriverRoute());
  els.expenseStatusFilter.addEventListener("change", renderExpenses);
  els.actionCancel.addEventListener("click", () => closeDriverActionDialog(null));
  els.actionDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDriverActionDialog(null);
  });
  els.actionForm.addEventListener("submit", submitDriverActionDialog);
  els.primaryShortcut.addEventListener("click", () => {
    const trip = selectedTrip();
    if (!trip) return;
    if (trip.status === "in_progress") {
      switchTab("expense");
      els.expenseAmount.focus();
    } else if (["assigned", "awaiting_loading"].includes(trip.status)) {
      switchTab("trip");
      els.tripDetail.classList.add("action-expanded");
      renderDriverShortcuts(trip);
      scrollIntoViewRespectingMotion(els.startTripForm);
      els.loadedAt.focus();
    } else {
      switchTab("journal");
    }
  });
  els.tripDetailsShortcut.addEventListener("click", () => {
    const trip = selectedTrip();
    if (!trip) return;
    const expanded = els.tripDetail.classList.toggle("details-expanded");
    els.tripDetail.classList.toggle("action-expanded", expanded && trip.status === "in_progress");
    els.tripDetailsShortcut.textContent = expanded ? "Скрыть детали" : "Детали рейса";
    scrollIntoViewRespectingMotion(els.tripDetail);
  });
  els.receiptPhotoShortcut.addEventListener("click", () => {
    if (selectedTrip()?.status !== "in_progress") {
      showToast(els.toast, "Чек можно добавить после начала рейса", true);
      return;
    }
    switchTab("expense");
    els.expenseReceipt.click();
  });
  window.addEventListener("online", async () => {
    await loadData();
    await flushPendingOperations();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshWhenVisible();
  });
  window.addEventListener("offline", () => {
    state.offline = true;
    setNetworkStatus(false);
    render();
  });

  els.startTripForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!queueAllowsNewOperations()) return;
    const trip = selectedTrip();
    if (!trip) return;
    const active = activeTrip();
    if (active && active.id !== trip.id) {
      showToast(els.toast, "Сначала завершите активный рейс", true);
      return;
    }
    await withButton(event.submitter, "Начинаем...", async () => {
      const file = els.startOdometerPhoto.files[0];
      validateQueuedFile(file);
      const location = await currentLocation();
      const operation = await enqueueDriverOperation({
        ownerUserId: state.user.id,
        type: "start_trip",
        tripId: trip.id,
        attachmentKind: "odometer_start",
        file,
        payload: {
          clientMutationId: mutationId(),
          loadedAt: localDateTimeToIso(els.loadedAt.value),
          odometerKm: Number(els.startOdometer.value),
          ...location
        }
      });
      applyQueuedOperation(operation);
      els.startTripForm.reset();
      setDefaultDateTimes();
      await afterOperationQueued("Рейс сохранён на телефоне");
    });
  });

  els.completeTripForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!queueAllowsNewOperations()) return;
    const trip = selectedTrip();
    if (!trip) return;
    await withButton(event.submitter, "Завершаем...", async () => {
      const file = els.endOdometerPhoto.files[0];
      validateQueuedFile(file);
      const location = await currentLocation();
      const operation = await enqueueDriverOperation({
        ownerUserId: state.user.id,
        type: "complete_trip",
        tripId: trip.id,
        attachmentKind: "odometer_end",
        file,
        payload: {
          clientMutationId: mutationId(),
          unloadedAt: localDateTimeToIso(els.unloadedAt.value),
          odometerKm: Number(els.endOdometer.value),
          ...location
        }
      });
      applyQueuedOperation(operation);
      els.completeTripForm.reset();
      setDefaultDateTimes();
      await afterOperationQueued("Завершение рейса сохранено на телефоне");
    });
  });

  els.expenseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!queueAllowsNewOperations()) return;
    const trip = selectedTrip();
    if (!trip || trip.status !== "in_progress") {
      showToast(els.toast, "Сначала начните рейс", true);
      return;
    }
    await withButton(els.saveDriverExpense, "Сохраняем...", async () => {
      const receiptFile = els.expenseReceipt.files[0];
      validateQueuedFile(receiptFile);
      const location = await currentLocation();
      const operation = await enqueueDriverOperation({
        ownerUserId: state.user.id,
        type: "expense",
        tripId: trip.id,
        attachmentKind: "expense_receipt",
        file: receiptFile,
        payload: {
          clientMutationId: mutationId(),
          amountKopecks: rublesToKopecks(els.expenseAmount.value),
          category: els.expenseCategory.value,
          paymentMethod: els.expensePaymentMethod.value,
          paymentSource: els.expensePaymentSource.value,
          supplier: els.expenseSupplier.value,
          description: els.expenseDescription.value,
          occurredAt: localDateTimeToIso(els.expenseOccurredAt.value),
          locationText: els.expenseLocation.value,
          ...location
        }
      });
      applyQueuedOperation(operation);
      els.expenseForm.reset();
      els.expenseOccurredAt.value = localDateTimeValue(new Date());
      switchTab("journal");
      await afterOperationQueued("Расход сохранён на телефоне");
    });
  });
}

function applyQueuedOperations(operations) {
  state.trips = state.trips.map((trip) => ({ ...trip, _pendingSync: null }));
  state.expenses = state.expenses.filter((expense) => expense.status !== "queued");
  let rejectedTripId = null;
  for (const operation of operations) {
    if (operation.lastErrorStatus) {
      rejectedTripId = operation.tripId;
      continue;
    }
    if (rejectedTripId && operation.tripId === rejectedTripId) continue;
    applyQueuedOperation(operation);
  }
}

function rejectedQueuedOperation() {
  return (state.pendingOperations || []).find((operation) => operation.lastErrorStatus) || null;
}

function queueAllowsNewOperations() {
  const rejected = rejectedQueuedOperation();
  if (!rejected) return true;
  showToast(
    els.toast,
    `Сначала исправьте очередь: ${queueOperationLabel(rejected.type).toLowerCase()} не принято сервером`,
    true
  );
  switchTab("trip");
  return false;
}

function applyQueuedOperation(operation) {
  const trip = state.trips.find((item) => item.id === operation.tripId);
  if (!trip) return;

  if (operation.type === "start_trip") {
    trip.status = "in_progress";
    trip.loaded_at = operation.payload.loadedAt;
    trip.start_odometer_km = operation.payload.odometerKm;
    trip._pendingSync = "start_trip";
    return;
  }

  if (operation.type === "complete_trip") {
    trip.status = "pending_review";
    trip.unloaded_at = operation.payload.unloadedAt;
    trip.end_odometer_km = operation.payload.odometerKm;
    trip._pendingSync = "complete_trip";
    return;
  }

  const localId = `queued:${operation.clientMutationId}`;
  if (state.expenses.some((expense) => expense.id === localId)) return;
  state.expenses.unshift({
    id: localId,
    trip_id: operation.tripId,
    amount_kopecks: operation.payload.amountKopecks,
    category: operation.payload.category,
    payment_method: operation.payload.paymentMethod,
    payment_source: operation.payload.paymentSource,
    supplier: operation.payload.supplier,
    description: operation.payload.description,
    location_text: operation.payload.locationText,
    status: "queued",
    review_comment: null,
    occurred_at: operation.payload.occurredAt,
    created_at: operation.createdAt,
    _clientMutationId: operation.clientMutationId
  });
}

async function afterOperationQueued(message) {
  state.pendingOperations = await listDriverOperations(state.user.id);
  state.pendingCount = state.pendingOperations.length;
  writeCache(driverCacheSnapshot());
  chooseTrip();
  render();
  setNetworkStatus(!state.offline);
  showToast(els.toast, `${message}. Ожидает отправки.`);
  await flushPendingOperations();
}

async function flushPendingOperations() {
  if (!state.user?.id || !navigator.onLine || state.syncing) return;
  state.syncing = true;
  setNetworkStatus(!state.offline);
  render();
  let result;
  try {
    result = await flushDriverOperations(state.user.id, ({ pending }) => {
      state.pendingCount = pending;
      setNetworkStatus(true);
    });
  } catch (error) {
    state.syncing = false;
    setNetworkStatus(false);
    render();
    showToast(els.toast, `Не удалось открыть очередь: ${error.message}`, true);
    return;
  }
  state.syncing = false;
  state.pendingCount = result.pending;

  if (result.error) {
    state.pendingOperations = await listDriverOperations(state.user.id);
    state.offline = !result.error.status;
    setNetworkStatus(!state.offline);
    render();
    const prefix = result.error.status
      ? "Запись сохранена, но сервер её не принял"
      : "Нет связи. Запись сохранена на телефоне";
    showToast(els.toast, `${prefix}: ${result.error.message}`, Boolean(result.error.status));
    return;
  }

  if (result.sent > 0) {
    await loadData();
    showToast(els.toast, result.pending === 0 ? "Все записи отправлены" : "Часть записей отправлена");
  } else {
    state.pendingOperations = await listDriverOperations(state.user.id);
    setNetworkStatus(!state.offline);
    render();
  }
}

function validateQueuedFile(file) {
  if (!file) throw new Error("Выберите подтверждающий файл");
  if (file.size > maxAttachmentBytes) {
    throw new Error("Файл слишком большой. Максимальный размер — 12 МБ.");
  }
}

function switchTab(name) {
  const route = name === "journal" ? "history" : name;
  navigateDriver(route);
}

function navigateDriver(route, { replace = false } = {}) {
  const hash = `#${route}`;
  if (location.hash === hash) {
    applyDriverRoute();
    return;
  }
  if (replace) {
    history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
    applyDriverRoute({ scroll: false });
  } else {
    location.hash = route;
  }
}

function applyDriverRoute({ scroll = true, replaceInvalid = false } = {}) {
  const hadHash = Boolean(location.hash);
  let route = decodeURIComponent(location.hash.replace(/^#\/?/, "")) || "trip";
  const panelByRoute = { trip: "trip", expense: "expense", history: "journal", money: "money" };
  if (!panelByRoute[route] || (route === "money" && !driverCompensationVisible())) {
    route = "trip";
    history.replaceState(null, "", `${location.pathname}${location.search}#trip`);
  } else if (!hadHash && replaceInvalid) {
    history.replaceState(null, "", `${location.pathname}${location.search}#${route}`);
  }
  const target = panelByRoute[route];
  els.tabs.forEach((tab) => {
    const active = tab.dataset.driverTab === target;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  els.panels.forEach((panel) => {
    const active = panel.dataset.driverPanel === target;
    panel.classList.toggle("active", active);
    panel.hidden = !active || (panel.dataset.driverPanel === "money" && !driverCompensationVisible());
  });
  document.title = `${target === "trip" ? "Рейс" : target === "expense" ? "Новый расход" : target === "journal" ? "История расходов" : "Деньги"} · ANB`;
  if (scroll) window.scrollTo({ top: 0, behavior: reducedMotionEnabled() ? "auto" : "smooth" });
}

function handleDriverTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...els.tabs].filter((tab) => !tab.hidden);
  const index = tabs.indexOf(event.currentTarget);
  if (index < 0) return;
  event.preventDefault();
  const targetIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[targetIndex].focus();
  switchTab(tabs[targetIndex].dataset.driverTab);
}

function reducedMotionEnabled() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollIntoViewRespectingMotion(element) {
  element?.scrollIntoView({ behavior: reducedMotionEnabled() ? "auto" : "smooth", block: "start" });
}

async function withButton(button, pendingLabel, action) {
  if (!button) return action();
  const label = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = pendingLabel;
  try {
    await action();
  } catch (error) {
    showToast(els.toast, error.message, true);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = label;
  }
}

function selectedTrip() {
  return state.trips.find((trip) => trip.id === selectedTripId) || null;
}

function tripRouteText(trip) {
  if (!trip) return "";
  const stops = (trip.additional_unloading_stops || []).map((stop) => stop.address);
  return [trip.loading_address, trip.unloading_address, ...stops].filter(Boolean).join(" → ");
}

function activeTrip() {
  return state.trips.find((trip) => trip.status === "in_progress") || null;
}

function mutationId() {
  return globalThis.crypto?.randomUUID?.()
    || `driver-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function changeOwnPassword() {
  if (state.offline) {
    showToast(els.toast, "Для смены пароля нужен интернет", true);
    return;
  }
  const pending = await countDriverOperations(state.user?.id);
  if (pending > 0) {
    showToast(els.toast, `Сначала отправьте или исправьте очередь: ${pending}`, true);
    return;
  }
  const values = await requestDriverAction({
    eyebrow: "Безопасность",
    title: "Сменить пароль",
    description: "После сохранения потребуется войти заново.",
    confirmLabel: "Сменить пароль",
    fields: [
      { name: "currentPassword", label: "Текущий пароль", type: "password", autocomplete: "current-password", required: true },
      { name: "newPassword", label: "Новый пароль", type: "password", autocomplete: "new-password", minLength: 10, required: true, hint: "Не менее 10 символов." }
    ]
  });
  if (!values) return;
  try {
    await api("/api/me/password", {
      method: "POST",
      body: { currentPassword: values.currentPassword, newPassword: values.newPassword }
    });
    await clearDriverOperations(state.user?.id);
    clearDriverLocalData();
    location.replace("/login.html");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

function setDefaultDateTimes() {
  const value = localDateTimeValue(new Date());
  els.loadedAt.value = value;
  els.unloadedAt.value = value;
  els.expenseOccurredAt.value = value;
}

function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function localDateTimeToIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Проверьте дату и время");
  return date.toISOString();
}

function currentLocation() {
  if (!navigator.geolocation) {
    notifyGeolocationUnavailable();
    return Promise.resolve({});
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => {
        notifyGeolocationUnavailable();
        resolve({});
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
    );
  });
}

function notifyGeolocationUnavailable() {
  if (geolocationNoticeShown) return;
  geolocationNoticeShown = true;
  showToast(els.toast, "Геопозиция недоступна. Запись всё равно будет сохранена без координат.");
}

function setNetworkStatus(online) {
  const connected = online && navigator.onLine;
  if (state.syncing) {
    els.networkStatus.textContent = `Отправляем · осталось ${state.pendingCount}`;
  } else if (connected) {
    els.networkStatus.textContent = state.pendingCount > 0
      ? `Ожидает отправки: ${state.pendingCount}`
      : "Всё отправлено";
  } else {
    els.networkStatus.textContent = state.pendingCount > 0
      ? `Нет связи · ожидает ${state.pendingCount}`
      : "Нет связи";
  }
  els.networkStatus.classList.toggle("offline", !connected);
}

function compactDriverName(fullName = "") {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.length >= 3 ? `${parts[1]} ${parts[2]}` : fullName;
}

function cacheKey() {
  return `${cacheKeyPrefix}:${state.user?.id || "anonymous"}`;
}

function selectedTripStorageKey() {
  return `${selectedTripKeyPrefix}:${state.user?.id || "anonymous"}`;
}

function writeCache(data) {
  if (!state.user?.id || data?.user?.id !== state.user.id) return;
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ ownerUserId: state.user.id, data }));
  } catch {
    // Переполнение локального хранилища не должно мешать работе онлайн.
  }
}

function readCache() {
  if (!state.user?.id) return null;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey()));
    if (cached?.ownerUserId !== state.user.id || cached?.data?.user?.id !== state.user.id) return null;
    return sanitizeDriverData(cached.data);
  } catch {
    return null;
  }
}

function driverCacheSnapshot() {
  const snapshot = {
    user: state.user,
    capabilities: {
      compensationVisible: driverCompensationVisible()
    },
    trips: state.trips,
    expenses: state.expenses,
    notifications: state.notifications,
    expenseCategories: state.expenseCategories
  };
  if (driverCompensationVisible()) {
    snapshot.settlement = state.settlement;
    snapshot.transfers = state.transfers;
    snapshot.accruals = state.accruals;
  }
  return snapshot;
}

function rememberUser(user) {
  if (!user?.id || user.role !== "driver") return;
  try {
    localStorage.setItem(lastUserKey, JSON.stringify(user));
  } catch {
    // Без указателя последнего пользователя повторный запуск офлайн будет недоступен,
    // но уже открытый кабинет и IndexedDB продолжат работать.
  }
}

function readRememberedUser() {
  try {
    const user = JSON.parse(localStorage.getItem(lastUserKey));
    return user?.id && user?.role === "driver" ? user : null;
  } catch {
    return null;
  }
}

function clearDriverLocalData() {
  if (state.user?.id) {
    localStorage.removeItem(cacheKey());
    localStorage.removeItem(selectedTripStorageKey());
  }
  localStorage.removeItem("anb-driver-bootstrap-v1");
  localStorage.removeItem("anb-selected-trip");
  localStorage.removeItem(lastUserKey);
}

async function handleLogout() {
  try {
    const pending = await countDriverOperations(state.user?.id);
    if (pending > 0) {
      const confirmed = await requestDriverAction({
        eyebrow: "Неотправленные данные",
        title: "Выйти из приложения?",
        description: `На телефоне ${pending} неотправленных записей с фотографиями. При выходе они будут удалены с этого телефона.`,
        confirmLabel: "Выйти и удалить",
        destructive: true,
        fields: []
      });
      if (!confirmed) return;
    }
    await api("/api/auth/logout", { method: "POST" });
    await clearDriverOperations(state.user?.id);
    clearDriverLocalData();
    location.replace("/login.html");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

async function clearThisDevice() {
  const pending = await countDriverOperations(state.user?.id);
  const warning = pending > 0
    ? `На телефоне есть ${pending} неотправленных записей с фотографиями. Очистка удалит их безвозвратно. Продолжить?`
    : "Удалить с этого телефона сохранённые маршруты и черновики? Данные на сервере останутся.";
  const confirmed = await requestDriverAction({
    eyebrow: "Данные на этом устройстве",
    title: "Очистить телефон?",
    description: warning,
    confirmLabel: "Очистить данные",
    destructive: true,
    fields: []
  });
  if (!confirmed) return;
  try {
    let serverSessionCleared = false;
    if (navigator.onLine) {
      try {
        await api("/api/auth/logout", { method: "POST" });
        serverSessionCleared = true;
      } catch {
        // Локальную очистку нельзя отменять из-за нестабильной сети.
      }
    }
    await clearDriverOperations(state.user?.id);
    clearDriverLocalData();
    if (!serverSessionCleared) localStorage.setItem("anb-clear-session-on-connect-v1", "1");
    location.replace("/login.html");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

function statusLabel(status) {
  return {
    draft: "Черновик",
    assigned: "Назначен",
    awaiting_loading: "Ожидает загрузки",
    in_progress: "Выполняется",
    completed_by_driver: "Завершён",
    pending_review: "Ожидает проверки",
    needs_explanation: "Нужно пояснение",
    confirmed: "Подтверждён",
    closed: "Закрыт"
  }[status] || status;
}

function expenseStatusLabel(status) {
  return {
    queued: "Ожидает отправки",
    pending_review: "На проверке",
    confirmed: "Подтверждён",
    rejected: "Отклонён",
    needs_explanation: "Нужно пояснение",
    suspicious: "Подозрительный"
  }[status] || status;
}

function expensePaymentSourceLabel(source) {
  return {
    driver_personal: "Личные деньги",
    driver_advance: "Выданный аванс",
    company_card: "Карта компании",
    company_fuel_card: "Топливная карта компании",
    company_cash: "Наличные компании"
  }[source] || source;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("./sw.js");
  } catch {
    return null;
  }
}
