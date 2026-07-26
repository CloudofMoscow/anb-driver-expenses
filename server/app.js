import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve, sep } from "node:path";
import {
  audit,
  entityId,
  normalizeLogin,
  nowIso,
  toKopecks,
  transaction
} from "./database.js";
import {
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  hashPasswordAsync,
  hashSessionToken,
  parseCookies,
  sessionCookie,
  verifyPassword
} from "./security.js";
import {
  registerPushSubscription,
  unregisterPushSubscription,
  userHasPushSubscription
} from "./push-service.js";

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_IP_MAX_ATTEMPTS = 40;
const LOGIN_MAX_IN_FLIGHT = 16;
const LOGIN_IP_MAX_IN_FLIGHT = 4;
const UPLOAD_MAX_IN_FLIGHT = 8;
const UPLOAD_USER_MAX_IN_FLIGHT = 2;
const ORPHAN_UPLOAD_TTL_MS = 30 * 86400000;
const loginAttempts = new Map();
const loginInFlightByIp = new Map();
const passwordWorkInFlightByUser = new Map();
const uploadInFlightByUser = new Map();
const lastOrphanCleanupByOrganization = new Map();
let loginInFlight = 0;
let passwordWorkInFlight = 0;
let uploadInFlight = 0;
const DUMMY_PASSWORD_HASH = hashPassword("anb-dummy-password-not-used");

const publicFiles = new Set([
  "driver.html",
  "office.html",
  "login.html",
  "styles.css",
  "driver.js",
  "office.js",
  "login.js",
  "api-client.js",
  "financial-mutation.js",
  "driver-outbox.js",
  "push-notifications.js",
  "manifest.webmanifest",
  "sw.js",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "anb-logo.svg"
]);

export function createApplication({
  database,
  publicDirectory,
  uploadsDirectory,
  secureCookies = false,
  trustProxy = false,
  driverCompensationVisible = false,
  pushService = null
}) {
  mkdirSync(uploadsDirectory, { recursive: true });

  return async function handler(request, response) {
    setSecurityHeaders(response);
    const url = new URL(request.url || "/", "http://localhost");

    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi({
          request,
          response,
          url,
          database,
          uploadsDirectory,
          secureCookies,
          trustProxy,
          driverCompensationVisible,
          pushService
        });
        pushService?.schedule();
        return;
      }
      await serveStatic({ request, response, url, publicDirectory });
    } catch (error) {
      if (!response.headersSent) {
        const status = error instanceof HttpError ? error.status : 500;
        sendJson(response, status, {
          error: status === 500 ? "Внутренняя ошибка сервера" : error.message,
          code: error.code || "UNEXPECTED_ERROR"
        });
      } else {
        response.destroy();
      }
      if (!(error instanceof HttpError)) console.error(error);
    }
  };
}

async function handleApi(context) {
  const { request, response, url, database } = context;
  const method = request.method || "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/health") {
    sendJson(response, 200, { ok: true, time: nowIso() });
    return;
  }

  if (method === "POST" && path === "/api/auth/login") {
    await login(context);
    return;
  }

  if (method === "POST" && path === "/api/auth/logout") {
    await logout(context);
    return;
  }

  const user = authenticate(context);

  if (method === "GET" && path === "/api/me") {
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (method === "GET" && path === "/api/push/config") {
    sendJson(response, 200, {
      enabled: Boolean(context.pushService?.enabled),
      publicKey: context.pushService?.publicKey || "",
      subscribed: userHasPushSubscription(database, user.id, user.organization_id)
    });
    return;
  }

  if (method === "POST" && path === "/api/push/subscriptions") {
    await savePushSubscription({ ...context, user });
    return;
  }

  if (method === "POST" && path === "/api/push/subscriptions/remove") {
    await removePushSubscription({ ...context, user });
    return;
  }

  if (method === "POST" && path === "/api/me/password") {
    await changeOwnPassword({ ...context, user });
    return;
  }

  if (method === "POST" && path === "/api/files") {
    await uploadFile({ ...context, user });
    return;
  }

  const fileMatch = path.match(/^\/api\/files\/([^/]+)$/);
  if (method === "GET" && fileMatch) {
    await downloadFile({ ...context, user, attachmentId: fileMatch[1] });
    return;
  }

  const discardFileMatch = path.match(/^\/api\/files\/([^/]+)\/discard$/);
  if (method === "POST" && discardFileMatch) {
    await discardUnlinkedFile({ ...context, user, attachmentId: discardFileMatch[1] });
    return;
  }

  if (path.startsWith("/api/office/")) requireRole(user, "office");
  if (path.startsWith("/api/driver/")) requireRole(user, "driver");

  if (method === "GET" && path === "/api/office/bootstrap") {
    sendJson(response, 200, officeBootstrap(context.database, user));
    return;
  }

  if (method === "GET" && path === "/api/office/report") {
    sendJson(response, 200, officeReport(context.database, user, url));
    return;
  }

  if (method === "GET" && path === "/api/driver/bootstrap") {
    sendJson(response, 200, driverBootstrap(
      context.database,
      user,
      context.driverCompensationVisible
    ));
    return;
  }

  if (method === "POST" && path === "/api/office/drivers") {
    await createDriver({ ...context, user });
    return;
  }

  if (method === "POST" && path === "/api/office/users") {
    await createOfficeUser({ ...context, user });
    return;
  }

  const userActiveMatch = path.match(/^\/api\/office\/users\/([^/]+)\/active$/);
  if (method === "POST" && userActiveMatch) {
    await setUserActive({ ...context, user, targetUserId: userActiveMatch[1] });
    return;
  }

  const userPasswordMatch = path.match(/^\/api\/office\/users\/([^/]+)\/password$/);
  if (method === "POST" && userPasswordMatch) {
    await resetUserPassword({ ...context, user, targetUserId: userPasswordMatch[1] });
    return;
  }

  if (method === "POST" && path === "/api/office/tractors") {
    await createTractor({ ...context, user });
    return;
  }

  if (method === "POST" && path === "/api/office/trailers") {
    await createTrailer({ ...context, user });
    return;
  }

  if (method === "POST" && path === "/api/office/rigs") {
    await createRig({ ...context, user });
    return;
  }

  const rigCompositionMatch = path.match(/^\/api\/office\/rigs\/([^/]+)\/composition$/);
  if (method === "POST" && rigCompositionMatch) {
    await replaceRigComposition({ ...context, user, rigId: rigCompositionMatch[1] });
    return;
  }

  if (method === "POST" && path === "/api/office/customers") {
    await createCustomer({ ...context, user });
    return;
  }

  const customerContactMatch = path.match(/^\/api\/office\/customers\/([^/]+)\/contacts$/);
  if (method === "POST" && customerContactMatch) {
    await createCustomerContact({ ...context, user, customerId: customerContactMatch[1] });
    return;
  }

  if (method === "POST" && path === "/api/office/trips") {
    await createTrip({ ...context, user });
    return;
  }

  if (method === "POST" && path === "/api/office/recurring-costs") {
    await createRecurringCost({ ...context, user });
    return;
  }

  const reverseRecurringCostMatch = path.match(/^\/api\/office\/recurring-costs\/([^/]+)\/reverse$/);
  if (method === "POST" && reverseRecurringCostMatch) {
    await reverseRecurringCost({ ...context, user, costId: reverseRecurringCostMatch[1] });
    return;
  }

  if (method === "POST" && path === "/api/office/company-expenses") {
    await createCompanyExpense({ ...context, user });
    return;
  }

  if (method === "POST" && path === "/api/office/expense-categories") {
    await createExpenseCategory({ ...context, user });
    return;
  }

  const toggleExpenseCategoryMatch = path.match(/^\/api\/office\/expense-categories\/([^/]+)\/active$/);
  if (method === "POST" && toggleExpenseCategoryMatch) {
    await setExpenseCategoryActive({
      ...context,
      user,
      categoryId: toggleExpenseCategoryMatch[1]
    });
    return;
  }

  const reverseCompanyExpenseMatch = path.match(/^\/api\/office\/company-expenses\/([^/]+)\/reverse$/);
  if (method === "POST" && reverseCompanyExpenseMatch) {
    await reverseCompanyExpense({ ...context, user, expenseId: reverseCompanyExpenseMatch[1] });
    return;
  }

  if (method === "POST" && path === "/api/office/compensation/settings") {
    await updateOrganizationCompensationSettings({ ...context, user });
    return;
  }

  const driverCompensationSettingsMatch = path.match(/^\/api\/office\/drivers\/([^/]+)\/compensation-settings$/);
  if (method === "POST" && driverCompensationSettingsMatch) {
    await updateDriverCompensationSettings({ ...context, user, driverId: driverCompensationSettingsMatch[1] });
    return;
  }

  const driverAdjustmentMatch = path.match(/^\/api\/office\/drivers\/([^/]+)\/adjustments$/);
  if (method === "POST" && driverAdjustmentMatch) {
    await createDriverBalanceAdjustment({ ...context, user, driverId: driverAdjustmentMatch[1] });
    return;
  }

  if (method === "POST" && path === "/api/office/driver-transfers") {
    await createDriverTransfer({ ...context, user });
    return;
  }

  const reverseDriverTransferMatch = path.match(/^\/api\/office\/driver-transfers\/([^/]+)\/reverse$/);
  if (method === "POST" && reverseDriverTransferMatch) {
    await reverseDriverTransfer({ ...context, user, transferId: reverseDriverTransferMatch[1] });
    return;
  }

  const tripDocumentMatch = path.match(/^\/api\/office\/trips\/([^/]+)\/documents$/);
  if (method === "POST" && tripDocumentMatch) {
    await attachTripDocument({ ...context, user, tripId: tripDocumentMatch[1] });
    return;
  }

  const tripRouteMatch = path.match(/^\/api\/office\/trips\/([^/]+)\/route$/);
  if (method === "POST" && tripRouteMatch) {
    await updateTripRoute({ ...context, user, tripId: tripRouteMatch[1] });
    return;
  }

  const tripMeasurementsMatch = path.match(/^\/api\/office\/trips\/([^/]+)\/measurements$/);
  if (method === "POST" && tripMeasurementsMatch) {
    await correctTripMeasurements({ ...context, user, tripId: tripMeasurementsMatch[1] });
    return;
  }

  const adjustmentMatch = path.match(/^\/api\/office\/trips\/([^/]+)\/adjustments$/);
  if (method === "POST" && adjustmentMatch) {
    await createRateAdjustment({ ...context, user, tripId: adjustmentMatch[1] });
    return;
  }

  const reverseAdjustmentMatch = path.match(/^\/api\/office\/trips\/([^/]+)\/adjustments\/([^/]+)\/reverse$/);
  if (method === "POST" && reverseAdjustmentMatch) {
    await reverseRateAdjustment({
      ...context,
      user,
      tripId: reverseAdjustmentMatch[1],
      adjustmentId: reverseAdjustmentMatch[2]
    });
    return;
  }

  const paymentMatch = path.match(/^\/api\/office\/trips\/([^/]+)\/payments$/);
  if (method === "POST" && paymentMatch) {
    await createPayment({ ...context, user, tripId: paymentMatch[1] });
    return;
  }

  const reversePaymentMatch = path.match(/^\/api\/office\/trips\/([^/]+)\/payments\/([^/]+)\/reverse$/);
  if (method === "POST" && reversePaymentMatch) {
    await reversePayment({
      ...context,
      user,
      tripId: reversePaymentMatch[1],
      paymentId: reversePaymentMatch[2]
    });
    return;
  }

  const confirmTripMatch = path.match(/^\/api\/office\/trips\/([^/]+)\/confirm$/);
  if (method === "POST" && confirmTripMatch) {
    await confirmTrip({ ...context, user, tripId: confirmTripMatch[1] });
    return;
  }

  const reviewExpenseMatch = path.match(/^\/api\/office\/expenses\/([^/]+)\/review$/);
  if (method === "POST" && reviewExpenseMatch) {
    await reviewExpense({ ...context, user, expenseId: reviewExpenseMatch[1] });
    return;
  }

  const readNotificationMatch = path.match(/^\/api\/driver\/notifications\/([^/]+)\/read$/);
  if (method === "POST" && readNotificationMatch) {
    await markDriverNotificationRead({ ...context, user, notificationId: readNotificationMatch[1] });
    return;
  }

  const readOfficeNotificationMatch = path.match(/^\/api\/office\/notifications\/([^/]+)\/read$/);
  if (method === "POST" && readOfficeNotificationMatch) {
    await markOfficeNotificationRead({ ...context, user, notificationId: readOfficeNotificationMatch[1] });
    return;
  }

  const explainExpenseMatch = path.match(/^\/api\/driver\/expenses\/([^/]+)\/explanations$/);
  if (method === "POST" && explainExpenseMatch) {
    await explainExpense({ ...context, user, expenseId: explainExpenseMatch[1] });
    return;
  }

  const startTripMatch = path.match(/^\/api\/driver\/trips\/([^/]+)\/start$/);
  if (method === "POST" && startTripMatch) {
    await startTrip({ ...context, user, tripId: startTripMatch[1] });
    return;
  }

  const driverExpenseMatch = path.match(/^\/api\/driver\/trips\/([^/]+)\/expenses$/);
  if (method === "POST" && driverExpenseMatch) {
    await createExpense({ ...context, user, tripId: driverExpenseMatch[1] });
    return;
  }

  const completeTripMatch = path.match(/^\/api\/driver\/trips\/([^/]+)\/complete$/);
  if (method === "POST" && completeTripMatch) {
    await completeTrip({ ...context, user, tripId: completeTripMatch[1] });
    return;
  }

  throw new HttpError(404, "Метод API не найден", "NOT_FOUND");
}

async function login({ request, response, database, secureCookies, trustProxy }) {
  const body = await readJson(request);
  const loginValue = normalizeLogin(body.login);
  const remoteAddress = clientAddress(request, trustProxy);
  const accountAttemptKey = `account-ip:${loginValue}:${remoteAddress}`;
  const ipAttemptKey = `ip:${remoteAddress}`;
  assertLoginAllowed(accountAttemptKey, LOGIN_MAX_ATTEMPTS);
  assertLoginAllowed(ipAttemptKey, LOGIN_IP_MAX_ATTEMPTS);
  const user = database.prepare(`
    SELECT * FROM users
    WHERE login = ? AND is_active = 1
    ORDER BY created_at ASC
    LIMIT 1
  `).get(loginValue);

  const releaseLoginSlot = reserveLoginVerification(remoteAddress);
  let passwordMatches;
  try {
    passwordMatches = await verifyPassword(body.password, user?.password_hash || DUMMY_PASSWORD_HASH);
  } finally {
    releaseLoginSlot();
  }
  if (!user || !passwordMatches) {
    recordLoginFailure(accountAttemptKey);
    recordLoginFailure(ipAttemptKey);
    throw new HttpError(401, "Неверный логин или пароль", "INVALID_CREDENTIALS");
  }

  loginAttempts.delete(accountAttemptKey);
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());

  const token = createSessionToken();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  database.prepare(`
    INSERT INTO sessions(token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(hashSessionToken(token), user.id, expiresAt, createdAt);

  response.setHeader("Set-Cookie", sessionCookie(token, { secure: secureCookies }));
  sendJson(response, 200, { user: publicUser(user) });
}

function clientAddress(request, trustProxy) {
  if (trustProxy) {
    const forwarded = String(request.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
    if (forwarded) return forwarded.slice(0, 100);
  }
  return String(request.socket.remoteAddress || "unknown").slice(0, 100);
}

function reserveLoginVerification(remoteAddress) {
  const activeForIp = loginInFlightByIp.get(remoteAddress) || 0;
  if (loginInFlight + passwordWorkInFlight >= LOGIN_MAX_IN_FLIGHT || activeForIp >= LOGIN_IP_MAX_IN_FLIGHT) {
    throw new HttpError(429, "Слишком много одновременных попыток входа", "LOGIN_BUSY");
  }
  loginInFlight += 1;
  loginInFlightByIp.set(remoteAddress, activeForIp + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    loginInFlight = Math.max(0, loginInFlight - 1);
    const remaining = (loginInFlightByIp.get(remoteAddress) || 1) - 1;
    if (remaining > 0) loginInFlightByIp.set(remoteAddress, remaining);
    else loginInFlightByIp.delete(remoteAddress);
  };
}

function reservePasswordWork(userId) {
  const activeForUser = passwordWorkInFlightByUser.get(userId) || 0;
  if (loginInFlight + passwordWorkInFlight >= LOGIN_MAX_IN_FLIGHT || activeForUser >= 2) {
    throw new HttpError(429, "Слишком много одновременных операций с паролем", "PASSWORD_BUSY");
  }
  passwordWorkInFlight += 1;
  passwordWorkInFlightByUser.set(userId, activeForUser + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    passwordWorkInFlight = Math.max(0, passwordWorkInFlight - 1);
    const remaining = (passwordWorkInFlightByUser.get(userId) || 1) - 1;
    if (remaining > 0) passwordWorkInFlightByUser.set(userId, remaining);
    else passwordWorkInFlightByUser.delete(userId);
  };
}

function assertLoginAllowed(key, maximum) {
  const current = loginAttempts.get(key);
  if (!current) return;
  if (current.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return;
  }
  if (current.count >= maximum) {
    throw new HttpError(429, "Слишком много попыток входа. Повторите через 15 минут", "LOGIN_RATE_LIMITED");
  }
}

function recordLoginFailure(key) {
  pruneLoginAttempts();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= Date.now()) {
    loginAttempts.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
}

function pruneLoginAttempts() {
  if (loginAttempts.size < 2000) return;
  const timestamp = Date.now();
  for (const [key, value] of loginAttempts) {
    if (value.resetAt <= timestamp) loginAttempts.delete(key);
  }
  while (loginAttempts.size > 2000) loginAttempts.delete(loginAttempts.keys().next().value);
}

async function logout({ request, response, database, secureCookies }) {
  const token = parseCookies(request.headers.cookie).anb_session;
  if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
  response.setHeader("Set-Cookie", clearSessionCookie({ secure: secureCookies }));
  sendJson(response, 200, { ok: true });
}

async function changeOwnPassword({ request, response, database, secureCookies, user }) {
  const body = await readJson(request);
  const currentPassword = String(body.currentPassword || "");
  const nextPassword = passwordValue(body.newPassword);
  if (currentPassword === nextPassword) {
    throw new HttpError(400, "Новый пароль должен отличаться от текущего", "PASSWORD_NOT_CHANGED");
  }
  const releasePasswordWork = reservePasswordWork(user.id);
  let passwordHash;
  try {
    const currentMatches = await verifyPassword(currentPassword, user.password_hash);
    if (!currentMatches) throw new HttpError(401, "Текущий пароль указан неверно", "INVALID_CURRENT_PASSWORD");
    passwordHash = await hashPasswordAsync(nextPassword);
  } finally {
    releasePasswordWork();
  }
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
      .run(passwordHash, timestamp, user.id);
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    audit(database, event(user, "user", user.id, "password_changed", null, { sessionsRevoked: true }));
  });
  response.setHeader("Set-Cookie", clearSessionCookie({ secure: secureCookies }));
  sendJson(response, 200, { ok: true });
}

function authenticate({ request, database }) {
  const token = parseCookies(request.headers.cookie).anb_session;
  if (!token) throw new HttpError(401, "Требуется вход", "AUTH_REQUIRED");
  const user = database.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1
  `).get(hashSessionToken(token), nowIso());
  if (!user) throw new HttpError(401, "Сессия истекла", "SESSION_EXPIRED");
  return user;
}

function requireRole(user, role) {
  if (user.role !== role) throw new HttpError(403, "Недостаточно прав", "FORBIDDEN");
}

