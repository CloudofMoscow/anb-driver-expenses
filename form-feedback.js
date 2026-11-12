import { rublesToKopecks } from "./api-client.js?v=82";

function fieldMessage(control) {
  if (!control.validity.valid) return control.validity.valueMissing
    ? control.dataset.money ? "Укажите сумму" : control.type === "file" ? "Выберите обязательный файл" : "Заполните обязательное поле"
    : control.validationMessage;
  if (control.dataset.money && control.value.trim()) {
    try { rublesToKopecks(control.dataset.money === "signed" ? control.value.trim().replace(/^[+-]/, "") : control.value); }
    catch { return "Укажите сумму с точностью до копеек, например 12,34"; }
  }
  if (control.type === "file" && control.files[0]?.size > 12 * 1024 * 1024) return "Файл слишком большой. Максимальный размер — 12 МБ";
  return "";
}

export function setFieldError(control, message) {
  const id = `${control.id}Error`;
  let error = document.getElementById(id);
  if (!error && message) {
    error = document.createElement("small");
    error.id = id;
    error.className = "field-error";
    control.insertAdjacentElement("afterend", error);
  }
  if (error) { error.textContent = message ? `Ошибка: ${message}` : ""; error.hidden = !message; }
  const describedBy = new Set((control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  if (message) { control.setAttribute("aria-invalid", "true"); describedBy.add(id); }
  else { control.removeAttribute("aria-invalid"); describedBy.delete(id); }
  if (describedBy.size) control.setAttribute("aria-describedby", [...describedBy].join(" "));
  else control.removeAttribute("aria-describedby");
}

function focusErrors(form, focus = true) {
  const invalid = [...form.querySelectorAll('[aria-invalid="true"]')].filter((control) => !control.disabled && control.getClientRects().length);
  form.querySelector(".form-error-summary")?.remove();
  if (invalid.length <= 1) { if (focus) invalid[0]?.focus(); return; }
  const summary = document.createElement("div");
  summary.className = "form-error-summary";
  summary.tabIndex = -1;
  const heading = document.createElement("strong");
  heading.textContent = "Проверьте поля";
  summary.append(heading);
  const list = document.createElement("ul");
  for (const control of invalid) {
    const item = document.createElement("li"), link = document.createElement("a");
    link.href = `#${control.id}`;
    link.textContent = control.labels?.[0]?.querySelector("span")?.textContent || control.name || control.id;
    link.addEventListener("click", (event) => { event.preventDefault(); control.focus(); });
    item.append(link); list.append(item);
  }
  summary.append(list); form.prepend(summary); if (focus) summary.focus();
}

export function validateForm(form) {
  if (!form) return true;
  let valid = true;
  for (const control of form.querySelectorAll("input, select, textarea")) {
    if (control.disabled || !control.getClientRects().length || !control.id) continue;
    const message = fieldMessage(control);
    setFieldError(control, message);
    if (message) valid = false;
  }
  if (!valid) focusErrors(form);
  else form.querySelector(".form-error-summary")?.remove();
  return valid;
}

export function showFormError(form, error) {
  if (!form) return;
  let message = form.querySelector("[data-form-error]");
  if (!message) {
    message = document.createElement("p");
    message.className = "form-error";
    message.dataset.formError = "";
    message.setAttribute("role", "alert");
    form.append(message);
  }
  message.textContent = `${error.message}. Проверьте данные и повторите отправку.`;
  message.hidden = false;
}

export function installFormFeedback(moneyControls) {
  const invalidTimers = new WeakMap();
  for (const [control, signed] of moneyControls) if (control) control.dataset.money = signed ? "signed" : "unsigned";
  document.addEventListener("invalid", (event) => {
    const control = event.target;
    if (!control.form || !control.id) return;
    setFieldError(control, fieldMessage(control));
    clearTimeout(invalidTimers.get(control.form));
    invalidTimers.set(control.form, setTimeout(() => focusErrors(control.form), 0));
  }, true);
  document.addEventListener("submit", (event) => {
    if (!validateForm(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    event.target.querySelectorAll("[data-form-error]").forEach((node) => { node.hidden = true; });
  }, true);
  for (const type of ["input", "change"]) document.addEventListener(type, (event) => {
    const control = event.target;
    if (control.getAttribute("aria-invalid") === "true") {
      setFieldError(control, fieldMessage(control));
      if (control.form) focusErrors(control.form, false);
    }
  });
  document.addEventListener("reset", (event) => {
    event.target.querySelectorAll('[aria-invalid="true"]').forEach((control) => setFieldError(control, ""));
    event.target.querySelectorAll(".form-error-summary").forEach((node) => node.remove());
    event.target.querySelectorAll("[data-form-error]").forEach((node) => { node.hidden = true; });
  }, true);
}
