(function () {
  const VERSION = "V28.7";
  const FILE = "assets/js/estimate-core-v23-1.js";
  const STORAGE_KEY = "ep_estimate_draft_v23";
  const POOL_DRAFT_KEY = "ep_pool_v22_draft";

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const moneyApi = () => window.EPDBMoneyV287;
  const activeBase = () => window.EPDatabaseV27?.getActiveBase?.() || document.body?.dataset?.epActiveBase || "my";
  const parsePrice = v => moneyApi()?.parseMoneyInput?.(v) ?? n(String(v ?? 0).replace(",", "."), 0);
  const calcLineTotal = (price, qty) => moneyApi()?.calcLineTotal?.(price, qty) ?? (Math.round(parsePrice(price) * n(qty, 0) * 100) / 100);
  const unitPriceText = (value, base) => moneyApi()?.formatUnitPrice?.(value, base || activeBase()) ?? String(parsePrice(value));
  const uid = () => "ed_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

  function money(v, base) {
    return moneyApi()?.formatMoneyTotal?.(v, base || activeBase()) ?? (Math.round(n(v, 0)).toLocaleString("ru-RU") + " ₽");
  }

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "EstimateCoreV231",
        functionName: "runtime",
        place: "estimate-core",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    let box = document.getElementById("ep-estimate-core-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-estimate-core-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__estimateCoreToast);
    window.__estimateCoreToast = setTimeout(() => box.classList.remove("show"), 1800);
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "");
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function getDraft() {
    const data = readJson(STORAGE_KEY, null);
    if (data && Array.isArray(data.rows)) {
      return {
        version: data.version || VERSION,
        updatedAt: data.updatedAt || "",
        settings: data.settings || moneyApi()?.getSettings?.(activeBase()) || null,
        rows: data.rows
      };
    }
    return {
      version: VERSION,
      updatedAt: "",
      rows: []
    };
  }

  function saveDraft(draft) {
    const out = {
      version: VERSION,
      updatedAt: new Date().toISOString(),
      settings: draft.settings || moneyApi()?.getSettings?.(activeBase()) || null,
      rows: Array.isArray(draft.rows) ? draft.rows : []
    };
    writeJson(STORAGE_KEY, out);
    renderPanel();
    return out;
  }

  function normalizeRow(row, source, meta = {}) {
    const qty = n(row.qty, 0);
    const price = parsePrice(row.price);
    const type = row.type === "work" ? "work" : "material";
    const name = String(row.name || row.dbName || "Позиция").trim();

    return {
      id: uid(),
      createdAt: new Date().toISOString(),

      source: source || row.source || "manual",
      sourceVersion: meta.sourceVersion || row.sourceVersion || "",
      sourceBatchId: meta.batchId || "",

      type,
      category: row.category || row.group || "",
      subcategory: row.subcategory || row.subgroup || "",

      name,
      calcName: row.name || name,
      dbName: row.dbName || "",
      dbItemId: row.dbItemId || "",

      qty,
      unit: row.unit || "шт",
      price,
      total: calcLineTotal(price, qty),
      currency: row.currency || moneyApi()?.getSettings?.(row.raw?.dbSourceBase || activeBase())?.currency || undefined,
      currencySymbol: row.currencySymbol || moneyApi()?.getSettings?.(row.raw?.dbSourceBase || activeBase())?.currencySymbol || undefined,

      missingDb: !!row.missingDb,
      warning: Array.isArray(row.dbPickWarnings) ? row.dbPickWarnings.join("; ") : (row.warning || ""),
      note: row.note || "",

      customerVisible: type === "work",
      supplierVisible: type === "material",

      raw: {
        query: row.query || null,
        dbSourceKey: row.dbSourceKey || "",
        dbPickScore: row.dbPickScore || 0
      }
    };
  }

  function addRows(source, rows, meta = {}) {
    const draft = getDraft();
    const batchId = meta.batchId || ("batch_" + Date.now().toString(36));

    const normalized = (Array.isArray(rows) ? rows : [])
      .filter(row => row && n(row.qty, 0) > 0)
      .map(row => normalizeRow(row, source, { ...meta, batchId }));

    draft.rows.push(...normalized);
    saveDraft(draft);

    diag("estimate-core-add-rows", "Строки добавлены в единый черновик сметы.", {
      source,
      count: normalized.length,
      batchId
    });

    toast(`В черновик сметы добавлено: ${normalized.length}`);
    return normalized;
  }

  function replaceSource(source, rows, meta = {}) {
    const draft = getDraft();
    draft.rows = draft.rows.filter(row => row.source !== source);
    saveDraft(draft);
    return addRows(source, rows, meta);
  }

  function removeRow(id) {
    const draft = getDraft();
    draft.rows = draft.rows.filter(row => row.id !== id);
    saveDraft(draft);
  }

  function clearDraft() {
    if (!confirm("Очистить единый черновик сметы?")) return;
    saveDraft({ version: VERSION, rows: [] });
    toast("Черновик сметы очищен.");
  }

  function totals(rows = getDraft().rows) {
    const work = rows.filter(r => r.type === "work").reduce((s, r) => s + n(r.total), 0);
    const material = rows.filter(r => r.type === "material").reduce((s, r) => s + n(r.total), 0);
    const all = work + material;
    return { work, material, all };
  }

  function sourceTitle(source) {
    return {
      pool: "Пул розеток/штроб",
      shield: "Конфигуратор щита",
      manual: "Вручную"
    }[source] || source || "Источник";
  }

  function getPoolRows() {
    return readJson(POOL_DRAFT_KEY, []);
  }

  function poolVersion() {
    if (window.PoolV227StableMonolith?.version) return window.PoolV227StableMonolith.version;
    if (window.PoolV2262VersionGuard?.version) return window.PoolV2262VersionGuard.version;
    if (window.PoolV22CleanMonolith?.version) return window.PoolV22CleanMonolith.version;
    return "pool";
  }

  function addPoolToEstimate() {
    const poolRows = getPoolRows();

    if (!poolRows.length) {
      toast("В пуле нет рассчитанного черновика. Сначала нажми «Рассчитать черновую».");
      return;
    }

    const usableRows = poolRows.filter(row => n(row.qty, 0) > 0);

    if (!usableRows.length) {
      toast("Нет строк для добавления в черновик сметы.");
      return;
    }

    addRows("pool", usableRows, {
      sourceVersion: poolVersion(),
      batchId: "pool_" + Date.now().toString(36)
    });
  }

  function ensurePanel() {
    let panel = document.getElementById("ep-estimate-core-panel");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "ep-estimate-core-panel";
    panel.className = "estimate-core-panel hidden";
    document.body.appendChild(panel);
    return panel;
  }

  function openPanel() {
    const panel = ensurePanel();
    renderPanel();
    panel.classList.remove("hidden");
  }

  function closePanel() {
    const panel = ensurePanel();
    panel.classList.add("hidden");
  }

  function renderPanel() {
    const panel = document.getElementById("ep-estimate-core-panel");
    if (!panel) return;

    const draft = getDraft();
    const rows = draft.rows;
    const t = totals(rows);

    const bySource = rows.reduce((acc, row) => {
      const key = row.source || "manual";
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});

    const groupsHtml = Object.entries(bySource).map(([source, groupRows]) => {
      const gt = totals(groupRows);
      return `
        <section class="ecore-group">
          <div class="ecore-group-head">
            <div>
              <h4>${esc(sourceTitle(source))}</h4>
              <p>${groupRows.length} строк · ${esc(money(gt.all))}</p>
            </div>
          </div>
          <div class="ecore-rows">
            ${groupRows.map(row => `
              <div class="ecore-row ${row.missingDb ? "miss" : ""}">
                <div>
                  <b>${esc(row.dbName || row.name)}</b>
                  <p>${row.type === "work" ? "Работа" : "Материал"} · ${esc(row.qty)} ${esc(row.unit)} · ${esc(unitPriceText(row.price))} ${esc(row.currencySymbol || moneyApi()?.currencyLabel?.(row.raw?.dbSourceBase || activeBase()) || "₽")}</p>
                  ${row.warning ? `<small>${esc(row.warning)}</small>` : ""}
                </div>
                <div>
                  <strong>${esc(money(row.total))}</strong>
                  <button type="button" data-ecore-remove="${esc(row.id)}">×</button>
                </div>
              </div>
            `).join("")}
          </div>
        </section>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="ecore-backdrop" data-ecore-close></div>
      <div class="ecore-sheet">
        <div class="ecore-head">
          <div>
            <h3>Единый черновик сметы</h3>
            <p>Estimate Core · ${VERSION}</p>
          </div>
          <button type="button" data-ecore-close>×</button>
        </div>

        <div class="ecore-summary">
          <span>Работы: ${esc(money(t.work))}</span>
          <span>Материалы: ${esc(money(t.material))}</span>
          <span>Итого: ${esc(money(t.all))}</span>
          <span>Строк: ${rows.length}</span>
        </div>

        <div class="ecore-actions">
          <button type="button" data-ecore-add-pool>Добавить пул</button>
          <button type="button" data-ecore-clear>Очистить</button>
        </div>

        <div class="ecore-content">
          ${rows.length ? groupsHtml : `<div class="ecore-empty">Черновик пуст. Добавь результат из пула или другой функции.</div>`}
        </div>
      </div>
    `;
  }

  function addButtonToPool() {
    const screen = document.getElementById("ep-pool-v22-screen");
    if (!screen) return;

    const shell = screen.querySelector(".p22-shell");
    if (!shell) return;

    if (screen.querySelector("[data-ecore-add-pool-from-screen]")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "p22-add ecore-pool-add-btn";
    btn.setAttribute("data-ecore-add-pool-from-screen", "1");
    btn.textContent = "Добавить в единый черновик сметы";

    const draftCard = Array.from(screen.querySelectorAll(".p22-card")).find(card => {
      return /Черновик расчета|Черновик расчёта/i.test(card.textContent || "");
    });

    if (draftCard) draftCard.insertAdjacentElement("afterend", btn);
    else shell.appendChild(btn);
  }

  function addHomeMenuButton() {
    const menus = [
      document.querySelector("#side-menu"),
      document.querySelector("#drawer"),
      document.querySelector(".side-menu"),
      document.querySelector(".sidebar"),
      document.querySelector(".drawer"),
      document.querySelector(".burger-menu"),
      document.querySelector("[data-menu]")
    ].filter(Boolean);

    menus.forEach(menu => {
      if (menu.querySelector("[data-ecore-open]")) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-ecore-open", "1");
      btn.className = "ecore-menu-btn";
      btn.textContent = "🧾 Черновик сметы";

      const homeBtn = menu.querySelector("[data-v223-home]");
      if (homeBtn && homeBtn.parentElement) {
        homeBtn.parentElement.insertBefore(btn, homeBtn.nextSibling);
      } else {
        menu.insertBefore(btn, menu.firstChild);
      }
    });
  }

  function patchPoolOpen() {
    const pool = window.PoolV22CleanMonolith;
    if (!pool || pool.__estimateCorePatched) return;

    const oldOpen = pool.open?.bind(pool);
    if (typeof oldOpen === "function") {
      pool.open = function (...args) {
        const result = oldOpen(...args);
        [80, 300, 900].forEach(ms => setTimeout(addButtonToPool, ms));
        return result;
      };
      pool.__estimateCorePatched = true;
    }
  }

  function bindClicks() {
    if (window.__estimateCoreClicksBound) return;
    window.__estimateCoreClicksBound = true;

    document.addEventListener("click", event => {
      if (event.target.closest("[data-ecore-open]")) {
        event.preventDefault();
        event.stopPropagation();
        openPanel();
        return;
      }

      if (event.target.closest("[data-ecore-close]")) {
        event.preventDefault();
        closePanel();
        return;
      }

      if (event.target.closest("[data-ecore-clear]")) {
        event.preventDefault();
        clearDraft();
        return;
      }

      if (event.target.closest("[data-ecore-add-pool], [data-ecore-add-pool-from-screen], [data-p22-estimate]")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        addPoolToEstimate();
        return;
      }

      const remove = event.target.closest("[data-ecore-remove]");
      if (remove) {
        event.preventDefault();
        removeRow(remove.getAttribute("data-ecore-remove"));
      }
    }, true);
  }

  function boot() {
    ensurePanel();
    bindClicks();
    patchPoolOpen();
    addButtonToPool();
    addHomeMenuButton();

    try {
      window.ModuleVersionBadgesV212?.setVersion?.("estimate", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [500, 1500, 3000].forEach(ms => setTimeout(boot, ms));
  });

  window.EstimateCoreV231 = {
    version: VERSION,
    storageKey: STORAGE_KEY,
    getDraft,
    saveDraft,
    addRows,
    replaceSource,
    removeRow,
    clearDraft,
    totals,
    openPanel,
    closePanel,
    addPoolToEstimate,
    normalizeRow
  };

  diag("estimate-core-ready", "Estimate Core V23.1 ready.");
})();
