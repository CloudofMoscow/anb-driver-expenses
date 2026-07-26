import { api, showToast } from "./api-client.js";

const form = document.querySelector("#loginForm");
const button = document.querySelector("#loginButton");
const toast = document.querySelector("#toast");

checkExistingSession();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = "Входим...";
  try {
    if (localStorage.getItem("anb-clear-session-on-connect-v1")) {
      await api("/api/auth/logout", { method: "POST" });
      localStorage.removeItem("anb-clear-session-on-connect-v1");
    }
    const { user } = await api("/api/auth/login", {
      method: "POST",
      body: {
        login: form.login.value,
        password: form.password.value
      }
    });
    localStorage.removeItem("anb-clear-session-on-connect-v1");
    location.replace(user.role === "office" ? "/office.html" : "/driver.html");
  } catch (error) {
    showToast(toast, error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Войти";
  }
});

async function checkExistingSession() {
  if (localStorage.getItem("anb-clear-session-on-connect-v1")) {
    try {
      await api("/api/auth/logout", { method: "POST" });
      localStorage.removeItem("anb-clear-session-on-connect-v1");
    } catch {
      // Без сети остаёмся на экране входа и повторим отзыв сессии позже.
    }
    return;
  }
  try {
    const { user } = await api("/api/me");
    location.replace(user.role === "office" ? "/office.html" : "/driver.html");
  } catch (error) {
    // При холодном запуске установленной PWA водитель должен попасть к
    // сохранённым рейсам и офлайн-очереди даже без сети.
    if (!error.status && rememberedDriver()) location.replace("/driver.html");
  }
}

function rememberedDriver() {
  try {
    const user = JSON.parse(localStorage.getItem("anb-driver-last-user-v1"));
    return user?.id && user?.role === "driver" ? user : null;
  } catch {
    return null;
  }
}
