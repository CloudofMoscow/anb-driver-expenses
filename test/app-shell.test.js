import assert from "node:assert/strict";
import test from "node:test";
import { initializeAppShell, updateFileSelectionLabels, APP_VERSION } from "../app-shell.js";

test("shell reports the loaded UI version and selected file without changing the original attachment", async () => {
  const file = { name: '<чек & копия>.pdf' };
  const input = { files: [file] };
  const label = { dataset: { fileSelectionFor: "receipt" }, textContent: "" };
  const version = { textContent: "" };
  const handlers = {};
  const root = {
    querySelectorAll: (selector) => selector === "[data-app-version]" ? [version] : [label],
    querySelector: () => input,
    addEventListener: (event, handler) => { handlers[event] = handler; }
  };
  initializeAppShell(root);
  assert.equal(version.textContent, `Версия интерфейса v${APP_VERSION}`);
  assert.equal(label.textContent, "Выбран файл: <чек & копия>.pdf");
  assert.equal(input.files[0], file);
  input.files = [];
  handlers.reset();
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.match(label.textContent, /Фото или PDF/);
  input.files = [file];
  updateFileSelectionLabels(root);
  assert.equal(label.textContent, "Выбран файл: <чек & копия>.pdf");
});
