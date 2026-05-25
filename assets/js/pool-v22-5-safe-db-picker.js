(function () {
  const VERSION = "V22.5";
  const FILE = "assets/js/pool-v22-5-safe-db-picker.js";
  const DRAFT_KEY = "ep_pool_v22_draft";
  const RESULT_KEY = "ep_pool_v22_db_pick_result";

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV225SafeDbPicker",
        functionName: "runtime",
        place: "pool-db-picker",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    try { if (window.PoolV21?.toast) return window.PoolV21.toast(text); } catch (e) {}
    let box = document.getElementById("ep-pool-v22-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-pool-v22-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__p225Toast);
    window.__p225Toast = setTimeout(() => box.classList.remove("show"), 1800);
  }

  function money(v) {
    return Math.round(n(v, 0)).toLocaleString("ru-RU") + " ₽";
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function getDraft() { return readJson(DRAFT_KEY, []); }
  function saveDraft(draft) { writeJson(DRAFT_KEY, draft); }

  function normalizeName(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[×хx]/g, "x")
      .replace(/[^a-zа-я0-9x.,\s/-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getTokens(v) {
    return normalizeName(v).split(/\s+/).filter(t => t.length >= 2);
  }

  function itemHay(item) {
    return normalizeName([
      item.name,
      item.type,
      item.category,
      item.subcategory,
      item.sourceKey
    ].join(" "));
  }

  function deepWalk(value, out, sourceKey, depth = 0) {
    if (depth > 7 || value == null) return;

    if (Array.isArray(value)) {
      value.forEach(x => deepWalk(x, out, sourceKey, depth + 1));
      return;
    }

    if (typeof value === "object") {
      const name =
        value.name || value.title || value.label || value.workName ||
        value.materialName || value.itemName || value.fullName;

      const price =
        value.price ?? value.cost ?? value.amount ?? value.sum ??
        value.value ?? value.clientPrice ?? value.sellPrice;

      if (name && Number.isFinite(Number(price))) {
        const typeText = normalizeName(value.type || value.kind || value.categoryType || value.category || value.group || value.section || sourceKey);
        out.push({
          id: value.id || value.uid || value.key || `${sourceKey}_${out.length}`,
          name: String(name),
          price: Number(price),
          unit: value.unit || value.measure || value.uom || "шт",
          type: value.type || value.kind || value.categoryType || "",
          category: value.category || value.group || value.section || "",
          subcategory: value.subcategory || value.subgroup || "",
          sourceKey,
          inferredKind: inferItemKind(typeText + " " + normalizeName(name))
        });
      }

      Object.values(value).forEach(x => deepWalk(x, out, sourceKey, depth + 1));
    }
  }

  function inferItemKind(text) {
    text = normalizeName(text);
    if (/работ|монтаж|штроб|сверл|высверл|бурен|установк|демонтаж|ниша|резк/.test(text)) return "work";
    if (/материал|подроз|подраз|гмл|wago|ваго|сиз|термоусад|короб|кабель|гофр|провод|автомат|узо|диф|щит|распаечн|распаячн/.test(text)) return "material";
    return "";
  }

  function collectDbItems() {
    const out = [];
    const keyRx = /(db|database|base|база|materials|works|prices|server|global|my|active)/i;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !keyRx.test(key)) continue;

      const raw = localStorage.getItem(key);
      if (!raw || raw.length < 5) continue;

      try { deepWalk(JSON.parse(raw), out, key); } catch (e) {}
    }

    const seen = new Set();
    return out.filter(item => {
      const sig = `${item.name}|${item.price}|${item.unit}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }

  function rowKind(row) {
    if (row.type === "work") return "work";
    if (row.type === "material") return "material";

    const name = normalizeName(row.name);
    if (/штроб|сверл|высверл|монтаж|работ/.test(name)) return "work";
    return "material";
  }

  function isWorkItem(item) {
    const hay = itemHay(item);
    if (item.inferredKind === "work") return true;
    return /работ|монтаж|штроб|сверл|высверл|бурен|установк|демонтаж|ниша|резк/.test(hay);
  }

  function isMaterialItem(item) {
    const hay = itemHay(item);
    if (item.inferredKind === "material") return true;
    return /материал|подроз|подраз|гмл|wago|ваго|сиз|термоусад|короб|кабель|гофр|провод|автомат|узо|диф|щит|распаечн|распаячн/.test(hay);
  }

  function isCompatibleKind(row, item) {
    const kind = rowKind(row);
    const rowName = normalizeName(row.name);
    const hay = itemHay(item);

    if (kind === "work") {
      if (!isWorkItem(item)) return false;

      // Работа "высверливание" не должна брать материал "подрозетник".
      if (/высверл|сверл/.test(rowName) && /подроз|подраз/.test(hay) && !/высверл|сверл|бурен/.test(hay)) return false;

      // Штробление ищет только штробление.
      if (/штроб/.test(rowName) && !/штроб/.test(hay)) return false;

      // Монтаж распайки ищет монтаж/установку, а не саму коробку.
      if (/монтаж.*расп|монтаж.*короб/.test(rowName) && !/монтаж|установ/.test(hay)) return false;

      return true;
    }

    if (kind === "material") {
      if (!isMaterialItem(item)) return false;

      // Материал не должен брать работы.
      if (isWorkItem(item) && !/материал|подроз|гмл|wago|ваго|сиз|термоусад|короб/.test(hay)) return false;

      // Подрозетник не должен брать высверливание.
      if (/подроз|подраз/.test(rowName) && /высверл|сверл|бурен/.test(hay)) return false;

      // Распаечная коробка как материал не должна брать работу монтажа.
      if (/распайк|распаяч|короб/.test(rowName) && /монтаж|установ/.test(hay) && !/короб|распайк|распаяч/.test(hay)) return false;

      return true;
    }

    return true;
  }

  function extractSize(text) {
    text = normalizeName(text);
    const m = text.match(/(\d{2,3})\s*x\s*(\d{2,3})/);
    if (!m) return null;
    return `${Number(m[1])}x${Number(m[2])}`;
  }

  function sizeDistance(a, b) {
    if (!a || !b) return 0;
    const pa = a.split("x").map(Number);
    const pb = b.split("x").map(Number);
    return Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]);
  }

  function hasNumberInRange(text, min, max) {
    const nums = String(text).match(/\d+/g) || [];
    return nums.some(x => {
      const v = Number(x);
      return v >= min && v <= max;
    });
  }

  function getWarning(row, item) {
    const rowName = normalizeName(row.name);
    const hay = itemHay(item);
    const warnings = [];

    if (/штроб/.test(rowName)) {
      const need = extractSize(rowName);
      const got = extractSize(hay);
      if (need && got && need !== got) {
        warnings.push(`размер отличается: нужно ${need}, найдено ${got}`);
      }
    }

    if (/подрозетник.*глубок|глубок.*подрозетник/.test(rowName)) {
      if (!/глубок/.test(hay) && !hasNumberInRange(hay, 60, 75)) {
        warnings.push("проверь глубину подрозетника 60–75 мм");
      }
    }

    if (/подрозетник/.test(rowName) && /40-50|40.*50/.test(rowName)) {
      if (!hasNumberInRange(hay, 40, 50)) {
        warnings.push("проверь глубину подрозетника 40–50 мм");
      }
    }

    return warnings;
  }

  function scoreItem(row, item) {
    if (!isCompatibleKind(row, item)) return -9999;

    const rowName = normalizeName(row.name);
    const hay = itemHay(item);
    const query = Array.isArray(row.query) ? row.query.join(" ") : row.name;
    let score = 0;

    getTokens(query).forEach(t => { if (hay.includes(t)) score += 6; });
    getTokens(row.name).forEach(t => { if (hay.includes(t)) score += 4; });

    const kind = rowKind(row);
    if (kind === "work" && isWorkItem(item)) score += 30;
    if (kind === "material" && isMaterialItem(item)) score += 30;

    if (/гмл\s*4/i.test(row.name) && /гмл.*4|4.*гмл/i.test(hay)) score += 50;
    if (/гмл\s*6/i.test(row.name) && /гмл.*6|6.*гмл/i.test(hay)) score += 50;
    if (/гмл\s*8/i.test(row.name) && /гмл.*8|8.*гмл/i.test(hay)) score += 50;

    if (/wago|ваго/i.test(row.name) && /wago|ваго/i.test(hay)) score += 35;
    if (/сиз/i.test(row.name) && /сиз/i.test(hay)) score += 35;

    if (/подрозетник/i.test(rowName) && /подрозетник|подразетник/i.test(hay)) score += 35;

    if (/глубок/i.test(rowName)) {
      if (/глубок/i.test(hay)) score += 25;
      if (hasNumberInRange(hay, 60, 75)) score += 35;
    }

    if (/40-50|40.*50/i.test(rowName) && hasNumberInRange(hay, 40, 50)) score += 35;

    if (/штроб/i.test(rowName) && /штроб/i.test(hay)) score += 45;

    const rowSize = extractSize(rowName);
    const itemSize = extractSize(hay);
    if (rowSize && itemSize) {
      if (rowSize === itemSize) score += 45;
      else score -= Math.min(30, sizeDistance(rowSize, itemSize));
    }

    if (/бетон/i.test(rowName) && /бетон/i.test(hay)) score += 15;
    if (/кирпич/i.test(rowName) && /кирпич/i.test(hay)) score += 15;
    if (/панел/i.test(rowName) && /панел/i.test(hay)) score += 15;

    if (/распайк|распаяч/i.test(rowName) && /распайк|распаяч|короб/i.test(hay)) score += 40;
    if (/термоусад/i.test(rowName) && /термоусад/i.test(hay)) score += 40;

    if (/высверл|сверл/.test(rowName) && /высверл|сверл|бурен/.test(hay)) score += 50;
    if (/монтаж/.test(rowName) && /монтаж|установ/.test(hay)) score += 35;

    return score;
  }

  function findBest(row, dbItems) {
    return dbItems
      .map(item => ({ item, score: scoreItem(row, item), warnings: getWarning(row, item) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  function pickDb() {
    const draft = getDraft();

    if (!draft.length) {
      toast("Сначала рассчитай черновую.");
      return;
    }

    const dbItems = collectDbItems();

    if (!dbItems.length) {
      toast("База не найдена. Нужен адаптер активной базы.");
      renderResult({
        dbCount: 0,
        picked: 0,
        missed: draft.length,
        warningsCount: 0,
        rows: draft.map(row => ({ row, candidates: [] }))
      });
      return;
    }

    let picked = 0;
    let warningsCount = 0;
    const rows = [];

    const updated = draft.map(row => {
      const candidates = findBest(row, dbItems);
      const best = candidates[0];

      if (best && best.score >= 45) {
        picked += 1;
        warningsCount += best.warnings.length;

        rows.push({
          row,
          picked: best.item,
          score: best.score,
          warnings: best.warnings,
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
          dbPickScore: best.score,
          dbPickWarnings: best.warnings
        };
      }

      rows.push({
        row,
        picked: null,
        score: best?.score || 0,
        warnings: best?.warnings || [],
        candidates
      });

      return {
        ...row,
        missingDb: true,
        dbPickScore: best?.score || 0,
        dbPickWarnings: best?.warnings || []
      };
    });

    saveDraft(updated);

    const result = {
      dbCount: dbItems.length,
      picked,
      missed: updated.length - picked,
      warningsCount,
      rows
    };

    writeJson(RESULT_KEY, result);
    renderResult(result);

    if (window.PoolV22CleanMonolith?.open) {
      setTimeout(() => window.PoolV22CleanMonolith.open(), 100);
      setTimeout(() => renderResult(result), 250);
      setTimeout(() => renderResult(result), 700);
    }

    toast(`Безопасный подбор: найдено ${picked} из ${updated.length}.`);
    diag("pool-v22-5-safe-db-picked", "Безопасный подбор результата пула выполнен.", {
      dbCount: dbItems.length,
      picked,
      total: updated.length,
      warningsCount
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

    if (!result) result = readJson(RESULT_KEY, null);

    if (!result) {
      panel.innerHTML = `
        <div class="p22-list-head">
          <h3>Безопасный подбор из БД</h3>
          <button type="button" data-p225-pick>Подобрать</button>
        </div>
        <div class="p22-empty">После расчёта нажми «Подобрать из БД».</div>
      `;
      return;
    }

    const rowsHtml = (result.rows || []).map(x => {
      const row = x.row || {};
      const picked = x.picked;
      const warnings = x.warnings || [];

      if (picked) {
        return `
          <div class="p224-row ${warnings.length ? "warn" : "ok"}">
            <div>
              <b>${esc(row.name)}</b>
              <p>Подобрано: ${esc(picked.name)}</p>
              <small>${esc(picked.sourceKey)} · score ${esc(x.score)}</small>
              ${warnings.length ? `<em>${warnings.map(esc).join("<br>")}</em>` : ""}
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
            <p>Не подобрано безопасно</p>
            <small>${c ? "Лучший кандидат: " + esc(c.item.name) + " · score " + esc(c.score) : "Кандидатов нет"}</small>
          </div>
          <strong>—</strong>
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="p22-list-head">
        <h3>Безопасный подбор из БД</h3>
        <button type="button" data-p225-pick>Повторить</button>
      </div>
      <div class="p224-summary">
        <span>База: ${esc(result.dbCount || 0)} поз.</span>
        <span>Найдено: ${esc(result.picked || 0)}</span>
        <span>Не найдено: ${esc(result.missed || 0)}</span>
        <span>Предупр.: ${esc(result.warningsCount || 0)}</span>
        <span>${VERSION}</span>
      </div>
      <div class="p224-list">${rowsHtml || `<div class="p22-empty">Нет строк для подбора.</div>`}</div>
    `;
  }

  function patchPickButton() {
    document.addEventListener("click", event => {
      const root = event.target.closest("#ep-pool-v22-screen");
      if (!root) return;

      const btn = event.target.closest("[data-p22-pick-db], [data-p224-pick], [data-p225-pick]");
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
    if (screen && !screen.classList.contains("hidden") && screen.style.display !== "none") renderResult();
  }

  window.addEventListener("DOMContentLoaded", function () {
    patchPickButton();
    boot();
    setTimeout(boot, 500);
    setTimeout(boot, 1500);
    setTimeout(boot, 3000);
  });

  window.PoolV225SafeDbPicker = {
    version: VERSION,
    pickDb,
    collectDbItems,
    renderResult,
    scoreItem,
    isCompatibleKind
  };
})();
