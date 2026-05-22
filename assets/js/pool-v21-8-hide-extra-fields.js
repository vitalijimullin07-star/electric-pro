(function () {
  const FILE = "assets/js/pool-v21-8-hide-extra-fields.js";
  const VERSION = "V21.8";

  function diag(level, code, message) {
    const payload = {
      file: FILE,
      module: "PoolV218HideExtraFields",
      functionName: "runtime",
      place: "pool",
      code,
      message
    };
    if (level === "error") window.Diagnostics?.error?.(payload);
    else window.Diagnostics?.ok?.(payload);
  }

  function hideExtraFields() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const details = screen.querySelector(".p21-7-details");
    if (details) {
      details.classList.add("p21-8-hidden-extra-fields");
    }

    // Оставляем значения для расчёта, но скрываем поля с экрана.
    const room = document.getElementById("p21-7-room");
    const cable = document.getElementById("p21-7-cable");
    const strobe = document.getElementById("p21-7-strobe");

    if (room && !room.value) room.value = "Комната";
    if (cable && !cable.value) cable.value = "10";
    if (strobe && !strobe.value) strobe.value = "5";

    const badge = screen.querySelector(".p21-7-head b");
    if (badge) badge.textContent = VERSION;

    // Сохраняем совместимость с текущим состоянием.
    try {
      const raw = JSON.parse(localStorage.getItem("ep_pool_v21_7_state") || "{}");
      raw.room = raw.room || "Комната";
      raw.cableM = Number(raw.cableM || 10);
      raw.strobeM = Number(raw.strobeM || 5);
      localStorage.setItem("ep_pool_v21_7_state", JSON.stringify(raw));
    } catch {}
  }

  function patchPoolOpen() {
    if (!window.PoolV21 || window.PoolV21.__v218HideFieldsPatched) return false;

    const oldOpen = window.PoolV21.open?.bind(window.PoolV21);
    window.PoolV21.open = function (...args) {
      const result = oldOpen ? oldOpen(...args) : undefined;
      setTimeout(hideExtraFields, 40);
      setTimeout(hideExtraFields, 300);
      setTimeout(hideExtraFields, 900);
      return result;
    };

    window.PoolV21.__v218HideFieldsPatched = true;
    return true;
  }

  function updateBadges() {
    try {
      if (window.ModuleVersionBadgesV212?.setVersion) {
        window.ModuleVersionBadgesV212.setVersion("pool", VERSION);
        window.ModuleVersionBadgesV212.setVersion("rough", VERSION);
        window.ModuleVersionBadgesV212.apply?.();
      }
    } catch {}
  }

  function init() {
    const boot = () => {
      patchPoolOpen();
      hideExtraFields();
      updateBadges();
    };

    boot();
    setTimeout(boot, 700);
    setTimeout(boot, 1800);
    setTimeout(boot, 3500);

    window.PoolV218HideExtraFields = {
      hideExtraFields,
      updateBadges
    };

    diag("ok", "pool-v21-8-ready", "Pool V21.8 extra fields hidden.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
