(function () {
  const VERSION = "V22.6";
  const FILE = "assets/js/pool-v22-6-manual-db-candidate-picker.js";
  const DRAFT_KEY = "ep_pool_v22_draft";
  const RESULT_KEY = "ep_pool_v22_db_pick_result";
  const MANUAL_KEY = "ep_pool_v22_manual_db_choices";

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV226ManualDbCandidatePicker",
        functionName: "runtime",
        place: "pool-db-picker",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    let box = document.getElementById("ep-pool-v22-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-pool-v22-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__p226Toast);
    window.__p226Toast = setTimeout(() => box.classList.remove("show"), 1700);
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function money(v) {
    return Math.round(n(v, 0)).toLocaleString("ru-RU") + " ₽";
  }

  function normalize(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[×хx]/g, "x")
      .replace(/[^a-zа-я0-9x.,\s/-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getDraft() {
    return readJson(DRAFT_KEY, []);
  }

  function saveDraft(draft) {
    writeJson(DRAFT_KEY, draft);
  }

  function getResult() {
    return readJson(RESULT_KEY, null);
  }

  function saveResult(result) {
    writeJson(RESULT_KEY, result);
  }

  function getManualChoices() {
    return readJson(MANUAL_KEY, {});
  }

  function saveManualChoices(value) {
    writeJson(MANUAL_KEY, value);
  }

  function rowKey(row) {
    return normalize([row?.type, row?.name, row?.unit, row?.query].join("|"));
  }

  function applyManualChoice(row, item) {
    const draft = getDraft();
    const key = rowKey(row);

    const updated = draft.map(d => {
      if (rowKey(d) !== key) return d;

      return {
        ...d,
        price: n(item.price, 0),
        unit: d.unit || item.unit || "шт",
        dbName: item.name,
        dbItemId: item.id,
        dbSourceKey: "manual_db_choice_v22_6",
        missingDb: false,
        dbPickScore: item.score || 999,
        dbPickWarnings: ["выбрано вручную"]
      };
    });

    saveDraft(updated);

    const choices = getManualChoices();
    choices[key] = {
      item,
      rowName: row.name,
      updatedAt: new Date().toISOString()
    };
    saveManualChoices(choices);

    const result = getResult();
    if (result && Array.isArray(result.rows)) {
      result.rows = result.rows.map(r => {
        if (rowKey(r.row) !== key) return r;
        return {
          ...r,
          picked: item,
          score: item.score || 999,
          warnings: ["выбрано вручную"],
          manual: true
        };
      });
      result.picked = result.rows.filter(r => r.picked).length;
      result.missed = result.rows.length - result.picked;
      result.warningsCount = result.rows.reduce((s, r) => s + ((r.warnings || []).length ? 1 : 0), 0);
      saveResult(result);
    }

    closeModal();

    if (window.PoolV22CleanMonolith?.open) {
      window.PoolV22CleanMonolith.open();
      setTimeout(() => window.PoolV225SafeDbPicker?.renderResult?.(getResult()), 160);
      setTimeout(markVersion, 260);
      setTimeout(markVersion, 800);
    }

    toast("Позиция выбрана вручную.");
    diag("pool-v22-6-manual-choice-applied", "Позиция БД выбрана вручную.", {
      row: row.name,
      item: item.name,
      price: item.price
    });
  }

  function removeManualChoice(row) {
    const key = rowKey(row);
    const choices = getManualChoices();
    delete choices[key];
    saveManualChoices(choices);
    toast("Ручной выбор сброшен. Нажми «Повторить» для автоподбора.");
    closeModal();
  }

  function ensureModal() {
    let modal = document.getElementById("p226-candidate-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "p226-candidate-modal";
    modal.className = "p226-modal hidden";
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    const modal = document.getElementById("p226-candidate-modal");
    if (modal) modal.classList.add("hidden");
  }

  function openCandidates(rowIndex) {
    const result = getResult();
    if (!result || !Array.isArray(result.rows)) {
      toast("Сначала сделай подбор из БД.");
      return;
    }

    const entry = result.rows[rowIndex];
    if (!entry) {
      toast("Строка подбора не найдена.");
      return;
    }

    const row = entry.row || {};
    const candidates = entry.candidates || [];
    const picked = entry.picked;

    const modal = ensureModal();

    const candidateRows = candidates.length ? candidates.map((c, idx) => {
      const item = {
        ...(c.item || c.picked || {}),
        score: c.score || 0,
        warnings: c.warnings || []
      };

      return `
        <button type="button" class="p226-candidate ${picked && picked.name === item.name ? "active" : ""}" data-p226-select="${idx}">
          <div>
            <b>${esc(item.name)}</b>
            <p>${esc(item.category || "")}${item.subcategory ? " · " + esc(item.subcategory) : ""}</p>
            <small>${esc(item.sourceKey || "БД")} · score ${esc(item.score || c.score || 0)}${(item.warnings || c.warnings || []).length ? " · есть предупреждение" : ""}</small>
          </div>
          <strong>${money(item.price)}</strong>
        </button>
      `;
    }).join("") : `<div class="p226-empty">Кандидатов нет. Можно добавить позицию в базу или улучшить название.</div>`;

    modal.innerHTML = `
      <div class="p226-backdrop" data-p226-close></div>
      <div class="p226-sheet">
        <div class="p226-head">
          <div>
            <h3>Выбор позиции из БД</h3>
            <p>${esc(row.name || "")}</p>
          </div>
          <button type="button" data-p226-close>×</button>
        </div>

        <div class="p226-current">
          <span>Сейчас:</span>
          <b>${picked ? esc(picked.name) : "не выбрано"}</b>
        </div>

        <div class="p226-list">
          ${candidateRows}
        </div>

        <div class="p226-actions">
          <button type="button" data-p226-reset>Сбросить ручной выбор</button>
          <button type="button" data-p226-close>Закрыть</button>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");

    modal.querySelectorAll("[data-p226-select]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = n(btn.getAttribute("data-p226-select"), -1);
        const candidate = candidates[idx];
        if (!candidate) return;
        const item = {
          ...(candidate.item || {}),
          score: candidate.score || 0,
          warnings: candidate.warnings || []
        };
        applyManualChoice(row, item);
      }, true);
    });

    modal.querySelectorAll("[data-p226-close]").forEach(btn => {
      btn.addEventListener("click", closeModal, true);
    });

    const reset = modal.querySelector("[data-p226-reset]");
    if (reset) reset.addEventListener("click", () => removeManualChoice(row), true);
  }

  function decorateRows() {
    const panel = document.getElementById("p224-db-result");
    const result = getResult();
    if (!panel || !result || !Array.isArray(result.rows)) return;

    const rows = Array.from(panel.querySelectorAll(".p224-row"));
    rows.forEach((el, index) => {
      if (el.dataset.p226Ready === "1") return;
      el.dataset.p226Ready = "1";
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");

      const hint = document.createElement("div");
      hint.className = "p226-row-hint";
      hint.textContent = "Нажми, чтобы выбрать другую позицию";
      el.appendChild(hint);

      el.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openCandidates(index);
      }, true);
    });
  }

  function applyManualBadges() {
    const result = getResult();
    const panel = document.getElementById("p224-db-result");
    if (!result || !panel) return;

    const choices = getManualChoices();
    const rows = Array.from(panel.querySelectorAll(".p224-row"));

    rows.forEach((el, index) => {
      const row = result.rows?.[index]?.row;
      if (!row) return;
      if (choices[rowKey(row)]) {
        el.classList.add("manual");
        if (!el.querySelector(".p226-manual-badge")) {
          const badge = document.createElement("div");
          badge.className = "p226-manual-badge";
          badge.textContent = "Выбрано вручную";
          el.appendChild(badge);
        }
      }
    });
  }

  function markVersion() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}

    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el => {
      el.textContent = VERSION;
    });

    const panel = document.getElementById("p224-db-result");
    if (panel) {
      panel.querySelectorAll(".p224-summary span").forEach(el => {
        if ((el.textContent || "").startsWith("V22.")) el.textContent = VERSION;
      });
    }
  }

  function boot() {
    markVersion();
    decorateRows();
    applyManualBadges();
  }

  function bindAfterPick() {
    document.addEventListener("click", event => {
      if (!event.target.closest("#ep-pool-v22-screen")) return;
      if (!event.target.closest("[data-p22-pick-db], [data-p224-pick], [data-p225-pick]")) return;
      setTimeout(boot, 300);
      setTimeout(boot, 900);
    }, true);
  }

  window.addEventListener("DOMContentLoaded", function () {
    bindAfterPick();
    boot();
    setTimeout(boot, 600);
    setTimeout(boot, 1600);
    setTimeout(boot, 3200);
  });

  window.PoolV226ManualDbCandidatePicker = {
    version: VERSION,
    openCandidates,
    applyManualChoice,
    removeManualChoice,
    decorateRows
  };
})();
