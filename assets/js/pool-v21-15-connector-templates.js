(function () {
  const FILE = "assets/js/pool-v21-15-connector-templates.js";
  const VERSION = "V21.15";

  const CONNECTOR_TYPES = [
    ["wago2", "WAGO 2-пин", "material"],
    ["wago3", "WAGO 3-пин", "material"],
    ["wago4", "WAGO 4-пин", "material"],
    ["wago5", "WAGO 5-пин", "material"],
    ["wago6", "WAGO 6-пин", "material"],
    ["wago8", "WAGO 8-пин", "material"],
    ["wago10", "WAGO 10-пин", "material"],
    ["gml15", "ГМЛ 1.5", "material"],
    ["gml25", "ГМЛ 2.5", "material"],
    ["gml4", "ГМЛ 4", "material"],
    ["siz", "СИЗ", "material"]
  ];

  const TEMPLATE_LABELS = {
    switch_1: "Выкл. 1кл",
    switch_2: "Выкл. 2кл",
    switch_3: "Выкл. 3кл",
    pass_1: "Прох. 1кл",
    pass_2: "Прох. 2кл",
    pass_3: "Прох. 3кл",
    cross_1: "Перекр.",
    socket_3wires: "Роз. 3 пров.",
    socket_5wires: "Роз. 5 пров."
  };

  const DEFAULT_TEMPLATES = {
    switch_1: { wago2: 2, wago3: 1 },
    switch_2: { wago2: 3, wago3: 2 },
    switch_3: { wago2: 4, wago3: 3 },

    pass_1: { wago2: 6, wago3: 2 },
    pass_2: { wago2: 8, wago3: 4 },
    pass_3: { wago2: 10, wago3: 6 },

    cross_1: { wago2: 4, wago3: 2 },

    socket_3wires: { gml25: 4 },
    socket_5wires: { gml25: 8 }
  };

  let templates = {};
  let isOpen = false;

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

  function diag(level, code, message) {
    const payload = { file: FILE, module: "PoolV2115ConnectorTemplates", functionName: "runtime", place: "pool", code, message };
    if (level === "error") window.Diagnostics?.error?.(payload);
    else window.Diagnostics?.ok?.(payload);
  }

  function sound(type = "click") {
    try {
      if (type === "success" && window.SoundAPI?.success) return window.SoundAPI.success();
      if (type === "error" && window.SoundAPI?.error) return window.SoundAPI.error();
      if (window.SoundAPI?.click) return window.SoundAPI.click();
      if (window.SoundAPI?.tap) return window.SoundAPI.tap();
    } catch {}
  }

  function toast(text) {
    if (window.PoolV21?.toast) return window.PoolV21.toast(text);
    let box = document.getElementById("ep-pool-v21-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-pool-v21-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__p2115toast);
    window.__p2115toast = setTimeout(() => box.classList.remove("show"), 1500);
  }

  function normalizeTemplate(obj) {
    const out = {};
    CONNECTOR_TYPES.forEach(([key]) => out[key] = Math.max(0, n(obj?.[key], 0)));
    return out;
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem("ep_pool_v21_15_connector_templates") || "{}");
      templates = {};
      Object.keys(TEMPLATE_LABELS).forEach(key => {
        templates[key] = normalizeTemplate({ ...(DEFAULT_TEMPLATES[key] || {}), ...(raw[key] || {}) });
      });
    } catch {
      templates = {};
      Object.keys(TEMPLATE_LABELS).forEach(key => templates[key] = normalizeTemplate(DEFAULT_TEMPLATES[key] || {}));
    }

    try { isOpen = localStorage.getItem("ep_pool_v21_15_connector_open") === "1"; }
    catch { isOpen = false; }
  }

  function save() {
    try { localStorage.setItem("ep_pool_v21_15_connector_templates", JSON.stringify(templates)); } catch {}
    try { localStorage.setItem("ep_pool_v21_15_connector_open", isOpen ? "1" : "0"); } catch {}
  }

  function connectorLabel(key) {
    return (CONNECTOR_TYPES.find(x => x[0] === key) || [key, key])[1];
  }

  function askNumber(title, current) {
    const raw = prompt(title, String(current ?? 0));
    if (raw === null) return null;
    const value = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      toast("Введите число 0 или больше.");
      sound("error");
      return null;
    }
    return value;
  }

  function templateSummary(key) {
    const t = templates[key] || {};
    const parts = [];
    CONNECTOR_TYPES.forEach(([cKey, label]) => {
      const qty = n(t[cKey], 0);
      if (qty > 0) parts.push(`${label}: ${qty}`);
    });
    return parts.length ? parts.join(" · ") : "без соединителей";
  }

  function connectorEditorHtml() {
    const rows = Object.keys(TEMPLATE_LABELS).map(templateKey => {
      const chips = CONNECTOR_TYPES.map(([connKey, label]) => {
        const qty = n(templates[templateKey]?.[connKey], 0);
        return `
          <button type="button" class="p2115-conn-chip ${qty > 0 ? "has-value" : ""}" data-p2115-template="${templateKey}" data-p2115-conn="${connKey}">
            <span>${esc(label)}</span>
            <b>${qty}</b>
          </button>
        `;
      }).join("");

      return `
        <div class="p2115-template-row">
          <div class="p2115-template-title">
            <b>${esc(TEMPLATE_LABELS[templateKey])}</b>
            <small>${esc(templateSummary(templateKey))}</small>
          </div>
          <div class="p2115-chip-grid">${chips}</div>
        </div>
      `;
    }).join("");

    return `
      <section class="p2115-card">
        <button type="button" class="p2115-toggle" data-p2115-toggle>
          ${isOpen ? "Скрыть соединители" : "Шаблоны соединителей"}
        </button>

        <div class="p2115-body ${isOpen ? "" : "hidden"}">
          <div class="p2115-top-actions">
            <button type="button" data-p2115-reset>Сбросить шаблоны</button>
          </div>
          ${rows}
          <p class="p2115-note">Количество указывается на одну точку/распайку. В черновике WAGO/ГМЛ/СИЗ суммируются по добавленным рамкам.</p>
        </div>
      </section>
    `;
  }

  function injectEditor() {
    const shell = document.querySelector("#ep-pool-v21-screen .p2114-shell");
    if (!shell) return;

    let old = shell.querySelector(".p2115-card");
    if (old) old.remove();

    const logicCard = shell.querySelector(".p2114-logic-card");
    if (logicCard) logicCard.insertAdjacentHTML("afterend", connectorEditorHtml());
    else shell.insertAdjacentHTML("afterbegin", connectorEditorHtml());

    setVersionBadges();
  }

  function setVersionBadges() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;
    const badge = screen.querySelector(".p2114-head b, .p2113-head b, .p21-7-head b");
    if (badge) badge.textContent = VERSION;
  }

  function updateMainBadges() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch {}
  }

  function getGroups() {
    return window.PoolV21?.groups || [];
  }

  function addMap(map, key, qty) {
    qty = Math.max(0, n(qty, 0));
    if (!qty) return;
    map[key] = (map[key] || 0) + qty;
  }

  function applyTemplate(result, templateKey, multiplier) {
    const tpl = templates[templateKey] || {};
    CONNECTOR_TYPES.forEach(([connKey]) => {
      addMap(result.connectors, connKey, n(tpl[connKey], 0) * multiplier);
    });
  }

  function calculateConnectorsFromGroups() {
    const result = {
      connectors: {},
      shrinkM: 0
    };

    getGroups().forEach(g => {
      const qty = Math.max(1, n(g.qty, 1));
      const switches = n(g.switches, 0);
      const pass = n(g.pass, 0);
      const cross = n(g.cross, 0);
      const sockets = n(g.sockets, 0);

      const switchKeys = Math.max(1, Math.min(3, n(g.meta?.switchKeys, 1)));
      const passKeys = Math.max(1, Math.min(3, n(g.meta?.passKeys, 1)));

      if (switches > 0) applyTemplate(result, `switch_${switchKeys}`, switches * qty);
      if (pass > 0) applyTemplate(result, `pass_${passKeys}`, pass * qty);
      if (cross > 0) applyTemplate(result, "cross_1", cross * qty);

      if (sockets > 0) {
        const wiresTemplate = sockets >= 4 ? "socket_5wires" : "socket_3wires";
        applyTemplate(result, wiresTemplate, qty);
      }
    });

    // Термоусадка нужна на ГМЛ и СИЗ.
    const gmlAndSiz =
      n(result.connectors.gml15, 0) +
      n(result.connectors.gml25, 0) +
      n(result.connectors.gml4, 0) +
      n(result.connectors.siz, 0);

    const logic = window.PoolV2114PromptEditFields?.logic?.() || {};
    const cm = n(logic.heatShrinkCmPerJoint, 5);
    result.shrinkM = Math.round((gmlAndSiz * cm / 100) * 100) / 100;
    result.heatShrinkType = logic.heatShrinkType || "12/4";

    return result;
  }

  function makeRaw(type, name, qty, unit, query) {
    return {
      id: "p2115_" + Math.random().toString(16).slice(2),
      type,
      name,
      qty,
      unit,
      price: 0,
      dbName: "",
      dbItemId: "",
      missingDb: false,
      query: Array.isArray(query) ? query : [name]
    };
  }

  function appendConnectorsToDraft() {
    if (!window.PoolV21) return;

    // Сначала собираем основной черновик V21.14.
    const oldBuild = window.PoolV2115ConnectorTemplates?.oldBuildDraft;
    if (oldBuild) oldBuild();
    else window.PoolV21.buildDraft?.();

    const draft = Array.isArray(window.PoolV21.draft) ? window.PoolV21.draft : [];
    const calculated = calculateConnectorsFromGroups();

    Object.entries(calculated.connectors).forEach(([key, qty]) => {
      qty = Math.max(0, n(qty, 0));
      if (!qty) return;
      const label = connectorLabel(key);
      draft.push(makeRaw("material", label, qty, "шт", [label, key]));
    });

    if (calculated.shrinkM > 0) {
      draft.push(makeRaw("material", `Термоусадка ${calculated.heatShrinkType}`, calculated.shrinkM, "м", ["термоусадка", calculated.heatShrinkType]));
    }

    window.PoolV21.draft = draft;
    window.PoolV21.save?.();
    window.PoolV21.renderDraft?.();
    toast("Черновик собран с соединителями.");
    sound("success");
  }

  function patchPool() {
    if (!window.PoolV21 || window.PoolV21.__v2115ConnectorPatched) return false;

    const oldOpen = window.PoolV21.open?.bind(window.PoolV21);
    const oldBuildDraft = window.PoolV21.buildDraft?.bind(window.PoolV21);

    window.PoolV21.open = function (...args) {
      const result = oldOpen ? oldOpen(...args) : undefined;
      setTimeout(() => { injectEditor(); setVersionBadges(); }, 80);
      setTimeout(() => { injectEditor(); setVersionBadges(); }, 500);
      return result;
    };

    window.PoolV21.buildDraft = appendConnectorsToDraft;
    window.PoolV2115ConnectorTemplates = window.PoolV2115ConnectorTemplates || {};
    window.PoolV2115ConnectorTemplates.oldBuildDraft = oldBuildDraft;

    window.PoolV21.__v2115ConnectorPatched = true;
    return true;
  }

  function bind() {
    document.addEventListener("click", event => {
      const root = event.target.closest("#ep-pool-v21-screen");
      if (!root) return;

      const toggle = event.target.closest("[data-p2115-toggle]");
      if (toggle) {
        event.preventDefault();
        event.stopImmediatePropagation();
        isOpen = !isOpen;
        save();
        injectEditor();
        sound();
        return;
      }

      const reset = event.target.closest("[data-p2115-reset]");
      if (reset) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!confirm("Сбросить шаблоны соединителей к базовым?")) return;
        templates = {};
        Object.keys(TEMPLATE_LABELS).forEach(key => templates[key] = normalizeTemplate(DEFAULT_TEMPLATES[key] || {}));
        save();
        injectEditor();
        sound("success");
        return;
      }

      const chip = event.target.closest("[data-p2115-template][data-p2115-conn]");
      if (chip) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const tpl = chip.getAttribute("data-p2115-template");
        const conn = chip.getAttribute("data-p2115-conn");
        const label = `${TEMPLATE_LABELS[tpl]} · ${connectorLabel(conn)}`;
        const current = n(templates[tpl]?.[conn], 0);
        const next = askNumber(label, current);
        if (next === null) return;

        templates[tpl] ||= normalizeTemplate({});
        templates[tpl][conn] = next;
        save();
        injectEditor();
        sound("success");
        return;
      }
    }, true);
  }

  function askNumber(title, current) {
    const raw = prompt(title, String(current ?? 0));
    if (raw === null) return null;
    const value = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      toast("Введите число 0 или больше.");
      sound("error");
      return null;
    }
    return value;
  }

  function init() {
    load();
    bind();

    const boot = () => {
      patchPool();
      injectEditor();
      updateMainBadges();
      setVersionBadges();
    };

    boot();
    setTimeout(boot, 700);
    setTimeout(boot, 1800);
    setTimeout(boot, 3500);

    window.PoolV2115ConnectorTemplates = Object.assign(window.PoolV2115ConnectorTemplates || {}, {
      templates: () => JSON.parse(JSON.stringify(templates)),
      calculateConnectorsFromGroups,
      appendConnectorsToDraft
    });

    diag("ok", "pool-v21-15-ready", "Pool V21.15 connector templates ready.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
