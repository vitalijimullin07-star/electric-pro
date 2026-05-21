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

  function findHeader() {
    return (
      document.querySelector(".topbar") ||
      document.querySelector(".app-topbar") ||
      document.querySelector(".app-header") ||
      document.querySelector("header") ||
      document.querySelector(".shell-top") ||
      null
    );
  }

  function ensureMini() {
    let mini = document.getElementById("epHeaderStatusMini");
    if (mini) return mini;

    const header = findHeader();
    if (!header) return null;

    header.classList.add("ep-header-with-mini-status");

    mini = document.createElement("div");
    mini.id = "epHeaderStatusMini";
    mini.className = "ep-header-status-mini";
    mini.textContent = "Подписка · проверка...";

    header.appendChild(mini);
    return mini;
  }

  function render() {
    const mini = ensureMini();
    if (!mini) return;

    const sub = currentSub || {};
    const ai = currentAi || {};

    const planId = sub.planId || "none";
    const status = sub.status || "none";
    const expiresAt = toDate(sub.expiresAt);
    const left = daysLeft(expiresAt);

    let subText = "Нет подписки";
    let cls = "none";

    if ((status === "active" || status === "trial") && left !== null && left >= 0) {
      subText = status === "trial"
        ? `${planName(planId)} · пробн. ${left}д`
        : `${planName(planId)} · ${left}д`;

      cls = planId === "pro_ai" ? "pro" : "basic";
      if (status === "trial") cls = "trial";
    }

    const mode = ai.accessMode || "disabled";
    const balance = Number(ai.balanceRub || 0);

    let aiText = `ИИ ${money(balance)}`;

    if (mode === "own_api") {
      aiText = "API мастера";
    } else if (mode === "disabled") {
      aiText = "ИИ выкл.";
    }

    mini.textContent = `${subText} · ${aiText}`;
    mini.dataset.status = cls;
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
            code: error.code || "header-subscription-error",
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
            code: error.code || "header-ai-error",
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
        place: "header mini status",
        code: error.code || "header-mini-error",
        message: error.message
      });
    }
  }

  function init() {
    ensureMini();
    render();

    const timer = setInterval(() => {
      const user = window.Auth?.getUser?.();
      if (user?.uid) bind(user.uid);
    }, 1200);

    setTimeout(() => clearInterval(timer), 30000);
  }

  window.HeaderStatusMini = { init, bind, render };

  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(init, 800);
  });
})();
