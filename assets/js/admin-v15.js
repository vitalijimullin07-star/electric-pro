(function () {
  const FILE = "assets/js/admin-v15.js";

  let users = [];
  let selectedUid = "";
  let selectedSection = "subscription";
  const state = { tariff: "pro_ai", days: 30, aiMode: "admin_api" };

  function esc(text) {
    return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  function isAdmin() {
    const u = window.Auth?.getUser?.();
    return !!u && (u.role === "admin" || u.profile?.role === "admin" || u.profile?.isAdmin === true || u.email === "vits0007@gmail.com");
  }

  async function db() {
    if (!isAdmin()) throw new Error("Доступ только для администратора.");
    if (!window.ServerAPI?.isReady?.()) await window.ServerAPI.initFirebase();
    const db = window.ServerAPI.db();
    if (!db) throw new Error("Firestore не готов.");
    return db;
  }

  async function callFunction(name, payload = {}) {
    if (!window.ServerAPI?.isReady?.()) await window.ServerAPI.initFirebase();
    if (!window.firebase?.functions) throw new Error("Firebase Functions SDK не подключён.");
    const fn = firebase.app().functions("europe-west1").httpsCallable(name);
    const result = await fn(payload);
    return result.data || {};
  }

  function money(value) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value || 0)) + " ₽";
  }

  function fmtDate(value) {
    try {
      if (!value) return "—";
      if (value.toDate) return value.toDate().toLocaleString("ru-RU");
      return new Date(value).toLocaleString("ru-RU");
    } catch {
      return "—";
    }
  }

  function setSelected(group, value) {
    document.querySelectorAll(`[data-v15-group="${group}"]`).forEach(btn => {
      btn.classList.toggle("is-selected", btn.dataset.v15Value === value);
    });
  }

  async function loadUsers() {
    const database = await db();
    const snap = await database.collection("users").get();
    users = [];
    snap.forEach(doc => users.push({ id: doc.id, data: doc.data() || {} }));
    users.sort((a, b) => String(a.data.email || "").localeCompare(String(b.data.email || "")));

    const select = document.getElementById("adminV15MasterSelect");
    if (!select) return;
    select.innerHTML = `<option value="">Выбери мастера</option>` + users.map(u => {
      const label = `${u.data.displayName || u.data.name || "Без имени"} · ${u.data.email || "без email"}`;
      return `<option value="${esc(u.id)}">${esc(label)}</option>`;
    }).join("");

    if (selectedUid) select.value = selectedUid;
  }

  function userById(uid) {
    return users.find(u => u.id === uid) || null;
  }

  async function getDoc(path) {
    const database = await db();
    const snap = await database.doc(path).get();
    return snap.exists ? snap.data() || {} : null;
  }

  async function listCollection(path, limit = 30) {
    const database = await db();
    const snap = await database.collection(path).limit(limit).get();
    const arr = [];
    snap.forEach(doc => arr.push({ id: doc.id, data: doc.data() || {} }));
    return arr;
  }

  function segmentButton(group, value, label, selected) {
    return `<button class="admin-v15-segment-btn ${selected ? "is-selected" : ""}" data-v15-group="${group}" data-v15-value="${esc(value)}">${esc(label)}</button>`;
  }

  function renderSubscription(user, sub, ai) {
    const profile = user?.data || {};
    const name = profile.displayName || profile.name || "Без имени";
    const email = profile.email || "без email";
    state.tariff = sub?.planId === "basic" ? "basic" : "pro_ai";
    state.days = Number(state.days || 30);
    state.aiMode = ai?.accessMode || "admin_api";
    const isOwnApi = state.aiMode === "own_api";

    return `
      <div class="admin-v15-client-card">
        <div class="admin-v15-client-top">
          <div>
            <h3>${esc(name)}</h3>
            <p>${esc(email)}</p>
            <p class="admin-v15-muted">UID: ${esc(selectedUid)}</p>
          </div>
          <div class="admin-v15-status-pill">${esc(sub?.status || "нет подписки")} · ${esc(sub?.planId || "none")}</div>
        </div>

        <div class="admin-v15-block">
          <div class="admin-v15-block-title"><b>Подписка</b><span>Выбери тариф и сохрани</span></div>
          <div class="admin-v15-segment">
            ${segmentButton("tariff", "pro_ai", "ИИ", state.tariff === "pro_ai")}
            ${segmentButton("tariff", "basic", "Базовая", state.tariff === "basic")}
            ${segmentButton("tariff", "trial2", "Тест 2 дня", false)}
          </div>
          <button class="btn btn-primary admin-v15-save ep-clickable" data-v15-action="save-tariff">Сохранить подписку</button>
        </div>

        <div class="admin-v15-block">
          <div class="admin-v15-block-title"><b>Срок подписки</b><span>30 / 90 / 180 / 360 дней</span></div>
          <div class="admin-v15-segment four">
            ${segmentButton("days", "30", "30", state.days === 30)}
            ${segmentButton("days", "90", "90", state.days === 90)}
            ${segmentButton("days", "180", "180", state.days === 180)}
            ${segmentButton("days", "360", "360", state.days === 360)}
          </div>
          <button class="btn btn-primary admin-v15-save ep-clickable" data-v15-action="save-days">Сохранить срок</button>
        </div>

        <div class="admin-v15-block">
          <div class="admin-v15-block-title"><b>ИИ</b><span>API клиента или API сервера</span></div>
          <div class="admin-v15-segment two">
            ${segmentButton("aiMode", "own_api", "API клиента", state.aiMode === "own_api")}
            ${segmentButton("aiMode", "admin_api", "API сервера", state.aiMode === "admin_api")}
          </div>
          <div class="admin-v15-balance ${isOwnApi ? "is-hidden" : ""}" id="adminV15BalanceBox">
            <label>Баланс ИИ</label>
            <input id="adminV15BalanceInput" type="number" min="0" step="1" value="${Number(ai?.balanceRub || 0)}" placeholder="Баланс, ₽">
          </div>
          <button class="btn btn-primary admin-v15-save ep-clickable" data-v15-action="save-ai">Сохранить ИИ / баланс</button>
          <div class="admin-v15-muted">Текущий баланс: ${money(ai?.balanceRub)} · режим: ${esc(ai?.accessMode || "disabled")}</div>
        </div>

        <div class="admin-v15-info">
          <button class="btn btn-ghost ep-clickable" data-v15-action="details-basic">Подробнее: Базовая</button>
          <button class="btn btn-ghost ep-clickable" data-v15-action="details-ai">Подробнее: С ИИ</button>
        </div>
      </div>
    `;
  }

  function renderList(title, items, renderer) {
    if (!items.length) return `<div class="admin-empty">Нет данных: ${esc(title)}</div>`;
    return `<div class="admin-v15-list">${items.map(renderer).join("")}</div>`;
  }

  async function renderSection() {
    const content = document.getElementById("adminV15Content");
    const title = document.getElementById("adminV15SectionTitle");
    const hint = document.getElementById("adminV15SectionHint");
    if (!content) return;
    if (!selectedUid) {
      content.innerHTML = `<div class="admin-empty">Выбери мастера.</div>`;
      return;
    }

    const user = userById(selectedUid);
    try {
      content.innerHTML = `<div class="admin-empty">Загрузка...</div>`;
      if (selectedSection === "subscription") {
        if (title) title.textContent = "Управление подпиской";
        if (hint) hint.textContent = "Тариф, срок, API клиента/API сервера и ИИ-баланс.";
        const [sub, ai] = await Promise.all([getDoc("user_subscriptions/" + selectedUid), getDoc("ai_accounts/" + selectedUid)]);
        content.innerHTML = renderSubscription(user, sub, ai);
        return;
      }

      const sectionMap = {
        serverdb: ["Просмотр баз данных", "server_db"],
        personaldb: ["Просмотр личных баз", "user_db/" + selectedUid + "/items"],
        accounting: ["Просмотр бухгалтерии", "accounting/" + selectedUid + "/items"],
        logs: ["Журнал событий после входа", "logs"],
        drafts: ["Черновики", "drafts/" + selectedUid + "/items"],
        pdf: ["Сохранённые печати / PDF", "pdf_prints/" + selectedUid + "/items"]
      };

      const [sectionTitle, path] = sectionMap[selectedSection] || sectionMap.personaldb;
      if (title) title.textContent = sectionTitle;
      if (hint) hint.textContent = "Просмотр данных мастера. Редактирование добавим отдельным безопасным этапом.";
      const items = await listCollection(path, 40);
      content.innerHTML = renderList(sectionTitle, items, item => `
        <div class="admin-v15-item">
          <b>${esc(item.data.name || item.data.title || item.id)}</b>
          <span>${esc(item.data.category || item.data.type || "")}</span>
          <small>${esc(fmtDate(item.data.createdAt || item.data.updatedAt))}</small>
        </div>
      `);
    } catch (error) {
      content.innerHTML = `<div class="admin-empty">Ошибка: ${esc(error.message)}</div>`;
      window.Diagnostics?.error?.({ file: FILE, module: "AdminV15", functionName: "renderSection()", place: selectedSection, code: error.code || "admin-v15-render-error", message: error.message });
    }
  }

  async function saveTariff() {
    if (!selectedUid) return;
    if (state.tariff === "trial2") await window.SubscriptionAPI.grantSubscription(selectedUid, "pro_ai", 2, true);
    else await window.SubscriptionAPI.grantSubscription(selectedUid, state.tariff, state.days, false);
    window.SoundAPI?.success?.();
    await renderSection();
  }

  async function saveDays() {
    if (!selectedUid) return;
    const tariff = state.tariff === "trial2" ? "pro_ai" : state.tariff;
    await window.SubscriptionAPI.grantSubscription(selectedUid, tariff, state.days, false);
    window.SoundAPI?.success?.();
    await renderSection();
  }

  async function saveAi() {
    if (!selectedUid) return;
    if (!window.AiSecurityAPI?.setAccessMode) throw new Error("AiSecurityAPI.setAccessMode не найден.");
    await window.AiSecurityAPI.setAccessMode(selectedUid, state.aiMode);
    if (state.aiMode === "admin_api") {
      const balance = Number(document.getElementById("adminV15BalanceInput")?.value || 0);
      if (!Number.isFinite(balance) || balance < 0) throw new Error("Неверный баланс.");
      await callFunction("setAiBalanceExact", { uid: selectedUid, balanceRub: balance, reason: "admin_v15_exact_balance" });
    }
    window.SoundAPI?.success?.();
    await renderSection();
  }

  function showDetails(type) {
    if (type === "basic") {
      alert("Базовая подписка\n\nДоступно:\n• база;\n• смета;\n• поставщику;\n• черновик.\n\nОграничения:\n• щит — до 60 позиций;\n• пул розеток/штроб — до 50 позиций;\n• все ИИ-функции полностью недоступны.");
      return;
    }
    alert("Подписка С ИИ\n\nДоступно всё без ограничений по щиту и пулу, кроме админ-панели.\n\nДоступны экспорт/импорт с ИИ и все функции, которые требуют ИИ.\n\nВажно: ИИ-запросы оплачиваются отдельно — через ИИ-баланс при API сервера или через API клиента.");
  }

  function bind() {
    document.addEventListener("click", async event => {
      const sectionBtn = event.target.closest("[data-admin-v15-section]");
      if (sectionBtn) {
        selectedSection = sectionBtn.dataset.adminV15Section;
        document.querySelectorAll("[data-admin-v15-section]").forEach(btn => btn.classList.toggle("is-selected", btn === sectionBtn));
        await renderSection();
        return;
      }

      const segment = event.target.closest("[data-v15-group]");
      if (segment) {
        const group = segment.dataset.v15Group;
        const value = segment.dataset.v15Value;
        if (group === "tariff") state.tariff = value;
        if (group === "days") state.days = Number(value);
        if (group === "aiMode") state.aiMode = value;
        setSelected(group, value);
        const balanceBox = document.getElementById("adminV15BalanceBox");
        if (balanceBox && group === "aiMode") balanceBox.classList.toggle("is-hidden", value === "own_api");
        return;
      }

      const action = event.target.closest("[data-v15-action]");
      if (!action) return;
      try {
        const a = action.dataset.v15Action;
        if (a === "save-tariff") await saveTariff();
        if (a === "save-days") await saveDays();
        if (a === "save-ai") await saveAi();
        if (a === "details-basic") showDetails("basic");
        if (a === "details-ai") showDetails("ai");
      } catch (error) {
        alert("Ошибка: " + error.message);
        window.Diagnostics?.error?.({ file: FILE, module: "AdminV15", functionName: "action", place: action.dataset.v15Action, code: error.code || "admin-v15-action-error", message: error.message });
      }
    });

    document.getElementById("adminV15MasterSelect")?.addEventListener("change", async event => {
      selectedUid = event.target.value;
      await renderSection();
    });

    document.getElementById("adminV15RefreshBtn")?.addEventListener("click", async () => {
      await loadUsers();
      await renderSection();
    });
  }

  async function init() {
    if (!document.getElementById("adminV15Page")) return;
    bind();
    await loadUsers();
  }

  window.AdminV15 = { init, loadUsers, renderSection };
  window.addEventListener("DOMContentLoaded", () => setTimeout(init, 800));
  const observer = new MutationObserver(() => {
    const page = document.getElementById("adminV15Page");
    if (page && page.dataset.boundV15 !== "1") {
      page.dataset.boundV15 = "1";
      init();
    }
  });
  window.addEventListener("DOMContentLoaded", () => observer.observe(document.body, { childList: true, subtree: true }));
})();
