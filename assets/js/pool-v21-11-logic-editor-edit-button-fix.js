(function () {
  const FILE = "assets/js/pool-v21-11-logic-editor-edit-button-fix.js";
  const VERSION = "V21.11";

  function diag(level, code, message) {
    const payload = {
      file: FILE,
      module: "PoolV2111LogicEditorEditButtonFix",
      functionName: "runtime",
      place: "pool",
      code,
      message
    };
    if (level === "error") window.Diagnostics?.error?.(payload);
    else window.Diagnostics?.ok?.(payload);
  }

  function sound() {
    try {
      if (window.SoundAPI?.click) return window.SoundAPI.click();
      if (window.SoundAPI?.tap) return window.SoundAPI.tap();
      if (window.SoundAPI?.unlock) return window.SoundAPI.unlock();
    } catch {}
  }

  function normalizeLabels() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const badge =
      screen.querySelector(".p21-7-head b") ||
      screen.querySelector(".ep-pool-v21-db") ||
      screen.querySelector("#ep-pool-v21-db-pill");

    if (badge) badge.textContent = VERSION;

    const toggle = screen.querySelector("[data-p21-9-toggle]");
    const body = screen.querySelector(".p21-9-logic-body");

    if (toggle) {
      toggle.classList.add("p21-11-edit-toggle");
      toggle.textContent = body && !body.classList.contains("hidden")
        ? "Скрыть редактор"
        : "Изменить логику";
    }

    const renameMap = new Map([
      ["Обычная", "Штр. распайка"],
      ["В подрозетн.", "Штр. подроз."],
      ["Обычная штроба", "Штр. распайка"],
      ["Соед. в подрозетниках", "Штр. подроз."]
    ]);

    screen.querySelectorAll(".p21-9-grid label").forEach(label => {
      const input = label.querySelector("input");
      if (!input) return;

      const nodes = Array.from(label.childNodes);
      const textNode = nodes.find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      const current = (textNode?.textContent || "").trim();

      if (renameMap.has(current)) {
        textNode.textContent = renameMap.get(current);
      }

      // Если V21.10 уже сохранил исходное название в data-short-title.
      if (label.dataset.shortTitle && renameMap.has(label.dataset.shortTitle)) {
        label.dataset.shortTitle = renameMap.get(label.dataset.shortTitle);
      }
    });
  }

  function openEditor() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const body = screen.querySelector(".p21-9-logic-body");
    const toggle = screen.querySelector("[data-p21-9-toggle]");
    if (!body) return;

    body.classList.remove("hidden");
    if (toggle) toggle.textContent = "Скрыть редактор";

    // Сохраняем намерение пользователя: редактор открыт.
    try {
      localStorage.setItem("ep_pool_v21_11_logic_editor_open", "1");
    } catch {}

    normalizeLabels();
  }

  function closeEditor() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const body = screen.querySelector(".p21-9-logic-body");
    const toggle = screen.querySelector("[data-p21-9-toggle]");
    if (!body) return;

    body.classList.add("hidden");
    if (toggle) toggle.textContent = "Изменить логику";

    try {
      localStorage.setItem("ep_pool_v21_11_logic_editor_open", "0");
    } catch {}

    normalizeLabels();
  }

  function restoreEditorState() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const body = screen.querySelector(".p21-9-logic-body");
    if (!body) return;

    let shouldOpen = false;
    try {
      shouldOpen = localStorage.getItem("ep_pool_v21_11_logic_editor_open") === "1";
    } catch {}

    if (shouldOpen) openEditor();
    else closeEditor();
  }

  function updateBadges() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch {}
  }

  function patchPoolOpen() {
    if (!window.PoolV21 || window.PoolV21.__v2111LogicEditorPatched) return false;

    const oldOpen = window.PoolV21.open?.bind(window.PoolV21);
    window.PoolV21.open = function (...args) {
      const result = oldOpen ? oldOpen(...args) : undefined;
      setTimeout(() => { normalizeLabels(); restoreEditorState(); }, 80);
      setTimeout(() => { normalizeLabels(); restoreEditorState(); }, 450);
      setTimeout(() => { normalizeLabels(); restoreEditorState(); }, 1000);
      return result;
    };

    window.PoolV21.__v2111LogicEditorPatched = true;
    return true;
  }

  function bind() {
    document.addEventListener("click", event => {
      const toggle = event.target.closest("[data-p21-9-toggle], .p21-11-edit-toggle");
      if (!toggle) return;
      if (!toggle.closest("#ep-pool-v21-screen")) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const body = document.querySelector("#ep-pool-v21-screen .p21-9-logic-body");
      if (!body) return;

      if (body.classList.contains("hidden")) openEditor();
      else closeEditor();

      sound();
    }, true);
  }

  function init() {
    bind();

    const boot = () => {
      patchPoolOpen();
      normalizeLabels();
      restoreEditorState();
      updateBadges();
    };

    boot();
    setTimeout(boot, 700);
    setTimeout(boot, 1800);
    setTimeout(boot, 3500);

    window.PoolV2111LogicEditorEditButtonFix = {
      normalizeLabels,
      openEditor,
      closeEditor,
      restoreEditorState
    };

    diag("ok", "pool-v21-11-ready", "Pool V21.11 logic editor button fixed.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
