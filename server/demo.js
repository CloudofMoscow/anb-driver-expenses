import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  audit,
  bootstrapOrganization,
  entityId,
  nowIso,
  openDatabase,
  transaction
} from "./database.js";
import { hashPassword } from "./security.js";

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(serverDirectory, "..");
const demoDataDirectory = resolve(projectDirectory, "demo-data");
const demoUploadsDirectory = resolve(demoDataDirectory, "uploads");
const demoDatabasePath = resolve(demoDataDirectory, "anb.sqlite");

process.env.ANB_DATA_DIR = demoDataDirectory;
process.env.ANB_UPLOADS_DIR = demoUploadsDirectory;
process.env.ANB_DATABASE_PATH = demoDatabasePath;
process.env.ANB_BOOTSTRAP_LOGIN = "owner";
process.env.ANB_BOOTSTRAP_PASSWORD = "anb-demo-2026";
process.env.ANB_BOOTSTRAP_NAME = "Владелец ANB";
process.env.ANB_ORGANIZATION_NAME = "ANB Group · демо";
process.env.ANB_DEMO_MODE = "1";

mkdirSync(demoUploadsDirectory, { recursive: true });
const database = openDatabase(demoDatabasePath);
bootstrapOrganization(database, {
  organizationName: "ANB Group · демо",
  adminLogin: "owner",
  adminPassword: "anb-demo-2026",
  adminFullName: "Владелец ANB"
});

const owner = database.prepare(`
  SELECT * FROM users WHERE role = 'office' AND login = 'owner' ORDER BY created_at LIMIT 1
`).get();
if (!owner) throw new Error("Не удалось создать демонстрационного владельца");

const alreadySeeded = database.prepare(`
  SELECT 1 AS ready FROM users
  WHERE organization_id = ? AND role = 'driver' AND login = 'driver1'
`).get(owner.organization_id);

if (!alreadySeeded) seedDemo(database, owner);
else upgradeExistingDemo(database, owner);
ensureDemoReviewTimeline(database, owner.organization_id);
database.close();

console.log("Демонстрационные данные готовы.");
console.log("Офис: owner / anb-demo-2026");
console.log("Водитель: driver1 / driver-demo-2026");
await import("./start.js");

