import { networkInterfaces } from "node:os";

process.env.ANB_HOST = "0.0.0.0";
process.env.ANB_PORT ||= "8788";

const port = process.env.ANB_PORT;
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((address) => address?.family === "IPv4" && !address.internal)
  .map((address) => address.address)
  .filter((address) => !address.startsWith("169.254."))
  .filter((address) => !address.startsWith("192.168.186."))
  .filter((address) => !address.startsWith("192.168.239."));

console.log("");
console.log("ANB: доступ с телефона");
console.log("1. Подключите телефон к той же Wi-Fi сети, что и ноутбук.");
console.log("2. Откройте на телефоне одну из ссылок:");
for (const address of addresses) console.log(`   http://${address}:${port}`);
console.log("3. Не закрывайте это окно, пока пользуетесь приложением.");
console.log("");

if (addresses.length === 0) {
  console.warn("Wi-Fi адрес не найден. Подключите ноутбук к сети и запустите файл ещё раз.");
}

await import("./demo.js");
