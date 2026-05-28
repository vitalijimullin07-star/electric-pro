(function () {
  "use strict";

  if (window.__EP_V2615_MAIN_DB_PICK_ESTIMATE__) return;
  window.__EP_V2615_MAIN_DB_PICK_ESTIMATE__ = true;

  const VERSION = "V26.17";
  const FILE = "assets/js/electric-pro-v26-15-main-db-pick-estimate.js";

  const KEYS = {
    activeBase: "epdb26_active_base",
    my: "epdb26_my",
    server: "epdb26_server",
    estimate: "ep_estimate_draft_v23",
    access: "ep_access_v26_state"
  };

  const state = {
    pickerType: "material",
    pickerBase: "my",
    query: ""
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function esc(v) {
    return String(v ?? "").replace(/[&<>\"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '\"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function norm(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[×хx]/g, "x")
      .replace(/[^a-zа-я0-9x.,\s/_-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function money(v) {
    return Math.round(Number(v || 0)).toLocaleString("ru-RU") + " ₽";
  }

  function uidHash(text) {
    let h = 0;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "EPV2615MainDbPickEstimate",
        functionName: "runtime",
        place: "main-db-pick-estimate",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    let box = $("#ep2615-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep2615-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__ep2615ToastTimer);
    window.__ep2615ToastTimer = setTimeout(() => box.classList.remove("show"), 1400);
  }

  function injectCss() {
    if ($("#ep2615-style")) return;
    const st = document.createElement("style");
    st.id = "ep2615-style";
    st.textContent = `
#ep266-access-bar{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;}
#epTopStatusLine.ep-top-status-line{position:relative!important;top:auto!important;left:auto!important;right:auto!important;z-index:70!important;height:7mm!important;min-height:7mm!important;max-height:7mm!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:6px!important;align-items:center!important;margin:0 8px 5px!important;padding:0 8px!important;border-radius:0 0 16px 16px!important;background:rgba(241,245,249,.94)!important;border:1px solid rgba(15,23,42,.08)!important;border-top:0!important;box-shadow:0 8px 24px rgba(15,23,42,.12)!important;backdrop-filter:blur(16px)!important;overflow:hidden!important;}
#epTopStatusLine .ep-top-status-left,#epTopStatusLine .ep-top-status-right{min-width:0!important;height:4.6mm!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:0 7px!important;border-radius:999px!important;font:950 9px/1 system-ui,-apple-system,"Segoe UI",sans-serif!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;background:rgba(226,232,240,.92)!important;}
#epTopStatusLine .ep-top-status-left{justify-content:flex-start!important;}
#epTopStatusLine[data-status="pro"] .ep-top-status-left{background:rgba(34,197,94,.20)!important;color:#064e3b!important;}
#epTopStatusLine[data-status="basic"] .ep-top-status-left{background:rgba(59,130,246,.17)!important;color:#1e3a8a!important;}
#epTopStatusLine[data-status="trial"] .ep-top-status-left{background:rgba(245,158,11,.22)!important;color:#78350f!important;}
#epTopStatusLine[data-status="none"] .ep-top-status-left{background:rgba(239,68,68,.13)!important;color:#7f1d1d!important;}
#epTopStatusLine[data-ai="own_api"] .ep-top-status-right{background:rgba(168,85,247,.16)!important;color:#581c87!important;}
#epTopStatusLine[data-ai="admin_api"] .ep-top-status-right{background:rgba(34,197,94,.18)!important;color:#064e3b!important;}
#epTopStatusLine[data-ai="disabled"] .ep-top-status-right{background:rgba(239,68,68,.13)!important;color:#7f1d1d!important;}
#epTopStatusLine .ep-top-status-right{max-width:33vw!important;}
.ep2615-picker{position:fixed;inset:0;z-index:2500;background:linear-gradient(135deg,rgba(2,20,21,.97),rgba(13,28,52,.97));color:#f8fafc;display:flex;flex-direction:column;padding:12px 14px 18px;overflow:hidden;}
.ep2615-picker.hidden{display:none!important;}
.ep2615-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
.ep2615-back{width:50px;height:50px;border:0;border-radius:22px;background:rgba(241,245,249,.92);color:#0f172a;font:900 22px/1 system-ui;}
.ep2615-title{flex:1;min-width:0;}
.ep2615-title h2{margin:0;font:950 26px/1.05 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.02em;}
.ep2615-title p{margin:5px 0 0;color:#b8c4d3;font:800 13px/1.2 system-ui;}
.ep2615-pill{height:40px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:0 16px;background:rgba(187,247,208,.20);color:#bbf7d0;font:950 14px/1 system-ui;white-space:nowrap;}
.ep2615-switch{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:4px 0 10px;}
.ep2615-switch button{height:48px;border:1px solid rgba(148,163,184,.24);border-radius:18px;background:rgba(15,23,42,.58);color:#cbd5e1;font:950 15px/1 system-ui;}
.ep2615-switch button.on{background:rgba(187,247,208,.18);border-color:rgba(34,197,94,.34);color:#bbf7d0;}
.ep2615-search{width:100%;height:52px;border:0;border-radius:20px;background:rgba(248,250,252,.94);color:#0f172a;padding:0 18px;font:850 17px/1 system-ui;outline:none;margin-bottom:10px;}
.ep2615-list{flex:1;overflow:auto;padding:2px 0 90px;display:flex;flex-direction:column;gap:10px;}
.ep2615-card{background:rgba(248,250,252,.96);color:#0f172a;border-radius:22px;padding:14px 14px;box-shadow:0 14px 34px rgba(0,0,0,.20);}
.ep2615-card-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start;}
.ep2615-card b{display:block;font:950 20px/1.15 system-ui;letter-spacing:-.015em;}
.ep2615-card p{margin:7px 0 0;color:#64748b;font:800 13px/1.25 system-ui;}
.ep2615-price{font:950 19px/1 system-ui;white-space:nowrap;}
.ep2615-qty{display:grid;grid-template-columns:54px minmax(0,1fr) 54px;gap:10px;align-items:center;margin-top:12px;}
.ep2615-qty button{height:50px;border:0;border-radius:15px;background:#020617;color:white;font:950 25px/1 system-ui;}
.ep2615-qty strong{height:50px;display:flex;align-items:center;justify-content:center;border-radius:15px;background:rgba(226,232,240,.85);font:950 22px/1 system-ui;}
.ep2615-empty{padding:28px 18px;border-radius:24px;background:rgba(248,250,252,.92);color:#334155;font:900 18px/1.3 system-ui;}
.ep2615-estimate-card{margin-top:14px;}
.ep2615-estimate-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}
.ep2615-estimate-head h3{margin:0;font:950 24px/1.1 system-ui;}
.ep2615-estimate-total{display:inline-flex;align-items:center;border-radius:999px;background:rgba(34,197,94,.18);color:#bbf7d0;padding:8px 12px;font:950 13px/1 system-ui;white-space:nowrap;}
.ep2615-estimate-list{display:flex;flex-direction:column;gap:8px;margin:10px 0 12px;}
.ep2615-estimate-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border-radius:17px;background:rgba(15,23,42,.42);border:1px solid rgba(148,163,184,.16);padding:10px 12px;}
.ep2615-estimate-row b{display:block;color:#f8fafc;font:900 15px/1.2 system-ui;}
.ep2615-estimate-row p{margin:4px 0 0;color:#94a3b8;font:800 12px/1.15 system-ui;}
.ep2615-estimate-row strong{color:#f8fafc;font:950 14px/1 system-ui;white-space:nowrap;}
.ep2615-estimate-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.ep2615-estimate-actions button{height:48px;border:0;border-radius:18px;font:950 15px/1 system-ui;}
.ep2615-estimate-actions .primary{background:#22c55e;color:white;}
.ep2615-estimate-actions .ghost{background:rgba(15,23,42,.50);color:white;border:1px solid rgba(148,163,184,.22);}
#ep2615-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(20px);z-index:3100;opacity:0;pointer-events:none;background:rgba(15,23,42,.94);color:#f8fafc;border:1px solid rgba(148,163,184,.24);border-radius:999px;padding:12px 16px;font:900 14px/1 system-ui;box-shadow:0 12px 34px rgba(0,0,0,.35);transition:.18s ease;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis;}
#ep2615-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
`; 
    document.head.appendChild(st);
  }

  function accessStatusKind(text) {
    const t = norm(text);
    if (t.includes("с ии") || t.includes("pro") || t.includes("ai")) return "pro";
    if (t.includes("баз") || t.includes("basic")) return "basic";
    if (t.includes("тест") || t.includes("проб") || t.includes("trial")) return "trial";
    return "none";
  }

  function accessAiKind(text) {
    const t = norm(text);
    if (t.includes("api") || t.includes("клиент") || t.includes("мастер")) return "own_api";
    if (t.includes("100") || t.includes("₽") || t.includes("руб") || (t.includes("ии") && !t.includes("выкл"))) return "admin_api";
    return "disabled";
  }

  function normalizeTopStatus() {
    injectCss();
    $$("#ep266-access-bar").forEach(el => el.remove());

    const topbar = $(".topbar") || $("header");
    if (!topbar) return;

    let line = $("#epTopStatusLine");
    if (!line) {
      line = document.createElement("div");
      line.id = "epTopStatusLine";
      line.className = "ep-top-status-line";
      topbar.insertAdjacentElement("afterend", line);
    }

    line.className = "ep-top-status-line";
    if (!line.querySelector(".ep-top-status-left") || !line.querySelector(".ep-top-status-right")) {
      line.innerHTML = '<div class="ep-top-status-left"></div><div class="ep-top-status-right"></div>';
    }

    if (topbar.nextElementSibling !== line && topbar.parentElement) {
      topbar.parentElement.insertBefore(line, topbar.nextSibling);
    }

    const access = readJson(KEYS.access, {});
    const subText = access.subscriptionLabel || line.querySelector(".ep-top-status-left")?.textContent?.trim() || "Нет подписки";
    const aiText = access.aiLabel || line.querySelector(".ep-top-status-right")?.textContent?.trim() || "ИИ выкл.";

    line.querySelector(".ep-top-status-left").textContent = subText;
    line.querySelector(".ep-top-status-right").textContent = aiText;
    line.dataset.status = accessStatusKind(subText);
    line.dataset.ai = accessAiKind(aiText);
  }

  function dedupeMenuBadges() {
    const rows = $$("button,a,li,div,[role='button']").filter(row => {
      if (row.closest("#ep-db-v26,#db26modal,.ep2615-picker")) return false;
      const t = norm(row.textContent);
      if (!t.includes("база данных")) return false;
      const r = row.getBoundingClientRect();
      return r.height > 20 && r.height < 130 && r.width > 120;
    });

    rows.forEach(row => {
      const badges = $$("span,em,b,strong,small,i,div", row).filter(b => {
        const tx = String(b.textContent || "").trim();
        if (!/^v\d+(\.\d+){0,4}$/i.test(tx)) return false;
        if (/база данных/i.test(tx)) return false;
        return b.getBoundingClientRect().width > 12;
      });
      badges.forEach((b, i) => {
        if (i === 0) {
          b.style.removeProperty("display");
          b.style.removeProperty("visibility");
        } else {
          b.style.setProperty("display", "none", "important");
          b.style.setProperty("visibility", "hidden", "important");
        }
      });
    });
  }

  function normalizeItem(raw = {}, typeHint = "") {
    const typeText = norm(typeHint || raw.type || raw.kind || raw.categoryType || "");
    const type = typeText.includes("work") || typeText.includes("работ") ? "work" : "material";
    const name = String(raw.name || raw.n || raw.title || raw["Наименование"] || "Позиция").trim();
    const unit = String(raw.unit || raw.u || raw.ed || raw["Ед"] || "шт").trim();
    const price = Number(raw.price ?? raw.p ?? raw.cost ?? raw["Цена"] ?? 0) || 0;
    const category = String(raw.category || raw.c || raw.cat || raw.folder || raw["Папка"] || (type === "work" ? "Работы" : "Материалы")).trim();
    const subcategory = String(raw.subcategory || raw.sc || raw.sub || raw.g || raw.group || raw["Подпапка"] || "Без подкатегории").trim();
    return {
      ...raw,
      id: String(raw.id || uidHash([type, name, unit, category, subcategory].join("|"))),
      type,
      name,
      n: name,
      unit,
      u: unit,
      price,
      p: price,
      category,
      c: category,
      subcategory,
      sc: subcategory,
      active: raw.active !== false
    };
  }

  function sortRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map(x => normalizeItem(x, x?.type))
      .filter(x => x.active !== false)
      .sort((a, b) => String(a.category).localeCompare(String(b.category), "ru") || String(a.subcategory).localeCompare(String(b.subcategory), "ru") || String(a.name).localeCompare(String(b.name), "ru"));
  }

  function setActiveBase(base) {
    const b = base === "server" ? "server" : "my";
    localStorage.setItem(KEYS.activeBase, b);
    state.pickerBase = b;
  }


  function getActiveBase() {
    // Источник правды — переключатель внутри экрана «База данных».
    // Раньше сначала читался localStorage, поэтому после выбора «БД моя»
    // подбор «Работа/Материалы» мог всё равно открыть «БД сервера».
    const activeBtn = $("#ep-db-v26 [data-db26-base].on");
    const domBase = activeBtn?.dataset?.db26Base;
    if (domBase === "server" || domBase === "my") {
      localStorage.setItem(KEYS.activeBase, domBase);
      return domBase;
    }

    const dbRoot = $("#ep-db-v26");
    if (dbRoot) {
      const txt = norm(dbRoot.textContent || "");
      if (txt.includes("бд моя") || txt.includes("личная база")) {
        localStorage.setItem(KEYS.activeBase, "my");
        return "my";
      }
      if (txt.includes("бд сервера") || txt.includes("серверная база")) {
        localStorage.setItem(KEYS.activeBase, "server");
        return "server";
      }
    }

    const saved = localStorage.getItem(KEYS.activeBase);
    if (saved === "server" || saved === "my") return saved;
    return "my";
  }

  function dbRows(base, type) {
    const key = base === "server" ? KEYS.server : KEYS.my;
    const q = norm(state.query);
    return sortRows(readJson(key, []))
      .filter(x => x.type === type)
      .filter(x => !q || norm([x.name, x.category, x.subcategory, x.unit, x.price].join(" ")).includes(q));
  }

  function getDraft() {
    try {
      if (window.EstimateCoreV231?.getDraft) return window.EstimateCoreV231.getDraft();
    } catch (e) {}
    const d = readJson(KEYS.estimate, null);
    return d && Array.isArray(d.rows) ? d : { version: "V23.1", updatedAt: "", rows: [] };
  }

  function saveDraft(draft) {
    const out = { version: draft.version || "V23.1", updatedAt: new Date().toISOString(), rows: Array.isArray(draft.rows) ? draft.rows : [] };
    try {
      if (window.EstimateCoreV231?.saveDraft) window.EstimateCoreV231.saveDraft(out);
      else writeJson(KEYS.estimate, out);
    } catch (e) {
      writeJson(KEYS.estimate, out);
    }
    renderMainEstimate();
    renderPickerQtyOnly();
    return out;
  }

  function pickKey(base, item) {
    return [base, item.type, item.id || item.name, item.unit].join("|");
  }

  function findDraftRow(rows, key) {
    return rows.find(r => r?.raw?.dbPickKey === key) || rows.find(r => r?.source === "dbpick" && [r?.raw?.dbSourceBase, r?.type, r?.dbItemId || r?.raw?.dbItemId, r?.unit].join("|") === key);
  }

  function qtyInDraft(base, item) {
    const key = pickKey(base, item);
    const row = findDraftRow(getDraft().rows || [], key);
    return Number(row?.qty || 0) || 0;
  }

  function upsertPickedItem(base, item, qty) {
    const draft = getDraft();
    const rows = Array.isArray(draft.rows) ? draft.rows : [];
    const key = pickKey(base, item);
    const index = rows.findIndex(r => r?.raw?.dbPickKey === key);
    const safeQty = Math.max(0, Number(qty || 0));

    if (safeQty <= 0) {
      if (index >= 0) rows.splice(index, 1);
      saveDraft({ ...draft, rows });
      toast("Позиция убрана из сметы");
      return;
    }

    const row = {
      id: "dbpick_" + uidHash(key),
      createdAt: new Date().toISOString(),
      source: "dbpick",
      sourceVersion: VERSION,
      sourceBatchId: "manual_db_pick",
      type: item.type,
      category: item.category || "",
      subcategory: item.subcategory || "",
      name: item.name,
      calcName: item.name,
      dbName: item.name,
      dbItemId: item.id,
      qty: safeQty,
      unit: item.unit || "шт",
      price: Number(item.price || 0) || 0,
      total: Math.round(safeQty * (Number(item.price || 0) || 0) * 100) / 100,
      missingDb: false,
      warning: "",
      note: base === "server" ? "Добавлено из БД сервера" : "Добавлено из Моей БД",
      customerVisible: item.type === "work",
      supplierVisible: item.type === "material",
      raw: {
        dbPickKey: key,
        dbSourceBase: base,
        dbItemId: item.id,
        dbSourceKey: base === "server" ? KEYS.server : KEYS.my,
        dbPickScore: 100
      }
    };

    if (index >= 0) rows[index] = { ...rows[index], ...row, id: rows[index].id || row.id, createdAt: rows[index].createdAt || row.createdAt };
    else rows.push(row);

    saveDraft({ ...draft, rows });
    toast("Добавлено в предварительную смету");
  }

  function ensurePicker() {
    injectCss();
    let root = $("#ep2615-picker");
    if (root) return root;
    root = document.createElement("div");
    root.id = "ep2615-picker";
    root.className = "ep2615-picker hidden";
    document.body.appendChild(root);
    return root;
  }

  function baseTitle(base) {
    return base === "server" ? "БД сервера" : "БД моя";
  }

  function typeTitle(type) {
    return type === "work" ? "Работа" : "Материалы";
  }

  function renderPicker() {
    const root = ensurePicker();
    const type = state.pickerType;
    const base = state.pickerBase;
    const rows = dbRows(base, type);

    root.innerHTML = `
      <div class="ep2615-head">
        <button type="button" class="ep2615-back" data-ep2615-close>←</button>
        <div class="ep2615-title">
          <h2>${esc(typeTitle(type))}</h2>
          <p>${esc(baseTitle(base))} · плюс/минус сразу меняет предварительную смету</p>
        </div>
        <span class="ep2615-pill">${esc(rows.length)} поз.</span>
      </div>
      <div class="ep2615-active-base">Активная база: <b>${esc(baseTitle(base))}</b></div>
      <input class="ep2615-search" data-ep2615-search placeholder="Поиск..." value="${esc(state.query)}">
      <div class="ep2615-list">
        ${rows.length ? rows.map(row => pickerCard(row, base)).join("") : `<div class="ep2615-empty">Позиции не найдены. Проверь выбранную базу или импорт БД.</div>`}
      </div>
    `;
  }

  function pickerCard(row, base) {
    const qty = qtyInDraft(base, row);
    return `
      <article class="ep2615-card" data-ep2615-id="${esc(row.id)}">
        <div class="ep2615-card-top">
          <div>
            <b>${esc(row.name)}</b>
            <p>${esc(row.type === "work" ? "Работа" : "Материал")} · ${esc(row.category)} / ${esc(row.subcategory)} · ${esc(row.unit)}</p>
          </div>
          <div class="ep2615-price">${esc(money(row.price))}</div>
        </div>
        <div class="ep2615-qty">
          <button type="button" data-ep2615-dec="${esc(row.id)}">-</button>
          <strong data-ep2615-qty="${esc(row.id)}">${esc(qty)}</strong>
          <button type="button" data-ep2615-inc="${esc(row.id)}">+</button>
        </div>
      </article>
    `;
  }

  function renderPickerQtyOnly() {
    const root = $("#ep2615-picker:not(.hidden)");
    if (!root) return;
    const rows = dbRows(state.pickerBase, state.pickerType);
    rows.forEach(row => {
      const el = root.querySelector(`[data-ep2615-qty="${cssAttr(row.id)}"]`);
      if (el) el.textContent = String(qtyInDraft(state.pickerBase, row));
    });
  }

  function cssAttr(value) {
    if (window.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/"/g, '\\"');
  }

  function findDbRowById(id) {
    return dbRows(state.pickerBase, state.pickerType).find(x => String(x.id) === String(id));
  }

  function changeQty(id, delta) {
    const item = findDbRowById(id);
    if (!item) return;
    const current = qtyInDraft(state.pickerBase, item);
    const next = Math.max(0, current + delta);
    upsertPickedItem(state.pickerBase, item, next);
  }

  function openPicker(type) {
    patchMainPageStaticCards();
    state.pickerType = type === "work" ? "work" : "material";
    state.pickerBase = getActiveBase();
    state.query = "";
    const root = ensurePicker();
    renderPicker();
    root.classList.remove("hidden");
    document.body.classList.add("ep2615-picker-open");
    setTimeout(() => $("[data-ep2615-search]", root)?.focus?.(), 80);
    diag("open-picker", "Открыт выбор из активной БД.", { type: state.pickerType, base: state.pickerBase });
  }

  function closePicker() {
    $("#ep2615-picker")?.classList.add("hidden");
    document.body.classList.remove("ep2615-picker-open");
    renderMainEstimate();
  }

  function totals(rows) {
    return (rows || []).reduce((acc, row) => {
      const val = Number(row.total || (Number(row.qty || 0) * Number(row.price || 0)) || 0);
      acc.all += val;
      if (row.type === "work") acc.work += val;
      else acc.material += val;
      return acc;
    }, { all: 0, work: 0, material: 0 });
  }

  function findMainEstimateCard() {
    return $$(".card").find(card => /Предварительная смета/i.test(card.textContent || ""));
  }

  function renderMainEstimate() {
    if (document.body.dataset.route && document.body.dataset.route !== "main") return;
    const card = findMainEstimateCard();
    if (!card) return;

    card.classList.add("ep2615-estimate-card");
    const rows = getDraft().rows || [];
    const t = totals(rows);
    const preview = rows.slice(-8).reverse();

    card.innerHTML = `
      <div class="ep2615-estimate-head">
        <h3>Предварительная смета</h3>
        <span class="ep2615-estimate-total">${esc(money(t.all))}</span>
      </div>
      ${rows.length ? `<p class="badge">${esc(rows.length)} поз. · работы ${esc(money(t.work))} · материалы ${esc(money(t.material))}</p>` : `<p class="badge">Пока пусто</p>`}
      <div class="ep2615-estimate-list">
        ${preview.length ? preview.map(row => `
          <div class="ep2615-estimate-row">
            <div>
              <b>${esc(row.dbName || row.name)}</b>
              <p>${esc(row.type === "work" ? "Работа" : "Материал")} · ${esc(row.qty)} ${esc(row.unit)} · ${esc(money(row.price))}</p>
            </div>
            <strong>${esc(money(row.total))}</strong>
          </div>
        `).join("") : `<p style="color:var(--muted);">Нажми «Материалы» или «Работа», выбери позиции плюсиками — они появятся здесь.</p>`}
      </div>
      <div class="ep2615-estimate-actions">
        <button type="button" class="primary" data-ep2615-open-estimate>Открыть черновик</button>
        <button type="button" class="ghost" data-ep2615-clear-estimate>Очистить</button>
      </div>
    `;
  }

  function clearEstimate() {
    if (!confirm("Очистить предварительную смету?")) return;
    saveDraft({ version: "V23.1", rows: [] });
    toast("Предварительная смета очищена");
  }


  function interceptMainCards(event) {
    const tile = event.target.closest?.("[data-ep2615-main-picker],[data-ep2616-main-picker],.tile");
    if (!tile) return false;
    if (document.body.dataset.route && document.body.dataset.route !== "main") return false;

    const explicit = tile.getAttribute("data-ep2615-main-picker") || tile.getAttribute("data-ep2616-main-picker") || "";
    const h = norm(tile.querySelector?.("h3")?.textContent || "");
    const type = explicit || (h === "материалы" ? "material" : h === "работа" ? "work" : "");

    if (type !== "material" && type !== "work") return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    openPicker(type);
    return true;
  }

  function bindEvents() {
    if (window.__ep2615Bound) return;
    window.__ep2615Bound = true;

    document.addEventListener("click", event => {
      const baseBtn = event.target.closest?.("#ep-db-v26 [data-db26-base]");
      if (baseBtn) setActiveBase(baseBtn.dataset.db26Base);

      const mainIntercepted = interceptMainCards(event);
      if (mainIntercepted) return;

      if (event.target.closest?.("[data-ep2615-close]")) {
        event.preventDefault();
        closePicker();
        return;
      }

      const basePick = event.target.closest?.("[data-ep2615-base]");
      if (basePick) {
        event.preventDefault();
        setActiveBase(basePick.dataset.ep2615Base);
        renderPicker();
        return;
      }

      const inc = event.target.closest?.("[data-ep2615-inc]");
      if (inc) {
        event.preventDefault();
        changeQty(inc.dataset.ep2615Inc, 1);
        return;
      }

      const dec = event.target.closest?.("[data-ep2615-dec]");
      if (dec) {
        event.preventDefault();
        changeQty(dec.dataset.ep2615Dec, -1);
        return;
      }

      if (event.target.closest?.("[data-ep2615-open-estimate]")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        try {
          if (window.Router?.load) window.Router.load("estimate");
          else window.EstimateCoreV231?.openPanel?.();
        } catch (e) {}
        return;
      }

      if (event.target.closest?.("[data-ep2615-clear-estimate]")) {
        event.preventDefault();
        clearEstimate();
        return;
      }

      if (event.target.closest?.("#burgerBtn,.burger-btn,[aria-label='Открыть меню']")) {
        setTimeout(dedupeMenuBadges, 120);
        setTimeout(dedupeMenuBadges, 450);
      }
    }, true);

    document.addEventListener("input", event => {
      const input = event.target.closest?.("[data-ep2615-search]");
      if (!input) return;
      state.query = input.value || "";
      renderPicker();
      const nextInput = $("[data-ep2615-search]");
      if (nextInput) {
        nextInput.focus();
        try { nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length); } catch (e) {}
      }
    }, true);
  }

  function patchRouter() {
    if (!window.Router || typeof window.Router.load !== "function" || window.Router.load.__ep2615Patched) return;
    const oldLoad = window.Router.load.bind(window.Router);
    const wrapped = async function (route, ...args) {
      const result = await oldLoad(route, ...args);
      if (route === "main" || route === "home") {
        setTimeout(renderMainEstimate, 80);
        setTimeout(renderMainEstimate, 400);
      }
      return result;
    };
    wrapped.__ep2615Patched = true;
    wrapped.__ep2615Original = oldLoad;
    window.Router.load = wrapped;
  }


  function patchMainPageStaticCards() {
    const cards = $$(".tile,[data-route],[onclick]");
    cards.forEach(card => {
      const h = norm(card.querySelector?.("h3")?.textContent || card.textContent || "");
      const isMaterials = h === "материалы" || /(^|\s)материалы(\s|$)/.test(h) && !h.includes("детализация");
      const isWork = h === "работа" || /(^|\s)работа(\s|$)/.test(h);

      if (isMaterials) {
        card.setAttribute("data-ep2615-main-picker", "material");
        card.setAttribute("data-ep2616-main-picker", "material");
      } else if (isWork) {
        card.setAttribute("data-ep2615-main-picker", "work");
        card.setAttribute("data-ep2616-main-picker", "work");
      } else {
        // ВАЖНО: прошлый патч без скобок случайно ставил material почти всем плиткам,
        // из-за этого «Предварительная смета» открывала материалы.
        card.removeAttribute("data-ep2615-main-picker");
        card.removeAttribute("data-ep2616-main-picker");
      }
    });
  }

  function boot() {
    injectCss();
    normalizeTopStatus();
    dedupeMenuBadges();
    bindEvents();
    patchRouter();
    patchMainPageStaticCards();
    renderMainEstimate();
  }

  window.EPMainDbPickEstimate = {
    version: VERSION,
    open: openPicker,
    close: closePicker,
    renderMainEstimate,
    getActiveBase,
    setActiveBase
  };

  window.addEventListener("DOMContentLoaded", () => {
    boot();
    [150, 500, 1200, 2500, 5000].forEach(ms => setTimeout(boot, ms));
  });

  window.addEventListener("storage", event => {
    if ([KEYS.estimate, KEYS.access, KEYS.my, KEYS.server].includes(event.key)) {
      setTimeout(boot, 80);
      if (!$("#ep2615-picker")?.classList.contains("hidden")) renderPicker();
    }
  });

  diag("ready", "V26.15 main DB picker and preliminary estimate ready.");
})();
