import {
  api,
  currentUser,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatRubles,
  logout,
  rublesToKopecks,
  showToast,
  uploadAttachment
} from "./api-client.js";
import { submitIdempotentMutation } from "./financial-mutation.js";
import { initializePushNotifications } from "./push-notifications.js";

const els = {
  officeName: document.querySelector("#officeName"),
  pushNotificationsButton: document.querySelector("#pushNotificationsButton"),
  logoutButton: document.querySelector("#logoutButton"),
  changePasswordButton: document.querySelector("#changePasswordButton"),
  currentDate: document.querySelector("#officeCurrentDate"),
  createTripShortcut: document.querySelector("#createTripShortcut"),
  notificationShortcut: document.querySelector("#officeNotificationShortcut"),
  openAllTripsButton: document.querySelector("#openAllTripsButton"),
  overviewTransferButton: document.querySelector("#overviewTransferButton"),
  totalResult: document.querySelector("#totalResult"),
  totalReceivable: document.querySelector("#totalReceivable"),
  totalResultNote: document.querySelector("#totalResultNote"),
  totalReceivableNote: document.querySelector("#totalReceivableNote"),
  pendingExpenseTotal: document.querySelector("#pendingExpenseTotal"),
  pendingExpenseNote: document.querySelector("#pendingExpenseNote"),
  activeTripCount: document.querySelector("#activeTripCount"),
  activeTripNote: document.querySelector("#activeTripNote"),
  overviewTripList: document.querySelector("#overviewTripList"),
  noOverviewTrips: document.querySelector("#noOverviewTrips"),
  overviewAttentionList: document.querySelector("#overviewAttentionList"),
  notificationSection: document.querySelector("#officeNotificationSection"),
  notificationCount: document.querySelector("#officeNotificationCount"),
  notificationList: document.querySelector("#officeNotificationList"),
  tabs: document.querySelectorAll("[data-office-tab]"),
  panels: document.querySelectorAll("[data-office-panel]"),
  tripStatusFilter: document.querySelector("#tripStatusFilter"),
  tripList: document.querySelector("#officeTripList"),
  tripDetail: document.querySelector("#officeTripDetail"),
  tripDetailContent: document.querySelector("#officeTripDetailContent"),
  closeTripDetailButton: document.querySelector("#closeTripDetailButton"),
  noTrips: document.querySelector("#noOfficeTrips"),
  pendingExpenseQueue: document.querySelector("#pendingExpenseQueue"),
  pendingExpenseList: document.querySelector("#pendingExpenseList"),
  noPendingExpenses: document.querySelector("#noPendingExpenses"),
  reportForm: document.querySelector("#reportForm"),
  reportFrom: document.querySelector("#reportFrom"),
  reportTo: document.querySelector("#reportTo"),
  reportRig: document.querySelector("#reportRig"),
  buildReportButton: document.querySelector("#buildReportButton"),
  reportRevenue: document.querySelector("#reportRevenue"),
  reportTripExpenses: document.querySelector("#reportTripExpenses"),
  reportDriverCompensation: document.querySelector("#reportDriverCompensation"),
  reportFixedCosts: document.querySelector("#reportFixedCosts"),
  reportOneOffExpenses: document.querySelector("#reportOneOffExpenses"),
  reportProfit: document.querySelector("#reportProfit"),
  reportNote: document.querySelector("#reportNote"),
  reportCostBreakdown: document.querySelector("#reportCostBreakdown"),
  reportRigList: document.querySelector("#reportRigList"),
  companyExpenseForm: document.querySelector("#companyExpenseForm"),
  companyExpenseScope: document.querySelector("#companyExpenseScope"),
  companyExpenseRigLabel: document.querySelector("#companyExpenseRigLabel"),
  companyExpenseRig: document.querySelector("#companyExpenseRig"),
  companyExpenseCategory: document.querySelector("#companyExpenseCategory"),
  companyExpenseAmount: document.querySelector("#companyExpenseAmount"),
  companyExpensePaymentMethod: document.querySelector("#companyExpensePaymentMethod"),
  companyExpenseOccurredAt: document.querySelector("#companyExpenseOccurredAt"),
  companyExpenseDescription: document.querySelector("#companyExpenseDescription"),
  companyExpenseProof: document.querySelector("#companyExpenseProof"),
  saveCompanyExpenseButton: document.querySelector("#saveCompanyExpenseButton"),
  companyExpenseList: document.querySelector("#companyExpenseList"),
  noCompanyExpenses: document.querySelector("#noCompanyExpenses"),
  expenseCategoryForm: document.querySelector("#expenseCategoryForm"),
  expenseCategoryName: document.querySelector("#expenseCategoryName"),
  expenseCategoryList: document.querySelector("#expenseCategoryList"),
  tripForm: document.querySelector("#tripForm"),
  tripCustomer: document.querySelector("#tripCustomer"),
  tripRig: document.querySelector("#tripRig"),
  tripNumber: document.querySelector("#tripNumber"),
  tripLoadingDate: document.querySelector("#tripLoadingDate"),
  tripLoadingAddress: document.querySelector("#tripLoadingAddress"),
  tripUnloadingAddress: document.querySelector("#tripUnloadingAddress"),
  tripUnloadingApproximate: document.querySelector("#tripUnloadingApproximate"),
  tripAdditionalStops: document.querySelector("#tripAdditionalStops"),
  tripRate: document.querySelector("#tripRate"),
  tripVatMode: document.querySelector("#tripVatMode"),
  tripPaymentMethod: document.querySelector("#tripPaymentMethod"),
  tripPaymentTerm: document.querySelector("#tripPaymentTerm"),
  tripSalaryRateOverride: document.querySelector("#tripSalaryRateOverride"),
  tripDailyRateOverride: document.querySelector("#tripDailyRateOverride"),
  tripCargo: document.querySelector("#tripCargo"),
  tripInstructions: document.querySelector("#tripInstructions"),
  tripContract: document.querySelector("#tripContract"),
  createTripButton: document.querySelector("#createTripButton"),
  cancelNewTripButton: document.querySelector("#cancelNewTripButton"),
  tripPrerequisiteHint: document.querySelector("#tripPrerequisiteHint"),
  officeUserForm: document.querySelector("#officeUserForm"),
  accountList: document.querySelector("#accountList"),
  driverForm: document.querySelector("#driverForm"),
  tractorForm: document.querySelector("#tractorForm"),
  trailerForm: document.querySelector("#trailerForm"),
  rigForm: document.querySelector("#rigForm"),
  rigTractor: document.querySelector("#rigTractor"),
  rigTrailer: document.querySelector("#rigTrailer"),
  rigDriver: document.querySelector("#rigDriver"),
  rigList: document.querySelector("#rigList"),
  recurringCostForm: document.querySelector("#recurringCostForm"),
  recurringCostRig: document.querySelector("#recurringCostRig"),
  recurringCostCategory: document.querySelector("#recurringCostCategory"),
  recurringCostAmount: document.querySelector("#recurringCostAmount"),
  recurringCostMode: document.querySelector("#recurringCostMode"),
  recurringCostMonthsLabel: document.querySelector("#recurringCostMonthsLabel"),
  recurringCostMonths: document.querySelector("#recurringCostMonths"),
  recurringCostFrom: document.querySelector("#recurringCostFrom"),
  recurringCostTo: document.querySelector("#recurringCostTo"),
  recurringCostComment: document.querySelector("#recurringCostComment"),
  recurringCostList: document.querySelector("#recurringCostList"),
  noRecurringCosts: document.querySelector("#noRecurringCosts"),
  rigCompositionForm: document.querySelector("#rigCompositionForm"),
  compositionRig: document.querySelector("#compositionRig"),
  compositionTractor: document.querySelector("#compositionTractor"),
  compositionTrailer: document.querySelector("#compositionTrailer"),
  compositionDriver: document.querySelector("#compositionDriver"),
  customerForm: document.querySelector("#customerForm"),
  contactForm: document.querySelector("#contactForm"),
  contactCustomer: document.querySelector("#contactCustomer"),
  debtorsOnly: document.querySelector("#debtorsOnly"),
  customerList: document.querySelector("#customerList"),
  noCustomers: document.querySelector("#noCustomers"),
  companyCompensationForm: document.querySelector("#companyCompensationForm"),
  companySalaryRate: document.querySelector("#companySalaryRate"),
  companyDailyRate: document.querySelector("#companyDailyRate"),
  companyRateReason: document.querySelector("#companyRateReason"),
  driverCompensationForm: document.querySelector("#driverCompensationForm"),
  compensationDriver: document.querySelector("#compensationDriver"),
  driverSalaryRate: document.querySelector("#driverSalaryRate"),
  driverDailyRate: document.querySelector("#driverDailyRate"),
  driverRateHint: document.querySelector("#driverRateHint"),
  driverRateReason: document.querySelector("#driverRateReason"),
  driverTransferForm: document.querySelector("#driverTransferForm"),
  transferDriver: document.querySelector("#transferDriver"),
  transferDirection: document.querySelector("#transferDirection"),
  driverTransferMethod: document.querySelector("#driverTransferMethod"),
  driverTransferOccurredAt: document.querySelector("#driverTransferOccurredAt"),
  driverTransferTrip: document.querySelector("#driverTransferTrip"),
  transferSalaryAmount: document.querySelector("#transferSalaryAmount"),
  transferDailyAmount: document.querySelector("#transferDailyAmount"),
  transferDailyThrough: document.querySelector("#transferDailyThrough"),
  transferAdvanceAmount: document.querySelector("#transferAdvanceAmount"),
  transferReimbursementLabel: document.querySelector("#transferReimbursementLabel"),
  transferReimbursementAmount: document.querySelector("#transferReimbursementAmount"),
  driverTransferTotal: document.querySelector("#driverTransferTotal"),
  driverTransferComment: document.querySelector("#driverTransferComment"),
  driverTransferProof: document.querySelector("#driverTransferProof"),
  saveDriverTransferButton: document.querySelector("#saveDriverTransferButton"),
  driverAdjustmentForm: document.querySelector("#driverAdjustmentForm"),
  adjustmentDriver: document.querySelector("#adjustmentDriver"),
  driverAdjustmentCategory: document.querySelector("#driverAdjustmentCategory"),
  driverAdjustmentAmount: document.querySelector("#driverAdjustmentAmount"),
  driverAdjustmentTrip: document.querySelector("#driverAdjustmentTrip"),
  driverAdjustmentComment: document.querySelector("#driverAdjustmentComment"),
  driverSettlementList: document.querySelector("#driverSettlementList"),
  noDriverSettlements: document.querySelector("#noDriverSettlements"),
  driverTransferList: document.querySelector("#driverTransferList"),
  noDriverTransfers: document.querySelector("#noDriverTransfers"),
  paymentDialog: document.querySelector("#paymentDialog"),
  paymentForm: document.querySelector("#paymentForm"),
  paymentTripLabel: document.querySelector("#paymentTripLabel"),
  paymentAmount: document.querySelector("#paymentAmount"),
  paymentType: document.querySelector("#paymentType"),
  paymentMethod: document.querySelector("#paymentMethod"),
  paymentReceivedAt: document.querySelector("#paymentReceivedAt"),
  paymentComment: document.querySelector("#paymentComment"),
  paymentProof: document.querySelector("#paymentProof"),
  paymentCancelButton: document.querySelector("#paymentCancelButton"),
  paymentSubmitButton: document.querySelector("#paymentSubmitButton"),
  actionDialog: document.querySelector("#officeActionDialog"),
  actionForm: document.querySelector("#officeActionForm"),
  actionEyebrow: document.querySelector("#officeActionDialogEyebrow"),
  actionTitle: document.querySelector("#officeActionDialogTitle"),
  actionDescription: document.querySelector("#officeActionDialogDescription"),
  actionFields: document.querySelector("#officeActionDialogFields"),
  actionError: document.querySelector("#officeActionDialogError"),
  actionCancel: document.querySelector("#officeActionDialogCancel"),
  actionSubmit: document.querySelector("#officeActionDialogSubmit"),
  toast: document.querySelector("#toast")
};

let state = {
  user: null,
  organization: null,
  officeUsers: [], drivers: [], tractors: [], trailers: [], rigs: [], customers: [], contacts: [],
  recurringCosts: [], companyExpenses: [], expenseCategories: [], trips: [], expenses: [],
  compensationSettings: null, driverCompensationSettings: [], driverSettlements: [],
  driverTransfers: [], driverAccruals: [], notifications: []
};

let paymentTrip = null;
let report = null;
let refreshing = false;
let selectedTripId = null;
let currentOfficeRoute = "overview";
let actionDialogResolver = null;

const COMPLETED_TRIP_STATUSES = new Set(["pending_review", "needs_explanation", "confirmed", "closed"]);

init();

async function init() {
  const user = await currentUser("office");
  if (!user) return;
  state.user = user;
  organizeOfficeInformationArchitecture();
  bindEvents();
  els.currentDate.textContent = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long"
  }).format(new Date());
  updateRecurringCostMode();
  els.tripLoadingDate.value = localDateValue(new Date());
  els.driverTransferOccurredAt.value = localDateTimeValue(new Date());
  els.companyExpenseOccurredAt.value = localDateTimeValue(new Date());
  setReportDefaults();
  els.recurringCostFrom.value = localMonthValue(new Date());
  await refresh();
  applyOfficeRoute({ scroll: false, replaceInvalid: true });
  await loadReport();
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

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const nextState = await api("/api/office/bootstrap");
    const drafts = captureDirtyFormDrafts();
    state = { ...state, ...nextState };
    els.officeName.textContent = state.organization?.name || state.user.fullName;
    render();
    restoreDirtyFormDrafts(drafts);
    if (report) await loadReport();
  } catch (error) {
    showToast(els.toast, error.message, true);
  } finally {
    refreshing = false;
  }
}

async function refreshWhenVisible() {
  if (document.visibilityState === "visible" && navigator.onLine) await refresh();
}

function render() {
  renderOfficeNotifications();
  fillSelects();
  renderSummary();
  renderOverview();
  renderTrips();
  renderPendingExpenses();
  renderRigs();
  renderAccounts();
  renderRecurringCosts();
  renderCompanyExpenses();
  renderExpenseCategories();
  renderCustomers();
  renderDriverSettlements();
  renderDriverTransfers();
  renderReport();
  updateTripAvailability();
}

