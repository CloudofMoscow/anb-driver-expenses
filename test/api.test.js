import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createApplication } from "../server/app.js";
import { bootstrapOrganization, openDatabase } from "../server/database.js";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("ANB core API vertical slice", { concurrency: false }, () => {
  let database;
  let server;
  let baseUrl;
  let temporaryDirectory;
  let officeCookie;
  let driverCookie;
  let pushScheduleCalls = 0;

  const state = {};

  before(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "anb-api-test-"));
    database = openDatabase(":memory:");
    bootstrapOrganization(database, {
      organizationName: "ANB Test",
      adminLogin: "owner",
      adminPassword: "owner-test-password",
      adminFullName: "Test Owner"
    });

    server = createServer(createApplication({
      database,
      publicDirectory: projectDirectory,
      uploadsDirectory: join(temporaryDirectory, "uploads"),
      secureCookies: false,
      pushService: {
        enabled: true,
        publicKey: "BAnb-test-public-key",
        schedule() {
          pushScheduleCalls += 1;
        }
      }
    }));

    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
    database?.close();
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test("public health/static routes work and protected routes require a session", async () => {
    const health = await request("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);
    assert.match(health.data.time, /^\d{4}-\d{2}-\d{2}T/);

    const loginPage = await request("/");
    assert.equal(loginPage.status, 200);
    assert.match(loginPage.headers.get("content-type"), /^text\/html/);

    const legacyPage = await request("/index.html");
    assert.equal(legacyPage.status, 404);

    const legacyScript = await request("/app.js");
    assert.equal(legacyScript.status, 404);

    const unauthenticatedOffice = await request("/api/office/bootstrap");
    assert.equal(unauthenticatedOffice.status, 401);
    assert.equal(unauthenticatedOffice.data.code, "AUTH_REQUIRED");

    const invalidLogin = await jsonRequest("/api/auth/login", {
      method: "POST",
      body: { login: "owner", password: "wrong-password" }
    });
    assert.equal(invalidLogin.status, 401);
    assert.equal(invalidLogin.data.code, "INVALID_CREDENTIALS");

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const rejected = await jsonRequest("/api/auth/login", {
        method: "POST",
        body: { login: "brute-force-test", password: `wrong-${attempt}` }
      });
      assert.equal(rejected.status, 401);
    }
    const rateLimited = await jsonRequest("/api/auth/login", {
      method: "POST",
      body: { login: "brute-force-test", password: "wrong-again" }
    });
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.data.code, "LOGIN_RATE_LIMITED");

    const login = await jsonRequest("/api/auth/login", {
      method: "POST",
      body: { login: " OWNER ", password: "owner-test-password" }
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.role, "office");
    assert.equal(login.data.user.login, "owner");
    officeCookie = sessionCookieFrom(login);
    assert.match(officeCookie, /^anb_session=/);

    const me = await request("/api/me", { cookie: officeCookie });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.fullName, "Test Owner");

    const pushConfig = await request("/api/push/config", { cookie: officeCookie });
    assert.equal(pushConfig.status, 200);
    assert.equal(pushConfig.data.enabled, true);
    assert.equal(pushConfig.data.subscribed, false);
    assert.equal(pushConfig.data.publicKey, "BAnb-test-public-key");

    const invalidPushSubscription = await jsonRequest("/api/push/subscriptions", {
      method: "POST",
      cookie: officeCookie,
      body: {
        subscription: {
          endpoint: "http://push.example.test/not-secure",
          keys: { p256dh: "p256dh", auth: "auth" }
        }
      }
    });
    assert.equal(invalidPushSubscription.status, 400);
    assert.equal(invalidPushSubscription.data.code, "INVALID_PUSH_SUBSCRIPTION");

    const officePushSubscription = await jsonRequest("/api/push/subscriptions", {
      method: "POST",
      cookie: officeCookie,
      body: {
        subscription: {
          endpoint: "https://push.example.test/office",
          keys: { p256dh: "office-p256dh", auth: "office-auth" }
        }
      }
    });
    assert.equal(officePushSubscription.status, 201);
    assert.equal(officePushSubscription.data.subscription.active, true);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ? AND disabled_at IS NULL")
        .get(login.data.user.id).count,
      1
    );
    assert.ok(pushScheduleCalls > 0);

    const officeCannotUseDriverCabinet = await request("/api/driver/bootstrap", { cookie: officeCookie });
    assert.equal(officeCannotUseDriverCabinet.status, 403);
    assert.equal(officeCannotUseDriverCabinet.data.code, "FORBIDDEN");

    const secondOwner = await jsonRequest("/api/office/users", {
      method: "POST",
      cookie: officeCookie,
      body: {
        fullName: "Второй владелец",
        login: "owner.two",
        password: "second-owner-password",
        phone: "+7 900 000-00-02"
      }
    });
    assert.equal(secondOwner.status, 201);
    assert.equal(secondOwner.data.officeUser.role, "office");
    state.secondOfficeId = secondOwner.data.officeUser.id;

    const secondOwnerLogin = await jsonRequest("/api/auth/login", {
      method: "POST",
      body: { login: "owner.two", password: "second-owner-password" }
    });
    assert.equal(secondOwnerLogin.status, 200);
    state.secondOfficeCookie = sessionCookieFrom(secondOwnerLogin);
    const secondOwnerBootstrap = await request("/api/office/bootstrap", {
      cookie: sessionCookieFrom(secondOwnerLogin)
    });
    assert.equal(secondOwnerBootstrap.status, 200);
    assert.equal(secondOwnerBootstrap.data.officeUsers.length, 2);
  });

  test("office creates the fleet, customer, contact, trip, and private contract", async () => {
    const invalidCalendarDate = await jsonRequest("/api/office/drivers", {
      method: "POST",
      cookie: officeCookie,
      body: {
        fullName: "Невозможная дата",
        login: "invalid.calendar.date",
        password: "driver-test-password",
        birthDate: "2026-02-30"
      }
    });
    assert.equal(invalidCalendarDate.status, 400);
    assert.equal(invalidCalendarDate.data.code, "VALIDATION_ERROR");

    const driver = await jsonRequest("/api/office/drivers", {
      method: "POST",
      cookie: officeCookie,
      body: {
        fullName: "Иванов Иван Иванович",
        login: "driver.ivanov",
        password: "driver-test-password",
        phone: "+7 900 111-22-33",
        birthDate: "1988-05-20"
      }
    });
    assert.equal(driver.status, 201);
    assert.equal(driver.data.driver.role, "driver");
    assert.equal(driver.data.driver.login, "driver.ivanov");
    state.driverId = driver.data.driver.id;

    const tractor = await jsonRequest("/api/office/tractors", {
      method: "POST",
      cookie: officeCookie,
      body: {
        brand: "КамАЗ",
        model: "К5",
        plateNumber: "а123вс77",
        vin: "XTC00000000000001",
        notes: "Тестовый тягач"
      }
    });
    assert.equal(tractor.status, 201);
    assert.equal(tractor.data.tractor.plate_number, "А123ВС77");
    state.tractorId = tractor.data.tractor.id;

    const trailer = await jsonRequest("/api/office/trailers", {
      method: "POST",
      cookie: officeCookie,
      body: {
        brand: "Тверьстроймаш",
        model: "99393",
        plateNumber: "в456ор77",
        axles: 4,
        capacityKg: 60000,
        trailerType: "негабаритный трал",
        oversizedNotes: "Раздвижная платформа"
      }
    });
    assert.equal(trailer.status, 201);
    assert.equal(trailer.data.trailer.axles, 4);
    state.trailerId = trailer.data.trailer.id;

    const rig = await jsonRequest("/api/office/rigs", {
      method: "POST",
      cookie: officeCookie,
      body: {
        name: "К5 + трал №1",
        tractorId: state.tractorId,
        trailerId: state.trailerId,
        driverId: state.driverId
      }
    });
    assert.equal(rig.status, 201);
    assert.equal(rig.data.rig.driver_id, state.driverId);
    assert.equal(rig.data.rig.tractor_id, state.tractorId);
    assert.equal(rig.data.rig.trailer_id, state.trailerId);
    state.rigId = rig.data.rig.id;

    const customer = await jsonRequest("/api/office/customers", {
      method: "POST",
      cookie: officeCookie,
      body: {
        shortName: "Секретный заказчик",
        fullName: "ООО «Секретный заказчик»",
        inn: "7700000000",
        defaultPaymentTermDays: 14
      }
    });
    assert.equal(customer.status, 201);
    state.customerId = customer.data.customer.id;

    const contact = await jsonRequest(`/api/office/customers/${state.customerId}/contacts`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        fullName: "Петров Пётр",
        position: "Логист",
        email: "logist@example.test",
        phones: [
          { phone: "+7 999 000-00-01", label: "рабочий" },
          "+7 999 000-00-02"
        ]
      }
    });
    assert.equal(contact.status, 201);
    assert.equal(contact.data.contact.phones.length, 2);

    const customCategory = await jsonRequest("/api/office/expense-categories", {
      method: "POST",
      cookie: officeCookie,
      body: { name: "Сопровождение" }
    });
    assert.equal(customCategory.status, 201);
    state.customCategoryId = customCategory.data.expenseCategory.id;

    const trip = await jsonRequest("/api/office/trips", {
      method: "POST",
      cookie: officeCookie,
      body: {
        customerId: state.customerId,
        rigId: state.rigId,
        number: "ANB-2026-001",
        loadingAddress: "Москва, ул. Погрузочная, 1",
        plannedLoadingDate: "2026-07-10",
        unloadingAddress: "Санкт-Петербург",
        unloadingAddressIsApproximate: true,
        additionalUnloadingStops: [
          { address: "Великий Новгород", notes: "Выгрузить одну позицию" },
          "Псков"
        ],
        cargoDescription: "Негабаритное оборудование",
        driverInstructions: "Позвонить логисту за час до прибытия",
        agreedRateKopecks: 12_000_000,
        vatMode: "with_vat",
        vatRateBasisPoints: 2200,
        paymentMethod: "bank"
      }
    });
    assert.equal(trip.status, 201);
    assert.equal(trip.data.trip.status, "assigned");
    assert.equal(trip.data.trip.driver_id, state.driverId);
    assert.equal(trip.data.trip.payment_term_days, 14);
    assert.equal(trip.data.trip.agreed_rate_kopecks, 12_000_000);
    assert.equal(trip.data.trip.final_rate_kopecks, 12_000_000);
    assert.equal(trip.data.trip.receivable_kopecks, 12_000_000);
    assert.deepEqual(
      trip.data.trip.additional_unloading_stops.map((stop) => stop.address),
      ["Великий Новгород", "Псков"]
    );
    state.tripId = trip.data.trip.id;

    const contract = await upload("/api/files", {
      cookie: officeCookie,
      body: Buffer.from("%PDF-1.4\nANB integration test contract\n%%EOF"),
      mimeType: "application/pdf",
      fileName: "contract.pdf",
      kind: "contract_application"
    });
    assert.equal(contract.status, 201);
    state.contractAttachmentId = contract.data.attachmentId;

    const attached = await jsonRequest(`/api/office/trips/${state.tripId}/documents`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        attachmentId: state.contractAttachmentId,
        documentType: "contract_application"
      }
    });
    assert.equal(attached.status, 201);
    assert.match(attached.data.documentId, /^doc_/);

    const officeCanDownloadContract = await request(`/api/files/${state.contractAttachmentId}`, {
      cookie: officeCookie
    });
    assert.equal(officeCanDownloadContract.status, 200);
    assert.match(officeCanDownloadContract.body.toString("utf8"), /^%PDF-1\.4/);

    const bootstrap = await request("/api/office/bootstrap", { cookie: officeCookie });
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.data.drivers.length, 1);
    assert.equal(bootstrap.data.rigs.length, 1);
    assert.equal(bootstrap.data.customers.length, 1);
    assert.equal(bootstrap.data.contacts.length, 2, "one flattened row is returned per contact phone");
    assert.equal(bootstrap.data.expenseCategories.length, 16);
    assert.equal(bootstrap.data.trips[0].id, state.tripId);
  });

  test("driver receives only operational trip fields, records photos and expense, then completes trip", async () => {
    const login = await jsonRequest("/api/auth/login", {
      method: "POST",
      body: { login: "DRIVER.IVANOV", password: "driver-test-password" }
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.role, "driver");
    driverCookie = sessionCookieFrom(login);

    const driverPushSubscription = await jsonRequest("/api/push/subscriptions", {
      method: "POST",
      cookie: driverCookie,
      body: {
        subscription: {
          endpoint: "https://push.example.test/driver",
          keys: { p256dh: "driver-p256dh", auth: "driver-auth" }
        }
      }
    });
    assert.equal(driverPushSubscription.status, 201);

    const driverCannotRemoveOfficeSubscription = await jsonRequest("/api/push/subscriptions/remove", {
      method: "POST",
      cookie: driverCookie,
      body: { endpoint: "https://push.example.test/office" }
    });
    assert.equal(driverCannotRemoveOfficeSubscription.status, 200);
    assert.equal(driverCannotRemoveOfficeSubscription.data.removed, false);

    const driverCannotUseOfficeCabinet = await request("/api/office/bootstrap", { cookie: driverCookie });
    assert.equal(driverCannotUseOfficeCabinet.status, 403);
    assert.equal(driverCannotUseOfficeCabinet.data.code, "FORBIDDEN");

    const bootstrap = await request("/api/driver/bootstrap", { cookie: driverCookie });
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.data.trips.length, 1);
    assert.equal(bootstrap.data.notifications.length, 1);
    assert.equal(bootstrap.data.notifications[0].notification_type, "trip_assigned");
    assert.equal(bootstrap.data.notifications[0].read_at, null);
    const acknowledgedTrip = await jsonRequest(
      `/api/driver/notifications/${bootstrap.data.notifications[0].id}/read`,
      { method: "POST", cookie: driverCookie }
    );
    assert.equal(acknowledgedTrip.status, 200);
    assert.ok(acknowledgedTrip.data.notification.read_at);
    assert.equal(
      database.prepare(`
        SELECT COUNT(*) AS count FROM notifications
        WHERE organization_id = ? AND recipient_user_id = ?
          AND notification_type = 'trip_seen_by_driver' AND entity_id = ?
      `).get(login.data.user.organizationId, database.prepare("SELECT id FROM users WHERE login = 'owner'").get().id, state.tripId).count,
      1
    );
    assert.ok(bootstrap.data.expenseCategories.some((category) => category.name === "Сопровождение"));
    assert.equal(bootstrap.data.capabilities.compensationVisible, false);
    assert.equal(Object.hasOwn(bootstrap.data, "settlement"), false);
    assert.equal(Object.hasOwn(bootstrap.data, "transfers"), false);
    assert.equal(Object.hasOwn(bootstrap.data, "accruals"), false);
    const assignedTrip = bootstrap.data.trips[0];
    assert.equal(assignedTrip.id, state.tripId);
    assert.equal(assignedTrip.status, "assigned");
    assert.equal(assignedTrip.unloading_address_is_approximate, 1);
    assert.deepEqual(
      assignedTrip.additional_unloading_stops.map((stop) => stop.address),
      ["Великий Новгород", "Псков"]
    );

    const forbiddenDriverFields = [
      "agreed_rate_kopecks",
      "adjustments_kopecks",
      "final_rate_kopecks",
      "received_kopecks",
      "receivable_kopecks",
      "customer_id",
      "customer_name",
      "payment_method",
      "payment_term_days",
      "vat_mode",
      "vat_rate_basis_points",
      "created_by"
    ];
    for (const field of forbiddenDriverFields) {
      assert.equal(Object.hasOwn(assignedTrip, field), false, `driver trip must not expose ${field}`);
    }
    const driverPayload = JSON.stringify(bootstrap.data);
    assert.equal(driverPayload.includes("Секретный заказчик"), false);
    assert.equal(driverPayload.includes("12000000"), false);
    assert.equal(driverPayload.includes("contract.pdf"), false);

    const disabledCategory = await jsonRequest(`/api/office/expense-categories/${state.customCategoryId}/active`, {
      method: "POST",
      cookie: officeCookie,
      body: { isActive: false }
    });
    assert.equal(disabledCategory.status, 200);
    assert.equal(disabledCategory.data.expenseCategory.is_active, 0);
    const afterCategoryChange = await request("/api/driver/bootstrap", { cookie: driverCookie });
    assert.equal(
      afterCategoryChange.data.expenseCategories.some((category) => category.name === "Сопровождение"),
      false
    );

    const contractIsPrivate = await request(`/api/files/${state.contractAttachmentId}`, {
      cookie: driverCookie
    });
    assert.equal(contractIsPrivate.status, 403);
    assert.equal(contractIsPrivate.data.code, "FORBIDDEN");

    const cannotUseOfficeContractAsOdometerPhoto = await jsonRequest(`/api/driver/trips/${state.tripId}/start`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: state.contractAttachmentId,
        odometerKm: 100_000,
        loadedAt: "2026-07-10T09:00:00+03:00"
      }
    });
    assert.equal(cannotUseOfficeContractAsOdometerPhoto.status, 403);

    const forgedImage = await upload("/api/files", {
      cookie: driverCookie,
      body: Buffer.from("this is not an image"),
      mimeType: "image/jpeg",
      fileName: "forged.jpg",
      kind: "odometer_start"
    });
    assert.equal(forgedImage.status, 415);
    assert.equal(forgedImage.data.code, "FILE_CONTENT_MISMATCH");

    const wrongKindPhoto = await upload("/api/files", {
      cookie: driverCookie,
      body: fakeJpeg("wrong-kind"),
      mimeType: "image/jpeg",
      fileName: "receipt-used-as-odometer.jpg",
      kind: "expense_receipt"
    });
    assert.equal(wrongKindPhoto.status, 201);
    const wrongAttachmentPurpose = await jsonRequest(`/api/driver/trips/${state.tripId}/start`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: wrongKindPhoto.data.attachmentId,
        odometerKm: 100_000,
        loadedAt: "2026-07-10T09:00:00+03:00"
      }
    });
    assert.equal(wrongAttachmentPurpose.status, 400);
    assert.equal(wrongAttachmentPurpose.data.code, "INVALID_ATTACHMENT_KIND");

    const startPhoto = await upload("/api/files", {
      cookie: driverCookie,
      body: fakeJpeg("start-odometer"),
      mimeType: "image/jpeg",
      fileName: "odometer-start.jpg",
      kind: "odometer_start"
    });
    assert.equal(startPhoto.status, 201);
    state.startPhotoId = startPhoto.data.attachmentId;

    const documentAsOdometer = await upload("/api/files", {
      cookie: driverCookie,
      body: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      mimeType: "application/msword",
      fileName: "not-an-odometer.doc",
      kind: "odometer_start"
    });
    assert.equal(documentAsOdometer.status, 415);
    assert.equal(documentAsOdometer.data.code, "FILE_TYPE_NOT_ALLOWED_FOR_KIND");

    const start = await jsonRequest(`/api/driver/trips/${state.tripId}/start`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: state.startPhotoId,
        clientMutationId: "mobile-start-0001",
        odometerKm: 100_000,
        loadedAt: "2026-07-10T09:00:00+03:00",
        latitude: 55.7558,
        longitude: 37.6173
      }
    });
    assert.equal(start.status, 200);
    assert.equal(start.data.trip.status, "in_progress");
    assert.equal(start.data.trip.start_odometer_km, 100_000);

    const officeAfterStart = await request("/api/office/bootstrap", { cookie: officeCookie });
    const startedNotification = officeAfterStart.data.notifications
      .find((notification) => notification.notification_type === "trip_started_by_driver");
    assert.ok(startedNotification);
    assert.equal(startedNotification.read_at, null);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM push_deliveries WHERE notification_id = ? AND status = 'pending'")
        .get(startedNotification.id).count,
      1
    );

    const driverCannotReadOfficeNotification = await jsonRequest(`/api/office/notifications/${startedNotification.id}/read`, {
      method: "POST",
      cookie: driverCookie
    });
    assert.equal(driverCannotReadOfficeNotification.status, 403);

    const officeReadsNotification = await jsonRequest(`/api/office/notifications/${startedNotification.id}/read`, {
      method: "POST",
      cookie: officeCookie
    });
    assert.equal(officeReadsNotification.status, 200);
    assert.ok(officeReadsNotification.data.notification.read_at);

    const secondTrip = await jsonRequest("/api/office/trips", {
      method: "POST",
      cookie: officeCookie,
      body: {
        customerId: state.customerId,
        rigId: state.rigId,
        number: "ANB-2026-002",
        loadingAddress: "Москва",
        plannedLoadingDate: "2026-07-20",
        unloadingAddress: "Казань",
        agreedRateKopecks: 8_000_000,
        vatMode: "without_vat",
        paymentMethod: "bank",
        paymentTermDays: 10
      }
    });
    assert.equal(secondTrip.status, 201);
    state.secondTripId = secondTrip.data.trip.id;

    const secondTripStartPhoto = await upload("/api/files", {
      cookie: driverCookie,
      body: fakeJpeg("second-trip-start"),
      mimeType: "image/jpeg",
      fileName: "second-trip-start.jpg",
      kind: "odometer_start"
    });
    state.secondTripStartPhotoId = secondTripStartPhoto.data.attachmentId;
    const activeTripConflict = await jsonRequest(`/api/driver/trips/${state.secondTripId}/start`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: secondTripStartPhoto.data.attachmentId,
        odometerKm: 100_001,
        loadedAt: "2026-07-20T09:00:00+03:00"
      }
    });
    assert.equal(activeTripConflict.status, 409);
    assert.equal(activeTripConflict.data.code, "ACTIVE_TRIP_EXISTS");

    const compositionDuringTrip = await jsonRequest(`/api/office/rigs/${state.rigId}/composition`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        tractorId: state.tractorId,
        trailerId: state.trailerId,
        driverId: state.driverId
      }
    });
    assert.equal(compositionDuringTrip.status, 409);
    assert.equal(compositionDuringTrip.data.code, "RIG_HAS_ACTIVE_TRIP");

    const duplicateStart = await jsonRequest(`/api/driver/trips/${state.tripId}/start`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: state.startPhotoId,
        clientMutationId: "mobile-start-0001",
        odometerKm: 100_000,
        loadedAt: "2026-07-10T09:00:00+03:00"
      }
    });
    assert.equal(duplicateStart.status, 200);
    assert.equal(duplicateStart.data.duplicate, true);

    const conflictingStart = await jsonRequest(`/api/driver/trips/${state.tripId}/start`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: state.startPhotoId,
        clientMutationId: "mobile-start-different-command",
        odometerKm: 100_000,
        loadedAt: "2026-07-10T09:00:00+03:00"
      }
    });
    assert.equal(conflictingStart.status, 409);
    assert.equal(conflictingStart.data.code, "INVALID_TRIP_STATUS");

    const fuelAdvance = await jsonRequest("/api/office/driver-transfers", {
      method: "POST",
      cookie: officeCookie,
      body: {
        driverId: state.driverId,
        direction: "company_to_driver",
        paymentMethod: "card_transfer",
        occurredAt: "2026-07-10T10:00:00+03:00",
        comment: "30 000 рублей на топливо",
        clientMutationId: "office-fuel-advance-0001",
        allocations: [{
          allocationType: "expense_advance",
          amountKopecks: 3_000_000,
          tripId: state.tripId
        }]
      }
    });
    assert.equal(fuelAdvance.status, 201);
    assert.equal(fuelAdvance.data.settlement.advanceBalanceKopecks, 3_000_000);
    state.fuelAdvanceId = fuelAdvance.data.transfer.id;

    const receipt = await upload("/api/files", {
      cookie: driverCookie,
      body: fakeJpeg("expense-receipt"),
      mimeType: "image/jpeg",
      fileName: "receipt.jpg",
      kind: "expense_receipt"
    });
    assert.equal(receipt.status, 201);
    state.receiptAttachmentId = receipt.data.attachmentId;

    const expensePayload = {
      receiptAttachmentId: state.receiptAttachmentId,
      clientMutationId: "mobile-expense-0001",
      amountKopecks: 125_050,
      category: "запчасти",
      paymentMethod: "card",
      paymentSource: "driver_personal",
      supplier: "Магазин деталей",
      description: "Куплен ремень генератора, срочная замена в пути",
      occurredAt: "2026-07-11T14:30:00+03:00",
      locationText: "Тверь",
      latitude: 56.8587,
      longitude: 35.9176
    };
    const expense = await jsonRequest(`/api/driver/trips/${state.tripId}/expenses`, {
      method: "POST",
      cookie: driverCookie,
      body: expensePayload
    });
    assert.equal(expense.status, 201);
    assert.equal(expense.data.expense.status, "pending_review");
    assert.equal(expense.data.expense.amount_kopecks, 125_050);
    assert.equal(expense.data.expense.occurred_at, "2026-07-11T11:30:00.000Z");
    state.expenseId = expense.data.expense.id;

    const idempotentRetry = await jsonRequest(`/api/driver/trips/${state.tripId}/expenses`, {
      method: "POST",
      cookie: driverCookie,
      body: expensePayload
    });
    assert.equal(idempotentRetry.status, 200);
    assert.equal(idempotentRetry.data.duplicate, true);
    assert.equal(idempotentRetry.data.expense.id, state.expenseId);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM expenses").get().count, 1);

    const conflictingRetry = await jsonRequest(`/api/driver/trips/${state.tripId}/expenses`, {
      method: "POST",
      cookie: driverCookie,
      body: { ...expensePayload, amountKopecks: 999_00 }
    });
    assert.equal(conflictingRetry.status, 409);
    assert.equal(conflictingRetry.data.code, "MUTATION_CONFLICT");

    const duplicateReceiptExpense = await jsonRequest(`/api/driver/trips/${state.tripId}/expenses`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        ...expensePayload,
        clientMutationId: "mobile-expense-duplicate-receipt",
        amountKopecks: 5_000,
        description: "Повторная загрузка того же чека для проверки антифрода"
      }
    });
    assert.equal(duplicateReceiptExpense.status, 201);
    assert.equal(duplicateReceiptExpense.data.expense.status, "suspicious");
    assert.match(duplicateReceiptExpense.data.expense.risk_flags_json, /duplicate_receipt/);
    state.duplicateExpenseId = duplicateReceiptExpense.data.expense.id;

    const fuelReceipt = await upload("/api/files", {
      cookie: driverCookie,
      body: fakeJpeg("fuel-receipt-27400"),
      mimeType: "image/jpeg",
      fileName: "fuel-receipt.jpg",
      kind: "expense_receipt"
    });
    assert.equal(fuelReceipt.status, 201);
    const advanceExpense = await jsonRequest(`/api/driver/trips/${state.tripId}/expenses`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        receiptAttachmentId: fuelReceipt.data.attachmentId,
        clientMutationId: "mobile-expense-fuel-advance",
        amountKopecks: 2_740_000,
        category: "топливо",
        paymentMethod: "card",
        paymentSource: "driver_advance",
        supplier: "АЗС",
        description: "Заправка из выданных 30 000 рублей",
        locationText: "Тверская область"
      }
    });
    assert.equal(advanceExpense.status, 201);
    state.advanceExpenseId = advanceExpense.data.expense.id;

    const endPhoto = await upload("/api/files", {
      cookie: driverCookie,
      body: fakeJpeg("end-odometer"),
      mimeType: "image/jpeg",
      fileName: "odometer-end.jpg",
      kind: "odometer_end"
    });
    assert.equal(endPhoto.status, 201);
    state.endPhotoId = endPhoto.data.attachmentId;

    const invalidOdometer = await jsonRequest(`/api/driver/trips/${state.tripId}/complete`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: state.endPhotoId,
        odometerKm: 99_999,
        unloadedAt: "2026-07-15T18:00:00+03:00"
      }
    });
    assert.equal(invalidOdometer.status, 400);
    assert.equal(invalidOdometer.data.code, "INVALID_ODOMETER");

    const invalidTimeline = await jsonRequest(`/api/driver/trips/${state.tripId}/complete`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: state.endPhotoId,
        clientMutationId: "mobile-complete-0001",
        odometerKm: 100_750,
        unloadedAt: "2026-07-09T18:00:00+03:00"
      }
    });
    assert.equal(invalidTimeline.status, 400);
    assert.equal(invalidTimeline.data.code, "INVALID_TRIP_TIMELINE");

    const complete = await jsonRequest(`/api/driver/trips/${state.tripId}/complete`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: state.endPhotoId,
        clientMutationId: "mobile-complete-0001",
        odometerKm: 100_750,
        unloadedAt: "2026-07-15T18:00:00+03:00",
        latitude: 59.9343,
        longitude: 30.3351
      }
    });
    assert.equal(complete.status, 200);
    assert.equal(complete.data.trip.status, "pending_review");
    assert.equal(complete.data.trip.end_odometer_km, 100_750);

    const duplicateComplete = await jsonRequest(`/api/driver/trips/${state.tripId}/complete`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: state.endPhotoId,
        clientMutationId: "mobile-complete-0001",
        odometerKm: 100_750,
        unloadedAt: "2026-07-15T18:00:00+03:00"
      }
    });
    assert.equal(duplicateComplete.status, 200);
    assert.equal(duplicateComplete.data.duplicate, true);

    const routeUpdate = await jsonRequest(`/api/office/trips/${state.secondTripId}/route`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        unloadingAddress: "Нижний Новгород, уточнённый склад",
        unloadingAddressIsApproximate: false,
        additionalUnloadingStops: ["Казань, промежуточная выгрузка"],
        reason: "Заказчик сообщил точный склад"
      }
    });
    assert.equal(routeUpdate.status, 200);
    assert.equal(routeUpdate.data.trip.unloading_address, "Нижний Новгород, уточнённый склад");
    assert.equal(routeUpdate.data.trip.additional_unloading_stops.length, 1);

    const previousPeriodId = routeUpdate.data.trip.rig_period_id;
    const compositionAfterTrip = await jsonRequest(`/api/office/rigs/${state.rigId}/composition`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        tractorId: state.tractorId,
        trailerId: state.trailerId,
        driverId: state.driverId
      }
    });
    assert.equal(compositionAfterTrip.status, 200);
    const reassignedTrip = compositionAfterTrip.data.rig;
    assert.equal(reassignedTrip.driver_id, state.driverId);
    const updatedSecondTrip = (await request("/api/office/bootstrap", { cookie: officeCookie })).data.trips
      .find((item) => item.id === state.secondTripId);
    assert.notEqual(updatedSecondTrip.rig_period_id, previousPeriodId);

    const driverCanDownloadOwnPhoto = await request(`/api/files/${state.startPhotoId}`, {
      cookie: driverCookie
    });
    assert.equal(driverCanDownloadOwnPhoto.status, 200);
    assert.equal(driverCanDownloadOwnPhoto.body.equals(fakeJpeg("start-odometer")), true);

    const orphanUpload = await upload("/api/files", {
      cookie: driverCookie,
      body: fakeJpeg("discard-me"),
      mimeType: "image/jpeg",
      fileName: "discard-me.jpg",
      kind: "expense_receipt"
    });
    assert.equal(orphanUpload.status, 201);
    const discarded = await jsonRequest(`/api/files/${orphanUpload.data.attachmentId}/discard`, {
      method: "POST",
      cookie: driverCookie,
      body: {}
    });
    assert.equal(discarded.status, 200);
    const discardedDownload = await request(`/api/files/${orphanUpload.data.attachmentId}`, { cookie: driverCookie });
    assert.equal(discardedDownload.status, 404);

    const finalDriverView = await request("/api/driver/bootstrap", { cookie: driverCookie });
    assert.equal(finalDriverView.status, 200);
    assert.equal(finalDriverView.data.trips.find((item) => item.id === state.tripId).status, "pending_review");
    assert.equal(finalDriverView.data.capabilities.compensationVisible, false);
    assert.equal(Object.hasOwn(finalDriverView.data, "settlement"), false);
    assert.equal(Object.hasOwn(finalDriverView.data, "transfers"), false);
    assert.equal(Object.hasOwn(finalDriverView.data, "accruals"), false);
    const officeViewWithProvisionalDaily = await request("/api/office/bootstrap", { cookie: officeCookie });
    const officeSettlementWithProvisionalDaily = officeViewWithProvisionalDaily.data.driverSettlements
      .find((item) => item.driverId === state.driverId);
    assert.equal(officeSettlementWithProvisionalDaily.dailyConfirmedAccruedKopecks, 0);
    assert.equal(officeSettlementWithProvisionalDaily.dailyProvisionalAccruedKopecks, 900_000);
    assert.equal(officeSettlementWithProvisionalDaily.dailyAccruedKopecks, 900_000);
    const originalExpense = finalDriverView.data.expenses.find((item) => item.id === state.expenseId);
    const suspiciousExpense = finalDriverView.data.expenses.find((item) => item.id === state.duplicateExpenseId);
    assert.equal(originalExpense.status, "pending_review");
    assert.equal(originalExpense.amount_kopecks, 125_050);
    assert.equal(suspiciousExpense.status, "suspicious");
  });

  test("office reviews the expense, records a penalty and partial payment, then confirms profitability", async () => {
    const prematureConfirmation = await jsonRequest(`/api/office/trips/${state.tripId}/confirm`, {
      method: "POST",
      cookie: officeCookie,
      body: {}
    });
    assert.equal(prematureConfirmation.status, 409);
    assert.equal(prematureConfirmation.data.code, "EXPENSES_PENDING");

    const suspiciousReview = await jsonRequest(`/api/office/expenses/${state.expenseId}/review`, {
      method: "POST",
      cookie: officeCookie,
      body: { status: "suspicious", comment: "Сумма требует дополнительной проверки" }
    });
    assert.equal(suspiciousReview.status, 200);
    assert.equal(suspiciousReview.data.expense.status, "suspicious");
    assert.deepEqual(
      suspiciousReview.data.expense.review_timeline.map((entry) => [entry.entryType, entry.status, entry.message]),
      [["office_review", "suspicious", "Сумма требует дополнительной проверки"]]
    );

    const suspiciousConfirmation = await jsonRequest(`/api/office/trips/${state.tripId}/confirm`, {
      method: "POST",
      cookie: officeCookie,
      body: {}
    });
    assert.equal(suspiciousConfirmation.status, 409);
    assert.equal(suspiciousConfirmation.data.code, "EXPENSES_PENDING");

    const explanationRequest = await jsonRequest(`/api/office/expenses/${state.expenseId}/review`, {
      method: "POST",
      cookie: officeCookie,
      body: { status: "needs_explanation", comment: "Уточните, что именно покупалось" }
    });
    assert.equal(explanationRequest.status, 200);
    assert.equal(explanationRequest.data.expense.status, "needs_explanation");
    assert.deepEqual(
      explanationRequest.data.expense.review_timeline.map((entry) => entry.status),
      ["suspicious", "needs_explanation"]
    );

    const explanation = await jsonRequest(`/api/driver/expenses/${state.expenseId}/explanations`, {
      method: "POST",
      cookie: driverCookie,
      body: { message: "Куплены два крепёжных ремня для груза" }
    });
    assert.equal(explanation.status, 201);
    assert.equal(explanation.data.expense.status, "pending_review");
    assert.equal(explanation.data.expense.driver_explanation, "Куплены два крепёжных ремня для груза");
    assert.deepEqual(
      explanation.data.expense.review_timeline.map((entry) => entry.entryType),
      ["office_review", "office_review", "driver_explanation"]
    );
    assert.equal(
      explanation.data.expense.review_timeline.at(-1).message,
      "Куплены два крепёжных ремня для груза"
    );

    const explanationVisibleToOffice = await request("/api/office/bootstrap", { cookie: officeCookie });
    const explainedOfficeExpense = explanationVisibleToOffice.data.expenses
      .find((item) => item.id === state.expenseId);
    assert.equal(explainedOfficeExpense.driver_explanation, "Куплены два крепёжных ремня для груза");
    assert.equal(explainedOfficeExpense.review_timeline.length, 3);

    const review = await jsonRequest(`/api/office/expenses/${state.expenseId}/review`, {
      method: "POST",
      cookie: officeCookie,
      body: { status: "confirmed", comment: "Чек и расход проверены" }
    });
    assert.equal(review.status, 200);
    assert.equal(review.data.expense.status, "confirmed");
    assert.equal(review.data.trip.confirmed_expenses_kopecks, 125_050);
    assert.deepEqual(
      review.data.expense.review_timeline.map((entry) => entry.entryType),
      ["office_review", "office_review", "driver_explanation", "office_review"]
    );
    assert.equal(review.data.expense.review_timeline.at(-1).status, "confirmed");
    assert.equal(review.data.expense.review_timeline.at(-1).message, "Чек и расход проверены");

    const rejectDuplicate = await jsonRequest(`/api/office/expenses/${state.duplicateExpenseId}/review`, {
      method: "POST",
      cookie: officeCookie,
      body: { status: "rejected", comment: "Повторно использованный чек" }
    });
    assert.equal(rejectDuplicate.status, 200);
    assert.equal(rejectDuplicate.data.expense.status, "rejected");

    const reviewAdvanceExpense = await jsonRequest(`/api/office/expenses/${state.advanceExpenseId}/review`, {
      method: "POST",
      cookie: officeCookie,
      body: { status: "confirmed", comment: "Заправка подтверждена чеком" }
    });
    assert.equal(reviewAdvanceExpense.status, 200);
    assert.equal(reviewAdvanceExpense.data.expense.status, "confirmed");
    assert.equal(reviewAdvanceExpense.data.trip.confirmed_expenses_kopecks, 2_865_050);

    const adjustment = await jsonRequest(`/api/office/trips/${state.tripId}/adjustments`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        adjustmentType: "penalty",
        amountKopecks: 500_000,
        reason: "Штраф заказчика за задержку на сутки",
        clientMutationId: "rate-adjustment-idempotent-1"
      }
    });
    assert.equal(adjustment.status, 201);
    state.adjustmentId = adjustment.data.adjustmentId;
    assert.equal(adjustment.data.trip.adjustments_kopecks, -500_000);
    assert.equal(adjustment.data.trip.final_rate_kopecks, 11_500_000);
    assert.equal(adjustment.data.trip.agreed_rate_kopecks, 12_000_000, "original agreed rate remains immutable");

    const duplicateAdjustment = await jsonRequest(`/api/office/trips/${state.tripId}/adjustments`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        adjustmentType: "penalty",
        amountKopecks: 500_000,
        reason: "Штраф заказчика за задержку на сутки",
        clientMutationId: "rate-adjustment-idempotent-1"
      }
    });
    assert.equal(duplicateAdjustment.status, 200);
    assert.equal(duplicateAdjustment.data.duplicate, true);
    const conflictingAdjustment = await jsonRequest(`/api/office/trips/${state.tripId}/adjustments`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        adjustmentType: "penalty",
        amountKopecks: 500_000,
        reason: "Другая причина с тем же ключом",
        clientMutationId: "rate-adjustment-idempotent-1"
      }
    });
    assert.equal(conflictingAdjustment.status, 409);
    assert.equal(conflictingAdjustment.data.code, "MUTATION_CONFLICT");

    const payment = await jsonRequest(`/api/office/trips/${state.tripId}/payments`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        amountKopecks: 4_000_000,
        paymentType: "partial",
        paymentMethod: "bank",
        receivedAt: "2026-07-12T12:30:00+03:00",
        comment: "Частичная оплата от заказчика",
        clientMutationId: "customer-payment-idempotent-1"
      }
    });
    assert.equal(payment.status, 201);
    state.paymentId = payment.data.paymentId;
    assert.equal(payment.data.trip.received_kopecks, 4_000_000);
    assert.equal(payment.data.trip.receivable_kopecks, 7_500_000);
    assert.equal(payment.data.trip.preliminary_result_kopecks, 8_634_950);

    const duplicatePayment = await jsonRequest(`/api/office/trips/${state.tripId}/payments`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        amountKopecks: 4_000_000,
        paymentType: "partial",
        paymentMethod: "bank",
        receivedAt: "2026-07-12T12:30:00+03:00",
        comment: "Частичная оплата от заказчика",
        clientMutationId: "customer-payment-idempotent-1"
      }
    });
    assert.equal(duplicatePayment.status, 200);
    assert.equal(duplicatePayment.data.duplicate, true);
    const conflictingPayment = await jsonRequest(`/api/office/trips/${state.tripId}/payments`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        amountKopecks: 4_000_000,
        paymentType: "partial",
        paymentMethod: "bank",
        receivedAt: "2026-07-12T12:30:00+03:00",
        comment: "Другое назначение с тем же ключом",
        clientMutationId: "customer-payment-idempotent-1"
      }
    });
    assert.equal(conflictingPayment.status, 409);
    assert.equal(conflictingPayment.data.code, "MUTATION_CONFLICT");

    const confirmation = await jsonRequest(`/api/office/trips/${state.tripId}/confirm`, {
      method: "POST",
      cookie: officeCookie,
      body: {}
    });
    assert.equal(confirmation.status, 200);
    assert.equal(confirmation.data.trip.status, "confirmed");
    assert.equal(confirmation.data.trip.driver_salary_accrued_kopecks, 900_000);
    assert.equal(confirmation.data.trip.driver_daily_accrued_kopecks, 900_000);
    assert.equal(confirmation.data.trip.driver_compensation_kopecks, 1_800_000);
    assert.equal(confirmation.data.trip.confirmed_result_kopecks, 6_834_950);
    assert.equal(confirmation.data.trip.payment_due_date, "2026-07-29");
    assert.equal(confirmation.data.trip.start_odometer_km, 100_000);
    assert.equal(confirmation.data.trip.end_odometer_km, 100_750);
    assert.equal(confirmation.data.trip.adjustments.length, 1);
    assert.equal(confirmation.data.trip.adjustments[0].amount_kopecks, -500_000);
    assert.equal(confirmation.data.trip.payments.length, 1);
    assert.equal(confirmation.data.trip.payments[0].allocated_kopecks, 4_000_000);

    const officeView = await request("/api/office/bootstrap", { cookie: officeCookie });
    assert.equal(officeView.status, 200);
    const trip = officeView.data.trips.find((item) => item.id === state.tripId);
    assert.equal(trip.status, "confirmed");
    assert.equal(trip.final_rate_kopecks, 11_500_000);
    assert.equal(trip.receivable_kopecks, 7_500_000);
    assert.equal(trip.confirmed_expenses_kopecks, 2_865_050);
    assert.equal(trip.driver_compensation_kopecks, 1_800_000);
    assert.equal(trip.confirmed_result_kopecks, 6_834_950);

    const leasing = await jsonRequest("/api/office/recurring-costs", {
      method: "POST",
      cookie: officeCookie,
      body: {
        subjectType: "rig",
        subjectId: state.rigId,
        category: "Лизинг сцепки",
        totalAmountKopecks: 6_000_000,
        allocationMode: "monthly",
        allocationMonths: 1,
        validFrom: "2026-01-01",
        comment: "Ежемесячный платёж",
        clientMutationId: "recurring-leasing-1"
      }
    });
    assert.equal(leasing.status, 201);

    const insurance = await jsonRequest("/api/office/recurring-costs", {
      method: "POST",
      cookie: officeCookie,
      body: {
        subjectType: "rig",
        subjectId: state.rigId,
        category: "Страховка",
        totalAmountKopecks: 12_000_000,
        allocationMode: "equal_months",
        allocationMonths: 12,
        validFrom: "2026-01-01",
        comment: "Годовая страховка, по 1/12 в месяц",
        clientMutationId: "recurring-insurance-1"
      }
    });
    assert.equal(insurance.status, 201);

    const report = await request("/api/office/report?from=2026-07-01&to=2026-07-31", {
      cookie: officeCookie
    });
    assert.equal(report.status, 200);
    assert.equal(report.data.totals.tripCount, 1);
    assert.equal(report.data.totals.revenueKopecks, 11_500_000);
    assert.equal(report.data.totals.tripExpensesKopecks, 2_865_050);
    assert.equal(report.data.totals.driverCompensationKopecks, 1_800_000);
    assert.equal(report.data.totals.fixedCostsKopecks, 7_000_000);
    assert.equal(report.data.totals.profitKopecks, -165_050);
    assert.equal(report.data.totals.receivedKopecks, 4_000_000);
    assert.equal(report.data.totals.receivableKopecks, 7_500_000);
    assert.equal(report.data.rigs[0].distanceKm, 750);

    const midMonthInsurance = await jsonRequest("/api/office/recurring-costs", {
      method: "POST",
      cookie: officeCookie,
      body: {
        subjectType: "rig",
        subjectId: state.rigId,
        category: "Страховка",
        totalAmountKopecks: 1_200_000,
        allocationMode: "equal_months",
        allocationMonths: 12,
        validFrom: "2026-01-15",
        comment: "Проверка полного распределения с середины месяца",
        clientMutationId: "recurring-mid-month-1"
      }
    });
    assert.equal(midMonthInsurance.status, 201);
    const duplicateMidMonthInsurance = await jsonRequest("/api/office/recurring-costs", {
      method: "POST",
      cookie: officeCookie,
      body: {
        subjectType: "rig",
        subjectId: state.rigId,
        category: "Страховка",
        totalAmountKopecks: 1_200_000,
        allocationMode: "equal_months",
        allocationMonths: 12,
        validFrom: "2026-01-15",
        comment: "Проверка полного распределения с середины месяца",
        clientMutationId: "recurring-mid-month-1"
      }
    });
    assert.equal(duplicateMidMonthInsurance.status, 200);
    assert.equal(duplicateMidMonthInsurance.data.duplicate, true);
    const conflictingMidMonthInsurance = await jsonRequest("/api/office/recurring-costs", {
      method: "POST",
      cookie: officeCookie,
      body: {
        subjectType: "rig",
        subjectId: state.rigId,
        category: "Страховка",
        totalAmountKopecks: 1_200_000,
        allocationMode: "equal_months",
        allocationMonths: 12,
        validFrom: "2026-01-15",
        comment: "Другое описание с тем же ключом",
        clientMutationId: "recurring-mid-month-1"
      }
    });
    assert.equal(conflictingMidMonthInsurance.status, 409);
    assert.equal(conflictingMidMonthInsurance.data.code, "MUTATION_CONFLICT");
    const fullYearReport = await request("/api/office/report?from=2026-01-01&to=2026-12-31", {
      cookie: officeCookie
    });
    const insuranceCost = fullYearReport.data.costBreakdown.fixedCosts
      .find((item) => item.category === "Страховка");
    assert.equal(insuranceCost.amountKopecks, 13_200_000, "all 12 equal monthly portions must be allocated");

    const auditActions = database.prepare(`
      SELECT action FROM audit_events ORDER BY created_at, rowid
    `).all().map((row) => row.action);
    for (const expectedAction of [
      "driver_created",
      "created_and_assigned",
      "attached",
      "started",
      "submitted",
      "completed_by_driver",
      "reviewed",
      "created_and_allocated",
      "created",
      "confirmed"
    ]) {
      assert.equal(auditActions.includes(expectedAction), true, `audit must include ${expectedAction}`);
    }
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM odometer_readings WHERE trip_id = ?").get(state.tripId).count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM trip_documents WHERE trip_id = ?").get(state.tripId).count, 1);
  });

  test("office records one-off business expenses and reports them without deleting history", async () => {
    const proof = await upload("/api/files", {
      cookie: officeCookie,
      body: fakeJpeg("company-expense-proof"),
      mimeType: "image/jpeg",
      fileName: "tires.jpg",
      kind: "company_expense_proof"
    });
    assert.equal(proof.status, 201);

    const driverCannotUploadOfficeProof = await upload("/api/files", {
      cookie: driverCookie,
      body: fakeJpeg("forbidden-company-proof"),
      mimeType: "image/jpeg",
      fileName: "forbidden.jpg",
      kind: "company_expense_proof"
    });
    assert.equal(driverCannotUploadOfficeProof.status, 400);
    assert.equal(driverCannotUploadOfficeProof.data.code, "INVALID_ATTACHMENT_KIND");

    const rigExpenseBody = {
      scopeType: "rig",
      rigId: state.rigId,
      amountKopecks: 300_000,
      category: "Шины",
      paymentMethod: "company_card",
      occurredAt: "2026-07-18T12:00:00+03:00",
      description: "Аварийная замена шины",
      attachmentId: proof.data.attachmentId,
      clientMutationId: "company-expense-rig-1"
    };
    const rigExpense = await jsonRequest("/api/office/company-expenses", {
      method: "POST",
      cookie: officeCookie,
      body: rigExpenseBody
    });
    assert.equal(rigExpense.status, 201);
    assert.equal(rigExpense.data.companyExpense.rig_name, "К5 + трал №1");
    assert.equal(rigExpense.data.companyExpense.amount_kopecks, 300_000);

    const duplicate = await jsonRequest("/api/office/company-expenses", {
      method: "POST",
      cookie: officeCookie,
      body: rigExpenseBody
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM company_expenses WHERE client_mutation_id = 'company-expense-rig-1'
    `).get().count, 1);

    const companyExpense = await jsonRequest("/api/office/company-expenses", {
      method: "POST",
      cookie: officeCookie,
      body: {
        scopeType: "company",
        amountKopecks: 500_000,
        category: "Офис",
        paymentMethod: "bank",
        occurredAt: "2026-07-20T09:00:00+03:00",
        description: "Оплата связи и программ",
        clientMutationId: "company-expense-general-1"
      }
    });
    assert.equal(companyExpense.status, 201);
    assert.equal(companyExpense.data.companyExpense.rig_id, null);

    const driverCannotCreateCompanyExpense = await jsonRequest("/api/office/company-expenses", {
      method: "POST",
      cookie: driverCookie,
      body: rigExpenseBody
    });
    assert.equal(driverCannotCreateCompanyExpense.status, 403);

    const allRigsReport = await request("/api/office/report?from=2026-07-01&to=2026-07-31", {
      cookie: officeCookie
    });
    assert.equal(allRigsReport.status, 200);
    assert.equal(allRigsReport.data.totals.oneOffExpensesKopecks, 800_000);
    assert.equal(allRigsReport.data.totals.unallocatedCompanyExpensesKopecks, 500_000);
    assert.equal(allRigsReport.data.totals.profitKopecks, -1_065_050);
    assert.equal(allRigsReport.data.rigs[0].oneOffExpensesKopecks, 300_000);
    assert.equal(allRigsReport.data.rigs[0].profitKopecks, -565_050);
    assert.equal(
      allRigsReport.data.costBreakdown.tripExpenses.find((row) => row.category === "топливо").amountKopecks,
      2_740_000
    );
    assert.equal(
      allRigsReport.data.costBreakdown.oneOffExpenses.find((row) => row.category === "Шины").amountKopecks,
      300_000
    );

    const rigReport = await request(`/api/office/report?from=2026-07-01&to=2026-07-31&rigId=${encodeURIComponent(state.rigId)}`, {
      cookie: officeCookie
    });
    assert.equal(rigReport.status, 200);
    assert.equal(rigReport.data.totals.oneOffExpensesKopecks, 300_000);
    assert.equal(rigReport.data.totals.unallocatedCompanyExpensesKopecks, 0);
    assert.equal(rigReport.data.totals.profitKopecks, -565_050);

    const reversed = await jsonRequest(`/api/office/company-expenses/${companyExpense.data.companyExpense.id}/reverse`, {
      method: "POST",
      cookie: officeCookie,
      body: { reason: "Платёж оказался личным расходом владельца" }
    });
    assert.equal(reversed.status, 200);
    assert.ok(reversed.data.companyExpense.reversed_at);

    const afterReversal = await request("/api/office/report?from=2026-07-01&to=2026-07-31", {
      cookie: officeCookie
    });
    assert.equal(afterReversal.data.totals.oneOffExpensesKopecks, 300_000);
    assert.equal(afterReversal.data.totals.profitKopecks, -565_050);

    const temporaryRecurringCost = await jsonRequest("/api/office/recurring-costs", {
      method: "POST",
      cookie: officeCookie,
      body: {
        subjectType: "rig",
        subjectId: state.rigId,
        category: "Ошибочная подписка",
        totalAmountKopecks: 100_000,
        allocationMode: "monthly",
        allocationMonths: 1,
        validFrom: "2026-07-01",
        comment: "Проверка сторно"
      }
    });
    assert.equal(temporaryRecurringCost.status, 201);
    const withTemporaryCost = await request("/api/office/report?from=2026-07-01&to=2026-07-31", {
      cookie: officeCookie
    });
    assert.equal(withTemporaryCost.data.totals.profitKopecks, -665_050);
    const reversedRecurringCost = await jsonRequest(`/api/office/recurring-costs/${temporaryRecurringCost.data.recurringCost.id}/reverse`, {
      method: "POST",
      cookie: officeCookie,
      body: { reason: "Подписка не относится к компании" }
    });
    assert.equal(reversedRecurringCost.status, 200);
    assert.ok(reversedRecurringCost.data.recurringCost.reversed_at);
    const afterRecurringReversal = await request("/api/office/report?from=2026-07-01&to=2026-07-31", {
      cookie: officeCookie
    });
    assert.equal(afterRecurringReversal.data.totals.profitKopecks, -565_050);

    const bootstrap = await request("/api/office/bootstrap", { cookie: officeCookie });
    assert.equal(bootstrap.data.companyExpenses.length, 2);
    assert.ok(bootstrap.data.recurringCosts.some((cost) => cost.reversed_at));
    assert.equal(
      bootstrap.data.companyExpenses.filter((expense) => expense.reversed_at).length,
      1
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE entity_type = 'company_expense'").get().count,
      3
    );
  });

  test("office can reverse a mistaken customer payment and rate adjustment without deleting them", async () => {
    const before = await request("/api/office/bootstrap", { cookie: officeCookie });
    const beforeTrip = before.data.trips.find((trip) => trip.id === state.tripId);
    assert.equal(beforeTrip.adjustments.length, 1);
    assert.equal(beforeTrip.payments.length, 1);

    const reversedPayment = await jsonRequest(`/api/office/trips/${state.tripId}/payments/${state.paymentId}/reverse`, {
      method: "POST",
      cookie: officeCookie,
      body: { reason: "Платёж ошибочно отнесли к этому рейсу" }
    });
    assert.equal(reversedPayment.status, 200);
    assert.equal(reversedPayment.data.trip.received_kopecks, 0);
    assert.equal(reversedPayment.data.trip.receivable_kopecks, 11_500_000);
    assert.ok(reversedPayment.data.trip.payments[0].reversed_at);

    const repeatedPaymentReversal = await jsonRequest(`/api/office/trips/${state.tripId}/payments/${state.paymentId}/reverse`, {
      method: "POST",
      cookie: officeCookie,
      body: { reason: "Повторная попытка" }
    });
    assert.equal(repeatedPaymentReversal.status, 409);

    const reversedAdjustment = await jsonRequest(`/api/office/trips/${state.tripId}/adjustments/${state.adjustmentId}/reverse`, {
      method: "POST",
      cookie: officeCookie,
      body: { reason: "Заказчик отменил штраф" }
    });
    assert.equal(reversedAdjustment.status, 200);
    assert.equal(reversedAdjustment.data.trip.final_rate_kopecks, 12_000_000);
    assert.equal(reversedAdjustment.data.trip.confirmed_result_kopecks, 7_334_950);
    assert.ok(reversedAdjustment.data.trip.adjustments[0].reversed_at);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM trip_rate_adjustments WHERE id = ?").get(state.adjustmentId).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM incoming_payments WHERE id = ?").get(state.paymentId).count, 1);
  });

  test("driver settlements separate accruals, mixed payments, advances, returns and corrections", async () => {
    const initial = await request("/api/office/bootstrap", { cookie: officeCookie });
    assert.equal(initial.status, 200);
    let settlement = initial.data.driverSettlements.find((item) => item.driverId === state.driverId);
    assert.equal(settlement.salaryAccruedKopecks, 900_000);
    assert.equal(settlement.dailyAccruedKopecks, 900_000);
    assert.equal(settlement.dailyConfirmedAccruedKopecks, 900_000);
    assert.equal(settlement.dailyProvisionalAccruedKopecks, 0);
    assert.equal(settlement.personalExpensesKopecks, 125_050);
    assert.equal(settlement.advanceIssuedKopecks, 3_000_000);
    assert.equal(settlement.advanceSpentKopecks, 2_740_000);
    assert.equal(settlement.advanceBalanceKopecks, 260_000);
    assert.equal(settlement.companyOwesKopecks, 1_665_050);
    assert.equal(settlement.driverOwesKopecks, 0);
    assert.equal(settlement.dailyAccruedThrough, "2026-07-15");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM driver_accruals WHERE trip_id = ? AND accrual_type IN ('salary', 'daily')").get(state.tripId).count, 2);

    const mixedTransferBody = {
      driverId: state.driverId,
      direction: "company_to_driver",
      paymentMethod: "card_transfer",
      occurredAt: "2026-07-16T10:00:00+03:00",
      comment: "Одним переводом зарплата, суточные и компенсация",
      clientMutationId: "office-transfer-mixed-1",
      allocations: [
        { allocationType: "salary", amountKopecks: 400_000, tripId: state.tripId },
        { allocationType: "daily", amountKopecks: 300_000, coverageThrough: "2026-07-12", tripId: state.tripId },
        { allocationType: "expense_reimbursement", amountKopecks: 100_000, tripId: state.tripId }
      ]
    };
    const mixedTransfer = await jsonRequest("/api/office/driver-transfers", {
      method: "POST",
      cookie: officeCookie,
      body: mixedTransferBody
    });
    assert.equal(mixedTransfer.status, 201);
    assert.equal(mixedTransfer.data.transfer.amount_kopecks, 800_000);
    assert.equal(mixedTransfer.data.transfer.allocations.length, 3);
    assert.equal(mixedTransfer.data.settlement.companyOwesKopecks, 865_050);
    assert.equal(mixedTransfer.data.settlement.dailyPaidThrough, "2026-07-12");

    const duplicateTransfer = await jsonRequest("/api/office/driver-transfers", {
      method: "POST",
      cookie: officeCookie,
      body: mixedTransferBody
    });
    assert.equal(duplicateTransfer.status, 200);
    assert.equal(duplicateTransfer.data.duplicate, true);
    assert.equal(duplicateTransfer.data.settlement.companyOwesKopecks, 865_050);
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM driver_transfers WHERE client_mutation_id = 'office-transfer-mixed-1'
    `).get().count, 1);

    const returned = await jsonRequest("/api/office/driver-transfers", {
      method: "POST",
      cookie: officeCookie,
      body: {
        driverId: state.driverId,
        direction: "driver_to_company",
        paymentMethod: "card_transfer",
        occurredAt: "2026-07-17T09:00:00+03:00",
        comment: "Вернул часть неиспользованного аванса",
        clientMutationId: "office-transfer-return-1",
        allocations: [{ allocationType: "expense_advance", amountKopecks: 50_000, tripId: state.tripId }]
      }
    });
    assert.equal(returned.status, 201);
    assert.equal(returned.data.settlement.advanceBalanceKopecks, 210_000);
    assert.equal(returned.data.settlement.companyOwesKopecks, 915_050);

    const adjustment = await jsonRequest(`/api/office/drivers/${state.driverId}/adjustments`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        balanceCategory: "general",
        balanceEffectKopecks: -115_050,
        tripId: state.tripId,
        comment: "Согласованная корректировка взаиморасчёта",
        clientMutationId: "driver-adjustment-idempotent-1"
      }
    });
    assert.equal(adjustment.status, 201);
    assert.equal(adjustment.data.settlement.companyOwesKopecks, 800_000);
    const duplicateBalanceAdjustment = await jsonRequest(`/api/office/drivers/${state.driverId}/adjustments`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        balanceCategory: "general",
        balanceEffectKopecks: -115_050,
        tripId: state.tripId,
        comment: "Согласованная корректировка взаиморасчёта",
        clientMutationId: "driver-adjustment-idempotent-1"
      }
    });
    assert.equal(duplicateBalanceAdjustment.status, 200);
    assert.equal(duplicateBalanceAdjustment.data.duplicate, true);
    const conflictingBalanceAdjustment = await jsonRequest(`/api/office/drivers/${state.driverId}/adjustments`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        balanceCategory: "general",
        balanceEffectKopecks: -115_050,
        tripId: state.tripId,
        comment: "Другая причина с тем же ключом",
        clientMutationId: "driver-adjustment-idempotent-1"
      }
    });
    assert.equal(conflictingBalanceAdjustment.status, 409);
    assert.equal(conflictingBalanceAdjustment.data.code, "MUTATION_CONFLICT");

    const mistaken = await jsonRequest("/api/office/driver-transfers", {
      method: "POST",
      cookie: officeCookie,
      body: {
        driverId: state.driverId,
        direction: "company_to_driver",
        paymentMethod: "cash",
        occurredAt: "2026-07-17T10:00:00+03:00",
        comment: "Ошибочная запись для проверки сторно",
        clientMutationId: "office-transfer-mistake-1",
        allocations: [{ allocationType: "salary", amountKopecks: 10_000 }]
      }
    });
    assert.equal(mistaken.status, 201);
    assert.equal(mistaken.data.settlement.companyOwesKopecks, 790_000);

    const reversed = await jsonRequest(`/api/office/driver-transfers/${mistaken.data.transfer.id}/reverse`, {
      method: "POST",
      cookie: officeCookie,
      body: { reason: "Перевод фактически не выполнялся" }
    });
    assert.equal(reversed.status, 200);
    assert.ok(reversed.data.transfer.reversed_at);
    assert.equal(reversed.data.settlement.companyOwesKopecks, 800_000);

    const repeatedConfirmation = await jsonRequest(`/api/office/trips/${state.tripId}/confirm`, {
      method: "POST",
      cookie: officeCookie,
      body: {}
    });
    assert.equal(repeatedConfirmation.status, 409);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM driver_accruals WHERE trip_id = ? AND accrual_type IN ('salary', 'daily')").get(state.tripId).count, 2);

    const companyRates = await jsonRequest("/api/office/compensation/settings", {
      method: "POST",
      cookie: officeCookie,
      body: {
        defaultSalaryRateKopecksPerKm: 1300,
        defaultDailyRateKopecks: 160_000,
        reason: "Тест новых общих ставок"
      }
    });
    assert.equal(companyRates.status, 200);
    assert.equal(companyRates.data.compensationSettings.default_salary_rate_kopecks_per_km, 1300);

    const driverRates = await jsonRequest(`/api/office/drivers/${state.driverId}/compensation-settings`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        salaryRateKopecksPerKm: 1400,
        dailyRateKopecks: null,
        reason: "Индивидуальная ставка за километр"
      }
    });
    assert.equal(driverRates.status, 200);
    assert.equal(driverRates.data.driverSettings.salary_rate_kopecks_per_km, 1400);
    assert.equal(driverRates.data.driverSettings.daily_rate_kopecks, null);
    assert.deepEqual(
      database.prepare("SELECT unit_rate_kopecks FROM driver_accruals WHERE trip_id = ? AND accrual_type IN ('salary', 'daily') ORDER BY accrual_type").all(state.tripId).map((row) => row.unit_rate_kopecks),
      [150_000, 1200],
      "changing settings must not rewrite historical accrual snapshots"
    );

    const driverView = await request("/api/driver/bootstrap", { cookie: driverCookie });
    assert.equal(driverView.status, 200);
    assert.equal(driverView.data.capabilities.compensationVisible, false);
    assert.equal(Object.hasOwn(driverView.data, "settlement"), false);
    assert.equal(Object.hasOwn(driverView.data, "transfers"), false);
    assert.equal(Object.hasOwn(driverView.data, "accruals"), false);
    assert.ok(driverView.data.notifications.some((item) => item.notification_type === "driver_payment"));
    assert.ok(driverView.data.notifications.some((item) => item.notification_type === "expense_rejected"));
    const hiddenPaymentNotification = driverView.data.notifications
      .find((item) => item.notification_type === "driver_payment");
    assert.equal(hiddenPaymentNotification.message.includes("зарплата"), false);
    assert.equal(hiddenPaymentNotification.message.includes("суточные"), false);
    assert.equal(hiddenPaymentNotification.message.includes("800 000"), false);
    assert.equal(Object.hasOwn(driverView.data, "compensationSettings"), false);

    const unreadNotification = driverView.data.notifications.find((item) => !item.read_at);
    assert.ok(unreadNotification);
    const officeCannotReadDriverNotification = await jsonRequest(`/api/driver/notifications/${unreadNotification.id}/read`, {
      method: "POST",
      cookie: officeCookie,
      body: {}
    });
    assert.equal(officeCannotReadDriverNotification.status, 403);
    const readNotification = await jsonRequest(`/api/driver/notifications/${unreadNotification.id}/read`, {
      method: "POST",
      cookie: driverCookie,
      body: {}
    });
    assert.equal(readNotification.status, 200);
    assert.ok(readNotification.data.notification.read_at);
  });

  test("odometer anomalies are flagged for office review without blocking the driver", async () => {
    const start = await jsonRequest(`/api/driver/trips/${state.secondTripId}/start`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: state.secondTripStartPhotoId,
        clientMutationId: "mobile-start-risk-1",
        odometerKm: 100_700,
        loadedAt: "2026-07-20T09:00:00+03:00"
      }
    });
    assert.equal(start.status, 200);
    assert.equal(start.data.trip.status, "in_progress");

    const endPhoto = await upload("/api/files", {
      cookie: driverCookie,
      body: fakeJpeg("second-trip-end-risk"),
      mimeType: "image/jpeg",
      fileName: "second-trip-end-risk.jpg",
      kind: "odometer_end"
    });
    assert.equal(endPhoto.status, 201);
    const complete = await jsonRequest(`/api/driver/trips/${state.secondTripId}/complete`, {
      method: "POST",
      cookie: driverCookie,
      body: {
        attachmentId: endPhoto.data.attachmentId,
        clientMutationId: "mobile-complete-risk-1",
        odometerKm: 105_800,
        unloadedAt: "2026-07-20T10:00:00+03:00"
      }
    });
    assert.equal(complete.status, 200);
    assert.equal(complete.data.trip.status, "pending_review");

    const officeView = await request("/api/office/bootstrap", { cookie: officeCookie });
    const trip = officeView.data.trips.find((item) => item.id === state.secondTripId);
    const startFlags = JSON.parse(trip.start_odometer_risk_flags_json);
    const endFlags = JSON.parse(trip.end_odometer_risk_flags_json);
    assert.equal(startFlags[0].code, "odometer_below_previous_end");
    assert.ok(endFlags.some((flag) => flag.code === "unusually_large_trip_distance"));
    assert.ok(endFlags.some((flag) => flag.code === "impossible_average_speed"));

    const corrected = await jsonRequest(`/api/office/trips/${state.secondTripId}/measurements`, {
      method: "POST",
      cookie: officeCookie,
      body: {
        startOdometerKm: 100_750,
        endOdometerKm: 101_050,
        loadedAt: "2026-07-20T09:00:00+03:00",
        unloadedAt: "2026-07-20T15:00:00+03:00",
        reason: "Водитель переставил цифры, сверено по оригиналам фотографий"
      }
    });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.data.trip.start_odometer_km, 100_750);
    assert.equal(corrected.data.trip.end_odometer_km, 101_050);
    assert.equal(corrected.data.trip.status, "pending_review");
    assert.ok(JSON.parse(corrected.data.trip.end_odometer_risk_flags_json)
      .some((flag) => flag.code === "office_corrected"));
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE entity_id = ? AND action = 'measurements_corrected'")
        .get(state.secondTripId).count,
      1
    );
  });

  test("office can revoke an employee account and all of its sessions", async () => {
    const deactivated = await jsonRequest(`/api/office/users/${state.secondOfficeId}/active`, {
      method: "POST",
      cookie: officeCookie,
      body: { active: false, reason: "Сотрудник больше не работает в компании" }
    });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.data.user.isActive, false);
    const revokedSession = await request("/api/me", { cookie: state.secondOfficeCookie });
    assert.equal(revokedSession.status, 401);

    const reactivated = await jsonRequest(`/api/office/users/${state.secondOfficeId}/active`, {
      method: "POST",
      cookie: officeCookie,
      body: { active: true, reason: "Возвращён доступ" }
    });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.data.user.isActive, true);
  });

  test("logout invalidates the server-side session", async () => {
    const logout = await jsonRequest("/api/auth/logout", {
      method: "POST",
      cookie: driverCookie,
      body: {}
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.data.ok, true);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);

    const oldSession = await request("/api/me", { cookie: driverCookie });
    assert.equal(oldSession.status, 401);
    assert.equal(oldSession.data.code, "SESSION_EXPIRED");
  });

  async function jsonRequest(path, { method = "GET", cookie, body } = {}) {
    return request(path, {
      method,
      cookie,
      body: body == null ? undefined : JSON.stringify(body),
      headers: body == null ? undefined : { "content-type": "application/json" }
    });
  }

  async function upload(path, { cookie, body, mimeType, fileName, kind }) {
    return request(path, {
      method: "POST",
      cookie,
      body,
      headers: {
        "content-type": mimeType,
        "x-file-name": encodeURIComponent(fileName),
        "x-anb-kind": kind
      }
    });
  }

  async function request(path, { method = "GET", cookie, body, headers = {} } = {}) {
    const requestHeaders = new Headers(headers);
    if (cookie) requestHeaders.set("cookie", cookie);
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") && responseBody.length
      ? JSON.parse(responseBody.toString("utf8"))
      : undefined;
    return {
      status: response.status,
      headers: response.headers,
      body: responseBody,
      data
    };
  }
});

function sessionCookieFrom(response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "login response must include Set-Cookie");
  return header.split(";", 1)[0];
}

function fakeJpeg(label) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(`ANB:${label}`, "utf8"),
    Buffer.from([0xff, 0xd9])
  ]);
}
