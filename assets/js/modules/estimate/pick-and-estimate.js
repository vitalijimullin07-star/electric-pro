/* Electric Pro V29 — пикер материалов/работ (маршруты materials/work) + сводка предварительной сметы на главной.
   Читает каталог через EP.Database (активная база), кладёт позиции в EP.EstimateDraft. Без MutationObserver. */
(() => {
  "use strict";
  const TYPE_BY_ROUTE = { materials: "material", work: "work" };
  const expanded = {};        // состояние раскрытия папок: "type::category" -> bool
  let currentType = null;     // активный тип пикера (material/work)

  function DB() { return (window.EP && window.EP.Database) || null; }
  function Draft() { return (window.EP && window.EP.EstimateDraft) || null; }
  function activeBase() {
    try {
      const d = DB();
      if (d && d.getActiveDb) return d.getActiveDb() || "my";
    } catch (e) {}
    try { return localStorage.getItem("epdb26_active_base") || "my"; } catch (e) { return "my"; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function money(v) {
    try { if (window.EPCurrency && window.EPCurrency.format) return window.EPCurrency.format(v); } catch (e) {}
    return (Number(v || 0).toFixed(2)) + " ₽";
  }

  /* ---------- пикер (materials / work) ---------- */
  function renderPicker(type) {
    const root = document.getElementById("ep-pick-root");
    if (!root || !type) return;
    const base = activeBase();
    const d = DB();
    const items = (d && d.getItemsByType) ? (d.getItemsByType(type, base) || []) : [];
    const draft = Draft();
    const count = draft ? draft.count() : 0;
    const total = draft ? draft.total() : 0;
    const baseLabel = base === "server" ? "база сервера" : "моя база";
    const otherLabel = base === "server" ? "моя база" : "база сервера";

    const cats = {};
    items.forEach(it => { const c = (it.category || "Без категории"); (cats[c] = cats[c] || []).push(it); });
    const catNames = Object.keys(cats).sort((a, b) => a.localeCompare(b, "ru"));

    const head = `
      <div class="ep-pick-head">
        <div class="ep-pick-row1">
          <div class="ep-pick-title">${type === "work" ? "🧰 Работа" : "📦 Материалы"}</div>
          <button type="button" class="ep-pick-base" data-pick-base>${esc(baseLabel)} ⇄</button>
        </div>
        <div class="ep-pick-sub">${items.length} поз. в базе · в смете: <b>${count}</b> · ${money(total)}</div>
        <div class="ep-pick-actions">
          <button type="button" class="ep-pick-btn primary" data-pick-estimate>Открыть смету (${count})</button>
          <button type="button" class="ep-pick-btn" data-route="main">На главный</button>
        </div>
      </div>`;

    let body;
    if (!items.length) {
      body = `<div class="ep-db-empty">В базе «${esc(baseLabel)}» нет позиций типа «${type === "work" ? "работа" : "материал"}».<br>
        Переключи базу кнопкой «${esc(otherLabel)} ⇄» или заполни каталог в разделе «База».
        <div style="margin-top:10px"><button type="button" class="ep-pick-btn" data-route="database">Открыть базу</button></div></div>`;
    } else {
      body = catNames.map(c => {
        const key = type + "::" + c;
        const open = !!expanded[key];
        const rows = cats[c].map(it => `
          <div class="ep-db-row">
            <div class="ep-db-row-main">
              <div class="ep-db-row-name">${esc(it.name)}</div>
              ${it.unit ? `<div class="ep-db-row-meta">${esc(it.unit)}</div>` : ""}
            </div>
            <div class="ep-db-row-price">${money(it.price)}</div>
            <button type="button" class="ep-db-iconbtn ep-pick-add" data-pick-add="${esc(it.id)}" title="Добавить в смету">+</button>
          </div>`).join("");
        return `<div class="ep-db-folder ${open ? "is-open" : ""}">
          <div class="ep-db-folder-head" data-pick-folder="${esc(c)}"><span>📁 ${esc(c)}</span><span class="ep-db-count">${cats[c].length}</span></div>
          ${open ? `<div class="ep-db-list">${rows}</div>` : ""}
        </div>`;
      }).join("");
    }
    root.innerHTML = `<div class="ep-pick">${head}<div class="ep-pick-body">${body}</div></div>`;
  }

  function showQtyModal(it, onConfirm) {
    const ov = document.createElement("div");
    ov.className = "ep-qty-ov";
    ov.innerHTML = `
      <div class="ep-qty-modal">
        <div class="ep-qty-title">${esc(it.name)}</div>
        <div class="ep-qty-sub">${esc(it.unit || "шт")} · ${money(it.price)}${(Number(it.price) > 0) ? "" : " · цену впишешь в смете"}</div>
        <div class="ep-qty-row">
          <button type="button" class="ep-qty-step" data-qty-dec>−</button>
          <input class="ep-qty-input" type="number" inputmode="decimal" min="0" value="1" />
          <button type="button" class="ep-qty-step" data-qty-inc>+</button>
        </div>
        <div class="ep-qty-actions">
          <button type="button" class="btn btn-ghost ep-clickable" data-qty-cancel>Отмена</button>
          <button type="button" class="btn btn-primary ep-clickable" data-qty-ok>Добавить</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const input = ov.querySelector(".ep-qty-input");
    setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 40);
    const close = () => { try { ov.remove(); } catch (e) {} };
    const done = () => { const q = Number(input.value) || 0; if (q > 0) { onConfirm(q); close(); } };
    ov.addEventListener("click", (e) => {
      const c = (s) => e.target.closest && e.target.closest(s);
      if (e.target === ov || c("[data-qty-cancel]")) { close(); return; }
      if (c("[data-qty-inc]")) { input.value = (Number(input.value) || 0) + 1; return; }
      if (c("[data-qty-dec]")) { input.value = Math.max(0, (Number(input.value) || 0) - 1); return; }
      if (c("[data-qty-ok]")) { done(); return; }
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(); } });
  }
  function openQtyForPick(id) {
    const base = activeBase();
    const d = DB();
    const it = (d && d.getItems) ? d.getItems(base).find(x => x.id === id) : null;
    if (!it) return;
    showQtyModal(it, (qty) => addToDraft(id, qty));
  }
  function addToDraft(id, qty) {
    const base = activeBase();
    const d = DB();
    const it = (d && d.getItems) ? d.getItems(base).find(x => x.id === id) : null;
    const draft = Draft();
    if (!it || !draft) return;
    const q = Number(qty) || 1;
    draft.addItem({ sourceId: it.id, type: it.type, name: it.name, unit: it.unit, price: it.price, qty: q, base, source: "picker" });
    flash("В смету: " + it.name + (q > 1 ? " ×" + q : ""));
    if (currentType) renderPicker(currentType);
  }

  function toggleBase() {
    const cur = activeBase();
    const next = cur === "server" ? "my" : "server";
    try { const d = DB(); if (d && d.setActiveDb) d.setActiveDb(next); else localStorage.setItem("epdb26_active_base", next); } catch (e) {}
    if (currentType) renderPicker(currentType);
  }

  /* ---------- сводка предварительной сметы на главной ---------- */
  function renderHomeSummary() {
    const draft = Draft();
    const items = draft ? draft.getItems() : [];
    const count = draft ? draft.count() : 0;
    const total = draft ? draft.total() : 0;
    const badge = document.querySelector("[data-est-badge]");
    if (badge) badge.textContent = count ? (count + " поз. · " + money(total)) : "Пока пусто";
    const _main = window.EP && window.EP.Estimate;
    const _mb = document.querySelector("[data-estmain-badge]");
    if (_mb) { const _mc = _main ? _main.count() : 0; _mb.textContent = _mc ? (_mc + " поз. · " + money(_main.total())) : "Пока пусто"; }
    const list = document.querySelector("[data-est-list]");
    if (!list) return;
    if (!items.length) { list.innerHTML = ""; return; }
    const sub = (arr) => arr.reduce((s, x) => s + (Number(x.price) || 0) * (Number(x.qty) || 0), 0);
    const section = (title, arr) => arr.length ? `
      <div class="ep-est-section">
        <div class="ep-est-sec-h">${title} · ${money(sub(arr))}</div>
        ${arr.map(x => `
          <div class="ep-est-row${(Number(x.price) > 0) ? '' : ' noprice'}">
            <div class="ep-est-name ep-est-card" data-est-card="${esc(x.id)}" role="button" tabindex="0">${esc(x.name)}${x.unit ? ` <span class="ep-est-unit">${esc(x.unit)}</span>` : ""}</div>
            <div class="ep-est-qty">
              <button type="button" data-est-dec="${esc(x.id)}">−</button><b>${esc(x.qty)}</b><button type="button" data-est-inc="${esc(x.id)}">+</button>
            </div>
            <div class="ep-est-sum">${(Number(x.price) > 0) ? money((Number(x.price) || 0) * (Number(x.qty) || 0)) : `<input class="ep-est-price" data-est-price="${esc(x.id)}" type="number" inputmode="decimal" placeholder="цена ₽" />`}</div>
            <button type="button" class="ep-est-rm" data-est-remove="${esc(x.id)}" title="Убрать">✕</button>
          </div>`).join("")}
      </div>` : "";
    const _noPrice = items.filter(x => !(Number(x.price) > 0)).length;
    const _warn = _noPrice ? `<div class="ep-est-warn">⚠️ ${_noPrice} поз. без цены — впиши стоимость (или оставь до ответа поставщика)</div>` : "";
    const _hasFast = items.some(x => /площадк|стяжк|гвозд|баллон|клипс|гофра|лента монтаж/i.test(x.name || ""));
    const _res = (window.EP && window.EP.ConsumablesUI && window.EP.ConsumablesUI.getReserve) ? window.EP.ConsumablesUI.getReserve() : 0;
    const _resCtrl = _hasFast ? `
      <div class="ep-est-reserve">
        <div class="ep-est-reserve-top"><span>Запас на крепёж</span>
          <div class="ep-est-reserve-ctl">
            <button type="button" data-est-reserve-step="-5" aria-label="−5%">−</button>
            <input class="ep-est-reserve-inp" data-est-reserve type="number" inputmode="numeric" value="${_res}" />
            <span class="ep-est-reserve-pct">%</span>
            <button type="button" data-est-reserve-step="5" aria-label="+5%">+</button>
          </div>
        </div>
        <div class="ep-est-reserve-hint">Добавляется к площадкам, стяжкам, гвоздям. Пересчитывается сразу.</div>
      </div>` : "";
    list.innerHTML = _warn + _resCtrl +
      section("📦 Материалы", items.filter(x => x.type !== "work")) +
      section("🧰 Работа", items.filter(x => x.type === "work")) +
      `<div class="ep-est-total">Итого: <b>${money(total)}</b></div>`;
  }

  /* ---------- карточка позиции (клик по имени в предварительной) ---------- */
  function cardNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : 0; }
  function cardKeywords(name) {
    const w = String(name || "").trim().split(/\s+/);
    for (let i = 0; i < w.length; i++) { const t = w[i].replace(/[^A-Za-zА-Яа-яЁё]/g, ""); if (t.length >= 3) return t.toLowerCase(); }
    return String(w[0] || "").toLowerCase();
  }
  function cardDbByType(type) { const db = DB(); return (db && db.getItemsByType) ? (db.getItemsByType(type, activeBase()) || []) : []; }
  function saveDraftToBase() {
    const d = Draft(); const C = window.EP && window.EP.Clients;
    if (!d) return;
    if (!C || !C.saveEstimate) { flash("Раздел клиентов не загружен"); return; }
    const items = d.getItems();
    if (!items.length) { flash("Предварительная пуста — нечего сохранять"); return; }
    const clients = C.listClients();
    const today = new Date();
    const defName = "Смета " + ("0" + today.getDate()).slice(-2) + "." + ("0" + (today.getMonth() + 1)).slice(-2) + "." + today.getFullYear();
    const ov = document.createElement("div");
    ov.className = "ep-card-ov";
    document.body.appendChild(ov);
    function close() { ov.remove(); }
    const opts = clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    ov.innerHTML = `
      <div class="ep-card" role="dialog" aria-modal="true">
        <div class="ep-card-head"><b>💾 Сохранить в базу</b><button type="button" class="ep-card-x" data-save-close aria-label="Закрыть">✕</button></div>
        <div class="ep-card-body">
          ${clients.length ? `<label class="ep-card-pricelab">Клиент / объект
            <select class="ep-card-price" data-save-client>${opts}<option value="__new">➕ Новый клиент…</option></select></label>` : ``}
          <label class="ep-card-pricelab" data-save-newwrap ${clients.length ? `style="display:none"` : ``}>Имя нового клиента
            <input class="ep-card-price" data-save-newclient placeholder="Напр.: Иванов, ул. Ленина 5" />
          </label>
          <label class="ep-card-pricelab">Название сметы
            <input class="ep-card-price" data-save-name value="${esc(defName)}" />
          </label>
          <div class="ep-card-linked">Позиций: ${items.length} · Итого: ${money(d.total())}</div>
        </div>
        <div class="ep-card-foot">
          <button type="button" class="ep-card-cancel" data-save-close>Отмена</button>
          <button type="button" class="ep-card-save" data-save-do>Сохранить</button>
        </div>
      </div>`;
    ov.addEventListener("change", (e) => {
      if (e.target.closest && e.target.closest("[data-save-client]")) {
        const wrap = ov.querySelector("[data-save-newwrap]");
        if (wrap) wrap.style.display = e.target.value === "__new" ? "" : "none";
      }
    });
    ov.addEventListener("click", (e) => {
      if (e.target === ov || (e.target.closest && e.target.closest("[data-save-close]"))) { close(); return; }
      if (e.target.closest && e.target.closest("[data-save-do]")) {
        const nameEl = ov.querySelector("[data-save-name]");
        const name = nameEl && nameEl.value.trim() ? nameEl.value.trim() : defName;
        const clientSel = ov.querySelector("[data-save-client]");
        const newEl = ov.querySelector("[data-save-newclient]");
        let clientId = "";
        if (!clients.length || (clientSel && clientSel.value === "__new")) {
          const nm = newEl ? newEl.value.trim() : "";
          if (!nm) { flash("Введи имя клиента"); return; }
          const c = C.addClient(nm); clientId = c ? c.id : "";
        } else if (clientSel) { clientId = clientSel.value; }
        if (!clientId) { flash("Выбери клиента"); return; }
        C.saveEstimate({ clientId: clientId, name: name, items: d.getItems(), total: d.total() });
        close();
        flash("Сохранено в базу ✓");
      }
    });
  }

  function showItemCard(item) {
    let curPrice = Number(item.price) > 0 ? String(item.price) : "";
    let linkedId = "";
    let q = cardKeywords(item.name);
    let dbOpen = false;
    const ov = document.createElement("div");
    ov.className = "ep-card-ov";
    document.body.appendChild(ov);
    function dbList() {
      let arr = cardDbByType(item.type);
      if (!DB() || !DB().getItemsByType) return `<div class="ep-card-empty">База недоступна</div>`;
      const qq = String(q || "").trim().toLowerCase();
      if (qq) arr = arr.filter((x) => String(x.name || "").toLowerCase().includes(qq));
      if (!arr.length) return `<div class="ep-card-empty">Ничего не найдено${qq ? ` по «${esc(q)}»` : ""}. Очисти поиск, чтобы видеть всё.</div>`;
      return arr.slice(0, 50).map((x) => `<button type="button" class="ep-card-dbrow${String(x.id) === String(linkedId) ? " is-sel" : ""}" data-card-pick="${esc(x.id)}"><span class="ep-card-dbname">${esc(x.name)}</span><span class="ep-card-dbprice">${money(x.price)}${x.unit ? ` <i>${esc(x.unit)}</i>` : ""}</span></button>`).join("");
    }
    function draw() {
      ov.innerHTML = `
        <div class="ep-card" role="dialog" aria-modal="true">
          <div class="ep-card-head"><b>Карточка позиции</b><button type="button" class="ep-card-x" data-card-close aria-label="Закрыть">✕</button></div>
          <div class="ep-card-body">
            <div class="ep-card-name">${esc(item.name)}</div>
            <div class="ep-card-tags">
              <span class="ep-card-tag ${item.type === "work" ? "is-work" : "is-mat"}">${item.type === "work" ? "🧰 Работа" : "📦 Материал"}</span>
              <span class="ep-card-tag">${esc(item.qty)} ${esc(item.unit || "шт")}</span>
            </div>
            <label class="ep-card-pricelab">Цена за единицу, ₽
              <input class="ep-card-price" type="number" inputmode="decimal" value="${curPrice === "" ? "" : esc(curPrice)}" placeholder="0" />
            </label>
            ${linkedId ? `<div class="ep-card-linked">✓ Привязано к позиции базы — цена обновляется автоматически</div>` : ""}
            <button type="button" class="ep-card-dbtoggle" data-card-dbtoggle>${dbOpen ? "▲ Скрыть базу" : "🔎 Выбрать цену из базы"}</button>
            ${dbOpen ? `<div class="ep-card-db"><input class="ep-card-search" data-card-search value="${esc(q)}" placeholder="Поиск в базе…" /><div class="ep-card-dblist">${dbList()}</div></div>` : ""}
          </div>
          <div class="ep-card-foot">
            <button type="button" class="ep-card-cancel" data-card-close>Закрыть</button>
            <button type="button" class="ep-card-save" data-card-save>Сохранить</button>
          </div>
        </div>`;
    }
    function close() { ov.remove(); }
    ov.addEventListener("click", (e) => {
      const c = (sel) => e.target.closest(sel); let pk;
      if (e.target === ov || c("[data-card-close]")) { close(); return; }
      if (c("[data-card-dbtoggle]")) { dbOpen = !dbOpen; draw(); return; }
      if ((pk = c("[data-card-pick]"))) {
        const found = cardDbByType(item.type).find((x) => String(x.id) === String(pk.dataset.cardPick));
        if (found) { curPrice = String(found.price); linkedId = String(found.id); }
        draw(); return;
      }
      if (c("[data-card-save]")) {
        const inp = ov.querySelector(".ep-card-price"); const val = inp ? cardNum(inp.value) : cardNum(curPrice);
        const d = Draft(); if (d && d.setPrice) d.setPrice(item.id, val, linkedId);
        close(); renderHomeSummary(); flash("Цена сохранена");
        return;
      }
    });
    ov.addEventListener("input", (e) => {
      const t = e.target;
      if (t.classList && t.classList.contains("ep-card-price")) { curPrice = t.value; if (linkedId) { linkedId = ""; const ln = ov.querySelector(".ep-card-linked"); if (ln) ln.remove(); } return; }
      if (t.classList && t.classList.contains("ep-card-search")) { q = t.value; const box = ov.querySelector(".ep-card-dblist"); if (box) box.innerHTML = dbList(); return; }
    });
    draw();
  }

  /* ---------- генератор работ из материалов (универсально, по активной БД) ---------- */
  function cableSection(name) { const m = String(name || "").match(/[x×хХ*]\s*(\d+(?:[.,]\d+)?)/i); return m ? parseFloat(m[1].replace(",", ".")) : 0; }
  function pickCableWork(cand, matName) {
    const sec = cableSection(matName); let p = null;
    if (sec && sec <= 4) p = cand.find(w => /до\s*4|1[.,]5|2[.,]5|[x×хХ*]\s*[1-4]\b/i.test(w.name || ""));
    else if (sec && sec <= 10) p = cand.find(w => /6\s*мм|10\s*мм|[x×хХ*]\s*(6|10)\b/i.test(w.name || ""));
    else if (sec > 10) p = cand.find(w => /1[0-9]|2[0-9]|3[0-9]/.test(w.name || ""));
    return p || cand[0] || null;
  }
  // правила: какой материал → какую работу искать в БД (по ключевым словам, не по точному имени)
  // ВНИМАНИЕ: \w в JS не матчит кириллицу — используем .{0,N}
  const WORK_RULES = [
    { name: "кабель",
      matchMat: n => /(кабел|ввг|nym|пвс|кввг|сип|пунп|провод|пугв|пв-?\d|шввп)/i.test(n) && !/(стяжк|канал|лоток|короб|гофр|наконечник|маркир|клемм|гильз|хомут|дюбель|скоб)/i.test(n),
      workKw: /(укладк|проклад|монтаж|затяг|прокид|завод).{0,10}(кабел|провод)|(кабел|провод).{0,22}(штроб|штраб|гофр|лоток|труб|канал)/i, cable: true },
    { name: "подрозетник",
      matchMat: n => /(подрозетник|установочн.{0,8}короб)/i.test(n) && !/распред/i.test(n),
      workKw: /(подрозетник|установочн.{0,8}короб)/i, prefer: /(монтаж|установ|высверл|сверл|устройств)/i },
    { name: "распайка",
      matchMat: n => /(распа.{0,3}ч|распред.{0,12}короб)/i.test(n),
      workKw: /(распа.{0,4}ч|распред.{0,14}короб)/i, prefer: /(монтаж|установ|расключ)/i },
    { name: "механизм",
      matchMat: n => /(розетк|выключател|диммер|кнопк|механизм|переключател|терморегулятор|термостат)/i.test(n) && !/(подрозетник|распа|распред|din|дин|автомат|узо|дифф)/i.test(n),
      workKw: /(внутренн.{0,6}точк|устан.{0,16}(розетк|выключател|механизм|диммер|термо)|монтаж.{0,16}(розетк|выключател|механизм|диммер|термо)|подключ.{0,16}(розетк|выключател|механизм|диммер|термо|точк))/i, prefer: /(установ|монтаж|подключ)/i }
  ];
  function pickWork(works, rule, matName) {
    let cand = works.filter(w => rule.workKw.test(w.name || ""));
    cand = cand.filter(w => !/демонтаж|снят|удален|разбор/i.test(w.name || "")); // не берём демонтажные
    if (!cand.length) return null;
    if (rule.cable) return pickCableWork(cand, matName);
    if (rule.name === "механизм") {
      const vt = cand.find(w => /внутренн.{0,6}точк/i.test(w.name || "")); if (vt) return vt; // универсальная «внутренняя точка»
      const sub = /выключател|переключател/i.test(matName) ? /выключател|переключател/i
        : /диммер/i.test(matName) ? /диммер/i
        : /розетк/i.test(matName) ? /розетк/i
        : /термо/i.test(matName) ? /термо/i : null;
      if (sub) { const s = cand.find(w => sub.test(w.name || "")); if (s) return s; }
      return cand[0];
    }
    if (rule.prefer) { const p = cand.find(w => rule.prefer.test(w.name || "")); if (p) return p; }
    return cand[0];
  }
  function genWorksFromDraft() {
    const d = Draft(), db = DB(); if (!d || !db || !db.getItemsByType) return 0;
    const works = db.getItemsByType("work", activeBase()) || [];
    const mats = d.getItems().filter(x => x.type !== "work");
    const acc = {}; const missing = [];
    mats.forEach(m => {
      const rule = WORK_RULES.find(r => r.matchMat(m.name || "")); if (!rule) return;
      const w = pickWork(works, rule, m.name);
      if (!w) { missing.push((m.name || "") + " → нет работы «" + rule.name + "» в базе"); return; }
      const q = Number(m.qty) || 0; if (q <= 0) return;
      if (acc[w.id]) acc[w.id].qty += q; else acc[w.id] = { w: w, qty: q };
    });
    const list = Object.keys(acc).map(k => { const { w, qty } = acc[k]; return { sourceId: w.id, type: "work", name: w.name, unit: w.unit || "шт", price: Number(w.price) || 0, qty: qty, source: "autowork" }; });
    d.setSourceItems("autowork", list);
    try { if (missing.length && window.EP && EP.Log) EP.Log.warn("Работы не найдены в базе: " + missing.join("; ")); } catch (e) {}
    return list.length;
  }

  /* ---------- единый делегированный клик ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target;
    let el;
    const root = document.getElementById("ep-pick-root");
    if (root && root.contains(t)) {
      if ((el = t.closest("[data-pick-folder]"))) { const k = currentType + "::" + el.dataset.pickFolder; expanded[k] = !expanded[k]; renderPicker(currentType); return; }
      if ((el = t.closest("[data-pick-add]"))) { openQtyForPick(el.dataset.pickAdd); return; }
      if ((el = t.closest("[data-pick-base]"))) { toggleBase(); return; }
      if ((el = t.closest("[data-pick-estimate]"))) { if (window.EP && window.EP.Router) window.EP.Router.go("estimate"); return; }
    }
    // кнопки блока «Предварительная смета» на главной
    if ((el = t.closest("[data-est-inc]"))) { const d = Draft(); if (d) { const it = d.getItems().find(x => x.id === el.dataset.estInc); if (it) d.setQty(it.id, (Number(it.qty) || 0) + 1); } return; }
    if ((el = t.closest("[data-est-dec]"))) { const d = Draft(); if (d) { const it = d.getItems().find(x => x.id === el.dataset.estDec); if (it) { const q = (Number(it.qty) || 0) - 1; if (q <= 0) d.removeItem(it.id); else d.setQty(it.id, q); } } return; }
    if ((el = t.closest("[data-est-remove]"))) { const d = Draft(); if (d) d.removeItem(el.dataset.estRemove); return; }
    if ((el = t.closest("[data-est-card]"))) { const d = Draft(); if (d) { const it = d.getItems().find((x) => x.id === el.dataset.estCard); if (it) showItemCard(it); } return; }
    if ((el = t.closest("[data-est-reserve-step]"))) { const cu = window.EP && window.EP.ConsumablesUI; if (cu && cu.setReserve) { const cur = cu.getReserve ? cu.getReserve() : 0; cu.setReserve(Math.max(0, cur + (Number(el.dataset.estReserveStep) || 0))); } return; }
    if ((el = t.closest("[data-est-genworks]"))) { const cnt = genWorksFromDraft(); flash(cnt ? ("Добавлено работ из материалов: " + cnt) : "Подходящих работ в базе не нашлось"); return; }
    if ((el = t.closest("[data-est-savebase]"))) { saveDraftToBase(); return; }
    if ((el = t.closest("[data-est-open]"))) { if (window.EP && window.EP.Router) window.EP.Router.go("estimate"); return; }
    if ((el = t.closest("[data-est-clear]"))) { const d = Draft(); if (d && (d.count() === 0 || confirm("Очистить предварительную смету?"))) { d.clear(); renderHomeSummary(); flash("Смета очищена"); } return; }
    if ((el = t.closest("[data-est-save]"))) { flash("Черновик сохранён"); if (window.EP && window.EP.Router) window.EP.Router.go("estimate"); return; }
    if ((el = t.closest("[data-est-tomain]"))) { const d = Draft(); const m = window.EP && window.EP.Estimate; if (d && m) { if (d.count() === 0) { flash("Предварительная пуста"); return; } const n = m.mergeItems(d.getItems()); d.clear(); renderHomeSummary(); flash("В основную добавлено: " + n); } return; }
    if ((el = t.closest("[data-estmain-clear]"))) { const m = window.EP && window.EP.Estimate; if (m && (m.count() === 0 || confirm("Очистить основную смету?"))) { m.clear(); renderHomeSummary(); flash("Основная смета очищена"); } return; }
  });

  /* ---------- тост ---------- */
  let flashEl;
  function flash(msg) {
    try {
      if (!flashEl) { flashEl = document.createElement("div"); flashEl.className = "ep-pick-flash"; document.body.appendChild(flashEl); }
      flashEl.textContent = msg; flashEl.classList.add("show");
      clearTimeout(flash._t); flash._t = setTimeout(() => flashEl && flashEl.classList.remove("show"), 1600);
    } catch (e) {}
  }

  /* ---------- монтаж по маршруту + живое обновление ---------- */
  window.addEventListener("ep:route-loaded", (e) => {
    const route = e && e.detail && e.detail.route;
    if (route === "materials" || route === "work") { currentType = TYPE_BY_ROUTE[route]; renderPicker(currentType); }
    else if (route === "main") { renderHomeSummary(); }
  });
  window.addEventListener("ep:estimate-draft-changed", () => {
    renderHomeSummary();
    if (currentType && document.getElementById("ep-pick-root")) renderPicker(currentType);
  });
  window.addEventListener("ep:estimate-main-changed", () => { renderHomeSummary(); });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.hasAttribute && t.hasAttribute("data-est-price")) { const d = Draft(); if (d && d.setPrice) { d.setPrice(t.getAttribute("data-est-price"), t.value); renderHomeSummary(); } }
    if (t && t.hasAttribute && t.hasAttribute("data-est-reserve")) { const cu = window.EP && window.EP.ConsumablesUI; if (cu && cu.setReserve) cu.setReserve(Math.max(0, Number(t.value) || 0)); }
  });
})();
