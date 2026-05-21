(function () {
  const FILE = "assets/js/admin-subscription-v20-2-fix.js";

  function logOk(message) {
    window.Diagnostics?.ok?.({
      file: FILE,
      module: "AdminSubscriptionV202Fix",
      functionName: "runtime",
      place: "admin subscription",
      code: "admin-subscription-v20-2",
      message
    });
  }

  function logError(error, place = "admin subscription") {
    window.Diagnostics?.error?.({
      file: FILE,
      module: "AdminSubscriptionV202Fix",
      functionName: "runtime",
      place,
      code: error.code || "admin-subscription-v20-2-error",
      message: error.message || String(error)
    });
  }

  function isAdminPage() {
    const text = document.body?.textContent || "";
    return text.includes("Админ-панель") || text.includes("Управление подпиской") || !!document.querySelector("#adminV15Content");
  }

  function selectedUid() {
    return document.getElementById("adminV15MasterSelect")?.value ||
      document.querySelector("[data-selected-uid]")?.dataset?.selectedUid ||
      "";
  }

  async function callFunction(name, payload = {}) {
    if (!window.ServerAPI?.isReady?.()) await window.ServerAPI.initFirebase();
    if (!window.firebase?.functions) throw new Error("Firebase Functions SDK не подключён.");
    const fn = firebase.app().functions("europe-west1").httpsCallable(name);
    const result = await fn(payload);
    return result.data || {};
  }

  function setActiveAdminSection(sectionName) {
    document.querySelectorAll("[data-admin-v15-section]").forEach(btn => {
      const active = btn.dataset.adminV15Section === sectionName;
      btn.classList.toggle("is-selected", active);
      btn.classList.toggle("admin-v20-2-active-section", active);
      btn.classList.toggle("admin-v20-2-inactive-section", !active);
    });
  }

  function bindSectionButtons() {
    document.addEventListener("click", event => {
      const btn = event.target.closest("[data-admin-v15-section]");
      if (!btn) return;

      const section = btn.dataset.adminV15Section || "";
      setActiveAdminSection(section);
    }, true);
  }

  function findSubscriptionCardRoot() {
    const candidates = Array.from(document.querySelectorAll(".card, section, article, .panel, div"));
    return candidates.find(el => {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      return t.includes("Подписка") &&
        t.includes("ИИ / Базовая") &&
        t.includes("Сохранить подписку") &&
        t.includes("Срок подписки");
    });
  }

  function findAiCardRoot() {
    const candidates = Array.from(document.querySelectorAll(".card, section, article, .panel, div"));
    return candidates.find(el => {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      return t.includes("ИИ") &&
        t.includes("API клиента") &&
        t.includes("API сервера") &&
        t.includes("Сохранить ИИ");
    });
  }

  function makeButton(text, cls, attr) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = cls;
    btn.textContent = text;
    Object.entries(attr || {}).forEach(([k, v]) => btn.setAttribute(k, v));
    return btn;
  }

  function insertCancelSubscriptionButton() {
    const root = findSubscriptionCardRoot();
    if (!root) return false;

    if (root.querySelector("[data-v20-2-cancel-subscription]")) return true;

    const saveBtn = Array.from(root.querySelectorAll("button")).find(btn =>
      (btn.textContent || "").includes("Сохранить подписку")
    );

    const cancelBtn = makeButton(
      "Отменить подписку",
      "btn btn-danger admin-v20-2-cancel-btn ep-clickable",
      { "data-v20-2-cancel-subscription": "1" }
    );

    if (saveBtn?.parentNode) {
      saveBtn.parentNode.insertBefore(cancelBtn, saveBtn.nextSibling);
    } else {
      root.appendChild(cancelBtn);
    }

    return true;
  }

  function insertAiDisableButton() {
    const root = findAiCardRoot();
    if (!root) return false;

    if (root.querySelector("[data-v20-2-disable-ai]")) return true;

    const saveBtn = Array.from(root.querySelectorAll("button")).find(btn =>
      (btn.textContent || "").includes("Сохранить ИИ")
    );

    const disableBtn = makeButton(
      "Отключить ИИ-доступ",
      "btn btn-ghost admin-v20-2-disable-ai-btn ep-clickable",
      { "data-v20-2-disable-ai": "1" }
    );

    if (saveBtn?.parentNode) {
      saveBtn.parentNode.insertBefore(disableBtn, saveBtn.nextSibling);
    } else {
      root.appendChild(disableBtn);
    }

    return true;
  }

  async function cancelSubscription() {
    const uid = selectedUid();

    if (!uid) {
      alert("Сначала выбери мастера.");
      return;
    }

    if (!confirm("Отменить подписку выбранному мастеру?")) return;

    try {
      await callFunction("cancelSubscription", { uid });
      window.SoundAPI?.success?.();
      alert("Подписка отменена.");

      if (window.AdminAPI?.openUserCard) {
        setTimeout(() => window.AdminAPI.openUserCard(uid), 400);
      }

      if (window.AdminSubscriptionUI?.refresh) {
        setTimeout(() => window.AdminSubscriptionUI.refresh(), 400);
      }

      logOk("Подписка отменена для " + uid);
    } catch (error) {
      logError(error, "cancel subscription");
      alert("Ошибка отмены подписки: " + (error.message || error));
    }
  }

  async function disableAiAccess() {
    const uid = selectedUid();

    if (!uid) {
      alert("Сначала выбери мастера.");
      return;
    }

    if (!confirm("Отключить ИИ-доступ выбранному мастеру? Баланс не списывается, меняется только режим.")) return;

    try {
      // В разных версиях функция называлась setAiAccessMode или setAiMode.
      try {
        await callFunction("setAiAccessMode", { uid, mode: "disabled", accessMode: "disabled" });
      } catch (firstError) {
        await callFunction("setAiMode", { uid, mode: "disabled", accessMode: "disabled" });
      }

      window.SoundAPI?.success?.();
      alert("ИИ-доступ отключён.");

      if (window.AdminAPI?.openUserCard) {
        setTimeout(() => window.AdminAPI.openUserCard(uid), 400);
      }

      logOk("ИИ-доступ отключён для " + uid);
    } catch (error) {
      logError(error, "disable ai access");
      alert("Ошибка отключения ИИ: " + (error.message || error));
    }
  }

  function bindActions() {
    document.addEventListener("click", event => {
      if (event.target.closest("[data-v20-2-cancel-subscription]")) {
        event.preventDefault();
        event.stopPropagation();
        cancelSubscription();
        return;
      }

      if (event.target.closest("[data-v20-2-disable-ai]")) {
        event.preventDefault();
        event.stopPropagation();
        disableAiAccess();
        return;
      }
    }, true);
  }

  function improveSegmentActiveState() {
    // Подсветка выбранных тумблеров внутри карточки, без изменения логики.
    document.querySelectorAll(".admin-card button, .admin-v15-card button, .card button, section button").forEach(btn => {
      const text = (btn.textContent || "").trim();

      if (["ИИ", "Базовая", "Тест 2 дня", "30", "90", "180", "360", "API клиента", "API сервера"].includes(text)) {
        btn.classList.add("admin-v20-2-choice-btn");
      }

      const aria = btn.getAttribute("aria-pressed");
      if (aria === "true" || btn.classList.contains("active") || btn.classList.contains("is-active") || btn.classList.contains("selected") || btn.classList.contains("is-selected")) {
        btn.classList.add("admin-v20-2-choice-active");
      }
    });
  }

  function runOnce() {
    if (!isAdminPage()) return;

    insertCancelSubscriptionButton();
    insertAiDisableButton();
    improveSegmentActiveState();

    const activeBtn = document.querySelector("[data-admin-v15-section].is-selected");
    if (activeBtn?.dataset?.adminV15Section) {
      setActiveAdminSection(activeBtn.dataset.adminV15Section);
    }
  }

  function init() {
    bindSectionButtons();
    bindActions();

    setTimeout(runOnce, 600);
    setTimeout(runOnce, 1600);
    setTimeout(runOnce, 3200);

    document.addEventListener("click", event => {
      const t = event.target?.textContent || "";
      if (
        t.includes("Управление подпиской") ||
        t.includes("Просмотр") ||
        t.includes("Сохранить") ||
        t.includes("ИИ") ||
        t.includes("Базовая")
      ) {
        setTimeout(runOnce, 500);
      }
    });

    document.addEventListener("change", event => {
      if (event.target?.id === "adminV15MasterSelect") {
        setTimeout(runOnce, 800);
      }
    });

    window.addEventListener("hashchange", () => setTimeout(runOnce, 800));

    window.AdminSubscriptionV202Fix = {
      runOnce,
      cancelSubscription,
      disableAiAccess
    };

    logOk("V20.2 fix готов.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
