const themeStorageKey = "anb-theme-v1";

function preferredTheme() {
  const saved = localStorage.getItem(themeStorageKey);
  if (saved === "dark" || saved === "light") return saved;
  return "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#111315" : "#ffffff"
  );
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.textContent = theme === "dark" ? "Светлая тема" : "Тёмная тема";
    button.setAttribute("aria-pressed", String(theme === "dark"));
  });
}

applyTheme(preferredTheme());

document.addEventListener("DOMContentLoaded", () => {
  applyTheme(preferredTheme());
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem(themeStorageKey, next);
      applyTheme(next);
    });
  });
});
