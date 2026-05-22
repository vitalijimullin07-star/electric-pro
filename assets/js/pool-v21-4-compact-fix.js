(function () {
  const FILE = "assets/js/pool-v21-4-compact-fix.js";

  const BASE = {
    height: 30,
    framePosts: 1,
    sockets: 0,
    switches: 1,
    pass: 0,
    cross: 0,
    tv: 0,
    floorReg: 0,
    framesQty: 1
  };

  const KEYS = ["sockets", "switches", "pass", "cross", "tv", "floorReg"];

  function diag(level, code, message) {
    const payload = {
      file: FILE,
      module: "PoolV214CompactFix",
      functionName: "runtime",
      place: "pool",
      code,
      message
    };
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
    clearTimeout(window.__pool214ToastTimer);
    window.__pool214ToastTimer = setTimeout(() => box.classList.remove("show"), 1800);
  }

  function state() {
    if (window.PoolV213FrameUI?.state) return window.PoolV213FrameUI.state;
    window.PoolV213FrameUI ||= {};
    window.PoolV213FrameUI.state ||= { ...BASE };
    return window.PoolV213FrameUI.state;
  }

  function n(v, fallback = 0) {
    const x = Number(v);
    return Number.isFinite(x) ? x : fallback;
  }

  function totalMechanisms() {
    const s = state();
    return KEYS.reduce((sum, key) => sum + n(s[key], 0), 0);
  }

  function renderCountersSafe() {
    const s = state();

    document.querySelectorAll("[data-p21-3-count]").forEach(el => {
      const key = el.getAttribute("data-p21-3-count");
      if (!key) return;
      el.textContent = String(Math.max(key === "framesQty" ? 1 : 0, n(s[key], key === "framesQty" ? 1 : 0)));
    });

    document.querySelectorAll("[data-p21-3-post]").forEach(btn => {
      const val = n(btn.getAttribute("data-p21-3-post"), 0);
      btn.classList.toggle("is-selected", val === n(s.framePosts, 1));
    });

    document.querySelectorAll("[data-p21-3-height]").forEach(btn => {
      const val = n(btn.getAttribute("data-p21-3-height"), 0);
      btn.classList.toggle("is-selected", val === n(s.height, 30));
    });

    const summary = document.getElementById("p21-3-summary");
    if (summary) summary.textContent = `Высота ${n(s.height, 30)}см | ${n(s.framePosts, 1)} пост. | ${totalMechanisms()}/6`;

    try {
      localStorage.setItem("ep_pool_v21_3_ui_state", JSON.stringify(s));
    } catch {}
  }

  function clampPostsTo6() {
    const s = state();
    s.framePosts = Math.max(1, Math.min(6, n(s.framePosts, 1)));
    const total = totalMechanisms();
    if (total > 6) trimMechanismsTo6();
    if (s.framePosts < total && total <= 6) s.framePosts = total;
  }

  function trimMechanismsTo6() {
    const s = state();
    let total = totalMechanisms();
    if (total <= 6) return;

    for (const key of [...KEYS].reverse()) {
      while (n(s[key], 0) > 0 && total > 6) {
        s[key] = n(s[key], 0) - 1;
        total--;
      }
      if (total <= 6) break;
    }

    toast("В одной рамке максимум 6 механизмов.");
  }

  function increment(key) {
    const s = state();

    if (key === "framesQty") {
      s.framesQty = Math.max(1, n(s.framesQty, 1) + 1);
      renderCountersSafe();
      return;
    }

    if (!KEYS.includes(key)) return;

    if (totalMechanisms() >= 6) {
      toast("В одной рамке максимум 6 механизмов.");
      renderCountersSafe();
      return;
    }

    s[key] = n(s[key], 0) + 1;
    const total = totalMechanisms();
    if (n(s.framePosts, 1) < total) s.framePosts = Math.min(6, total);
    renderCountersSafe();
  }

  function decrement(key) {
    const s = state();

    if (key === "framesQty") {
      s.framesQty = Math.max(1, n(s.framesQty, 1) - 1);
      renderCountersSafe();
      return;
    }

    if (!KEYS.includes(key)) return;

    s[key] = Math.max(0, n(s[key], 0) - 1);
    renderCountersSafe();
  }

  function setHeight(value) {
    const s = state();
    s.height = Math.max(0, n(value, 30));
    renderCountersSafe();
  }

  function setPost(value) {
    const s = state();
    const total = totalMechanisms();
    const next = Math.max(1, Math.min(6, n(value, 1)));

    if (next < total) {
      toast(`В рамке уже ${total} механизмов. Постов нужно не меньше ${total}.`);
      s.framePosts = Math.min(6, total);
    } else {
      s.framePosts = next;
    }

    renderCountersSafe();
  }

  function syncInputsToState() {
    const s = state();
    const route = document.getElementById("p21-3-route");
    const wall = document.getElementById("p21-3-wall");
    const room = document.getElementById("p21-3-room");
    const cable = document.getElementById("p21-3-cable");
    const strobe = document.getElementById("p21-3-strobe");

    if (route) s.route = route.value;
    if (wall) s.wall = wall.value;
    if (room) s.room = room.value || "Комната";
    if (cable) s.cableM = n(cable.value, 10);
    if (strobe) s.strobeM = n(strobe.value, 5);

    const custom = document.getElementById("p21-3-custom-height");
    if (custom && !custom.classList.contains("hidden") && custom.value) {
      s.height = n(custom.value, s.height);
    }
  }

  function resetFrameValues() {
    const s = state();
    Object.assign(s, BASE);

    const custom = document.getElementById("p21-3-custom-height");
    if (custom) {
      custom.value = "";
      custom.classList.add("hidden");
    }

    renderCountersSafe();
  }

  function addFrameToPoolFixed() {
    syncInputsToState();
    clampPostsTo6();

    const s = state();
    const total = totalMechanisms();

    if (total <= 0) {
      toast("Добавь хотя бы один механизм.");
      return;
    }

    if (total > 6) {
      toast("В одной рамке максимум 6 механизмов.");
      return;
    }

    if (n(s.framePosts, 1) < total) {
      s.framePosts = total;
      toast(`Постов в рамке поставлено ${total}, по количеству механизмов.`);
    }

    const wallText = {
      concrete: "бетон",
      brick: "кирпич",
      aerated: "газоблок",
      drywall: "гкл"
    }[s.wall] || "бетон";

    const routeText = {
      ceiling: "По потолку",
      floor: "По полу",
      wall: "По стене"
    }[s.route] || "По потолку";

    if (!window.PoolV21) {
      alert("PoolV21 не найден. Сначала нужен V21.1.");
      return;
    }

    const g = {
      id: "g_" + Date.now() + "_" + Math.random().toString(16).slice(2),
      room: s.room || "Комната",
      name: `Высота ${s.height}см | ${s.framePosts} пост.`,
      qty: Math.max(1, n(s.framesQty, 1)),
      cableM: n(s.cableM, 10),
      strobeM: n(s.strobeM, 5),
      reserve: 10,
      sockets: n(s.sockets, 0),
      switches: n(s.switches, 0),
      pass: n(s.pass, 0),
      cross: n(s.cross, 0),
      tv: n(s.tv, 0),
      thermostat: n(s.floorReg, 0),
      wall: wallText,
      mount: "hidden",
      podType: s.wall === "drywall" ? "gkl" : "standard",
      boxes: 0,
      wago: 0,
      gml: 0,
      shrink: 0,
      meta: {
        route: s.route,
        routeLabel: routeText,
        height: s.height,
        framePosts: s.framePosts
      }
    };

    window.PoolV21.groups ||= [];
    window.PoolV21.groups.push(g);
    window.PoolV21.save?.();
    window.PoolV21.renderGroups?.();

    if (window.PoolV213FrameUI?.renderScreen) {
      // Не перерисовываем весь экран, чтобы не прыгал интерфейс.
      if (typeof window.PoolV21.renderGroups === "function") window.PoolV21.renderGroups();
    }

    resetFrameValues();
    toast("Добавлено в пул. Значения сброшены.");
    diag("ok", "pool-frame-added-reset", "Рамка добавлена, значения сброшены.");
  }

  function patchScreenPostSix() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const panel = Array.from(screen.querySelectorAll(".p21-3-panel")).find(el =>
      (el.textContent || "").includes("Постов в рамке")
    );

    if (panel && !panel.querySelector("[data-p21-3-post='6']")) {
      const pills = panel.querySelector(".p21-3-pills");
      if (pills) {
        pills.classList.remove("p21-3-pills-5");
        pills.classList.add("p21-3-pills-6");
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("data-p21-3-post", "6");
        b.textContent = "6";
        pills.appendChild(b);
      }
    }

    const versionPill = document.getElementById("ep-pool-v21-db-pill");
    if (versionPill && versionPill.textContent.includes("V21.3")) {
      versionPill.textContent = "V21.4";
    }
  }

  function patchPoolOpen() {
    if (!window.PoolV21 || window.PoolV21.__v214Patched) return false;

    const oldOpen = window.PoolV21.open?.bind(window.PoolV21);
    window.PoolV21.open = function (...args) {
      const result = oldOpen ? oldOpen(...args) : undefined;
      setTimeout(() => {
        patchScreenPostSix();
        renderCountersSafe();
      }, 80);
      setTimeout(() => {
        patchScreenPostSix();
        renderCountersSafe();
      }, 500);
      return result;
    };

    window.PoolV21.__v214Patched = true;
    return true;
  }

  function bindHardCapture() {
    document.addEventListener("click", event => {
      const inc = event.target.closest("[data-p21-3-inc]");
      if (inc) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        increment(inc.getAttribute("data-p21-3-inc"));
        return;
      }

      const dec = event.target.closest("[data-p21-3-dec]");
      if (dec) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        decrement(dec.getAttribute("data-p21-3-dec"));
        return;
      }

      const height = event.target.closest("[data-p21-3-height]");
      if (height) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        document.getElementById("p21-3-custom-height")?.classList.add("hidden");
        setHeight(height.getAttribute("data-p21-3-height"));
        return;
      }

      const customBtn = event.target.closest("[data-p21-3-custom-btn]");
      if (customBtn) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const input = document.getElementById("p21-3-custom-height");
        if (input) {
          input.classList.toggle("hidden");
          input.focus();
        }
        return;
      }

      const post = event.target.closest("[data-p21-3-post]");
      if (post) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setPost(post.getAttribute("data-p21-3-post"));
        return;
      }

      if (event.target.closest("[data-p21-3-add]")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        addFrameToPoolFixed();
        return;
      }
    }, true);

    document.addEventListener("input", event => {
      if (event.target?.id === "p21-3-custom-height") {
        setHeight(event.target.value);
      }
    }, true);

    document.addEventListener("change", event => {
      if (["p21-3-route", "p21-3-wall", "p21-3-room", "p21-3-cable", "p21-3-strobe"].includes(event.target?.id)) {
        syncInputsToState();
      }
    }, true);
  }

  function init() {
    bindHardCapture();

    const tryPatch = () => {
      if (patchPoolOpen()) {
        diag("ok", "pool-v21-4-ready", "Компактный фикс пула V21.4 подключён.");
      }
      patchScreenPostSix();
      renderCountersSafe();
    };

    tryPatch();
    setTimeout(tryPatch, 700);
    setTimeout(tryPatch, 1800);
    setTimeout(tryPatch, 3200);

    window.PoolV214CompactFix = {
      addFrameToPoolFixed,
      resetFrameValues,
      renderCountersSafe,
      totalMechanisms
    };
  }

  window.addEventListener("DOMContentLoaded", init);
})();
