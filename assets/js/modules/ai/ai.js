/* Electric Pro V29 — ИИ-ассистент v2 (admin-only тест).
   Источник ключа: Личный (в настройках ИИ) или Серверный (в Админке) — тумблер.
   Баланс ПРИВЯЗАН к ключу: расход списывается с баланса активного ключа.
   ИИ видит данные приложения: смета, затраты, склад и т.д. Запросы из браузера — проверять на устройстве. */
(() => {
  "use strict";
  const KEY = "ep_ai_v29";
  const SYSBASE = "Ты — помощник электрика внутри приложения Electric Pro. Отвечай кратко, по делу, на русском. Помогаешь с расчётами, подбором кабеля/автоматов/УЗО, нормами (ПУЭ/ГОСТ), проверкой смет и щитов. Если ниже дан БЛОК ДАННЫХ приложения — опирайся на него (это реальные данные пользователя: смета, затраты, склад и пр.).";

  const PROVIDERS = {
    openai: {
      name: "OpenAI (ChatGPT)", defaultModel: "gpt-4o-mini", hint: "напр. gpt-4o-mini, gpt-4.1, o4-mini",
      async send(key, model, messages) {
        const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify({ model: model, messages: messages }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d.error && d.error.message) || ("Ошибка " + r.status));
        return { text: (((d.choices || [])[0] || {}).message || {}).content || "", pTok: (d.usage || {}).prompt_tokens || 0, cTok: (d.usage || {}).completion_tokens || 0 };
      }
    },
    gemini: {
      name: "Google Gemini", defaultModel: "gemini-1.5-flash", hint: "напр. gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash",
      async send(key, model, messages) {
        const sys = messages.find(m => m.role === "system");
        const contents = messages.filter(m => m.role !== "system").map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
        const body = { contents: contents }; if (sys) body.systemInstruction = { parts: [{ text: sys.content }] };
        const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d.error && d.error.message) || ("Ошибка " + r.status));
        const cand = (d.candidates || [])[0] || {}; const u = d.usageMetadata || {};
        return { text: ((cand.content || {}).parts || []).map(p => p.text || "").join(""), pTok: u.promptTokenCount || 0, cTok: u.candidatesTokenCount || 0 };
      }
    }
  };
  const PROV_IDS = Object.keys(PROVIDERS);
  const SOURCES = ["personal", "server"];

  function blankCfg(id) { return { key: "", model: PROVIDERS[id].defaultModel, priceIn: 0, priceOut: 0, balance: 0 }; }
  function blankUsage() { return { req: 0, pTok: 0, cTok: 0, cost: 0 }; }
  function blankSet() { const o = {}; PROV_IDS.forEach(id => o[id] = blankCfg(id)); return o; }
  function blankUse() { const o = {}; PROV_IDS.forEach(id => o[id] = blankUsage()); return o; }
  function load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
    if (!s || typeof s !== "object") s = {};
    if (SOURCES.indexOf(s.source) < 0) s.source = "personal";
    if (PROV_IDS.indexOf(s.provider) < 0) s.provider = "openai";
    // миграция со старой схемы (s.cfg / s.usage были плоскими по провайдеру)
    if (s.cfg && !s.personal) { s.personal = {}; PROV_IDS.forEach(id => { s.personal[id] = Object.assign(blankCfg(id), s.cfg[id] || {}); }); }
    s.personal = s.personal || {}; s.server = s.server || {};
    PROV_IDS.forEach(id => { s.personal[id] = Object.assign(blankCfg(id), s.personal[id] || {}); s.server[id] = Object.assign(blankCfg(id), s.server[id] || {}); });
    if (!s.usage || s.usage.openai || s.usage.gemini) { const old = s.usage || {}; s.usage = { personal: {}, server: {} }; PROV_IDS.forEach(id => { s.usage.personal[id] = Object.assign(blankUsage(), old[id] || {}); s.usage.server[id] = blankUsage(); }); }
    s.usage.personal = s.usage.personal || blankUse(); s.usage.server = s.usage.server || blankUse();
    PROV_IDS.forEach(id => { s.usage.personal[id] = Object.assign(blankUsage(), s.usage.personal[id] || {}); s.usage.server[id] = Object.assign(blankUsage(), s.usage.server[id] || {}); });
    s.ctx = Object.assign({ estimate: true, costs: true, stock: true, db: false }, s.ctx || {});
    delete s.cfg;
    return s;
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function num(v) { return Number(v) || 0; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function money(v) { return "$" + (Math.round(num(v) * 10000) / 10000); }

  let st = load();
  let chat = [];
  let view = "chat";
  let busy = false;

  function curCfg() { return st[st.source][st.provider]; }
  function curUsage() { return st.usage[st.source][st.provider]; }
  function sourceName() { return st.source === "server" ? "Серверный" : "Личный"; }

  function addUsage(pTok, cTok) {
    const c = curCfg(), u = curUsage();
    u.req += 1; u.pTok += num(pTok); u.cTok += num(cTok);
    u.cost += (num(pTok) / 1e6) * num(c.priceIn) + (num(cTok) / 1e6) * num(c.priceOut);
    save(st);
  }

  /* ---------- контекст приложения: ИИ видит смету/затраты/склад ---------- */
  function appContext() {
    const parts = [];
    try { if (st.ctx.estimate && window.EP && EP.Estimate && EP.Estimate.getItems) { const it = EP.Estimate.getItems() || []; if (it.length) { const lines = it.slice(0, 60).map(x => `${x.name} ×${num(x.qty) || 1}${x.price != null ? " = " + (num(x.price) * (num(x.qty) || 1)) : ""}`); const tot = it.reduce((s, x) => s + num(x.price) * (num(x.qty) || 1), 0); parts.push("СМЕТА (основная): " + lines.join("; ") + ". Итого: " + tot); } } } catch (e) {}
    try { if (st.ctx.costs && window.EP && EP.Costs && EP.Costs.income) { parts.push(`ЗАТРАТЫ: доход ${EP.Costs.income()}, план ${EP.Costs.planTotal()}, факт ${EP.Costs.actualTotal()}, прибыль ${EP.Costs.profitFact()}.`); } } catch (e) {}
    try { if (st.ctx.stock && window.EP && EP.Stock && EP.Stock.getStock) { const s = EP.Stock.getStock() || []; if (s.length) parts.push("СКЛАД: " + s.slice(0, 40).map(x => `${x.name} ${num(x.qty)}${x.unit || ""}`).join("; ")); } } catch (e) {}
    try { if (st.ctx.db && window.EP && EP.Database && EP.Database.getItemsByType) { const m = (EP.Database.getItemsByType("material") || []).slice(0, 30).map(x => x.name); if (m.length) parts.push("БД материалов (примеры): " + m.join(", ")); } } catch (e) {}
    return parts.length ? "\n\nБЛОК ДАННЫХ ПРИЛОЖЕНИЯ:\n" + parts.join("\n") : "";
  }
  function sysMsg() { return { role: "system", content: SYSBASE + appContext() }; }

  async function ask(messages) {
    const c = curCfg();
    if (!c.key) throw new Error((st.source === "server" ? "Серверный ключ не задан (Админка → ИИ-сервер)." : "Личный ключ не задан (Настройки)."));
    const res = await PROVIDERS[st.provider].send(c.key, c.model || PROVIDERS[st.provider].defaultModel, messages);
    addUsage(res.pTok, res.cTok);
    return res;
  }

  window.EP = window.EP || {};
  EP.AI = {
    getData: () => st, save: () => save(st),
    ask, addUsage, providers: PROVIDERS,
    usage: () => curUsage(), resetUsage: () => { st.usage[st.source][st.provider] = blankUsage(); save(st); },
    appContext
  };

  /* ---------------- UI ---------------- */
  function isAdmin() { try { return !!(window.EP && EP.Auth && EP.Auth.isAdmin && EP.Auth.isAdmin()); } catch (e) { return false; } }

  function usagePanel() {
    const c = curCfg(), u = curUsage(); const total = u.pTok + u.cTok;
    const remain = num(c.balance) - num(u.cost); const pct = num(c.balance) > 0 ? Math.max(0, Math.min(100, remain / num(c.balance) * 100)) : 0;
    return `<div class="ep-ai-srcrow">
        <span class="ep-ai-srclbl">Баланс:</span>
        <div class="ep-ai-srctog">
          <button type="button" class="${st.source === "personal" ? "on" : ""}" data-ai-src="personal">Личный</button>
          <button type="button" class="${st.source === "server" ? "on" : ""}" data-ai-src="server">Серверный</button>
        </div>
      </div>
      <div class="ep-ai-usage">
        <div class="ep-ai-ubar"><span><b>${esc(sourceName())}</b> · ${esc(PROVIDERS[st.provider].name)}</span><span>модель: ${esc(c.model || "—")}</span></div>
        <div class="ep-ai-keysrow">Баланс ключей (${esc(PROVIDERS[st.provider].name)}): Личный <b>${money(st.personal[st.provider].balance)}</b> · Серверный <b>${money(st.server[st.provider].balance)}</b></div>
        <div class="ep-ai-stats">
          <div class="ep-ai-stat"><span>${u.req}</span><small>запросов</small></div>
          <div class="ep-ai-stat"><span>${u.pTok}</span><small>вход.</small></div>
          <div class="ep-ai-stat"><span>${u.cTok}</span><small>исход.</small></div>
          <div class="ep-ai-stat"><span>${total}</span><small>токенов</small></div>
          <div class="ep-ai-stat"><span>${money(u.cost)}</span><small>потрачено</small></div>
        </div>
        ${num(c.balance) > 0 ? `<div class="ep-ai-bal"><div class="ep-ai-balrow"><span>Баланс ключа: ${money(c.balance)}</span><span>Осталось: <b>${money(remain)}</b></span></div><div class="ep-ai-baltrack"><div class="ep-ai-balfill" style="width:${pct}%"></div></div></div>` : `<div class="ep-ai-hint">Баланс этого ключа не задан${st.source === "server" ? " (Админка → ИИ-сервер)" : " (Настройки)"}.</div>`}
        <button type="button" class="ep-ai-reset ep-clickable" data-ai-reset>Обнулить счётчик</button>
      </div>`;
  }

  const QUICK = [
    { id: "smeta", label: "🔍 Проверить смету", text: "Проверь мою смету по блоку данных: всё ли учтено, чего может не хватать, нет ли ошибок?" },
    { id: "forgot", label: "❓ Что забыл", text: "Глядя на мои данные (смета/щит), что я мог забыть в этом проекте?" },
    { id: "profit", label: "💰 Прибыль", text: "Оцени прибыльность проекта по блоку ЗАТРАТЫ и подскажи, где можно улучшить." }
  ];
  function chatView() {
    const list = chat.length ? chat.map(m => `<div class="ep-ai-msg ${m.role}"><div class="ep-ai-bub">${esc(m.content)}</div>${m.tok ? `<div class="ep-ai-mtok">${m.tok} ток.</div>` : ""}</div>`).join("") : `<div class="ep-ai-empty">Спроси про подбор кабеля/автомата, нормы — или нажми кнопку ниже, чтобы ИИ проверил твою смету и данные. Тестовый режим — следи за счётчиком токенов.</div>`;
    return `<div class="ep-ai-quick">${QUICK.map(q => `<button type="button" class="ep-ai-qbtn ep-clickable" data-ai-quick="${q.id}">${q.label}</button>`).join("")}</div>
      <div class="ep-ai-chat">
        <div class="ep-ai-msgs" id="ep-ai-msgs">${list}${busy ? '<div class="ep-ai-typing">ИИ печатает…</div>' : ""}</div>
        <div class="ep-ai-input"><textarea id="ep-ai-text" rows="2" placeholder="Вопрос ассистенту…" ${busy ? "disabled" : ""}></textarea><button type="button" class="btn btn-primary ep-clickable" data-ai-send ${busy ? "disabled" : ""}>▶</button></div>
        <div class="ep-ai-clearrow"><button type="button" class="ep-ai-clear ep-clickable" data-ai-clear>Очистить диалог</button></div>
      </div>`;
  }

  function settingsView() {
    const provTabs = PROV_IDS.map(id => `<button type="button" class="ep-ai-ptab ${st.provider === id ? "on" : ""}" data-ai-prov="${id}">${esc(PROVIDERS[id].name)}</button>`).join("");
    const c = st.personal[st.provider]; // в настройках редактируем ЛИЧНЫЙ ключ
    const ctxItem = (k, lbl) => `<label class="ep-ai-ctx"><input type="checkbox" data-ai-ctx="${k}" ${st.ctx[k] ? "checked" : ""}> ${lbl}</label>`;
    return `<div class="ep-ai-settings">
      <div class="ep-ai-note">Здесь — <b>личный</b> ключ и баланс. Серверные ключи задаёт админ в <b>Админка → 🤖 ИИ-сервер</b>. Что использовать — выбирай тумблером «Личный/Серверный» сверху.</div>
      <div class="ep-ai-ptabs">${provTabs}</div>
      <label class="ep-ai-f"><span>Личный API-ключ (${esc(PROVIDERS[st.provider].name)})</span><input type="password" data-ai-pkey value="${esc(c.key)}" placeholder="вставь свой ключ" autocomplete="off"></label>
      <label class="ep-ai-f"><span>Модель</span><input type="text" data-ai-pmodel value="${esc(c.model)}" placeholder="${esc(PROVIDERS[st.provider].defaultModel)}"><small>${esc(PROVIDERS[st.provider].hint)}</small></label>
      <div class="ep-ai-f2"><label class="ep-ai-f"><span>Цена 1M вход, $</span><input type="number" inputmode="decimal" step="0.01" min="0" data-ai-ppin value="${c.priceIn || ""}" placeholder="0"></label><label class="ep-ai-f"><span>Цена 1M исход, $</span><input type="number" inputmode="decimal" step="0.01" min="0" data-ai-ppout value="${c.priceOut || ""}" placeholder="0"></label></div>
      <label class="ep-ai-f"><span>Баланс личного ключа, $</span><input type="number" inputmode="decimal" step="0.01" min="0" data-ai-pbal value="${c.balance || ""}" placeholder="напр. 8.28"></label>
      <div class="ep-ai-ctxbox"><div class="ep-ai-ctxh">Что ИИ видит из приложения:</div>${ctxItem("estimate", "Смета")}${ctxItem("costs", "Затраты")}${ctxItem("stock", "Склад")}${ctxItem("db", "БД материалов")}</div>
      <div class="ep-ai-hint">Ключ хранится только на этом устройстве. Цены — из тарифа провайдера. «Что ИИ видит» — эти данные добавляются к запросу, чтобы ассистент работал с твоей сметой/затратами.</div>
    </div>`;
  }

  function render() {
    const root = document.getElementById("ep-ai-root"); if (!root) return;
    if (!isAdmin()) { root.innerHTML = `<div class="ep-ai"><div class="ep-ai-locked"><div class="ep-ai-lock">🔒</div><div class="ep-ai-lockt">ИИ-ассистент</div><div class="ep-ai-locks">Сейчас доступен только администратору (тестовый режим). Скоро откроем по плану «С ИИ».</div><button type="button" class="btn btn-ghost ep-clickable" data-route="main">На главный</button></div></div>`; return; }
    root.innerHTML = `<div class="ep-ai">
      <div class="page-head"><h1>🤖 ИИ-ассистент <span class="ep-ai-test">тест</span></h1></div>
      ${usagePanel()}
      <div class="ep-ai-tabs"><button type="button" class="ep-ai-tab ${view === "chat" ? "on" : ""}" data-ai-tab="chat">Ассистент</button><button type="button" class="ep-ai-tab ${view === "settings" ? "on" : ""}" data-ai-tab="settings">Настройки</button></div>
      ${view === "chat" ? chatView() : settingsView()}
    </div>`;
    const m = document.getElementById("ep-ai-msgs"); if (m) m.scrollTop = m.scrollHeight;
  }

  async function sendText(text) {
    if (busy || !text) return;
    if (!curCfg().key) { view = "settings"; render(); alert(st.source === "server" ? "Серверный ключ не задан (Админка → ИИ-сервер)." : "Сначала вставь личный ключ в Настройках."); return; }
    chat.push({ role: "user", content: text });
    busy = true; render();
    try {
      const hist = [sysMsg()].concat(chat.slice(-20));
      const res = await ask(hist);
      chat.push({ role: "assistant", content: res.text || "(пустой ответ)", tok: res.pTok + res.cTok });
    } catch (e) { chat.push({ role: "assistant", content: "⚠ " + (e && e.message ? e.message : "Ошибка запроса."), tok: 0 }); }
    busy = false; render();
  }
  function doSend() { const root = document.getElementById("ep-ai-root"); if (!root) return; const ta = root.querySelector("#ep-ai-text"); sendText(ta ? ta.value.trim() : ""); }

  document.addEventListener("input", (e) => {
    const t = e.target; if (!t || !t.getAttribute || !document.getElementById("ep-ai-root")) return; const c = st.personal[st.provider];
    if (t.hasAttribute("data-ai-pkey")) { c.key = t.value; save(st); }
    else if (t.hasAttribute("data-ai-pmodel")) { c.model = t.value; save(st); }
    else if (t.hasAttribute("data-ai-ppin")) { c.priceIn = num(t.value); save(st); }
    else if (t.hasAttribute("data-ai-ppout")) { c.priceOut = num(t.value); save(st); }
    else if (t.hasAttribute("data-ai-pbal")) { c.balance = num(t.value); save(st); }
  });
  document.addEventListener("change", (e) => {
    const t = e.target; if (!t || !t.getAttribute || !document.getElementById("ep-ai-root")) return;
    if (t.hasAttribute("data-ai-ctx")) { st.ctx[t.getAttribute("data-ai-ctx")] = !!t.checked; save(st); }
  });
  document.addEventListener("click", (e) => {
    const t = e.target; if (!t || !t.closest || !document.getElementById("ep-ai-root")) return; let el;
    if ((el = t.closest("[data-ai-src]"))) { st.source = el.getAttribute("data-ai-src"); save(st); render(); return; }
    if ((el = t.closest("[data-ai-tab]"))) { view = el.getAttribute("data-ai-tab") === "settings" ? "settings" : "chat"; render(); return; }
    if ((el = t.closest("[data-ai-prov]"))) { st.provider = el.getAttribute("data-ai-prov"); save(st); render(); return; }
    if ((el = t.closest("[data-ai-quick]"))) { const q = QUICK.find(x => x.id === el.getAttribute("data-ai-quick")); if (q) sendText(q.text); return; }
    if (t.closest("[data-ai-send]")) { doSend(); return; }
    if (t.closest("[data-ai-reset]")) { if (confirm("Обнулить счётчик токенов и потрачено для текущего ключа?")) { EP.AI.resetUsage(); render(); } return; }
    if (t.closest("[data-ai-clear]")) { chat = []; render(); return; }
  });

  window.addEventListener("ep:route-loaded", (e) => { const r = e && e.detail && e.detail.route; if (r === "ai") { st = load(); view = "chat"; render(); } });
})();