async function createDriver({ request, response, database, user }) {
  const body = await readJson(request);
  const fullName = requiredText(body.fullName, "ФИО водителя", 160);
  const loginValue = normalizeLogin(requiredText(body.login, "Логин", 100));
  const id = entityId("usr");
  const timestamp = nowIso();
  const releasePasswordWork = reservePasswordWork(user.id);
  let passwordHash;
  try {
    passwordHash = await hashPasswordAsync(passwordValue(body.password));
  } finally {
    releasePasswordWork();
  }

  try {
    transaction(database, () => {
      database.prepare(`
        INSERT INTO users(
          id, organization_id, role, login, password_hash, full_name,
          phone, birth_date, is_active, created_at, updated_at
        ) VALUES (?, ?, 'driver', ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id, user.organization_id, loginValue, passwordHash, fullName,
        optionalText(body.phone, 40), optionalDate(body.birthDate), timestamp, timestamp
      );
      const created = database.prepare("SELECT * FROM users WHERE id = ?").get(id);
      audit(database, event(user, "user", id, "driver_created", null, publicUser(created)));
    });
  } catch (error) {
    throw constraintError(error, "Водитель с таким логином уже существует");
  }

  const created = database.prepare("SELECT * FROM users WHERE id = ?").get(id);
  sendJson(response, 201, { driver: publicUser(created) });
}

async function createOfficeUser({ request, response, database, user }) {
  const body = await readJson(request);
  const fullName = requiredText(body.fullName, "ФИО сотрудника", 160);
  const loginValue = normalizeLogin(requiredText(body.login, "Логин", 100));
  const id = entityId("usr");
  const timestamp = nowIso();
  const releasePasswordWork = reservePasswordWork(user.id);
  let passwordHash;
  try {
    passwordHash = await hashPasswordAsync(passwordValue(body.password));
  } finally {
    releasePasswordWork();
  }

  try {
    transaction(database, () => {
      database.prepare(`
        INSERT INTO users(
          id, organization_id, role, login, password_hash, full_name,
          phone, is_active, created_at, updated_at
        ) VALUES (?, ?, 'office', ?, ?, ?, ?, 1, ?, ?)
      `).run(
        id, user.organization_id, loginValue, passwordHash, fullName,
        optionalText(body.phone, 40), timestamp, timestamp
      );
      const created = database.prepare("SELECT * FROM users WHERE id = ?").get(id);
      audit(database, event(user, "user", id, "office_user_created", null, publicUser(created)));
    });
  } catch (error) {
    throw constraintError(error, "Сотрудник с таким логином уже существует");
  }

  const created = database.prepare("SELECT * FROM users WHERE id = ?").get(id);
  sendJson(response, 201, { officeUser: publicUser(created) });
}

async function setUserActive({ request, response, database, user, targetUserId }) {
  const target = database.prepare("SELECT * FROM users WHERE id = ? AND organization_id = ?")
    .get(targetUserId, user.organization_id);
  if (!target) throw new HttpError(404, "Пользователь не найден", "NOT_FOUND");
  const body = await readJson(request);
  if (typeof body.active !== "boolean") {
    throw new HttpError(400, "Укажите состояние учётной записи", "VALIDATION_ERROR");
  }
  const active = body.active;
  const reason = active ? optionalText(body.reason, 1000) : requiredText(body.reason, "Причина деактивации", 1000);
  if (!active && target.id === user.id) {
    throw new HttpError(409, "Нельзя отключить собственную учётную запись", "CANNOT_DEACTIVATE_SELF");
  }
  if (!active && target.role === "office") {
    const otherOffices = database.prepare(`
      SELECT COUNT(*) AS count FROM users
      WHERE organization_id = ? AND role = 'office' AND is_active = 1 AND id != ?
    `).get(user.organization_id, target.id);
    if (Number(otherOffices.count) === 0) {
      throw new HttpError(409, "В компании должен остаться хотя бы один активный сотрудник офиса", "LAST_OFFICE_USER");
    }
  }
  if (!active && target.role === "driver") {
    const assignedTrip = database.prepare(`
      SELECT id FROM trips WHERE organization_id = ? AND driver_id = ?
        AND status IN ('assigned', 'awaiting_loading', 'in_progress') LIMIT 1
    `).get(user.organization_id, target.id);
    if (assignedTrip) {
      throw new HttpError(409, "Сначала переназначьте незавершённые рейсы водителя", "DRIVER_HAS_OPEN_TRIPS");
    }
    const activeRig = database.prepare(`
      SELECT id FROM rig_periods WHERE organization_id = ? AND driver_id = ? AND valid_to IS NULL LIMIT 1
    `).get(user.organization_id, target.id);
    if (activeRig) {
      throw new HttpError(409, "Сначала замените водителя в составе сцепки", "DRIVER_ASSIGNED_TO_RIG");
    }
  }
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?")
      .run(active ? 1 : 0, timestamp, target.id);
    if (!active) database.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    audit(database, event(user, "user", target.id, active ? "activated" : "deactivated",
      publicUser(target), { ...publicUser(target), isActive: active }, reason));
  });
  const updated = database.prepare("SELECT * FROM users WHERE id = ?").get(target.id);
  sendJson(response, 200, { user: publicUser(updated) });
}

async function resetUserPassword({ request, response, database, user, targetUserId }) {
  const target = database.prepare("SELECT * FROM users WHERE id = ? AND organization_id = ?")
    .get(targetUserId, user.organization_id);
  if (!target) throw new HttpError(404, "Пользователь не найден", "NOT_FOUND");
  const body = await readJson(request);
  const releasePasswordWork = reservePasswordWork(user.id);
  let passwordHash;
  try {
    passwordHash = await hashPasswordAsync(passwordValue(body.password));
  } finally {
    releasePasswordWork();
  }
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
      .run(passwordHash, timestamp, target.id);
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    audit(database, event(user, "user", target.id, "password_reset", null, {
      sessionsRevoked: true
    }, optionalText(body.reason, 1000)));
  });
  sendJson(response, 200, { ok: true, signedOut: target.id === user.id });
}

async function createTractor({ request, response, database, user }) {
  const body = await readJson(request);
  const id = entityId("trc");
  const timestamp = nowIso();
  try {
    database.prepare(`
      INSERT INTO tractors(
        id, organization_id, brand, model, plate_number, vin, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user.organization_id,
      requiredText(body.brand, "Марка тягача", 100),
      optionalText(body.model, 100),
      requiredText(body.plateNumber, "Госномер тягача", 30).toUpperCase(),
      optionalText(body.vin, 40).toUpperCase(),
      optionalText(body.notes, 1000),
      timestamp,
      timestamp
    );
  } catch (error) {
    throw constraintError(error, "Тягач с таким госномером уже существует");
  }
  const tractor = database.prepare("SELECT * FROM tractors WHERE id = ?").get(id);
  audit(database, event(user, "tractor", id, "created", null, tractor));
  sendJson(response, 201, { tractor });
}

async function createTrailer({ request, response, database, user }) {
  const body = await readJson(request);
  const id = entityId("trl");
  const timestamp = nowIso();
  try {
    database.prepare(`
      INSERT INTO trailers(
        id, organization_id, brand, model, plate_number, axles,
        capacity_kg, trailer_type, oversized_notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      user.organization_id,
      requiredText(body.brand, "Марка трала", 100),
      optionalText(body.model, 100),
      requiredText(body.plateNumber, "Госномер трала", 30).toUpperCase(),
      optionalPositiveInteger(body.axles),
      optionalNonNegativeInteger(body.capacityKg),
      optionalText(body.trailerType, 100),
      optionalText(body.oversizedNotes, 1000),
      timestamp,
      timestamp
    );
  } catch (error) {
    throw constraintError(error, "Трал с таким госномером уже существует");
  }
  const trailer = database.prepare("SELECT * FROM trailers WHERE id = ?").get(id);
  audit(database, event(user, "trailer", id, "created", null, trailer));
  sendJson(response, 201, { trailer });
}

async function createRig({ request, response, database, user }) {
  const body = await readJson(request);
  const tractor = ownedRow(database, "tractors", body.tractorId, user.organization_id, "Тягач не найден");
  const trailer = ownedRow(database, "trailers", body.trailerId, user.organization_id, "Трал не найден");
  const driver = body.driverId
    ? ownedDriver(database, body.driverId, user.organization_id)
    : null;
  const rigId = entityId("rig");
  const periodId = entityId("rgp");
  const timestamp = nowIso();

  try {
    transaction(database, () => {
      database.prepare(`
        INSERT INTO rigs(id, organization_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(rigId, user.organization_id, requiredText(body.name, "Название сцепки", 120), timestamp, timestamp);
      database.prepare(`
        INSERT INTO rig_periods(
          id, organization_id, rig_id, tractor_id, trailer_id, driver_id,
          valid_from, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        periodId,
        user.organization_id,
        rigId,
        tractor.id,
        trailer.id,
        driver?.id || null,
        timestamp,
        user.id,
        timestamp
      );
      audit(database, event(user, "rig", rigId, "created", null, {
        name: body.name,
        tractorId: tractor.id,
        trailerId: trailer.id,
        driverId: driver?.id || null
      }));
    });
  } catch (error) {
    throw constraintError(error, "Тягач, трал или водитель уже входят в другую активную сцепку");
  }

  sendJson(response, 201, { rig: getRig(database, rigId, user.organization_id) });
}

async function replaceRigComposition({ request, response, database, user, rigId }) {
  ownedRow(database, "rigs", rigId, user.organization_id, "Сцепка не найдена");
  const activeTrip = database.prepare(`
    SELECT id FROM trips
    WHERE organization_id = ? AND rig_id = ? AND status = 'in_progress'
    LIMIT 1
  `).get(user.organization_id, rigId);
  if (activeTrip) {
    throw new HttpError(409, "Нельзя менять состав сцепки во время активного рейса", "RIG_HAS_ACTIVE_TRIP");
  }
  const body = await readJson(request);
  const tractor = ownedRow(database, "tractors", body.tractorId, user.organization_id, "Тягач не найден");
  const trailer = ownedRow(database, "trailers", body.trailerId, user.organization_id, "Трал не найден");
  const driver = body.driverId ? ownedDriver(database, body.driverId, user.organization_id) : null;
  const current = database.prepare(`
    SELECT * FROM rig_periods WHERE rig_id = ? AND organization_id = ? AND valid_to IS NULL
  `).get(rigId, user.organization_id);
  const pendingTrips = database.prepare(`
    SELECT id, driver_id, loading_address, unloading_address, planned_loading_date
    FROM trips
    WHERE organization_id = ? AND rig_id = ? AND status IN ('assigned', 'awaiting_loading')
  `).all(user.organization_id, rigId);
  if (pendingTrips.length && !driver) {
    throw new HttpError(409, "У сцепки есть назначенные рейсы: сначала выберите водителя", "DRIVER_REQUIRED_FOR_ASSIGNED_TRIPS");
  }
  const timestamp = nowIso();
  const nextPeriodId = entityId("rgp");

  try {
    transaction(database, () => {
      if (current) database.prepare("UPDATE rig_periods SET valid_to = ? WHERE id = ?").run(timestamp, current.id);
      database.prepare(`
        INSERT INTO rig_periods(
          id, organization_id, rig_id, tractor_id, trailer_id, driver_id,
          valid_from, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nextPeriodId, user.organization_id, rigId, tractor.id, trailer.id,
        driver?.id || null, timestamp, user.id, timestamp
      );
      if (pendingTrips.length) {
        database.prepare(`
          UPDATE trips
          SET rig_period_id = ?, driver_id = ?, tractor_id = ?, trailer_id = ?,
              row_version = row_version + 1, updated_at = ?
          WHERE organization_id = ? AND rig_id = ? AND status IN ('assigned', 'awaiting_loading')
        `).run(
          nextPeriodId, driver.id, tractor.id, trailer.id, timestamp,
          user.organization_id, rigId
        );
        if (pendingTrips.some((trip) => trip.driver_id !== driver.id)) {
          for (const trip of pendingTrips) {
            createNotification(database, {
              organizationId: user.organization_id,
              recipientUserId: driver.id,
              type: "trip_reassigned",
              title: "Вам переназначен рейс",
              message: `${trip.loading_address} → ${trip.unloading_address}, погрузка ${trip.planned_loading_date}`,
              entityType: "trip",
              entityId: trip.id
            });
          }
        }
      }
      database.prepare("UPDATE rigs SET updated_at = ? WHERE id = ?").run(timestamp, rigId);
      audit(database, event(user, "rig", rigId, "composition_replaced", current, {
        tractorId: tractor.id,
        trailerId: trailer.id,
        driverId: driver?.id || null,
        reassignedTripIds: pendingTrips.map((trip) => trip.id),
        validFrom: timestamp
      }));
    });
  } catch (error) {
    throw constraintError(error, "Тягач, трал или водитель уже входят в другую активную сцепку");
  }
  sendJson(response, 200, { rig: getRig(database, rigId, user.organization_id) });
}

async function createCustomer({ request, response, database, user }) {
  const body = await readJson(request);
  const id = entityId("cus");
  const timestamp = nowIso();
  database.prepare(`
    INSERT INTO customers(
      id, organization_id, short_name, full_name, inn,
      default_payment_term_days, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    user.organization_id,
    requiredText(body.shortName, "Название заказчика", 160),
    optionalText(body.fullName, 300),
    optionalText(body.inn, 20),
    body.defaultPaymentTermDays == null ? null : nonNegativeInteger(body.defaultPaymentTermDays, "Срок оплаты"),
    timestamp,
    timestamp
  );
  const customer = database.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  audit(database, event(user, "customer", id, "created", null, customer));
  sendJson(response, 201, { customer });
}

async function createCustomerContact({ request, response, database, user, customerId }) {
  ownedRow(database, "customers", customerId, user.organization_id, "Заказчик не найден");
  const body = await readJson(request);
  const contactId = entityId("cnt");
  const timestamp = nowIso();
  const phones = Array.isArray(body.phones) ? body.phones.slice(0, 10) : [];

  transaction(database, () => {
    database.prepare(`
      INSERT INTO customer_contacts(
        id, organization_id, customer_id, full_name, position, email, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contactId,
      user.organization_id,
      customerId,
      requiredText(body.fullName, "Контактное лицо", 160),
      optionalText(body.position, 120),
      optionalText(body.email, 200),
      optionalText(body.notes, 1000),
      timestamp
    );
    const insertPhone = database.prepare(`
      INSERT INTO customer_contact_phones(id, organization_id, contact_id, phone, label, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const phone of phones) {
      const value = typeof phone === "string" ? phone : phone?.phone;
      if (!String(value || "").trim()) continue;
      insertPhone.run(
        entityId("phn"), user.organization_id, contactId,
        requiredText(value, "Телефон", 40), optionalText(phone?.label, 60), timestamp
      );
    }
    audit(database, event(user, "customer_contact", contactId, "created", null, {
      customerId,
      fullName: body.fullName,
      phones
    }));
  });

  sendJson(response, 201, { contact: getContact(database, contactId, user.organization_id) });
}

async function createTrip({ request, response, database, user }) {
  const body = await readJson(request);
  const customer = ownedRow(database, "customers", body.customerId, user.organization_id, "Заказчик не найден");
  const rig = ownedRow(database, "rigs", body.rigId, user.organization_id, "Сцепка не найдена");
  const period = database.prepare(`
    SELECT * FROM rig_periods
    WHERE rig_id = ? AND organization_id = ? AND valid_to IS NULL
  `).get(rig.id, user.organization_id);
  if (!period) throw new HttpError(409, "У сцепки нет активного состава", "RIG_NOT_READY");
  if (!period.driver_id) throw new HttpError(409, "У сцепки не назначен водитель", "DRIVER_NOT_ASSIGNED");

  const id = entityId("trp");
  const timestamp = nowIso();
  const rate = toKopecks(nonNegativeInteger(body.agreedRateKopecks, "Ставка рейса"));
  const vatMode = enumValue(body.vatMode, ["with_vat", "without_vat"], "Режим НДС");
  const paymentMethod = enumValue(body.paymentMethod, ["bank", "cash", "card_transfer"], "Способ оплаты");
  const paymentTermDays = body.paymentTermDays == null
    ? Number(customer.default_payment_term_days || 0)
    : nonNegativeInteger(body.paymentTermDays, "Срок оплаты");
  const loadingAddress = requiredText(body.loadingAddress, "Адрес погрузки", 500);
  const unloadingAddress = requiredText(body.unloadingAddress, "Адрес разгрузки", 500);
  const plannedLoadingDate = requiredDate(body.plannedLoadingDate, "Дата погрузки");
  if (body.additionalUnloadingStops != null && !Array.isArray(body.additionalUnloadingStops)) {
    throw new HttpError(400, "Дополнительные точки разгрузки должны быть списком", "VALIDATION_ERROR");
  }
  const additionalStops = (body.additionalUnloadingStops || []).slice(0, 10).map((stop, index) => ({
    address: requiredText(typeof stop === "string" ? stop : stop?.address, `Точка разгрузки ${index + 2}`, 500),
    isApproximate: typeof stop === "object" && stop?.isApproximate ? 1 : 0,
    notes: typeof stop === "object" ? optionalText(stop?.notes, 1000) : ""
  }));
  if ((body.additionalUnloadingStops || []).length > 10) {
    throw new HttpError(400, "Можно указать не более 10 дополнительных точек", "VALIDATION_ERROR");
  }

  transaction(database, () => {
    database.prepare(`
      INSERT INTO trips(
        id, organization_id, number, customer_id, rig_id, rig_period_id,
        driver_id, tractor_id, trailer_id, loading_address, planned_loading_date,
        unloading_address, unloading_address_is_approximate, cargo_description,
        driver_instructions, agreed_rate_kopecks, vat_mode, vat_rate_basis_points,
        payment_method, payment_term_days,
        salary_rate_override_kopecks_per_km, daily_rate_override_kopecks,
        status, assigned_at,
        created_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'assigned', ?, ?, ?, ?
      )
    `).run(
      id,
      user.organization_id,
      optionalText(body.number, 80),
      customer.id,
      rig.id,
      period.id,
      period.driver_id,
      period.tractor_id,
      period.trailer_id,
      loadingAddress,
      plannedLoadingDate,
      unloadingAddress,
      body.unloadingAddressIsApproximate ? 1 : 0,
      optionalText(body.cargoDescription, 2000),
      optionalText(body.driverInstructions, 3000),
      rate,
      vatMode,
      nonNegativeInteger(body.vatRateBasisPoints ?? 2200, "Ставка НДС"),
      paymentMethod,
      paymentTermDays,
      optionalNonNegativeInteger(body.salaryRateOverrideKopecksPerKm),
      optionalNonNegativeInteger(body.dailyRateOverrideKopecks),
      timestamp,
      user.id,
      timestamp,
      timestamp
    );
    const insertStop = database.prepare(`
      INSERT INTO trip_stops(
        id, organization_id, trip_id, stop_order, stop_type,
        address, is_approximate, notes, created_at
      ) VALUES (?, ?, ?, ?, 'unloading', ?, ?, ?, ?)
    `);
    additionalStops.forEach((stop, index) => insertStop.run(
      entityId("stp"), user.organization_id, id, index + 1,
      stop.address, stop.isApproximate, stop.notes, timestamp
    ));
    audit(database, event(user, "trip", id, "created_and_assigned", null, {
      customerId: customer.id,
      rigId: rig.id,
      additionalStops
    }));
    createNotification(database, {
      organizationId: user.organization_id,
      recipientUserId: period.driver_id,
      type: "trip_assigned",
      title: "Назначен новый рейс",
      message: `${loadingAddress} → ${unloadingAddress}, погрузка ${plannedLoadingDate}`,
      entityType: "trip",
      entityId: id
    });
  });
  sendJson(response, 201, { trip: getOfficeTrip(database, id, user.organization_id) });
}

async function updateTripRoute({ request, response, database, user, tripId }) {
  const trip = ownedRow(database, "trips", tripId, user.organization_id, "Рейс не найден");
  if (["confirmed", "closed"].includes(trip.status)) {
    throw new HttpError(409, "Подтверждённый рейс нельзя менять без отдельной корректировки", "TRIP_ALREADY_CONFIRMED");
  }
  const body = await readJson(request);
  if (body.additionalUnloadingStops != null && !Array.isArray(body.additionalUnloadingStops)) {
    throw new HttpError(400, "Дополнительные точки разгрузки должны быть списком", "VALIDATION_ERROR");
  }
  if ((body.additionalUnloadingStops || []).length > 10) {
    throw new HttpError(400, "Можно указать не более 10 дополнительных точек", "VALIDATION_ERROR");
  }
  const loadingAddress = body.loadingAddress == null
    ? trip.loading_address
    : requiredText(body.loadingAddress, "Адрес погрузки", 500);
  if (!["assigned", "awaiting_loading"].includes(trip.status) && loadingAddress !== trip.loading_address) {
    throw new HttpError(409, "После начала рейса адрес погрузки менять нельзя", "TRIP_ALREADY_STARTED");
  }
  const unloadingAddress = requiredText(body.unloadingAddress, "Адрес разгрузки", 500);
  const stops = (body.additionalUnloadingStops || []).map((stop, index) => ({
    address: requiredText(typeof stop === "string" ? stop : stop?.address, `Точка разгрузки ${index + 2}`, 500),
    isApproximate: typeof stop === "object" && stop?.isApproximate ? 1 : 0,
    notes: typeof stop === "object" ? optionalText(stop?.notes, 1000) : ""
  }));
  const beforeStops = database.prepare(`
    SELECT stop_order, address, is_approximate, notes FROM trip_stops
    WHERE trip_id = ? ORDER BY stop_order
  `).all(trip.id);
  const reason = requiredText(body.reason, "Причина изменения маршрута", 1000);
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare(`
      UPDATE trips SET loading_address = ?, unloading_address = ?,
        unloading_address_is_approximate = ?, driver_instructions = ?,
        row_version = row_version + 1, updated_at = ? WHERE id = ?
    `).run(
      loadingAddress,
      unloadingAddress,
      body.unloadingAddressIsApproximate ? 1 : 0,
      body.driverInstructions == null ? trip.driver_instructions : optionalText(body.driverInstructions, 3000),
      timestamp,
      trip.id
    );
    database.prepare("DELETE FROM trip_stops WHERE trip_id = ?").run(trip.id);
    const insertStop = database.prepare(`
      INSERT INTO trip_stops(
        id, organization_id, trip_id, stop_order, stop_type,
        address, is_approximate, notes, created_at
      ) VALUES (?, ?, ?, ?, 'unloading', ?, ?, ?, ?)
    `);
    stops.forEach((stop, index) => insertStop.run(
      entityId("stp"), user.organization_id, trip.id, index + 1,
      stop.address, stop.isApproximate, stop.notes, timestamp
    ));
    audit(database, event(user, "trip", trip.id, "route_updated", {
      loadingAddress: trip.loading_address,
      unloadingAddress: trip.unloading_address,
      unloadingAddressIsApproximate: Boolean(trip.unloading_address_is_approximate),
      stops: beforeStops
    }, {
      loadingAddress,
      unloadingAddress,
      unloadingAddressIsApproximate: Boolean(body.unloadingAddressIsApproximate),
      stops
    }, reason));
    createNotification(database, {
      organizationId: user.organization_id,
      recipientUserId: trip.driver_id,
      type: "trip_route_updated",
      title: "Маршрут рейса изменён",
      message: `${loadingAddress} → ${unloadingAddress}. ${reason}`,
      entityType: "trip",
      entityId: trip.id
    });
  });
  sendJson(response, 200, { trip: getOfficeTrip(database, trip.id, user.organization_id) });
}

async function correctTripMeasurements({ request, response, database, user, tripId }) {
  const trip = ownedRow(database, "trips", tripId, user.organization_id, "Рейс не найден");
  if (!["pending_review", "needs_explanation"].includes(trip.status)) {
    throw new HttpError(409, "Пробег можно исправить только до подтверждения рейса", "INVALID_TRIP_STATUS");
  }
  const start = database.prepare("SELECT * FROM odometer_readings WHERE trip_id = ? AND reading_type = 'start'").get(trip.id);
  const finish = database.prepare("SELECT * FROM odometer_readings WHERE trip_id = ? AND reading_type = 'end'").get(trip.id);
  if (!start || !finish) throw new HttpError(409, "Не найдены оба показания одометра", "ODOMETER_MISSING");
  const body = await readJson(request);
  const startOdometerKm = nonNegativeInteger(body.startOdometerKm, "Начальный пробег");
  const endOdometerKm = nonNegativeInteger(body.endOdometerKm, "Конечный пробег");
  if (endOdometerKm < startOdometerKm) {
    throw new HttpError(400, "Конечный пробег не может быть меньше начального", "INVALID_ODOMETER");
  }
  const loadedAt = requiredDateTime(body.loadedAt, "Дата и время загрузки");
  const unloadedAt = requiredDateTime(body.unloadedAt, "Дата и время разгрузки");
  if (new Date(unloadedAt).getTime() < new Date(loadedAt).getTime()) {
    throw new HttpError(400, "Разгрузка не может быть раньше загрузки", "INVALID_TRIP_TIMELINE");
  }
  const reason = requiredText(body.reason, "Причина исправления", 2000);
  const distanceKm = endOdometerKm - startOdometerKm;
  const elapsedHours = (new Date(unloadedAt).getTime() - new Date(loadedAt).getTime()) / 3600000;
  const endFlags = [{ code: "office_corrected" }];
  if (distanceKm === 0) endFlags.push({ code: "zero_trip_distance" });
  if (distanceKm > 5000) endFlags.push({ code: "unusually_large_trip_distance", distanceKm });
  if ((elapsedHours <= 0 && distanceKm > 0) || (elapsedHours > 0 && distanceKm / elapsedHours > 110)) {
    endFlags.push({
      code: "impossible_average_speed",
      averageSpeedKmh: elapsedHours > 0 ? Math.round(distanceKm / elapsedHours) : null
    });
  }
  const before = {
    loadedAt: trip.loaded_at,
    unloadedAt: trip.unloaded_at,
    startOdometerKm: start.entered_value_km,
    endOdometerKm: finish.entered_value_km
  };
  const after = { loadedAt, unloadedAt, startOdometerKm, endOdometerKm, distanceKm };
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare(`
      UPDATE odometer_readings SET entered_value_km = ?, captured_at = ?,
        risk_flags_json = ? WHERE id = ?
    `).run(startOdometerKm, loadedAt, JSON.stringify([{ code: "office_corrected" }]), start.id);
    database.prepare(`
      UPDATE odometer_readings SET entered_value_km = ?, captured_at = ?,
        risk_flags_json = ? WHERE id = ?
    `).run(endOdometerKm, unloadedAt, JSON.stringify(endFlags), finish.id);
    database.prepare(`
      UPDATE trips SET loaded_at = ?, unloaded_at = ?, status = 'pending_review',
        row_version = row_version + 1, updated_at = ? WHERE id = ?
    `).run(loadedAt, unloadedAt, timestamp, trip.id);
    audit(database, event(user, "trip", trip.id, "measurements_corrected", before, after, reason));
  });
  sendJson(response, 200, { trip: getOfficeTrip(database, trip.id, user.organization_id) });
}

async function attachTripDocument({ request, response, database, user, tripId }) {
  const trip = ownedRow(database, "trips", tripId, user.organization_id, "Рейс не найден");
  const body = await readJson(request);
  const attachment = ownedRow(database, "attachments", body.attachmentId, user.organization_id, "Файл не найден");
  if (!["trip_document", "contract_application"].includes(attachment.kind)) {
    throw new HttpError(400, "Этот файл не является документом рейса", "INVALID_ATTACHMENT_KIND");
  }
  const current = database.prepare("SELECT COALESCE(MAX(version_number), 0) AS version FROM trip_documents WHERE trip_id = ?").get(tripId);
  const id = entityId("doc");
  database.prepare(`
    INSERT INTO trip_documents(
      id, organization_id, trip_id, customer_id, attachment_id,
      document_type, version_number, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, user.organization_id, tripId, trip.customer_id, attachment.id,
    optionalText(body.documentType, 80) || "contract_application",
    Number(current.version) + 1, user.id, nowIso()
  );
  audit(database, event(user, "trip_document", id, "attached", null, { tripId, attachmentId: attachment.id }));
  sendJson(response, 201, { documentId: id });
}

async function createRecurringCost({ request, response, database, user }) {
  const body = await readJson(request);
  const subjectType = enumValue(body.subjectType, ["rig"], "Объект постоянного расхода");
  const subject = ownedRow(database, "rigs", body.subjectId, user.organization_id, "Сцепка не найдена");
  const allocationMode = enumValue(body.allocationMode, ["monthly", "equal_months"], "Способ распределения");
  const allocationMonths = allocationMode === "monthly"
    ? 1
    : positiveInteger(body.allocationMonths, "Количество месяцев");
  if (allocationMonths > 120) {
    throw new HttpError(400, "Период распределения не может превышать 120 месяцев", "VALIDATION_ERROR");
  }
  const validFrom = requiredDate(body.validFrom, "Дата начала");
  const validTo = body.validTo ? requiredDate(body.validTo, "Дата окончания") : null;
  if (validTo && validTo < validFrom) {
    throw new HttpError(400, "Дата окончания не может быть раньше даты начала", "INVALID_COST_PERIOD");
  }
  const clientMutationId = optionalText(body.clientMutationId, 100) || entityId("mut");
  const id = entityId("rco");
  const recurringCost = {
    id,
    organizationId: user.organization_id,
    subjectType,
    subjectId: subject.id,
    category: requiredText(body.category, "Категория расхода", 120),
    totalAmountKopecks: toKopecks(positiveInteger(body.totalAmountKopecks, "Сумма")),
    allocationMode,
    allocationMonths,
    validFrom,
    validTo,
    comment: optionalText(body.comment, 1000),
    createdAt: nowIso()
  };
  const duplicate = database.prepare(`
    SELECT * FROM recurring_costs WHERE organization_id = ? AND client_mutation_id = ?
  `).get(user.organization_id, clientMutationId);
  if (duplicate) {
    const sameMutation = duplicate.subject_type === recurringCost.subjectType
      && duplicate.subject_id === recurringCost.subjectId
      && duplicate.category === recurringCost.category
      && Number(duplicate.total_amount_kopecks) === recurringCost.totalAmountKopecks
      && duplicate.allocation_mode === recurringCost.allocationMode
      && Number(duplicate.allocation_months) === recurringCost.allocationMonths
      && duplicate.valid_from === recurringCost.validFrom
      && (duplicate.valid_to || null) === recurringCost.validTo
      && duplicate.comment === recurringCost.comment;
    if (!sameMutation) {
      throw new HttpError(409, "Идентификатор операции уже использован", "MUTATION_CONFLICT");
    }
    sendJson(response, 200, { recurringCost: duplicate, duplicate: true });
    return;
  }

  transaction(database, () => {
    database.prepare(`
      INSERT INTO recurring_costs(
        id, organization_id, subject_type, subject_id, category,
        total_amount_kopecks, allocation_mode, allocation_months,
        valid_from, valid_to, comment, client_mutation_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      recurringCost.id,
      recurringCost.organizationId,
      recurringCost.subjectType,
      recurringCost.subjectId,
      recurringCost.category,
      recurringCost.totalAmountKopecks,
      recurringCost.allocationMode,
      recurringCost.allocationMonths,
      recurringCost.validFrom,
      recurringCost.validTo,
      recurringCost.comment,
      clientMutationId,
      user.id,
      recurringCost.createdAt
    );
    audit(database, event(user, "recurring_cost", id, "created", null, recurringCost));
  });
  sendJson(response, 201, { recurringCost: database.prepare("SELECT * FROM recurring_costs WHERE id = ?").get(id) });
}

async function reverseRecurringCost({ request, response, database, user, costId }) {
  const body = await readJson(request);
  const cost = database.prepare(`
    SELECT * FROM recurring_costs WHERE id = ? AND organization_id = ?
  `).get(costId, user.organization_id);
  if (!cost) throw new HttpError(404, "Постоянный расход не найден", "NOT_FOUND");
  if (cost.reversed_at) throw new HttpError(409, "Постоянный расход уже отменён", "ALREADY_REVERSED");
  const reason = requiredText(body.reason, "Причина отмены", 2000);
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare(`
      UPDATE recurring_costs
      SET reversed_at = ?, reversed_by = ?, reversal_reason = ?
      WHERE id = ? AND reversed_at IS NULL
    `).run(timestamp, user.id, reason, cost.id);
    const after = database.prepare("SELECT * FROM recurring_costs WHERE id = ?").get(cost.id);
    audit(database, event(user, "recurring_cost", cost.id, "reversed", cost, after, reason));
  });
  sendJson(response, 200, {
    recurringCost: database.prepare("SELECT * FROM recurring_costs WHERE id = ?").get(cost.id)
  });
}

async function createCompanyExpense({ request, response, database, user }) {
  const body = await readJson(request);
  const scopeType = enumValue(body.scopeType, ["company", "rig"], "К чему относится расход");
  const rig = scopeType === "rig"
    ? ownedRow(database, "rigs", body.rigId, user.organization_id, "Сцепка не найдена")
    : null;
  const clientMutationId = optionalText(body.clientMutationId, 100) || entityId("mut");
  const attachmentId = body.attachmentId
    ? ownedOfficeAttachment(database, body.attachmentId, user, ["company_expense_proof"])
    : null;
  const id = entityId("cex");
  const timestamp = nowIso();
  const companyExpense = {
    id,
    organizationId: user.organization_id,
    scopeType,
    rigId: rig?.id || null,
    amountKopecks: toKopecks(positiveInteger(body.amountKopecks, "Сумма расхода")),
    category: requiredText(body.category, "Категория расхода", 120),
    paymentMethod: enumValue(
      body.paymentMethod,
      ["bank", "cash", "card_transfer", "company_card"],
      "Способ оплаты"
    ),
    occurredAt: requiredDateTime(body.occurredAt, "Дата и время расхода"),
    description: requiredText(body.description, "Комментарий к расходу", 2000),
    attachmentId,
    clientMutationId,
    createdAt: timestamp
  };

  const duplicate = database.prepare(`
    SELECT * FROM company_expenses
    WHERE organization_id = ? AND client_mutation_id = ?
  `).get(user.organization_id, clientMutationId);
  if (duplicate) {
    const sameMutation = duplicate.scope_type === companyExpense.scopeType
      && (duplicate.rig_id || null) === companyExpense.rigId
      && Number(duplicate.amount_kopecks) === companyExpense.amountKopecks
      && duplicate.category === companyExpense.category
      && duplicate.payment_method === companyExpense.paymentMethod
      && duplicate.occurred_at === companyExpense.occurredAt
      && duplicate.description === companyExpense.description
      && (duplicate.attachment_id || null) === companyExpense.attachmentId;
    if (!sameMutation) {
      throw new HttpError(409, "Идентификатор операции уже использован", "MUTATION_CONFLICT");
    }
    sendJson(response, 200, {
      companyExpense: getCompanyExpense(database, duplicate.id, user.organization_id),
      duplicate: true
    });
    return;
  }

  transaction(database, () => {
    database.prepare(`
      INSERT INTO company_expenses(
        id, organization_id, scope_type, rig_id, amount_kopecks,
        category, payment_method, occurred_at, description,
        attachment_id, client_mutation_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      companyExpense.id,
      companyExpense.organizationId,
      companyExpense.scopeType,
      companyExpense.rigId,
      companyExpense.amountKopecks,
      companyExpense.category,
      companyExpense.paymentMethod,
      companyExpense.occurredAt,
      companyExpense.description,
      companyExpense.attachmentId,
      companyExpense.clientMutationId,
      user.id,
      companyExpense.createdAt
    );
    audit(database, event(user, "company_expense", id, "created", null, companyExpense));
  });

  sendJson(response, 201, {
    companyExpense: getCompanyExpense(database, id, user.organization_id)
  });
}

async function reverseCompanyExpense({ request, response, database, user, expenseId }) {
  const body = await readJson(request);
  const expense = database.prepare(`
    SELECT * FROM company_expenses WHERE id = ? AND organization_id = ?
  `).get(expenseId, user.organization_id);
  if (!expense) throw new HttpError(404, "Расход не найден", "NOT_FOUND");
  if (expense.reversed_at) throw new HttpError(409, "Расход уже отменён", "ALREADY_REVERSED");
  const reason = requiredText(body.reason, "Причина отмены", 2000);
  const timestamp = nowIso();

  transaction(database, () => {
    database.prepare(`
      UPDATE company_expenses
      SET reversed_at = ?, reversed_by = ?, reversal_reason = ?
      WHERE id = ? AND reversed_at IS NULL
    `).run(timestamp, user.id, reason, expense.id);
    const after = database.prepare("SELECT * FROM company_expenses WHERE id = ?").get(expense.id);
    audit(database, event(user, "company_expense", expense.id, "reversed", expense, after, reason));
  });

  sendJson(response, 200, {
    companyExpense: getCompanyExpense(database, expense.id, user.organization_id)
  });
}

async function createExpenseCategory({ request, response, database, user }) {
  const body = await readJson(request);
  const id = entityId("cat");
  const timestamp = nowIso();
  const category = {
    id,
    organizationId: user.organization_id,
    name: requiredText(body.name, "Название категории", 100),
    sortOrder: Number(database.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
      FROM expense_categories WHERE organization_id = ?
    `).get(user.organization_id).next_order),
    createdAt: timestamp
  };
  try {
    database.prepare(`
      INSERT INTO expense_categories(
        id, organization_id, name, is_active, sort_order,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      category.id, category.organizationId, category.name,
      category.sortOrder, user.id, category.createdAt, category.createdAt
    );
  } catch (error) {
    throw constraintError(error, "Такая категория уже существует");
  }
  const created = getExpenseCategory(database, id, user.organization_id);
  audit(database, event(user, "expense_category", id, "created", null, created));
  sendJson(response, 201, { expenseCategory: created });
}

async function setExpenseCategoryActive({ request, response, database, user, categoryId }) {
  const body = await readJson(request);
  if (typeof body.isActive !== "boolean") {
    throw new HttpError(400, "Укажите состояние категории", "VALIDATION_ERROR");
  }
  const category = getExpenseCategory(database, categoryId, user.organization_id);
  const timestamp = nowIso();
  database.prepare(`
    UPDATE expense_categories SET is_active = ?, updated_at = ? WHERE id = ?
  `).run(body.isActive ? 1 : 0, timestamp, category.id);
  const updated = getExpenseCategory(database, category.id, user.organization_id);
  audit(database, event(
    user,
    "expense_category",
    category.id,
    body.isActive ? "activated" : "deactivated",
    category,
    updated
  ));
  sendJson(response, 200, { expenseCategory: updated });
}

async function updateOrganizationCompensationSettings({ request, response, database, user }) {
  const body = await readJson(request);
  const before = getOrganizationCompensationSettings(database, user.organization_id);
  const salaryRate = toKopecks(nonNegativeInteger(
    body.defaultSalaryRateKopecksPerKm,
    "Ставка зарплаты за километр"
  ));
  const dailyRate = toKopecks(nonNegativeInteger(
    body.defaultDailyRateKopecks,
    "Ставка суточных"
  ));
  const timestamp = nowIso();
  const after = transaction(database, () => {
    database.prepare(`
      INSERT INTO organization_compensation_settings(
        organization_id, default_salary_rate_kopecks_per_km,
        default_daily_rate_kopecks, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        default_salary_rate_kopecks_per_km = excluded.default_salary_rate_kopecks_per_km,
        default_daily_rate_kopecks = excluded.default_daily_rate_kopecks,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(user.organization_id, salaryRate, dailyRate, user.id, timestamp);
    const updated = getOrganizationCompensationSettings(database, user.organization_id);
    audit(database, event(
      user,
      "organization_compensation_settings",
      user.organization_id,
      "updated",
      before,
      updated,
      optionalText(body.reason, 1000)
    ));
    return updated;
  });
  sendJson(response, 200, { compensationSettings: after });
}

async function updateDriverCompensationSettings({ request, response, database, user, driverId }) {
  const driver = ownedDriver(database, driverId, user.organization_id);
  const body = await readJson(request);
  const salaryRate = optionalNonNegativeInteger(body.salaryRateKopecksPerKm);
  const dailyRate = optionalNonNegativeInteger(body.dailyRateKopecks);
  const before = database.prepare(`
    SELECT * FROM driver_compensation_settings WHERE driver_id = ? AND organization_id = ?
  `).get(driver.id, user.organization_id) || null;
  const timestamp = nowIso();
  const after = transaction(database, () => {
    database.prepare(`
      INSERT INTO driver_compensation_settings(
        driver_id, organization_id, salary_rate_kopecks_per_km,
        daily_rate_kopecks, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(driver_id) DO UPDATE SET
        salary_rate_kopecks_per_km = excluded.salary_rate_kopecks_per_km,
        daily_rate_kopecks = excluded.daily_rate_kopecks,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(driver.id, user.organization_id, salaryRate, dailyRate, user.id, timestamp);
    const updated = getDriverCompensationSettings(database, driver.id, user.organization_id);
    audit(database, event(
      user,
      "driver_compensation_settings",
      driver.id,
      "updated",
      before,
      updated,
      optionalText(body.reason, 1000)
    ));
    return updated;
  });
  sendJson(response, 200, { driverSettings: after });
}

async function createDriverBalanceAdjustment({ request, response, database, user, driverId }) {
  const driver = ownedDriver(database, driverId, user.organization_id);
  const body = await readJson(request);
  const balanceEffect = integer(body.balanceEffectKopecks, "Сумма корректировки");
  if (balanceEffect === 0) {
    throw new HttpError(400, "Корректировка не может быть нулевой", "INVALID_AMOUNT");
  }
  const balanceCategory = enumValue(
    body.balanceCategory,
    ["salary", "daily", "general"],
    "Раздел корректировки"
  );
  const trip = body.tripId
    ? ownedRow(database, "trips", body.tripId, user.organization_id, "Рейс не найден")
    : null;
  if (trip && trip.driver_id !== driver.id) {
    throw new HttpError(400, "Рейс назначен другому водителю", "DRIVER_TRIP_MISMATCH");
  }
  const periodFrom = body.periodFrom ? requiredDate(body.periodFrom, "Начало периода") : null;
  const periodTo = body.periodTo ? requiredDate(body.periodTo, "Конец периода") : null;
  if (periodFrom && periodTo && periodTo < periodFrom) {
    throw new HttpError(400, "Конец периода не может быть раньше начала", "INVALID_ADJUSTMENT_PERIOD");
  }
  const id = entityId("acc");
  const timestamp = nowIso();
  const comment = requiredText(body.comment, "Причина корректировки", 2000);
  const clientMutationId = optionalText(body.clientMutationId, 100) || entityId("mut");
  const duplicate = database.prepare(`
    SELECT * FROM driver_accruals WHERE organization_id = ? AND client_mutation_id = ?
  `).get(user.organization_id, clientMutationId);
  if (duplicate) {
    const sameMutation = duplicate.driver_id === driver.id
      && duplicate.accrual_type === "manual_adjustment"
      && duplicate.balance_category === balanceCategory
      && Number(duplicate.balance_effect_kopecks) === balanceEffect
      && (duplicate.trip_id || null) === (trip?.id || null)
      && (duplicate.period_from || null) === periodFrom
      && (duplicate.period_to || null) === periodTo
      && duplicate.comment === comment
      && duplicate.source_type === "manual";
    if (!sameMutation) {
      throw new HttpError(409, "Идентификатор операции уже использован", "MUTATION_CONFLICT");
    }
    sendJson(response, 200, {
      adjustment: duplicate,
      settlement: getDriverSettlement(database, driver.id, user.organization_id),
      duplicate: true
    });
    return;
  }
  transaction(database, () => {
    database.prepare(`
      INSERT INTO driver_accruals(
        id, organization_id, driver_id, trip_id, accrual_type,
        balance_category, balance_effect_kopecks, period_from, period_to,
        comment, source_type, client_mutation_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, 'manual_adjustment', ?, ?, ?, ?, ?, 'manual', ?, ?, ?)
    `).run(
      id, user.organization_id, driver.id, trip?.id || null,
      balanceCategory, balanceEffect, periodFrom, periodTo,
      comment, clientMutationId, user.id, timestamp
    );
    const inserted = database.prepare("SELECT * FROM driver_accruals WHERE id = ?").get(id);
    audit(database, event(user, "driver_accrual", id, "manual_adjustment_created", null, inserted, comment));
  });
  const adjustment = database.prepare("SELECT * FROM driver_accruals WHERE id = ?").get(id);
  sendJson(response, 201, {
    adjustment,
    settlement: getDriverSettlement(database, driver.id, user.organization_id)
  });
}

async function createDriverTransfer({
  request,
  response,
  database,
  user,
  driverCompensationVisible = false
}) {
  const body = await readJson(request);
  const driver = ownedDriver(database, body.driverId, user.organization_id);
  const direction = enumValue(
    body.direction,
    ["company_to_driver", "driver_to_company"],
    "Направление перевода"
  );
  const paymentMethod = enumValue(body.paymentMethod, ["bank", "cash", "card_transfer"], "Способ перевода");
  if (!Array.isArray(body.allocations) || body.allocations.length === 0 || body.allocations.length > 20) {
    throw new HttpError(400, "Укажите назначение перевода", "ALLOCATIONS_REQUIRED");
  }
  const allocations = body.allocations.map((item) => {
    const allocationType = enumValue(
      item?.allocationType,
      ["salary", "daily", "expense_advance", "expense_reimbursement"],
      "Назначение перевода"
    );
    const amountKopecks = toKopecks(positiveInteger(item?.amountKopecks, "Сумма назначения"));
    const trip = item?.tripId
      ? ownedRow(database, "trips", item.tripId, user.organization_id, "Рейс не найден")
      : null;
    if (trip && trip.driver_id !== driver.id) {
      throw new HttpError(400, "Рейс назначен другому водителю", "DRIVER_TRIP_MISMATCH");
    }
    if (allocationType === "expense_reimbursement" && direction === "driver_to_company") {
      throw new HttpError(400, "Возврат нельзя записать как компенсацию расхода", "INVALID_ALLOCATION_DIRECTION");
    }
    const coverageThrough = item?.coverageThrough
      ? requiredDate(item.coverageThrough, "Суточные оплачены по дату")
      : null;
    if (coverageThrough && allocationType !== "daily") {
      throw new HttpError(400, "Дата покрытия применяется только к суточным", "INVALID_COVERAGE_DATE");
    }
    return {
      allocationType,
      amountKopecks,
      tripId: trip?.id || null,
      coverageThrough,
      comment: optionalText(item?.comment, 1000)
    };
  });
  const amountKopecks = allocations.reduce((sum, item) => sum + item.amountKopecks, 0);
  if (!Number.isSafeInteger(amountKopecks) || amountKopecks <= 0) {
    throw new HttpError(400, "Некорректная общая сумма перевода", "INVALID_AMOUNT");
  }
  const clientMutationId = optionalText(body.clientMutationId, 100) || entityId("mut");
  const attachmentId = body.attachmentId
    ? ownedOfficeAttachment(database, body.attachmentId, user, ["payment_proof"])
    : null;
  const transferId = entityId("dtr");
  const timestamp = nowIso();
  const occurredAt = requiredDateTime(body.occurredAt, "Дата и время перевода");
  const comment = optionalText(body.comment, 2000);
  const duplicate = database.prepare(`
    SELECT id FROM driver_transfers WHERE organization_id = ? AND client_mutation_id = ?
  `).get(user.organization_id, clientMutationId);
  if (duplicate) {
    const existing = getDriverTransfer(database, duplicate.id, user.organization_id);
    const requestedAllocations = allocations.map(transferAllocationIdentity).sort();
    const existingAllocations = existing.allocations.map(transferAllocationIdentity).sort();
    const sameMutation = existing.driver_id === driver.id
      && existing.direction === direction
      && Number(existing.amount_kopecks) === amountKopecks
      && existing.payment_method === paymentMethod
      && existing.occurred_at === occurredAt
      && existing.comment === comment
      && (existing.attachment_id || null) === attachmentId
      && JSON.stringify(existingAllocations) === JSON.stringify(requestedAllocations);
    if (!sameMutation) {
      throw new HttpError(409, "Идентификатор операции уже использован", "MUTATION_CONFLICT");
    }
    sendJson(response, 200, {
      transfer: existing,
      settlement: getDriverSettlement(database, driver.id, user.organization_id),
      duplicate: true
    });
    return;
  }
  transaction(database, () => {
    database.prepare(`
      INSERT INTO driver_transfers(
        id, organization_id, driver_id, direction, amount_kopecks,
        payment_method, occurred_at, comment, attachment_id,
        client_mutation_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transferId, user.organization_id, driver.id, direction, amountKopecks,
      paymentMethod, occurredAt, comment, attachmentId,
      clientMutationId, user.id, timestamp
    );
    const insertAllocation = database.prepare(`
      INSERT INTO driver_transfer_allocations(
        id, organization_id, transfer_id, driver_id, trip_id,
        allocation_type, amount_kopecks, coverage_through,
        comment, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const allocation of allocations) {
      insertAllocation.run(
        entityId("dal"), user.organization_id, transferId, driver.id,
        allocation.tripId, allocation.allocationType, allocation.amountKopecks,
        allocation.coverageThrough, allocation.comment, user.id, timestamp
      );
    }
    audit(database, event(user, "driver_transfer", transferId, "created", null, {
      driverId: driver.id,
      direction,
      amountKopecks,
      occurredAt,
      allocations
    }));
    createNotification(database, {
      organizationId: user.organization_id,
      recipientUserId: driver.id,
      type: direction === "company_to_driver" ? "driver_payment" : "driver_return",
      title: driverCompensationVisible
        ? direction === "company_to_driver" ? "Учтён новый перевод" : "Учтён возврат компании"
        : direction === "company_to_driver" ? "Офис зарегистрировал перевод" : "Офис зарегистрировал возврат",
      message: driverCompensationVisible
        ? `${formatKopecksForMessage(amountKopecks)} · ${allocations.map((item) => allocationTypeForMessage(item.allocationType)).join(", ")}`
        : "Денежная операция учтена офисом без раскрытия расчёта.",
      entityType: "driver_transfer",
      entityId: transferId
    });
  });
  sendJson(response, 201, {
    transfer: getDriverTransfer(database, transferId, user.organization_id),
    settlement: getDriverSettlement(database, driver.id, user.organization_id)
  });
}

function transferAllocationIdentity(allocation) {
  return JSON.stringify({
    allocationType: allocation.allocationType ?? allocation.allocation_type,
    amountKopecks: Number(allocation.amountKopecks ?? allocation.amount_kopecks),
    tripId: allocation.tripId ?? allocation.trip_id ?? null,
    coverageThrough: allocation.coverageThrough ?? allocation.coverage_through ?? null,
    comment: allocation.comment || ""
  });
}

async function reverseDriverTransfer({
  request,
  response,
  database,
  user,
  transferId,
  driverCompensationVisible = false
}) {
  const body = await readJson(request);
  const transfer = database.prepare(`
    SELECT * FROM driver_transfers WHERE id = ? AND organization_id = ?
  `).get(transferId, user.organization_id);
  if (!transfer) throw new HttpError(404, "Перевод не найден", "NOT_FOUND");
  if (transfer.reversed_at) throw new HttpError(409, "Перевод уже отменён", "ALREADY_REVERSED");
  const reason = requiredText(body.reason, "Причина отмены", 2000);
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare(`
      UPDATE driver_transfers
      SET reversed_at = ?, reversed_by = ?, reversal_reason = ?
      WHERE id = ? AND reversed_at IS NULL
    `).run(timestamp, user.id, reason, transfer.id);
    const updated = database.prepare("SELECT * FROM driver_transfers WHERE id = ?").get(transfer.id);
    audit(database, event(user, "driver_transfer", transfer.id, "reversed", transfer, updated, reason));
    createNotification(database, {
      organizationId: user.organization_id,
      recipientUserId: transfer.driver_id,
      type: "driver_transfer_reversed",
      title: "Денежная запись отменена офисом",
      message: driverCompensationVisible
        ? `${formatKopecksForMessage(transfer.amount_kopecks)}. ${reason}`
        : "Офис отменил ранее зарегистрированную денежную операцию.",
      entityType: "driver_transfer",
      entityId: transfer.id
    });
  });
  sendJson(response, 200, {
    transfer: getDriverTransfer(database, transfer.id, user.organization_id),
    settlement: getDriverSettlement(database, transfer.driver_id, user.organization_id)
  });
}

async function uploadFile({ request, response, database, uploadsDirectory, user }) {
  const releaseUploadSlot = reserveUploadSlot(user.id);
  let storagePath = "";
  try {
    const kind = requiredText(request.headers["x-anb-kind"], "Тип файла", 60);
    requireUploadKind(kind, user.role);
    const originalName = decodeHeader(request.headers["x-file-name"] || "file");
    const mimeType = String(request.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
    if (!isAllowedFileType(mimeType)) throw new HttpError(415, "Этот тип файла не поддерживается", "FILE_TYPE_NOT_ALLOWED");
    if (!isFileTypeAllowedForKind(kind, mimeType)) {
      throw new HttpError(415, "Для этого подтверждения нужен снимок или разрешённый документ", "FILE_TYPE_NOT_ALLOWED_FOR_KIND");
    }
    const announcedBytes = Number(request.headers["content-length"] || 0);
    if (Number.isFinite(announcedBytes) && announcedBytes > MAX_FILE_BYTES) {
      throw new HttpError(413, "Файл слишком большой", "PAYLOAD_TOO_LARGE");
    }
    await maybeCleanupOrphanUploads(database, uploadsDirectory, user.organization_id);
    assertUploadQuota(database, user, Math.max(0, announcedBytes || 0));

    const attachmentId = entityId("att");
    const extension = safeExtension(originalName, mimeType);
    const organizationDirectory = resolve(uploadsDirectory, user.organization_id);
    mkdirSync(organizationDirectory, { recursive: true });
    const storageName = `${attachmentId}${extension}`;
    storagePath = resolve(organizationDirectory, storageName);
    const storageKey = `${user.organization_id}/${storageName}`;
    if (!storagePath.startsWith(`${organizationDirectory}${sep}`)) {
      throw new HttpError(400, "Некорректное имя файла", "INVALID_FILE_NAME");
    }

    const file = await open(storagePath, "wx");
    let uploaded;
    try {
      uploaded = await streamUploadToFile(request, file);
    } finally {
      await file.close();
    }
    if (uploaded.sizeBytes === 0) throw new HttpError(400, "Файл пуст", "EMPTY_FILE");
    if (!contentMatchesMime(uploaded.header, mimeType)) {
      throw new HttpError(415, "Содержимое файла не соответствует его типу", "FILE_CONTENT_MISMATCH");
    }

    const createdAt = nowIso();
    transaction(database, () => {
      // Повторная проверка внутри транзакции не даёт параллельным запросам
      // одновременно пройти лимит и записать данные сверх квоты.
      assertUploadQuota(database, user, uploaded.sizeBytes);
      database.prepare(`
        INSERT INTO attachments(
          id, organization_id, kind, storage_path, original_name, mime_type,
          size_bytes, sha256, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        attachmentId,
        user.organization_id,
        kind,
        storageKey,
        basename(originalName).slice(0, 240),
        mimeType,
        uploaded.sizeBytes,
        uploaded.sha256,
        user.id,
        createdAt
      );
      audit(database, event(user, "attachment", attachmentId, "uploaded", null, { kind, size: uploaded.sizeBytes }));
    });
    sendJson(response, 201, {
      attachmentId,
      originalName,
      mimeType,
      sizeBytes: uploaded.sizeBytes
    });
  } catch (error) {
    if (storagePath) await unlink(storagePath).catch(() => {});
    throw error;
  } finally {
    releaseUploadSlot();
  }
}

function reserveUploadSlot(userId) {
  const activeForUser = uploadInFlightByUser.get(userId) || 0;
  if (uploadInFlight >= UPLOAD_MAX_IN_FLIGHT || activeForUser >= UPLOAD_USER_MAX_IN_FLIGHT) {
    throw new HttpError(429, "Слишком много одновременных загрузок", "UPLOAD_BUSY");
  }
  uploadInFlight += 1;
  uploadInFlightByUser.set(userId, activeForUser + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    uploadInFlight = Math.max(0, uploadInFlight - 1);
    const remaining = (uploadInFlightByUser.get(userId) || 1) - 1;
    if (remaining > 0) uploadInFlightByUser.set(userId, remaining);
    else uploadInFlightByUser.delete(userId);
  };
}

async function streamUploadToFile(request, file) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  let header = Buffer.alloc(0);
  for await (const chunk of request) {
    sizeBytes += chunk.length;
    if (sizeBytes > MAX_FILE_BYTES) {
      throw new HttpError(413, "Файл слишком большой", "PAYLOAD_TOO_LARGE");
    }
    if (header.length < 16) {
      const missing = 16 - header.length;
      header = Buffer.concat([header, chunk.subarray(0, missing)]);
    }
    hash.update(chunk);
    await file.write(chunk);
  }
  return { sizeBytes, header, sha256: hash.digest("hex") };
}

async function downloadFile({ response, database, uploadsDirectory, user, attachmentId }) {
  const attachment = ownedRow(database, "attachments", attachmentId, user.organization_id, "Файл не найден");
  if (user.role === "driver" && attachment.created_by !== user.id) {
    const permitted = database.prepare(`
      SELECT 1 AS allowed
      FROM odometer_readings o
      WHERE o.attachment_id = ? AND o.driver_id = ?
      UNION ALL
      SELECT 1 AS allowed
      FROM expenses e
      WHERE e.receipt_attachment_id = ? AND e.driver_id = ?
      LIMIT 1
    `).get(attachmentId, user.id, attachmentId, user.id);
    if (!permitted) throw new HttpError(403, "Файл недоступен", "FORBIDDEN");
  }
  const diskPath = attachmentDiskPath(uploadsDirectory, attachment.storage_path);
  if (!existsSync(diskPath)) throw new HttpError(404, "Файл отсутствует в хранилище", "FILE_MISSING");
  response.writeHead(200, {
    "Content-Type": attachment.mime_type,
    "Content-Length": attachment.size_bytes,
    "Content-Disposition": `${attachment.mime_type.startsWith("image/") || attachment.mime_type === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`,
    "Cache-Control": "private, no-store"
  });
  createReadStream(diskPath).pipe(response);
}

async function discardUnlinkedFile({ response, database, uploadsDirectory, user, attachmentId }) {
  const attachment = ownedRow(database, "attachments", attachmentId, user.organization_id, "Файл не найден");
  if (attachment.created_by !== user.id) throw new HttpError(403, "Файл создан другим пользователем", "FORBIDDEN");
  const reference = database.prepare(`
    SELECT 1 FROM odometer_readings WHERE attachment_id = ?
    UNION ALL SELECT 1 FROM expenses WHERE receipt_attachment_id = ?
    UNION ALL SELECT 1 FROM trip_documents WHERE attachment_id = ?
    UNION ALL SELECT 1 FROM trip_rate_adjustments WHERE attachment_id = ?
    UNION ALL SELECT 1 FROM incoming_payments WHERE attachment_id = ?
    UNION ALL SELECT 1 FROM driver_transfers WHERE attachment_id = ?
    UNION ALL SELECT 1 FROM company_expenses WHERE attachment_id = ?
    LIMIT 1
  `).get(attachment.id, attachment.id, attachment.id, attachment.id, attachment.id, attachment.id, attachment.id);
  if (reference) throw new HttpError(409, "Файл уже привязан к записи и не может быть удалён", "FILE_IN_USE");
  transaction(database, () => {
    database.prepare("DELETE FROM attachments WHERE id = ?").run(attachment.id);
    audit(database, event(user, "attachment", attachment.id, "unlinked_upload_discarded", attachment, null));
  });
  await unlink(attachmentDiskPath(uploadsDirectory, attachment.storage_path)).catch(() => {});
  sendJson(response, 200, { ok: true });
}

function assertUploadQuota(database, user, incomingBytes) {
  const usage = database.prepare(`
    SELECT COUNT(*) AS file_count, COALESCE(SUM(size_bytes), 0) AS total_bytes
    FROM attachments
    WHERE created_by = ? AND created_at >= ?
  `).get(user.id, new Date(Date.now() - 86400000).toISOString());
  const maximumFiles = user.role === "driver" ? 200 : 500;
  const maximumBytes = user.role === "driver" ? 250 * 1024 * 1024 : 1024 * 1024 * 1024;
  if (Number(usage.file_count) >= maximumFiles
      || Number(usage.total_bytes) + Math.max(0, incomingBytes) > maximumBytes) {
    throw new HttpError(429, "Дневной лимит загрузок исчерпан. Обратитесь в офис", "UPLOAD_QUOTA_EXCEEDED");
  }
  const organizationUsage = database.prepare(`
    SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes
    FROM attachments WHERE organization_id = ?
  `).get(user.organization_id);
  const configuredMegabytes = Number(process.env.ANB_ORGANIZATION_UPLOAD_LIMIT_MB || 20480);
  const organizationLimit = (Number.isFinite(configuredMegabytes) && configuredMegabytes > 0
    ? configuredMegabytes
    : 20480) * 1024 * 1024;
  if (Number(organizationUsage.total_bytes) + Math.max(0, incomingBytes) > organizationLimit) {
    throw new HttpError(507, "Хранилище компании заполнено. Создайте резервную копию и освободите место", "ORGANIZATION_STORAGE_FULL");
  }
}

async function maybeCleanupOrphanUploads(database, uploadsDirectory, organizationId) {
  const previous = lastOrphanCleanupByOrganization.get(organizationId) || 0;
  if (Date.now() - previous < 3600000) return;
  lastOrphanCleanupByOrganization.set(organizationId, Date.now());
  const cutoff = new Date(Date.now() - ORPHAN_UPLOAD_TTL_MS).toISOString();
  const candidates = database.prepare(`
    SELECT a.* FROM attachments a
    WHERE a.organization_id = ? AND a.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM odometer_readings o WHERE o.attachment_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.receipt_attachment_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM trip_documents d WHERE d.attachment_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM trip_rate_adjustments r WHERE r.attachment_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM incoming_payments p WHERE p.attachment_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM driver_transfers t WHERE t.attachment_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM company_expenses c WHERE c.attachment_id = a.id)
    ORDER BY a.created_at
    LIMIT 200
  `).all(organizationId, cutoff);

  for (const attachment of candidates) {
    if (isAbsolute(attachment.storage_path)) {
      const root = resolve(uploadsDirectory);
      const legacyTarget = resolve(attachment.storage_path);
      if (!legacyTarget.startsWith(`${root}${sep}`)) continue;
    }
    const deleted = transaction(database, () => database.prepare(`
      DELETE FROM attachments
      WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM odometer_readings o WHERE o.attachment_id = attachments.id)
        AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.receipt_attachment_id = attachments.id)
        AND NOT EXISTS (SELECT 1 FROM trip_documents d WHERE d.attachment_id = attachments.id)
        AND NOT EXISTS (SELECT 1 FROM trip_rate_adjustments r WHERE r.attachment_id = attachments.id)
        AND NOT EXISTS (SELECT 1 FROM incoming_payments p WHERE p.attachment_id = attachments.id)
        AND NOT EXISTS (SELECT 1 FROM driver_transfers t WHERE t.attachment_id = attachments.id)
        AND NOT EXISTS (SELECT 1 FROM company_expenses c WHERE c.attachment_id = attachments.id)
    `).run(attachment.id).changes);
    if (!deleted) continue;
    try {
      await unlink(attachmentDiskPath(uploadsDirectory, attachment.storage_path));
    } catch {
      // Запись уже удалена как непривязанная; оставшийся файл можно убрать при обслуживании диска.
    }
  }
}

function attachmentDiskPath(uploadsDirectory, storedPath) {
  if (isAbsolute(storedPath)) return resolve(storedPath);
  const root = resolve(uploadsDirectory);
  const target = resolve(root, ...String(storedPath).split(/[\\/]+/));
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new HttpError(400, "Некорректный путь файла", "INVALID_STORAGE_PATH");
  }
  return target;
}

async function startTrip({ request, response, database, user, tripId }) {
  const trip = driverTrip(database, tripId, user);
  const body = await readJson(request);
  const mutationId = optionalText(body.clientMutationId, 100) || entityId("mut");
  if (trip.start_client_mutation_id === mutationId) {
    sendJson(response, 200, { trip: getDriverTrip(database, trip.id, user), duplicate: true });
    return;
  }
  const mutationOwner = database.prepare(`
    SELECT id FROM trips WHERE organization_id = ? AND start_client_mutation_id = ? AND id != ?
  `).get(user.organization_id, mutationId, trip.id);
  if (mutationOwner) throw new HttpError(409, "Идентификатор офлайн-команды уже использован", "MUTATION_CONFLICT");
  if (!["assigned", "awaiting_loading"].includes(trip.status)) {
    throw new HttpError(409, "Рейс уже начат или недоступен для старта", "INVALID_TRIP_STATUS");
  }
  const currentPeriod = database.prepare(`
    SELECT * FROM rig_periods
    WHERE id = ? AND rig_id = ? AND organization_id = ? AND valid_to IS NULL
  `).get(trip.rig_period_id, trip.rig_id, user.organization_id);
  if (!currentPeriod
      || currentPeriod.driver_id !== trip.driver_id
      || currentPeriod.tractor_id !== trip.tractor_id
      || currentPeriod.trailer_id !== trip.trailer_id) {
    throw new HttpError(409, "Состав сцепки изменился. Офис должен переназначить рейс", "TRIP_ASSIGNMENT_STALE");
  }
  const attachment = ownedAttachmentByUser(database, body.attachmentId, user, ["odometer_start"], { imagesOnly: true });
  const odometer = nonNegativeInteger(body.odometerKm, "Показание одометра");
  const loadedAt = requiredDateTime(body.loadedAt, "Дата и время загрузки");
  const previousReading = database.prepare(`
    SELECT o.entered_value_km, o.captured_at, o.trip_id
    FROM odometer_readings o
    JOIN trips previous_trip ON previous_trip.id = o.trip_id
    WHERE o.organization_id = ? AND o.tractor_id = ?
      AND o.reading_type = 'end' AND o.trip_id != ?
      AND o.captured_at <= ?
    ORDER BY o.captured_at DESC, o.created_at DESC
    LIMIT 1
  `).get(user.organization_id, trip.tractor_id, trip.id, loadedAt);
  const riskFlags = [];
  if (new Date(loadedAt).getTime() > Date.now() + 60 * 60 * 1000) {
    riskFlags.push({ code: "capture_time_in_future", serverTime: nowIso() });
  }
  if (trip.assigned_at && new Date(loadedAt).getTime() < new Date(trip.assigned_at).getTime() - 30 * 86400000) {
    riskFlags.push({ code: "loaded_far_before_assignment", assignedAt: trip.assigned_at });
  }
  if (previousReading && odometer < Number(previousReading.entered_value_km)) {
    riskFlags.push({
      code: "odometer_below_previous_end",
      previousValueKm: Number(previousReading.entered_value_km),
      previousTripId: previousReading.trip_id
    });
  } else if (previousReading && odometer - Number(previousReading.entered_value_km) > 2000) {
    riskFlags.push({
      code: "odometer_gap",
      previousValueKm: Number(previousReading.entered_value_km),
      gapKm: odometer - Number(previousReading.entered_value_km),
      previousTripId: previousReading.trip_id
    });
  }
  const timestamp = nowIso();

  const activeTrip = database.prepare(`
    SELECT id FROM trips
    WHERE organization_id = ?
      AND status = 'in_progress'
      AND id != ?
      AND (driver_id = ? OR tractor_id = ? OR trailer_id = ?)
    LIMIT 1
  `).get(user.organization_id, trip.id, user.id, trip.tractor_id, trip.trailer_id);
  if (activeTrip) {
    throw new HttpError(409, "Сначала завершите уже начатый рейс", "ACTIVE_TRIP_EXISTS");
  }

  try {
    transaction(database, () => {
      database.prepare(`
        INSERT INTO odometer_readings(
          id, organization_id, trip_id, tractor_id, driver_id, reading_type,
          entered_value_km, attachment_id, latitude, longitude,
          captured_at, risk_flags_json, created_at
        ) VALUES (?, ?, ?, ?, ?, 'start', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entityId("odo"), user.organization_id, trip.id, trip.tractor_id, user.id,
        odometer, attachment.id, optionalCoordinate(body.latitude, -90, 90),
        optionalCoordinate(body.longitude, -180, 180), loadedAt,
        JSON.stringify(riskFlags), timestamp
      );
      database.prepare(`
        UPDATE trips
        SET status = 'in_progress', loaded_at = ?, start_client_mutation_id = ?,
            row_version = row_version + 1, updated_at = ?
        WHERE id = ?
      `).run(loadedAt, mutationId, timestamp, trip.id);
      audit(database, event(user, "trip", trip.id, "started", { status: trip.status }, {
        status: "in_progress",
        odometerKm: odometer,
        riskFlags
      }));
      notifyOfficeUsers(database, {
        organizationId: user.organization_id,
        type: "trip_started_by_driver",
        title: "Водитель начал рейс",
        message: `${user.full_name} · ${trip.number}: ${trip.loading_address} → ${trip.unloading_address}`,
        entityType: "trip",
        entityId: trip.id
      });
    });
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE constraint failed: trips")) {
      throw new HttpError(409, "Водитель или тягач уже находятся в другом активном рейсе", "ACTIVE_TRIP_EXISTS");
    }
    throw error;
  }
  sendJson(response, 200, { trip: getDriverTrip(database, trip.id, user) });
}

async function createExpense({ request, response, database, user, tripId }) {
  const trip = driverTrip(database, tripId, user);
  if (trip.status !== "in_progress") throw new HttpError(409, "Расход можно добавить только в выполняемый рейс", "INVALID_TRIP_STATUS");
  const body = await readJson(request);
  const mutationId = optionalText(body.clientMutationId, 100) || entityId("mut");
  const duplicate = database.prepare(`
    SELECT * FROM expenses WHERE organization_id = ? AND client_mutation_id = ?
  `).get(user.organization_id, mutationId);
  if (duplicate) {
    const sameMutation = duplicate.driver_id === user.id
      && duplicate.trip_id === trip.id
      && duplicate.amount_kopecks === Number(body.amountKopecks)
      && duplicate.category === String(body.category || "").trim()
      && duplicate.description === String(body.description || "").trim()
      && duplicate.receipt_attachment_id === body.receiptAttachmentId;
    if (sameMutation) {
      sendJson(response, 200, { expense: duplicate, duplicate: true });
      return;
    }
    throw new HttpError(409, "Идентификатор этой офлайн-операции уже использован", "MUTATION_CONFLICT");
  }
  const attachment = ownedAttachmentByUser(database, body.receiptAttachmentId, user, ["expense_receipt"]);
  const duplicateReceipt = database.prepare(`
    SELECT e.id AS expense_id
    FROM expenses e
    JOIN attachments previous_attachment ON previous_attachment.id = e.receipt_attachment_id
    WHERE e.organization_id = ? AND previous_attachment.sha256 = ?
    ORDER BY e.created_at ASC
    LIMIT 1
  `).get(user.organization_id, attachment.sha256);
  const timestamp = nowIso();
  const occurredAt = body.occurredAt
    ? requiredDateTime(body.occurredAt, "Дата и время расхода")
    : timestamp;
  const riskFlags = duplicateReceipt
    ? [{ code: "duplicate_receipt", relatedExpenseId: duplicateReceipt.expense_id }]
    : [];
  if (new Date(occurredAt).getTime() > Date.now() + 60 * 60 * 1000) {
    riskFlags.push({ code: "expense_time_in_future", serverTime: timestamp });
  }
  if (trip.loaded_at && new Date(occurredAt).getTime() < new Date(trip.loaded_at).getTime()) {
    riskFlags.push({ code: "expense_before_trip_start", tripLoadedAt: trip.loaded_at });
  }
  const initialStatus = riskFlags.length ? "suspicious" : "pending_review";
  const id = entityId("exp");
  transaction(database, () => {
    database.prepare(`
      INSERT INTO expenses(
        id, organization_id, trip_id, driver_id, rig_id, tractor_id, trailer_id,
        amount_kopecks, category, payment_method, payment_source, supplier,
        description, occurred_at, location_text, latitude, longitude, receipt_attachment_id,
        status, risk_flags_json, client_mutation_id, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, user.organization_id, trip.id, user.id, trip.rig_id, trip.tractor_id, trip.trailer_id,
      toKopecks(positiveInteger(body.amountKopecks, "Сумма расхода")),
      requiredText(body.category, "Категория", 100),
      enumValue(body.paymentMethod, ["cash", "card", "transfer", "fuel_card"], "Способ оплаты"),
      enumValue(body.paymentSource, ["driver_personal", "driver_advance", "company_card", "company_fuel_card", "company_cash"], "Источник денег"),
      optionalText(body.supplier, 200),
      requiredText(body.description, "Комментарий", 2000),
      occurredAt,
      optionalText(body.locationText, 500),
      optionalCoordinate(body.latitude, -90, 90),
      optionalCoordinate(body.longitude, -180, 180),
      attachment.id,
      initialStatus,
      JSON.stringify(riskFlags),
      mutationId,
      user.id,
      timestamp,
      timestamp
    );
    const inserted = database.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
    audit(database, event(user, "expense", id, "submitted", null, inserted));
    notifyOfficeUsers(database, {
      organizationId: user.organization_id,
      type: "driver_expense_submitted",
      title: "Водитель добавил расход",
      message: `${user.full_name} · ${trip.number} · ${inserted.category} · ${formatKopecksForMessage(inserted.amount_kopecks)}`,
      entityType: "expense",
      entityId: id
    });
  });
  const expense = database.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
  sendJson(response, 201, { expense });
}

async function completeTrip({ request, response, database, user, tripId }) {
  const trip = driverTrip(database, tripId, user);
  const body = await readJson(request);
  const mutationId = optionalText(body.clientMutationId, 100) || entityId("mut");
  if (trip.complete_client_mutation_id === mutationId) {
    sendJson(response, 200, { trip: getDriverTrip(database, trip.id, user), duplicate: true });
    return;
  }
  const mutationOwner = database.prepare(`
    SELECT id FROM trips WHERE organization_id = ? AND complete_client_mutation_id = ? AND id != ?
  `).get(user.organization_id, mutationId, trip.id);
  if (mutationOwner) throw new HttpError(409, "Идентификатор офлайн-команды уже использован", "MUTATION_CONFLICT");
  if (trip.status !== "in_progress") throw new HttpError(409, "Рейс не находится в работе", "INVALID_TRIP_STATUS");
  const attachment = ownedAttachmentByUser(database, body.attachmentId, user, ["odometer_end"], { imagesOnly: true });
  const odometer = nonNegativeInteger(body.odometerKm, "Показание одометра");
  const start = database.prepare(`
    SELECT * FROM odometer_readings WHERE trip_id = ? AND reading_type = 'start'
  `).get(trip.id);
  if (!start) throw new HttpError(409, "Не найден начальный пробег", "START_ODOMETER_MISSING");
  if (odometer < start.entered_value_km) {
    throw new HttpError(400, "Конечный пробег не может быть меньше начального", "INVALID_ODOMETER");
  }
  const unloadedAt = requiredDateTime(body.unloadedAt, "Дата и время разгрузки");
  if (new Date(unloadedAt).getTime() < new Date(trip.loaded_at).getTime()) {
    throw new HttpError(400, "Разгрузка не может быть раньше загрузки", "INVALID_TRIP_TIMELINE");
  }
  const distanceKm = odometer - start.entered_value_km;
  const elapsedHours = (new Date(unloadedAt).getTime() - new Date(trip.loaded_at).getTime()) / 3600000;
  const riskFlags = [];
  if (new Date(unloadedAt).getTime() > Date.now() + 60 * 60 * 1000) {
    riskFlags.push({ code: "capture_time_in_future", serverTime: nowIso() });
  }
  if (distanceKm === 0) riskFlags.push({ code: "zero_trip_distance" });
  if (distanceKm > 5000) riskFlags.push({ code: "unusually_large_trip_distance", distanceKm });
  if ((elapsedHours <= 0 && distanceKm > 0) || (elapsedHours > 0 && distanceKm / elapsedHours > 110)) {
    riskFlags.push({
      code: "impossible_average_speed",
      averageSpeedKmh: elapsedHours > 0 ? Math.round(distanceKm / elapsedHours) : null
    });
  }
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare(`
        INSERT INTO odometer_readings(
          id, organization_id, trip_id, tractor_id, driver_id, reading_type,
          entered_value_km, attachment_id, latitude, longitude,
          captured_at, risk_flags_json, created_at
        ) VALUES (?, ?, ?, ?, ?, 'end', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entityId("odo"), user.organization_id, trip.id, trip.tractor_id, user.id,
        odometer, attachment.id, optionalCoordinate(body.latitude, -90, 90),
        optionalCoordinate(body.longitude, -180, 180), unloadedAt,
        JSON.stringify(riskFlags), timestamp
      );
    database.prepare(`
      UPDATE trips
      SET status = 'pending_review', unloaded_at = ?, complete_client_mutation_id = ?,
          row_version = row_version + 1, updated_at = ?
      WHERE id = ?
    `).run(unloadedAt, mutationId, timestamp, trip.id);
    audit(database, event(user, "trip", trip.id, "completed_by_driver", { status: trip.status }, {
      status: "pending_review",
      odometerKm: odometer,
      distanceKm,
      riskFlags
    }));
    notifyOfficeUsers(database, {
      organizationId: user.organization_id,
      type: "trip_completed_by_driver",
      title: "Водитель завершил рейс",
      message: `${user.full_name} · ${trip.number} · пробег ${distanceKm} км. Рейс ожидает проверки.`,
      entityType: "trip",
      entityId: trip.id
    });
  });
  sendJson(response, 200, { trip: getDriverTrip(database, trip.id, user) });
}

async function reviewExpense({ request, response, database, user, expenseId }) {
  const expense = ownedRow(database, "expenses", expenseId, user.organization_id, "Расход не найден");
  const body = await readJson(request);
  const status = enumValue(body.status, ["confirmed", "rejected", "needs_explanation", "suspicious"], "Статус проверки");
  const comment = optionalText(body.comment, 2000);
  if (["rejected", "needs_explanation", "suspicious"].includes(status) && !comment) {
    throw new HttpError(400, "Для выбранного статуса нужен комментарий", "COMMENT_REQUIRED");
  }
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare(`
      INSERT INTO expense_review_events(
        id, organization_id, expense_id, reviewer_id,
        review_status, comment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityId("erv"), user.organization_id, expense.id, user.id,
      status, comment, timestamp
    );
    database.prepare(`
      UPDATE expenses
      SET status = ?, reviewed_by = ?, reviewed_at = ?, review_comment = ?, updated_at = ?
      WHERE id = ?
    `).run(status, user.id, timestamp, comment, timestamp, expense.id);
    const updatedExpense = database.prepare("SELECT * FROM expenses WHERE id = ?").get(expense.id);
    audit(database, event(user, "expense", expense.id, "reviewed", expense, updatedExpense, comment));
    if (["needs_explanation", "rejected"].includes(status)) {
      createNotification(database, {
        organizationId: user.organization_id,
        recipientUserId: expense.driver_id,
        type: status === "needs_explanation" ? "expense_explanation_requested" : "expense_rejected",
        title: status === "needs_explanation" ? "Офис просит пояснить расход" : "Расход отклонён",
        message: `${expense.category} · ${formatKopecksForMessage(expense.amount_kopecks)}. ${comment}`,
        entityType: "expense",
        entityId: expense.id
      });
    }
  });
  const updated = getDriverExpense(database, expense.id);
  sendJson(response, 200, { expense: updated, trip: getOfficeTrip(database, expense.trip_id, user.organization_id) });
}

async function explainExpense({ request, response, database, user, expenseId }) {
  const expense = database.prepare(`
    SELECT * FROM expenses
    WHERE id = ? AND organization_id = ? AND driver_id = ?
  `).get(expenseId, user.organization_id, user.id);
  if (!expense) throw new HttpError(404, "Расход не найден", "NOT_FOUND");
  if (expense.status !== "needs_explanation") {
    throw new HttpError(409, "Офис сейчас не ожидает пояснение по этому расходу", "EXPLANATION_NOT_REQUESTED");
  }
  const body = await readJson(request);
  const message = requiredText(body.message, "Пояснение", 2000);
  const timestamp = nowIso();
  const explanationId = entityId("xpl");
  transaction(database, () => {
    database.prepare(`
      INSERT INTO expense_explanations(
        id, organization_id, expense_id, driver_id, message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(explanationId, user.organization_id, expense.id, user.id, message, timestamp);
    database.prepare(`
      UPDATE expenses
      SET status = 'pending_review', updated_at = ?
      WHERE id = ?
    `).run(timestamp, expense.id);
    database.prepare(`
      UPDATE notifications SET read_at = ?
      WHERE recipient_user_id = ? AND entity_type = 'expense' AND entity_id = ?
        AND notification_type = 'expense_explanation_requested' AND read_at IS NULL
    `).run(timestamp, user.id, expense.id);
    audit(database, event(user, "expense", expense.id, "driver_explanation_submitted", expense, {
      status: "pending_review",
      explanationId,
      message
    }, message));
    notifyOfficeUsers(database, {
      organizationId: user.organization_id,
      type: "driver_expense_explained",
      title: "Водитель ответил по расходу",
      message: `${user.full_name} · ${expense.category}: ${message}`,
      entityType: "expense",
      entityId: expense.id
    });
  });
  sendJson(response, 201, { expense: getDriverExpense(database, expense.id) });
}

async function savePushSubscription({ request, response, database, user, pushService }) {
  if (!pushService?.enabled) {
    throw new HttpError(503, "Push-уведомления пока не настроены", "PUSH_DISABLED");
  }
  const body = await readJson(request);
  let saved;
  try {
    saved = registerPushSubscription(
      database,
      user,
      body.subscription,
      request.headers["user-agent"] || ""
    );
  } catch (error) {
    throw new HttpError(400, error.message, "INVALID_PUSH_SUBSCRIPTION");
  }
  audit(database, event(user, "push_subscription", saved.id, "registered", null, {
    endpointHash: createHash("sha256").update(saved.endpoint).digest("hex"),
    active: true
  }));
  sendJson(response, 201, { subscription: saved });
}

async function removePushSubscription({ request, response, database, user }) {
  const body = await readJson(request);
  let removed;
  try {
    removed = unregisterPushSubscription(database, user, body.endpoint);
  } catch (error) {
    throw new HttpError(400, error.message, "INVALID_PUSH_SUBSCRIPTION");
  }
  if (removed) {
    audit(database, event(user, "push_subscription", user.id, "unregistered", null, {
      endpointHash: createHash("sha256").update(String(body.endpoint)).digest("hex")
    }));
  }
  sendJson(response, 200, { removed });
}

async function markDriverNotificationRead({ response, database, user, notificationId }) {
  const notification = database.prepare(`
    SELECT * FROM notifications
    WHERE id = ? AND organization_id = ? AND recipient_user_id = ?
  `).get(notificationId, user.organization_id, user.id);
  if (!notification) throw new HttpError(404, "Уведомление не найдено", "NOT_FOUND");
  if (!notification.read_at) {
    const timestamp = nowIso();
    transaction(database, () => {
      database.prepare("UPDATE notifications SET read_at = ? WHERE id = ?").run(timestamp, notification.id);
      if (
        notification.entity_type === "trip"
        && ["trip_assigned", "trip_reassigned", "trip_route_updated"].includes(notification.notification_type)
      ) {
        const trip = database.prepare(`
          SELECT number, loading_address, unloading_address
          FROM trips WHERE id = ? AND organization_id = ?
        `).get(notification.entity_id, user.organization_id);
        if (trip) {
          notifyOfficeUsers(database, {
            organizationId: user.organization_id,
            type: "trip_seen_by_driver",
            title: "Водитель увидел задание",
            message: `${user.full_name} · ${trip.number}: ${trip.loading_address} → ${trip.unloading_address}`,
            entityType: "trip",
            entityId: notification.entity_id
          });
        }
      }
    });
  }
  sendJson(response, 200, {
    notification: database.prepare("SELECT * FROM notifications WHERE id = ?").get(notification.id)
  });
}

async function markOfficeNotificationRead({ response, database, user, notificationId }) {
  const notification = database.prepare(`
    SELECT * FROM notifications
    WHERE id = ? AND organization_id = ? AND recipient_user_id = ?
  `).get(notificationId, user.organization_id, user.id);
  if (!notification) throw new HttpError(404, "Уведомление не найдено", "NOT_FOUND");
  if (!notification.read_at) {
    database.prepare("UPDATE notifications SET read_at = ? WHERE id = ?").run(nowIso(), notification.id);
  }
  sendJson(response, 200, {
    notification: database.prepare("SELECT * FROM notifications WHERE id = ?").get(notification.id)
  });
}

async function createRateAdjustment({ request, response, database, user, tripId }) {
  ownedRow(database, "trips", tripId, user.organization_id, "Рейс не найден");
  const body = await readJson(request);
  const type = enumValue(body.adjustmentType, ["surcharge", "discount", "penalty", "other"], "Тип корректировки");
  let amount = integer(body.amountKopecks, "Сумма корректировки");
  if (type === "surcharge" && amount < 0) amount = Math.abs(amount);
  if (["discount", "penalty"].includes(type) && amount > 0) amount = -amount;
  if (amount === 0) throw new HttpError(400, "Корректировка не может быть нулевой", "INVALID_AMOUNT");
  const attachmentId = body.attachmentId
    ? ownedOfficeAttachment(database, body.attachmentId, user, ["adjustment_proof"])
    : null;
  const id = entityId("adj");
  const reason = requiredText(body.reason, "Причина корректировки", 1000);
  const clientMutationId = optionalText(body.clientMutationId, 100) || entityId("mut");
  const duplicate = database.prepare(`
    SELECT * FROM trip_rate_adjustments WHERE organization_id = ? AND client_mutation_id = ?
  `).get(user.organization_id, clientMutationId);
  if (duplicate) {
    const sameMutation = duplicate.trip_id === tripId
      && duplicate.adjustment_type === type
      && Number(duplicate.amount_kopecks) === amount
      && duplicate.reason === reason
      && (duplicate.attachment_id || null) === attachmentId;
    if (!sameMutation) {
      throw new HttpError(409, "Идентификатор операции уже использован", "MUTATION_CONFLICT");
    }
    sendJson(response, 200, {
      adjustmentId: duplicate.id,
      trip: getOfficeTrip(database, tripId, user.organization_id),
      duplicate: true
    });
    return;
  }
  transaction(database, () => {
    database.prepare(`
      INSERT INTO trip_rate_adjustments(
        id, organization_id, trip_id, adjustment_type, amount_kopecks,
        reason, attachment_id, client_mutation_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, user.organization_id, tripId, type, amount, reason,
      attachmentId, clientMutationId, user.id, nowIso()
    );
    audit(database, event(user, "trip_rate_adjustment", id, "created", null, { tripId, type, amount, reason }));
  });
  sendJson(response, 201, { adjustmentId: id, trip: getOfficeTrip(database, tripId, user.organization_id) });
}

async function reverseRateAdjustment({ request, response, database, user, tripId, adjustmentId }) {
  ownedRow(database, "trips", tripId, user.organization_id, "Рейс не найден");
  const body = await readJson(request);
  const adjustment = database.prepare(`
    SELECT * FROM trip_rate_adjustments
    WHERE id = ? AND trip_id = ? AND organization_id = ?
  `).get(adjustmentId, tripId, user.organization_id);
  if (!adjustment) throw new HttpError(404, "Корректировка не найдена", "NOT_FOUND");
  if (adjustment.reversed_at) throw new HttpError(409, "Корректировка уже отменена", "ALREADY_REVERSED");
  const reason = requiredText(body.reason, "Причина отмены", 2000);
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare(`
      UPDATE trip_rate_adjustments
      SET reversed_at = ?, reversal_reason = ?
      WHERE id = ? AND reversed_at IS NULL
    `).run(timestamp, reason, adjustment.id);
    const after = database.prepare("SELECT * FROM trip_rate_adjustments WHERE id = ?").get(adjustment.id);
    audit(database, event(user, "trip_rate_adjustment", adjustment.id, "reversed", adjustment, after, reason));
  });
  sendJson(response, 200, { trip: getOfficeTrip(database, tripId, user.organization_id) });
}

async function createPayment({ request, response, database, user, tripId }) {
  const trip = ownedRow(database, "trips", tripId, user.organization_id, "Рейс не найден");
  const body = await readJson(request);
  const paymentId = entityId("pay");
  const allocationId = entityId("pal");
  const amount = toKopecks(positiveInteger(body.amountKopecks, "Сумма платежа"));
  const clientMutationId = optionalText(body.clientMutationId, 100) || entityId("mut");
  const attachmentId = body.attachmentId
    ? ownedOfficeAttachment(database, body.attachmentId, user, ["payment_proof"])
    : null;
  const paymentType = enumValue(body.paymentType, ["advance", "partial", "final", "other"], "Вид платежа");
  const paymentMethod = enumValue(body.paymentMethod, ["bank", "cash", "card_transfer"], "Способ оплаты");
  const receivedAt = requiredDateTime(body.receivedAt, "Дата платежа");
  const comment = optionalText(body.comment, 1000);
  const duplicate = database.prepare(`
    SELECT p.*, pa.trip_id, pa.amount_kopecks AS allocated_kopecks
    FROM incoming_payments p
    JOIN payment_allocations pa ON pa.payment_id = p.id
    WHERE p.organization_id = ? AND p.client_mutation_id = ?
  `).get(user.organization_id, clientMutationId);
  if (duplicate) {
    const sameMutation = duplicate.customer_id === trip.customer_id
      && duplicate.trip_id === tripId
      && Number(duplicate.amount_kopecks) === amount
      && Number(duplicate.allocated_kopecks) === amount
      && duplicate.payment_type === paymentType
      && duplicate.payment_method === paymentMethod
      && duplicate.received_at === receivedAt
      && duplicate.comment === comment
      && (duplicate.attachment_id || null) === attachmentId;
    if (!sameMutation) {
      throw new HttpError(409, "Идентификатор операции уже использован", "MUTATION_CONFLICT");
    }
    sendJson(response, 200, {
      paymentId: duplicate.id,
      trip: getOfficeTrip(database, tripId, user.organization_id),
      duplicate: true
    });
    return;
  }
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare(`
      INSERT INTO incoming_payments(
        id, organization_id, customer_id, amount_kopecks, payment_type,
        payment_method, received_at, comment, attachment_id, client_mutation_id,
        created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId, user.organization_id, trip.customer_id, amount,
      paymentType, paymentMethod, receivedAt, comment,
      attachmentId, clientMutationId, user.id, timestamp
    );
    database.prepare(`
      INSERT INTO payment_allocations(
        id, organization_id, payment_id, trip_id, amount_kopecks, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(allocationId, user.organization_id, paymentId, tripId, amount, user.id, timestamp);
    audit(database, event(user, "incoming_payment", paymentId, "created_and_allocated", null, { tripId, amount }));
  });
  sendJson(response, 201, { paymentId, trip: getOfficeTrip(database, tripId, user.organization_id) });
}

async function reversePayment({ request, response, database, user, tripId, paymentId }) {
  ownedRow(database, "trips", tripId, user.organization_id, "Рейс не найден");
  const body = await readJson(request);
  const payment = database.prepare(`
    SELECT p.*
    FROM incoming_payments p
    JOIN payment_allocations pa ON pa.payment_id = p.id
    WHERE p.id = ? AND pa.trip_id = ? AND p.organization_id = ?
  `).get(paymentId, tripId, user.organization_id);
  if (!payment) throw new HttpError(404, "Оплата не найдена", "NOT_FOUND");
  if (payment.reversed_at) throw new HttpError(409, "Оплата уже отменена", "ALREADY_REVERSED");
  const reason = requiredText(body.reason, "Причина отмены", 2000);
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare(`
      UPDATE incoming_payments
      SET reversed_at = ?, reversal_reason = ?
      WHERE id = ? AND reversed_at IS NULL
    `).run(timestamp, reason, payment.id);
    const after = database.prepare("SELECT * FROM incoming_payments WHERE id = ?").get(payment.id);
    audit(database, event(user, "incoming_payment", payment.id, "reversed", payment, after, reason));
  });
  sendJson(response, 200, { trip: getOfficeTrip(database, tripId, user.organization_id) });
}

async function confirmTrip({ request, response, database, user, tripId }) {
  const trip = ownedRow(database, "trips", tripId, user.organization_id, "Рейс не найден");
  if (trip.status !== "pending_review") throw new HttpError(409, "Рейс не ожидает проверки", "INVALID_TRIP_STATUS");
  const pending = database.prepare(`
    SELECT COUNT(*) AS count FROM expenses
    WHERE trip_id = ? AND status NOT IN ('confirmed', 'rejected')
  `).get(tripId);
  if (Number(pending.count) > 0) {
    throw new HttpError(409, "Сначала проверьте все расходы рейса", "EXPENSES_PENDING");
  }
  const timestamp = nowIso();
  transaction(database, () => {
    database.prepare(`
      UPDATE trips
      SET status = 'confirmed', confirmed_at = ?, confirmed_by = ?,
          row_version = row_version + 1, updated_at = ?
      WHERE id = ?
    `).run(timestamp, user.id, timestamp, tripId);
    const compensation = createTripCompensationAccruals(database, user, tripId, timestamp);
    audit(database, event(user, "trip", tripId, "confirmed", trip, {
      ...trip,
      status: "confirmed",
      compensation
    }));
  });
  sendJson(response, 200, { trip: getOfficeTrip(database, tripId, user.organization_id) });
}

function createTripCompensationAccruals(database, user, tripId, timestamp = nowIso()) {
  const trip = database.prepare(`
    SELECT t.*,
      (SELECT entered_value_km FROM odometer_readings o WHERE o.trip_id = t.id AND o.reading_type = 'start') AS start_odometer_km,
      (SELECT entered_value_km FROM odometer_readings o WHERE o.trip_id = t.id AND o.reading_type = 'end') AS end_odometer_km
    FROM trips t
    WHERE t.id = ? AND t.organization_id = ?
  `).get(tripId, user.organization_id);
  if (!trip || trip.start_odometer_km == null || trip.end_odometer_km == null || !trip.loaded_at || !trip.unloaded_at) {
    throw new HttpError(409, "Для начисления нужны даты и оба показания одометра", "COMPENSATION_DATA_MISSING");
  }
  const rates = effectiveCompensationRates(database, trip);
  const distanceKm = Number(trip.end_odometer_km) - Number(trip.start_odometer_km);
  if (!Number.isSafeInteger(distanceKm) || distanceKm < 0) {
    throw new HttpError(409, "Некорректный подтверждённый пробег", "INVALID_ODOMETER");
  }
  const periodFrom = moscowDate(trip.loaded_at);
  const periodTo = moscowDate(trip.unloaded_at);
  const dailyDays = daysBetween(periodFrom, periodTo) + 1;
  if (!Number.isSafeInteger(dailyDays) || dailyDays <= 0) {
    throw new HttpError(409, "Некорректный период суточных", "INVALID_DAILY_PERIOD");
  }
  const created = [];
  const insert = database.prepare(`
    INSERT OR IGNORE INTO driver_accruals(
      id, organization_id, driver_id, trip_id, accrual_type,
      balance_category, balance_effect_kopecks, quantity_units,
      unit_rate_kopecks, period_from, period_to, comment,
      source_type, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trip_confirmation', ?, ?)
  `);
  const salaryAmount = distanceKm * rates.salaryRateKopecksPerKm;
  if (!Number.isSafeInteger(salaryAmount)) {
    throw new HttpError(400, "Сумма зарплаты слишком велика", "INVALID_AMOUNT");
  }
  if (salaryAmount > 0) {
    const id = entityId("acc");
    const result = insert.run(
      id, trip.organization_id, trip.driver_id, trip.id, "salary", "salary",
      salaryAmount, distanceKm, rates.salaryRateKopecksPerKm,
      periodFrom, periodTo, `Пробег ${distanceKm} км`, user.id, timestamp
    );
    if (Number(result.changes) > 0) created.push({ id, type: "salary", amountKopecks: salaryAmount });
  }
  const dailyAmount = dailyDays * rates.dailyRateKopecks;
  if (!Number.isSafeInteger(dailyAmount)) {
    throw new HttpError(400, "Сумма суточных слишком велика", "INVALID_AMOUNT");
  }
  if (dailyAmount > 0) {
    const id = entityId("acc");
    const result = insert.run(
      id, trip.organization_id, trip.driver_id, trip.id, "daily", "daily",
      dailyAmount, dailyDays, rates.dailyRateKopecks,
      periodFrom, periodTo, `Суточные за ${dailyDays} дн.`, user.id, timestamp
    );
    if (Number(result.changes) > 0) created.push({ id, type: "daily", amountKopecks: dailyAmount });
  }
  for (const accrual of created) {
    audit(database, event(user, "driver_accrual", accrual.id, "created_from_trip", null, {
      tripId: trip.id,
      ...accrual
    }));
  }
  return {
    distanceKm,
    dailyDays,
    salaryRateKopecksPerKm: rates.salaryRateKopecksPerKm,
    dailyRateKopecks: rates.dailyRateKopecks,
    created
  };
}

function officeBootstrap(database, user) {
  const organizationId = user.organization_id;
  const drivers = database.prepare(`
    SELECT id, full_name, login, phone, birth_date, is_active
    FROM users WHERE organization_id = ? AND role = 'driver'
    ORDER BY full_name
  `).all(organizationId);
  return {
    user: publicUser(user),
    organization: database.prepare("SELECT id, name, vat_rate_basis_points FROM organizations WHERE id = ?").get(organizationId),
    compensationSettings: getOrganizationCompensationSettings(database, organizationId),
    driverCompensationSettings: database.prepare(`
      SELECT * FROM driver_compensation_settings
      WHERE organization_id = ? ORDER BY driver_id
    `).all(organizationId),
    driverSettlements: drivers.map((driver) => getDriverSettlement(database, driver.id, organizationId)),
    driverTransfers: getDriverTransfers(database, organizationId),
    driverAccruals: getDriverAccruals(database, organizationId),
    officeUsers: database.prepare(`
      SELECT id, full_name, login, phone, is_active
      FROM users WHERE organization_id = ? AND role = 'office'
      ORDER BY full_name
    `).all(organizationId),
    drivers,
    tractors: database.prepare("SELECT * FROM tractors WHERE organization_id = ? ORDER BY brand, model, plate_number").all(organizationId),
    trailers: database.prepare("SELECT * FROM trailers WHERE organization_id = ? ORDER BY brand, model, plate_number").all(organizationId),
    rigs: database.prepare(`${rigSelectSql()} ORDER BY r.name`).all(organizationId),
    customers: database.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM customer_contacts cc WHERE cc.customer_id = c.id) AS contact_count
      FROM customers c WHERE c.organization_id = ? ORDER BY c.short_name
    `).all(organizationId),
    contacts: database.prepare(`
      SELECT cc.*, cp.id AS phone_id, cp.phone, cp.label AS phone_label
      FROM customer_contacts cc
      LEFT JOIN customer_contact_phones cp ON cp.contact_id = cc.id
      WHERE cc.organization_id = ?
      ORDER BY cc.full_name, cp.created_at
    `).all(organizationId),
    recurringCosts: database.prepare(`
      SELECT rc.*, r.name AS subject_name
      FROM recurring_costs rc
      JOIN rigs r ON rc.subject_type = 'rig' AND r.id = rc.subject_id
      WHERE rc.organization_id = ?
      ORDER BY rc.valid_from DESC, rc.created_at DESC
    `).all(organizationId),
    expenseCategories: getExpenseCategories(database, organizationId),
    companyExpenses: getCompanyExpenses(database, organizationId),
    notifications: getUserNotifications(database, user.id, organizationId),
    trips: getOfficeTrips(database, organizationId),
    expenses: addExpenseReviewTimelines(database, database.prepare(`
      SELECT e.*, u.full_name AS driver_name, t.number AS trip_number,
        (SELECT ee.message FROM expense_explanations ee
         WHERE ee.expense_id = e.id ORDER BY ee.created_at DESC LIMIT 1) AS driver_explanation,
        (SELECT ee.created_at FROM expense_explanations ee
         WHERE ee.expense_id = e.id ORDER BY ee.created_at DESC LIMIT 1) AS driver_explained_at
      FROM expenses e
      JOIN users u ON u.id = e.driver_id
      JOIN trips t ON t.id = e.trip_id
      WHERE e.organization_id = ?
      ORDER BY e.created_at DESC
    `).all(organizationId), organizationId)
  };
}

function officeReport(database, user, url) {
  const from = requiredDate(url.searchParams.get("from"), "Начало периода");
  const to = requiredDate(url.searchParams.get("to"), "Конец периода");
  if (to < from) throw new HttpError(400, "Конец периода не может быть раньше начала", "INVALID_REPORT_PERIOD");
  if (daysBetween(from, to) > 3660) {
    throw new HttpError(400, "Период отчёта не может превышать 10 лет", "INVALID_REPORT_PERIOD");
  }
  const rigId = optionalText(url.searchParams.get("rigId"), 100);
  if (rigId) ownedRow(database, "rigs", rigId, user.organization_id, "Сцепка не найдена");

  const tripSql = `${officeTripSelectSql()}
    AND t.status IN ('pending_review', 'needs_explanation', 'confirmed', 'closed')
    AND date(t.unloaded_at, '+3 hours') BETWEEN ? AND ?
    ${rigId ? "AND t.rig_id = ?" : ""}
    ORDER BY t.unloaded_at`;
  const trips = database.prepare(tripSql).all(
    user.organization_id,
    from,
    to,
    ...(rigId ? [rigId] : [])
  );
  const rigs = database.prepare(`
    SELECT id, name FROM rigs
    WHERE organization_id = ? ${rigId ? "AND id = ?" : ""}
    ORDER BY name
  `).all(user.organization_id, ...(rigId ? [rigId] : []));
  const costs = database.prepare(`
    SELECT * FROM recurring_costs
    WHERE organization_id = ? AND subject_type = 'rig' AND reversed_at IS NULL
      AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)
      ${rigId ? "AND subject_id = ?" : ""}
  `).all(user.organization_id, to, from, ...(rigId ? [rigId] : []));
  const oneOffExpenses = database.prepare(`
    SELECT * FROM company_expenses
    WHERE organization_id = ? AND reversed_at IS NULL
      AND date(occurred_at, '+3 hours') BETWEEN ? AND ?
      ${rigId ? "AND scope_type = 'rig' AND rig_id = ?" : ""}
    ORDER BY occurred_at
  `).all(user.organization_id, from, to, ...(rigId ? [rigId] : []));

  const byRig = new Map(rigs.map((rig) => [rig.id, {
    rigId: rig.id,
    rigName: rig.name,
    tripCount: 0,
    preliminaryTripCount: 0,
    distanceKm: 0,
    revenueKopecks: 0,
    tripExpensesKopecks: 0,
    driverCompensationKopecks: 0,
    fixedCostsKopecks: 0,
    oneOffExpensesKopecks: 0,
    receivedKopecks: 0,
    receivableKopecks: 0,
    profitKopecks: 0
  }]));
  const tripExpenseCategories = new Map();
  const fixedCostCategories = new Map();
  const oneOffExpenseCategories = new Map();
  const tripCategoryQuery = database.prepare(`
    SELECT category, COALESCE(SUM(amount_kopecks), 0) AS amount_kopecks
    FROM expenses
    WHERE trip_id = ? AND status != 'rejected'
    GROUP BY category
  `);

  for (const trip of trips) {
    const row = byRig.get(trip.rig_id);
    if (!row) continue;
    row.tripCount += 1;
    if (!['confirmed', 'closed'].includes(trip.status)) row.preliminaryTripCount += 1;
    row.distanceKm += trip.start_odometer_km != null && trip.end_odometer_km != null
      ? Math.max(0, Number(trip.end_odometer_km) - Number(trip.start_odometer_km))
      : 0;
    row.revenueKopecks += Number(trip.final_rate_kopecks || 0);
    row.tripExpensesKopecks += Number(trip.preliminary_expenses_kopecks || 0);
    const driverCompensation = ["confirmed", "closed"].includes(trip.status)
      ? Number(trip.driver_compensation_kopecks || 0)
      : estimatedTripCompensation(database, trip);
    trip.report_driver_compensation_kopecks = driverCompensation;
    row.driverCompensationKopecks += driverCompensation;
    row.receivedKopecks += Number(trip.received_kopecks || 0);
    row.receivableKopecks += Number(trip.receivable_kopecks || 0);
    for (const category of tripCategoryQuery.all(trip.id)) {
      addCategoryAmount(tripExpenseCategories, category.category, category.amount_kopecks);
    }
  }
  for (const cost of costs) {
    const row = byRig.get(cost.subject_id);
    const amount = recurringCostForPeriod(cost, from, to);
    if (row) row.fixedCostsKopecks += amount;
    addCategoryAmount(fixedCostCategories, cost.category, amount);
  }
  let unallocatedCompanyExpensesKopecks = 0;
  for (const expense of oneOffExpenses) {
    const row = expense.rig_id ? byRig.get(expense.rig_id) : null;
    if (row) row.oneOffExpensesKopecks += Number(expense.amount_kopecks);
    else unallocatedCompanyExpensesKopecks += Number(expense.amount_kopecks);
    addCategoryAmount(oneOffExpenseCategories, expense.category, expense.amount_kopecks);
  }
  for (const row of byRig.values()) {
    row.operatingCostsKopecks = row.tripExpensesKopecks
      + row.driverCompensationKopecks + row.fixedCostsKopecks
      + row.oneOffExpensesKopecks;
    row.profitKopecks = row.revenueKopecks - row.operatingCostsKopecks;
    row.costPerKmKopecks = row.distanceKm > 0
      ? Math.round(row.operatingCostsKopecks / row.distanceKm)
      : null;
    row.revenuePerKmKopecks = row.distanceKm > 0
      ? Math.round(row.revenueKopecks / row.distanceKm)
      : null;
  }
  const rows = [...byRig.values()];
  const totals = rows.reduce((result, row) => {
    for (const key of [
      "tripCount", "preliminaryTripCount", "distanceKm", "revenueKopecks",
      "tripExpensesKopecks", "driverCompensationKopecks", "fixedCostsKopecks",
      "oneOffExpensesKopecks", "receivedKopecks",
      "receivableKopecks", "profitKopecks"
    ]) result[key] += row[key];
    return result;
  }, {
    tripCount: 0,
    preliminaryTripCount: 0,
    distanceKm: 0,
    revenueKopecks: 0,
    tripExpensesKopecks: 0,
    driverCompensationKopecks: 0,
    fixedCostsKopecks: 0,
    oneOffExpensesKopecks: 0,
    receivedKopecks: 0,
    receivableKopecks: 0,
    profitKopecks: 0
  });

  totals.unallocatedCompanyExpensesKopecks = unallocatedCompanyExpensesKopecks;
  totals.oneOffExpensesKopecks += unallocatedCompanyExpensesKopecks;
  totals.profitKopecks -= unallocatedCompanyExpensesKopecks;
  totals.operatingCostsKopecks = totals.tripExpensesKopecks
    + totals.driverCompensationKopecks + totals.fixedCostsKopecks
    + totals.oneOffExpensesKopecks;
  totals.costPerKmKopecks = totals.distanceKm > 0
    ? Math.round(totals.operatingCostsKopecks / totals.distanceKm)
    : null;
  totals.revenuePerKmKopecks = totals.distanceKm > 0
    ? Math.round(totals.revenueKopecks / totals.distanceKm)
    : null;

  return {
    period: { from, to },
    totals,
    rigs: rows,
    trips,
    companyExpenses: oneOffExpenses,
    costBreakdown: {
      tripExpenses: categoryRows(tripExpenseCategories),
      fixedCosts: categoryRows(fixedCostCategories),
      oneOffExpenses: categoryRows(oneOffExpenseCategories)
    }
  };
}

function addCategoryAmount(map, category, amount) {
  map.set(category, (map.get(category) || 0) + Number(amount || 0));
}

function categoryRows(map) {
  return [...map.entries()]
    .map(([category, amountKopecks]) => ({ category, amountKopecks }))
    .sort((left, right) => right.amountKopecks - left.amountKopecks || left.category.localeCompare(right.category, "ru"));
}

function estimatedTripCompensation(database, trip) {
  const rates = effectiveCompensationRates(database, trip);
  const distanceKm = trip.start_odometer_km != null && trip.end_odometer_km != null
    ? Math.max(0, Number(trip.end_odometer_km) - Number(trip.start_odometer_km))
    : 0;
  const periodFrom = trip.loaded_at ? moscowDate(trip.loaded_at) : null;
  const periodTo = trip.unloaded_at ? moscowDate(trip.unloaded_at) : null;
  const dailyDays = periodFrom && periodTo && periodTo >= periodFrom
    ? daysBetween(periodFrom, periodTo) + 1
    : 0;
  const amount = distanceKm * rates.salaryRateKopecksPerKm + dailyDays * rates.dailyRateKopecks;
  if (!Number.isSafeInteger(amount)) {
    throw new HttpError(400, "Начисление водителю слишком велико", "INVALID_AMOUNT");
  }
  return amount;
}

function recurringCostForPeriod(cost, from, to) {
  const reportStart = dateAtUtc(from);
  const reportEnd = dateAtUtc(to);
  const validStart = dateAtUtc(cost.valid_from);
  const explicitValidEnd = cost.valid_to ? dateAtUtc(cost.valid_to) : null;
  const allocationMonths = Number(cost.allocation_months || 1);
  const scheduleStart = startOfUtcMonth(validStart);
  // "Разделить на N месяцев" означает N полных календарных долей.
  // День, в который запись внесли, не должен второй раз уменьшать первую долю.
  const accrualStart = cost.allocation_mode === "equal_months" ? scheduleStart : validStart;
  const scheduleEnd = cost.allocation_mode === "equal_months"
    ? endOfUtcMonth(addUtcMonths(scheduleStart, allocationMonths - 1))
    : explicitValidEnd || reportEnd;
  const effectiveEnd = explicitValidEnd && explicitValidEnd < scheduleEnd ? explicitValidEnd : scheduleEnd;
  let cursor = startOfUtcMonth(reportStart > accrualStart ? reportStart : accrualStart);
  const finalMonth = startOfUtcMonth(reportEnd < effectiveEnd ? reportEnd : effectiveEnd);
  let total = 0;

  while (cursor <= finalMonth) {
    const monthIndex = monthsBetween(scheduleStart, cursor);
    if (monthIndex >= 0 && (cost.allocation_mode === "monthly" || monthIndex < allocationMonths)) {
      const monthStart = cursor;
      const monthEnd = endOfUtcMonth(cursor);
      const activeStart = maxDate(monthStart, reportStart, accrualStart);
      const activeEnd = minDate(monthEnd, reportEnd, effectiveEnd);
      if (activeStart <= activeEnd) {
        const monthAmount = cost.allocation_mode === "monthly"
          ? Number(cost.total_amount_kopecks)
          : equalMonthAmount(Number(cost.total_amount_kopecks), allocationMonths, monthIndex);
        const activeDays = daysBetweenDates(activeStart, activeEnd) + 1;
        const daysInMonth = monthEnd.getUTCDate();
        total += Math.round(monthAmount * activeDays / daysInMonth);
      }
    }
    cursor = addUtcMonths(cursor, 1);
  }
  return total;
}

function equalMonthAmount(total, months, index) {
  const base = Math.floor(total / months);
  return base + (index < total % months ? 1 : 0);
}

function dateAtUtc(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function moscowDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "Некорректные дата и время", "VALIDATION_ERROR");
  }
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function startOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addUtcMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthsBetween(from, to) {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
}

function minDate(...dates) {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function maxDate(...dates) {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function daysBetweenDates(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function daysBetween(from, to) {
  return daysBetweenDates(dateAtUtc(from), dateAtUtc(to));
}

function driverBootstrap(database, user, driverCompensationVisible = false) {
  const trips = database.prepare(`${driverTripSelectSql()} ORDER BY t.created_at DESC`).all(user.id, user.organization_id);
  for (const trip of trips) addTripStops(database, trip);
  const result = {
    user: publicUser(user),
    capabilities: {
      compensationVisible: Boolean(driverCompensationVisible)
    },
    notifications: getDriverNotifications(
      database,
      user.id,
      user.organization_id,
      driverCompensationVisible
    ),
    expenseCategories: getExpenseCategories(database, user.organization_id, true),
    trips,
    expenses: addExpenseReviewTimelines(database, database.prepare(`
      SELECT e.id, e.trip_id, e.amount_kopecks, e.category, e.payment_method, e.payment_source,
             e.supplier, e.description, e.location_text, e.status, e.review_comment,
             e.receipt_attachment_id, e.occurred_at, e.created_at,
             (SELECT ee.message FROM expense_explanations ee
              WHERE ee.expense_id = e.id ORDER BY ee.created_at DESC LIMIT 1) AS driver_explanation,
             (SELECT ee.created_at FROM expense_explanations ee
              WHERE ee.expense_id = e.id ORDER BY ee.created_at DESC LIMIT 1) AS driver_explained_at
      FROM expenses e
      WHERE e.driver_id = ? AND e.organization_id = ?
      ORDER BY e.created_at DESC
    `).all(user.id, user.organization_id), user.organization_id)
  };
  if (driverCompensationVisible) {
    result.settlement = getDriverSettlement(database, user.id, user.organization_id);
    result.transfers = getDriverTransfers(database, user.organization_id, user.id);
    result.accruals = getDriverAccruals(database, user.organization_id, user.id);
  }
  return result;
}

function getDriverExpense(database, expenseId) {
  const expense = database.prepare(`
    SELECT e.id, e.trip_id, e.amount_kopecks, e.category, e.payment_method, e.payment_source,
           e.supplier, e.description, e.location_text, e.status, e.review_comment,
           e.receipt_attachment_id, e.occurred_at, e.created_at,
           (SELECT ee.message FROM expense_explanations ee
            WHERE ee.expense_id = e.id ORDER BY ee.created_at DESC LIMIT 1) AS driver_explanation,
           (SELECT ee.created_at FROM expense_explanations ee
            WHERE ee.expense_id = e.id ORDER BY ee.created_at DESC LIMIT 1) AS driver_explained_at
    FROM expenses e WHERE e.id = ?
  `).get(expenseId);
  if (!expense) return undefined;
  const owner = database.prepare("SELECT organization_id FROM expenses WHERE id = ?").get(expenseId);
  return addExpenseReviewTimelines(database, [expense], owner.organization_id)[0];
}

function addExpenseReviewTimelines(database, expenses, organizationId) {
  const timelines = new Map(expenses.map((expense) => [expense.id, []]));
  if (timelines.size === 0) return expenses;
  const entries = database.prepare(`
    SELECT * FROM (
      SELECT
        re.expense_id AS expenseId,
        re.id AS id,
        'office_review' AS entryType,
        re.review_status AS status,
        re.comment AS message,
        u.full_name AS actorName,
        'office' AS actorRole,
        re.created_at AS createdAt,
        0 AS timelineOrder
      FROM expense_review_events re
      JOIN users u ON u.id = re.reviewer_id
      WHERE re.organization_id = ?
      UNION ALL
      SELECT
        ee.expense_id AS expenseId,
        ee.id AS id,
        'driver_explanation' AS entryType,
        NULL AS status,
        ee.message AS message,
        u.full_name AS actorName,
        'driver' AS actorRole,
        ee.created_at AS createdAt,
        1 AS timelineOrder
      FROM expense_explanations ee
      JOIN users u ON u.id = ee.driver_id
      WHERE ee.organization_id = ?
    )
    ORDER BY expenseId, createdAt, timelineOrder, id
  `).all(organizationId, organizationId);
  for (const entry of entries) {
    const timeline = timelines.get(entry.expenseId);
    if (!timeline) continue;
    const { expenseId: ignoredExpenseId, timelineOrder: ignoredOrder, ...publicEntry } = entry;
    timeline.push(publicEntry);
  }
  for (const expense of expenses) expense.review_timeline = timelines.get(expense.id) || [];
  return expenses;
}

function getDriverNotifications(database, driverId, organizationId, driverCompensationVisible = false) {
  const notifications = getUserNotifications(database, driverId, organizationId);
  if (driverCompensationVisible) return notifications;
  return notifications.map(hideDriverCompensationNotification);
}

function getUserNotifications(database, userId, organizationId) {
  return database.prepare(`
    SELECT * FROM notifications
    WHERE recipient_user_id = ? AND organization_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(userId, organizationId);
}

function hideDriverCompensationNotification(notification) {
  if (notification.notification_type === "driver_payment") {
    return {
      ...notification,
      title: "Офис зарегистрировал перевод",
      message: "Денежная операция учтена офисом без раскрытия расчёта."
    };
  }
  if (notification.notification_type === "driver_return") {
    return {
      ...notification,
      title: "Офис зарегистрировал возврат",
      message: "Возврат учтён офисом без раскрытия расчёта."
    };
  }
  if (notification.notification_type === "driver_transfer_reversed") {
    return {
      ...notification,
      title: "Денежная запись отменена офисом",
      message: "Офис отменил ранее зарегистрированную денежную операцию."
    };
  }
  return notification;
}

function createNotification(database, {
  organizationId,
  recipientUserId,
  type,
  title,
  message,
  entityType = null,
  entityId: targetId = null
}) {
  const notificationId = entityId("ntf");
  const timestamp = nowIso();
  database.prepare(`
    INSERT INTO notifications(
      id, organization_id, recipient_user_id, notification_type,
      title, message, entity_type, entity_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    notificationId, organizationId, recipientUserId,
    type, title, message, entityType, targetId, timestamp
  );
  const subscriptions = database.prepare(`
    SELECT id FROM push_subscriptions
    WHERE organization_id = ? AND user_id = ? AND disabled_at IS NULL
  `).all(organizationId, recipientUserId);
  const insertDelivery = database.prepare(`
    INSERT OR IGNORE INTO push_deliveries(
      id, organization_id, notification_id, subscription_id,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `);
  for (const subscription of subscriptions) {
    insertDelivery.run(
      entityId("pdl"),
      organizationId,
      notificationId,
      subscription.id,
      timestamp,
      timestamp
    );
  }
  return notificationId;
}

function notifyOfficeUsers(database, {
  organizationId,
  type,
  title,
  message,
  entityType = null,
  entityId: targetId = null
}) {
  const recipients = database.prepare(`
    SELECT id FROM users
    WHERE organization_id = ? AND role = 'office' AND is_active = 1
    ORDER BY id
  `).all(organizationId);
  return recipients.map((recipient) => createNotification(database, {
    organizationId,
    recipientUserId: recipient.id,
    type,
    title,
    message,
    entityType,
    entityId: targetId
  }));
}

function formatKopecksForMessage(kopecks) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 })
    .format(Number(kopecks || 0) / 100)} ₽`;
}

function allocationTypeForMessage(type) {
  return {
    salary: "зарплата",
    daily: "суточные",
    expense_advance: "аванс на расходы",
    expense_reimbursement: "компенсация расхода"
  }[type] || type;
}

function getOrganizationCompensationSettings(database, organizationId) {
  return database.prepare(`
    SELECT organization_id, default_salary_rate_kopecks_per_km,
           default_daily_rate_kopecks, updated_by, updated_at
    FROM organization_compensation_settings
    WHERE organization_id = ?
  `).get(organizationId) || {
    organization_id: organizationId,
    default_salary_rate_kopecks_per_km: 1200,
    default_daily_rate_kopecks: 150000,
    updated_by: null,
    updated_at: null
  };
}

function getDriverCompensationSettings(database, driverId, organizationId) {
  return database.prepare(`
    SELECT * FROM driver_compensation_settings
    WHERE driver_id = ? AND organization_id = ?
  `).get(driverId, organizationId) || null;
}

function effectiveCompensationRates(database, trip) {
  const organization = getOrganizationCompensationSettings(database, trip.organization_id);
  const driver = getDriverCompensationSettings(database, trip.driver_id, trip.organization_id);
  return {
    salaryRateKopecksPerKm: Number(
      trip.salary_rate_override_kopecks_per_km
      ?? driver?.salary_rate_kopecks_per_km
      ?? organization.default_salary_rate_kopecks_per_km
      ?? 1200
    ),
    dailyRateKopecks: Number(
      trip.daily_rate_override_kopecks
      ?? driver?.daily_rate_kopecks
      ?? organization.default_daily_rate_kopecks
      ?? 150000
    )
  };
}

function getDriverSettlement(database, driverId, organizationId) {
  const driver = database.prepare(`
    SELECT id, full_name, phone, is_active
    FROM users WHERE id = ? AND organization_id = ? AND role = 'driver'
  `).get(driverId, organizationId);
  if (!driver) throw new HttpError(404, "Водитель не найден", "NOT_FOUND");
  const accrual = database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN balance_category = 'salary' THEN balance_effect_kopecks ELSE 0 END), 0) AS salary_accrued_kopecks,
      COALESCE(SUM(CASE WHEN balance_category = 'daily' THEN balance_effect_kopecks ELSE 0 END), 0) AS daily_accrued_kopecks,
      COALESCE(SUM(CASE WHEN balance_category = 'general' THEN balance_effect_kopecks ELSE 0 END), 0) AS general_balance_kopecks,
      MAX(CASE WHEN balance_category = 'daily' AND balance_effect_kopecks > 0 THEN period_to END) AS daily_accrued_through
    FROM driver_accruals
    WHERE driver_id = ? AND organization_id = ? AND reversed_at IS NULL
  `).get(driver.id, organizationId);
  const paid = database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN a.allocation_type = 'salary'
        THEN CASE WHEN t.direction = 'company_to_driver' THEN a.amount_kopecks ELSE -a.amount_kopecks END
        ELSE 0 END), 0) AS salary_paid_kopecks,
      COALESCE(SUM(CASE WHEN a.allocation_type = 'daily'
        THEN CASE WHEN t.direction = 'company_to_driver' THEN a.amount_kopecks ELSE -a.amount_kopecks END
        ELSE 0 END), 0) AS daily_paid_kopecks,
      COALESCE(SUM(CASE WHEN a.allocation_type = 'expense_advance'
        THEN CASE WHEN t.direction = 'company_to_driver' THEN a.amount_kopecks ELSE -a.amount_kopecks END
        ELSE 0 END), 0) AS advance_issued_kopecks,
      COALESCE(SUM(CASE WHEN a.allocation_type = 'expense_reimbursement'
        THEN CASE WHEN t.direction = 'company_to_driver' THEN a.amount_kopecks ELSE -a.amount_kopecks END
        ELSE 0 END), 0) AS reimbursement_paid_kopecks,
      MAX(CASE WHEN a.allocation_type = 'daily' AND t.direction = 'company_to_driver'
        THEN a.coverage_through END) AS daily_paid_through
    FROM driver_transfer_allocations a
    JOIN driver_transfers t ON t.id = a.transfer_id
    WHERE a.driver_id = ? AND a.organization_id = ? AND t.reversed_at IS NULL
  `).get(driver.id, organizationId);
  const expense = database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'confirmed' AND payment_source = 'driver_personal' THEN amount_kopecks ELSE 0 END), 0) AS personal_expenses_kopecks,
      COALESCE(SUM(CASE WHEN status = 'confirmed' AND payment_source = 'driver_advance' THEN amount_kopecks ELSE 0 END), 0) AS advance_spent_kopecks,
      COALESCE(SUM(CASE WHEN status NOT IN ('confirmed', 'rejected') AND payment_source IN ('driver_personal', 'driver_advance') THEN amount_kopecks ELSE 0 END), 0) AS unconfirmed_expenses_kopecks
    FROM expenses
    WHERE driver_id = ? AND organization_id = ?
  `).get(driver.id, organizationId);
  const provisionalDaily = getProvisionalDailyAccrual(database, driver.id, organizationId);
  const confirmedDailyAccrued = Number(accrual.daily_accrued_kopecks);
  const totalDailyAccrued = confirmedDailyAccrued + provisionalDaily.amountKopecks;
  const salaryBalance = Number(accrual.salary_accrued_kopecks) - Number(paid.salary_paid_kopecks);
  const dailyBalance = totalDailyAccrued - Number(paid.daily_paid_kopecks);
  const reimbursementBalance = Number(expense.personal_expenses_kopecks) - Number(paid.reimbursement_paid_kopecks);
  const advanceBalance = Number(paid.advance_issued_kopecks) - Number(expense.advance_spent_kopecks);
  const netBalance = salaryBalance + dailyBalance + reimbursementBalance
    + Number(accrual.general_balance_kopecks) - advanceBalance;
  return {
    driverId: driver.id,
    driverName: driver.full_name,
    phone: driver.phone,
    isActive: Boolean(driver.is_active),
    salaryAccruedKopecks: Number(accrual.salary_accrued_kopecks),
    salaryPaidKopecks: Number(paid.salary_paid_kopecks),
    salaryBalanceKopecks: salaryBalance,
    dailyAccruedKopecks: totalDailyAccrued,
    dailyConfirmedAccruedKopecks: confirmedDailyAccrued,
    dailyProvisionalAccruedKopecks: provisionalDaily.amountKopecks,
    dailyPaidKopecks: Number(paid.daily_paid_kopecks),
    dailyBalanceKopecks: dailyBalance,
    dailyAccruedThrough: latestDate(accrual.daily_accrued_through, provisionalDaily.through),
    dailyPaidThrough: paid.daily_paid_through || null,
    advanceIssuedKopecks: Number(paid.advance_issued_kopecks),
    advanceSpentKopecks: Number(expense.advance_spent_kopecks),
    advanceBalanceKopecks: advanceBalance,
    personalExpensesKopecks: Number(expense.personal_expenses_kopecks),
    reimbursementPaidKopecks: Number(paid.reimbursement_paid_kopecks),
    reimbursementBalanceKopecks: reimbursementBalance,
    generalBalanceKopecks: Number(accrual.general_balance_kopecks),
    unconfirmedExpensesKopecks: Number(expense.unconfirmed_expenses_kopecks),
    netBalanceKopecks: netBalance,
    companyOwesKopecks: Math.max(netBalance, 0),
    driverOwesKopecks: Math.max(-netBalance, 0)
  };
}

function getProvisionalDailyAccrual(database, driverId, organizationId) {
  const trips = database.prepare(`
    SELECT * FROM trips
    WHERE driver_id = ? AND organization_id = ?
      AND status IN ('in_progress', 'completed_by_driver', 'pending_review', 'needs_explanation')
      AND loaded_at IS NOT NULL
    ORDER BY loaded_at
  `).all(driverId, organizationId);
  let amountKopecks = 0;
  let through = null;
  const today = moscowDate(nowIso());
  for (const trip of trips) {
    const periodFrom = moscowDate(trip.loaded_at);
    const periodTo = trip.unloaded_at ? moscowDate(trip.unloaded_at) : today;
    if (periodTo < periodFrom) continue;
    const days = daysBetween(periodFrom, periodTo) + 1;
    const rate = effectiveCompensationRates(database, trip).dailyRateKopecks;
    const amount = days * rate;
    if (!Number.isSafeInteger(amount)) {
      throw new HttpError(400, "Сумма суточных слишком велика", "INVALID_AMOUNT");
    }
    amountKopecks += amount;
    if (!Number.isSafeInteger(amountKopecks)) {
      throw new HttpError(400, "Сумма суточных слишком велика", "INVALID_AMOUNT");
    }
    through = latestDate(through, periodTo);
  }
  return { amountKopecks, through };
}

function latestDate(...values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function getCompanyExpenses(database, organizationId) {
  return database.prepare(`
    SELECT ce.*, r.name AS rig_name, u.full_name AS created_by_name
    FROM company_expenses ce
    LEFT JOIN rigs r ON r.id = ce.rig_id
    JOIN users u ON u.id = ce.created_by
    WHERE ce.organization_id = ?
    ORDER BY ce.occurred_at DESC, ce.created_at DESC
    LIMIT 1000
  `).all(organizationId);
}

function getExpenseCategories(database, organizationId, activeOnly = false) {
  return database.prepare(`
    SELECT id, name, is_active, sort_order, created_at, updated_at
    FROM expense_categories
    WHERE organization_id = ? ${activeOnly ? "AND is_active = 1" : ""}
    ORDER BY sort_order, name
  `).all(organizationId);
}

function getExpenseCategory(database, categoryId, organizationId) {
  const category = database.prepare(`
    SELECT id, name, is_active, sort_order, created_at, updated_at
    FROM expense_categories WHERE id = ? AND organization_id = ?
  `).get(categoryId, organizationId);
  if (!category) throw new HttpError(404, "Категория не найдена", "NOT_FOUND");
  return category;
}

function getCompanyExpense(database, expenseId, organizationId) {
  const expense = database.prepare(`
    SELECT ce.*, r.name AS rig_name, u.full_name AS created_by_name
    FROM company_expenses ce
    LEFT JOIN rigs r ON r.id = ce.rig_id
    JOIN users u ON u.id = ce.created_by
    WHERE ce.id = ? AND ce.organization_id = ?
  `).get(expenseId, organizationId);
  if (!expense) throw new HttpError(404, "Расход не найден", "NOT_FOUND");
  return expense;
}

function getDriverTransfers(database, organizationId, driverId = null) {
  const transfers = database.prepare(`
    SELECT t.*, u.full_name AS driver_name
    FROM driver_transfers t
    JOIN users u ON u.id = t.driver_id
    WHERE t.organization_id = ? ${driverId ? "AND t.driver_id = ?" : ""}
    ORDER BY t.occurred_at DESC, t.created_at DESC
    LIMIT 1000
  `).all(organizationId, ...(driverId ? [driverId] : []));
  const allocationQuery = database.prepare(`
    SELECT * FROM driver_transfer_allocations
    WHERE transfer_id = ? ORDER BY created_at, id
  `);
  return transfers.map((transfer) => ({
    ...transfer,
    allocations: allocationQuery.all(transfer.id)
  }));
}

function getDriverTransfer(database, transferId, organizationId) {
  const transfer = database.prepare(`
    SELECT t.*, u.full_name AS driver_name
    FROM driver_transfers t
    JOIN users u ON u.id = t.driver_id
    WHERE t.id = ? AND t.organization_id = ?
  `).get(transferId, organizationId);
  if (!transfer) throw new HttpError(404, "Перевод не найден", "NOT_FOUND");
  transfer.allocations = database.prepare(`
    SELECT * FROM driver_transfer_allocations WHERE transfer_id = ? ORDER BY created_at, id
  `).all(transfer.id);
  return transfer;
}

function getDriverAccruals(database, organizationId, driverId = null) {
  return database.prepare(`
    SELECT a.*, u.full_name AS driver_name,
      t.number AS trip_number, t.loading_address, t.unloading_address
    FROM driver_accruals a
    JOIN users u ON u.id = a.driver_id
    LEFT JOIN trips t ON t.id = a.trip_id
    WHERE a.organization_id = ? ${driverId ? "AND a.driver_id = ?" : ""}
    ORDER BY a.created_at DESC
    LIMIT 1000
  `).all(organizationId, ...(driverId ? [driverId] : []));
}

function getOfficeTrips(database, organizationId) {
  const trips = database.prepare(`${officeTripSelectSql()} ORDER BY t.created_at DESC`).all(organizationId);
  for (const trip of trips) {
    addEstimatedTripCompensation(database, trip);
    addTripFinancialHistory(database, trip);
    addTripStops(database, trip);
  }
  return trips;
}

function getOfficeTrip(database, tripId, organizationId) {
  const trip = database.prepare(`${officeTripSelectSql()} AND t.id = ?`).get(organizationId, tripId);
  if (!trip) throw new HttpError(404, "Рейс не найден", "NOT_FOUND");
  addEstimatedTripCompensation(database, trip);
  addTripFinancialHistory(database, trip);
  addTripStops(database, trip);
  return trip;
}

function addTripFinancialHistory(database, trip) {
  trip.adjustments = database.prepare(`
    SELECT * FROM trip_rate_adjustments WHERE trip_id = ? ORDER BY created_at
  `).all(trip.id);
  trip.payments = database.prepare(`
    SELECT p.*, pa.amount_kopecks AS allocated_kopecks
    FROM payment_allocations pa
    JOIN incoming_payments p ON p.id = pa.payment_id
    WHERE pa.trip_id = ? ORDER BY p.received_at
  `).all(trip.id);
}

function addTripStops(database, trip) {
  trip.additional_unloading_stops = database.prepare(`
    SELECT id, stop_order, address, is_approximate, notes
    FROM trip_stops WHERE trip_id = ? ORDER BY stop_order
  `).all(trip.id);
}

function addEstimatedTripCompensation(database, trip) {
  trip.estimated_driver_compensation_kopecks = ["confirmed", "closed"].includes(trip.status)
    ? Number(trip.driver_compensation_kopecks || 0)
    : estimatedTripCompensation(database, trip);
  const today = moscowDate(nowIso());
  trip.days_overdue = trip.payment_due_date
    && Number(trip.receivable_kopecks || 0) > 0
    && trip.payment_due_date < today
    ? daysBetween(trip.payment_due_date, today)
    : 0;
}

function getDriverTrip(database, tripId, user) {
  const trip = database.prepare(`${driverTripSelectSql()} AND t.id = ?`).get(user.id, user.organization_id, tripId);
  if (!trip) throw new HttpError(404, "Рейс не найден", "NOT_FOUND");
  addTripStops(database, trip);
  return trip;
}

function officeTripSelectSql() {
  return `
    SELECT
      t.*,
      c.short_name AS customer_name,
      u.full_name AS driver_name,
      r.name AS rig_name,
      tr.brand || ' ' || tr.model || ' · ' || tr.plate_number AS tractor_label,
      tl.brand || ' ' || tl.model || ' · ' || tl.plate_number AS trailer_label,
      COALESCE((SELECT SUM(a.amount_kopecks) FROM trip_rate_adjustments a WHERE a.trip_id = t.id AND a.reversed_at IS NULL), 0) AS adjustments_kopecks,
      t.agreed_rate_kopecks + COALESCE((SELECT SUM(a.amount_kopecks) FROM trip_rate_adjustments a WHERE a.trip_id = t.id AND a.reversed_at IS NULL), 0) AS final_rate_kopecks,
      COALESCE((SELECT SUM(pa.amount_kopecks) FROM payment_allocations pa JOIN incoming_payments p ON p.id = pa.payment_id WHERE pa.trip_id = t.id AND p.reversed_at IS NULL), 0) AS received_kopecks,
      COALESCE((SELECT SUM(e.amount_kopecks) FROM expenses e WHERE e.trip_id = t.id AND e.status != 'rejected'), 0) AS preliminary_expenses_kopecks,
      COALESCE((SELECT SUM(e.amount_kopecks) FROM expenses e WHERE e.trip_id = t.id AND e.status = 'confirmed'), 0) AS confirmed_expenses_kopecks,
      COALESCE((SELECT SUM(a.balance_effect_kopecks) FROM driver_accruals a WHERE a.trip_id = t.id AND a.balance_category = 'salary' AND a.reversed_at IS NULL), 0) AS driver_salary_accrued_kopecks,
      COALESCE((SELECT SUM(a.balance_effect_kopecks) FROM driver_accruals a WHERE a.trip_id = t.id AND a.balance_category = 'daily' AND a.reversed_at IS NULL), 0) AS driver_daily_accrued_kopecks,
      COALESCE((SELECT SUM(a.balance_effect_kopecks) FROM driver_accruals a WHERE a.trip_id = t.id AND a.reversed_at IS NULL), 0) AS driver_compensation_kopecks,
      (t.agreed_rate_kopecks + COALESCE((SELECT SUM(a.amount_kopecks) FROM trip_rate_adjustments a WHERE a.trip_id = t.id AND a.reversed_at IS NULL), 0))
        - COALESCE((SELECT SUM(pa.amount_kopecks) FROM payment_allocations pa JOIN incoming_payments p ON p.id = pa.payment_id WHERE pa.trip_id = t.id AND p.reversed_at IS NULL), 0) AS receivable_kopecks,
      (t.agreed_rate_kopecks + COALESCE((SELECT SUM(a.amount_kopecks) FROM trip_rate_adjustments a WHERE a.trip_id = t.id AND a.reversed_at IS NULL), 0))
        - COALESCE((SELECT SUM(e.amount_kopecks) FROM expenses e WHERE e.trip_id = t.id AND e.status != 'rejected'), 0)
        - COALESCE((SELECT SUM(a.balance_effect_kopecks) FROM driver_accruals a WHERE a.trip_id = t.id AND a.reversed_at IS NULL), 0) AS preliminary_result_kopecks,
      CASE WHEN t.status IN ('confirmed', 'closed') THEN
        (t.agreed_rate_kopecks + COALESCE((SELECT SUM(a.amount_kopecks) FROM trip_rate_adjustments a WHERE a.trip_id = t.id AND a.reversed_at IS NULL), 0))
          - COALESCE((SELECT SUM(e.amount_kopecks) FROM expenses e WHERE e.trip_id = t.id AND e.status = 'confirmed'), 0)
          - COALESCE((SELECT SUM(a.balance_effect_kopecks) FROM driver_accruals a WHERE a.trip_id = t.id AND a.reversed_at IS NULL), 0)
      ELSE NULL END AS confirmed_result_kopecks,
      CASE WHEN t.unloaded_at IS NULL THEN NULL
        ELSE date(t.unloaded_at, '+3 hours', '+' || t.payment_term_days || ' days') END AS payment_due_date,
      (SELECT entered_value_km FROM odometer_readings o WHERE o.trip_id = t.id AND o.reading_type = 'start') AS start_odometer_km,
      (SELECT entered_value_km FROM odometer_readings o WHERE o.trip_id = t.id AND o.reading_type = 'end') AS end_odometer_km,
      (SELECT risk_flags_json FROM odometer_readings o WHERE o.trip_id = t.id AND o.reading_type = 'start') AS start_odometer_risk_flags_json,
      (SELECT risk_flags_json FROM odometer_readings o WHERE o.trip_id = t.id AND o.reading_type = 'end') AS end_odometer_risk_flags_json,
      (SELECT COUNT(*) FROM trip_documents d WHERE d.trip_id = t.id) AS document_count,
      (SELECT d.attachment_id FROM trip_documents d WHERE d.trip_id = t.id ORDER BY d.version_number DESC LIMIT 1) AS latest_document_attachment_id
    FROM trips t
    JOIN customers c ON c.id = t.customer_id
    JOIN users u ON u.id = t.driver_id
    JOIN rigs r ON r.id = t.rig_id
    JOIN tractors tr ON tr.id = t.tractor_id
    JOIN trailers tl ON tl.id = t.trailer_id
    WHERE t.organization_id = ?
  `;
}

function driverTripSelectSql() {
  return `
    SELECT
      t.id, t.number, t.loading_address, t.planned_loading_date,
      t.unloading_address, t.unloading_address_is_approximate,
      t.cargo_description, t.driver_instructions, t.status,
      t.loaded_at, t.unloaded_at, t.created_at,
      r.name AS rig_name,
      tr.brand || ' ' || tr.model || ' · ' || tr.plate_number AS tractor_label,
      tl.brand || ' ' || tl.model || ' · ' || tl.plate_number AS trailer_label,
      (SELECT entered_value_km FROM odometer_readings o WHERE o.trip_id = t.id AND o.reading_type = 'start') AS start_odometer_km,
      (SELECT entered_value_km FROM odometer_readings o WHERE o.trip_id = t.id AND o.reading_type = 'end') AS end_odometer_km
    FROM trips t
    JOIN rigs r ON r.id = t.rig_id
    JOIN tractors tr ON tr.id = t.tractor_id
    JOIN trailers tl ON tl.id = t.trailer_id
    WHERE t.driver_id = ? AND t.organization_id = ?
  `;
}

function rigSelectSql() {
  return `
    SELECT r.*, rp.id AS period_id, rp.valid_from,
           rp.tractor_id, rp.trailer_id, rp.driver_id,
           tr.brand || ' ' || tr.model || ' · ' || tr.plate_number AS tractor_label,
           tl.brand || ' ' || tl.model || ' · ' || tl.plate_number AS trailer_label,
           u.full_name AS driver_name
    FROM rigs r
    LEFT JOIN rig_periods rp ON rp.rig_id = r.id AND rp.valid_to IS NULL
    LEFT JOIN tractors tr ON tr.id = rp.tractor_id
    LEFT JOIN trailers tl ON tl.id = rp.trailer_id
    LEFT JOIN users u ON u.id = rp.driver_id
    WHERE r.organization_id = ?
  `;
}

function getRig(database, rigId, organizationId) {
  return database.prepare(`${rigSelectSql()} AND r.id = ?`).get(organizationId, rigId);
}

function getContact(database, contactId, organizationId) {
  const contact = database.prepare(`
    SELECT * FROM customer_contacts WHERE id = ? AND organization_id = ?
  `).get(contactId, organizationId);
  contact.phones = database.prepare(`
    SELECT id, phone, label FROM customer_contact_phones WHERE contact_id = ? ORDER BY created_at
  `).all(contactId);
  return contact;
}

function driverTrip(database, tripId, user) {
  const trip = database.prepare(`
    SELECT * FROM trips WHERE id = ? AND driver_id = ? AND organization_id = ?
  `).get(tripId, user.id, user.organization_id);
  if (!trip) throw new HttpError(404, "Рейс не найден", "NOT_FOUND");
  return trip;
}

function ownedDriver(database, id, organizationId) {
  const driver = database.prepare(`
    SELECT * FROM users WHERE id = ? AND organization_id = ? AND role = 'driver' AND is_active = 1
  `).get(id, organizationId);
  if (!driver) throw new HttpError(404, "Водитель не найден", "NOT_FOUND");
  return driver;
}

function ownedAttachmentByUser(database, id, user, expectedKinds = [], { imagesOnly = false } = {}) {
  const attachment = ownedRow(database, "attachments", id, user.organization_id, "Файл не найден");
  if (attachment.created_by !== user.id) throw new HttpError(403, "Нельзя использовать чужой файл", "FORBIDDEN");
  if (expectedKinds.length && !expectedKinds.includes(attachment.kind)) {
    throw new HttpError(400, "Файл загружен не для этой операции", "INVALID_ATTACHMENT_KIND");
  }
  if (imagesOnly && !attachment.mime_type.startsWith("image/")) {
    throw new HttpError(400, "Для одометра требуется фотография", "IMAGE_REQUIRED");
  }
  return attachment;
}

function ownedOfficeAttachment(database, id, user, expectedKinds) {
  const attachment = ownedRow(database, "attachments", id, user.organization_id, "Файл не найден");
  if (!expectedKinds.includes(attachment.kind)) {
    throw new HttpError(400, "Файл загружен не для этой операции", "INVALID_ATTACHMENT_KIND");
  }
  return attachment.id;
}

function ownedRow(database, table, id, organizationId, message) {
  const allowed = new Set(["attachments", "tractors", "trailers", "rigs", "customers", "trips", "expenses"]);
  if (!allowed.has(table)) throw new Error("Недопустимая таблица");
  const row = database.prepare(`SELECT * FROM ${table} WHERE id = ? AND organization_id = ?`).get(id, organizationId);
  if (!row) throw new HttpError(404, message, "NOT_FOUND");
  return row;
}

async function serveStatic({ request, response, url, publicDirectory }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new HttpError(405, "Метод не поддерживается", "METHOD_NOT_ALLOWED");
  }
  let name = decodeURIComponent(url.pathname === "/" ? "login.html" : url.pathname.slice(1));
  if (name.includes("/") || name.includes("\\") || !publicFiles.has(name)) {
    throw new HttpError(404, "Страница не найдена", "NOT_FOUND");
  }
  const filePath = resolve(publicDirectory, name);
  const root = resolve(publicDirectory);
  if (!filePath.startsWith(`${root}${sep}`)) throw new HttpError(403, "Доступ запрещён", "FORBIDDEN");
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new HttpError(404, "Страница не найдена", "NOT_FOUND");
  const body = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": mimeFor(name),
    "Content-Length": body.length,
    "Cache-Control": name === "sw.js" || name.endsWith(".html") ? "no-cache" : "public, max-age=3600"
  });
  if (request.method === "HEAD") response.end();
  else response.end(body);
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
}

async function readJson(request) {
  const buffer = await readBuffer(request, MAX_JSON_BYTES);
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new HttpError(400, "Некорректный JSON", "INVALID_JSON");
  }
}

async function readBuffer(request, maxBytes) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw new HttpError(413, "Данные слишком большие", "PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function publicUser(user) {
  return {
    id: user.id,
    role: user.role,
    login: user.login,
    fullName: user.full_name,
    phone: user.phone,
    birthDate: user.birth_date,
    isActive: Boolean(user.is_active),
    organizationId: user.organization_id
  };
}

function event(user, entityType, entityIdValue, action, before, after, reason = "") {
  return {
    organizationId: user.organization_id,
    actorUserId: user.id,
    entityType,
    entityId: entityIdValue,
    action,
    before,
    after,
    reason
  };
}

function requiredText(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) throw new HttpError(400, `Укажите: ${label}`, "VALIDATION_ERROR");
  if (text.length > maxLength) throw new HttpError(400, `${label}: слишком длинное значение`, "VALIDATION_ERROR");
  return text;
}

function optionalText(value, maxLength) {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) throw new HttpError(400, "Слишком длинное значение", "VALIDATION_ERROR");
  return text;
}

function passwordValue(value) {
  const password = String(value ?? "");
  if (password.length < 10 || password.length > 256) {
    throw new HttpError(400, "Пароль должен содержать от 10 до 256 символов", "VALIDATION_ERROR");
  }
  return password;
}

function integer(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new HttpError(400, `${label}: требуется целое число`, "VALIDATION_ERROR");
  return number;
}

function positiveInteger(value, label) {
  const number = integer(value, label);
  if (number <= 0) throw new HttpError(400, `${label}: значение должно быть больше нуля`, "VALIDATION_ERROR");
  return number;
}

function nonNegativeInteger(value, label) {
  const number = integer(value, label);
  if (number < 0) throw new HttpError(400, `${label}: значение не может быть отрицательным`, "VALIDATION_ERROR");
  return number;
}

function optionalPositiveInteger(value) {
  if (value == null || value === "") return null;
  return positiveInteger(value, "Числовое значение");
}

function optionalNonNegativeInteger(value) {
  if (value == null || value === "") return null;
  return nonNegativeInteger(value, "Числовое значение");
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new HttpError(400, `${label}: недопустимое значение`, "VALIDATION_ERROR");
  return value;
}

function requiredDate(value, label) {
  const text = requiredText(value, label, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new HttpError(400, `${label}: некорректная дата`, "VALIDATION_ERROR");
  }
  return text;
}

function optionalDate(value) {
  if (value == null || value === "") return null;
  return requiredDate(value, "Дата рождения");
}

function requiredDateTime(value, label) {
  const text = requiredText(value, label, 40);
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) {
    throw new HttpError(400, `${label}: некорректная дата`, "VALIDATION_ERROR");
  }
  return date.toISOString();
}

function optionalCoordinate(value, min, max) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, "Некорректная геопозиция", "VALIDATION_ERROR");
  }
  return number;
}

