/* Electric Pro V29 — Этап 5. Реквизиты мастера + карточка клиента/объекта.
   Хранится локально (источник истины), плюс best-effort синхронизация по аккаунту мастера
   в Firestore users/{uid} (тот же механизм, что у БД/авторизации). Облако необязательно: всё
   работает офлайн, синк — поверх. Эти данные питают документы (смета заказчику, договор и т.д.). */
(() => {
  "use strict";
  const MKEY = "ep_master_requisites_v29";
  const CKEY = "ep_client_card_v29";
  const VKEY = "ep_visual_settings_clean_v5_3", VKEY2 = "ep.visual.v29";

  function db() { try { return (window.EP && EP.Firebase && EP.Firebase.db) || null; } catch (e) { return null; } }
  function uid() { try { const u = window.EP && EP.Auth && EP.Auth.currentUser && EP.Auth.currentUser(); return u && u.uid ? u.uid : null; } catch (e) { return null; } }
  function readLS(k) { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch (e) { return {}; } }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v || {})); } catch (e) {} }
  function notEmpty(o) { return o && Object.keys(o).some(k => String(o[k] || "").trim()); }

  function getMaster() { return readLS(MKEY); }
  function setMaster(o) { writeLS(MKEY, o || {}); }
  function getClient() { return readLS(CKEY); }
  function setClient(o) { writeLS(CKEY, o || {}); }

  function getVisualBlob() { try { return JSON.parse(localStorage.getItem(VKEY2) || localStorage.getItem(VKEY) || "null"); } catch (e) { return null; } }
  function setVisualBlob(v) { if (!v) return; try { const s = JSON.stringify(v); localStorage.setItem(VKEY, s); localStorage.setItem(VKEY2, s); } catch (e) {} }

  /* ---- облако (best-effort, никогда не роняет приложение) ---- */
  function pushProfile() {
    const d = db(), u = uid();
    if (!d || !u) return Promise.resolve(false);
    try {
      return d.collection("drafts").doc(u).collection("v29").doc("profile").set({
        requisites: getMaster(), clientCard: getClient(), visualSettings: getVisualBlob() || null, profileUpdatedAt: Date.now()
      }, { merge: true }).then(() => true).catch(() => false);
    } catch (e) { return Promise.resolve(false); }
  }
  function pullProfile(opts) {
    const d = db(), u = uid();
    if (!d || !u) return Promise.resolve(null);
    try {
      return d.collection("drafts").doc(u).collection("v29").doc("profile").get().then((snap) => {
        const data = (snap && snap.exists ? snap.data() : {}) || {};
        if (data.requisites && !notEmpty(getMaster())) setMaster(data.requisites);
        if (data.clientCard && !notEmpty(getClient())) setClient(data.clientCard);
        if (opts && opts.applyVisual && data.visualSettings && !getVisualBlob()) setVisualBlob(data.visualSettings);
        return data;
      }).catch(() => null);
    } catch (e) { return Promise.resolve(null); }
  }

  let pulled = false;
  function tryPull() {
    if (pulled || !uid()) return;
    pulled = true;
    pullProfile({ applyVisual: true });
  }
  window.addEventListener("ep:auth-changed", (e) => { if (e && e.detail && e.detail.user) tryPull(); });
  setTimeout(tryPull, 1800); // на случай, если вход уже произошёл до загрузки модуля

  window.EP = window.EP || {};
  EP.Profile = { getMaster, setMaster, getClient, setClient, pushProfile, pullProfile };

  /* ---- UI ---- */
  const TYPES = [["self", "Самозанятый"], ["ip", "ИП"], ["ooo", "ООО"], ["fiz", "Физлицо"]];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function field(scope, key, label, ph, type) {
    const v = (scope === "m" ? getMaster() : getClient())[key] || "";
    return `<label class="ep-prof-f"><span>${label}</span><input data-prof="${scope}.${key}" type="${type || "text"}" value="${esc(v)}" placeholder="${esc(ph || "")}"></label>`;
  }
  function render() {
    const root = document.getElementById("ep-profile-root");
    if (!root) return;
    const m = getMaster();
    const typeOpts = TYPES.map(([v, l]) => `<option value="${v}" ${m.type === v ? "selected" : ""}>${l}</option>`).join("");
    root.innerHTML = `
      <div class="ep-prof">
        <div class="ep-prof-sec">
          <div class="ep-prof-h">Реквизиты мастера</div>
          <label class="ep-prof-f"><span>Форма</span><select data-prof="m.type">${typeOpts}</select></label>
          ${field("m", "name", "ФИО / Название", "Иванов Иван Иванович")}
          ${field("m", "phone", "Телефон", "+7 …", "tel")}
          ${field("m", "email", "Email", "master@mail.ru", "email")}
          ${field("m", "inn", "ИНН", "")}
          ${field("m", "ogrn", "ОГРНИП / ОГРН", "")}
          ${field("m", "bank", "Банк / расчётный счёт", "для счетов")}
          ${field("m", "address", "Город / адрес", "")}
        </div>
        <div class="ep-prof-sec">
          <div class="ep-prof-h">Клиент и объект (текущий)</div>
          ${field("c", "name", "Клиент (ФИО)", "")}
          ${field("c", "phone", "Телефон клиента", "+7 …", "tel")}
          ${field("c", "object", "Адрес объекта", "ул. …")}
          ${field("c", "kind", "Тип объекта", "квартира / дом / офис")}
          ${field("c", "note", "Примечание", "")}
        </div>
        <div class="ep-prof-actions">
          <button type="button" class="btn btn-primary ep-clickable" data-prof-save>Сохранить</button>
          <button type="button" class="btn btn-ghost ep-clickable" data-route="main">На главный</button>
        </div>
        <div class="ep-prof-status" data-prof-status></div>
      </div>`;
  }
  function readForm() {
    const root = document.getElementById("ep-profile-root");
    if (!root || !root.querySelectorAll) return;
    const m = getMaster(), c = getClient();
    root.querySelectorAll("[data-prof]").forEach((el) => {
      const parts = String(el.getAttribute("data-prof")).split(".");
      const scope = parts[0], key = parts[1];
      (scope === "m" ? m : c)[key] = el.value;
    });
    setMaster(m); setClient(c);
  }
  function flash(msg) {
    try {
      let el = document.getElementById("ep-collector-flash");
      if (!el) { el = document.createElement("div"); el.id = "ep-collector-flash"; el.className = "ep-pick-flash"; document.body.appendChild(el); }
      el.textContent = msg; el.classList.add("show");
      clearTimeout(flash._t); flash._t = setTimeout(() => el && el.classList.remove("show"), 1800);
    } catch (e) {}
  }

  document.addEventListener("click", (e) => {
    const t = e.target; if (!t || !t.closest) return;
    if (t.closest("[data-prof-save]")) {
      readForm();
      const st = document.querySelector("[data-prof-status]");
      if (st) st.textContent = "Сохранено на устройстве.";
      flash("Сохранено");
      pushProfile().then((ok) => { if (st) st.textContent = ok ? "Сохранено и синхронизировано по аккаунту." : "Сохранено на устройстве (синк по аккаунту — после входа)."; });
    }
  });
  window.addEventListener("ep:route-loaded", (e) => {
    const r = e && e.detail && e.detail.route;
    if (r === "profile") { render(); pullProfile({ applyVisual: false }).then((d) => { if (d) render(); }); }
  });
})();
