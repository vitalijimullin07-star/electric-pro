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
    return "Нет";
  }

  function userName() {
    const user = window.Auth?.getUser?.();
    return user?.displayName || user?.email || "Мастер";
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
    let wrap = document.getElementById("epHeaderStatusMini");
    if (wrap) return wrap;

    const header = findHeader();
    if (!header) return null;

    header.classList.add("ep-header-10mm-status");

    wrap = document.createElement("div");
    wrap.id = "epHeaderStatusMini";
    wrap.className = "ep-header-status-mini-v2";
    wrap.innerHTML = `
      <div class="ep-header-user-info">
        <span class="ep-header-role">Электрик</span>
        <span class="ep-header-name">Мастер</span>
      </div>
      <div class="ep-header-status-gap"></div>
      <div class="ep-header-sub-info" data-status="none">
        <span class="ep-header-sub-text">Подписка</span>
        <span class="ep-header-ai-text">ИИ</span>
      </div>
    `;

    header.appendChild(wrap);
    return wrap;
  }

  function render() {
    const wrap = ensureMini();
    if (!wrap) return;

    const nameEl = wrap.querySelector(".ep-header-name");
    const subBox = wrap.querySelector(".ep-header-sub-info");
    const subTextEl = wrap.querySelector(".ep-header-sub-text");
    const aiTextEl = wrap.querySelector(".ep-header-ai-text");

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
    if (mode === "own_api") aiText = "API мастера";
    if (mode === "disabled") aiText = "ИИ выкл.";

    nameEl.textContent = userName();
    subTextEl.textContent = subText;
    aiTextEl.textContent = aiText;
    subBox.dataset.status = cls;
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
