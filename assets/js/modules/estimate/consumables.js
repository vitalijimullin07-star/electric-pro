/* Electric Pro V29 — Этап 4. Калькулятор расходников (мелочёвка по нормам).
   Параметры проекта (авто из сборника + ручная правка) × нормы (правятся, вкл/выкл) + запас %
   → позиции улетают в «Поставщику» (источник "consumables"), цена дозаполняется из каталога. */
(() => {
  "use strict";
  const KEY = "ep_consumables_v29";
  function Draft() { return (window.EP && window.EP.Estimate) || null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // нормы по умолчанию (подрозетник и коробочные клеммы выкл — их обычно считает пул)
  const DEFAULT_NORMS = [
    { key: "klemmy_t", name: "Клеммы Wago", unit: "шт", per: "points", qtyPer: 2, on: true },
    { key: "gofra", name: "Гофра / труба", unit: "м", per: "points", qtyPer: 0.5, on: false },
    { key: "podroz", name: "Подрозетник", unit: "шт", per: "points", qtyPer: 1, on: false },
    { key: "klipsa", name: "Дюбель-хомут / клипса", unit: "шт", per: "cableM", qtyPer: 2, on: true },
    { key: "styazhka", name: "Стяжка кабельная", unit: "шт", per: "cableM", qtyPer: 1, on: true },
    { key: "klemmy_b", name: "Клеммы Wago", unit: "шт", per: "boxes", qtyPer: 5, on: false },
    { key: "gips", name: "Гипс / алебастр", unit: "кг", per: "boxes", qtyPer: 0.1, on: true },
    { key: "pugv", name: "Провод ПУГВ", unit: "м", per: "modules", qtyPer: 0.3, on: true },
    { key: "nshvi", name: "Наконечник НШВИ", unit: "шт", per: "modules", qtyPer: 2, on: true },
    { key: "marker", name: "Маркировка", unit: "шт", per: "modules", qtyPer: 1, on: true },
    { key: "izolenta", name: "Изолента", unit: "шт", per: "project", qtyPer: 2, on: true },
    { key: "termo", name: "Термоусадка", unit: "уп", per: "project", qtyPer: 1, on: true }
  ];
  const PER_LABEL = { points: "на точку", cableM: "на метр", boxes: "на коробку", modules: "на модуль", project: "на объект" };

  let state = null;
  function load() {
    if (state) return state;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) {}
    const norms = DEFAULT_NORMS.map(d => {
      const s = (saved.norms || []).find(x => x.key === d.key) || {};
      return Object.assign({}, d, { qtyPer: s.qtyPer != null ? s.qtyPer : d.qtyPer, on: s.on != null ? s.on : d.on });
    });
    state = { norms, zapas: saved.zapas != null ? saved.zapas : 12, params: saved.params || null };
    return state;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ norms: state.norms.map(n => ({ key: n.key, qtyPer: n.qtyPer, on: n.on })), zapas: state.zapas, params: state.params })); } catch (e) {}
  }

  // авто-параметры из общего сборника (эвристика, всё правится вручную)
  function autoParams() {
    const d = Draft(); const items = d ? d.getItems() : [];
    const cntName = (re) => items.filter(x => re.test(x.name || "")).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const cntUnit = (re, ure) => items.filter(x => re.test(x.name || "") && ure.test(x.unit || "")).reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const points = Math.round(cntName(/подрозетник/i) || cntName(/розетк|выключател|светильник|датчик/i));
    const cableM = Math.round(cntUnit(/кабель|ввг|nym|пвс|сип|провод/i, /м|m/i));
    const boxes = Math.round(cntName(/коробк|распайк|распаеч/i));
    const modules = Math.round(cntName(/автомат|диф|узо/i));
    return { points: points || 0, cableM: cableM || 0, boxes: boxes || 0, modules: modules || 0 };
  }
  function params() {
    if (!state.params) state.params = autoParams();
    return state.params;
  }

  function compute() {
    const p = params();
    const k = 1 + (Number(state.zapas) || 0) / 100;
    return state.norms.filter(n => n.on).map(n => {
      const base = n.per === "project" ? Number(n.qtyPer) : (Number(p[n.per]) || 0) * Number(n.qtyPer);
      let qty = base * k;
      qty = (n.unit === "шт" || n.unit === "уп") ? Math.ceil(qty) : Math.round(qty * 100) / 100;
      return { type: "material", name: n.name, unit: n.unit, qty, price: 0 };
    }).filter(x => x.qty > 0);
  }

  function previewHtml() {
    const items = compute();
    if (!items.length) return '<div class="ep-db-empty">Включи нормы и задай параметры — расчёт появится здесь.</div>';
    return items.map(x => `<div class="ep-cons-prow"><span>${esc(x.name)}</span><b>${x.qty} ${esc(x.unit)}</b></div>`).join("");
  }
  function updatePreview() {
    const box = document.getElementById("ep-cons-preview");
    if (box) box.innerHTML = previewHtml();
  }

  function renderShell() {
    const root = document.getElementById("ep-consumables-root");
    if (!root) return;
    load();
    const p = params();
    const field = (key, label) => `<label class="ep-cons-field"><span>${label}</span><input type="number" inputmode="numeric" min="0" data-cons-param="${key}" value="${Number(p[key]) || 0}"></label>`;
    const normRow = (n) => `
      <div class="ep-cons-norm">
        <label class="ep-cons-chk"><input type="checkbox" data-cons-on="${n.key}" ${n.on ? "checked" : ""}><span>${esc(n.name)}</span></label>
        <span class="ep-cons-per">${PER_LABEL[n.per]}</span>
        <input class="ep-cons-qty" type="number" inputmode="decimal" min="0" step="0.1" data-cons-qty="${n.key}" value="${n.qtyPer}">
        <span class="ep-cons-unit">${esc(n.unit)}</span>
      </div>`;
    root.innerHTML = `
      <div class="ep-cons">
        <div class="ep-cons-sec">
          <div class="ep-cons-h">Параметры проекта <button type="button" class="ep-cons-auto" data-cons-auto>↻ Авто из сметы</button></div>
          <div class="ep-cons-params">
            ${field("points", "Точки")}${field("cableM", "Кабель, м")}${field("boxes", "Коробки")}${field("modules", "Модули щита")}
          </div>
        </div>
        <div class="ep-cons-sec">
          <div class="ep-cons-h">Нормы расхода</div>
          <div class="ep-cons-hint">Отключи то, что уже считает пул или щит, чтобы не задвоить.</div>
          <div class="ep-cons-norms">${state.norms.map(normRow).join("")}</div>
        </div>
        <div class="ep-cons-sec">
          <label class="ep-cons-field ep-cons-zapas"><span>Запас, %</span><input type="number" inputmode="numeric" min="0" data-cons-zapas value="${Number(state.zapas) || 0}"></label>
        </div>
        <div class="ep-cons-sec">
          <div class="ep-cons-h">Расчёт</div>
          <div id="ep-cons-preview" class="ep-cons-prev">${previewHtml()}</div>
        </div>
        <div class="ep-cons-actions">
          <button type="button" class="btn btn-primary ep-clickable" data-cons-add>Добавить в смету (Поставщику)</button>
          <button type="button" class="btn btn-ghost ep-clickable" data-route="details">Открыть «Поставщику»</button>
          <button type="button" class="btn btn-ghost ep-clickable" data-route="main">На главный</button>
        </div>
      </div>`;
  }

  function flash(msg) {
    try {
      let el = document.getElementById("ep-collector-flash");
      if (!el) { el = document.createElement("div"); el.id = "ep-collector-flash"; el.className = "ep-pick-flash"; document.body.appendChild(el); }
      el.textContent = msg; el.classList.add("show");
      clearTimeout(flash._t); flash._t = setTimeout(() => el && el.classList.remove("show"), 1800);
    } catch (e) {}
  }

  function addToEstimate() {
    const d = Draft(); if (!d) return;
    const items = compute();
    if (!items.length) { flash("Нет включённых норм / параметров"); return; }
    if (window.EP && window.EP.Collector && window.EP.Collector.fillPrices) window.EP.Collector.fillPrices(items);
    d.setSourceItems("consumables", items);
    flash("Расходники в смете: " + items.length + " позиц.");
  }

  // ввод параметров/норм — без полного перерендера (не теряем фокус), обновляем только расчёт
  document.addEventListener("input", (e) => {
    const t = e.target; if (!t || !t.getAttribute) return;
    if (!document.getElementById("ep-consumables-root")) return;
    load();
    if (t.hasAttribute("data-cons-param")) { params()[t.getAttribute("data-cons-param")] = Number(t.value) || 0; save(); updatePreview(); }
    else if (t.hasAttribute("data-cons-qty")) { const n = state.norms.find(x => x.key === t.getAttribute("data-cons-qty")); if (n) { n.qtyPer = Number(t.value) || 0; save(); updatePreview(); } }
    else if (t.hasAttribute("data-cons-zapas")) { state.zapas = Number(t.value) || 0; save(); updatePreview(); }
  });
  document.addEventListener("change", (e) => {
    const t = e.target; if (!t || !t.hasAttribute) return;
    if (t.hasAttribute("data-cons-on")) { load(); const n = state.norms.find(x => x.key === t.getAttribute("data-cons-on")); if (n) { n.on = !!t.checked; save(); updatePreview(); } }
  });
  document.addEventListener("click", (e) => {
    const t = e.target; if (!t || !t.closest) return;
    if (t.closest("[data-cons-auto]")) { load(); state.params = autoParams(); save(); renderShell(); flash("Параметры обновлены из сметы"); return; }
    if (t.closest("[data-cons-add]")) { addToEstimate(); return; }
  });

  window.addEventListener("ep:route-loaded", (e) => {
    const route = e && e.detail && e.detail.route;
    if (route === "consumables") renderShell();
  });
})();
