/* Electric Pro V29 — Склад: остатки по категориям (кабели, расходка щита/инструмента, прочее),
   цена и стоимость склада, минимальный остаток с предупреждением, поиск.
   «Задействовать со склада» — списывает использованное по смете и показывает, что осталось докупить. */
(() => {
  "use strict";
  const KEY = "ep_stock_v29";
  const CATS = ["Кабели", "Расходка щита", "Расходка инструмента", "Подрозетники/коробки", "Автоматы/модули", "Прочее"];
  function Draft() { return (window.EP && EP.Estimate) || null; }
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "[]") || []; } catch (e) { return []; } }
  function write(a) { try { localStorage.setItem(KEY, JSON.stringify(a || [])); } catch (e) {} try { window.dispatchEvent(new CustomEvent("ep:stock-changed")); } catch (e) {} syncPush(); }
  function uid() { return "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function num(v) { return Number(v) || 0; }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я]+/gi, " ").trim(); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function money(v) { try { return (window.EPCurrency && EPCurrency.format) ? EPCurrency.format(num(v)) : (Math.round(num(v) * 100) / 100) + " ₽"; } catch (e) { return num(v) + " ₽"; } }

  function guessCat(name) {
    const n = norm(name);
    if (/(кабел|провод|ввг|nym|пвс|кввг|сип|пугв| пв )/.test(" " + n + " ")) return "Кабели";
    if (/(подрозетник|коробка|распаеч|установочн)/.test(n)) return "Подрозетники/коробки";
    if (/(автомат|узо|дифф|реле|корпус|бокс| din |дин рейк|шина|узип|опн|счетчик|рубильник|контактор)/.test(" " + n + " ")) return "Автоматы/модули";
    if (/(заряд|дюбел|гвозд|\bдиск|коронк|\bбур|сверл|саморез|\bбит)/.test(n)) return "Расходка инструмента";
    if (/(гофр|стяжк|хомут|изолент|клипс|\bскоб|маркир|наконечник|гильз|термоусад|ваго|клемм)/.test(n)) return "Расходка щита";
    return "Прочее";
  }
  function fixCat(c) { return CATS.indexOf(c) >= 0 ? c : "Прочее"; }

  function getStock() { return read(); }
  function addItem(o) {
    const a = read(); const name = String(o && o.name || "").trim(); if (!name) return;
    a.push({ id: uid(), name, qty: num(o.qty), unit: String(o.unit || ""), cat: fixCat(o.cat || guessCat(name)), price: num(o.price), min: num(o.min) });
    write(a);
  }
  function setQty(i, q) { const a = read(); const it = a.find(x => x.id === i); if (it) { it.qty = Math.max(0, num(q)); write(a); } }
  function addQty(i, d) { const a = read(); const it = a.find(x => x.id === i); if (it) { it.qty = Math.max(0, num(it.qty) + d); write(a); } }
  function setField(i, f, v) {
    const a = read(); const it = a.find(x => x.id === i); if (!it) return;
    if (f === "name") it.name = String(v);
    else if (f === "unit") it.unit = String(v);
    else if (f === "cat") it.cat = fixCat(v);
    else if (f === "price") it.price = num(v);
    else if (f === "min") it.min = num(v);
    write(a);
  }
  function removeItem(i) { write(read().filter(x => x.id !== i)); }
  function stockFor(name, unit) { const n = norm(name); return read().find(x => norm(x.name) === n && (unit ? String(x.unit || "") === String(unit || "") : true)); }
  function receive(name, qty, unit, cat) { const st = stockFor(name, unit); if (st) addQty(st.id, num(qty)); else addItem({ name, qty, unit, cat }); }
  function stockValue() { return read().reduce((s, x) => s + num(x.qty) * num(x.price), 0); }
  function lowItems() { return read().filter(x => num(x.min) > 0 && num(x.qty) <= num(x.min)); }

  /* нужные материалы по смете (агрегированно) */
  function neededMaterials() {
    const d = Draft(); const items = d ? d.getItems() : [];
    const m = new Map();
    items.filter(x => x.type === "material").forEach(x => {
      const key = norm(x.name) + "|" + (x.unit || "");
      const e = m.get(key);
      if (e) { e.qty += num(x.qty); } else m.set(key, { name: x.name, unit: x.unit || "", qty: num(x.qty) });
    });
    return [...m.values()].filter(x => x.qty > 0).sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
  }
  function deficitRows() {
    return neededMaterials().map(n => {
      const st = stockFor(n.name, n.unit);
      const have = st ? num(st.qty) : 0;
      return { name: n.name, unit: n.unit, need: n.qty, have, buy: Math.max(0, n.qty - have) };
    });
  }
  /* ЗАДЕЙСТВОВАТЬ СО СКЛАДА: списываем использованное, возвращаем отчёт {taken, buy} */
  function useForEstimate() {
    const need = neededMaterials(); const a = read();
    const taken = [], buy = [];
    need.forEach(n => {
      const st = a.find(x => norm(x.name) === norm(n.name) && (n.unit ? String(x.unit || "") === String(n.unit || "") : true));
      const have = st ? num(st.qty) : 0;
      const use = Math.min(have, n.qty);
      if (st && use > 0) { st.qty = Math.max(0, have - use); taken.push({ name: st.name, unit: st.unit, qty: use, cat: fixCat(st.cat) }); }
      const rest = n.qty - use;
      if (rest > 0) buy.push({ name: n.name, unit: n.unit, qty: rest, cat: st ? fixCat(st.cat) : guessCat(n.name) });
    });
    if (taken.length) write(a);
    return { taken, buy };
  }

  window.EP = window.EP || {};
  EP.Stock = { getStock, addItem, setQty, addQty, setField, removeItem, stockFor, receive, useForEstimate, stockValue, lowItems, neededMaterials, CATS };

  /* ---------- UI ---------- */
  let view = "stock";          // stock | deficit | report
  let q = "";                  // поиск
  let lastReport = null;       // отчёт после «задействовать»
  let pendingReport = false;   // показать отчёт после перехода на склад
  function flash(msg) {
    try {
      let el = document.getElementById("ep-collector-flash");
      if (!el) { el = document.createElement("div"); el.id = "ep-collector-flash"; el.className = "ep-pick-flash"; document.body.appendChild(el); }
      el.textContent = msg; el.classList.add("show");
      clearTimeout(flash._t); flash._t = setTimeout(() => el && el.classList.remove("show"), 1900);
    } catch (e) {}
  }
  function tabs() {
    return `<div class="ep-est-tabs">
      <button type="button" class="ep-est-tab ${view === "stock" ? "on" : ""}" data-stock-tab="stock">Остатки</button>
      <button type="button" class="ep-est-tab ${(view === "deficit" || view === "report") ? "on" : ""}" data-stock-tab="deficit">Задействовать / докупить</button>
    </div>`;
  }
  function catSelect(cur, attr) {
    return `<select class="ep-stock-catsel" ${attr}>` + CATS.map(c => `<option value="${esc(c)}" ${fixCat(cur) === c ? "selected" : ""}>${esc(c)}</option>`).join("") + `</select>`;
  }

  function renderStock() {
    const root = document.getElementById("ep-stock-root"); if (!root) return;
    const all = read();
    const ql = norm(q);
    const items = (ql ? all.filter(x => norm(x.name).indexOf(ql) >= 0) : all.slice());
    const low = lowItems().length;
    // группировка по категориям
    let listHtml = "";
    if (!all.length) listHtml = `<div class="ep-db-empty">Склад пуст. Добавь, что есть в наличии — кабели, расходку щита, расходку инструмента, прочее.</div>`;
    else if (!items.length) listHtml = `<div class="ep-db-empty">Ничего не найдено по «${esc(q)}».</div>`;
    else {
      const order = CATS.concat([...new Set(items.map(x => fixCat(x.cat)))].filter(c => CATS.indexOf(c) < 0));
      order.forEach(cat => {
        const rows = items.filter(x => fixCat(x.cat) === cat).sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
        if (!rows.length) return;
        const catVal = rows.reduce((s, x) => s + num(x.qty) * num(x.price), 0);
        listHtml += `<div class="ep-stock-cat"><span>${esc(cat)} · ${rows.length}</span><span class="ep-stock-val">${money(catVal)}</span></div>`;
        listHtml += rows.map(x => {
          const isLow = num(x.min) > 0 && num(x.qty) <= num(x.min);
          return `<div class="ep-stock-card ${isLow ? "low" : ""}">
            <div class="ep-stock-l1">
              <div class="ep-stock-n">${esc(x.name)}</div>
              ${catSelect(x.cat, `data-stock-cat="${x.id}"`)}
              <button type="button" class="ep-stock-del" data-stock-del="${x.id}">✕</button>
            </div>
            <div class="ep-stock-l2">
              <button type="button" class="ep-stock-b" data-stock-dec="${x.id}">−</button>
              <input class="ep-stock-q" type="number" inputmode="decimal" min="0" step="0.1" data-stock-qty="${x.id}" value="${x.qty}">
              <input class="ep-stock-uin" type="text" data-stock-unit="${x.id}" value="${esc(x.unit)}" placeholder="ед">
              <button type="button" class="ep-stock-b" data-stock-inc="${x.id}">+</button>
              <span class="ep-stock-x">цена</span>
              <input class="ep-stock-p" type="number" inputmode="decimal" min="0" step="1" data-stock-price="${x.id}" value="${x.price || ""}" placeholder="₽">
              <span class="ep-stock-x">мин</span>
              <input class="ep-stock-m" type="number" inputmode="decimal" min="0" step="1" data-stock-min="${x.id}" value="${x.min || ""}" placeholder="0">
              <span class="ep-stock-sum">${money(num(x.qty) * num(x.price))}</span>
              ${isLow ? `<span class="ep-stock-lowbadge">↓ ниже минимума</span>` : ""}
            </div>
          </div>`;
        }).join("");
      });
    }
    root.innerHTML = `
      <div class="ep-stock">
        ${tabs()}
        <div class="ep-stock-totbar">
          <span>Стоимость склада: <b>${money(stockValue())}</b></span>
          <span>позиций: ${all.length}${low ? ` · <span class="ep-stock-lown">ниже минимума: ${low}</span>` : ""}</span>
        </div>
        <input class="ep-stock-search" type="text" data-stock-search placeholder="🔍 поиск по складу" value="${esc(q)}">
        <div class="ep-stock-add">
          <input data-stock-name type="text" placeholder="Название (кабель ВВГ 3×2.5)">
          <input data-stock-newqty type="number" inputmode="decimal" min="0" step="0.1" placeholder="кол-во">
          <input data-stock-newunit type="text" placeholder="ед." class="ep-stock-unit-in">
          <input data-stock-newprice type="number" inputmode="decimal" min="0" step="1" placeholder="цена ₽" class="ep-stock-unit-in">
          ${catSelect("Прочее", "data-stock-newcat")}
          <button type="button" class="btn btn-primary ep-clickable" data-stock-add>＋ Добавить</button>
        </div>
        <div class="ep-stock-list">${listHtml}</div>
        <div class="ep-prof-actions">
          <button type="button" class="btn btn-ghost ep-clickable" data-stock-fillest>Оприходовать смету на склад</button>
          <button type="button" class="btn btn-ghost ep-clickable" data-route="main">На главный</button>
        </div>
        <div class="ep-stock-hint">Задавай категорию, цену и минимальный остаток. Когда количество падает до минимума — позиция подсветится.</div>
      </div>`;
  }

  function renderDeficit() {
    const root = document.getElementById("ep-stock-root"); if (!root) return;
    const rows = deficitRows();
    const toBuy = rows.filter(r => r.buy > 0);
    const inStock = rows.filter(r => r.have > 0).length;
    const list = rows.length ? rows.map(r => `
      <div class="ep-def-row ${r.buy > 0 ? "need" : "ok"}">
        <div class="ep-def-n">${esc(r.name)}</div>
        <div class="ep-def-c">нужно ${r.need} ${esc(r.unit)}</div>
        <div class="ep-def-c">склад ${r.have}</div>
        <div class="ep-def-buy">${r.buy > 0 ? "докупить " + r.buy : "✓ со склада"}</div>
      </div>`).join("") : `<div class="ep-db-empty">В смете нет материалов. Добавь позиции (щит/пул/материалы → в смету).</div>`;
    root.innerHTML = `
      <div class="ep-stock">
        ${tabs()}
        <div class="ep-sup-head"><div class="ep-sup-title">Закупка с учётом склада</div><div class="ep-sup-sub">${toBuy.length} к докупке · ${inStock} есть на складе</div></div>
        <div class="ep-def-list">${list}</div>
        <div class="ep-prof-actions">
          <button type="button" class="btn btn-primary ep-clickable" data-stock-use>📤 Задействовать со склада</button>
          <button type="button" class="btn btn-ghost ep-clickable" data-stock-share>Поделиться докупкой</button>
          <button type="button" class="btn btn-ghost ep-clickable" data-stock-receive>Оприходовать докупленное</button>
        </div>
        <div class="ep-stock-hint">«Задействовать со склада» — спишет использованное с остатков и покажет, что осталось докупить. «Оприходовать докупленное» — после покупки добавит недостающее на склад.</div>
      </div>`;
  }

  function repGroup(title, arr, cls) {
    if (!arr.length) return "";
    const order = CATS.concat([...new Set(arr.map(x => fixCat(x.cat)))].filter(c => CATS.indexOf(c) < 0));
    let html = `<div class="ep-rep-title ${cls}">${title}</div>`;
    order.forEach(cat => {
      const rows = arr.filter(x => fixCat(x.cat) === cat);
      if (!rows.length) return;
      html += `<div class="ep-rep-cat">${esc(cat)}</div>`;
      html += rows.map(r => `<div class="ep-rep-row"><span>${esc(r.name)}</span><span>${r.qty} ${esc(r.unit)}</span></div>`).join("");
    });
    return html;
  }
  function renderReport() {
    const root = document.getElementById("ep-stock-root"); if (!root) return;
    const r = lastReport || { taken: [], buy: [] };
    root.innerHTML = `
      <div class="ep-stock">
        ${tabs()}
        <div class="ep-sup-head"><div class="ep-sup-title">Списано со склада</div><div class="ep-sup-sub">взято ${r.taken.length} · докупить ${r.buy.length}</div></div>
        <div class="ep-rep">
          ${r.taken.length ? repGroup("✓ Взято со склада (остатки уменьшены)", r.taken, "ok") : `<div class="ep-db-empty">Со склада ничего не подошло — нужных позиций нет в наличии.</div>`}
          ${repGroup("🛒 Докупить (не хватило на складе)", r.buy, "buy")}
        </div>
        <div class="ep-prof-actions">
          ${r.buy.length ? `<button type="button" class="btn btn-primary ep-clickable" data-stock-sharebuy>Поделиться списком докупки</button>` : ""}
          <button type="button" class="btn btn-ghost ep-clickable" data-stock-tab="stock">К остаткам</button>
        </div>
      </div>`;
  }

  function render() { if (view === "report") renderReport(); else if (view === "deficit") renderDeficit(); else renderStock(); }

  function shareList(arr, title) {
    if (!arr.length) { flash("Список пуст"); return; }
    const text = title + ":\n" + arr.map((r, i) => `${i + 1}. ${r.name} — ${r.qty} ${r.unit}`).join("\n");
    try {
      if (navigator.share) navigator.share({ title, text }).catch(() => {});
      else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => flash("Скопировано")).catch(() => flash("Не удалось"));
      else flash("Поделиться недоступно");
    } catch (e) { flash("Поделиться недоступно"); }
  }
  function doUse() {
    if (!neededMaterials().length) { flash("В смете нет материалов"); return; }
    if (!window.confirm("Списать использованное со склада? Остатки уменьшатся на то, что пошло в работу.")) return;
    lastReport = useForEstimate();
    view = "report"; renderReport();
    flash("Списано со склада: " + lastReport.taken.length + " · докупить: " + lastReport.buy.length);
  }
  function receiveDeficit() {
    const toBuy = deficitRows().filter(r => r.buy > 0);
    if (!toBuy.length) { flash("Докупать нечего"); return; }
    toBuy.forEach(r => receive(r.name, r.buy, r.unit));
    flash("Оприходовано: " + toBuy.length + " позиц.");
    renderDeficit();
  }
  function fillFromEstimate() {
    const need = neededMaterials();
    if (!need.length) { flash("В смете нет материалов"); return; }
    need.forEach(n => receive(n.name, n.qty, n.unit, guessCat(n.name)));
    flash("Оприходовано из сметы: " + need.length + " позиц.");
    renderStock();
  }

  document.addEventListener("input", (e) => {
    const t = e.target; if (!t || !t.getAttribute || !document.getElementById("ep-stock-root")) return;
    if (t.hasAttribute("data-stock-qty")) { setQty(t.getAttribute("data-stock-qty"), t.value); const c = t.closest(".ep-stock-card"); const s = c && c.querySelector(".ep-stock-sum"); }
    else if (t.hasAttribute("data-stock-price")) setField(t.getAttribute("data-stock-price"), "price", t.value);
    else if (t.hasAttribute("data-stock-min")) setField(t.getAttribute("data-stock-min"), "min", t.value);
    else if (t.hasAttribute("data-stock-unit")) setField(t.getAttribute("data-stock-unit"), "unit", t.value);
    else if (t.hasAttribute("data-stock-search")) { q = t.value; const root = document.getElementById("ep-stock-root"); const list = root && root.querySelector(".ep-stock-list"); /* лёгкая перерисовка списка */ renderStockListOnly(); }
  });
  // перерисовать только список (чтобы не терять фокус поиска)
  function renderStockListOnly() {
    const root = document.getElementById("ep-stock-root"); if (!root || view !== "stock") return;
    const cont = root.querySelector(".ep-stock-list"); if (!cont) { renderStock(); return; }
    const all = read(); const ql = norm(q);
    const items = (ql ? all.filter(x => norm(x.name).indexOf(ql) >= 0) : all.slice());
    if (!all.length) { cont.innerHTML = `<div class="ep-db-empty">Склад пуст.</div>`; return; }
    if (!items.length) { cont.innerHTML = `<div class="ep-db-empty">Ничего не найдено по «${esc(q)}».</div>`; return; }
    const order = CATS.concat([...new Set(items.map(x => fixCat(x.cat)))].filter(c => CATS.indexOf(c) < 0));
    let html = "";
    order.forEach(cat => {
      const rows = items.filter(x => fixCat(x.cat) === cat).sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
      if (!rows.length) return;
      const catVal = rows.reduce((s, x) => s + num(x.qty) * num(x.price), 0);
      html += `<div class="ep-stock-cat"><span>${esc(cat)} · ${rows.length}</span><span class="ep-stock-val">${money(catVal)}</span></div>`;
      html += rows.map(x => {
        const isLow = num(x.min) > 0 && num(x.qty) <= num(x.min);
        return `<div class="ep-stock-card ${isLow ? "low" : ""}">
          <div class="ep-stock-l1"><div class="ep-stock-n">${esc(x.name)}</div>${catSelect(x.cat, `data-stock-cat="${x.id}"`)}<button type="button" class="ep-stock-del" data-stock-del="${x.id}">✕</button></div>
          <div class="ep-stock-l2"><button type="button" class="ep-stock-b" data-stock-dec="${x.id}">−</button><input class="ep-stock-q" type="number" inputmode="decimal" min="0" step="0.1" data-stock-qty="${x.id}" value="${x.qty}"><input class="ep-stock-uin" type="text" data-stock-unit="${x.id}" value="${esc(x.unit)}" placeholder="ед"><button type="button" class="ep-stock-b" data-stock-inc="${x.id}">+</button><span class="ep-stock-x">цена</span><input class="ep-stock-p" type="number" inputmode="decimal" min="0" step="1" data-stock-price="${x.id}" value="${x.price || ""}" placeholder="₽"><span class="ep-stock-x">мин</span><input class="ep-stock-m" type="number" inputmode="decimal" min="0" step="1" data-stock-min="${x.id}" value="${x.min || ""}" placeholder="0"><span class="ep-stock-sum">${money(num(x.qty) * num(x.price))}</span>${isLow ? `<span class="ep-stock-lowbadge">↓ ниже минимума</span>` : ""}</div>
        </div>`;
      }).join("");
    });
    cont.innerHTML = html;
  }
  document.addEventListener("change", (e) => {
    const t = e.target; if (!t || !t.getAttribute || !document.getElementById("ep-stock-root")) return;
    if (t.hasAttribute("data-stock-cat")) { setField(t.getAttribute("data-stock-cat"), "cat", t.value); renderStockListOnly(); }
  });
  document.addEventListener("click", (e) => {
    const t = e.target; if (!t || !t.closest) return; let el;
    if ((el = t.closest("[data-stock-tab]"))) { const v = el.getAttribute("data-stock-tab"); view = (v === "deficit" ? "deficit" : "stock"); render(); return; }
    if ((el = t.closest("[data-stock-inc]"))) { addQty(el.getAttribute("data-stock-inc"), 1); renderStockListOnly(); return; }
    if ((el = t.closest("[data-stock-dec]"))) { addQty(el.getAttribute("data-stock-dec"), -1); renderStockListOnly(); return; }
    if ((el = t.closest("[data-stock-del]"))) { removeItem(el.getAttribute("data-stock-del")); renderStock(); return; }
    if (t.closest("[data-stock-add]")) {
      const root = document.getElementById("ep-stock-root"); if (!root) return;
      const name = root.querySelector("[data-stock-name]"), qy = root.querySelector("[data-stock-newqty]"), u = root.querySelector("[data-stock-newunit]"), p = root.querySelector("[data-stock-newprice]"), c = root.querySelector("[data-stock-newcat]");
      if (name && name.value.trim()) { addItem({ name: name.value, qty: qy ? qy.value : 0, unit: u ? u.value : "", price: p ? p.value : 0, cat: c ? c.value : "Прочее" }); q = ""; renderStock(); }
      else flash("Введи название");
      return;
    }
    if (t.closest("[data-stock-use]")) { doUse(); return; }
    if (t.closest("[data-stock-share]")) { shareList(deficitRows().filter(r => r.buy > 0).map(r => ({ name: r.name, qty: r.buy, unit: r.unit })), "Докупить"); return; }
    if (t.closest("[data-stock-sharebuy]")) { shareList((lastReport && lastReport.buy) || [], "Докупить"); return; }
    if (t.closest("[data-stock-receive]")) { receiveDeficit(); return; }
    if (t.closest("[data-stock-fillest]")) { fillFromEstimate(); return; }
  });

  // вызов из вкладки «Поставщику»: списать со склада и открыть отчёт на экране Склада
  function useFromSupply() {
    if (!neededMaterials().length) { flash("В смете нет материалов"); return false; }
    if (!window.confirm("Списать использованное со склада? Остатки уменьшатся на то, что пошло в работу.")) return false;
    lastReport = useForEstimate();
    if (document.getElementById("ep-stock-root")) { view = "report"; renderReport(); }
    else { pendingReport = true; try { if (window.EP && EP.Router && EP.Router.go) EP.Router.go("stock"); } catch (e) {} }
    flash("Списано со склада: " + lastReport.taken.length + " · докупить: " + lastReport.buy.length);
    return true;
  }
  EP.Stock.useFromSupply = useFromSupply;

  window.addEventListener("ep:route-loaded", (e) => {
    const r = e && e.detail && e.detail.route;
    if (r === "stock") { if (pendingReport) { pendingReport = false; view = "report"; } else { view = "stock"; q = ""; } render(); }
  });
  window.addEventListener("ep:estimate-main-changed", () => { if (document.getElementById("ep-stock-root") && view === "deficit") renderDeficit(); });

  // ---- облако (через общий EP.Cloud) ----
  function syncPush() { if (window.EP && window.EP.Cloud) window.EP.Cloud.push("stock", { items: read() }); }
  function syncPull() {
    if (!window.EP || !window.EP.Cloud) return;
    window.EP.Cloud.pull("stock").then(function (d) {
      if (!d || !Array.isArray(d.items)) return;
      write(window.EP.Cloud.mergeById(read(), d.items));
      if (document.getElementById("ep-stock-root")) render();
    });
  }
  if (window.EP && window.EP.Cloud && window.EP.Cloud.onLogin) window.EP.Cloud.onLogin(syncPull);
  // дополняем API (НЕ перезатираем — иначе useForEstimate и пр. пропадут)
  EP.Stock.syncPush = syncPush; EP.Stock.syncPull = syncPull;
})();
