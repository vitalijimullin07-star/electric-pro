/* Electric Pro V29 — Этап 2. Вкладки «Смета работ» (работы клиенту) и «Поставщику» (материалы, закупка)
   из общего сборника EP.Estimate. Суммирование одинаковых, печать/PDF, поделиться. Без MutationObserver. */
(() => {
  "use strict";
  function Draft() { return (window.EP && window.EP.Estimate) || null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function money(v) {
    try { if (window.EPCurrency && window.EPCurrency.format) return window.EPCurrency.format(v); } catch (e) {}
    return (Number(v || 0).toFixed(2)) + " \u20bd";
  }
  let tab = "works"; // works | supply

  // агрегированные строки по типу (суммирование одинаковых по имени+единице)
  function rows(type) {
    const d = Draft(); const items = d ? d.getItems() : [];
    const m = new Map();
    items.filter(x => x.type === type).forEach(x => {
      const key = String(x.name || "").toLowerCase().trim() + "|" + (x.unit || "");
      const e = m.get(key);
      if (e) { e.qty += Number(x.qty) || 0; if (!e.price && Number(x.price)) e.price = Number(x.price); }
      else m.set(key, { name: x.name, unit: x.unit || "", price: Number(x.price) || 0, qty: Number(x.qty) || 0 });
    });
    return [...m.values()].filter(x => x.qty > 0).sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
  }
  function total(rs) { return rs.reduce((s, x) => s + x.price * x.qty, 0); }

  function render() {
    const root = document.getElementById("ep-estimate-root");
    if (!root) return;
    const isSupply = tab === "supply";
    const rs = rows(isSupply ? "material" : "work");
    const tot = total(rs);
    const list = rs.length ? rs.map((x, i) => isSupply ? `
      <div class="ep-sup-row supply">
        <div class="ep-sup-n">${i + 1}. ${esc(x.name)}</div>
        <div class="ep-sup-q">${x.qty}${x.unit ? " " + esc(x.unit) : ""}</div>
      </div>` : `
      <div class="ep-sup-row">
        <div class="ep-sup-n">${i + 1}. ${esc(x.name)}</div>
        <div class="ep-sup-q">${x.qty}${x.unit ? " " + esc(x.unit) : ""}</div>
        <div class="ep-sup-p">${x.price ? money(x.price) : "—"}</div>
        <div class="ep-sup-s">${money(x.price * x.qty)}</div>
      </div>`).join("") :
      `<div class="ep-db-empty">Пока пусто. Добавь позиции через щит, пул или «Материалы/Работа» — кнопкой «В смету», и они появятся здесь.</div>`;
    root.innerHTML = `
      <div class="ep-est-tabs">
        <button type="button" class="ep-est-tab ${!isSupply ? "on" : ""}" data-esttab="works">Смета работ</button>
        <button type="button" class="ep-est-tab ${isSupply ? "on" : ""}" data-esttab="supply">Поставщику</button>
      </div>
      <div class="ep-sup">
        <div class="ep-sup-head">
          <div class="ep-sup-title">${isSupply ? "Материалы для закупки" : "Работы для заказчика"}</div>
          <div class="ep-sup-sub">${rs.length} позиц.${(!isSupply && rs.length) ? " · итого <b>" + money(tot) + "</b>" : ""}</div>
        </div>
        <div class="ep-sup-list">${list}</div>
        ${(!isSupply && rs.length) ? `<div class="ep-sup-total">Итого: <b>${money(tot)}</b></div>` : ""}
        <div class="ep-sup-actions">
          <button type="button" class="btn btn-primary ep-clickable" data-est-print>Печать / PDF</button>
          <button type="button" class="btn btn-ghost ep-clickable" data-est-share>Поделиться</button>
          ${isSupply ? '<button type="button" class="btn btn-ghost ep-clickable" data-route="consumables">+ Расходники</button>' : ""}
          ${isSupply ? '<button type="button" class="btn btn-ghost ep-clickable" data-est-usestock>📤 Задействовать со склада</button>' : ""}
          <button type="button" class="btn btn-ghost ep-clickable" data-route="main">На главный</button>
        </div>
      </div>`;
  }

  function printDoc() {
    const isSupply = tab === "supply";
    const rs = rows(isSupply ? "material" : "work");
    const tot = total(rs);
    const title = isSupply ? "Материалы (поставщику)" : "Смета работ";
    const col2 = isSupply ? "Материал" : "Работа";
    const trs = rs.map((x, i) => isSupply
      ? `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td class="c">${x.qty} ${esc(x.unit)}</td></tr>`
      : `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td class="c">${x.qty} ${esc(x.unit)}</td><td class="r">${x.price ? money(x.price) : "—"}</td><td class="r">${money(x.price * x.qty)}</td></tr>`).join("");
    const thead = isSupply
      ? `<tr><th>№</th><th>${col2}</th><th class="c">Кол-во</th></tr>`
      : `<tr><th>№</th><th>${col2}</th><th class="c">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr>`;
    const tfoot = isSupply ? "" : `<tfoot><tr><td colspan="4" class="r">Итого</td><td class="r">${money(tot)}</td></tr></tfoot>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:18px}h1{font-size:18px;margin:0 0 12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #cbd5e1;padding:6px 8px}
th{background:#f1f5f9;text-align:left}.c{text-align:center}.r{text-align:right}tfoot td{font-weight:700}
.foot{margin-top:14px;color:#64748b;font-size:12px}</style></head>
<body><h1>${title}</h1><table><thead>${thead}</thead>
<tbody>${trs}</tbody>${tfoot}</table>
<p class="foot">Electric Pro</p>
<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>`;
    const w = window.open("", "_blank");
    if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); }
    else flash("Разреши всплывающие окна, чтобы напечатать");
  }

  function shareText() {
    const isSupply = tab === "supply";
    const rs = rows(isSupply ? "material" : "work");
    const tot = total(rs);
    const title = isSupply ? "Материалы (закупка)" : "Смета работ";
    const lines = rs.map((x, i) => isSupply
      ? `${i + 1}. ${x.name} — ${x.qty}${x.unit ? " " + x.unit : ""}`
      : `${i + 1}. ${x.name} — ${x.qty}${x.unit ? " " + x.unit : ""}` + (x.price ? ` x ${money(x.price)} = ${money(x.price * x.qty)}` : "")).join("\n");
    const text = title + "\n" + lines + (isSupply ? "" : "\n\nИтого: " + money(tot));
    try {
      if (navigator.share) { navigator.share({ title: title, text: text }).catch(() => {}); }
      else if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(() => flash("Скопировано")).catch(() => flash("Не удалось скопировать")); }
      else flash("Поделиться недоступно");
    } catch (e) { flash("Поделиться недоступно"); }
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
    const t = e.target; let el;
    if ((el = t.closest && t.closest("[data-esttab]"))) { tab = el.dataset.esttab === "supply" ? "supply" : "works"; render(); return; }
    if (document.getElementById("ep-estimate-root")) {
      if (t.closest && t.closest("[data-est-print]")) { printDoc(); return; }
      if (t.closest && t.closest("[data-est-share]")) { shareText(); return; }
      if (t.closest && t.closest("[data-est-usestock]")) { if (window.EP && EP.Stock && EP.Stock.useFromSupply) EP.Stock.useFromSupply(); return; }
    }
  });

  window.addEventListener("ep:route-loaded", (e) => {
    const route = e && e.detail && e.detail.route;
    if (route === "estimate" || route === "details") {
      const root = document.getElementById("ep-estimate-root");
      const def = root && root.getAttribute("data-est-default");
      if (def === "supply") tab = "supply"; else if (def === "works") tab = "works";
      render();
    }
  });
  window.addEventListener("ep:estimate-main-changed", () => { if (document.getElementById("ep-estimate-root")) render(); });
})();
