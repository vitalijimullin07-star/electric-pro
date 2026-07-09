/* Electric Pro V29 — Инструмент: инвентарь + РЕСУРС инструмента.
   Технически сложный инструмент (АКБ/электро). Ресурс списывается по факту ПОСЛЕ сохранения сметы.
   Режимы ресурса:
     • material — по материалам (штроба: метры по Бетон/Кирпич/Панель/Мягкий; высверливание: шт);
     • hours    — по часам (часы прикидываются из часов работ сметы; пылесос = «уборка» = пыльные работы);
     • period   — по сроку (календарь, как раньше).
   Амортизация → «Затраты» (как раньше). Облако через общий EP.Cloud. */
(() => {
  "use strict";
  const KEY = "ep_tools_v29";
  const CONDS = [["new", "Новый"], ["work", "Рабочий"], ["repair", "Ремонт"], ["off", "Списан"]];
  const COND_LABEL = CONDS.reduce((a, [k, v]) => (a[k] = v, a), {});
  const MATS = ["Бетон", "Кирпич", "Панель", "Мягкий"];
  // нормы выработки (единиц в час) — для прикидки часов из сметы (редактируемо позже)
  const NORMS = [
    { re: /штроб/i, perHour: 10 },
    { re: /высверливани.{0,20}подрозетник|коронк/i, perHour: 8 },
    { re: /укладк.{0,4}кабел|проклад.{0,4}кабел|затягив/i, perHour: 30 },
    { re: /монтаж.{0,12}коробок|монтаж.{0,6}подрозетник|установочн.{0,8}коробок/i, perHour: 12 },
    { re: /внутренн.{0,4}точк|подключени.{0,12}розетк|выключател/i, perHour: 6 }
  ];
  const DEF_NORM = 8;

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "[]") || []; } catch (e) { return []; } }
  function write(a) { try { localStorage.setItem(KEY, JSON.stringify(a || [])); } catch (e) {} syncPush(); }
  function uid() { return "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function money(v) { try { if (window.EPCurrency && EPCurrency.format) return EPCurrency.format(v); } catch (e) {} return num(v).toFixed(2) + " \u20bd"; }

  function normTool(t) {
    t = t || {};
    return Object.assign({
      id: uid(), name: "", model: "", price: 0, buyDate: "", condition: "work", location: "",
      resMode: "period", workKind: "", unit: "м", cap: {}, hoursTotal: 0, used: 0, lifeMonths: 36, doneEstimates: [],
      boundWorks: [], capTotal: 0, unitName: "", consum: []
    }, t);
  }

  function getTools() { return read(); }
  function addTool(o) {
    o = o || {}; const a = read(); const name = String(o.name || "").trim(); if (!name) return;
    a.push(normTool({ name: name, model: o.model || "", price: num(o.price), resMode: o.resMode || "period", lifeMonths: num(o.lifeMonths) || 36, buyDate: o.buyDate || "", condition: o.condition || "work" }));
    write(a);
  }
  function setField(id, key, val) {
    const a = read(); const it = a.find(x => x.id === id); if (!it) return;
    if (["price", "lifeMonths", "hoursTotal", "used", "capTotal"].indexOf(key) >= 0) it[key] = num(val);
    else it[key] = val;
    if (key === "workKind") it.unit = (val === "подрозетник") ? "шт" : "м";
    write(a);
  }
  function setCap(id, mat, val) { const a = read(); const it = a.find(x => x.id === id); if (!it) return; it.cap = it.cap || {}; it.cap[mat] = num(val); write(a); }
  // ---- привязка к работам ----
  function dbWorks() {
    try { if (window.EP && EP.Database && EP.Database.getItemsByType) return (EP.Database.getItemsByType("work") || []).map(w => String(w.name || "").trim()).filter(Boolean); } catch (e) {}
    return [];
  }
  function bindWork(id, name) {
    name = String(name || "").trim(); if (!name) return;
    const a = read(); const it = a.find(x => x.id === id); if (!it) return;
    it.boundWorks = it.boundWorks || [];
    const low = name.toLowerCase(); const i = it.boundWorks.findIndex(b => String(b).toLowerCase() === low);
    if (i >= 0) it.boundWorks.splice(i, 1); else it.boundWorks.push(name);
    write(a);
  }
  function unbindWork(id, name) {
    const a = read(); const it = a.find(x => x.id === id); if (!it || !it.boundWorks) return;
    const low = String(name || "").toLowerCase();
    it.boundWorks = it.boundWorks.filter(b => String(b).toLowerCase() !== low);
    write(a);
  }
  // ---- расходники инструмента (на 1 использование) ----
  function addConsum(id, name, perUse, unit) {
    name = String(name || "").trim(); if (!name) return;
    const a = read(); const it = a.find(x => x.id === id); if (!it) return;
    it.consum = it.consum || [];
    it.consum.push({ name: name, perUse: num(perUse) || 1, unit: String(unit || "шт").trim() || "шт" });
    write(a);
  }
  function removeConsum(id, idx) {
    const a = read(); const it = a.find(x => x.id === id); if (!it || !it.consum) return;
    it.consum.splice(idx, 1); write(a);
  }
  // расходники по позициям сметы: для каждого инструмента (по работам) uses = сумма привязанных работ, расход = uses * perUse
  function consumablesForItems(items) {
    const a = read(); const out = [];
    a.forEach(t => {
      if (t.condition === "off" || t.resMode !== "works" || !(t.consum && t.consum.length)) return;
      let uses = 0;
      (items || []).forEach(it => {
        if (it.type !== "work") return;
        const nm = String(it.name || "").toLowerCase();
        if ((t.boundWorks || []).some(b => b && nm.indexOf(String(b).toLowerCase()) >= 0)) uses += num(it.qty);
      });
      if (uses <= 0) return;
      t.consum.forEach(c => {
        const qty = uses * num(c.perUse); if (qty <= 0) return;
        const u = c.unit || "шт"; const e = out.find(x => x.name === c.name && x.unit === u);
        if (e) e.qty += qty; else out.push({ name: c.name, qty: qty, unit: u, type: "material" });
      });
    });
    out.forEach(x => x.qty = Math.round(x.qty * 100) / 100);
    return out;
  }
  function estimateItems() { try { return (window.EP && EP.Estimate && EP.Estimate.getItems) ? (EP.Estimate.getItems() || []) : []; } catch (e) { return []; } }
  function addConsumablesToEstimate() {
    const list = consumablesForItems(estimateItems());
    if (!list.length) { flash("Нет расходников по текущей смете (привяжи работы и задай расходник)"); return; }
    try { if (window.EP && EP.Collector && EP.Collector.fillPrices) EP.Collector.fillPrices(list); } catch (e) {}
    const d = (window.EP && EP.Estimate && EP.Estimate.setSourceItems) ? EP.Estimate : ((window.EP && EP.EstimateDraft && EP.EstimateDraft.setSourceItems) ? EP.EstimateDraft : null);
    if (!d) { flash("Смета недоступна"); return; }
    d.setSourceItems("tools-consum", list);
    flash("Расходники инструмента в смете: " + list.length + " позиц. (см. «Поставщику»)");
  }
  function resetResource(id) { const a = read(); const it = a.find(x => x.id === id); if (it) { it.used = 0; it.doneEstimates = []; write(a); } }
  function removeTool(id) { write(read().filter(x => x.id !== id)); }

  // ---- разбор материала из названия работы ----
  function matOf(name) {
    const s = String(name || "").toLowerCase();
    if (/газобетон|пенобетон|пеноблок/.test(s)) return "Мягкий";
    if (/бетон/.test(s)) return "Бетон";
    if (/кирпич/.test(s)) return "Кирпич";
    if (/панел/.test(s)) return "Панель";
    if (/гипс|алебастр|мягк|дерев|гкл|газоблок/.test(s)) return "Мягкий";
    return null;
  }
  function normFor(name) { for (const n of NORMS) { if (n.re.test(name)) return n.perHour; } return DEF_NORM; }
  // часы для вида работ инструмента: "уборка" = пыльные работы, иначе все работы
  function hoursFor(items, kind) {
    let h = 0;
    (items || []).forEach(it => {
      if (it.type !== "work") return;
      const nm = String(it.name || "");
      let take = (kind === "уборка") ? /штроб|высверливани.{0,20}подрозетник|коронк|алмазн|сверлени/i.test(nm) : true;
      if (take) h += num(it.qty) / normFor(nm);
    });
    return h;
  }

  // ---- СПИСАНИЕ РЕСУРСА после сохранения сметы ----
  function consumeFromEstimate(items, estimateId) {
    if (!items || !items.length) return null;
    const a = read(); const report = [];
    a.forEach(t => {
      if (t.condition === "off") return;
      if (estimateId && (t.doneEstimates || []).indexOf(estimateId) >= 0) return; // один раз на смету
      let consumedPct = 0, info = "";
      if (t.resMode === "material") {
        const per = {};
        items.forEach(it => {
          if (it.type !== "work") return;
          const nm = String(it.name || "");
          let match = false;
          if (t.workKind === "штроба") match = /штроб/i.test(nm);
          else if (t.workKind === "подрозетник") match = /высверливани.{0,20}подрозетник|коронк|подрозетник/i.test(nm);
          if (!match) return;
          const m = matOf(nm); if (!m) return;
          const cap = num((t.cap || {})[m]); if (cap <= 0) return;
          consumedPct += num(it.qty) / cap * 100;
          per[m] = (per[m] || 0) + num(it.qty);
        });
        if (consumedPct > 0) { t.used = num(t.used) + consumedPct; info = Object.keys(per).map(k => Math.round(per[k] * 10) / 10 + (t.unit || "") + " " + k).join(", "); }
      } else if (t.resMode === "hours") {
        const h = hoursFor(items, t.workKind);
        if (h > 0) { t.used = num(t.used) + h; consumedPct = num(t.hoursTotal) > 0 ? h / num(t.hoursTotal) * 100 : 1; info = "~" + Math.round(h * 10) / 10 + " ч"; }
      } else if (t.resMode === "works") {
        let total = 0; const hits = {};
        items.forEach(it => {
          if (it.type !== "work") return;
          const nm = String(it.name || "").toLowerCase();
          const bw = (t.boundWorks || []).find(b => b && nm.indexOf(String(b).toLowerCase()) >= 0);
          if (!bw) return;
          total += num(it.qty); hits[bw] = (hits[bw] || 0) + num(it.qty);
        });
        if (total > 0) {
          t.used = num(t.used) + total;
          consumedPct = num(t.capTotal) > 0 ? total / num(t.capTotal) * 100 : 1;
          const u = t.unitName || "";
          info = Object.keys(hits).map(k => Math.round(hits[k] * 10) / 10 + u + " (" + k + ")").join(", ");
        }
      }
      if (consumedPct > 0 || info) {
        if (estimateId) { t.doneEstimates = t.doneEstimates || []; t.doneEstimates.push(estimateId); }
        report.push({ name: t.name, info: info });
      }
    });
    write(a);
    return report;
  }

  // ---- износ / остаток ----
  function monthsSince(d) { if (!d) return 0; const dt = new Date(d); if (isNaN(dt.getTime())) return 0; const now = new Date(); return Math.max(0, (now.getFullYear() - dt.getFullYear()) * 12 + (now.getMonth() - dt.getMonth())); }
  function wearPct(t) {
    if (t.resMode === "material") return Math.min(100, Math.max(0, Math.round(num(t.used))));
    if (t.resMode === "hours") return num(t.hoursTotal) > 0 ? Math.min(100, Math.round(num(t.used) / num(t.hoursTotal) * 100)) : 0;
    if (t.resMode === "works") return num(t.capTotal) > 0 ? Math.min(100, Math.round(num(t.used) / num(t.capTotal) * 100)) : 0;
    const life = num(t.lifeMonths) || 36; return t.buyDate ? Math.min(100, Math.round(monthsSince(t.buyDate) / life * 100)) : 0;
  }
  function remainText(t) {
    const rem = 100 - wearPct(t);
    if (t.resMode === "hours") return num(t.hoursTotal) > 0 ? ("осталось ~" + Math.max(0, Math.round(num(t.hoursTotal) - num(t.used))) + " ч из " + num(t.hoursTotal)) : "задай ресурс в часах";
    if (t.resMode === "works") return num(t.capTotal) > 0 ? ("осталось ~" + Math.max(0, Math.round(num(t.capTotal) - num(t.used))) + " " + (t.unitName || "ед") + " из " + num(t.capTotal)) : "задай, на сколько хватает";
    if (t.resMode === "material") {
      const m = MATS.find(x => num((t.cap || {})[x]) > 0);
      if (m) { const left = Math.max(0, Math.round(num(t.cap[m]) * (rem / 100))); return "ресурс ~" + rem + "% (≈" + left + " " + (t.unit || "") + " по «" + m + "»)"; }
      return "задай, на сколько хватает";
    }
    return t.buyDate ? ("износ " + wearPct(t) + "% (срок " + (num(t.lifeMonths) || 36) + " мес)") : "укажи дату покупки";
  }
  function lowRes(t) { return (100 - wearPct(t)) <= 20 && (t.resMode !== "material" || MATS.some(x => num((t.cap || {})[x]) > 0)) && (t.resMode !== "hours" || num(t.hoursTotal) > 0) && (t.resMode !== "works" || num(t.capTotal) > 0); }

  // амортизация по СРОКУ (помесячно) — только для режима «по сроку»; у ресурсных инструментов износ считается от работы
  function dep(t) { if (t.resMode !== "period") return 0; const life = num(t.lifeMonths) || 36; return num(t.price) / life; }
  function residual(t) {
    if (t.resMode === "period") { const acc = Math.min(num(t.price), dep(t) * monthsSince(t.buyDate)); return Math.max(0, num(t.price) - acc); }
    return Math.max(0, Math.round(num(t.price) * (1 - wearPct(t) / 100)));
  }
  // ---- износ инструмента от выполненной работы (доля израсходованного ресурса) ----
  function consumedFractionFor(t, items) {
    if (t.resMode === "works") {
      if (num(t.capTotal) <= 0) return 0;
      let total = 0;
      (items || []).forEach(it => { if (it.type !== "work") return; const nm = String(it.name || "").toLowerCase(); if ((t.boundWorks || []).some(b => b && nm.indexOf(String(b).toLowerCase()) >= 0)) total += num(it.qty); });
      return total / num(t.capTotal);
    }
    if (t.resMode === "hours") { return num(t.hoursTotal) > 0 ? hoursFor(items, t.workKind) / num(t.hoursTotal) : 0; }
    if (t.resMode === "material") {
      let frac = 0;
      (items || []).forEach(it => {
        if (it.type !== "work") return;
        const nm = String(it.name || "").toLowerCase();
        let match = false;
        if (t.workKind === "штроба") match = /штроб/i.test(nm);
        else if (t.workKind === "подрозетник") match = /высверливани.{0,20}подрозетник|коронк|подрозетник/i.test(nm);
        if (!match) return;
        const m = matOf(nm); if (!m) return;
        const cap = num((t.cap || {})[m]); if (cap <= 0) return;
        frac += num(it.qty) / cap;
      });
      return frac;
    }
    return 0; // period — износ не от сметы
  }
  // суммарная амортизация инструмента по позициям сметы (₽) + разбивка
  function depreciationForItems(items) {
    const a = read(); let total = 0; const parts = [];
    a.forEach(t => {
      if (t.condition === "off") return;
      const price = num(t.price); if (price <= 0) return;
      const frac = consumedFractionFor(t, items); if (frac <= 0) return;
      const cost = Math.round(price * Math.min(frac, 1) * 100) / 100; if (cost <= 0) return;
      total += cost; parts.push({ name: t.name, cost: cost });
    });
    return { total: Math.round(total * 100) / 100, parts: parts };
  }
  function totals() { const ts = read(); return { value: ts.reduce((s, t) => s + num(t.price), 0), perMonth: ts.reduce((s, t) => s + dep(t), 0), residual: ts.reduce((s, t) => s + residual(t), 0) }; }

  window.EP = window.EP || {};
  EP.Tools = { getTools: getTools, addTool: addTool, setField: setField, setCap: setCap, resetResource: resetResource, removeTool: removeTool, consumeFromEstimate: consumeFromEstimate, bindWork: bindWork, unbindWork: unbindWork, addConsum: addConsum, removeConsum: removeConsum, consumablesForItems: consumablesForItems, depreciationForItems: depreciationForItems };

  /* ---------- UI ---------- */
  const expanded = {};
  const searchText = {};
  function worksListHtml(t, filter) {
    const f = String(filter || "").toLowerCase().trim();
    const bound = (t.boundWorks || []).map(b => String(b).toLowerCase());
    let works = dbWorks();
    if (f) works = works.filter(w => w.toLowerCase().indexOf(f) >= 0);
    works = works.slice(0, 40);
    let rows = works.map(w => {
      const on = bound.indexOf(w.toLowerCase()) >= 0;
      return `<button type="button" class="ep-tool-wopt ${on ? "on" : ""}" data-tool-bind="${t.id}" data-bw="${esc(w)}">${on ? "✓ " : ""}${esc(w)}</button>`;
    }).join("");
    if (f && !works.some(w => w.toLowerCase() === f)) {
      rows += `<button type="button" class="ep-tool-wopt add" data-tool-bind="${t.id}" data-bw="${esc(String(filter).trim())}">+ привязать «${esc(String(filter).trim())}»</button>`;
    }
    if (!rows) rows = `<div class="ep-db-empty">Нет работ в базе. Введи название и нажми «+ привязать».</div>`;
    return rows;
  }
  function worksConfig(t) {
    const bound = (t.boundWorks || []);
    const chips = bound.length
      ? bound.map(b => `<span class="ep-tool-chip">${esc(b)}<button type="button" data-tool-unbind="${t.id}" data-bw="${esc(b)}">✕</button></span>`).join("")
      : `<span class="ep-tool-chip mut">пока ничего не привязано</span>`;
    return `
      <label class="ep-tool-f"><span>На сколько хватает, всего</span><input data-tool-captotal="${t.id}" type="number" inputmode="numeric" min="0" value="${num(t.capTotal) || ""}" placeholder="напр. 10000"></label>
      <label class="ep-tool-f"><span>Единица (выстрел/м/шт)</span><input data-tool-unitname="${t.id}" type="text" value="${esc(t.unitName || "")}" placeholder="выстрел"></label>
      <div class="ep-tool-bound">Привязано (из них считаем расход): ${chips}</div>
      <input class="ep-tool-search" data-tool-search="${t.id}" type="text" value="${esc(searchText[t.id] || "")}" placeholder="🔎 поиск работы для привязки…">
      <div class="ep-tool-works" id="tw-${t.id}">${worksListHtml(t, searchText[t.id] || "")}</div>
      <div class="ep-tool-bound">Расходник на 1 ${esc(t.unitName || "ед")} (→ в закупку): ${consumChips(t)}</div>
      <div class="ep-tool-consum-add">
        <input data-tc-name="${t.id}" type="text" placeholder="расходник (заряд)">
        <input data-tc-per="${t.id}" type="number" inputmode="decimal" min="0" placeholder="кол-во" value="1">
        <input data-tc-unit="${t.id}" type="text" placeholder="ед" value="шт">
        <button type="button" class="ep-tool-wopt add" data-tc-add="${t.id}">+ расходник</button>
      </div>`;
  }
  function consumChips(t) {
    const c = (t.consum || []);
    if (!c.length) return `<span class="ep-tool-chip mut">нет</span>`;
    return c.map((x, i) => `<span class="ep-tool-chip">${esc(x.name)} ×${num(x.perUse)} ${esc(x.unit || "шт")}<button type="button" data-tc-del="${t.id}" data-tci="${i}">✕</button></span>`).join("");
  }
  function flash(msg) {
    try {
      let el = document.getElementById("ep-collector-flash");
      if (!el) { el = document.createElement("div"); el.id = "ep-collector-flash"; el.className = "ep-pick-flash"; document.body.appendChild(el); }
      el.textContent = msg; el.classList.add("show");
      clearTimeout(flash._t); flash._t = setTimeout(() => el && el.classList.remove("show"), 1800);
    } catch (e) {}
  }
  function cfgBlock(t) {
    const modeSel = `<label class="ep-tool-f"><span>Учёт ресурса</span><select data-tool-mode="${t.id}">
      <option value="period" ${t.resMode === "period" ? "selected" : ""}>по сроку (календарь)</option>
      <option value="material" ${t.resMode === "material" ? "selected" : ""}>по материалам (штроба / подрозетники)</option>
      <option value="works" ${t.resMode === "works" ? "selected" : ""}>по работам (привязка + поиск)</option>
      <option value="hours" ${t.resMode === "hours" ? "selected" : ""}>по часам (из сметы)</option>
    </select></label>`;
    let body = "";
    if (t.resMode === "material") {
      body = `<label class="ep-tool-f"><span>Что делает</span><select data-tool-kind="${t.id}">
          <option value="штроба" ${t.workKind === "штроба" ? "selected" : ""}>Штробление (метры)</option>
          <option value="подрозетник" ${t.workKind === "подрозетник" ? "selected" : ""}>Высверливание подрозетников (шт)</option>
        </select></label>
        <div class="ep-tool-caps"><div class="ep-tool-caps-h">На сколько хватает (${esc(t.unit || "м")}):</div>
          ${MATS.map(m => `<label class="ep-tool-cap"><span>${m}</span><input data-tool-cap="${t.id}" data-mat="${m}" type="number" inputmode="numeric" min="0" value="${num((t.cap || {})[m]) || ""}" placeholder="0"></label>`).join("")}
        </div>`;
    } else if (t.resMode === "works") {
      body = worksConfig(t);
    } else if (t.resMode === "hours") {
      body = `<label class="ep-tool-f"><span>Ресурс, часов</span><input data-tool-hours="${t.id}" type="number" inputmode="numeric" min="0" value="${num(t.hoursTotal) || ""}" placeholder="напр. 300"></label>
        <label class="ep-tool-f"><span>Считать часы</span><select data-tool-kind="${t.id}">
          <option value="уборка" ${t.workKind === "уборка" ? "selected" : ""}>Уборка (штроба + сверление)</option>
          <option value="" ${!t.workKind ? "selected" : ""}>Все работы сметы</option>
        </select></label>`;
    } else {
      body = `<label class="ep-tool-f"><span>Срок, мес</span><input data-tool-life="${t.id}" type="number" inputmode="numeric" min="1" value="${num(t.lifeMonths) || 36}"></label>
        <label class="ep-tool-f"><span>Дата покупки</span><input data-tool-date="${t.id}" type="date" value="${esc(t.buyDate || "")}"></label>`;
    }
    return `<div class="ep-tool-cfg">${modeSel}${body}
      <button type="button" class="ep-tool-reset" data-tool-reset="${t.id}">↺ Сбросить ресурс (заменил инструмент)</button></div>`;
  }
  function render() {
    const root = document.getElementById("ep-tools-root"); if (!root) return;
    const ts = read().slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
    const tot = totals();
    const consumList = consumablesForItems(estimateItems());
    const consumHtml = consumList.length ? `
      <div class="ep-cost-summary">
        <div class="ep-cost-sum-row"><b>📦 Расходники к закупке (по текущей смете)</b></div>
        ${consumList.map(c => `<div class="ep-cost-sum-row mut"><span>${esc(c.name)}</span><b>${Math.round(c.qty * 10) / 10} ${esc(c.unit)}</b></div>`).join("")}
        <button type="button" class="btn btn-primary ep-clickable" data-tool-consum-add style="margin-top:8px">Добавить в смету → «Поставщику»</button>
      </div>` : "";
    const list = ts.length ? ts.map(t => {
      const w = wearPct(t), rem = 100 - w, low = lowRes(t);
      const opts = CONDS.map(([k, v]) => `<option value="${k}" ${t.condition === k ? "selected" : ""}>${v}</option>`).join("");
      const isExp = !!expanded[t.id];
      return `
      <div class="ep-tool-row ${t.condition === "off" ? "off" : ""}">
        <div class="ep-tool-top">
          <div class="ep-tool-main">
            <div class="ep-tool-n">${esc(t.name)}${t.model ? ` <small>${esc(t.model)}</small>` : ""}</div>
            <div class="ep-tool-sub">${money(t.price)}${t.resMode === "period" ? " · аморт " + money(dep(t)) + "/мес" : " · износ от работы"}</div>
            <div class="ep-tool-res ${low ? "low" : ""}">
              <div class="ep-tool-bar"><i style="width:${w}%"></i></div>
              <span class="ep-tool-restxt">${esc(remainText(t))}${low ? " · ⚠ скоро замена" : ""}</span>
            </div>
          </div>
          <button type="button" class="ep-stock-del" data-tool-del="${t.id}">✕</button>
        </div>
        <div class="ep-tool-bot">
          <select data-tool-cond="${t.id}">${opts}</select>
          <input data-tool-loc="${t.id}" type="text" value="${esc(t.location)}" placeholder="где сейчас (дом/объект/помощник)">
          <button type="button" class="ep-tool-exp" data-tool-expand="${t.id}">${isExp ? "▲ скрыть" : "⚙ ресурс"}</button>
        </div>
        ${isExp ? cfgBlock(t) : ""}
      </div>`;
    }).join("") : `<div class="ep-db-empty">Список инструмента пуст. Добавь технически сложный инструмент (АКБ/электро).</div>`;
    root.innerHTML = `
      <div class="ep-tools">
        <div class="ep-cost-summary">
          <div class="ep-cost-sum-row"><span>Стоимость инструмента</span><b>${money(tot.value)}</b></div>
          <div class="ep-cost-sum-row"><span>Амортизация / мес</span><b>${money(tot.perMonth)}</b></div>
          <div class="ep-cost-sum-row mut"><span>Остаточная стоимость</span><b>${money(tot.residual)}</b></div>
        </div>
        <div class="ep-tool-add">
          <input data-tool-name type="text" placeholder="Инструмент (штроборез Зубр)">
          <input data-tool-model type="text" placeholder="модель (необязательно)">
          <div class="ep-tool-add-r">
            <input data-tool-price type="number" inputmode="decimal" min="0" placeholder="цена">
            <select data-tool-newmode>
              <option value="material">по материалам</option>
              <option value="works">по работам</option>
              <option value="hours">по часам</option>
              <option value="period" selected>по сроку</option>
            </select>
            <button type="button" class="btn btn-primary ep-clickable" data-tool-add>＋</button>
          </div>
        </div>
        <div class="ep-tool-list">${list}</div>
        ${consumHtml}
        <div class="ep-prof-actions">
          <button type="button" class="btn btn-primary ep-clickable" data-tool-tocosts>Списать месячную амортизацию (по сроку) в Затраты</button>
          <div class="ep-stock-hint">Износ ресурсного инструмента (пистолет/штроборез и т.п.) считается от работ и сам попадает в «Затраты» при добавлении в основную смету. Кнопка выше — для инструмента «по сроку» (помесячно).</div>
          <button type="button" class="btn btn-ghost ep-clickable" data-route="main">На главный</button>
        </div>
        <div class="ep-stock-hint">Ресурс списывается сам после сохранения сметы. Режим «по работам»: жми «⚙ ресурс», найди и привяжи работы (напр. пистолет → крепления/«выстрелы», штроборез → штробление) — расход считается из этих работ в смете.</div>
      </div>`;
  }

  document.addEventListener("input", (e) => {
    const t = e.target; if (!t || !t.getAttribute || !document.getElementById("ep-tools-root")) return;
    if (t.hasAttribute("data-tool-loc")) setField(t.getAttribute("data-tool-loc"), "location", t.value);
    else if (t.hasAttribute("data-tool-cap")) setCap(t.getAttribute("data-tool-cap"), t.getAttribute("data-mat"), t.value);
    else if (t.hasAttribute("data-tool-hours")) setField(t.getAttribute("data-tool-hours"), "hoursTotal", t.value);
    else if (t.hasAttribute("data-tool-life")) setField(t.getAttribute("data-tool-life"), "lifeMonths", t.value);
    else if (t.hasAttribute("data-tool-date")) setField(t.getAttribute("data-tool-date"), "buyDate", t.value);
    else if (t.hasAttribute("data-tool-captotal")) setField(t.getAttribute("data-tool-captotal"), "capTotal", t.value);
    else if (t.hasAttribute("data-tool-unitname")) setField(t.getAttribute("data-tool-unitname"), "unitName", t.value);
    else if (t.hasAttribute("data-tool-search")) {
      const id = t.getAttribute("data-tool-search"); searchText[id] = t.value;
      const cont = document.getElementById("tw-" + id);
      if (cont) cont.innerHTML = worksListHtml(read().find(x => x.id === id) || { id: id, boundWorks: [] }, t.value);
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target; if (!t || !t.getAttribute || !document.getElementById("ep-tools-root")) return;
    if (t.hasAttribute("data-tool-cond")) { setField(t.getAttribute("data-tool-cond"), "condition", t.value); render(); }
    else if (t.hasAttribute("data-tool-mode")) { setField(t.getAttribute("data-tool-mode"), "resMode", t.value); render(); }
    else if (t.hasAttribute("data-tool-kind")) { setField(t.getAttribute("data-tool-kind"), "workKind", t.value); render(); }
  });
  document.addEventListener("click", (e) => {
    const t = e.target; if (!t || !t.closest) return; let el;
    if (t.closest("[data-tool-add]")) {
      const root = document.getElementById("ep-tools-root"); if (!root) return;
      const n = root.querySelector("[data-tool-name]"), md = root.querySelector("[data-tool-model]"), p = root.querySelector("[data-tool-price]"), mode = root.querySelector("[data-tool-newmode]");
      if (n && n.value.trim()) { addTool({ name: n.value, model: md ? md.value : "", price: p ? p.value : 0, resMode: mode ? mode.value : "period" }); render(); }
      else flash("Введи название");
      return;
    }
    if ((el = t.closest("[data-tool-del]"))) { removeTool(el.getAttribute("data-tool-del")); render(); return; }
    if ((el = t.closest("[data-tool-expand]"))) { const id = el.getAttribute("data-tool-expand"); expanded[id] = !expanded[id]; render(); return; }
    if ((el = t.closest("[data-tool-bind]"))) { bindWork(el.getAttribute("data-tool-bind"), el.getAttribute("data-bw")); render(); return; }
    if ((el = t.closest("[data-tool-unbind]"))) { unbindWork(el.getAttribute("data-tool-unbind"), el.getAttribute("data-bw")); render(); return; }
    if ((el = t.closest("[data-tc-add]"))) {
      const id = el.getAttribute("data-tc-add"); const root = document.getElementById("ep-tools-root"); if (!root) return;
      const nm = root.querySelector('[data-tc-name="' + id + '"]'), pr = root.querySelector('[data-tc-per="' + id + '"]'), un = root.querySelector('[data-tc-unit="' + id + '"]');
      if (nm && nm.value.trim()) { addConsum(id, nm.value, pr ? pr.value : 1, un ? un.value : "шт"); render(); }
      else flash("Введи название расходника");
      return;
    }
    if ((el = t.closest("[data-tc-del]"))) { removeConsum(el.getAttribute("data-tc-del"), num(el.getAttribute("data-tci"))); render(); return; }
    if (t.closest("[data-tool-consum-add]")) { addConsumablesToEstimate(); return; }
    if ((el = t.closest("[data-tool-reset]"))) { resetResource(el.getAttribute("data-tool-reset")); flash("Ресурс сброшен на 100%"); render(); return; }
    if (t.closest("[data-tool-tocosts]")) {
      const tot = totals();
      if (!(tot.perMonth > 0)) { flash("Нет инструмента с амортизацией"); return; }
      if (window.EP && EP.Costs && EP.Costs.addActual) { EP.Costs.addActual("tools", Math.round(tot.perMonth * 100) / 100, "Амортизация инструмента за месяц"); flash("Амортизация за месяц добавлена в «Затраты»"); }
      else flash("Модуль «Затраты» недоступен");
      return;
    }
  });
  window.addEventListener("ep:route-loaded", (e) => { const r = e && e.detail && e.detail.route; if (r === "tools") render(); });
  // списание ресурса инструмента после сохранения сметы
  window.addEventListener("ep:estimate-saved", function (e) {
    try {
      var est = e && e.detail && e.detail.estimate;
      if (est && est.items) {
        var rep = consumeFromEstimate(est.items, est.id);
        if (rep && rep.length && document.getElementById("ep-tools-root")) render();
      }
    } catch (er) {}
  });

  // АВТО-АМОРТИЗАЦИЯ: при изменении основной сметы считаем износ инструмента от её работ → в Затраты (факт, заменяемая запись)
  function pushDepreciation() {
    try {
      if (!(window.EP && EP.Estimate && EP.Estimate.getItems && EP.Costs && EP.Costs.setAuto)) return;
      const dep = depreciationForItems(EP.Estimate.getItems() || []);
      EP.Costs.setAuto("tool-amort", dep.total, "Амортизация инструмента (по смете)");
    } catch (e) {}
  }
  window.addEventListener("ep:estimate-main-changed", pushDepreciation);
  if (document.readyState !== "loading") setTimeout(pushDepreciation, 0);
  else document.addEventListener("DOMContentLoaded", () => setTimeout(pushDepreciation, 0));

  // ---- облако (через общий EP.Cloud) ----
  function syncPush() { if (window.EP && window.EP.Cloud) window.EP.Cloud.push("tools", { items: read() }); }
  function syncPull() {
    if (!window.EP || !window.EP.Cloud) return;
    window.EP.Cloud.pull("tools").then(function (d) {
      if (!d || !Array.isArray(d.items)) return;
      write(window.EP.Cloud.mergeById(read(), d.items));
      if (document.getElementById("ep-tools-root")) render();
    });
  }
  if (window.EP && window.EP.Cloud && window.EP.Cloud.onLogin) window.EP.Cloud.onLogin(syncPull);
  EP.Tools.syncPush = syncPush; EP.Tools.syncPull = syncPull;
})();