function renderOfficeNotifications() {
  const unread = (state.notifications || []).filter((notification) => !notification.read_at);
  els.notificationSection.hidden = unread.length === 0;
  els.notificationCount.textContent = `${unread.length} ${pluralize(unread.length, "новое", "новых", "новых")}`;
  els.notificationList.innerHTML = "";
  unread.slice(0, 20).forEach((notification) => {
    const card = document.createElement("article");
    card.className = "notification-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(notification.title)}</strong>
        <span>${escapeHtml(formatDateTime(notification.created_at))}</span>
      </div>
      <p>${escapeHtml(notification.message)}</p>
      <button type="button" data-read-notification>Понятно</button>
    `;
    card.querySelector("[data-read-notification]")?.addEventListener("click", async () => {
      try {
        const result = await api(`/api/office/notifications/${notification.id}/read`, { method: "POST" });
        const index = state.notifications.findIndex((item) => item.id === notification.id);
        if (index >= 0) state.notifications[index] = result.notification;
        renderOfficeNotifications();
      } catch (error) {
        showToast(els.toast, error.message, true);
      }
    });
    els.notificationList.append(card);
  });
}

function renderAccounts() {
  const accounts = [
    ...state.officeUsers.map((item) => ({ ...item, roleLabel: "Офис" })),
    ...state.drivers.map((item) => ({ ...item, roleLabel: "Водитель" }))
  ];
  els.accountList.innerHTML = "";
  accounts.forEach((account) => {
    const active = Boolean(account.is_active);
    const card = document.createElement("article");
    card.className = `compact-info-card${active ? "" : " reversed-entry"}`;
    card.innerHTML = `
      <div class="trip-card-heading">
        <div><strong>${escapeHtml(account.full_name)}</strong><span>${escapeHtml(account.roleLabel)} · ${escapeHtml(account.login)}</span></div>
        <span class="status-badge" data-status="${active ? "confirmed" : "rejected"}">${active ? "Активна" : "Отключена"}</span>
      </div>
      <span>${escapeHtml(account.phone || "Телефон не указан")}</span>
      <div class="card-actions portal-card-actions">
        <button type="button" data-reset-password>Сменить пароль</button>
        ${account.id === state.user.id ? "" : `<button type="button" data-toggle-account>${active ? "Отключить доступ" : "Включить доступ"}</button>`}
      </div>
    `;
    card.querySelector("[data-reset-password]")?.addEventListener("click", () => resetAccountPassword(account));
    card.querySelector("[data-toggle-account]")?.addEventListener("click", () => toggleAccount(account, !active));
    els.accountList.append(card);
  });
}

async function resetAccountPassword(account) {
  const values = await requestOfficeAction({
    eyebrow: "Доступ к системе",
    title: "Сменить пароль",
    description: `${account.full_name}. После сохранения прежние сессии пользователя завершатся.`,
    confirmLabel: "Сменить пароль",
    fields: [{
      name: "password",
      label: "Новый пароль",
      type: "password",
      minLength: 10,
      autocomplete: "new-password",
      required: true,
      hint: "Не менее 10 символов."
    }]
  });
  if (!values) return;
  try {
    const result = await api(`/api/office/users/${encodeURIComponent(account.id)}/password`, {
      method: "POST",
      body: { password: values.password, reason: "Смена пароля через кабинет офиса" }
    });
    if (result.signedOut) {
      location.replace("/login.html");
      return;
    }
    showToast(els.toast, "Пароль изменён, прежние сессии завершены");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

async function toggleAccount(account, active) {
  const values = await requestOfficeAction({
    eyebrow: "Учётная запись",
    title: active ? "Включить доступ?" : "Отключить доступ?",
    description: active
      ? `${account.full_name} снова сможет входить в систему.`
      : `${account.full_name} будет немедленно выведен из системы на всех устройствах.`,
    confirmLabel: active ? "Включить доступ" : "Отключить доступ",
    destructive: !active,
    fields: active ? [] : [{
      name: "reason",
      label: "Причина отключения",
      type: "textarea",
      required: true,
      maxLength: 1000
    }]
  });
  if (!values) return;
  const reason = active ? "Повторное включение через кабинет офиса" : values.reason;
  try {
    await api(`/api/office/users/${encodeURIComponent(account.id)}/active`, {
      method: "POST",
      body: { active, reason }
    });
    await refresh();
    showToast(els.toast, active ? "Доступ включён" : "Доступ отключён на всех устройствах");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

function renderSummary() {
  const completedTrips = state.trips.filter(isCompletedTrip);
  const revenue = sum(completedTrips, "final_rate_kopecks");
  const expenses = completedTrips.reduce((total, trip) => total + resultExpenses(trip)
    + Number(["confirmed", "closed"].includes(trip.status)
      ? trip.driver_compensation_kopecks
      : trip.estimated_driver_compensation_kopecks || 0), 0);
  const companyExpenses = state.companyExpenses
    .filter((expense) => !expense.reversed_at)
    .reduce((total, expense) => total + Number(expense.amount_kopecks || 0), 0);
  const result = revenue - expenses;
  const receivable = sum(completedTrips, "receivable_kopecks");
  const pendingExpenses = state.expenses.filter((expense) => !["confirmed", "rejected"].includes(expense.status));
  const pendingExpenseTotal = pendingExpenses.reduce((total, expense) => total + Number(expense.amount_kopecks || 0), 0);
  const activeTrips = state.trips.filter((trip) => ["assigned", "awaiting_loading", "in_progress"].includes(trip.status));
  els.totalResult.textContent = formatRubles(result);
  els.totalReceivable.textContent = receivableText(receivable);
  els.pendingExpenseTotal.textContent = formatRubles(pendingExpenseTotal);
  els.activeTripCount.textContent = String(activeTrips.length);
  els.totalResultNote.textContent = `${completedTrips.length} ${pluralize(completedTrips.length, "завершённый рейс", "завершённых рейса", "завершённых рейсов")} · без общих расходов`;
  els.totalReceivableNote.textContent = receivable > 0 ? "Ожидаем оплату от заказчиков" : "Просроченной оплаты нет";
  els.pendingExpenseNote.textContent = pendingExpenses.length
    ? `${pendingExpenses.length} ${pluralize(pendingExpenses.length, "документ", "документа", "документов")}`
    : "Нет новых документов";
  els.activeTripNote.textContent = activeTrips.length
    ? `${activeTrips.filter((trip) => trip.status === "in_progress").length} в пути`
    : "Нет машин в пути";
  els.totalResult.classList.toggle("negative-value", result < 0);
  els.totalReceivable.classList.toggle("negative-value", receivable > 0);
  els.pendingExpenseTotal.classList.toggle("negative-value", pendingExpenses.length > 0);
}

function renderOverview() {
  const activeTrips = state.trips
    .filter((trip) => ["assigned", "awaiting_loading", "in_progress"].includes(trip.status))
    .slice(0, 4);
  els.overviewTripList.innerHTML = "";
  els.noOverviewTrips.classList.toggle("visible", activeTrips.length === 0);
  activeTrips.forEach((trip) => {
    const row = document.createElement("article");
    row.className = "overview-trip-row";
    row.innerHTML = `
      <div class="overview-trip-number">
        <strong>${escapeHtml(trip.number || "Рейс")}</strong>
        <span>${escapeHtml(trip.customer_name || "Заказчик не указан")}</span>
      </div>
      <div class="overview-trip-route">
        <strong>${escapeHtml(tripRouteText(trip))}</strong>
      </div>
      <div class="overview-trip-driver">
        <strong>${escapeHtml(trip.driver_name || "Водитель не назначен")}</strong>
        <span>${escapeHtml(trip.tractor_label || trip.rig_name || "Транспорт не указан")}</span>
      </div>
      <div class="overview-trip-status">
        <span class="status-badge" data-status="${escapeHtml(trip.status)}">${escapeHtml(statusLabel(trip.status))}</span>
        <small>${escapeHtml(formatDate(trip.planned_loading_date))}</small>
      </div>
      <div class="overview-trip-finance">
        <span>Ставка: ${escapeHtml(formatRubles(trip.final_rate_kopecks || 0))}</span>
        <strong>${isCompletedTrip(trip) ? escapeHtml(formatRubles(trip.confirmed_result_kopecks || 0)) : "Расчёт после рейса"}</strong>
      </div>
      <button class="row-open-action" type="button" data-open-trip>Открыть</button>
    `;
    row.querySelector("[data-open-trip]")?.addEventListener("click", () => {
      els.tripStatusFilter.value = "";
      navigateOffice(`trips/${trip.id}`);
    });
    els.overviewTripList.append(row);
  });

  const pendingExpenses = state.expenses.filter((expense) => !["confirmed", "rejected"].includes(expense.status));
  const unreadNotifications = (state.notifications || []).filter((notification) => !notification.read_at);
  const receivableTrips = state.trips.filter((trip) => isCompletedTrip(trip) && Number(trip.receivable_kopecks || 0) > 0);
  const attentionItems = [
    {
      title: expectedPaymentText(receivableTrips.length),
      note: `Сумма долга: ${formatRubles(sum(receivableTrips, "receivable_kopecks"))}`,
      action: "Проверить",
      target: "customers"
    },
    {
      title: `${pendingExpenses.length} ${pluralize(pendingExpenses.length, "расход на проверке", "расхода на проверке", "расходов на проверке")}`,
      note: `На сумму: ${formatRubles(pendingExpenses.reduce((total, expense) => total + Number(expense.amount_kopecks || 0), 0))}`,
      action: "Открыть",
      target: "dashboard"
    },
    {
      title: unreadNotifications.length
        ? `${unreadNotifications.length} ${pluralize(unreadNotifications.length, "новое событие", "новых события", "новых событий")} от водителей`
        : "Новых событий от водителей нет",
      note: unreadNotifications.length ? "Принятие рейсов, расходы и завершения" : "Все сообщения просмотрены",
      action: unreadNotifications.length ? "Посмотреть" : "",
      target: "overview"
    }
  ];
  els.overviewAttentionList.innerHTML = attentionItems.map((item) => `
    <article class="attention-item">
      <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.note)}</span></div>
      ${item.action ? `<button type="button" data-attention-target="${escapeHtml(item.target)}">${escapeHtml(item.action)}</button>` : ""}
    </article>
  `).join("");
  els.overviewAttentionList.querySelectorAll("[data-attention-target]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.attentionTarget));
  });
}

function renderTrips() {
  const filter = els.tripStatusFilter.value;
  const trips = state.trips.filter((trip) => !filter || trip.status === filter);
  const detailTrip = selectedTripId ? state.trips.find((trip) => trip.id === selectedTripId) : null;
  const tripsPanel = document.querySelector("[data-office-panel='dashboard']");
  tripsPanel?.classList.toggle("trip-detail-open", Boolean(detailTrip));
  els.tripDetail.hidden = !detailTrip;
  els.tripList.hidden = Boolean(detailTrip);
  els.pendingExpenseQueue.hidden = Boolean(detailTrip);
  els.tripList.innerHTML = "";
  els.noTrips.classList.toggle("visible", !detailTrip && trips.length === 0);
  els.noTrips.hidden = Boolean(detailTrip);
  if (detailTrip) {
    renderTripDetail(detailTrip);
    return;
  }

  trips.forEach((trip) => {
    const card = document.createElement("article");
    card.className = "trip-list-card";
    card.innerHTML = `
      <div class="trip-list-main">
        <div class="trip-list-number">
          <span>${escapeHtml(trip.number ? `Рейс ${trip.number}` : "Рейс без номера")}</span>
          <strong>${escapeHtml(trip.customer_name || "Заказчик не указан")}</strong>
        </div>
        <div class="trip-list-route">
          <strong>${escapeHtml(tripRouteText(trip))}</strong>
          <span>${escapeHtml(formatDate(trip.planned_loading_date))}</span>
        </div>
        <div class="trip-list-assignee">
          <strong>${escapeHtml(trip.driver_name || "Водитель не назначен")}</strong>
          <span>${escapeHtml(trip.rig_name || "Сцепка не указана")}</span>
        </div>
        <div class="trip-list-status">
          <span class="status-badge" data-status="${escapeHtml(trip.status)}">${escapeHtml(statusLabel(trip.status))}</span>
          <span>${isCompletedTrip(trip) ? escapeHtml(receivableText(Number(trip.receivable_kopecks || 0))) : "Рейс ещё не завершён"}</span>
        </div>
      </div>
      <button class="row-open-action" type="button" data-open-trip="${escapeHtml(trip.id)}" aria-label="Открыть рейс ${escapeHtml(trip.number || tripRouteText(trip))}">Открыть</button>
    `;
    card.querySelector("[data-open-trip]")?.addEventListener("click", () => navigateOffice(`trips/${trip.id}`));
    els.tripList.append(card);
  });
}

function renderTripDetail(trip) {
  const completed = isCompletedTrip(trip);
  const confirmed = ["confirmed", "closed"].includes(trip.status);
  const expenses = resultExpenses(trip);
  const result = completed
    ? (confirmed
      ? Number(trip.confirmed_result_kopecks ?? (Number(trip.final_rate_kopecks || 0) - expenses))
      : Number(trip.final_rate_kopecks || 0) - expenses - Number(trip.estimated_driver_compensation_kopecks || 0))
    : null;
  const unresolvedExpenses = state.expenses.filter((expense) => expense.trip_id === trip.id && !["confirmed", "rejected"].includes(expense.status));
  const mayConfirm = trip.status === "pending_review" && unresolvedExpenses.length === 0;
  const distance = trip.start_odometer_km != null && trip.end_odometer_km != null
    ? `${trip.end_odometer_km - trip.start_odometer_km} км`
    : "—";
  const documentCount = Number(trip.document_count || 0);
  const card = document.createElement("article");
  card.className = "trip-office-card trip-detail-card";
  card.innerHTML = `
    <div class="trip-card-heading">
      <div>
        <p class="section-kicker">${escapeHtml(trip.number ? `Рейс ${trip.number}` : "Рейс")}</p>
        <h3>${escapeHtml(tripRouteText(trip))}</h3>
        <p>${escapeHtml(trip.customer_name)} · ${escapeHtml(trip.rig_name)} · ${escapeHtml(trip.driver_name)}</p>
      </div>
      <span class="status-badge" data-status="${escapeHtml(trip.status)}">${escapeHtml(statusLabel(trip.status))}</span>
    </div>
    <section aria-labelledby="tripFinanceTitle">
      <div class="content-section-heading">
        <div><p class="section-kicker">Экономика рейса</p><h4 id="tripFinanceTitle">Финансовый итог</h4></div>
      </div>
      <div class="finance-grid">
        <div><span>Итоговая ставка</span><strong>${escapeHtml(formatRubles(trip.final_rate_kopecks))}</strong></div>
        <div><span>${confirmed ? "Подтверждённые расходы" : "Расходы"}</span><strong>${completed ? escapeHtml(formatRubles(expenses)) : "Учитываются после завершения"}</strong></div>
        <div><span>Начислено водителю</span><strong>${confirmed
          ? escapeHtml(formatRubles(trip.driver_compensation_kopecks || 0))
          : completed
            ? `Предварительно ${escapeHtml(formatRubles(trip.estimated_driver_compensation_kopecks || 0))}`
            : "После завершения рейса"}</strong></div>
        <div><span title="Ставка минус расходы рейса и начисления водителю">${confirmed ? "Валовая прибыль рейса" : "Предварительный результат"}</span><strong class="${result != null && result < 0 ? "negative-value" : ""}">${result == null ? "Не рассчитан" : escapeHtml(formatRubles(result))}</strong></div>
        <div><span>${completed && Number(trip.receivable_kopecks || 0) < 0 ? "Переплата заказчика" : "Долг заказчика"}</span><strong>${completed ? escapeHtml(receivableText(Number(trip.receivable_kopecks || 0))) : "Возникнет после завершения"}</strong></div>
        <div><span>Пробег</span><strong>${escapeHtml(distance)}</strong></div>
        <div><span>Срок оплаты</span><strong>${escapeHtml(paymentDueText(trip))}</strong></div>
      </div>
    </section>
    ${tripExpenseBreakdownMarkup(trip)}
    ${odometerRiskWarningMarkup(trip)}
    <section class="trip-detail-history" aria-label="Документы и история">
      ${tripExpenseHistoryMarkup(trip)}
      ${tripFinancialHistoryMarkup(trip)}
    </section>
    ${trip.status === "pending_review" && unresolvedExpenses.length ? `<p class="form-warning">Сначала проверьте все расходы: осталось ${unresolvedExpenses.length}.</p>` : ""}
    <div class="card-actions portal-card-actions trip-primary-actions">
      ${trip.latest_document_attachment_id ? `<a class="button-link" href="/api/files/${encodeURIComponent(trip.latest_document_attachment_id)}" target="_blank" rel="noopener">Открыть договор${documentCount > 1 ? ` (${documentCount} версий)` : ""}</a>` : ""}
      <input type="file" data-contract-file class="visually-hidden-file" accept="image/*,application/pdf,.doc,.docx" aria-label="Выбрать договор-заявку для рейса">
      <button type="button" data-action="attach-contract">${documentCount ? "Добавить версию договора" : "Прикрепить договор"}</button>
      <button type="button" data-action="payment">Записать оплату</button>
      <button type="button" data-action="adjustment">Доплата или штраф</button>
      ${!["confirmed", "closed"].includes(trip.status) ? '<button type="button" data-action="route">Изменить маршрут</button>' : ""}
      ${["pending_review", "needs_explanation"].includes(trip.status) ? '<button type="button" data-action="measurements">Исправить пробег и время</button>' : ""}
      ${mayConfirm ? '<button class="primary-action" type="button" data-action="confirm">Подтвердить рейс</button>' : ""}
    </div>
  `;
  els.tripDetailContent.replaceChildren(card);
  bindTripDetailActions(card, trip);
}

function bindTripDetailActions(card, trip) {
  const contractInput = card.querySelector("[data-contract-file]");
  const contractButton = card.querySelector('[data-action="attach-contract"]');
  contractButton?.addEventListener("click", () => contractInput?.click());
  contractInput?.addEventListener("change", () => {
    const file = contractInput.files?.[0];
    if (file) attachContract(trip, file, contractButton, contractInput);
  });
  card.querySelector('[data-action="payment"]')?.addEventListener("click", () => addPayment(trip));
  card.querySelector('[data-action="adjustment"]')?.addEventListener("click", () => addAdjustment(trip));
  card.querySelector('[data-action="route"]')?.addEventListener("click", () => editTripRoute(trip));
  card.querySelector('[data-action="measurements"]')?.addEventListener("click", () => correctTripMeasurements(trip));
  card.querySelector('[data-action="confirm"]')?.addEventListener("click", () => confirmTrip(trip));
  card.querySelectorAll("[data-reverse-adjustment]").forEach((button) => {
    const adjustment = trip.adjustments.find((item) => item.id === button.dataset.reverseAdjustment);
    if (adjustment) button.addEventListener("click", () => reverseRateAdjustment(trip, adjustment));
  });
  card.querySelectorAll("[data-reverse-payment]").forEach((button) => {
    const payment = trip.payments.find((item) => item.id === button.dataset.reversePayment);
    if (payment) button.addEventListener("click", () => reverseIncomingPayment(trip, payment));
  });
  card.querySelectorAll("[data-expense-review]").forEach((button) => {
    const expense = state.expenses.find((item) => item.id === button.dataset.expenseId);
    if (expense) button.addEventListener("click", () => reviewExpense(expense, button.dataset.expenseReview));
  });
}

async function editTripRoute(trip) {
  const currentStops = (trip.additional_unloading_stops || []).map((stop) => stop.address).join("\n");
  const values = await requestOfficeAction({
    eyebrow: trip.number ? `Рейс ${trip.number}` : "Рейс",
    title: "Изменить маршрут",
    description: tripRouteText(trip),
    confirmLabel: "Сохранить маршрут",
    fields: [
      {
        name: "unloadingAddress",
        label: "Основной адрес разгрузки",
        value: trip.unloading_address,
        required: true,
        maxLength: 500
      },
      {
        name: "additionalStops",
        label: "Дополнительные точки — по одной в строке",
        type: "textarea",
        value: currentStops,
        maxLength: 3000
      },
      {
        name: "approximate",
        label: "Новый адрес пока приблизительный",
        type: "checkbox",
        value: Boolean(trip.unloading_address_is_approximate)
      },
      {
        name: "reason",
        label: "Причина изменения",
        type: "textarea",
        required: true,
        maxLength: 1000
      }
    ]
  });
  if (!values) return;
  try {
    await api(`/api/office/trips/${encodeURIComponent(trip.id)}/route`, {
      method: "POST",
      body: {
        unloadingAddress: values.unloadingAddress.trim(),
        unloadingAddressIsApproximate: values.approximate,
        additionalUnloadingStops: values.additionalStops.split(/\r?\n/).map((address) => address.trim()).filter(Boolean),
        driverInstructions: trip.driver_instructions || "",
        reason: values.reason.trim()
      }
    });
    await refresh();
    showToast(els.toast, "Маршрут обновлён, водитель получил уведомление");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

async function correctTripMeasurements(trip) {
  const values = await requestOfficeAction({
    eyebrow: trip.number ? `Рейс ${trip.number}` : "Рейс",
    title: "Исправить пробег и время",
    description: "Исходные значения сохранятся в истории изменений.",
    confirmLabel: "Сохранить исправление",
    fields: [
      { name: "startOdometer", label: "Начальный пробег, км", type: "number", min: 0, step: 1, value: trip.start_odometer_km ?? "", required: true },
      { name: "endOdometer", label: "Конечный пробег, км", type: "number", min: 0, step: 1, value: trip.end_odometer_km ?? "", required: true },
      { name: "loadedAt", label: "Дата и время загрузки", type: "datetime-local", value: isoToLocalDateTimeValue(trip.loaded_at), required: true },
      { name: "unloadedAt", label: "Дата и время разгрузки", type: "datetime-local", value: isoToLocalDateTimeValue(trip.unloaded_at), required: true },
      { name: "reason", label: "Причина исправления", type: "textarea", required: true, maxLength: 1000 }
    ]
  });
  if (!values) return;
  const loadedAt = new Date(values.loadedAt);
  const unloadedAt = new Date(values.unloadedAt);
  if (Number.isNaN(loadedAt.getTime()) || Number.isNaN(unloadedAt.getTime())) {
    showToast(els.toast, "Проверьте дату и время", true);
    return;
  }
  try {
    await api(`/api/office/trips/${encodeURIComponent(trip.id)}/measurements`, {
      method: "POST",
      body: {
        startOdometerKm: Number(values.startOdometer),
        endOdometerKm: Number(values.endOdometer),
        loadedAt: loadedAt.toISOString(),
        unloadedAt: unloadedAt.toISOString(),
        reason: values.reason.trim()
      }
    });
    await refresh();
    showToast(els.toast, "Пробег и время исправлены с записью в историю");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

function tripExpenseHistoryMarkup(trip) {
  const expenses = state.expenses.filter((expense) => expense.trip_id === trip.id);
  if (!expenses.length) return "";
  return `
    <details class="trip-financial-history">
      <summary>Журнал чеков (${expenses.length})</summary>
      <div class="trip-event-list">
        ${expenses.map((expense) => `
          <div class="trip-financial-event">
            <div><strong>${escapeHtml(expense.category)}</strong><span>${escapeHtml(formatDateTime(expense.occurred_at || expense.created_at))}</span></div>
            <strong>${escapeHtml(formatRubles(expense.amount_kopecks))}</strong>
            <p>${escapeHtml(`${expensePaymentSourceLabel(expense.payment_source)} · ${expensePaymentMethodLabel(expense.payment_method)}${expense.location_text ? ` · ${expense.location_text}` : ""}`)}</p>
            <p>${escapeHtml([expense.supplier, expense.description].filter(Boolean).join(" · "))}</p>
            <span class="status-badge" data-status="${escapeHtml(expense.status)}">${escapeHtml(expenseStatusLabel(expense.status))}</span>
            ${expenseReviewTimelineMarkup(expense)}
            <div class="card-actions portal-card-actions">
              <a class="button-link" href="/api/files/${encodeURIComponent(expense.receipt_attachment_id)}" target="_blank" rel="noopener">Открыть чек</a>
              ${expense.status !== "confirmed" ? `<button type="button" data-expense-id="${escapeHtml(expense.id)}" data-expense-review="confirmed">Подтвердить</button>` : ""}
              ${expense.status !== "needs_explanation" ? `<button type="button" data-expense-id="${escapeHtml(expense.id)}" data-expense-review="needs_explanation">Запросить пояснение</button>` : ""}
              ${expense.status !== "rejected" ? `<button type="button" data-expense-id="${escapeHtml(expense.id)}" data-expense-review="rejected">Отклонить</button>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function tripExpenseBreakdownMarkup(trip) {
  const confirmed = ["confirmed", "closed"].includes(trip.status);
  const expenses = state.expenses.filter((expense) => expense.trip_id === trip.id
    && (confirmed ? expense.status === "confirmed" : expense.status !== "rejected"));
  if (!expenses.length) return "";
  const byCategory = new Map();
  expenses.forEach((expense) => byCategory.set(
    expense.category,
    (byCategory.get(expense.category) || 0) + Number(expense.amount_kopecks || 0)
  ));
  const unresolved = expenses.filter((expense) => !["confirmed", "rejected"].includes(expense.status)).length;
  return `
    <div class="trip-expense-breakdown">
      <strong>Расходы по категориям</strong>
      <div class="tag-row">
        ${[...byCategory.entries()].map(([category, amount]) => `<span class="tag">${escapeHtml(category)} · ${escapeHtml(formatRubles(amount))}</span>`).join("")}
      </div>
      ${unresolved ? `<span class="field-hint">Не проверено операций: ${unresolved}</span>` : ""}
    </div>
  `;
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
      const label = `${isDriverAnswer ? "Ответ водителя" : "Решение офиса"}${actor}${status}${occurredAt}`;
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

function odometerRiskWarningMarkup(trip) {
  const flags = [
    ...parseRiskFlags(trip.start_odometer_risk_flags_json),
    ...parseRiskFlags(trip.end_odometer_risk_flags_json)
  ];
  if (!flags.length) return "";
  return `<p class="form-warning">Проверить пробег: ${flags.map(odometerRiskLabel).map(escapeHtml).join("; ")}.</p>`;
}

function parseRiskFlags(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function odometerRiskLabel(flag) {
  return {
    odometer_below_previous_end: `начальный пробег ниже предыдущего (${flag.previousValueKm} км)`,
    odometer_gap: `разрыв с предыдущим показанием ${flag.gapKm} км`,
    capture_time_in_future: "дата снимка указана в будущем",
    loaded_far_before_assignment: "загрузка намного раньше назначения рейса",
    zero_trip_distance: "нулевой пробег рейса",
    unusually_large_trip_distance: `необычно большой пробег ${flag.distanceKm} км`,
    impossible_average_speed: flag.averageSpeedKmh == null
      ? "пробег указан без продолжительности рейса"
      : `расчётная средняя скорость ${flag.averageSpeedKmh} км/ч`,
    office_corrected: "данные исправлены офисом, исходные значения сохранены в аудите"
  }[flag.code] || flag.code;
}

function tripFinancialHistoryMarkup(trip) {
  const entries = [
    ...(trip.adjustments || []).map((item) => ({
      ...item,
      entryKind: "adjustment",
      entryLabel: adjustmentTypeLabel(item.adjustment_type),
      entryAmount: item.amount_kopecks,
      entryDate: item.created_at,
      entryComment: item.reason
    })),
    ...(trip.payments || []).map((item) => ({
      ...item,
      entryKind: "payment",
      entryLabel: "Оплата заказчика",
      entryAmount: item.allocated_kopecks,
      entryDate: item.received_at,
      entryComment: item.comment
    }))
  ].sort((left, right) => String(right.entryDate).localeCompare(String(left.entryDate)));
  if (!entries.length) return "";
  return `
    <details class="trip-financial-history">
      <summary>История ставки и оплат (${entries.length})</summary>
      <div class="trip-event-list">
        ${entries.map((entry) => `
          <div class="trip-financial-event${entry.reversed_at ? " reversed-record" : ""}">
            <div><strong>${escapeHtml(entry.entryLabel)}</strong><span>${escapeHtml(formatDateTime(entry.entryDate))}</span></div>
            <strong>${escapeHtml(formatRubles(entry.entryAmount))}</strong>
            ${entry.entryComment ? `<p>${escapeHtml(entry.entryComment)}</p>` : ""}
            ${entry.attachment_id ? `<a class="button-link" href="/api/files/${encodeURIComponent(entry.attachment_id)}" target="_blank" rel="noopener">Открыть подтверждение</a>` : ""}
            ${entry.reversed_at
              ? `<p class="correction-note">Отменено: ${escapeHtml(entry.reversal_reason || "причина не указана")}</p>`
              : entry.entryKind === "adjustment"
                ? `<button type="button" data-reverse-adjustment="${escapeHtml(entry.id)}">Отменить корректировку</button>`
                : `<button type="button" data-reverse-payment="${escapeHtml(entry.id)}">Отменить оплату</button>`}
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderPendingExpenses() {
  const expenses = state.expenses.filter((expense) => ["pending_review", "needs_explanation", "suspicious"].includes(expense.status));
  els.pendingExpenseList.innerHTML = "";
  els.noPendingExpenses.classList.toggle("visible", expenses.length === 0);
  expenses.forEach((expense) => {
    const trip = state.trips.find((item) => item.id === expense.trip_id);
    const riskFlags = parseRiskFlags(expense.risk_flags_json);
    const card = document.createElement("article");
    card.className = "expense-card";
    card.innerHTML = `
      <div class="expense-card-main">
        <div class="expense-title"><strong>${escapeHtml(expense.category)}</strong><span>${escapeHtml(expense.driver_name)} · ${escapeHtml(formatDateTime(expense.occurred_at || expense.created_at))}</span></div>
        <div class="expense-amount">${escapeHtml(formatRubles(expense.amount_kopecks))}</div>
      </div>
      <p class="meta-line">${escapeHtml(trip ? `${tripRouteText(trip)} · ${trip.rig_name}` : `Рейс ${expense.trip_number || ""}`)}</p>
      <p class="meta-line">${escapeHtml(`${expensePaymentSourceLabel(expense.payment_source)} · ${expensePaymentMethodLabel(expense.payment_method)}${expense.location_text ? ` · ${expense.location_text}` : ""}`)}</p>
      <p class="meta-line">${escapeHtml([expense.supplier, expense.description].filter(Boolean).join(" · "))}</p>
      ${riskFlags.length ? `<p class="form-warning">Автопроверка: ${riskFlags.map(expenseRiskLabel).map(escapeHtml).join("; ")}.</p>` : ""}
      ${expenseReviewTimelineMarkup(expense)}
      <div class="card-actions portal-card-actions">
        <a class="button-link" href="/api/files/${encodeURIComponent(expense.receipt_attachment_id)}" target="_blank" rel="noopener">Открыть чек</a>
        <button type="button" data-review="confirmed">Подтвердить</button>
        <button type="button" data-review="needs_explanation">Запросить пояснение</button>
        <button type="button" data-review="rejected">Отклонить</button>
      </div>
    `;
    card.querySelectorAll("[data-review]").forEach((button) => button.addEventListener("click", () => reviewExpense(expense, button.dataset.review)));
    els.pendingExpenseList.append(card);
  });
}

function expenseRiskLabel(flag) {
  return {
    duplicate_receipt: "фотография чека уже использовалась",
    expense_time_in_future: "дата расхода указана в будущем",
    expense_before_trip_start: "расход указан до начала рейса"
  }[flag.code] || flag.code;
}

function renderRigs() {
  els.rigList.innerHTML = "";
  state.rigs.forEach((rig) => {
    const card = document.createElement("article");
    card.className = "compact-info-card";
    card.innerHTML = `
      <strong>${escapeHtml(rig.name)}</strong>
      <span>${escapeHtml(rig.tractor_label || "Тягач не выбран")}</span>
      <span>${escapeHtml(rig.trailer_label || "Трал не выбран")}</span>
      <span>${escapeHtml(rig.driver_name || "Водитель не назначен")}</span>
    `;
    els.rigList.append(card);
  });
}

function renderRecurringCosts() {
  els.recurringCostList.innerHTML = "";
  els.noRecurringCosts.classList.toggle("visible", state.recurringCosts.length === 0);
  state.recurringCosts.forEach((cost) => {
    const card = document.createElement("article");
    card.className = `compact-info-card recurring-cost-card${cost.reversed_at ? " reversed-record" : ""}`;
    const allocation = cost.allocation_mode === "monthly"
      ? `${formatRubles(cost.total_amount_kopecks)} каждый месяц`
      : `${formatRubles(cost.total_amount_kopecks)} / ${cost.allocation_months} мес.`;
    const period = `${formatDate(cost.valid_from)}${cost.valid_to ? ` — ${formatDate(cost.valid_to)}` : " — бессрочно"}`;
    card.innerHTML = `
      <strong>${escapeHtml(cost.category)}</strong>
      <span>${escapeHtml(cost.subject_name)}</span>
      <span>${escapeHtml(allocation)}</span>
      <span>${escapeHtml(period)}${cost.reversed_at ? `<br><span class="correction-note">Отменён: ${escapeHtml(cost.reversal_reason || "причина не указана")}</span>` : ""}</span>
      ${cost.reversed_at ? "" : '<button type="button" data-reverse-recurring-cost>Отменить</button>'}
    `;
    card.querySelector("[data-reverse-recurring-cost]")?.addEventListener("click", () => reverseRecurringCost(cost));
    els.recurringCostList.append(card);
  });
}

function renderCompanyExpenses() {
  els.companyExpenseList.innerHTML = "";
  els.noCompanyExpenses.classList.toggle("visible", state.companyExpenses.length === 0);
  state.companyExpenses.forEach((expense) => {
    const card = document.createElement("article");
    card.className = `compact-info-card company-expense-card${expense.reversed_at ? " reversed-record" : ""}`;
    const scope = expense.scope_type === "rig"
      ? `Сцепка: ${expense.rig_name || "не найдена"}`
      : "Компания в целом";
    card.innerHTML = `
      <div class="expense-card-main">
        <div class="expense-title">
          <strong>${escapeHtml(expense.category)}</strong>
          <span>${escapeHtml(scope)} · ${escapeHtml(formatDateTime(expense.occurred_at))}</span>
        </div>
        <div class="expense-amount">${escapeHtml(formatRubles(expense.amount_kopecks))}</div>
      </div>
      <span>${escapeHtml(expense.description)}</span>
      <span>${escapeHtml(paymentMethodLabel(expense.payment_method))} · записал ${escapeHtml(expense.created_by_name)}</span>
      ${expense.reversed_at ? `<span class="correction-note">Отменён: ${escapeHtml(expense.reversal_reason || "причина не указана")}</span>` : ""}
      <div class="card-actions portal-card-actions">
        ${expense.attachment_id ? `<a class="button-link" href="/api/files/${encodeURIComponent(expense.attachment_id)}" target="_blank" rel="noopener">Открыть документ</a>` : ""}
        ${expense.reversed_at ? "" : '<button type="button" data-reverse-company-expense>Отменить ошибочную запись</button>'}
      </div>
    `;
    card.querySelector("[data-reverse-company-expense]")?.addEventListener("click", () => reverseCompanyExpense(expense));
    els.companyExpenseList.append(card);
  });
}

function renderExpenseCategories() {
  els.expenseCategoryList.innerHTML = "";
  state.expenseCategories.forEach((category) => {
    const item = document.createElement("div");
    item.className = `category-setting${category.is_active ? "" : " category-disabled"}`;
    item.innerHTML = `
      <span>${escapeHtml(category.name)}</span>
      <button type="button">${category.is_active ? "Отключить" : "Включить"}</button>
    `;
    item.querySelector("button").addEventListener("click", () => setExpenseCategoryActive(category));
    els.expenseCategoryList.append(item);
  });
}

function renderReport() {
  if (!report) return;
  const totals = report.totals;
  els.reportRevenue.textContent = formatRubles(totals.revenueKopecks);
  els.reportTripExpenses.textContent = formatRubles(totals.tripExpensesKopecks);
  els.reportDriverCompensation.textContent = formatRubles(totals.driverCompensationKopecks);
  els.reportFixedCosts.textContent = formatRubles(totals.fixedCostsKopecks);
  els.reportOneOffExpenses.textContent = formatRubles(totals.oneOffExpensesKopecks);
  els.reportProfit.textContent = formatRubles(totals.profitKopecks);
  els.reportProfit.classList.toggle("negative-value", totals.profitKopecks < 0);
  els.reportNote.textContent = `${report.period.from} — ${report.period.to} · рейсов: ${totals.tripCount} · пробег: ${totals.distanceKm} км · себестоимость: ${totals.costPerKmKopecks == null ? "—" : `${formatRubles(totals.costPerKmKopecks)}/км`} · получено от заказчиков: ${formatRubles(totals.receivedKopecks)} · ${receivableText(totals.receivableKopecks)}`
    + (totals.unallocatedCompanyExpensesKopecks
      ? ` · общие расходы компании: ${formatRubles(totals.unallocatedCompanyExpensesKopecks)}`
      : "")
    + (totals.preliminaryTripCount ? ` · предварительных рейсов: ${totals.preliminaryTripCount}` : "");
  renderCostBreakdown(report.costBreakdown || {});
  els.reportRigList.innerHTML = "";
  report.rigs.forEach((rig) => {
    const card = document.createElement("article");
    card.className = "trip-office-card report-rig-card";
    card.innerHTML = `
      <div class="trip-card-heading">
        <div><p class="section-kicker">Сцепка</p><h3>${escapeHtml(rig.rigName)}</h3></div>
        <strong class="${rig.profitKopecks < 0 ? "negative-value" : ""}">${escapeHtml(formatRubles(rig.profitKopecks))}</strong>
      </div>
      <div class="finance-grid">
        <div><span>Рейсов</span><strong>${rig.tripCount}</strong></div>
        <div><span>Пробег</span><strong>${rig.distanceKm} км</strong></div>
        <div><span>Выручка</span><strong>${escapeHtml(formatRubles(rig.revenueKopecks))}</strong></div>
        <div><span>Расходы рейсов</span><strong>${escapeHtml(formatRubles(rig.tripExpensesKopecks))}</strong></div>
        <div><span>Начислено водителю</span><strong>${escapeHtml(formatRubles(rig.driverCompensationKopecks))}</strong></div>
        <div><span>Постоянные расходы</span><strong>${escapeHtml(formatRubles(rig.fixedCostsKopecks))}</strong></div>
        <div><span>Разовые расходы</span><strong>${escapeHtml(formatRubles(rig.oneOffExpensesKopecks))}</strong></div>
        <div><span>Себестоимость километра</span><strong>${rig.costPerKmKopecks == null ? "—" : `${escapeHtml(formatRubles(rig.costPerKmKopecks))}/км`}</strong></div>
        <div><span>Выручка на километр</span><strong>${rig.revenuePerKmKopecks == null ? "—" : `${escapeHtml(formatRubles(rig.revenuePerKmKopecks))}/км`}</strong></div>
        <div><span>Получено</span><strong>${escapeHtml(formatRubles(rig.receivedKopecks))}</strong></div>
      </div>
      ${rig.preliminaryTripCount ? `<p class="form-warning">${rig.preliminaryTripCount} рейс(а) ещё ожидают окончательной проверки — итог предварительный.</p>` : ""}
    `;
    els.reportRigList.append(card);
  });
}

function renderCostBreakdown(breakdown) {
  const groups = [
    ["Расходы рейсов", breakdown.tripExpenses || []],
    ["Постоянные расходы", breakdown.fixedCosts || []],
    ["Разовые расходы", breakdown.oneOffExpenses || []]
  ];
  els.reportCostBreakdown.innerHTML = groups.map(([title, rows]) => `
    <section class="cost-breakdown-card">
      <strong>${escapeHtml(title)}</strong>
      ${rows.length
        ? `<div>${rows.map((row) => `<span><span>${escapeHtml(row.category)}</span><strong>${escapeHtml(formatRubles(row.amountKopecks))}</strong></span>`).join("")}</div>`
        : "<p>Нет расходов за период</p>"}
    </section>
  `).join("");
}

async function loadReport() {
  if (!els.reportFrom.value || !els.reportTo.value) return;
  const params = new URLSearchParams({ from: els.reportFrom.value, to: els.reportTo.value });
  if (els.reportRig.value) params.set("rigId", els.reportRig.value);
  try {
    report = await api(`/api/office/report?${params}`);
    renderReport();
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

function renderCustomers() {
  const debtByCustomer = new Map();
  state.trips.filter(isCompletedTrip).forEach((trip) => debtByCustomer.set(trip.customer_id, (debtByCustomer.get(trip.customer_id) || 0) + Number(trip.receivable_kopecks || 0)));
  const customers = state.customers.filter((customer) => !els.debtorsOnly.checked || (debtByCustomer.get(customer.id) || 0) > 0);
  els.customerList.innerHTML = "";
  els.noCustomers.classList.toggle("visible", customers.length === 0);
  const noCustomersMessage = els.noCustomers.querySelector("p");
  const noCustomersAction = els.noCustomers.querySelector("button");
  if (els.debtorsOnly.checked && state.customers.length > 0 && customers.length === 0) {
    noCustomersMessage.textContent = "Сейчас нет заказчиков с задолженностью.";
    noCustomersAction.textContent = "Показать всех заказчиков";
    noCustomersAction.dataset.customerEmptyAction = "show-all";
    delete noCustomersAction.dataset.emptyAction;
  } else {
    noCustomersMessage.textContent = "Заказчиков пока нет. Добавьте заказчика, чтобы создавать рейсы и учитывать оплаты.";
    noCustomersAction.textContent = "Добавить заказчика";
    noCustomersAction.dataset.customerEmptyAction = "add";
    delete noCustomersAction.dataset.emptyAction;
  }
  customers.forEach((customer) => {
    const contacts = contactsForCustomer(customer.id);
    const debt = debtByCustomer.get(customer.id) || 0;
    const debtTrips = state.trips.filter((trip) => trip.customer_id === customer.id
      && isCompletedTrip(trip)
      && Number(trip.receivable_kopecks || 0) > 0);
    const maximumOverdueDays = Math.max(
      0,
      ...state.trips
        .filter((trip) => trip.customer_id === customer.id && Number(trip.receivable_kopecks || 0) > 0)
        .map((trip) => Number(trip.days_overdue || 0))
    );
    const card = document.createElement("article");
    card.className = "customer-card";
    card.innerHTML = `
      <div class="trip-card-heading">
        <div><h3>${escapeHtml(customer.short_name)}</h3><p>${escapeHtml(customer.inn ? `ИНН ${customer.inn}` : "ИНН не указан")}</p></div>
        <strong class="${debt > 0 ? "negative-value" : ""}">${escapeHtml(customerDebtText(debt))}${maximumOverdueDays ? `<br><span class="overdue-note">Просрочка до ${maximumOverdueDays} дн.</span>` : ""}</strong>
      </div>
      <div class="contact-list">
        ${contacts.length ? contacts.map((contact) => `
          <div><strong>${escapeHtml(contact.fullName)}</strong><span>${escapeHtml(contact.position || "Контакт")}</span>${contact.phones.map((phone) => `<a href="tel:${escapeHtml(phone.phone)}">${escapeHtml(phone.phone)}</a>`).join("")}</div>
        `).join("") : "<span>Контакты ещё не добавлены</span>"}
      </div>
      ${debtTrips.length ? `
        <div class="customer-debt-trips" aria-label="Неоплаченные рейсы">
          ${debtTrips.map((trip) => `
            <div class="customer-debt-row">
              <div>
                <strong>${escapeHtml(trip.number || tripRouteText(trip))}</strong>
                <span>${escapeHtml(paymentDueText(trip))}</span>
              </div>
              <strong>${escapeHtml(formatRubles(trip.receivable_kopecks))}</strong>
              <div class="customer-debt-actions">
                <button type="button" data-customer-open-trip="${escapeHtml(trip.id)}">Открыть рейс</button>
                <button type="button" data-customer-payment-trip="${escapeHtml(trip.id)}">Записать оплату</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : '<p class="positive-note">Неоплаченных рейсов нет.</p>'}
    `;
    card.querySelectorAll("[data-customer-open-trip]").forEach((button) => {
      button.addEventListener("click", () => navigateOffice(`trips/${button.dataset.customerOpenTrip}`));
    });
    card.querySelectorAll("[data-customer-payment-trip]").forEach((button) => {
      button.addEventListener("click", () => {
        const trip = state.trips.find((item) => item.id === button.dataset.customerPaymentTrip);
        if (trip) addPayment(trip);
      });
    });
    els.customerList.append(card);
  });
}

function renderDriverSettlements() {
  els.driverSettlementList.innerHTML = "";
  els.noDriverSettlements.classList.toggle("visible", state.driverSettlements.length === 0);
  state.driverSettlements.forEach((settlement) => {
    const card = document.createElement("article");
    card.className = "trip-office-card settlement-card";
    const balance = settlementBalanceText(settlement);
    card.innerHTML = `
      <div class="trip-card-heading">
        <div>
          <p class="section-kicker">Водитель</p>
          <h3>${escapeHtml(settlement.driverName)}</h3>
          <p>${escapeHtml(settlement.phone || "Телефон не указан")}</p>
        </div>
        <strong class="${settlement.netBalanceKopecks === 0 ? "" : "negative-value"}">${escapeHtml(balance)}</strong>
      </div>
      <div class="finance-grid">
        <div><span>Зарплата начислена / выплачена</span><strong>${escapeHtml(formatRubles(settlement.salaryAccruedKopecks))} / ${escapeHtml(formatRubles(settlement.salaryPaidKopecks))}</strong></div>
        <div><span>Остаток зарплаты</span><strong>${escapeHtml(categoryBalanceText(settlement.salaryBalanceKopecks))}</strong></div>
        <div><span>Суточные начислены / выплачены</span><strong>${escapeHtml(formatRubles(settlement.dailyAccruedKopecks))} / ${escapeHtml(formatRubles(settlement.dailyPaidKopecks))}</strong></div>
        <div><span>Остаток суточных</span><strong>${escapeHtml(categoryBalanceText(settlement.dailyBalanceKopecks))}</strong></div>
        <div><span>Аванс выдан / подтверждён</span><strong>${escapeHtml(formatRubles(settlement.advanceIssuedKopecks))} / ${escapeHtml(formatRubles(settlement.advanceSpentKopecks))}</strong></div>
        <div><span>Остаток аванса у водителя</span><strong>${escapeHtml(formatRubles(settlement.advanceBalanceKopecks))}</strong></div>
        <div><span>Личные расходы / компенсировано</span><strong>${escapeHtml(formatRubles(settlement.personalExpensesKopecks))} / ${escapeHtml(formatRubles(settlement.reimbursementPaidKopecks))}</strong></div>
        <div><span>Компенсация к выплате</span><strong>${escapeHtml(categoryBalanceText(settlement.reimbursementBalanceKopecks))}</strong></div>
      </div>
      <p class="meta-line">Суточные начислены по: ${escapeHtml(formatDate(settlement.dailyAccruedThrough))} · оплачены по: ${escapeHtml(formatDate(settlement.dailyPaidThrough))}${settlement.dailyProvisionalAccruedKopecks > 0 ? ` · в начислении предварительно ${escapeHtml(formatRubles(settlement.dailyProvisionalAccruedKopecks))} по незакрытым рейсам` : ""}</p>
      ${settlement.unconfirmedExpensesKopecks > 0 ? `<p class="form-warning">На проверке расходов водителя: ${escapeHtml(formatRubles(settlement.unconfirmedExpensesKopecks))}. Они ещё не вошли в баланс.</p>` : ""}
    `;
    els.driverSettlementList.append(card);
  });
}

function renderDriverTransfers() {
  els.driverTransferList.innerHTML = "";
  els.noDriverTransfers.classList.toggle("visible", state.driverTransfers.length === 0);
  state.driverTransfers.forEach((transfer) => {
    const card = document.createElement("article");
    card.className = `compact-info-card transfer-card ${transfer.reversed_at ? "reversed-entry" : ""}`;
    const allocations = transfer.allocations.map((allocation) => {
      const coverage = allocation.coverage_through ? ` по ${allocation.coverage_through}` : "";
      return `${allocationLabel(allocation.allocation_type)}: ${formatRubles(allocation.amount_kopecks)}${coverage}`;
    }).join(" · ");
    const direction = transfer.direction === "company_to_driver" ? "Компания → водитель" : "Водитель → компания";
    card.innerHTML = `
      <div class="trip-card-heading">
        <div>
          <strong>${escapeHtml(transfer.driver_name)}</strong>
          <span>${escapeHtml(direction)} · ${escapeHtml(formatDateTime(transfer.occurred_at))}</span>
        </div>
        <strong>${escapeHtml(formatRubles(transfer.amount_kopecks))}</strong>
      </div>
      <span>${escapeHtml(allocations)}</span>
      ${transfer.comment ? `<span>${escapeHtml(transfer.comment)}</span>` : ""}
      ${transfer.attachment_id ? `<a class="button-link" href="/api/files/${encodeURIComponent(transfer.attachment_id)}" target="_blank" rel="noopener">Открыть подтверждение</a>` : ""}
      ${transfer.reversed_at ? `<span class="correction-note">Отменён: ${escapeHtml(transfer.reversal_reason || "причина не указана")}</span>` : '<button type="button" data-reverse-transfer>Отменить ошибочную запись</button>'}
    `;
    card.querySelector("[data-reverse-transfer]")?.addEventListener("click", () => reverseTransfer(transfer));
    els.driverTransferList.append(card);
  });
}

function settlementBalanceText(settlement) {
  if (settlement.companyOwesKopecks > 0) return `Компания должна ${formatRubles(settlement.companyOwesKopecks)}`;
  if (settlement.driverOwesKopecks > 0) return `Водитель должен ${formatRubles(settlement.driverOwesKopecks)}`;
  return "Расчёт закрыт";
}

function categoryBalanceText(amountKopecks) {
  const amount = Number(amountKopecks || 0);
  if (amount > 0) return `доплатить ${formatRubles(amount)}`;
  if (amount < 0) return `переплата ${formatRubles(Math.abs(amount))}`;
  return "закрыто";
}

function allocationLabel(type) {
  return {
    salary: "зарплата",
    daily: "суточные",
    expense_advance: "аванс на расходы",
    expense_reimbursement: "компенсация расхода"
  }[type] || type;
}

function fillSelects() {
  const activeDrivers = state.drivers.filter((driver) => driver.is_active);
  fillSelect(els.tripCustomer, state.customers, (item) => item.short_name, "Сначала добавьте заказчика");
  fillSelect(els.contactCustomer, state.customers, (item) => item.short_name, "Сначала добавьте заказчика");
  fillSelect(els.tripRig, state.rigs.filter((item) => item.driver_id), (item) => `${item.name} · ${item.driver_name}`, "Сначала создайте сцепку с водителем");
  fillSelect(els.recurringCostRig, state.rigs, (item) => item.name, "Сначала создайте сцепку");
  fillSelect(els.companyExpenseRig, state.rigs, (item) => item.name, "Сначала создайте сцепку");
  fillSelect(els.compositionRig, state.rigs, (item) => item.name, "Сначала создайте сцепку");
  fillSelect(els.compensationDriver, activeDrivers, (item) => item.full_name, "Сначала добавьте водителя");
  fillSelect(els.transferDriver, activeDrivers, (item) => item.full_name, "Сначала добавьте водителя");
  fillSelect(els.adjustmentDriver, activeDrivers, (item) => item.full_name, "Сначала добавьте водителя");
  fillReportRigSelect();
  fillSelect(els.rigTractor, state.tractors.filter((item) => item.status === "active" && !state.rigs.some((rig) => rig.tractor_id === item.id)), (item) => `${item.brand} ${item.model} · ${item.plate_number}`, "Нет свободных тягачей");
  fillSelect(els.rigTrailer, state.trailers.filter((item) => item.status === "active" && !state.rigs.some((rig) => rig.trailer_id === item.id)), (item) => `${item.brand} ${item.model} · ${item.plate_number}`, "Нет свободных тралов");
  const currentDriver = els.rigDriver.value;
  els.rigDriver.innerHTML = '<option value="">Пока без водителя</option>';
  state.drivers.filter((driver) => driver.is_active && !state.rigs.some((rig) => rig.driver_id === driver.id)).forEach((driver) => {
    const option = document.createElement("option");
    option.value = driver.id;
    option.textContent = driver.full_name;
    els.rigDriver.append(option);
  });
  if ([...els.rigDriver.options].some((option) => option.value === currentDriver)) els.rigDriver.value = currentDriver;
  fillCompositionSelects();
  fillDriverTripSelects();
  updateDriverRateInputs();
  updateTransferDirection();
  updateCompanyExpenseScope();
  els.companySalaryRate.value = kopecksToRublesValue(state.compensationSettings?.default_salary_rate_kopecks_per_km || 0);
  els.companyDailyRate.value = kopecksToRublesValue(state.compensationSettings?.default_daily_rate_kopecks || 0);
}

function fillDriverTripSelects() {
  fillDriverTripSelect(els.driverTransferTrip, els.transferDriver.value, "Без привязки к рейсу");
  fillDriverTripSelect(els.driverAdjustmentTrip, els.adjustmentDriver.value, "Без привязки");
}

function fillDriverTripSelect(select, driverId, emptyLabel) {
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>`;
  state.trips.filter((trip) => trip.driver_id === driverId).forEach((trip) => {
    const option = document.createElement("option");
    option.value = trip.id;
    option.textContent = `${trip.number ? `${trip.number} · ` : ""}${tripRouteText(trip)}`;
    select.append(option);
  });
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function updateDriverRateInputs() {
  const driverId = els.compensationDriver.value;
  const settings = state.driverCompensationSettings.find((item) => item.driver_id === driverId);
  els.driverSalaryRate.value = settings?.salary_rate_kopecks_per_km == null
    ? ""
    : kopecksToRublesValue(settings.salary_rate_kopecks_per_km);
  els.driverDailyRate.value = settings?.daily_rate_kopecks == null
    ? ""
    : kopecksToRublesValue(settings.daily_rate_kopecks);
  const companySalary = state.compensationSettings?.default_salary_rate_kopecks_per_km || 0;
  const companyDaily = state.compensationSettings?.default_daily_rate_kopecks || 0;
  els.driverRateHint.textContent = `Пустое поле использует общую ставку: ${formatRubles(companySalary)} за км и ${formatRubles(companyDaily)} в день.`;
}

function updateTransferDirection() {
  const isReturn = els.transferDirection.value === "driver_to_company";
  els.transferReimbursementAmount.disabled = isReturn;
  els.transferReimbursementLabel.hidden = isReturn;
  if (isReturn) els.transferReimbursementAmount.value = "";
  els.transferDailyThrough.disabled = isReturn;
  if (isReturn) els.transferDailyThrough.value = "";
  updateTransferTotal();
}

function updateTransferTotal() {
  const controls = [
    els.transferSalaryAmount,
    els.transferDailyAmount,
    els.transferAdvanceAmount,
    els.transferReimbursementAmount
  ];
  let total = 0;
  for (const control of controls) {
    if (!control.value.trim()) continue;
    try { total += rublesToKopecks(control.value); }
    catch { /* Покажет основная проверка формы при сохранении. */ }
  }
  els.driverTransferTotal.textContent = formatRubles(total);
}

function fillCompositionSelects() {
  const rig = state.rigs.find((item) => item.id === els.compositionRig.value) || state.rigs[0];
  if (!rig) {
    for (const select of [els.compositionTractor, els.compositionTrailer, els.compositionDriver]) select.innerHTML = "";
    return;
  }
  els.compositionRig.value = rig.id;
  const usedByOtherRig = (field, id) => state.rigs.some((item) => item.id !== rig.id && item[field] === id);
  fillCompositionSelect(
    els.compositionTractor,
    state.tractors.filter((item) => item.status === "active" && !usedByOtherRig("tractor_id", item.id)),
    (item) => `${item.brand} ${item.model} · ${item.plate_number}`,
    rig.tractor_id
  );
  fillCompositionSelect(
    els.compositionTrailer,
    state.trailers.filter((item) => item.status === "active" && !usedByOtherRig("trailer_id", item.id)),
    (item) => `${item.brand} ${item.model} · ${item.plate_number}`,
    rig.trailer_id
  );
  const currentDriverId = rig.driver_id || "";
  els.compositionDriver.innerHTML = '<option value="">Пока без водителя</option>';
  state.drivers
    .filter((item) => item.is_active && !usedByOtherRig("driver_id", item.id))
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.full_name;
      els.compositionDriver.append(option);
    });
  els.compositionDriver.value = currentDriverId;
}

function fillCompositionSelect(select, items, label, selectedId) {
  select.innerHTML = "";
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = label(item);
    select.append(option);
  });
  select.value = selectedId || select.options[0]?.value || "";
}

function fillReportRigSelect() {
  const current = els.reportRig.value;
  els.reportRig.innerHTML = '<option value="">Все сцепки</option>';
  state.rigs.forEach((rig) => {
    const option = document.createElement("option");
    option.value = rig.id;
    option.textContent = rig.name;
    els.reportRig.append(option);
  });
  if ([...els.reportRig.options].some((option) => option.value === current)) els.reportRig.value = current;
}

function fillSelect(select, items, label, emptyLabel) {
  const current = select.value;
  select.innerHTML = "";
  if (!items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
  } else {
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = label(item);
      select.append(option);
    });
  }
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function updateTripAvailability() {
  const ready = state.customers.length > 0 && state.rigs.some((rig) => rig.driver_id);
  els.createTripButton.disabled = !ready;
  els.tripPrerequisiteHint.hidden = ready;
  els.tripPrerequisiteHint.textContent = ready ? "" : "Сначала добавьте заказчика и создайте сцепку с водителем.";
}

function organizeOfficeInformationArchitecture() {
  const settlementsPanel = document.querySelector("[data-office-panel='settlements']");
  const fleetPanel = document.querySelector("[data-office-panel='fleet']");
  const settingsPeopleForms = document.querySelector("#settingsPeopleForms");
  const settingsAccountList = document.querySelector("#settingsAccountList");
  const settingsExpenseCategories = document.querySelector("#settingsExpenseCategories");

  settingsPeopleForms?.append(els.officeUserForm, els.driverForm);
  settingsAccountList?.append(els.accountList);
  settingsExpenseCategories?.append(els.expenseCategoryForm);

  if (settlementsPanel) {
    const intro = settlementsPanel.querySelector(".portal-section-heading");
    const switcher = createSectionSwitcher("Разделы водителей", [
      ["drivers/balances", "Баланс"],
      ["drivers/transfers", "Переводы"],
      ["drivers/rates", "Ставки"],
      ["drivers/adjustments", "Корректировки"]
    ]);
    const balances = createOfficeSubview("drivers/balances", [
      createSectionHeading("Кто кому должен", "Баланс водителей"),
      els.driverSettlementList,
      els.noDriverSettlements
    ]);
    const transfers = createOfficeSubview("drivers/transfers", [
      els.driverTransferForm,
      createSectionHeading("Без удаления записей", "История переводов"),
      els.driverTransferList,
      els.noDriverTransfers
    ]);
    const rates = createOfficeSubview("drivers/rates", [
      createSectionHeading("Правила начисления", "Ставки водителей"),
      createGrid([els.companyCompensationForm, els.driverCompensationForm])
    ]);
    const adjustments = createOfficeSubview("drivers/adjustments", [
      createSectionHeading("Только с обязательной причиной", "Корректировки баланса"),
      els.driverAdjustmentForm
    ]);
    settlementsPanel.replaceChildren(intro, switcher, balances, transfers, rates, adjustments);
  }

  if (fleetPanel) {
    const switcher = createSectionSwitcher("Разделы автопарка", [
      ["fleet/rigs", "Сцепки"],
      ["fleet/vehicles", "Тягачи и тралы"],
      ["fleet/costs", "Постоянные расходы"]
    ]);
    const rigs = createOfficeSubview("fleet/rigs", [
      createSectionHeading("Текущий состав", "Сцепки"),
      createGrid([els.rigForm, els.rigCompositionForm]),
      els.rigList
    ]);
    const vehicles = createOfficeSubview("fleet/vehicles", [
      createSectionHeading("Справочник транспорта", "Тягачи и тралы"),
      createGrid([els.tractorForm, els.trailerForm])
    ]);
    const costs = createOfficeSubview("fleet/costs", [
      createSectionHeading("Лизинг, страховка и прочее", "Постоянные расходы"),
      els.recurringCostForm,
      els.recurringCostList,
      els.noRecurringCosts
    ]);
    fleetPanel.replaceChildren(
      createSectionHeading("Транспорт и составы", "Автопарк"),
      switcher,
      rigs,
      vehicles,
      costs
    );
  }
}

function createGrid(nodes) {
  const grid = document.createElement("div");
  grid.className = "setup-grid";
  grid.append(...nodes.filter(Boolean));
  return grid;
}

function createSectionHeading(kicker, title) {
  const heading = document.createElement("div");
  heading.className = "portal-section-heading";
  heading.innerHTML = `<div><p class="section-kicker">${escapeHtml(kicker)}</p><h2>${escapeHtml(title)}</h2></div>`;
  return heading;
}

function createSectionSwitcher(label, routes) {
  const switcher = document.createElement("div");
  switcher.className = "section-switcher";
  switcher.setAttribute("aria-label", label);
  routes.forEach(([route, title]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.officeRoute = route;
    button.textContent = title;
    switcher.append(button);
  });
  return switcher;
}

function createOfficeSubview(route, nodes) {
  const view = document.createElement("section");
  view.className = "office-subview";
  view.dataset.officeSubview = route;
  view.hidden = true;
  view.append(...nodes.filter(Boolean));
  return view;
}

function bindEvents() {
  bindFormDraftProtection();
  els.logoutButton.addEventListener("click", logout);
  els.changePasswordButton.addEventListener("click", changeOwnPassword);
  els.createTripShortcut.addEventListener("click", () => switchTab("new-trip"));
  els.cancelNewTripButton.addEventListener("click", () => switchTab("dashboard"));
  els.closeTripDetailButton.addEventListener("click", () => navigateOffice("trips"));
  els.openAllTripsButton.addEventListener("click", () => switchTab("dashboard"));
  els.overviewTransferButton.addEventListener("click", () => {
    switchTab("settlements");
    els.driverTransferForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.notificationShortcut.addEventListener("click", () => {
    switchTab("overview");
    if (!els.notificationSection.hidden) {
      els.notificationSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshWhenVisible();
  });
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.officeTab));
    tab.addEventListener("keydown", handleTabKeydown);
  });
  document.addEventListener("click", (event) => {
    const routeButton = event.target.closest("[data-office-route]");
    if (routeButton) navigateOffice(routeButton.dataset.officeRoute);
    const emptyAction = event.target.closest("[data-empty-action]");
    if (emptyAction) switchTab(emptyAction.dataset.emptyAction);
    const customerEmptyAction = event.target.closest("[data-customer-empty-action='show-all']");
    if (customerEmptyAction) {
      if (customerEmptyAction.dataset.customerEmptyAction === "show-all") {
        els.debtorsOnly.checked = false;
        renderCustomers();
      } else {
        document.querySelector("#customerShortName")?.focus();
        scrollIntoViewRespectingMotion(els.customerForm);
      }
    }
  });
  window.addEventListener("hashchange", () => applyOfficeRoute());
  els.tripStatusFilter.addEventListener("change", renderTrips);
  els.debtorsOnly.addEventListener("change", renderCustomers);
  els.reportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitForm(els.buildReportButton, loadReport);
  });
  els.recurringCostMode.addEventListener("change", updateRecurringCostMode);
  els.companyExpenseScope.addEventListener("change", updateCompanyExpenseScope);
  els.compositionRig.addEventListener("change", fillCompositionSelects);
  els.paymentCancelButton.addEventListener("click", closePaymentDialog);
  els.paymentDialog.addEventListener("close", () => { paymentTrip = null; });
  els.paymentForm.addEventListener("submit", submitPayment);
  els.actionCancel.addEventListener("click", () => closeOfficeActionDialog(null));
  els.actionDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeOfficeActionDialog(null);
  });
  els.actionForm.addEventListener("submit", submitOfficeActionDialog);
  els.compensationDriver.addEventListener("change", updateDriverRateInputs);
  els.transferDriver.addEventListener("change", () => fillDriverTripSelect(els.driverTransferTrip, els.transferDriver.value, "Без привязки к рейсу"));
  els.adjustmentDriver.addEventListener("change", () => fillDriverTripSelect(els.driverAdjustmentTrip, els.adjustmentDriver.value, "Без привязки"));
  els.transferDirection.addEventListener("change", updateTransferDirection);
  for (const control of [
    els.transferSalaryAmount,
    els.transferDailyAmount,
    els.transferAdvanceAmount,
    els.transferReimbursementAmount
  ]) control.addEventListener("input", updateTransferTotal);

  els.companyCompensationForm.addEventListener("submit", saveCompanyCompensationSettings);
  els.driverCompensationForm.addEventListener("submit", saveDriverCompensationSettings);
  els.driverTransferForm.addEventListener("submit", saveDriverTransfer);
  els.driverAdjustmentForm.addEventListener("submit", saveDriverAdjustment);

  bindForm(els.officeUserForm, "/api/office/users", () => ({
    fullName: document.querySelector("#officeUserFullName").value,
    phone: document.querySelector("#officeUserPhone").value,
    login: document.querySelector("#officeUserLogin").value,
    password: document.querySelector("#officeUserPassword").value
  }), "Сотрудник офиса добавлен");

  bindForm(els.driverForm, "/api/office/drivers", () => ({
    fullName: document.querySelector("#driverFullName").value,
    phone: document.querySelector("#driverPhone").value,
    login: document.querySelector("#driverLogin").value,
    password: document.querySelector("#driverPassword").value
  }), "Водитель добавлен");

  bindForm(els.tractorForm, "/api/office/tractors", () => ({
    brand: document.querySelector("#tractorBrand").value,
    model: document.querySelector("#tractorModel").value,
    plateNumber: document.querySelector("#tractorPlate").value,
    vin: document.querySelector("#tractorVin").value
  }), "Тягач добавлен");

  bindForm(els.trailerForm, "/api/office/trailers", () => ({
    brand: document.querySelector("#trailerBrand").value,
    model: document.querySelector("#trailerModel").value,
    plateNumber: document.querySelector("#trailerPlate").value,
    axles: valueOrNull(document.querySelector("#trailerAxles").value),
    capacityKg: valueOrNull(document.querySelector("#trailerCapacity").value),
    trailerType: document.querySelector("#trailerType").value
  }), "Трал добавлен");

  bindForm(els.rigForm, "/api/office/rigs", () => ({
    name: document.querySelector("#rigName").value,
    tractorId: els.rigTractor.value,
    trailerId: els.rigTrailer.value,
    driverId: els.rigDriver.value || null
  }), "Сцепка создана");

  bindForm(els.expenseCategoryForm, "/api/office/expense-categories", () => ({
    name: els.expenseCategoryName.value
  }), "Категория добавлена");

  els.rigCompositionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitForm(event.submitter, async () => {
      await api(`/api/office/rigs/${els.compositionRig.value}/composition`, {
        method: "POST",
        body: {
          tractorId: els.compositionTractor.value,
          trailerId: els.compositionTrailer.value,
          driverId: els.compositionDriver.value || null
        }
      });
      await refresh();
      showToast(els.toast, "Новый состав сцепки сохранён");
    });
  });

  els.recurringCostForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitForm(event.submitter, async () => {
      const draft = {
        subjectType: "rig",
        subjectId: els.recurringCostRig.value,
        category: els.recurringCostCategory.value,
        totalAmountKopecks: rublesToKopecks(els.recurringCostAmount.value),
        allocationMode: els.recurringCostMode.value,
        allocationMonths: Number(els.recurringCostMonths.value || 1),
        validFrom: monthStartDate(els.recurringCostFrom.value),
        validTo: els.recurringCostTo.value ? monthEndDate(els.recurringCostTo.value) : null,
        comment: els.recurringCostComment.value
      };
      await submitFinancialMutation({
        key: "recurring-cost",
        draft,
        prepareBody: async (id) => ({ ...draft, clientMutationId: id }),
        send: (body) => api("/api/office/recurring-costs", { method: "POST", body })
      });
      els.recurringCostForm.reset();
      els.recurringCostFrom.value = localMonthValue(new Date());
      els.recurringCostMonths.value = "12";
      updateRecurringCostMode();
      await refresh();
      showToast(els.toast, "Постоянный расход добавлен");
    });
  });

  els.companyExpenseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitForm(els.saveCompanyExpenseButton, async () => {
      const occurredAt = new Date(els.companyExpenseOccurredAt.value);
      if (Number.isNaN(occurredAt.getTime())) throw new Error("Укажите дату и время расхода");
      const file = els.companyExpenseProof.files?.[0];
      const draft = {
        scopeType: els.companyExpenseScope.value,
        rigId: els.companyExpenseScope.value === "rig" ? els.companyExpenseRig.value : null,
        category: els.companyExpenseCategory.value,
        amountKopecks: rublesToKopecks(els.companyExpenseAmount.value),
        paymentMethod: els.companyExpensePaymentMethod.value,
        occurredAt: occurredAt.toISOString(),
        description: els.companyExpenseDescription.value
      };
      await submitFinancialMutation({
        key: "company-expense",
        draft,
        prepareBody: async (id) => {
          const uploaded = file ? await uploadAttachment(file, "company_expense_proof") : null;
          return { ...draft, attachmentId: uploaded?.attachmentId || null, clientMutationId: id };
        },
        send: (body) => api("/api/office/company-expenses", { method: "POST", body })
      });
      els.companyExpenseForm.reset();
      els.companyExpenseOccurredAt.value = localDateTimeValue(new Date());
      els.companyExpenseScope.value = "company";
      updateCompanyExpenseScope();
      await refresh();
      showToast(els.toast, "Расход учтён в прибыли бизнеса");
    });
  });

  bindForm(els.customerForm, "/api/office/customers", () => ({
    shortName: document.querySelector("#customerShortName").value,
    fullName: document.querySelector("#customerFullName").value,
    inn: document.querySelector("#customerInn").value,
    defaultPaymentTermDays: valueOrNull(document.querySelector("#customerTerm").value)
  }), "Заказчик добавлен");

  els.contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitForm(event.submitter, async () => {
      await api(`/api/office/customers/${els.contactCustomer.value}/contacts`, {
        method: "POST",
        body: {
          fullName: document.querySelector("#contactFullName").value,
          position: document.querySelector("#contactPosition").value,
          email: document.querySelector("#contactEmail").value,
          phones: document.querySelector("#contactPhones").value.split(",").map((phone) => phone.trim()).filter(Boolean)
        }
      });
      els.contactForm.reset();
      await refresh();
      showToast(els.toast, "Контакт добавлен");
    });
  });

  els.tripForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitForm(els.createTripButton, async () => {
      const contract = els.tripContract.files[0];
      const { trip } = await api("/api/office/trips", {
        method: "POST",
        body: {
          customerId: els.tripCustomer.value,
          rigId: els.tripRig.value,
          number: els.tripNumber.value,
          plannedLoadingDate: els.tripLoadingDate.value,
          loadingAddress: els.tripLoadingAddress.value,
          unloadingAddress: els.tripUnloadingAddress.value,
          unloadingAddressIsApproximate: els.tripUnloadingApproximate.checked,
          additionalUnloadingStops: els.tripAdditionalStops.value
            .split(/\r?\n/)
            .map((address) => address.trim())
            .filter(Boolean)
            .map((address) => ({ address })),
          agreedRateKopecks: rublesToKopecks(els.tripRate.value),
          vatMode: els.tripVatMode.value,
          vatRateBasisPoints: state.organization.vat_rate_basis_points,
          paymentMethod: els.tripPaymentMethod.value,
          paymentTermDays: Number(els.tripPaymentTerm.value),
          salaryRateOverrideKopecksPerKm: optionalRublesToKopecks(els.tripSalaryRateOverride.value),
          dailyRateOverrideKopecks: optionalRublesToKopecks(els.tripDailyRateOverride.value),
          cargoDescription: els.tripCargo.value,
          driverInstructions: els.tripInstructions.value
        }
      });
      els.tripForm.reset();
      els.tripLoadingDate.value = localDateValue(new Date());
      els.tripPaymentTerm.value = "14";
      await refresh();
      switchTab("dashboard");
      showToast(els.toast, "Рейс назначен водителю");

      if (contract) {
        try {
          await attachTripContract(trip.id, contract);
          await refresh();
          showToast(els.toast, "Рейс создан, договор прикреплён");
        } catch (error) {
          showToast(els.toast, `Рейс создан, но договор не загружен: ${error.message}. Добавьте его в карточке рейса.`, true);
        }
      }
    });
  });
}

function bindFormDraftProtection() {
  document.querySelectorAll("form").forEach((form) => {
    const markDirty = () => { form.dataset.dirty = "true"; };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    form.addEventListener("reset", () => {
      setTimeout(() => { delete form.dataset.dirty; }, 0);
    });
  });
}

function captureDirtyFormDrafts() {
  const drafts = new Map();
  document.querySelectorAll("form[data-dirty='true']").forEach((form) => {
    const controls = [];
    for (const control of form.elements) {
      if (!(control instanceof HTMLInputElement
          || control instanceof HTMLSelectElement
          || control instanceof HTMLTextAreaElement)) continue;
      if (control instanceof HTMLInputElement && control.type === "file") continue;
      const key = control.id || control.name;
      if (!key) continue;
      controls.push({
        key,
        value: control.value,
        checked: "checked" in control ? control.checked : undefined
      });
    }
    drafts.set(form.id, controls);
  });
  return drafts;
}

function restoreDirtyFormDrafts(drafts) {
  for (const [formId, savedControls] of drafts) {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) continue;
    for (const saved of savedControls) {
      const control = [...form.elements].find((item) => (item.id || item.name) === saved.key);
      if (!control) continue;
      if (control instanceof HTMLSelectElement
          && ![...control.options].some((option) => option.value === saved.value)) continue;
      control.value = saved.value;
      if (saved.checked !== undefined && "checked" in control) control.checked = saved.checked;
    }
    form.dataset.dirty = "true";
  }
  updateRecurringCostMode();
  updateCompanyExpenseScope();
  updateTransferDirection();
  updateTransferTotal();
}

async function saveCompanyCompensationSettings(event) {
  event.preventDefault();
  await submitForm(event.submitter, async () => {
    await api("/api/office/compensation/settings", {
      method: "POST",
      body: {
        defaultSalaryRateKopecksPerKm: rublesToKopecks(els.companySalaryRate.value),
        defaultDailyRateKopecks: rublesToKopecks(els.companyDailyRate.value),
        reason: els.companyRateReason.value
      }
    });
    els.companyRateReason.value = "";
    await refresh();
    showToast(els.toast, "Общие ставки сохранены");
  });
}

async function saveDriverCompensationSettings(event) {
  event.preventDefault();
  if (!els.compensationDriver.value) return;
  await submitForm(event.submitter, async () => {
    await api(`/api/office/drivers/${els.compensationDriver.value}/compensation-settings`, {
      method: "POST",
      body: {
        salaryRateKopecksPerKm: optionalRublesToKopecks(els.driverSalaryRate.value),
        dailyRateKopecks: optionalRublesToKopecks(els.driverDailyRate.value),
        reason: els.driverRateReason.value
      }
    });
    els.driverRateReason.value = "";
    await refresh();
    showToast(els.toast, "Ставки водителя сохранены");
  });
}

async function saveDriverTransfer(event) {
  event.preventDefault();
  if (!els.transferDriver.value) return;
  await submitForm(els.saveDriverTransferButton, async () => {
    const tripId = els.driverTransferTrip.value || null;
    const allocations = [];
    addTransferAllocation(allocations, "salary", els.transferSalaryAmount.value, { tripId });
    addTransferAllocation(allocations, "daily", els.transferDailyAmount.value, {
      tripId,
      coverageThrough: els.transferDailyThrough.value || null
    });
    addTransferAllocation(allocations, "expense_advance", els.transferAdvanceAmount.value, { tripId });
    if (els.transferDirection.value === "company_to_driver") {
      addTransferAllocation(allocations, "expense_reimbursement", els.transferReimbursementAmount.value, { tripId });
    }
    if (allocations.length === 0) throw new Error("Укажите хотя бы одно назначение перевода");
    if (els.transferDailyThrough.value && !els.transferDailyAmount.value.trim()) {
      throw new Error("Для даты оплаты суточных укажите сумму суточных");
    }
    const occurredAt = new Date(els.driverTransferOccurredAt.value);
    if (Number.isNaN(occurredAt.getTime())) throw new Error("Укажите дату и время перевода");
    const proof = els.driverTransferProof.files?.[0];
    const draft = {
      driverId: els.transferDriver.value,
      direction: els.transferDirection.value,
      paymentMethod: els.driverTransferMethod.value,
      occurredAt: occurredAt.toISOString(),
      comment: els.driverTransferComment.value,
      allocations
    };
    await submitFinancialMutation({
      key: "driver-transfer",
      draft,
      prepareBody: async (id) => {
        const uploaded = proof ? await uploadAttachment(proof, "payment_proof") : null;
        return { ...draft, attachmentId: uploaded?.attachmentId || null, clientMutationId: id };
      },
      send: (body) => api("/api/office/driver-transfers", { method: "POST", body })
    });
    els.driverTransferForm.reset();
    els.driverTransferOccurredAt.value = localDateTimeValue(new Date());
    updateTransferDirection();
    await refresh();
    showToast(els.toast, "Перевод распределён и учтён");
  });
}

function addTransferAllocation(target, allocationType, value, extra = {}) {
  if (!String(value || "").trim()) return;
  const amountKopecks = rublesToKopecks(value);
  if (amountKopecks <= 0) throw new Error("Каждая часть перевода должна быть больше нуля");
  target.push({ allocationType, amountKopecks, ...extra });
}

async function saveDriverAdjustment(event) {
  event.preventDefault();
  if (!els.adjustmentDriver.value) return;
  await submitForm(event.submitter, async () => {
    const driverId = els.adjustmentDriver.value;
    const draft = {
      balanceCategory: els.driverAdjustmentCategory.value,
      balanceEffectKopecks: signedRublesToKopecks(els.driverAdjustmentAmount.value),
      tripId: els.driverAdjustmentTrip.value || null,
      comment: els.driverAdjustmentComment.value
    };
    await submitFinancialMutation({
      key: `driver-adjustment:${driverId}`,
      draft,
      prepareBody: async (id) => ({ ...draft, clientMutationId: id }),
      send: (body) => api(`/api/office/drivers/${driverId}/adjustments`, { method: "POST", body })
    });
    els.driverAdjustmentAmount.value = "";
    els.driverAdjustmentComment.value = "";
    await refresh();
    showToast(els.toast, "Корректировка добавлена в историю");
  });
}

async function reverseTransfer(transfer) {
  const reason = await requestReason({
    title: "Отменить перевод?",
    description: `${formatRubles(transfer.total_amount_kopecks)} · ${formatDateTime(transfer.occurred_at)}. Запись не удалится: система добавит отменяющую отметку.`,
    confirmLabel: "Отменить перевод"
  });
  if (!reason) return;
  try {
    await api(`/api/office/driver-transfers/${transfer.id}/reverse`, {
      method: "POST",
      body: { reason }
    });
    await refresh();
    showToast(els.toast, "Перевод отменён сторнирующей отметкой");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

async function reverseCompanyExpense(expense) {
  const reason = await requestReason({
    title: "Отменить разовый расход?",
    description: `${expense.category} · ${formatRubles(expense.amount_kopecks)}. Запись останется в истории.`,
    confirmLabel: "Отменить расход"
  });
  if (!reason) return;
  try {
    await api(`/api/office/company-expenses/${expense.id}/reverse`, {
      method: "POST",
      body: { reason }
    });
    await refresh();
    showToast(els.toast, "Расход отменён и сохранён в истории");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

async function reverseRecurringCost(cost) {
  const reason = await requestReason({
    title: "Отменить постоянный расход?",
    description: `${cost.category} · ${formatRubles(cost.monthly_amount_kopecks || cost.total_amount_kopecks)}. Уже рассчитанные периоды останутся в истории.`,
    confirmLabel: "Отменить расход"
  });
  if (!reason) return;
  try {
    await api(`/api/office/recurring-costs/${cost.id}/reverse`, {
      method: "POST",
      body: { reason }
    });
    await refresh();
    showToast(els.toast, "Постоянный расход отменён и сохранён в истории");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

async function setExpenseCategoryActive(category) {
  try {
    await api(`/api/office/expense-categories/${category.id}/active`, {
      method: "POST",
      body: { isActive: !Boolean(category.is_active) }
    });
    await refresh();
    showToast(els.toast, category.is_active ? "Категория отключена" : "Категория включена");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

function bindForm(form, path, collect, successMessage) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitForm(event.submitter, async () => {
      await api(path, { method: "POST", body: collect() });
      form.reset();
      await refresh();
      showToast(els.toast, successMessage);
    });
  });
}

async function submitForm(button, action) {
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Сохраняем...";
  }
  try { await action(); }
  catch (error) { showToast(els.toast, error.message, true); }
  finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = label;
    }
  }
}

async function reviewExpense(expense, status) {
  let comment = "";
  const titleByStatus = {
    confirmed: "Подтвердить расход?",
    rejected: "Отклонить расход?",
    needs_explanation: "Запросить пояснение?"
  };
  const values = await requestOfficeAction({
    eyebrow: `${expense.category} · ${formatRubles(expense.amount_kopecks)}`,
    title: titleByStatus[status] || "Изменить статус расхода?",
    description: expense.description || "Проверьте чек и контекст рейса перед сохранением.",
    confirmLabel: status === "confirmed" ? "Подтвердить расход" : status === "rejected" ? "Отклонить расход" : "Отправить запрос",
    destructive: status === "rejected",
    fields: status === "confirmed" ? [] : [{
      name: "comment",
      label: status === "rejected" ? "Причина отклонения" : "Что нужно пояснить водителю",
      type: "textarea",
      required: true,
      maxLength: 1000
    }]
  });
  if (!values) return;
  comment = values.comment || "";
  try {
    await api(`/api/office/expenses/${expense.id}/review`, { method: "POST", body: { status, comment } });
    await refresh();
    showToast(els.toast, "Статус расхода обновлён");
  } catch (error) { showToast(els.toast, error.message, true); }
}

function requestOfficeAction({
  eyebrow = "Подтверждение",
  title,
  description = "",
  confirmLabel = "Продолжить",
  destructive = false,
  fields = []
}) {
  if (actionDialogResolver) closeOfficeActionDialog(null);
  const previouslyFocused = document.activeElement;
  els.actionEyebrow.textContent = eyebrow;
  els.actionTitle.textContent = title;
  els.actionDescription.textContent = description;
  els.actionDescription.hidden = !description;
  els.actionSubmit.textContent = confirmLabel;
  els.actionSubmit.classList.toggle("danger-action", destructive);
  els.actionError.hidden = true;
  els.actionError.textContent = "";
  els.actionFields.replaceChildren();

  fields.forEach((field) => {
    const controlId = `officeAction_${field.name}`;
    if (field.type === "checkbox") {
      const label = document.createElement("label");
      label.className = "check-row action-dialog-check";
      label.innerHTML = `
        <input id="${escapeHtml(controlId)}" name="${escapeHtml(field.name)}" type="checkbox"${field.value ? " checked" : ""}>
        <span>${escapeHtml(field.label)}</span>
      `;
      els.actionFields.append(label);
      return;
    }
    const label = document.createElement("label");
    const elementName = field.type === "textarea" ? "textarea" : "input";
    const control = document.createElement(elementName);
    control.id = controlId;
    control.name = field.name;
    if (elementName === "input") control.type = field.type || "text";
    if (field.inputMode) control.inputMode = field.inputMode;
    if (field.min != null) control.min = String(field.min);
    if (field.step != null) control.step = String(field.step);
    if (field.minLength != null) control.minLength = Number(field.minLength);
    if (field.maxLength != null) control.maxLength = Number(field.maxLength);
    if (field.placeholder) control.placeholder = field.placeholder;
    if (field.autocomplete) control.autocomplete = field.autocomplete;
    control.value = field.value ?? "";
    control.required = Boolean(field.required);
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
  const firstControl = els.actionFields.querySelector("input, textarea, select");
  firstControl?.focus();
  return new Promise((resolve) => {
    actionDialogResolver = resolve;
  });
}

async function requestReason({
  eyebrow = "История изменений",
  title,
  description,
  confirmLabel,
  destructive = true
}) {
  const values = await requestOfficeAction({
    eyebrow,
    title,
    description,
    confirmLabel,
    destructive,
    fields: [{
      name: "reason",
      label: "Причина",
      type: "textarea",
      required: true,
      maxLength: 1000,
      hint: "Причина сохранится в истории и будет доступна при проверке."
    }]
  });
  return values?.reason?.trim() || null;
}

function submitOfficeActionDialog(event) {
  event.preventDefault();
  if (!els.actionForm.reportValidity()) return;
  const values = {};
  els.actionFields.querySelectorAll("input, textarea, select").forEach((control) => {
    values[control.name] = control.type === "checkbox" ? control.checked : control.value;
  });
  closeOfficeActionDialog(values);
}

function closeOfficeActionDialog(result) {
  if (els.actionDialog.open) els.actionDialog.close();
  const resolve = actionDialogResolver;
  actionDialogResolver = null;
  resolve?.(result);
  const returnFocusId = els.actionDialog.dataset.returnFocusId;
  if (returnFocusId) document.getElementById(returnFocusId)?.focus();
}

function addPayment(trip) {
  paymentTrip = trip;
  els.paymentForm.reset();
  els.paymentTripLabel.textContent = `${trip.customer_name} · ${tripRouteText(trip)}`;
  els.paymentType.value = Number(trip.received_kopecks || 0) === 0 ? "advance" : "partial";
  els.paymentMethod.value = trip.payment_method;
  els.paymentReceivedAt.value = localDateTimeValue(new Date());
  els.paymentDialog.showModal();
  els.paymentAmount.focus();
}

function closePaymentDialog() {
  paymentTrip = null;
  els.paymentDialog.close();
}

async function submitPayment(event) {
  event.preventDefault();
  if (!paymentTrip) return;
  const trip = paymentTrip;
  await submitForm(els.paymentSubmitButton, async () => {
    const receivedAt = new Date(els.paymentReceivedAt.value);
    if (Number.isNaN(receivedAt.getTime())) throw new Error("Укажите фактические дату и время оплаты");
    const proof = els.paymentProof.files?.[0];
    const draft = {
      amountKopecks: rublesToKopecks(els.paymentAmount.value),
      paymentType: els.paymentType.value,
      paymentMethod: els.paymentMethod.value,
      receivedAt: receivedAt.toISOString(),
      comment: els.paymentComment.value
    };
    await submitFinancialMutation({
      key: `incoming-payment:${trip.id}`,
      draft,
      prepareBody: async (id) => {
        const uploaded = proof ? await uploadAttachment(proof, "payment_proof") : null;
        return { ...draft, attachmentId: uploaded?.attachmentId || null, clientMutationId: id };
      },
      send: (body) => api(`/api/office/trips/${trip.id}/payments`, { method: "POST", body })
    });
    closePaymentDialog();
    await refresh();
    showToast(els.toast, "Оплата учтена");
  });
}

async function attachTripContract(tripId, file) {
  const uploaded = await uploadAttachment(file, "trip_document");
  await api(`/api/office/trips/${tripId}/documents`, {
    method: "POST",
    body: { attachmentId: uploaded.attachmentId, documentType: "contract_application" }
  });
}

async function attachContract(trip, file, button, input) {
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Загружаем договор...";
  }
  try {
    await attachTripContract(trip.id, file);
    await refresh();
    showToast(els.toast, "Договор прикреплён к рейсу");
  } catch (error) {
    showToast(els.toast, `Не удалось загрузить договор: ${error.message}`, true);
  } finally {
    if (input) input.value = "";
    if (button?.isConnected) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = label;
    }
  }
}

async function addAdjustment(trip) {
  const values = await requestOfficeAction({
    eyebrow: trip.number ? `Рейс ${trip.number}` : "Рейс",
    title: "Добавить доплату или штраф",
    description: "Положительная сумма увеличит ставку рейса, отрицательная — уменьшит. Изменение сохранится в истории.",
    confirmLabel: "Пересчитать ставку",
    fields: [
      { name: "amount", label: "Сумма со знаком, ₽", inputMode: "decimal", required: true, placeholder: "Например, -5000 или 12000" },
      { name: "reason", label: "Причина изменения", type: "textarea", required: true, maxLength: 1000 }
    ]
  });
  if (!values) return;
  try {
    const kopecks = signedRublesToKopecks(values.amount);
    const draft = {
      adjustmentType: kopecks < 0 ? "penalty" : "surcharge",
      amountKopecks: kopecks,
      reason: values.reason.trim()
    };
    await submitFinancialMutation({
      key: `rate-adjustment:${trip.id}`,
      draft,
      prepareBody: async (id) => ({ ...draft, clientMutationId: id }),
      send: (body) => api(`/api/office/trips/${trip.id}/adjustments`, { method: "POST", body })
    });
    await refresh();
    showToast(els.toast, "Ставка пересчитана");
  } catch (error) { showToast(els.toast, error.message, true); }
}

async function reverseRateAdjustment(trip, adjustment) {
  const reason = await requestReason({
    title: "Отменить изменение ставки?",
    description: `${adjustmentTypeLabel(adjustment.adjustment_type)} · ${formatRubles(adjustment.amount_kopecks)}. Ставка рейса будет пересчитана.`,
    confirmLabel: "Отменить изменение"
  });
  if (!reason) return;
  try {
    await api(`/api/office/trips/${trip.id}/adjustments/${adjustment.id}/reverse`, {
      method: "POST",
      body: { reason }
    });
    await refresh();
    showToast(els.toast, "Корректировка отменена и осталась в истории");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

async function reverseIncomingPayment(trip, payment) {
  const reason = await requestReason({
    title: "Отменить оплату заказчика?",
    description: `${trip.customer_name} · ${formatRubles(payment.allocated_kopecks)}. Долг по рейсу будет пересчитан.`,
    confirmLabel: "Отменить оплату"
  });
  if (!reason) return;
  try {
    await api(`/api/office/trips/${trip.id}/payments/${payment.id}/reverse`, {
      method: "POST",
      body: { reason }
    });
    await refresh();
    showToast(els.toast, "Оплата отменена и осталась в истории");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

async function confirmTrip(trip) {
  const values = await requestOfficeAction({
    eyebrow: trip.number ? `Рейс ${trip.number}` : "Рейс",
    title: "Подтвердить рейс?",
    description: `${tripRouteText(trip)}. После подтверждения начисления и расходы войдут в итоговый расчёт.`,
    confirmLabel: "Подтвердить рейс",
    fields: []
  });
  if (!values) return;
  try {
    await api(`/api/office/trips/${trip.id}/confirm`, { method: "POST" });
    await refresh();
    showToast(els.toast, "Рейс подтверждён");
  } catch (error) { showToast(els.toast, error.message, true); }
}

function contactsForCustomer(customerId) {
  const contacts = new Map();
  state.contacts.filter((row) => row.customer_id === customerId).forEach((row) => {
    if (!contacts.has(row.id)) contacts.set(row.id, { fullName: row.full_name, position: row.position, phones: [] });
    if (row.phone) contacts.get(row.id).phones.push({ phone: row.phone, label: row.phone_label });
  });
  return [...contacts.values()];
}

function switchTab(name) {
  const routes = {
    overview: "overview",
    dashboard: "trips",
    settlements: "drivers/balances",
    fleet: "fleet/rigs",
    analytics: "profitability",
    customers: "customers",
    settings: "settings/access",
    "new-trip": "new-trip"
  };
  navigateOffice(routes[name] || "overview");
}

function navigateOffice(route, { replace = false } = {}) {
  const hash = `#${route}`;
  if (location.hash === hash) {
    applyOfficeRoute({ scroll: true });
    return;
  }
  if (replace) {
    history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
    applyOfficeRoute({ scroll: false });
  } else {
    location.hash = route;
  }
}

function scrollIntoViewRespectingMotion(element) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
}

function applyOfficeRoute({ scroll = true, replaceInvalid = false } = {}) {
  const hadHash = Boolean(location.hash);
  const requested = decodeURIComponent(location.hash.replace(/^#\/?/, "")) || "overview";
  const [section, detailId] = requested.split("/");
  const panelBySection = {
    overview: "overview",
    trips: "dashboard",
    drivers: "settlements",
    fleet: "fleet",
    profitability: "analytics",
    customers: "customers",
    settings: "settings",
    "new-trip": "new-trip"
  };
  let route = requested;
  let panelName = panelBySection[section];
  const defaultNestedRoutes = {
    drivers: "drivers/balances",
    fleet: "fleet/rigs",
    settings: "settings/access"
  };
  if (defaultNestedRoutes[section] && requested === section) {
    route = defaultNestedRoutes[section];
    history.replaceState(null, "", `${location.pathname}${location.search}#${route}`);
  }
  const validSubviewRoutes = new Set([
    "drivers/balances",
    "drivers/transfers",
    "drivers/rates",
    "drivers/adjustments",
    "fleet/rigs",
    "fleet/vehicles",
    "fleet/costs",
    "settings/access",
    "settings/categories"
  ]);

  if (!panelName
      || (section === "drivers" && !validSubviewRoutes.has(route))
      || (section === "fleet" && !validSubviewRoutes.has(route))
      || (section === "settings" && !validSubviewRoutes.has(route))
      || (section === "trips" && detailId && !state.trips.some((trip) => trip.id === detailId))) {
    route = panelName === "dashboard" ? "trips" : "overview";
    panelName = panelBySection[route];
    if (replaceInvalid || requested !== route) {
      history.replaceState(null, "", `${location.pathname}${location.search}#${route}`);
    }
  }

  if (!hadHash && replaceInvalid) {
    history.replaceState(null, "", `${location.pathname}${location.search}#${route}`);
  }
  currentOfficeRoute = route;
  const [activeSection, activeDetailId] = route.split("/");
  selectedTripId = activeSection === "trips" && activeDetailId ? activeDetailId : null;
  els.tabs.forEach((tab) => {
    const active = tab.dataset.officeTab === panelName;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  els.panels.forEach((panel) => {
    const active = panel.dataset.officePanel === panelName;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  document.querySelectorAll("[data-office-subview]").forEach((view) => {
    view.hidden = view.dataset.officeSubview !== route;
  });
  document.querySelectorAll("[data-office-route]").forEach((button) => {
    const active = button.dataset.officeRoute === route;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (panelName === "dashboard") renderTrips();
  document.title = `${officeRouteTitle(route)} · ANB`;
  if (scroll) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }
}

function handleTabKeydown(event) {
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
  switchTab(tabs[targetIndex].dataset.officeTab);
}

function officeRouteTitle(route) {
  if (route.startsWith("trips/")) return "Рейс";
  return {
    overview: "Обзор",
    trips: "Рейсы",
    "drivers/balances": "Баланс водителей",
    "drivers/transfers": "Переводы водителям",
    "drivers/rates": "Ставки водителей",
    "drivers/adjustments": "Корректировки водителей",
    "fleet/rigs": "Сцепки",
    "fleet/vehicles": "Тягачи и тралы",
    "fleet/costs": "Постоянные расходы",
    profitability: "Доходность",
    customers: "Заказчики",
    "settings/access": "Доступ",
    "settings/categories": "Категории расходов",
    "new-trip": "Создать рейс"
  }[route] || "Кабинет офиса";
}

function pluralize(value, one, few, many) {
  const count = Math.abs(Number(value || 0)) % 100;
  const last = count % 10;
  if (count > 10 && count < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function expectedPaymentText(value) {
  return `${Number(value) === 1 ? "Ожидается" : "Ожидаются"} ${value} ${pluralize(value, "оплата", "оплаты", "оплат")}`;
}

function isCompletedTrip(trip) {
  return COMPLETED_TRIP_STATUSES.has(trip.status);
}

function tripRouteText(trip) {
  const stops = (trip.additional_unloading_stops || []).map((stop) => stop.address);
  return [trip.loading_address, trip.unloading_address, ...stops].filter(Boolean).join(" → ");
}

function resultExpenses(trip) {
  return ["confirmed", "closed"].includes(trip.status)
    ? Number(trip.confirmed_expenses_kopecks || 0)
    : Number(trip.preliminary_expenses_kopecks || 0);
}

function receivableText(amountKopecks) {
  const amount = Number(amountKopecks || 0);
  if (amount < 0) return `Переплата ${formatRubles(Math.abs(amount))}`;
  return formatRubles(amount);
}

function paymentDueText(trip) {
  if (!trip.payment_due_date) return "после разгрузки";
  return Number(trip.days_overdue || 0) > 0
    ? `${formatDate(trip.payment_due_date)} · просрочка ${trip.days_overdue} дн.`
    : formatDate(trip.payment_due_date);
}

function customerDebtText(amountKopecks) {
  const amount = Number(amountKopecks || 0);
  if (amount > 0) return `Долг ${formatRubles(amount)}`;
  if (amount < 0) return `Переплата ${formatRubles(Math.abs(amount))}`;
  return "Долга нет";
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function valueOrNull(value) {
  return value === "" ? null : Number(value);
}

function signedRublesToKopecks(value) {
  const text = String(value).trim();
  const negative = text.startsWith("-");
  const amount = rublesToKopecks(text.replace(/^[+-]/, ""));
  return negative ? -amount : amount;
}

function optionalRublesToKopecks(value) {
  return String(value ?? "").trim() === "" ? null : rublesToKopecks(value);
}

function kopecksToRublesValue(value) {
  const amount = Number(value || 0) / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(".", ",");
}

function localDateValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function localMonthValue(date) {
  return localDateValue(date).slice(0, 7);
}

function setReportDefaults() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  els.reportFrom.value = localDateValue(from);
  els.reportTo.value = localDateValue(today);
}

function updateRecurringCostMode() {
  const divides = els.recurringCostMode.value === "equal_months";
  els.recurringCostMonthsLabel.hidden = !divides;
  els.recurringCostMonths.required = divides;
}

function updateCompanyExpenseScope() {
  const requiresRig = els.companyExpenseScope.value === "rig";
  els.companyExpenseRigLabel.hidden = !requiresRig;
  els.companyExpenseRig.required = requiresRig;
  els.companyExpenseRig.disabled = !requiresRig;
}

function monthStartDate(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("Укажите месяц начала расхода");
  return `${value}-01`;
}

function monthEndDate(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("Проверьте месяц окончания расхода");
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function isoToLocalDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : localDateTimeValue(date);
}

function mutationId() {
  return globalThis.crypto?.randomUUID?.()
    || `office-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function submitFinancialMutation({ key, draft, prepareBody, send }) {
  try {
    return await submitIdempotentMutation({
      storage: localStorage,
      storageKey: `anb-office-pending-financial-v1:${state.user?.id || "unknown"}`,
      key,
      draft,
      createId: mutationId,
      prepareBody,
      send
    });
  } catch (error) {
    if (error?.code === "PREVIOUS_MUTATION_RECONCILED") await refresh();
    throw error;
  }
}

async function changeOwnPassword() {
  const values = await requestOfficeAction({
    eyebrow: "Безопасность",
    title: "Сменить свой пароль",
    description: "После сохранения потребуется войти заново на всех устройствах.",
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
    location.replace("/login.html");
  } catch (error) {
    showToast(els.toast, error.message, true);
  }
}

function statusLabel(status) {
  return {
    draft: "Черновик", assigned: "Назначен", awaiting_loading: "Ожидает загрузки",
    in_progress: "Выполняется", pending_review: "Ожидает проверки",
    needs_explanation: "Нужно пояснение", confirmed: "Подтверждён", closed: "Закрыт"
  }[status] || status;
}

function paymentMethodLabel(method) {
  return {
    bank: "Расчётный счёт",
    company_card: "Корпоративная карта",
    cash: "Наличные",
    card_transfer: "Перевод на карту"
  }[method] || method;
}

function expensePaymentMethodLabel(method) {
  return {
    cash: "Наличные",
    card: "Банковская карта",
    transfer: "Перевод",
    fuel_card: "Топливная карта"
  }[method] || method;
}

function expensePaymentSourceLabel(source) {
  return {
    driver_personal: "Личные деньги водителя",
    driver_advance: "Выданный аванс",
    company_card: "Карта компании",
    company_fuel_card: "Топливная карта компании",
    company_cash: "Наличные компании"
  }[source] || source;
}

function expenseStatusLabel(status) {
  return {
    draft: "Черновик",
    submitted: "Отправлен",
    pending_review: "Ожидает проверки",
    confirmed: "Подтверждён",
    rejected: "Отклонён",
    needs_explanation: "Нужно пояснение",
    suspicious: "Подозрительный"
  }[status] || status;
}

function adjustmentTypeLabel(type) {
  return {
    surcharge: "Доплата к ставке",
    discount: "Снижение ставки",
    penalty: "Штраф",
    other: "Корректировка ставки"
  }[type] || type;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("./sw.js");
  } catch {
    return null;
  }
}
