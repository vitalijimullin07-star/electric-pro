(function () {
  const FILE = "assets/js/pool-v21-18-visible-connector-lines.js";
  const VERSION = "V21.18";

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const ceil = v => Math.ceil(Math.max(0, n(v, 0)));
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

  const DEFAULT_SETTINGS = {
    connectorMode: "gml",
    dropsPerSocketJunction: 2,
    dropsPerSwitchJunction: 2,
    shrinkCmPerJoint: 5,
    heatShrinkType: "12/4"
  };

  const DEFAULT_TEMPLATES = {
    switch_1: { pin2: 4 },
    switch_2: { pin2: 3, pin4: 2 },
    switch_3: { pin2: 4, pin4: 2 },
    pass_1: { pin2: 6 },
    pass_2: { pin2: 8, pin4: 1 },
    cross_1: { pin2: 9 },
    cross_2: { pin2: 15, pin3: 1 }
  };

  function diag(level, code, message) {
    const payload = { file: FILE, module: "PoolV2118VisibleConnectorLines", functionName: "runtime", place: "pool", code, message };
    if (level === "error") window.Diagnostics?.error?.(payload);
    else window.Diagnostics?.ok?.(payload);
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
    clearTimeout(window.__p2118toast);
    window.__p2118toast = setTimeout(() => box.classList.remove("show"), 1800);
  }

  function sound() {
    try {
      if (window.SoundAPI?.success) return window.SoundAPI.success();
      if (window.SoundAPI?.click) return window.SoundAPI.click();
      if (window.SoundAPI?.tap) return window.SoundAPI.tap();
    } catch {}
  }

  function getLogic() {
    return window.PoolV2114PromptEditFields?.logic?.() || {
      connectionMode: "junction_boxes",
      heatShrinkType: "12/4",
      heatShrinkCmPerJoint: 5
    };
  }

  function getSettings() {
    try {
      const s16 = JSON.parse(localStorage.getItem("ep_pool_v21_16_settings") || "{}");
      return { ...DEFAULT_SETTINGS, ...s16 };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function getTemplates() {
    try {
      const raw = JSON.parse(localStorage.getItem("ep_pool_v21_16_templates") || "{}");
      return { ...DEFAULT_TEMPLATES, ...raw };
    } catch {
      return { ...DEFAULT_TEMPLATES };
    }
  }

  function addMap(map, key, qty) {
    qty = Math.max(0, n(qty, 0));
    if (!qty) return;
    map[key] = (map[key] || 0) + qty;
  }

  function applyTemplate(pinMap, templates, templateKey, multiplier) {
    const tpl = templates[templateKey] || {};
    Object.entries(tpl).forEach(([pin, qty]) => {
      if (!/^pin\d+$/.test(pin)) return;
      addMap(pinMap, pin, n(qty, 0) * multiplier);
    });
  }

  function pinToWireCount(pin) {
    return Number(String(pin).replace("pin", ""));
  }

  function sleeveByWires(wires) {
    wires = n(wires, 0);
    if (wires <= 0) return null;
    if (wires <= 4) return "gml4";
    if (wires <= 6) return "gml6";
    if (wires <= 8) return "gml8";
    return "gml10";
  }

  function sizByWires(wires) {
    wires = n(wires, 0);
    if (wires <= 0) return null;
    return `siz${wires}`;
  }

  function materialName(key) {
    const names = {
      pin2: "WAGO 2-пин",
      pin3: "WAGO 3-пин",
      pin4: "WAGO 4-пин",
      pin5: "WAGO 5-пин",
      pin6: "WAGO 6-пин",
      pin8: "WAGO 8-пин",
      pin10: "WAGO 10-пин",
      gml4: "ГМЛ 4",
      gml6: "ГМЛ 6",
      gml8: "ГМЛ 8",
      gml10: "ГМЛ 10",
      siz2: "СИЗ на 2 провода",
      siz3: "СИЗ на 3 провода",
      siz4: "СИЗ на 4 провода",
      siz5: "СИЗ на 5 проводов",
      siz6: "СИЗ на 6 проводов",
      siz8: "СИЗ на 8 проводов",
      siz10: "СИЗ на 10 проводов"
    };
    return names[key] || key;
  }

  function makeRaw(type, name, qty, unit, query) {
    return {
      id: "p2118_" + Math.random().toString(16).slice(2),
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

  function addSocketInBoxes(pinMap, group) {
    const sockets = n(group.sockets, 0);
    const qty = Math.max(1, n(group.qty, 1));
    if (sockets <= 0) return;

    // вход + выход + розетки, затем ×3 жилы L/N/PE.
    const wires = 2 + sockets;
    addMap(pinMap, `pin${wires}`, 3 * qty);
  }

  function addJunctionByDrops(pinMap, totalDrops, dropsPerBox) {
    totalDrops = Math.max(0, n(totalDrops, 0));
    dropsPerBox = Math.max(1, n(dropsPerBox, 2));
    const boxes = ceil(totalDrops / dropsPerBox);
    let left = totalDrops;

    for (let i = 0; i < boxes; i++) {
      const dropsHere = Math.min(dropsPerBox, left);
      left -= dropsHere;
      if (dropsHere <= 0) continue;

      // вход + выход + спуски, затем ×3 жилы L/N/PE.
      const wires = 2 + dropsHere;
      addMap(pinMap, `pin${wires}`, 3);
    }

    return boxes;
  }

  function convertPins(pinMap, settings) {
    const materials = {};
    let shrinkCount = 0;

    Object.entries(pinMap).forEach(([pin, qty]) => {
      qty = n(qty, 0);
      if (!qty) return;
      const wires = pinToWireCount(pin);

      if (settings.connectorMode === "wago") {
        addMap(materials, pin, qty);
      } else if (settings.connectorMode === "siz") {
        const siz = sizByWires(wires);
        if (siz) {
          addMap(materials, siz, qty);
          shrinkCount += qty;
        }
      } else {
        const sleeve = sleeveByWires(wires);
        if (sleeve) {
          addMap(materials, sleeve, qty);
          shrinkCount += qty;
        }
      }
    });

    return { materials, shrinkCount };
  }

  function calculateVisibleConnectors() {
    const logic = getLogic();
    const settings = getSettings();
    const templates = getTemplates();
    const groups = window.PoolV21?.groups || [];
    const pinMap = {};

    let socketDrops = 0;
    let switchDrops = 0;

    groups.forEach(group => {
      const qty = Math.max(1, n(group.qty, 1));
      const sockets = n(group.sockets, 0);
      const switches = n(group.switches, 0);
      const pass = n(group.pass, 0);
      const cross = n(group.cross, 0);

      const switchKeys = Math.max(1, Math.min(3, n(group.meta?.switchKeys, 1)));
      const passKeys = Math.max(1, Math.min(3, n(group.meta?.passKeys, 1)));

      if (switches > 0) applyTemplate(pinMap, templates, `switch_${switchKeys}`, switches * qty);
      if (pass > 0) applyTemplate(pinMap, templates, passKeys >= 2 ? "pass_2" : "pass_1", pass * qty);
      if (cross > 0) applyTemplate(pinMap, templates, passKeys >= 2 ? "cross_2" : "cross_1", cross * qty);

      if (sockets > 0) {
        if (logic.connectionMode === "in_boxes") addSocketInBoxes(pinMap, group);
        else socketDrops += qty;
      }

      if ((switches + pass + cross) > 0 && logic.connectionMode === "junction_boxes") {
        switchDrops += qty;
      }
    });

    let socketJunctions = 0;
    let switchJunctions = 0;

    if (logic.connectionMode === "junction_boxes") {
      socketJunctions = addJunctionByDrops(pinMap, socketDrops, settings.dropsPerSocketJunction);
      switchJunctions = addJunctionByDrops(pinMap, switchDrops, settings.dropsPerSwitchJunction);
    }

    const converted = convertPins(pinMap, settings);
    const shrinkM = Math.round((converted.shrinkCount * n(settings.shrinkCmPerJoint, 5) / 100) * 100) / 100;

    return {
      settings,
      logic,
      pinMap,
      materials: converted.materials,
      shrinkCount: converted.shrinkCount,
      shrinkM,
      socketDrops,
      switchDrops,
      socketJunctions,
      switchJunctions
    };
  }

  function ensureVisiblePanel() {
    const shell = document.querySelector("#ep-pool-v21-screen .p2114-shell");
    if (!shell) return null;

    let panel = document.getElementById("p2118-visible-connectors");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "p2118-visible-connectors";
      panel.className = "p2118-panel";

      const draftCard = Array.from(shell.querySelectorAll(".p2114-card")).find(card => {
        return /Черновик расч/i.test(card.textContent || "");
      });

      if (draftCard) draftCard.insertAdjacentElement("beforebegin", panel);
      else shell.appendChild(panel);
    }

    return panel;
  }

  function renderVisiblePanel(result) {
    const panel = ensureVisiblePanel();
    if (!panel) return;

    const materialEntries = Object.entries(result.materials).filter(([, qty]) => n(qty, 0) > 0);
    const pinEntries = Object.entries(result.pinMap).filter(([, qty]) => n(qty, 0) > 0);

    const materialRows = materialEntries.length
      ? materialEntries.map(([key, qty]) => `
          <div class="p2118-row">
            <b>${esc(materialName(key))}</b>
            <strong>${n(qty, 0)} шт</strong>
          </div>
        `).join("")
      : `<div class="p2118-empty">Соединители не рассчитались. Проверь, есть ли механизмы в пуле.</div>`;

    const pinRows = pinEntries.length
      ? pinEntries.map(([pin, qty]) => `
          <span>${esc(pin.replace("pin", ""))} пров. × ${n(qty, 0)}</span>
        `).join("")
      : `<span>нет соединений</span>`;

    const shrink = result.shrinkM > 0
      ? `<div class="p2118-row"><b>Термоусадка ${esc(result.settings.heatShrinkType || "12/4")}</b><strong>${result.shrinkM} м</strong></div>`
      : "";

    const junctions = result.logic.connectionMode === "junction_boxes"
      ? `
        <div class="p2118-row muted"><b>Распайки розеток</b><strong>${result.socketJunctions} шт</strong></div>
        <div class="p2118-row muted"><b>Распайки выключателей</b><strong>${result.switchJunctions} шт</strong></div>
        <div class="p2118-small">Розеточные спуски: ${result.socketDrops} / ${result.settings.dropsPerSocketJunction}. Выключательные спуски: ${result.switchDrops} / ${result.settings.dropsPerSwitchJunction}.</div>
      `
      : `<div class="p2118-small">Соединение в подрозетниках: розетки считаются как вход + выход + розетки, затем ×3 жилы L/N/PE.</div>`;

    panel.innerHTML = `
      <div class="p2118-head">
        <h3>Соединители и распайки</h3>
        <button type="button" data-p2118-recalc>Пересчитать</button>
      </div>
      <div class="p2118-badge">Режим: ${modeName(result.settings.connectorMode)} · V21.18</div>
      <div class="p2118-pins">${pinRows}</div>
      <div class="p2118-list">${materialRows}${shrink}${junctions}</div>
    `;
  }

  function modeName(mode) {
    if (mode === "wago") return "WAGO";
    if (mode === "siz") return "СИЗ";
    return "ГМЛ";
  }

  function cleanOldConnectorRows(draft) {
    return (draft || []).filter(item => {
      const name = String(item.name || "");
      if (/^WAGO\s/i.test(name)) return false;
      if (/^ГМЛ\s/i.test(name)) return false;
      if (/^СИЗ\s/i.test(name)) return false;
      if (/^Термоусадка\s/i.test(name)) return false;
      if (/^Распайки розеток:/i.test(name)) return false;
      if (/^Распайки выключателей:/i.test(name)) return false;
      return true;
    });
  }

  function appendRowsToDraft(result) {
    if (!window.PoolV21) return;

    let draft = cleanOldConnectorRows(window.PoolV21.draft || []);

    Object.entries(result.materials).forEach(([key, qty]) => {
      qty = n(qty, 0);
      if (!qty) return;
      const name = materialName(key);
      draft.push(makeRaw("material", name, qty, "шт", [name, key]));
    });

    if (result.shrinkM > 0) {
      draft.push(makeRaw("material", `Термоусадка ${result.settings.heatShrinkType || "12/4"}`, result.shrinkM, "м", ["термоусадка", result.settings.heatShrinkType || "12/4"]));
    }

    if (result.logic.connectionMode === "junction_boxes") {
      if (result.socketJunctions > 0) {
        draft.push(makeRaw("material", `Распайки розеток: ${result.socketDrops} спуск. / ${result.settings.dropsPerSocketJunction}`, result.socketJunctions, "шт", ["распаячная коробка", "розетки"]));
      }
      if (result.switchJunctions > 0) {
        draft.push(makeRaw("material", `Распайки выключателей: ${result.switchDrops} спуск. / ${result.settings.dropsPerSwitchJunction}`, result.switchJunctions, "шт", ["распаячная коробка", "выключатели"]));
      }
    }

    window.PoolV21.draft = draft;
    window.PoolV21.save?.();
    window.PoolV21.renderDraft?.();
  }

  function calculateAndShow() {
    const result = calculateVisibleConnectors();
    appendRowsToDraft(result);

    // Старый renderDraft может перерисовать экран и удалить панель — поэтому рисуем после него.
    setTimeout(() => renderVisiblePanel(result), 30);
    setTimeout(() => renderVisiblePanel(result), 250);

    toast("Показал соединители/распайки отдельным блоком.");
    sound();
    return result;
  }

  function setVersionBadges() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (screen) {
      const badge = screen.querySelector(".p2114-head b, .p2113-head b, .p21-7-head b");
      if (badge) badge.textContent = VERSION;
    }

    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch {}
  }

  function patchPool() {
    if (!window.PoolV21) return false;

    if (!window.PoolV2118VisibleConnectorLines) window.PoolV2118VisibleConnectorLines = {};

    if (!window.PoolV2118VisibleConnectorLines.baseBuildDraft) {
      window.PoolV2118VisibleConnectorLines.baseBuildDraft =
        window.PoolV2117ForceConnectorDraftOutput?.baseBuildDraft ||
        window.PoolV2116UniversalConnectorMath?.oldBuildDraft ||
        (window.PoolV21.buildDraft ? window.PoolV21.buildDraft.bind(window.PoolV21) : null);
    }

    const baseBuild = window.PoolV2118VisibleConnectorLines.baseBuildDraft;

    window.PoolV21.buildDraft = function () {
      if (baseBuild && baseBuild !== window.PoolV21.buildDraft) baseBuild();
      return calculateAndShow();
    };

    window.PoolV21.__v2118VisibleConnectorPatched = true;
    return true;
  }

  function bind() {
    document.addEventListener("click", event => {
      const root = event.target.closest("#ep-pool-v21-screen");
      if (!root) return;

      const buildBtn = event.target.closest("[data-p2114-build], [data-p2113-build], [data-p21-7-build]");
      if (buildBtn) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const baseBuild = window.PoolV2118VisibleConnectorLines?.baseBuildDraft;
        if (baseBuild) baseBuild();

        calculateAndShow();
        return;
      }

      const recalc = event.target.closest("[data-p2118-recalc]");
      if (recalc) {
        event.preventDefault();
        event.stopImmediatePropagation();
        calculateAndShow();
        return;
      }
    }, true);
  }

  function boot() {
    patchPool();
    setVersionBadges();

    const existing = window.PoolV21?.draft || [];
    if (existing.length && document.querySelector("#ep-pool-v21-screen:not(.hidden)")) {
      const result = calculateVisibleConnectors();
      renderVisiblePanel(result);
    }
  }

  function init() {
    bind();

    boot();
    setTimeout(boot, 500);
    setTimeout(boot, 1200);
    setTimeout(boot, 2500);

    window.PoolV2118VisibleConnectorLines = Object.assign(window.PoolV2118VisibleConnectorLines || {}, {
      calculateVisibleConnectors,
      calculateAndShow,
      renderVisiblePanel
    });

    diag("ok", "pool-v21-18-ready", "Pool V21.18 visible connector lines ready.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