function constraintError(error, fallback) {
  if (String(error?.message || "").includes("constraint failed")) {
    return new HttpError(409, fallback, "CONFLICT");
  }
  return error;
}

function decodeHeader(value) {
  try {
    return decodeURIComponent(String(value || "file"));
  } catch {
    return String(value || "file");
  }
}

function isAllowedFileType(mime) {
  return [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/avif",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword"
  ].includes(mime);
}

function requireUploadKind(kind, role) {
  const allowed = role === "driver"
    ? ["odometer_start", "odometer_end", "expense_receipt"]
    : [
      "trip_document", "contract_application", "payment_proof",
      "adjustment_proof", "company_expense_proof"
    ];
  if (!allowed.includes(kind)) {
    throw new HttpError(400, "Недопустимое назначение файла", "INVALID_ATTACHMENT_KIND");
  }
}

function isFileTypeAllowedForKind(kind, mime) {
  const image = mime.startsWith("image/");
  if (["odometer_start", "odometer_end"].includes(kind)) return image;
  if (["expense_receipt", "payment_proof", "adjustment_proof", "company_expense_proof"].includes(kind)) {
    return image || mime === "application/pdf";
  }
  return isAllowedFileType(mime);
}

function contentMatchesMime(buffer, mime) {
  if (mime === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (["image/heic", "image/heif", "image/avif"].includes(mime)) {
    return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (mime === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime === "application/msword") return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  }
  return false;
}

function safeExtension(name, mime) {
  const fromName = extname(basename(name)).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  const known = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf"
  };
  return known[mime] || ".bin";
}

function mimeFor(name) {
  const extension = extname(name).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  }[extension] || "application/octet-stream";
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
