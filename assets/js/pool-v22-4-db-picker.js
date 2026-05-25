(function () {
  const VERSION = "V22.4";
  const FILE = "assets/js/pool-v22-4-db-picker.js";
  const DRAFT_KEY = "ep_pool_v22_draft";
  const RESULT_KEY = "ep_pool_v22_db_pick_result";

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV224DbPicker",
        functionName: "runtime",
        place: "pool-db-picker",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    try {
      if (window.PoolV21?.toast) return window.PoolV21.toast(text);
    } catch (e) {}

    let box = document.getElementById("ep-pool-v22-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-pool-v22-toast";
      document.body.appendChild(box);
    }

    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__p224Toast);
    window.__p224Toast = setTimeout(() => box.classList.remove("show"), 1600);
  }

  function money(v) {
    return Math.round(n(v, 0)).toLocaleString("ru-RU") + " ₽";
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
    return readJson(DRAFT_KEY, []);
  }

  function saveDraft(draft) {
    writeJson(DRAFT_KEY, draft);
  }

  function textOf(v) {
    return String(v ?? "").toLowerCase().replace(/ё/g, "е");
  }

  function normalizeName(v) {
    return textOf(v)
      .replace(/[×хx]/g, "x")
      .replace(/[^a-zа-я0-9x.,\s-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getTokens(v) {
    return normalizeName(v)
      .split(/\s+/)
      .filter(t => t.length >= 2);
  }

  function deepWalk(value, out, sourceKey, depth = 0) {
    if (depth > 6 || value == null) return;

    if (Array.isArray(value)) {
      value.forEach(x => deepWalk(x, out, sourceKey, depth + 1));
      return;
    }

    if (typeof value === "object") {
      const name =
        value.name ||
        value.title ||
        value.label ||
        value.workName ||
        value.materialName ||
        value.itemName ||
        value.fullName;

      const price =
        value.price ??
        value.cost ??
        value.amount ??
        value.sum ??
        value.value ??
        value.clientPrice ??
        value.sellPrice;

      if (name && Number.isFinite(Number(price))) {
        out.push({
          id: value.id || value.uid || value.key || `${sourceKey}_${out.length}`,
          name: String(name),
          price: Number(price),
          unit: value.unit || value.measure || value.uom || "шт",
          type: value.type || value.kind || value.categoryType || "",
          category: value.category || value.group || value.section || "",
          subcategory: value.subcategory || value.subgroup || "",
          sourceKey
        });
      }

      Object.values(value).forEach(x => deepWalk(x, out, sourceKey, depth + 1));
    }
  }

  function collectDbItems() {
    const out = [];

    const keyRx = /(db|database|base|база|materials|works|prices|server|global|my)/i;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !keyRx.test(key)) continue;

      const raw = localStorage.getItem(key);
      if (!raw || raw.length < 5) continue;

      try {
        const json = JSON.parse(raw);
        deepWalk(json, out, key);
      } catch (e) {}
    }

    const seen = new Set();
    return out.filter(item => {
      const sig = `${item.name}|${item.price}|${item.unit}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }

  function hasNumberInRange(text, min, max) {
    const nums = String(text).match(/\d+/g) || [];
    return nums.some(x => {
      const v = Number(x);
      return v >= min && v <= max;
    });
  }

  function scoreItem(row, item) {
    const rowName = normalizeName(row.name);
    const itemName = normalizeName(item.name + " " + item.category + " " + item.subcategory);
    const query = Array.isArray(row.query) ? row.query.join(" ") : row.name;
    const queryTokens = getTokens(query);

    let score = 0;

    queryTokens.forEach(t => {
      if (itemName.includes(t)) score += 6;
    });

    getTokens(row.name).forEach(t => {
      if (itemName.includes(t)) score += 4;
    });

    if (row.type === "work" && /работ|монтаж|штроб|сверл|высверл/i.test(item.type + " " + item.category + " " + item.name)) score += 10;
    if (row.type === "material" && /материал|материалы|расход|подроз|гмл|wago|ваго|сиз|короб/i.test(item.type + " " + item.category + " " + item.name)) score += 10;

    if (/гмл\s*4/i.test(row.name) && /гмл.*4|4.*гмл/i.test(itemName)) score += 40;
    if (/гмл\s*6/i.test(row.name) && /гмл.*6|6.*гмл/i.test(itemName)) score += 40;
    if (/гмл\s*8/i.test(row.name) && /гмл.*8|8.*гмл/i.test(itemName)) score += 40;

    if (/wago|ваго/i.test(row.name) && /wago|ваго/i.test(itemName)) score += 25;
    if (/сиз/i.test(row.name) && /сиз/i.test(itemName)) score += 25;

    if (/подрозетник/i.test(rowName) && /подрозетник|подразетник/i.test(itemName)) score += 25;

    if (/глубок/i.test(rowName)) {
      if (/глубок/i.test(itemName)) score += 20;
      if (hasNumberInRange(itemName, 60, 75)) score += 30;
    }

    if (/40-50|40.*50/i.test(rowName)) {
      if (hasNumberInRange(itemName, 40, 50)) score += 30;
    }

    if (/штроб/i.test(rowName) && /штроб/i.test(itemName)) score += 30;
    if (/20x30/i.test(rowName) && /20x30|20.*30/i.test(itemName)) score += 25;
    if (/30x30/i.test(rowName) && /30x30|30.*30/i.test(itemName)) score += 25;
    if (/50x40/i.test(rowName) && /50x40|50.*40/i.test(itemName)) score += 25;
    if (/20x25/i.test(rowName) && /20x25|20.*25/i.test(itemName)) score += 25;

    if (/бетон/i.test(rowName) && /бетон/i.test(itemName)) score += 12;
    if (/кирпич/i.test(rowName) && /кирпич/i.test(itemName)) score += 12;
    if (/панел/i.test(rowName) && /панел/i.test(itemName)) score += 12;

    if (/распайк|распаяч/i.test(rowName) && /распайк|распаяч|короб/i.test(itemName)) score += 35;
    if (/термоусад/i.test(rowName) && /термоусад/i.test(itemName)) score += 35;

    return score;
  }

  function findBest(row, dbItems) {
    const scored = dbItems
      .map(item => ({ item, score: scoreItem(row, item) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 5);
  }

  function pickDb() {
    const draft = getDraft();

    if (!draft.length) {
      toast("Сначала рассчитай черновую.");
      return;
    }

    const dbItems = collectDbItems();

    if (!dbItems.length) {
      toast("База не найдена в localStorage. Нужно подключить активную базу.");
      renderResult({
        dbCount: 0,
        picked: 0,
        missed: draft.length,
        rows: draft.map(row => ({ row, candidates: [] }))
      });
      return;
    }

    let picked = 0;
    const rows = [];

    const updated = draft.map(row => {
      const candidates = findBest(row, dbItems);
      const best = candidates[0];

      if (best && best.score >= 30) {
        picked += 1;

        rows.push({
          row,
          picked: best.item,
          score: best.score,
          candidates
        });

        return {
          ...row,
          price: best.item.price,
          unit: row.unit || best.item.unit || "шт",
          dbName: best.item.name,
          dbItemId: best.item.id,
          missingDb: false,
          dbSourceKey: best.item.sourceKey,
          dbPickScore: best.score
        };
      }

      rows.push({
        row,
        picked: null,
        score: best?.score || 0,
        candidates
      });

      return {
        ...row,
        missingDb: true,
        dbPickScore: best?.score || 0
      };
    });

    saveDraft(updated);

    const result = {
      dbCount: dbItems.length,
      picked,
      missed: updated.length - picked,
      rows
    };

    writeJson(RESULT_KEY, result);
    renderResult(result);

    if (window.PoolV22CleanMonolith?.open) {
      setTimeout(() => window.PoolV22CleanMonolith.open(), 100);
      setTimeout(() => renderResult(result), 250);
      setTimeout(() => renderResult(result), 700);
    }

    toast(`Подбор из БД: найдено ${picked} из ${updated.length}.`);
    diag("pool-v22-4-db-picked", "Подбор результата пула из базы выполнен.", {
      dbCount: dbItems.length,
      picked,
      total: updated.length
    });
  }

  function ensurePanel() {
    const screen = document.getElementById("ep-pool-v22-screen");
    if (!screen) return null;

    let panel = document.getElementById("p224-db-result");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "p224-db-result";
      panel.className = "p22-card p224-db-result";

      const draftCard = Array.from(screen.querySelectorAll(".p22-card")).find(card => {
        return /Черновик расчета|Черновик расчёта/i.test(card.textContent || "");
      });

      if (draftCard) draftCard.insertAdjacentElement("beforebegin", panel);
      else screen.querySelector(".p22-shell")?.appendChild(panel);
    }

    return panel;
  }

  function renderResult(result) {
    const panel = ensurePanel();
    if (!panel) return;

    if (!result) {
      result = readJson(RESULT_KEY, null);
    }

    if (!result) {
      panel.innerHTML = `
        <div class="p22-list-head">
          <h3>Подбор из БД</h3>
          <button type="button" data-p224-pick>Подобрать</button>
        </div>
        <div class="p22-empty">После расчёта нажми «Подобрать из БД».</div>
      `;
      return;
    }

    const rowsHtml = (result.rows || []).map(x => {
      const row = x.row || {};
      const picked = x.picked;

      if (picked) {
        return `
          <div class="p224-row ok">
            <div>
              <b>${esc(row.name)}</b>
              <p>Подобрано: ${esc(picked.name)}</p>
              <small>${esc(picked.sourceKey)} · score ${esc(x.score)}</small>
            </div>
            <strong>${money(picked.price)}</strong>
          </div>
        `;
      }

      const c = (x.candidates || [])[0];

      return `
        <div class="p224-row miss">
          <div>
            <b>${esc(row.name)}</b>
            <p>Не подобрано автоматически</p>
            <small>${c ? "Лучший кандидат: " + esc(c.item.name) + " · score " + esc(c.score) : "Кандидатов нет"}</small>
          </div>
          <strong>—</strong>
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="p22-list-head">
        <h3>Подбор из БД</h3>
        <button type="button" data-p224-pick>Повторить</button>
      </div>

      <div class="p224-summary">
        <span>База: ${esc(result.dbCount || 0)} поз.</span>
        <span>Найдено: ${esc(result.picked || 0)}</span>
        <span>Не найдено: ${esc(result.missed || 0)}</span>
        <span>${VERSION}</span>
      </div>

      <div class="p224-list">${rowsHtml || `<div class="p22-empty">Нет строк для подбора.</div>`}</div>
    `;
  }

  function patchPickButton() {
    document.addEventListener("click", event => {
      const root = event.target.closest("#ep-pool-v22-screen");
      if (!root) return;

      const btn = event.target.closest("[data-p22-pick-db], [data-p224-pick]");
      if (!btn) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      pickDb();
    }, true);
  }

  function syncVersion() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}

    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el => {
      el.textContent = VERSION;
    });
  }

  function boot() {
    syncVersion();

    const screen = document.getElementById("ep-pool-v22-screen");
    if (screen && !screen.classList.contains("hidden") && screen.style.display !== "none") {
      renderResult();
    }
  }

  window.addEventListener("DOMContentLoaded", function () {
    patchPickButton();

    boot();
    setTimeout(boot, 500);
    setTimeout(boot, 1500);
    setTimeout(boot, 3000);
  });

  window.PoolV224DbPicker = {
    version: VERSION,
    pickDb,
    collectDbItems,
    renderResult
  };
})();
