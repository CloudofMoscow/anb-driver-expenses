// This identifies the loaded UI, not the version installed on another device.
export const APP_VERSION = "87";

export function updateFileSelectionLabels(root = document) {
  root.querySelectorAll("[data-file-selection-for]").forEach((label) => {
    const input = root.querySelector(`#${label.dataset.fileSelectionFor}`);
    const file = input?.files?.[0];
    const text = file ? `Выбран файл: ${file.name}` : "Фото или PDF, до 12 МБ. Оригинал сохранится вместе с расходом.";
    if (label.textContent !== text) label.textContent = text;
  });
}

export function initializeAppShell(root = document) {
  root.querySelectorAll("[data-app-version]").forEach((node) => {
    node.textContent = `Версия интерфейса v${APP_VERSION}`;
  });
  updateFileSelectionLabels(root);
  root.addEventListener("change", (event) => {
    if (event.target.matches('input[type="file"]')) updateFileSelectionLabels(root);
  });
  root.addEventListener("reset", () => queueMicrotask(() => updateFileSelectionLabels(root)));
}
