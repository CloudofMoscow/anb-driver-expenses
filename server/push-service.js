import { createHash } from "node:crypto";
import webPush from "web-push";

import { entityId, nowIso, transaction } from "./database.js";

const DELIVERY_BATCH_SIZE = 40;
const DELIVERY_CONCURRENCY = 4;
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export function createPushService({
  database,
  subject = "mailto:push@anb.local",
  webPushClient = webPush,
  logger = console,
  enabled = true
}) {
  if (!enabled) return disabledPushService();

  const settings = ensureVapidSettings(database, subject, webPushClient);
  webPushClient.setVapidDetails(settings.subject, settings.public_key, settings.private_key);

  let running = false;
  let queued = false;
  let retryTimer = null;

  async function dispatchPending() {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      do {
        queued = false;
        const deliveries = dueDeliveries(database);
        for (let index = 0; index < deliveries.length; index += DELIVERY_CONCURRENCY) {
          const batch = deliveries.slice(index, index + DELIVERY_CONCURRENCY);
          await Promise.all(batch.map((delivery) => deliverOne({
            database,
            delivery,
            webPushClient,
            logger
          })));
        }
        if (deliveries.length === DELIVERY_BATCH_SIZE) queued = true;
      } while (queued);
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      dispatchPending().catch((error) => {
        logger.error?.("Push delivery failed", safeErrorMessage(error));
      });
    });
  }

  function start() {
    if (retryTimer) return;
    retryTimer = setInterval(schedule, 60_000);
    retryTimer.unref?.();
    schedule();
  }

  function stop() {
    if (retryTimer) clearInterval(retryTimer);
    retryTimer = null;
  }

  return {
    enabled: true,
    publicKey: settings.public_key,
    dispatchPending,
    schedule,
    start,
    stop
  };
}

export function registerPushSubscription(database, user, subscription, userAgent = "") {
  const normalized = normalizeSubscription(subscription);
  const timestamp = nowIso();
  const existing = database.prepare(`
    SELECT * FROM push_subscriptions
    WHERE user_id = ? AND endpoint = ?
  `).get(user.id, normalized.endpoint);
  const id = existing?.id || entityId("psh");

  database.prepare(`
    INSERT INTO push_subscriptions(
      id, organization_id, user_id, endpoint, p256dh, auth,
      user_agent, disabled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(user_id, endpoint) DO UPDATE SET
      organization_id = excluded.organization_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      disabled_at = NULL,
      updated_at = excluded.updated_at
  `).run(
    id,
    user.organization_id,
    user.id,
    normalized.endpoint,
    normalized.keys.p256dh,
    normalized.keys.auth,
    String(userAgent || "").slice(0, 500),
    existing?.created_at || timestamp,
    timestamp
  );

  return {
    id,
    endpoint: normalized.endpoint,
    active: true,
    updatedAt: timestamp
  };
}

export function unregisterPushSubscription(database, user, endpoint) {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const timestamp = nowIso();
  const subscription = database.prepare(`
    SELECT id FROM push_subscriptions
    WHERE organization_id = ? AND user_id = ? AND endpoint = ? AND disabled_at IS NULL
  `).get(user.organization_id, user.id, normalizedEndpoint);
  if (!subscription) return false;

  transaction(database, () => {
    database.prepare(`
      UPDATE push_subscriptions
      SET disabled_at = ?, updated_at = ?
      WHERE id = ?
    `).run(timestamp, timestamp, subscription.id);
    database.prepare(`
      UPDATE push_deliveries
      SET status = 'cancelled', updated_at = ?, last_error = 'subscription_removed'
      WHERE subscription_id = ? AND status = 'pending'
    `).run(timestamp, subscription.id);
  });
  return true;
}

export function userHasPushSubscription(database, userId, organizationId) {
  return Boolean(database.prepare(`
    SELECT 1 AS subscribed FROM push_subscriptions
    WHERE user_id = ? AND organization_id = ? AND disabled_at IS NULL
    LIMIT 1
  `).get(userId, organizationId));
}

function ensureVapidSettings(database, subject, webPushClient) {
  const normalizedSubject = normalizeVapidSubject(subject);
  const existing = database.prepare("SELECT * FROM push_vapid_settings WHERE id = 1").get();
  if (existing) {
    if (existing.subject !== normalizedSubject) {
      database.prepare(`
        UPDATE push_vapid_settings SET subject = ?, updated_at = ? WHERE id = 1
      `).run(normalizedSubject, nowIso());
      return { ...existing, subject: normalizedSubject };
    }
    return existing;
  }

  const keys = webPushClient.generateVAPIDKeys();
  const timestamp = nowIso();
  database.prepare(`
    INSERT INTO push_vapid_settings(
      id, public_key, private_key, subject, created_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?)
  `).run(keys.publicKey, keys.privateKey, normalizedSubject, timestamp, timestamp);
  return database.prepare("SELECT * FROM push_vapid_settings WHERE id = 1").get();
}

