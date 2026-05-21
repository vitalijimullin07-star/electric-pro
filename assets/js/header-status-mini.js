(function () {
  const FILE = "assets/js/header-status-mini.js";

  let currentSub = null;
  let currentAi = null;
  let boundUid = null;
  let unsubSub = null;
  let unsubAi = null;

  function money(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n) + "₽";
  }

  function toDate(value) {
    try {
      if (!value) return null;
      if (value.toDate) return value.toDate();
      if (typeof value === "string") return new Date(value);
      if (typeof value === "number") return new Date(value);
      return null;
    } catch {
      return null;
    }
  }

  function daysLeft(date) {
    if (!date) return null;
    return Math.ceil((date.getTime() - Date.now()) / 86400000);
  }

  function planName(planId) {
    if (planId === "pro_ai") return "С ИИ";
    if (planId === "basic") return "Базовая";
    return "Нет подписки";
  }

  function ensureTopStatus() {
    let line = document.getElementById("epTopStatusLine");
    if (line) return line;

    line = document.createElement("div");
    line.id = "epTopStatusLine";
    line.className = "ep-top-status-line";
    line.innerHTML = `
      <div class="ep-top-status-left">Подписка: проверка...</div>
      <div class="ep-top-status-right">ИИ: —</div>
    `;

    const app =
      document.getElementById("appShell") ||
      document.querySelector(".app-shell") ||
      document.querySelector("main") ||
      document.body;

    app.prepend(line);

    document.body.classList.add("has-ep-top-status-line");

    return line;
  }

  function render() {
    const line = ensureTopStatus();
    if (!line) return;

    const left = line.querySelector(".ep-top-status-left");
    const right = line.querySelector(".ep-top-status-right");

    const sub = currentSub || {};
    const ai = currentAi || {};

    const planId = sub.planId || "none";
    const status = sub.status || "none";
    const expiresAt = toDate(sub.expiresAt);
    const leftDays = daysLeft(expiresAt);

    let statusClass = "none";
    let subText = "Нет подписки";

    if ((status === "active" || status === "trial") && leftDays !== null && leftDays >= 0) {
      subText = status === "trial"
        ? `${planName(planId)} · пробный · ${leftDays}д`
        : `${planName(planId)} · ${leftDays}д`;

      statusClass = planId === "pro_ai" ? "pro" : "basic";
      if (status === "trial") statusClass = "trial";
    }

    const mode = ai.accessMode || "disabled";
    const balance = Number(ai.balanceRub || 0);

    let aiText = `ИИ ${money(balance)}`;

    if (mode === "own_api") {
      aiText = "API мастера";
    }

    if (mode === "disabled") {
      aiText = "ИИ выкл.";
    }

    left.textContent = subText;
    right.textContent = aiText;
    line.dataset.status = statusClass;
    line.dataset.ai = mode;
  }

  async function bind(uid) {
    if (!uid || boundUid === uid) {
      render();
      return;
    }

    boundUid = uid;

    try {
      if (unsubSub) unsubSub();
      if (unsubAi) unsubAi();

      if (!window.ServerAPI?.isReady?.()) {
        await window.ServerAPI.initFirebase();
      }

      const db = window.ServerAPI.db();
      if (!db) return;

      unsubSub = db.collection("user_subscriptions").doc(uid).onSnapshot(
        snap => {
          currentSub = snap.exists ? snap.data() : null;
          render();
        },
        error => {
          window.Diagnostics?.error?.({
            file: FILE,
            module: "HeaderStatusMini",
            functionName: "bindSubscription()",
            place: "user_subscriptions/" + uid,
            code: error.code || "top-status-subscription-error",
            message: error.message
          });
          render();
        }
      );

      unsubAi = db.collection("ai_accounts").doc(uid).onSnapshot(
        snap => {
          currentAi = snap.exists ? snap.data() : null;
          render();
        },
        error => {
          window.Diagnostics?.error?.({
            file: FILE,
            module: "HeaderStatusMini",
            functionName: "bindAi()",
            place: "ai_accounts/" + uid,
            code: error.code || "top-status-ai-error",
            message: error.message
          });
          render();
        }
      );
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "HeaderStatusMini",
        functionName: "bind()",
        place: "top status line",
        code: error.code || "top-status-error",
        message: error.message
      });
    }
  }

  function init() {
    ensureTopStatus();
    render();

    const timer = setInterval(() => {
      const user = window.Auth?.getUser?.();
      if (user?.uid) bind(user.uid);
    }, 1000);

    setTimeout(() => clearInterval(timer), 30000);
  }

  window.HeaderStatusMini = { init, bind, render };

  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(init, 500);
  });
})();
