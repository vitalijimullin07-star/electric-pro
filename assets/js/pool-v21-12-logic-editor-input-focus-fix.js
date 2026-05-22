(function () {
  const FILE = "assets/js/pool-v21-12-logic-editor-input-focus-fix.js";
  const VERSION = "V21.12";

  let editorFocused = false;

  function diag(level, code, message) {
    const payload = {
      file: FILE,
      module: "PoolV2112LogicEditorInputFocusFix",
      functionName: "runtime",
      place: "pool",
      code,
      message
    };
    if (level === "error") window.Diagnostics?.error?.(payload);
    else window.Diagnostics?.ok?.(payload);
  }

  function setBadge() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const badge =
      screen.querySelector(".p21-7-head b") ||
      screen.querySelector(".ep-pool-v21-db") ||
      screen.querySelector("#ep-pool-v21-db-pill");

    if (badge) badge.textContent = VERSION;
  }

  function getBody() {
    return document.querySelector("#ep-pool-v21-screen .p21-9-logic-body");
  }

  function getToggle() {
    return document.querySelector("#ep-pool-v21-screen [data-p21-9-toggle]");
  }

  function openEditor() {
    const body = getBody();
    const toggle = getToggle();

    if (!body) return;

    body.classList.remove("hidden");
    if (toggle) toggle.textContent = "Скрыть редактор";

    try {
      localStorage.setItem("ep_pool_v21_11_logic_editor_open", "1");
      localStorage.setItem("ep_pool_v21_12_logic_editor_open", "1");
    } catch {}

    setBadge();
  }

  function closeEditor() {
    if (editorFocused) {
      openEditor();
      return;
    }

    const body = getBody();
    const toggle = getToggle();

    if (!body) return;

    body.classList.add("hidden");
    if (toggle) toggle.textContent = "Изменить логику";

    try {
      localStorage.setItem("ep_pool_v21_11_logic_editor_open", "0");
      localStorage.setItem("ep_pool_v21_12_logic_editor_open", "0");
    } catch {}

    setBadge();
  }

  function restoreEditorState() {
    const body = getBody();
    if (!body) return;

    let shouldOpen = false;
    try {
      shouldOpen =
        localStorage.getItem("ep_pool_v21_12_logic_editor_open") === "1" ||
        localStorage.getItem("ep_pool_v21_11_logic_editor_open") === "1";
    } catch {}

    if (shouldOpen || editorFocused) openEditor();
    else {
      const toggle = getToggle();
      if (toggle && body.classList.contains("hidden")) toggle.textContent = "Изменить логику";
      if (toggle && !body.classList.contains("hidden")) toggle.textContent = "Скрыть редактор";
    }

    setBadge();
  }

  function updateBadges() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch {}
  }

  function protectEditorEvents() {
    const body = getBody();
    if (!body || body.dataset.v2112Protected === "1") return;

    body.dataset.v2112Protected = "1";

    const stopInside = (event) => {
      // ВАЖНО: не preventDefault, чтобы input нормально получал фокус и ввод.
      event.stopPropagation();
    };

    ["pointerdown", "touchstart", "mousedown", "click"].forEach(type => {
      body.addEventListener(type, stopInside, true);
      body.addEventListener(type, stopInside, false);
    });

    body.addEventListener("focusin", () => {
      editorFocused = true;
      openEditor();
    }, true);

    body.addEventListener("focusout", () => {
      setTimeout(() => {
        const active = document.activeElement;
        editorFocused = !!(active && active.closest && active.closest("#ep-pool-v21-screen .p21-9-logic-body"));
        if (editorFocused) openEditor();
      }, 120);
    }, true);

    body.querySelectorAll("input, textarea, select").forEach(input => {
      input.addEventListener("click", event => {
        event.stopPropagation();
        editorFocused = true;
        openEditor();
      }, true);

      input.addEventListener("touchstart", event => {
        event.stopPropagation();
        editorFocused = true;
        openEditor();
      }, true);

      input.addEventListener("focus", () => {
        editorFocused = true;
        openEditor();
      }, true);

      input.addEventListener("input", () => {
        editorFocused = true;
        openEditor();
      }, true);
    });
  }

  function patchToggle() {
    const toggle = getToggle();
    if (!toggle || toggle.dataset.v2112TogglePatched === "1") return;

    toggle.dataset.v2112TogglePatched = "1";

    toggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      editorFocused = false;

      const body = getBody();
      if (!body) return;

      if (body.classList.contains("hidden")) openEditor();
      else closeEditor();
    }, true);
  }

  function patchPoolOpen() {
    if (!window.PoolV21 || window.PoolV21.__v2112InputFocusPatched) return false;

    const oldOpen = window.PoolV21.open?.bind(window.PoolV21);
    window.PoolV21.open = function (...args) {
      const result = oldOpen ? oldOpen(...args) : undefined;

      setTimeout(bootOnce, 60);
      setTimeout(bootOnce, 350);
      setTimeout(bootOnce, 1000);

      return result;
    };

    window.PoolV21.__v2112InputFocusPatched = true;
    return true;
  }

  function bootOnce() {
    patchPoolOpen();
    protectEditorEvents();
    patchToggle();
    restoreEditorState();
    updateBadges();
    setBadge();
  }

  function bindGlobalGuard() {
    document.addEventListener("click", event => {
      const body = event.target.closest?.("#ep-pool-v21-screen .p21-9-logic-body");
      if (!body) return;

      // Страховка от старых обработчиков V21.9/V21.11:
      // клик внутри тела редактора не должен считаться кликом по кнопке сворачивания.
      event.stopPropagation();
      editorFocused = true;
      openEditor();
    }, true);

    document.addEventListener("focusin", event => {
      if (event.target.closest?.("#ep-pool-v21-screen .p21-9-logic-body")) {
        editorFocused = true;
        openEditor();
      }
    }, true);
  }

  function init() {
    bindGlobalGuard();

    bootOnce();
    setTimeout(bootOnce, 700);
    setTimeout(bootOnce, 1800);
    setTimeout(bootOnce, 3500);

    window.PoolV2112LogicEditorInputFocusFix = {
      openEditor,
      closeEditor,
      restoreEditorState,
      protectEditorEvents
    };

    diag("ok", "pool-v21-12-ready", "Pool V21.12 logic editor input focus fix ready.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
