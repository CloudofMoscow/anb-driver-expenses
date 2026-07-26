import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "./app.js";
import { bootstrapOrganization, openDatabase } from "./database.js";
import { createPushService } from "./push-service.js";
import { verifyPassword } from "./security.js";

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(serverDirectory, "..");
const localApplicationData = process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, "ANB Fleet Finance")
  : projectDirectory;
const dataDirectory = resolve(process.env.ANB_DATA_DIR || resolve(localApplicationData, "data"));
const uploadsDirectory = resolve(process.env.ANB_UPLOADS_DIR || resolve(dataDirectory, "uploads"));
const databasePath = resolve(process.env.ANB_DATABASE_PATH || resolve(dataDirectory, "anb.sqlite"));
const port = parsePort(process.env.ANB_PORT || "8787");
const host = process.env.ANB_HOST || "127.0.0.1";
const production = process.env.NODE_ENV === "production";
const trustProxy = process.env.ANB_TRUST_PROXY === "1";
const driverCompensationVisible = process.env.ANB_DRIVER_COMPENSATION_VISIBLE === "1";

if (trustProxy && !isLoopbackHost(host)) {
  throw new Error("ANB_TRUST_PROXY=1 is allowed only when ANB_HOST is a loopback address");
}

const database = openDatabase(databasePath);
const pushService = createPushService({
  database,
  subject: process.env.ANB_VAPID_SUBJECT || "mailto:push@anb.local",
  enabled: process.env.ANB_DISABLE_PUSH !== "1"
});

const bootstrapLogin = process.env.ANB_BOOTSTRAP_LOGIN || "";
const bootstrapPassword = process.env.ANB_BOOTSTRAP_PASSWORD || "";
if (bootstrapPassword === "anb-demo-2026" && process.env.ANB_DEMO_MODE !== "1") {
  throw new Error("Демонстрационный пароль запрещён для рабочего запуска. Задайте другой ANB_BOOTSTRAP_PASSWORD.");
}
const bootstrapResult = bootstrapOrganization(database, {
  organizationName: process.env.ANB_ORGANIZATION_NAME || "ANB Group",
  adminLogin: bootstrapLogin,
  adminPassword: bootstrapPassword,
  adminFullName: process.env.ANB_BOOTSTRAP_NAME || "Владелец ANB"
});

if (process.env.ANB_DEMO_MODE !== "1") {
  const knownDemoAccount = database.prepare("SELECT password_hash FROM users WHERE login = 'owner' AND is_active = 1 LIMIT 1").get();
  if (knownDemoAccount && await verifyPassword("anb-demo-2026", knownDemoAccount.password_hash)) {
    database.close();
    throw new Error("Обнаружен публичный демонстрационный пароль owner. Смените пароль или используйте отдельный npm run demo.");
  }
}

if (bootstrapResult && !production) {
  console.warn(`Создан первый сотрудник офиса: ${bootstrapLogin}`);
}

const application = createApplication({
  database,
  publicDirectory: projectDirectory,
  uploadsDirectory,
  secureCookies: production,
  trustProxy,
  driverCompensationVisible,
  pushService
});

const server = createServer(application);
server.headersTimeout = 30000;
server.requestTimeout = 10 * 60 * 1000;
server.keepAliveTimeout = 10000;
server.maxRequestsPerSocket = 100;
server.listen(port, host, () => {
  pushService.start();
  console.log(`ANB запущен: http://${host}:${port}`);
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    pushService.stop();
    server.close(() => {
      database.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}

function parsePort(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error("ANB_PORT должен быть числом от 1 до 65535");
  }
  return number;
}

function isLoopbackHost(value) {
  return ["127.0.0.1", "::1", "localhost"].includes(String(value).toLowerCase());
}
