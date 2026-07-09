/* Electric Pro V29 — Этап 6. Документы. Смета заказчику (клиентский вид):
   шапка из реквизитов мастера и карточки клиента, работы + материалы (списком или суммой),
   наценка на материалы и скидка, профессиональный PDF/печать и «Поделиться».
   Хаб документов: остальные (договор/акт/счёт/гарантия) добавляются на Этапе 7. */
(() => {
  "use strict";
  let ctx = { items: null, client: null };       // контекст из сохранённой сметы клиента (если открыто из раздела «Клиенты»)
  function Draft() { return ctx.items ? { getItems: function () { return ctx.items; } } : ((window.EP && EP.Estimate) || null); }
  function Profile() { return (window.EP && EP.Profile) || null; }
  function money(v) { try { if (window.EPCurrency && EPCurrency.format) return EPCurrency.format(v); } catch (e) {} return Number(v || 0).toFixed(2) + " \u20bd"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  const NKEY = "ep_smeta_no_v29";
  const TYPE_LABEL = { self: "Самозанятый", ip: "ИП", ooo: "ООО", fiz: "" };

  let view = "hub";                               // hub | client-estimate
  let opt = { markup: 0, discount: 0, matMode: "list" }; // matMode: list | sum

  function agg(type) {
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
  function sums() {
    const mats = agg("material"), works = agg("work");
    const matBase = mats.reduce((s, x) => s + x.price * x.qty, 0);
    const k = 1 + (Number(opt.markup) || 0) / 100;
    const matSum = matBase * k;
    const workSum = works.reduce((s, x) => s + x.price * x.qty, 0);
    const subtotal = matSum + workSum;
    const disc = subtotal * (Number(opt.discount) || 0) / 100;
    const total = subtotal - disc;
    return { mats, works, matBase, matSum, workSum, subtotal, disc, total, k };
  }

  function docNo() { try { return localStorage.getItem(NKEY) || "1"; } catch (e) { return "1"; } }
  function setDocNo(v) { try { localStorage.setItem(NKEY, String(v || "1")); } catch (e) {} }
  function today() { const d = new Date(); return ("0" + d.getDate()).slice(-2) + "." + ("0" + (d.getMonth() + 1)).slice(-2) + "." + d.getFullYear(); }

  function masterLine() {
    const P = Profile(); const m = P ? P.getMaster() : {};
    const parts = [];
    if (m.name) parts.push(m.name);
    const t = TYPE_LABEL[m.type]; if (t) parts.push(t);
    if (m.inn) parts.push("ИНН " + m.inn);
    if (m.phone) parts.push("тел. " + m.phone);
    return parts.join(", ");
  }
  function clientInfo() {
    if (ctx.client) { var cc = ctx.client; return { client: [cc.name, cc.phone ? ("тел. " + cc.phone) : ""].filter(Boolean).join(", "), object: cc.object || "" }; }
    const P = Profile(); const c = P ? P.getClient() : {};
    return { client: [c.name, c.phone ? ("тел. " + c.phone) : ""].filter(Boolean).join(", "), object: c.object || "" };
  }

  /* ---------- хаб ---------- */
  function renderHub() {
    const root = document.getElementById("ep-docs-root"); if (!root) return;
    const ctxBanner = ctx.client ? `<div class="ep-docs-ctx" style="background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.3);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">📄 По сохранённой смете для <b>${esc(ctx.client.name || "")}</b> · ${ctx.items ? ctx.items.length : 0} поз.<button type="button" class="ep-clickable" data-doc-ctxclear style="margin-left:auto;background:none;border:none;color:#7c3aed;font-weight:700;cursor:pointer">✕ к общей смете</button></div>` : "";
    root.innerHTML = `
      <div class="ep-docs">
        ${ctxBanner}
        <div class="ep-docs-grid">
          <button type="button" class="ep-doc-item on" data-doc="client-estimate">Смета заказчику<span>Клиентская смета с реквизитами, PDF</span></button>
          <button type="button" class="ep-doc-item on" data-doc="contract">Договор подряда<span>Подрядный договор: реквизиты, стоимость, сроки</span></button>
          <button type="button" class="ep-doc-item on" data-doc="act">Акт выполненных работ<span>Приёмка работ, перечень, подписи</span></button>
          <button type="button" class="ep-doc-item on" data-doc="invoice">Счёт на оплату<span>Реквизиты, банк, сумма к оплате</span></button>
          <button type="button" class="ep-doc-item on" data-doc="warranty">Гарантийный талон<span>Гарантийный срок на работы</span></button>
        </div>
        <div class="ep-docs-actions"><button type="button" class="btn btn-ghost ep-clickable" data-route="main">На главный</button></div>
      </div>`;
  }

  /* ---------- смета заказчику ---------- */
  function renderClientEstimate() {
    const root = document.getElementById("ep-docs-root"); if (!root) return;
    const s = sums();
    const ci = clientInfo();
    const ml = masterLine();
    const profileWarn = (!ml || !ci.client) ? `<div class="ep-docs-warn">Заполни <a href="#" data-route="profile">профиль и клиента</a> — попадут в шапку документа.</div>` : "";
    const matList = opt.matMode === "list"
      ? (s.mats.length ? s.mats.map((x, i) => `<div class="ep-sup-row"><div class="ep-sup-n">${i + 1}. ${esc(x.name)}</div><div class="ep-sup-q">${x.qty} ${esc(x.unit)}</div><div class="ep-sup-p">${money(x.price * s.k)}</div><div class="ep-sup-s">${money(x.price * s.k * x.qty)}</div></div>`).join("") : `<div class="ep-db-empty">Материалов нет.</div>`)
      : `<div class="ep-sup-row"><div class="ep-sup-n">Материалы (комплект)</div><div class="ep-sup-q"></div><div class="ep-sup-p"></div><div class="ep-sup-s">${money(s.matSum)}</div></div>`;
    const workList = s.works.length ? s.works.map((x, i) => `<div class="ep-sup-row"><div class="ep-sup-n">${i + 1}. ${esc(x.name)}</div><div class="ep-sup-q">${x.qty} ${esc(x.unit)}</div><div class="ep-sup-p">${money(x.price)}</div><div class="ep-sup-s">${money(x.price * x.qty)}</div></div>`).join("") : `<div class="ep-db-empty">Работ нет.</div>`;
    root.innerHTML = `
      <div class="ep-docs">
        <div class="ep-docs-bar"><button type="button" class="ep-docs-back" data-doc-back>← Документы</button><div class="ep-docs-title">Смета заказчику</div></div>
        ${profileWarn}
        <div class="ep-doc-head">
          <div><b>Исполнитель:</b> ${esc(ml) || "—"}</div>
          <div><b>Заказчик:</b> ${esc(ci.client) || "—"}</div>
          <div><b>Объект:</b> ${esc(ci.object) || "—"}</div>
        </div>
        <div class="ep-doc-ctrls">
          <label class="ep-prof-f"><span>Смета №</span><input data-doc-no type="text" value="${esc(docNo())}"></label>
          <label class="ep-prof-f"><span>Наценка на материалы, %</span><input data-doc-markup type="number" inputmode="decimal" min="0" value="${opt.markup}"></label>
          <label class="ep-prof-f"><span>Скидка, %</span><input data-doc-disc type="number" inputmode="decimal" min="0" value="${opt.discount}"></label>
          <div class="ep-doc-modes">Материалы:
            <button type="button" class="ep-doc-mode ${opt.matMode === "list" ? "on" : ""}" data-doc-mat="list">списком</button>
            <button type="button" class="ep-doc-mode ${opt.matMode === "sum" ? "on" : ""}" data-doc-mat="sum">суммой</button>
          </div>
        </div>
        <div class="ep-sup-head"><div class="ep-sup-title">Работы</div><div class="ep-sup-sub">итого <b>${money(s.workSum)}</b></div></div>
        <div class="ep-sup-list">${workList}</div>
        <div class="ep-sup-head" style="margin-top:12px"><div class="ep-sup-title">Материалы</div><div class="ep-sup-sub">итого <b>${money(s.matSum)}</b></div></div>
        <div class="ep-sup-list">${matList}</div>
        <div class="ep-doc-totals">
          ${s.disc > 0 ? `<div>Подытог: <b>${money(s.subtotal)}</b></div><div>Скидка ${esc(String(opt.discount))}%: <b>−${money(s.disc)}</b></div>` : ""}
          <div class="ep-doc-grand">К оплате: <b>${money(s.total)}</b></div>
        </div>
        <div class="ep-prof-actions">
          <button type="button" class="btn btn-primary ep-clickable" data-doc-print>Печать / PDF</button>
          <button type="button" class="btn btn-ghost ep-clickable" data-doc-share>Поделиться</button>
        </div>
      </div>`;
  }

  function render() {
    switch (view) {
      case "client-estimate": return renderClientEstimate();
      case "contract": return renderContract();
      case "act": return renderAct();
      case "invoice": return renderInvoice();
      case "warranty": return renderWarranty();
      default: return renderHub();
    }
  }

  /* ---------- параметры документов (хранятся, питают PDF) ---------- */
  const PKEY = "ep_doc_params_v29";
  function allParams() { try { return JSON.parse(localStorage.getItem(PKEY) || "{}") || {}; } catch (e) { return {}; } }
  function docParams(doc) { const a = allParams(); return a[doc] || {}; }
  function setDocParam(doc, key, val) { const a = allParams(); a[doc] = a[doc] || {}; a[doc][key] = val; try { localStorage.setItem(PKEY, JSON.stringify(a)); } catch (e) {} }
  function dp(doc, key, def) { const v = docParams(doc)[key]; return v != null && v !== "" ? v : (def != null ? def : ""); }

  function docHead() {
    const ci = clientInfo(); const ml = masterLine();
    const warn = (!ml || !ci.client) ? '<div class="ep-docs-warn">Заполни <a href="#" data-route="profile">профиль и клиента</a> — попадут в документ.</div>' : "";
    return { ml, ci, warn };
  }
  function pField(doc, key, label, ph, type) {
    return `<label class="ep-prof-f"><span>${label}</span><input data-doc-p="${key}" type="${type || "text"}" value="${esc(docParams(doc)[key] || "")}" placeholder="${esc(ph || "")}"></label>`;
  }
  function renderDocShell(title, paramsHtml, summaryHtml) {
    const root = document.getElementById("ep-docs-root"); if (!root) return;
    const h = docHead();
    root.innerHTML = `
      <div class="ep-docs">
        <div class="ep-docs-bar"><button type="button" class="ep-docs-back" data-doc-back>← Документы</button><div class="ep-docs-title">${esc(title)}</div></div>
        ${h.warn}
        <div class="ep-doc-head"><div><b>Исполнитель:</b> ${esc(h.ml) || "—"}</div><div><b>Заказчик:</b> ${esc(h.ci.client) || "—"}</div><div><b>Объект:</b> ${esc(h.ci.object) || "—"}</div></div>
        <div class="ep-doc-ctrls">${paramsHtml}</div>
        ${summaryHtml || ""}
        <div class="ep-prof-actions">
          <button type="button" class="btn btn-primary ep-clickable" data-doc-print>Печать / PDF</button>
          <button type="button" class="btn btn-ghost ep-clickable" data-doc-share>Поделиться</button>
        </div>
      </div>`;
  }
  function grand(label, val) { return `<div class="ep-doc-totals"><div class="ep-doc-grand">${esc(label)}: <b>${money(val)}</b></div></div>`; }

  // общий конструктор печатной формы документа
  function openDoc(title, bodyHtml) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:22px;max-width:760px;margin:0 auto;font-size:13px;line-height:1.6}
h1{font-size:17px;margin:0 0 6px;text-align:center}h2{font-size:14px;margin:14px 0 4px}p{margin:6px 0}
.row{display:flex;justify-content:space-between;color:#475569;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0}th,td{border:1px solid #cbd5e1;padding:5px 7px}th{background:#f1f5f9;text-align:left}.c{text-align:center}.r{text-align:right}
.sub-t{text-align:right;margin:6px 2px}.grand{text-align:right;font-size:15px;font-weight:700;margin-top:6px}
.sign{display:flex;justify-content:space-between;margin-top:30px;gap:20px}.sign>div{flex:1}
.foot{margin-top:18px;color:#94a3b8;font-size:11px;text-align:center}</style></head>
<body>${bodyHtml}<div class="foot">Electric Pro · документ сформирован автоматически</div>
<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>`;
    const w = window.open("", "_blank");
    if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); }
    else flash("Разреши всплывающие окна для печати");
  }

  /* ---------- договор подряда ---------- */
  function renderContract() {
    const s = sums();
    const p = pField("contract", "no", "Договор №", "1") + pField("contract", "city", "Город", "") +
      pField("contract", "dateStart", "Начало работ", "ДД.ММ.ГГГГ") + pField("contract", "dateEnd", "Окончание", "ДД.ММ.ГГГГ") +
      pField("contract", "avans", "Аванс, %", "30", "number") + pField("contract", "warranty", "Гарантия, мес", "12", "number");
    renderDocShell("Договор подряда", p, grand("Стоимость работ", s.total));
  }
  function printContract() {
    const s = sums(); const h = docHead(); const P = Profile(); const c = P ? P.getClient() : {};
    const avans = Number(dp("contract", "avans", 30)) || 0;
    const body = `
<h1>ДОГОВОР ПОДРЯДА № ${esc(dp("contract", "no", "1"))}</h1>
<div class="row"><span>г. ${esc(dp("contract", "city", "______"))}</span><span>${today()}</span></div>
<p>${esc(h.ml) || "Исполнитель"} (далее «Исполнитель»), с одной стороны, и ${esc(h.ci.client) || "Заказчик"} (далее «Заказчик»), с другой стороны, заключили настоящий договор о нижеследующем:</p>
<h2>1. Предмет договора</h2>
<p>1.1. Исполнитель обязуется выполнить электромонтажные работы на объекте: ${esc(h.ci.object) || "______"}, а Заказчик — принять и оплатить их.<br>1.2. Перечень и объём работ определяются сметой (Приложение №1).</p>
<h2>2. Стоимость и порядок оплаты</h2>
<p>2.1. Стоимость работ составляет ${money(s.total)}.<br>2.2. Аванс ${avans}% — ${money(s.total * avans / 100)}. Окончательный расчёт производится после подписания акта выполненных работ.</p>
<h2>3. Сроки</h2>
<p>3.1. Начало работ: ${esc(dp("contract", "dateStart", "______"))}. Окончание: ${esc(dp("contract", "dateEnd", "______"))}.</p>
<h2>4. Гарантия</h2>
<p>4.1. Гарантийный срок на выполненные работы — ${esc(dp("contract", "warranty", "12"))} мес. с даты подписания акта.</p>
<h2>5. Ответственность сторон</h2>
<p>5.1. За нарушение обязательств по настоящему договору стороны несут ответственность в соответствии с законодательством РФ.</p>
<h2>6. Реквизиты и подписи</h2>
<div class="sign"><div><b>Исполнитель:</b><br>${esc(h.ml) || "—"}<br><br>______________</div><div><b>Заказчик:</b><br>${esc(h.ci.client) || "—"}${c.phone ? ", тел. " + esc(c.phone) : ""}<br><br>______________</div></div>`;
    openDoc("Договор № " + dp("contract", "no", "1"), body);
  }

  /* ---------- акт выполненных работ ---------- */
  function renderAct() {
    const s = sums();
    const p = pField("act", "no", "Акт №", "1") + pField("act", "dogNo", "Договор №", "") + pField("act", "dogDate", "Дата договора", "ДД.ММ.ГГГГ");
    renderDocShell("Акт выполненных работ", p, grand("Сумма по акту", s.total));
  }
  function printAct() {
    const s = sums(); const h = docHead();
    const wrows = s.works.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td class="c">${x.qty} ${esc(x.unit)}</td><td class="r">${money(x.price)}</td><td class="r">${money(x.price * x.qty)}</td></tr>`).join("");
    const dogRef = dp("act", "dogNo", "") ? `по договору № ${esc(dp("act", "dogNo", ""))}${dp("act", "dogDate", "") ? " от " + esc(dp("act", "dogDate", "")) : ""}` : "";
    const body = `
<h1>АКТ № ${esc(dp("act", "no", "1"))} выполненных работ</h1>
<div class="row"><span>${dogRef}</span><span>${today()}</span></div>
<p><b>Исполнитель:</b> ${esc(h.ml) || "—"}<br><b>Заказчик:</b> ${esc(h.ci.client) || "—"}<br><b>Объект:</b> ${esc(h.ci.object) || "—"}</p>
<p>Исполнителем выполнены следующие работы:</p>
<table><thead><tr><th>№</th><th>Работа</th><th class="c">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead><tbody>${wrows || '<tr><td colspan="5" class="c">—</td></tr>'}</tbody></table>
<div class="sub-t">Итого работы: <b>${money(s.workSum)}</b></div>
<div class="sub-t">Материалы: <b>${money(s.matSum)}</b></div>
<div class="grand">ВСЕГО: ${money(s.total)}</div>
<p>Работы выполнены в полном объёме и в установленные сроки. Заказчик претензий по объёму, качеству и срокам выполнения работ не имеет.</p>
<div class="sign"><div><b>Исполнитель</b><br><br>______________</div><div><b>Заказчик</b><br><br>______________</div></div>`;
    openDoc("Акт № " + dp("act", "no", "1"), body);
  }

  /* ---------- счёт на оплату ---------- */
  function renderInvoice() {
    const s = sums(); const P = Profile(); const m = P ? P.getMaster() : {};
    const bankWarn = !m.bank ? '<div class="ep-docs-warn">Укажи банк/расчётный счёт в профиле — добавится в счёт.</div>' : "";
    renderDocShell("Счёт на оплату", pField("invoice", "no", "Счёт №", "1"), bankWarn + grand("К оплате", s.total));
  }
  function printInvoice() {
    const s = sums(); const h = docHead(); const P = Profile(); const m = P ? P.getMaster() : {};
    const body = `
<h1>СЧЁТ № ${esc(dp("invoice", "no", "1"))} от ${today()}</h1>
<p><b>Получатель:</b> ${esc(h.ml) || "—"}${m.bank ? "<br><b>Банк / счёт:</b> " + esc(m.bank) : ""}</p>
<p><b>Плательщик:</b> ${esc(h.ci.client) || "—"}</p>
<table><thead><tr><th>№</th><th>Наименование</th><th class="r">Сумма</th></tr></thead><tbody>
<tr><td>1</td><td>Электромонтажные работы</td><td class="r">${money(s.workSum)}</td></tr>
<tr><td>2</td><td>Материалы</td><td class="r">${money(s.matSum)}</td></tr></tbody></table>
<div class="grand">Всего к оплате: ${money(s.total)}</div>
<p>Оплата настоящего счёта означает согласие с условиями выполнения работ.</p>
<div class="sign"><div><b>Исполнитель</b><br><br>______________</div><div></div></div>`;
    openDoc("Счёт № " + dp("invoice", "no", "1"), body);
  }

  /* ---------- гарантийный талон ---------- */
  function renderWarranty() {
    renderDocShell("Гарантийный талон", pField("warranty", "no", "Талон №", "1") + pField("warranty", "months", "Гарантийный срок, мес", "12", "number"), "");
  }
  function printWarranty() {
    const h = docHead();
    const body = `
<h1>ГАРАНТИЙНЫЙ ТАЛОН № ${esc(dp("warranty", "no", "1"))}</h1>
<div class="row"><span></span><span>${today()}</span></div>
<p><b>Исполнитель:</b> ${esc(h.ml) || "—"}<br><b>Заказчик:</b> ${esc(h.ci.client) || "—"}<br><b>Объект:</b> ${esc(h.ci.object) || "—"}</p>
<p>На выполненные электромонтажные работы устанавливается гарантийный срок <b>${esc(dp("warranty", "months", "12"))} мес.</b> с ${today()}.</p>
<p>Гарантия распространяется на качество выполненных электромонтажных работ. Гарантия не распространяется на повреждения, возникшие вследствие неправильной эксплуатации, самостоятельного вмешательства или вмешательства третьих лиц, аварий в питающей сети и форс-мажорных обстоятельств.</p>
<div class="sign"><div><b>Исполнитель</b><br><br>______________</div><div></div></div>`;
    openDoc("Гарантийный талон № " + dp("warranty", "no", "1"), body);
  }

  function printCurrent() {
    if (view === "client-estimate") return printClientEstimate();
    if (view === "contract") return printContract();
    if (view === "act") return printAct();
    if (view === "invoice") return printInvoice();
    if (view === "warranty") return printWarranty();
  }
  function shareCurrent() {
    if (view === "client-estimate") return shareClientEstimate();
    const s = sums();
    const titles = { contract: "Договор подряда", act: "Акт выполненных работ", invoice: "Счёт на оплату", warranty: "Гарантийный талон" };
    const t = titles[view] || "Документ";
    const text = `${t}\nОбъект: ${clientInfo().object || "—"}\nСумма: ${money(s.total)}`;
    try {
      if (navigator.share) navigator.share({ title: t, text }).catch(() => {});
      else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => flash("Скопировано")).catch(() => flash("Не удалось"));
      else flash("Поделиться недоступно");
    } catch (e) { flash("Поделиться недоступно"); }
  }

  /* ---------- печать ---------- */
  function printClientEstimate() {
    const s = sums(); const ci = clientInfo(); const ml = masterLine();
    const wrows = s.works.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td class="c">${x.qty} ${esc(x.unit)}</td><td class="r">${money(x.price)}</td><td class="r">${money(x.price * x.qty)}</td></tr>`).join("");
    const mrows = opt.matMode === "list"
      ? s.mats.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td class="c">${x.qty} ${esc(x.unit)}</td><td class="r">${money(x.price * s.k)}</td><td class="r">${money(x.price * s.k * x.qty)}</td></tr>`).join("")
      : `<tr><td>1</td><td>Материалы (комплект)</td><td class="c"></td><td class="r"></td><td class="r">${money(s.matSum)}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Смета № ${esc(docNo())}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:20px;max-width:760px;margin:0 auto}
h1{font-size:18px;margin:0 0 4px}.sub{color:#475569;font-size:12px;margin-bottom:12px}
.head{font-size:13px;line-height:1.6;margin-bottom:14px;border:1px solid #e2e8f0;border-radius:8px;padding:10px}
h2{font-size:14px;margin:16px 0 6px}table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #cbd5e1;padding:5px 7px}th{background:#f1f5f9;text-align:left}.c{text-align:center}.r{text-align:right}
.sub-t{text-align:right;font-size:13px;margin:6px 2px}.grand{text-align:right;font-size:16px;font-weight:700;margin-top:8px}
.sign{display:flex;justify-content:space-between;margin-top:34px;font-size:13px}.foot{margin-top:18px;color:#94a3b8;font-size:11px}</style></head>
<body>
<h1>Смета № ${esc(docNo())}</h1><div class="sub">от ${today()}</div>
<div class="head"><div><b>Исполнитель:</b> ${esc(ml) || "—"}</div><div><b>Заказчик:</b> ${esc(ci.client) || "—"}</div><div><b>Объект:</b> ${esc(ci.object) || "—"}</div></div>
<h2>Работы</h2><table><thead><tr><th>№</th><th>Наименование</th><th class="c">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead><tbody>${wrows || '<tr><td colspan="5" class="c">—</td></tr>'}</tbody></table>
<div class="sub-t">Итого работы: <b>${money(s.workSum)}</b></div>
<h2>Материалы</h2><table><thead><tr><th>№</th><th>Наименование</th><th class="c">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead><tbody>${mrows || '<tr><td colspan="5" class="c">—</td></tr>'}</tbody></table>
<div class="sub-t">Итого материалы: <b>${money(s.matSum)}</b></div>
${s.disc > 0 ? `<div class="sub-t">Подытог: <b>${money(s.subtotal)}</b></div><div class="sub-t">Скидка ${esc(String(opt.discount))}%: <b>−${money(s.disc)}</b></div>` : ""}
<div class="grand">К ОПЛАТЕ: ${money(s.total)}</div>
<div class="sign"><div>Исполнитель ______________</div><div>Заказчик ______________</div></div>
<div class="foot">Electric Pro</div>
<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>`;
    const w = window.open("", "_blank");
    if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); }
    else flash("Разреши всплывающие окна для печати");
  }

  function shareClientEstimate() {
    const s = sums(); const ci = clientInfo();
    const text = `Смета № ${docNo()} от ${today()}\nОбъект: ${ci.object || "—"}\n\nРаботы: ${money(s.workSum)}\nМатериалы: ${money(s.matSum)}\nК оплате: ${money(s.total)}`;
    try {
      if (navigator.share) navigator.share({ title: "Смета № " + docNo(), text }).catch(() => {});
      else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => flash("Скопировано")).catch(() => flash("Не удалось"));
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

  document.addEventListener("input", (e) => {
    const t = e.target; if (!t || !t.getAttribute || !document.getElementById("ep-docs-root")) return;
    if (t.hasAttribute("data-doc-no")) { setDocNo(t.value); }
    else if (t.hasAttribute("data-doc-markup")) { opt.markup = Number(t.value) || 0; }
    else if (t.hasAttribute("data-doc-disc")) { opt.discount = Number(t.value) || 0; }
    else if (t.hasAttribute("data-doc-p")) { setDocParam(view, t.getAttribute("data-doc-p"), t.value); }
  });
  // пересчёт превью — по уходу с поля (не на каждый символ), чтобы не сбивать фокус
  document.addEventListener("change", (e) => {
    const t = e.target; if (!t || !t.getAttribute || !document.getElementById("ep-docs-root")) return;
    if ((t.hasAttribute("data-doc-markup") || t.hasAttribute("data-doc-disc")) && view === "client-estimate") renderClientEstimate();
  });

  document.addEventListener("click", (e) => {
    const t = e.target; if (!t || !t.closest) return;
    let el;
    if ((el = t.closest("[data-doc]"))) { view = el.getAttribute("data-doc"); render(); return; }
    if (t.closest("[data-doc-ctxclear]")) { ctx = { items: null, client: null }; view = "hub"; render(); return; }
    if (t.closest("[data-doc-back]")) { view = "hub"; render(); return; }
    if ((el = t.closest("[data-doc-mat]"))) { opt.matMode = el.getAttribute("data-doc-mat") === "sum" ? "sum" : "list"; renderClientEstimate(); return; }
    if (t.closest("[data-doc-print]")) { printCurrent(); return; }
    if (t.closest("[data-doc-share]")) { shareCurrent(); return; }
  });

  window.addEventListener("ep:route-loaded", (e) => {
    const r = e && e.detail && e.detail.route;
    if (r === "documents") { view = "hub"; render(); }
    else { ctx = { items: null, client: null }; }   // ушли со страницы документов — контекст сбрасывается
  });
  window.addEventListener("ep:estimate-main-changed", () => { if (document.getElementById("ep-docs-root") && view === "client-estimate") renderClientEstimate(); });

  // вызывается из раздела «Клиенты»: открыть документы по сохранённой смете конкретного клиента
  window.EP = window.EP || {};
  window.EP.Documents = {
    openFor: function (o) {
      o = o || {};
      ctx = { items: Array.isArray(o.items) ? o.items : null, client: o.client || null };
      view = "hub";
      if (window.EP && window.EP.Router) window.EP.Router.go("documents");
    }
  };
})();
