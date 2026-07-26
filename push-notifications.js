export async function initializePushNotifications({
  button,
  api,
  showMessage = () => {}
}) {
  if (!button) return { supported: false, enabled: false };

  const supported = window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
  if (!supported) {
    button.hidden = true;
    return { supported: false, enabled: false };
  }

  let config;
  try {
    config = await api("/api/push/config");
  } catch {
    button.hidden = true;
    return { supported: true, enabled: false };
  }
  if (!config.enabled || !config.publicKey) {
    button.hidden = true;
    return { supported: true, enabled: false };
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  button.hidden = false;

  if (Notification.permission === "denied") {
    renderButton(button, "blocked");
    return { supported: true, enabled: false, blocked: true };
  }

  if (subscription) {
    try {
      await api("/api/push/subscriptions", {
        method: "POST",
        body: { subscription: subscription.toJSON() }
      });
      renderButton(button, "enabled");
    } catch {
      renderButton(button, "retry");
    }
  } else {
    renderButton(button, "available");
  }

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    if (Notification.permission === "denied") {
      showMessage(
        "Уведомления заблокированы. Разрешите их для ANB в настройках браузера или приложения, затем вернитесь сюда.",
        true
      );
      return;
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api("/api/push/subscriptions/remove", {
          method: "POST",
          body: { endpoint: subscription.endpoint }
        });
        await subscription.unsubscribe();
        subscription = null;
        renderButton(button, "available");
        showMessage("Push-уведомления выключены на этом устройстве.");
        return;
      }

      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if (permission !== "granted") {
        renderButton(button, permission === "denied" ? "blocked" : "available");
        showMessage(
          permission === "denied"
            ? "Уведомления заблокированы в настройках устройства."
            : "Разрешение на уведомления не выдано.",
          permission === "denied"
        );
        return;
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey)
      });
      await api("/api/push/subscriptions", {
        method: "POST",
        body: { subscription: subscription.toJSON() }
      });
      renderButton(button, "enabled");
      showMessage("Push-уведомления включены.");
    } catch (error) {
      renderButton(button, "retry");
      const iosHint = isIos() && !isStandalone()
        ? " На iPhone сначала добавьте ANB на экран «Домой» и откройте его как приложение."
        : "";
      showMessage(`${error.message || "Не удалось включить уведомления."}${iosHint}`, true);
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });

  return {
    supported: true,
    enabled: Boolean(subscription)
  };
}

function renderButton(button, state) {
  const labels = {
    available: "Включить уведомления",
    enabled: "Уведомления включены",
    blocked: "Уведомления заблокированы",
    retry: "Настроить уведомления"
  };
  button.dataset.pushState = state;
  button.textContent = labels[state] || labels.available;
  button.disabled = false;
  button.removeAttribute("aria-busy");
  button.title = state === "enabled"
    ? "Нажмите, чтобы выключить push на этом устройстве"
    : state === "blocked"
      ? "Нажмите, чтобы узнать, как снова разрешить уведомления"
      : "";
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}