function dueDeliveries(database) {
  return database.prepare(`
    SELECT
      d.*,
      n.notification_type,
      n.title,
      n.message,
      n.entity_type,
      n.entity_id,
      s.endpoint,
      s.p256dh,
      s.auth,
      u.role AS recipient_role
    FROM push_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    JOIN push_subscriptions s ON s.id = d.subscription_id
    JOIN users u ON u.id = s.user_id
    WHERE d.status = 'pending'
      AND s.disabled_at IS NULL
      AND u.is_active = 1
      AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?)
    ORDER BY d.created_at, d.id
    LIMIT ?
  `).all(nowIso(), DELIVERY_BATCH_SIZE);
}

async function deliverOne({ database, delivery, webPushClient, logger }) {
  const attemptedAt = nowIso();
  const attemptCount = Number(delivery.attempt_count || 0) + 1;
  const payload = JSON.stringify({
    notificationId: delivery.notification_id,
    type: delivery.notification_type,
    title: clampText(delivery.title, 120),
    message: clampText(delivery.message, 700),
    entityType: delivery.entity_type || null,
    entityId: delivery.entity_id || null,
    url: delivery.recipient_role === "office" ? "/office.html" : "/driver.html",
    readUrl: `/api/${delivery.recipient_role}/notifications/${delivery.notification_id}/read`
  });

  try {
    await webPushClient.sendNotification({
      endpoint: delivery.endpoint,
      keys: {
        p256dh: delivery.p256dh,
        auth: delivery.auth
      }
    }, payload, {
      TTL: 24 * 60 * 60,
      urgency: "high",
      topic: createHash("sha256").update(delivery.notification_id).digest("base64url").slice(0, 32),
      timeout: 10_000
    });
    const deliveredAt = nowIso();
    transaction(database, () => {
      database.prepare(`
        UPDATE push_deliveries
        SET status = 'sent', attempt_count = ?, last_attempt_at = ?,
            delivered_at = ?, next_attempt_at = NULL, last_error = '', updated_at = ?
        WHERE id = ?
      `).run(attemptCount, attemptedAt, deliveredAt, deliveredAt, delivery.id);
      database.prepare(`
        UPDATE push_subscriptions
        SET last_success_at = ?, updated_at = ?
        WHERE id = ?
      `).run(deliveredAt, deliveredAt, delivery.subscription_id);
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410) {
      disableExpiredSubscription(database, delivery, attemptedAt, statusCode);
      return;
    }

    const failed = attemptCount >= MAX_DELIVERY_ATTEMPTS;
    const retryAt = failed
      ? null
      : new Date(Date.now() + RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)]).toISOString();
    const errorMessage = safeErrorMessage(error);
    transaction(database, () => {
      database.prepare(`
        UPDATE push_deliveries
        SET status = ?, attempt_count = ?, last_attempt_at = ?,
            next_attempt_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(
        failed ? "failed" : "pending",
        attemptCount,
        attemptedAt,
        retryAt,
        errorMessage,
        attemptedAt,
        delivery.id
      );
      database.prepare(`
        UPDATE push_subscriptions
        SET last_failure_at = ?, updated_at = ?
        WHERE id = ?
      `).run(attemptedAt, attemptedAt, delivery.subscription_id);
    });
    logger.warn?.("Push delivery attempt failed", {
      deliveryId: delivery.id,
      statusCode: statusCode || null,
      attemptCount
    });
  }
}

function disableExpiredSubscription(database, delivery, timestamp, statusCode) {
  transaction(database, () => {
    database.prepare(`
      UPDATE push_subscriptions
      SET disabled_at = ?, last_failure_at = ?, updated_at = ?
      WHERE id = ?
    `).run(timestamp, timestamp, timestamp, delivery.subscription_id);
    database.prepare(`
      UPDATE push_deliveries
      SET status = 'cancelled', attempt_count = attempt_count + 1,
          last_attempt_at = ?, next_attempt_at = NULL,
          last_error = ?, updated_at = ?
      WHERE subscription_id = ? AND status = 'pending'
    `).run(timestamp, `subscription_expired_${statusCode}`, timestamp, delivery.subscription_id);
  });
}

function normalizeSubscription(subscription) {
  const endpoint = normalizeEndpoint(subscription?.endpoint);
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();
  if (!p256dh || p256dh.length > 500 || !auth || auth.length > 500) {
    throw new Error("Некорректные ключи push-подписки");
  }
  return { endpoint, keys: { p256dh, auth } };
}

function normalizeEndpoint(value) {
  const endpoint = String(value || "").trim();
  if (!endpoint || endpoint.length > 3000) throw new Error("Некорректный адрес push-подписки");
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Некорректный адрес push-подписки");
  }
  if (url.protocol !== "https:") throw new Error("Push-подписка должна использовать HTTPS");
  return url.toString();
}

function normalizeVapidSubject(value) {
  const subject = String(value || "").trim();
  if (!/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/i.test(subject)) {
    throw new Error("ANB_VAPID_SUBJECT должен быть адресом mailto: или HTTPS");
  }
  return subject;
}

function clampText(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function safeErrorMessage(error) {
  const message = String(error?.message || "push_delivery_failed")
    .replace(/https:\/\/\S+/gi, "[push-endpoint]")
    .slice(0, 500);
  return message || "push_delivery_failed";
}

function disabledPushService() {
  return {
    enabled: false,
    publicKey: "",
    dispatchPending: async () => {},
    schedule() {},
    start() {},
    stop() {}
  };
}