function seedDemo(databaseConnection, officeUser) {
  const organizationId = officeUser.organization_id;
  const timestamp = nowIso();
  const userPassword = hashPassword("driver-demo-2026");
  const officePassword = hashPassword("office-demo-2026");
  const drivers = [
    ["Иванов Иван Иванович", "driver1", "+7 900 111-22-31"],
    ["Петров Пётр Сергеевич", "driver2", "+7 900 111-22-32"],
    ["Сидоров Алексей Викторович", "driver3", "+7 900 111-22-33"],
    ["Смирнов Николай Андреевич", "driver4", "+7 900 111-22-34"],
    ["Орлов Михаил Олегович", "driver5", "+7 900 111-22-35"]
  ].map(([fullName, login, phone]) => ({ id: entityId("usr"), fullName, login, phone }));
  const tractorData = [
    ["КамАЗ", "К5", "А101АА77"],
    ["Volvo", "FH", "А202АА77"],
    ["Scania", "R500", "А303АА77"],
    ["MAN", "TGX", "А404АА77"],
    ["Mercedes-Benz", "Actros", "А505АА77"]
  ];
  const trailerData = [
    ["Тверьстроймаш", "99393", "В101ВВ77", 4, 60000],
    ["Faymonville", "MultiMAX", "В202ВВ77", 5, 70000],
    ["Goldhofer", "STZ", "В303ВВ77", 6, 85000],
    ["ЧМЗАП", "9990", "В404ВВ77", 4, 60000],
    ["Broshuis", "SL", "В505ВВ77", 5, 75000]
  ];
  const rigs = tractorData.map((tractor, index) => ({
    id: entityId("rig"),
    periodId: entityId("rgp"),
    tractor: {
      id: entityId("trc"), brand: tractor[0], model: tractor[1], plate: tractor[2]
    },
    trailer: {
      id: entityId("trl"), brand: trailerData[index][0], model: trailerData[index][1],
      plate: trailerData[index][2], axles: trailerData[index][3], capacityKg: trailerData[index][4]
    },
    driver: drivers[index],
    name: `${tractor[0]} ${tractor[1]} · ${trailerData[index][3]} осей`
  }));
  const customers = [
    { id: entityId("cus"), name: "ТрансСтрой", inn: "7701234567", term: 14 },
    { id: entityId("cus"), name: "Север Проект", inn: "7802345678", term: 20 },
    { id: entityId("cus"), name: "Волга Монтаж", inn: "1653456789", term: 10 }
  ];
  const confirmedTrip = demoTrip({
    number: "ANB-0261",
    customer: customers[0],
    rig: rigs[0],
    loadingAddress: "Московская область, Подольск",
    unloadingAddress: "Республика Татарстан, Нижнекамск",
    plannedLoadingDate: dateOnly(daysFromNow(-16, 7)),
    loadedAt: daysFromNow(-16, 7),
    unloadedAt: daysFromNow(-11, 16),
    confirmedAt: daysFromNow(-10, 11),
    status: "confirmed",
    rateKopecks: 62_000_000,
    cargo: "Промышленное оборудование",
    instructions: "Перед въездом связаться с получателем."
  });
  const assignedTrip = demoTrip({
    number: "ANB-0265",
    customer: customers[1],
    rig: rigs[0],
    loadingAddress: "Санкт-Петербург, промзона Парнас",
    unloadingAddress: "Архангельск",
    plannedLoadingDate: dateOnly(daysFromNow(2, 8)),
    status: "assigned",
    rateKopecks: 54_000_000,
    cargo: "Металлоконструкции",
    instructions: "Точное окно погрузки подтвердит офис."
  });
  const activeTrip = demoTrip({
    number: "ANB-0263",
    customer: customers[2],
    rig: rigs[1],
    loadingAddress: "Нижний Новгород",
    unloadingAddress: "Екатеринбург",
    plannedLoadingDate: dateOnly(daysFromNow(-2, 8)),
    loadedAt: daysFromNow(-2, 10),
    status: "in_progress",
    rateKopecks: 45_000_000,
    cargo: "Трансформатор",
    instructions: "Контроль высоты перед каждым путепроводом."
  });
  const reviewTrip = demoTrip({
    number: "ANB-0262",
    customer: customers[1],
    rig: rigs[2],
    loadingAddress: "Самара",
    unloadingAddress: "Ростов-на-Дону",
    plannedLoadingDate: dateOnly(daysFromNow(-7, 8)),
    loadedAt: daysFromNow(-7, 9),
    unloadedAt: daysFromNow(-3, 18),
    status: "pending_review",
    rateKopecks: 38_000_000,
    cargo: "Строительная техника",
    instructions: ""
  });
  const trips = [confirmedTrip, assignedTrip, activeTrip, reviewTrip];

  const attachments = [
    demoAttachment(organizationId, officeUser.id, "trip_document", "contract.png", "icon-512.png"),
    demoAttachment(organizationId, drivers[0].id, "odometer_start", "odometer-start.png", "icon-192.png"),
    demoAttachment(organizationId, drivers[0].id, "odometer_end", "odometer-end.png", "apple-touch-icon.png"),
    demoAttachment(organizationId, drivers[0].id, "expense_receipt", "fuel.png", "icon-512.png"),
    demoAttachment(organizationId, drivers[0].id, "expense_receipt", "toll.png", "icon-192.png"),
    demoAttachment(organizationId, drivers[0].id, "expense_receipt", "hotel.png", "apple-touch-icon.png"),
    demoAttachment(organizationId, drivers[1].id, "odometer_start", "active-start.png", "icon-192.png"),
    demoAttachment(organizationId, drivers[1].id, "expense_receipt", "active-receipt.png", "icon-512.png"),
    demoAttachment(organizationId, drivers[2].id, "odometer_start", "review-start.png", "icon-192.png"),
    demoAttachment(organizationId, drivers[2].id, "odometer_end", "review-end.png", "apple-touch-icon.png"),
    demoAttachment(organizationId, drivers[2].id, "expense_receipt", "review-receipt.png", "icon-512.png")
  ];

  transaction(databaseConnection, () => {
    const insertUser = databaseConnection.prepare(`
      INSERT INTO users(
        id, organization_id, role, login, password_hash, full_name,
        phone, birth_date, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insertUser.run(
      entityId("usr"), organizationId, "office", "logist", officePassword,
      "Логист ANB", "+7 900 000-00-02", null, timestamp, timestamp
    );
    drivers.forEach((driver, index) => insertUser.run(
      driver.id, organizationId, "driver", driver.login, userPassword,
      driver.fullName, driver.phone, `198${index + 4}-05-15`, timestamp, timestamp
    ));

    const insertTractor = databaseConnection.prepare(`
      INSERT INTO tractors(
        id, organization_id, brand, model, plate_number, vin, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTrailer = databaseConnection.prepare(`
      INSERT INTO trailers(
        id, organization_id, brand, model, plate_number, axles,
        capacity_kg, trailer_type, oversized_notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRig = databaseConnection.prepare(`
      INSERT INTO rigs(id, organization_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertPeriod = databaseConnection.prepare(`
      INSERT INTO rig_periods(
        id, organization_id, rig_id, tractor_id, trailer_id, driver_id,
        valid_from, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    rigs.forEach((rig, index) => {
      insertTractor.run(
        rig.tractor.id, organizationId, rig.tractor.brand, rig.tractor.model,
        rig.tractor.plate, `DEMO-VIN-${index + 1}`, "Демонстрационный тягач", timestamp, timestamp
      );
      insertTrailer.run(
        rig.trailer.id, organizationId, rig.trailer.brand, rig.trailer.model,
        rig.trailer.plate, rig.trailer.axles, rig.trailer.capacityKg,
        "Негабаритный трал", "Раздвижная платформа", timestamp, timestamp
      );
      insertRig.run(rig.id, organizationId, rig.name, timestamp, timestamp);
      insertPeriod.run(
        rig.periodId, organizationId, rig.id, rig.tractor.id, rig.trailer.id,
        rig.driver.id, daysFromNow(-180), officeUser.id, timestamp
      );
    });

    const insertCustomer = databaseConnection.prepare(`
      INSERT INTO customers(
        id, organization_id, short_name, full_name, inn,
        default_payment_term_days, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    customers.forEach((customer) => insertCustomer.run(
      customer.id, organizationId, customer.name, `ООО «${customer.name}»`,
      customer.inn, customer.term, timestamp, timestamp
    ));
    const contactId = entityId("cnt");
    databaseConnection.prepare(`
      INSERT INTO customer_contacts(
        id, organization_id, customer_id, full_name, position, email, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contactId, organizationId, customers[0].id, "Анна Морозова", "Логист",
      "logist@example.test", "Демонстрационный контакт", timestamp
    );
    for (const [phone, label] of [["+7 900 555-10-10", "рабочий"], ["+7 900 555-10-11", "резервный"]]) {
      databaseConnection.prepare(`
        INSERT INTO customer_contact_phones(id, organization_id, contact_id, phone, label, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(entityId("phn"), organizationId, contactId, phone, label, timestamp);
    }

    const insertTrip = databaseConnection.prepare(`
      INSERT INTO trips(
        id, organization_id, number, customer_id, rig_id, rig_period_id,
        driver_id, tractor_id, trailer_id, loading_address, planned_loading_date,
        unloading_address, unloading_address_is_approximate, cargo_description,
        driver_instructions, agreed_rate_kopecks, vat_mode, vat_rate_basis_points,
        payment_method, payment_term_days, status, assigned_at, loaded_at,
        unloaded_at, confirmed_at, created_by, confirmed_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    trips.forEach((trip) => insertTrip.run(
      trip.id, organizationId, trip.number, trip.customer.id, trip.rig.id,
      trip.rig.periodId, trip.rig.driver.id, trip.rig.tractor.id, trip.rig.trailer.id,
      trip.loadingAddress, trip.plannedLoadingDate, trip.unloadingAddress, 0,
      trip.cargo, trip.instructions, trip.rateKopecks, "with_vat", 2200,
      "bank", trip.customer.term, trip.status, timestamp, trip.loadedAt,
      trip.unloadedAt, trip.confirmedAt, officeUser.id,
      trip.confirmedAt ? officeUser.id : null, timestamp, trip.confirmedAt || timestamp
    ));
    databaseConnection.prepare(`
      INSERT INTO trip_stops(
        id, organization_id, trip_id, stop_order, stop_type,
        address, is_approximate, notes, created_at
      ) VALUES (?, ?, ?, 1, 'unloading', ?, 0, ?, ?)
    `).run(
      entityId("stp"), organizationId, assignedTrip.id,
      "Вологда", "Промежуточная выгрузка одной позиции", timestamp
    );

    const insertAttachment = databaseConnection.prepare(`
      INSERT INTO attachments(
        id, organization_id, kind, storage_path, original_name, mime_type,
        size_bytes, sha256, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    attachments.forEach((attachment) => insertAttachment.run(
      attachment.id, organizationId, attachment.kind, attachment.storagePath,
      attachment.originalName, attachment.mimeType, attachment.sizeBytes,
      attachment.sha256, attachment.createdBy, timestamp
    ));
    databaseConnection.prepare(`
      INSERT INTO trip_documents(
        id, organization_id, trip_id, customer_id, attachment_id,
        document_type, version_number, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, 'contract_application', 1, ?, ?)
    `).run(
      entityId("doc"), organizationId, confirmedTrip.id, confirmedTrip.customer.id,
      attachments[0].id, officeUser.id, timestamp
    );

    const insertOdometer = databaseConnection.prepare(`
      INSERT INTO odometer_readings(
        id, organization_id, trip_id, tractor_id, driver_id, reading_type,
        entered_value_km, attachment_id, captured_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertOdometer.run(entityId("odo"), organizationId, confirmedTrip.id, rigs[0].tractor.id, drivers[0].id, "start", 220000, attachments[1].id, confirmedTrip.loadedAt, timestamp);
    insertOdometer.run(entityId("odo"), organizationId, confirmedTrip.id, rigs[0].tractor.id, drivers[0].id, "end", 221350, attachments[2].id, confirmedTrip.unloadedAt, timestamp);
    insertOdometer.run(entityId("odo"), organizationId, activeTrip.id, rigs[1].tractor.id, drivers[1].id, "start", 310450, attachments[6].id, activeTrip.loadedAt, timestamp);
    insertOdometer.run(entityId("odo"), organizationId, reviewTrip.id, rigs[2].tractor.id, drivers[2].id, "start", 180200, attachments[8].id, reviewTrip.loadedAt, timestamp);
    insertOdometer.run(entityId("odo"), organizationId, reviewTrip.id, rigs[2].tractor.id, drivers[2].id, "end", 181480, attachments[9].id, reviewTrip.unloadedAt, timestamp);

    const insertExpense = databaseConnection.prepare(`
      INSERT INTO expenses(
        id, organization_id, trip_id, driver_id, rig_id, tractor_id, trailer_id,
        amount_kopecks, category, payment_method, payment_source, supplier,
        description, location_text, receipt_attachment_id, status,
        risk_flags_json, client_mutation_id, created_by, reviewed_by,
        reviewed_at, review_comment, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)
    `);
    const addExpense = ({ trip, amount, category, source, supplier, description, location, attachment, status, reviewComment = "" }) => {
      const reviewed = ["confirmed", "rejected", "needs_explanation"].includes(status);
      insertExpense.run(
        entityId("exp"), organizationId, trip.id, trip.rig.driver.id, trip.rig.id,
        trip.rig.tractor.id, trip.rig.trailer.id, amount, category,
        source === "company_fuel_card" ? "fuel_card" : "card", source,
        supplier, description, location, attachment.id, status, entityId("mut"),
        trip.rig.driver.id, reviewed ? officeUser.id : null,
        reviewed ? timestamp : null, reviewComment, timestamp, timestamp
      );
    };
    addExpense({ trip: confirmedTrip, amount: 14_250_000, category: "Топливо", source: "company_fuel_card", supplier: "Газпромнефть", description: "Дизельное топливо", location: "М-7", attachment: attachments[3], status: "confirmed" });
    addExpense({ trip: confirmedTrip, amount: 2_480_000, category: "Платная дорога", source: "company_card", supplier: "Автодор", description: "Оплата участка трассы", location: "ЦКАД", attachment: attachments[4], status: "confirmed" });
    addExpense({ trip: confirmedTrip, amount: 1_650_000, category: "Гостиница", source: "driver_personal", supplier: "Отель Транзит", description: "Ночёвка из-за ожидания разгрузки", location: "Казань", attachment: attachments[5], status: "confirmed" });
    addExpense({ trip: activeTrip, amount: 890_000, category: "Запчасти", source: "driver_advance", supplier: "АвтоДеталь", description: "Ремень и крепёж", location: "Киров", attachment: attachments[7], status: "pending_review" });
    addExpense({ trip: reviewTrip, amount: 3_200_000, category: "Ремонт", source: "driver_personal", supplier: "Грузовой сервис", description: "Ремонт пневмосистемы", location: "Сызрань", attachment: attachments[10], status: "needs_explanation", reviewComment: "Приложите заказ-наряд или поясните состав работ" });

    databaseConnection.prepare(`
      INSERT INTO trip_rate_adjustments(
        id, organization_id, trip_id, adjustment_type, amount_kopecks,
        reason, created_by, created_at
      ) VALUES (?, ?, ?, 'penalty', ?, ?, ?, ?)
    `).run(entityId("adj"), organizationId, confirmedTrip.id, -1_000_000, "Штраф за задержку на сутки", officeUser.id, timestamp);
    const paymentId = entityId("pay");
    databaseConnection.prepare(`
      INSERT INTO incoming_payments(
        id, organization_id, customer_id, amount_kopecks, payment_type,
        payment_method, received_at, comment, created_by, created_at
      ) VALUES (?, ?, ?, ?, 'partial', 'bank', ?, ?, ?, ?)
    `).run(paymentId, organizationId, confirmedTrip.customer.id, 40_000_000, daysFromNow(-8), "Частичная оплата рейса", officeUser.id, timestamp);
    databaseConnection.prepare(`
      INSERT INTO payment_allocations(
        id, organization_id, payment_id, trip_id, amount_kopecks, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entityId("pal"), organizationId, paymentId, confirmedTrip.id, 40_000_000, officeUser.id, timestamp);

    const insertRecurringCost = databaseConnection.prepare(`
      INSERT INTO recurring_costs(
        id, organization_id, subject_type, subject_id, category,
        total_amount_kopecks, allocation_mode, allocation_months,
        valid_from, comment, created_by, created_at
      ) VALUES (?, ?, 'rig', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    rigs.forEach((rig, index) => insertRecurringCost.run(
      entityId("rco"), organizationId, rig.id, "Лизинг сцепки",
      (220_000 - index * 10_000) * 100, "monthly", 1,
      monthStart(daysFromNow(-120)), "Ежемесячный платёж", officeUser.id, timestamp
    ));
    insertRecurringCost.run(
      entityId("rco"), organizationId, rigs[0].id, "Страховка",
      120_000 * 100, "equal_months", 12,
      monthStart(daysFromNow(-120)), "Годовой полис, распределён на 12 месяцев", officeUser.id, timestamp
    );

    databaseConnection.prepare(`
      INSERT INTO driver_accruals(
        id, organization_id, driver_id, trip_id, accrual_type, balance_category,
        balance_effect_kopecks, quantity_units, unit_rate_kopecks,
        period_from, period_to, comment, source_type, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trip_confirmation', ?, ?)
    `).run(
      entityId("acc"), organizationId, drivers[0].id, confirmedTrip.id,
      "salary", "salary", 1_620_000, 1350, 1200,
      dateOnly(confirmedTrip.loadedAt), dateOnly(confirmedTrip.unloadedAt),
      "Пробег 1350 км", officeUser.id, confirmedTrip.confirmedAt
    );
    databaseConnection.prepare(`
      INSERT INTO driver_accruals(
        id, organization_id, driver_id, trip_id, accrual_type, balance_category,
        balance_effect_kopecks, quantity_units, unit_rate_kopecks,
        period_from, period_to, comment, source_type, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trip_confirmation', ?, ?)
    `).run(
      entityId("acc"), organizationId, drivers[0].id, confirmedTrip.id,
      "daily", "daily", 900_000, 6, 150_000,
      dateOnly(confirmedTrip.loadedAt), dateOnly(confirmedTrip.unloadedAt),
      "Суточные за 6 дней", officeUser.id, confirmedTrip.confirmedAt
    );
    const transferId = entityId("dtr");
    databaseConnection.prepare(`
      INSERT INTO driver_transfers(
        id, organization_id, driver_id, direction, amount_kopecks,
        payment_method, occurred_at, comment, client_mutation_id, created_by, created_at
      ) VALUES (?, ?, ?, 'company_to_driver', ?, 'card_transfer', ?, ?, ?, ?, ?)
    `).run(
      transferId, organizationId, drivers[0].id, 4_500_000, daysFromNow(-9),
      "Зарплата, суточные и аванс одним переводом", entityId("mut"), officeUser.id, timestamp
    );
    const insertAllocation = databaseConnection.prepare(`
      INSERT INTO driver_transfer_allocations(
        id, organization_id, transfer_id, driver_id, trip_id,
        allocation_type, amount_kopecks, coverage_through, comment, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
    `);
    insertAllocation.run(entityId("dal"), organizationId, transferId, drivers[0].id, confirmedTrip.id, "salary", 1_000_000, null, officeUser.id, timestamp);
    insertAllocation.run(entityId("dal"), organizationId, transferId, drivers[0].id, confirmedTrip.id, "daily", 500_000, dateOnly(daysFromNow(-13)), officeUser.id, timestamp);
    insertAllocation.run(entityId("dal"), organizationId, transferId, drivers[0].id, assignedTrip.id, "expense_advance", 3_000_000, null, officeUser.id, timestamp);

    databaseConnection.prepare(`
      INSERT INTO company_expenses(
        id, organization_id, scope_type, rig_id, amount_kopecks, category,
        payment_method, occurred_at, description, client_mutation_id,
        created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityId("cex"), organizationId, "rig", rigs[0].id, 8_500_000,
      "Шины", "company_card", daysFromNow(-6), "Комплект шин на ведущую ось",
      entityId("mut"), officeUser.id, timestamp
    );
    databaseConnection.prepare(`
      INSERT INTO company_expenses(
        id, organization_id, scope_type, rig_id, amount_kopecks, category,
        payment_method, occurred_at, description, client_mutation_id,
        created_by, created_at
      ) VALUES (?, ?, 'company', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityId("cex"), organizationId, 600_000, "Связь и программы",
      "bank", daysFromNow(-5), "Мобильная связь и сервисы офиса",
      entityId("mut"), officeUser.id, timestamp
    );

    const insertNotification = databaseConnection.prepare(`
      INSERT INTO notifications(
        id, organization_id, recipient_user_id, notification_type,
        title, message, entity_type, entity_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertNotification.run(entityId("ntf"), organizationId, drivers[0].id, "trip_assigned", "Назначен новый рейс", `${assignedTrip.loadingAddress} → ${assignedTrip.unloadingAddress}`, "trip", assignedTrip.id, timestamp);
    insertNotification.run(entityId("ntf"), organizationId, drivers[0].id, "driver_payment", "Учтён новый перевод", "45 000 ₽ · зарплата, суточные, аванс на расходы", "driver_transfer", transferId, timestamp);
    insertNotification.run(entityId("ntf"), organizationId, drivers[2].id, "expense_explanation_requested", "Офис просит пояснить расход", "Ремонт · приложите заказ-наряд или поясните состав работ", "trip", reviewTrip.id, timestamp);

    audit(databaseConnection, {
      organizationId,
      actorUserId: officeUser.id,
      entityType: "demo_data",
      entityId: organizationId,
      action: "seeded",
      after: { drivers: drivers.length, rigs: rigs.length, trips: trips.length }
    });
  });
}

function upgradeExistingDemo(databaseConnection, officeUser) {
  const assignedTrip = databaseConnection.prepare(`
    SELECT id FROM trips
    WHERE organization_id = ? AND number = 'ANB-0265'
  `).get(officeUser.organization_id);
  if (!assignedTrip) return;
  const existingStop = databaseConnection.prepare(`
    SELECT 1 AS exists_flag FROM trip_stops WHERE trip_id = ? LIMIT 1
  `).get(assignedTrip.id);
  if (existingStop) return;
  databaseConnection.prepare(`
    INSERT INTO trip_stops(
      id, organization_id, trip_id, stop_order, stop_type,
      address, is_approximate, notes, created_at
    ) VALUES (?, ?, ?, 1, 'unloading', ?, 0, ?, ?)
  `).run(
    entityId("stp"), officeUser.organization_id, assignedTrip.id,
    "Вологда", "Промежуточная выгрузка одной позиции", nowIso()
  );
}

function ensureDemoReviewTimeline(databaseConnection, organizationId) {
  databaseConnection.prepare(`
    INSERT OR IGNORE INTO expense_review_events(
      id, organization_id, expense_id, reviewer_id,
      review_status, comment, created_at
    )
    SELECT
      'erv_demo_' || e.id,
      e.organization_id,
      e.id,
      e.reviewed_by,
      e.status,
      COALESCE(e.review_comment, ''),
      e.reviewed_at
    FROM expenses e
    WHERE e.organization_id = ?
      AND e.reviewed_by IS NOT NULL
      AND e.reviewed_at IS NOT NULL
      AND e.status IN ('confirmed', 'rejected', 'needs_explanation', 'suspicious')
      AND NOT EXISTS (
        SELECT 1 FROM expense_review_events re WHERE re.expense_id = e.id
      )
  `).run(organizationId);
}

function demoTrip({
  number,
  customer,
  rig,
  loadingAddress,
  unloadingAddress,
  plannedLoadingDate,
  loadedAt = null,
  unloadedAt = null,
  confirmedAt = null,
  status,
  rateKopecks,
  cargo,
  instructions
}) {
  return {
    id: entityId("trp"), number, customer, rig, loadingAddress, unloadingAddress,
    plannedLoadingDate, loadedAt, unloadedAt, confirmedAt, status,
    rateKopecks, cargo, instructions
  };
}

function demoAttachment(organizationId, createdBy, kind, originalName, sourceName) {
  const id = entityId("att");
  const sourcePath = resolve(projectDirectory, sourceName);
  const buffer = readFileSync(sourcePath);
  const organizationDirectory = resolve(demoUploadsDirectory, organizationId);
  mkdirSync(organizationDirectory, { recursive: true });
  const storagePath = resolve(organizationDirectory, `${id}.png`);
  copyFileSync(sourcePath, storagePath);
  return {
    id,
    kind,
    storagePath,
    originalName,
    mimeType: "image/png",
    sizeBytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    createdBy
  };
}

function daysFromNow(days, hour = 12) {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function dateOnly(value) {
  return String(value).slice(0, 10);
}

function monthStart(value) {
  return `${String(value).slice(0, 7)}-01`;
}
