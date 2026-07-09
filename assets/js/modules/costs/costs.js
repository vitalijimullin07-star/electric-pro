/* Electric Pro V29 — Этап 9. Затраты по проекту: доход (из сметы или вручную),
   план затрат (материалы по смете + прочее), факт (журнал реальных трат) → прибыль план/факт и маржа. */
(() => {
  "use strict";
  const KEY = "ep_costs_v29";
  const CATS = [["materials", "Материалы"], ["help", "Помощники"], ["transport", "Транспорт"], ["tools", "Инструмент"], ["other", "Прочее"]];
  const CAT_LABEL = CATS.reduce((a, [k, v]) => (a[k] = v, a), {});
  function Draft() { return (window.EP && EP.Estimate) || null; }
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function uid() { return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function money(v) { try { if (window.EPCurrency && EPCurrency.format) return EPCurrency.format(v); } catch (e) {} return num(v).toFixed(2) + " \u20bd"; }

  let st = null;
  const DEFAULT_PRESETS = [
    { id: "p_benz", name: "Бензин", price: 0, cat: "transport" },
    { id: "p_taxi", name: "Грузовое такси", price: 0, cat: "transport" },
    { id: "p_musor", name: "Мешки мусорные", price: 0, cat: "other" },
    { id: "p_pylesos", name: "Мешки/фильтры пылесоса", price: 0, cat: "other" },
    { id: "p_shpatel", name: "Шпатели", price: 0, cat: "tools" }
  ];
  const DEFAULT_WEAR = [
    { id: "w_kor_bet", name: "Коронка по бетону", price: 0, resource: 0, unit: "подрозетников" },
    { id: "w_kor_kir", name: "Коронка по кирпичу", price: 0, resource: 0, unit: "подрозетников" },
    { id: "w_disk_otr", name: "Диск отрезной", price: 0, resource: 0, unit: "м" }
  ];
  function fmtDate(ts) { if (!ts) return ""; try { return new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }); } catch (e) { return ""; } }
  function load() { if (st) return st; const s = read(); st = { income: s.income != null ? s.income : null, planExtra: num(s.planExtra), actuals: Array.isArray(s.actuals) ? s.actuals : [], presets: Array.isArray(s.presets) && s.presets.length ? s.presets : DEFAULT_PRESETS.slice(), wear: Array.isArray(s.wear) && s.wear.length ? s.wear : DEFAULT_WEAR.slice() }; return st; }
  function save() { load(); write({ income: st.income, planExtra: st.planExtra, actuals: st.actuals, presets: st.presets, wear: st.wear }); syncPush(); }

  // коронки/диски: при вводе цены записываем/обновляем их в Моей БД (раздел материалов)
  function upsertWearToDb(w) {
    try {
      if (!window.EP || !EP.Database || !EP.Database.addMyItem) return;
      if (!w || !w.name || !(num(w.price) > 0)) return;
      const nm = s => String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
      const mats = (EP.Database.getItemsByType ? (EP.Database.getItemsByType("material", "my") || []) : []);
      const ex = mats.find(x => nm(x.name) === nm(w.name));
      if (ex) { if (EP.Database.updateMyItem) EP.Database.updateMyItem(ex.id, { price: num(w.price), unit: w.unit || ex.unit || "шт" }); }
      else { EP.Database.addMyItem({ type: "material", name: w.name, price: num(w.price), unit: w.unit || "шт", category: "Расходный инструмент" }); }
    } catch (e) {}
  }

  function estimateTotal() { const d = Draft(); if (!d) return 0; return (d.getItems() || []).reduce((s, x) => s + num(x.price) * num(x.qty), 0); }
  function planMaterials() { const d = Draft(); if (!d) return 0; return (d.getItems() || []).filter(x => x.type === "material").reduce((s, x) => s + num(x.price) * num(x.qty), 0); }
  function income() { load(); return st.income != null ? num(st.income) : estimateTotal(); }
  function planTotal() { load(); return planMaterials() + num(st.planExtra); }
  function actualTotal() { load(); return st.actuals.reduce((s, x) => s + num(x.amount), 0); }
  function profitPlan() { return income() - planTotal(); }
  function profitFact() { return income() - actualTotal(); }

  function addActual(cat, amount, note) { load(); const a = num(amount); if (a <= 0) return false; st.actuals.push({ id: uid(), cat: cat || "other", amount: a, note: note || "", ts: Date.now() }); save(); return true; }
  // авто-расход (заменяемый): убирает прежние авто-записи этой категории и ставит одну новую — без дублей
  function setAuto(cat, amount, note) {
    load(); const a = num(amount);
    st.actuals = st.actuals.filter(x => !(x && x.auto && x.cat === cat));
    if (a > 0) st.actuals.push({ id: uid(), cat: cat || "auto", amount: a, note: note || "", auto: true, ts: Date.now() });
    save(); return true;
  }

  window.EP = window.EP || {};
  EP.Costs = { income, planTotal, actualTotal, profitPlan, profitFact, addActual, setAuto };

  /* ---------- UI ---------- */
  function summaryHtml() {
    const inc = income(), pp = profitPlan(), pf = profitFact();
    const margin = inc > 0 ? Math.round(pf / inc * 100) : 0;
    const cls = v => v >= 0 ? "pos" : "neg";
    return `
      <div class="ep-cost-sum-row"><span>Доход</span><b>${money(inc)}</b></div>
      <div class="ep-cost-sum-row"><span>Прибыль (план)</span><b class="${cls(pp)}">${money(pp)}</b></div>
      <div class="ep-cost-sum-row"><span>Прибыль (факт)</span><b class="${cls(pf)}">${money(pf)}</b></div>
      <div class="ep-cost-sum-row mut"><span>Маржа (факт)</span><b>${margin}%</b></div>`;
  }
  function render() {
    const root = document.getElementById("ep-costs-root"); if (!root) return;
    load();
    const acts = st.actuals.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const actList = acts.length ? acts.map(a => `
      <div class="ep-cost-row">
        <div class="ep-cost-cat">${esc(CAT_LABEL[a.cat] || "Прочее")}${a.ts ? ` <span class="ep-cost-date">${fmtDate(a.ts)}</span>` : ""}</div>
        <div class="ep-cost-note">${esc(a.note || "")}${a.auto ? ` <span class="ep-cost-auto">авто</span>` : ""}</div>
        <div class="ep-cost-amt">${money(a.amount)}</div>
        <button type="button" class="ep-stock-del" data-cost-del="${a.id}">✕</button>
      </div>`).join("") : `<div class="ep-db-empty">Пока нет фактических трат. Добавляй по мере расходов.</div>`;
    const presetsHtml = (st.presets || []).map(p => `
      <div class="ep-cost-preset">
        <button type="button" class="ep-cost-padd ep-clickable" data-cost-preset-add="${p.id}" title="Добавить в факт">＋</button>
        <div class="ep-cost-pname">${esc(p.name)}</div>
        <input class="ep-cost-pprice" type="number" inputmode="decimal" min="0" step="1" data-cost-preset-price="${p.id}" value="${p.price || ""}" placeholder="₽">
        <button type="button" class="ep-cost-pdel" data-cost-preset-del="${p.id}">✕</button>
      </div>`).join("");
    const wearHtml = (st.wear || []).map(w => {
      const res = num(w.resource), pr = num(w.price);
      const perUse = res > 0 ? pr / res : 0;
      return `
      <div class="ep-cost-wearrow">
        <div class="ep-cost-wn"><span>${esc(w.name)}</span><button type="button" class="ep-cost-pdel" data-cost-wear-del="${w.id}">✕</button></div>
        <div class="ep-cost-wf">
          <span class="ep-stock-x">цена</span><input class="ep-cost-wi" type="number" inputmode="decimal" min="0" step="1" data-cost-wear-price="${w.id}" value="${w.price || ""}" placeholder="₽">
          <span class="ep-stock-x">хватает на</span><input class="ep-cost-wi" type="number" inputmode="decimal" min="0" step="1" data-cost-wear-res="${w.id}" value="${w.resource || ""}" placeholder="N">
          <input class="ep-cost-wu" type="text" data-cost-wear-unit="${w.id}" value="${esc(w.unit || "")}" placeholder="ед">
          ${perUse > 0 ? `<span class="ep-cost-wper">${money(perUse)}/шт</span>` : ""}
        </div>
        <div class="ep-cost-wf">
          <span class="ep-stock-x">израсходовано</span><input class="ep-cost-wi" type="number" inputmode="decimal" min="0" step="1" data-cost-wear-used="${w.id}" placeholder="0">
          <button type="button" class="ep-cost-padd ep-clickable" data-cost-wear-add="${w.id}" title="Посчитать износ и добавить в факт">＋ в факт</button>
        </div>
      </div>`;
    }).join("");
    const catOpts = CATS.map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    root.innerHTML = `
      <div class="ep-costs">
        <div class="ep-cost-summary" id="ep-costs-summary">${summaryHtml()}</div>

        <div class="ep-cons-sec">
          <div class="ep-cons-h">Доход проекта</div>
          <div class="ep-cost-income">
            <input data-cost-income type="number" inputmode="decimal" min="0" value="${income()}">
            <button type="button" class="btn btn-ghost ep-clickable" data-cost-fromest>Из сметы</button>
          </div>
          <div class="ep-stock-hint">Сумма, которую платит заказчик. «Из сметы» подставит итог сметы; можно вписать договорную.</div>
        </div>

        <div class="ep-cons-sec">
          <div class="ep-cons-h">План затрат</div>
          <div class="ep-cost-prow"><span>Материалы (по смете)</span><b>${money(planMaterials())}</b></div>
          <label class="ep-prof-f"><span>Прочее (план): транспорт, помощники…</span><input data-cost-planextra type="number" inputmode="decimal" min="0" value="${num(st.planExtra)}"></label>
          <div class="ep-cost-prow tot"><span>Итого план</span><b>${money(planTotal())}</b></div>
        </div>

        <div class="ep-cons-sec">
          <div class="ep-cons-h">Мои расходы — быстро в факт</div>
          <div class="ep-cost-presets">${presetsHtml}</div>
          <div class="ep-cost-padd-new">
            <input data-cost-preset-newname type="text" placeholder="новый расход (напр. парковка)">
            <input data-cost-preset-newprice type="number" inputmode="decimal" min="0" step="1" placeholder="₽">
            <button type="button" class="btn btn-ghost ep-clickable" data-cost-preset-new>＋ пресет</button>
          </div>
          <div class="ep-stock-hint">Укажи цену один раз — потом «＋» добавляет расход в факт одним тапом (с датой). Амортизация крупного инструмента уже попадает в факт сама.</div>
        </div>

        <div class="ep-cons-sec">
          <div class="ep-cons-h">Износ расходников (коронки, диски)</div>
          <div class="ep-cost-wear">${wearHtml}</div>
          <div class="ep-cost-padd-new">
            <input data-cost-wear-newname type="text" placeholder="новая позиция (напр. бур SDS)">
            <button type="button" class="btn btn-ghost ep-clickable" data-cost-wear-new>＋ позиция</button>
          </div>
          <div class="ep-stock-hint">Цена и на сколько хватает (ресурс) — задаёшь один раз. Впиши, сколько израсходовал на объекте → стоимость износа посчитается (цена ÷ ресурс × расход) и упадёт в факт.</div>
        </div>

        <div class="ep-cons-sec">
          <div class="ep-cons-h">Факт затрат</div>
          <div class="ep-cost-add">
            <select data-cost-newcat>${catOpts}</select>
            <input data-cost-newamt type="number" inputmode="decimal" min="0" placeholder="сумма">
            <button type="button" class="btn btn-primary ep-clickable" data-cost-add>＋</button>
            <input data-cost-newnote type="text" placeholder="комментарий">
          </div>
          <div class="ep-cost-list">${actList}</div>
          <div class="ep-cost-prow tot"><span>Итого факт</span><b>${money(actualTotal())}</b></div>
          <div class="ep-cost-prow ${actualTotal() - planTotal() > 0 ? "over" : ""}"><span>Отклонение факт − план</span><b>${(actualTotal() - planTotal() >= 0 ? "+" : "") + money(actualTotal() - planTotal())}</b></div>
        </div>
        <div class="ep-prof-actions"><button type="button" class="btn btn-ghost ep-clickable" data-cost-export>📤 Экспорт журнала</button><button type="button" class="btn btn-ghost ep-clickable" data-route="main">На главный</button></div>
      </div>`;
  }
  function updateSummary() { const el = document.getElementById("ep-costs-summary"); if (el) el.innerHTML = summaryHtml(); }
  function flash(msg) {
    try {
      let el = document.getElementById("ep-collector-flash");
      if (!el) { el = document.createElement("div"); el.id = "ep-collector-flash"; el.className = "ep-pick-flash"; document.body.appendChild(el); }
      el.textContent = msg; el.classList.add("show");
      clearTimeout(flash._t); flash._t = setTimeout(() => el && el.classList.remove("show"), 1800);
    } catch (e) {}
  }

  document.addEventListener("input", (e) => {
    const t = e.target; if (!t || !t.hasAttribute || !document.getElementById("ep-costs-root")) return;
    load();
    if (t.hasAttribute("data-cost-income")) { st.income = t.value === "" ? null : num(t.value); save(); updateSummary(); }
    else if (t.hasAttribute("data-cost-planextra")) { st.planExtra = num(t.value); save(); updateSummary(); }
    else if (t.hasAttribute("data-cost-preset-price")) { const p = (st.presets || []).find(x => x.id === t.getAttribute("data-cost-preset-price")); if (p) { p.price = num(t.value); save(); } }
    else if (t.hasAttribute("data-cost-wear-price")) { const w = (st.wear || []).find(x => x.id === t.getAttribute("data-cost-wear-price")); if (w) { w.price = num(t.value); save(); } }
    else if (t.hasAttribute("data-cost-wear-res")) { const w = (st.wear || []).find(x => x.id === t.getAttribute("data-cost-wear-res")); if (w) { w.resource = num(t.value); save(); } }
    else if (t.hasAttribute("data-cost-wear-unit")) { const w = (st.wear || []).find(x => x.id === t.getAttribute("data-cost-wear-unit")); if (w) { w.unit = String(t.value); save(); } }
  });
  document.addEventListener("change", (e) => {
    const t = e.target; if (!t || !t.hasAttribute || !document.getElementById("ep-costs-root")) return;
    if (t.hasAttribute("data-cost-planextra")) render(); // обновить «итого план»
    else if (t.hasAttribute("data-cost-wear-price") || t.hasAttribute("data-cost-wear-unit")) {
      load();
      const id = t.getAttribute("data-cost-wear-price") || t.getAttribute("data-cost-wear-unit");
      const w = (st.wear || []).find(x => x.id === id);
      if (w) upsertWearToDb(w); // вписал цену → коронка/диск появляется в БД материалов
    }
  });
  document.addEventListener("click", (e) => {
    const t = e.target; if (!t || !t.closest) return; let el;
    if (t.closest("[data-cost-fromest]")) { load(); st.income = estimateTotal(); save(); render(); return; }
    if (t.closest("[data-cost-add]")) {
      const root = document.getElementById("ep-costs-root"); if (!root) return;
      const cat = root.querySelector("[data-cost-newcat]"), amt = root.querySelector("[data-cost-newamt]"), note = root.querySelector("[data-cost-newnote]");
      const a = num(amt && amt.value);
      if (a <= 0) { flash("Введи сумму"); return; }
      load(); st.actuals.push({ id: uid(), cat: (cat && cat.value) || "other", amount: a, note: (note && note.value) || "" }); save(); render();
      return;
    }
    if ((el = t.closest("[data-cost-del]"))) { load(); st.actuals = st.actuals.filter(x => x.id !== el.getAttribute("data-cost-del")); save(); render(); return; }

    // пресеты «Мои расходы»
    if ((el = t.closest("[data-cost-preset-add]"))) {
      load(); const p = (st.presets || []).find(x => x.id === el.getAttribute("data-cost-preset-add"));
      if (!p) return;
      const pr = num(p.price); if (pr <= 0) { flash("Сначала укажи цену"); return; }
      st.actuals.push({ id: uid(), cat: p.cat || "other", amount: pr, note: p.name, ts: Date.now() }); save(); render(); flash(p.name + " → в факт");
      return;
    }
    if ((el = t.closest("[data-cost-preset-del]"))) { load(); st.presets = (st.presets || []).filter(x => x.id !== el.getAttribute("data-cost-preset-del")); save(); render(); return; }
    if (t.closest("[data-cost-preset-new]")) {
      const root = document.getElementById("ep-costs-root"); if (!root) return;
      const nm = root.querySelector("[data-cost-preset-newname]"), pr = root.querySelector("[data-cost-preset-newprice]");
      if (nm && nm.value.trim()) { load(); st.presets.push({ id: "p_" + uid(), name: nm.value.trim(), price: num(pr && pr.value), cat: "other" }); save(); render(); }
      else flash("Введи название");
      return;
    }

    // износ расходников (коронки/диски)
    if ((el = t.closest("[data-cost-wear-add]"))) {
      const root = document.getElementById("ep-costs-root"); if (!root) return;
      load(); const w = (st.wear || []).find(x => x.id === el.getAttribute("data-cost-wear-add")); if (!w) return;
      const usedEl = root.querySelector(`[data-cost-wear-used="${w.id}"]`);
      const used = num(usedEl && usedEl.value), res = num(w.resource), pr = num(w.price);
      if (pr <= 0 || res <= 0) { flash("Укажи цену и ресурс"); return; }
      if (used <= 0) { flash("Впиши, сколько израсходовал"); return; }
      const cost = Math.round(pr / res * used * 100) / 100;
      st.actuals.push({ id: uid(), cat: "tools", amount: cost, note: w.name + ": " + used + " " + (w.unit || "") + " (износ)", ts: Date.now() });
      upsertWearToDb(w);
      save(); render(); flash(w.name + ": износ " + money(cost) + " → в факт");
      return;
    }
    if ((el = t.closest("[data-cost-wear-del]"))) { load(); st.wear = (st.wear || []).filter(x => x.id !== el.getAttribute("data-cost-wear-del")); save(); render(); return; }
    if (t.closest("[data-cost-wear-new]")) {
      const root = document.getElementById("ep-costs-root"); if (!root) return;
      const nm = root.querySelector("[data-cost-wear-newname]");
      if (nm && nm.value.trim()) { load(); st.wear.push({ id: "w_" + uid(), name: nm.value.trim(), price: 0, resource: 0, unit: "шт" }); save(); render(); }
      else flash("Введи название");
      return;
    }

    if (t.closest("[data-cost-export]")) { exportCsv(); return; }
  });

  function exportCsv() {
    load();
    const q = c => /[",;\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c);
    const rows = [["Дата", "Категория", "Комментарий", "Сумма, руб"]];
    st.actuals.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(a => rows.push([fmtDate(a.ts), CAT_LABEL[a.cat] || "Прочее", (a.note || "") + (a.auto ? " (авто)" : ""), num(a.amount).toFixed(2)]));
    rows.push(["", "", "", ""]);
    rows.push(["Доход", "", "", income().toFixed(2)]);
    rows.push(["План затрат", "", "", planTotal().toFixed(2)]);
    rows.push(["Факт затрат", "", "", actualTotal().toFixed(2)]);
    rows.push(["Прибыль (факт)", "", "", profitFact().toFixed(2)]);
    const csv = "\uFEFF" + rows.map(r => r.map(q).join(";")).join("\r\n");
    const fname = "zatraty_" + new Date().toISOString().slice(0, 10) + ".csv";
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = fname; document.body.appendChild(a); a.click();
      setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 150);
      flash("CSV выгружен: " + fname);
    } catch (e) {
      try { if (navigator.share) { navigator.share({ title: "Затраты", text: csv }); return; } } catch (er) {}
      try { if (navigator.clipboard) { navigator.clipboard.writeText(csv); flash("Скопировано в буфер"); return; } } catch (er) {}
      flash("Не удалось выгрузить");
    }
  }

  window.addEventListener("ep:route-loaded", (e) => { const r = e && e.detail && e.detail.route; if (r === "costs") render(); });
  window.addEventListener("ep:estimate-main-changed", () => { if (document.getElementById("ep-costs-root")) updateSummary(); });

  // ---- облако (через общий EP.Cloud) ----
  function syncPush() { if (window.EP && window.EP.Cloud) { load(); window.EP.Cloud.push("costs", { income: st.income, planExtra: st.planExtra, actuals: st.actuals, presets: st.presets, wear: st.wear }); } }
  function syncPull() {
    if (!window.EP || !window.EP.Cloud) return;
    window.EP.Cloud.pull("costs").then(function (d) {
      if (!d) return;
      load();
      st.actuals = window.EP.Cloud.mergeById(st.actuals, d.actuals || []);
      if (st.income == null && d.income != null) st.income = d.income;
      if (!st.planExtra && d.planExtra) st.planExtra = num(d.planExtra);
      save();
      if (document.getElementById("ep-costs-root")) render();
    });
  }
  if (window.EP && window.EP.Cloud && window.EP.Cloud.onLogin) window.EP.Cloud.onLogin(syncPull);
  window.EP = window.EP || {};
  window.EP.Costs.getData = function () { return load(); };
  window.EP.Costs.syncPush = syncPush;
  window.EP.Costs.syncPull = syncPull;
})();
