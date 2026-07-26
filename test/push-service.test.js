import assert from "node:assert/strict";
import test from "node:test";

import { bootstrapOrganization, entityId, nowIso, openDatabase } from "../server/database.js";
import {
  createPushService,
  registerPushSubscription,
  unregisterPushSubscription
} from "../server/push-service.js";

test("push service persists VAPID keys and marks a successful delivery", async () => {
  const database = testDatabase();
  const sent = [];
  const fakeWebPush = {
    generateVAPIDKeys() {
      return { publicKey: "public-test-key", privateKey: "private-test-key" };
    },
    setVapidDetails(subject, publicKey, privateKey) {
      assert.equal(subject, "mailto:test@example.com");
      assert.equal(publicKey, "public-test-key");
      assert.equal(privateKey, "private-test-key");
    },
    async sendNotification(subscription, payload, options) {
      sent.push({ subscription, payload: JSON.parse(payload), options });
      return { statusCode: 201 };
    }
  };

  try {
    const user = database.prepare("SELECT * FROM users WHERE login = 'owner'").get();
    const service = createPushService({
      database,
      subject: "mailto:test@example.com",
      webPushClient: fakeWebPush,
      logger: silentLogger()
    });
    assert.equal(service.enabled, true);
    assert.equal(service.publicKey, "public-test-key");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM push_vapid_settings").get().count, 1);

    const subscription = registerPushSubscription(database, user, {
      endpoint: "https://push.example.test/success",
      keys: { p256dh: "p256dh-test", auth: "auth-test" }
    }, "ANB test browser");
    const notificationId = insertDelivery(database, user, subscription.id);

    await service.dispatchPending();

    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.notificationId, notificationId);
    assert.equal(sent[0].payload.url, "/office.html");
    assert.equal(sent[0].payload.readUrl, `/api/office/notifications/${notificationId}/read`);
    assert.equal(sent[0].options.urgency, "high");
    const delivery = database.prepare("SELECT * FROM push_deliveries WHERE notification_id = ?").get(notificationId);
    assert.equal(delivery.status, "sent");
    assert.equal(delivery.attempt_count, 1);
    assert.ok(delivery.delivered_at);
    assert.ok(database.prepare("SELECT last_success_at FROM push_subscriptions WHERE id = ?").get(subscription.id).last_success_at);

    assert.equal(unregisterPushSubscription(database, user, subscription.endpoint), true);
    assert.ok(database.prepare("SELECT disabled_at FROM push_subscriptions WHERE id = ?").get(subscription.id).disabled_at);
  } finally {
    database.close();
  }
});

test("expired push endpoint is disabled without losing the in-app notification", async () => {
  const database = testDatabase();
  const fakeWebPush = {
    generateVAPIDKeys() {
      return { publicKey: "public-expired-key", privateKey: "private-expired-key" };
    },
    setVapidDetails() {},
    async sendNotification() {
      const error = new Error("subscription expired");
      error.statusCode = 410;
      throw error;
    }
  };

  try {
    const user = database.prepare("SELECT * FROM users WHERE login = 'owner'").get();
    const service = createPushService({
      database,
      subject: "mailto:test@example.com",
      webPushClient: fakeWebPush,
      logger: silentLogger()
    });
    const subscription = registerPushSubscription(database, user, {
      endpoint: "https://push.example.test/expired",
      keys: { p256dh: "expired-p256dh", auth: "expired-auth" }
    });
    const notificationId = insertDelivery(database, user, subscription.id);

    await service.dispatchPending();

    assert.ok(database.prepare("SELECT disabled_at FROM push_subscriptions WHERE id = ?").get(subscription.id).disabled_at);
    assert.equal(
      database.prepare("SELECT status FROM push_deliveries WHERE notification_id = ?").get(notificationId).status,
      "cancelled"
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM notifications WHERE id = ?").get(notificationId).count,
      1,
      "in-app notification remains the source of truth"
    );
  } finally {
    database.close();
  }
});

function testDatabase() {
  const database = openDatabase(":memory:");
  bootstrapOrganization(database, {
    organizationName: "Push Test",
    adminLogin: "owner",
    adminPassword: "push-test-password",
    adminFullName: "Push Test Owner"
  });
  return database;
}

function insertDelivery(database, user, subscriptionId) {
  const timestamp = nowIso();
  const notificationId = entityId("ntf");
  database.prepare(`
    INSERT INTO notifications(
      id, organization_id, recipient_user_id, notification_type,
      title, message, entity_type, entity_id, created_at
    ) VALUES (?, ?, ?, 'test_push', 'Новое событие', 'Откройте приложение', 'trip', 'trip-test', ?)
  `).run(notificationId, user.organization_id, user.id, timestamp);
  database.prepare(`
    INSERT INTO push_deliveries(
      id, organization_id, notification_id, subscription_id,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(entityId("pdl"), user.organization_id, notificationId, subscriptionId, timestamp, timestamp);
  return notificationId;
}

function silentLogger() {
  return {
    error() {},
    warn() {}
  };
}
