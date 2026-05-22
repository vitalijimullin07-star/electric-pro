(function () {
  const FILE = "assets/js/pool-v21-6-reset-delete-sound-fix.js";
  const KEYS = ["sockets", "switches", "pass", "cross", "tv", "floorReg"];

  const BASE_AFTER_ADD = {
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

  function st() {
    window.PoolV213FrameUI ||= {};
    window.PoolV213FrameUI.state ||= {};
    return window.PoolV213FrameUI.state;
  }

  function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function esc(text) {
    return String(text ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function diag(level, code, message) {
    const payload = {
      file: FILE,
      module: "PoolV216ResetDeleteSoundFix",
      functionName: "runtime",
      place: "pool",
      code,
      message
    };
    if (level === "error") window.Diagnostics?.error?.(payload);
    else window.Diagnostics?.ok?.(payload);
  }

  function sound(type = "click") {
    try {
      if (type === "success" && window.SoundAPI?.success) return window.SoundAPI.success();
      if (type === "error" && window.SoundAPI?.error) return window.SoundAPI.error();
      if (window.SoundAPI?.click) return window.SoundAPI.click();
      if (window.SoundAPI?.tap) return window.SoundAPI.tap();
      if (window.SoundAPI?.unlock) return window.SoundAPI.unlock();
    } catch {}
  }

  function toast(text) {
    if (window.PoolV21?.toast) {
      window.PoolV21.toast(text);
      return;
    }

    let box = document.getElementById("ep-pool-v21-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-pool-v21-toast";
      document.body.appendChild(box);
    }

    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__pool216Toast);
    window.__pool216Toast = setTimeout(() => box.classList.remove("show"), 1600);
  }

  function totalMechanisms() {
    const state = st();
    return KEYS.reduce((sum, key) => sum + num(state[key], 0), 0);
  }

  function saveState() {
    try {
      localStorage.setItem("ep_pool_v21_3_ui_state", JSON.stringify(st()));
    } catch {}
  }

  function normalizeFrameState() {
    const state = st();
    const total = totalMechanisms();

    state.framesQty = Math.max(1, num(state.framesQty, 1));
    state.framePosts = Math.max(1, Math.min(6, num(state.framePosts, 1)));

    // Главная ошибка со скрина: 0 механизмов, но 6 постов.
    // При нуле механизмов рамка всегда возвращается к 1 посту.
    if (total === 0) {
      state.framePosts = 1;
    } else if (state.framePosts < total) {
      state.framePosts = Math.min(6, total);
    }

    saveState();
  }

  function renderCounters() {
    normalizeFrameState();
    const state = st();
    const total = totalMechanisms();

    document.querySelectorAll("[data-p21-3-count]").forEach(el => {
      const key = el.getAttribute("data-p21-3-count");
      if (!key) return;
      el.textContent = String(key === "framesQty" ? Math.max(1, num(state[key], 1)) : Math.max(0, num(state[key], 0)));
    });

    document.querySelectorAll("[data-p21-3-post]").forEach(btn => {
      btn.classList.toggle("is-selected", num(btn.getAttribute("data-p21-3-post"), 0) === num(state.framePosts, 1));
    });

    document.querySelectorAll("[data-p21-3-height]").forEach(btn => {
      btn.classList.toggle("is-selected", num(btn.getAttribute("data-p21-3-height"), 0) === num(state.height, 30));
    });

    document.querySelectorAll("[data-p21-5-route]").forEach(btn => {
      btn.classList.toggle("is-selected", btn.getAttribute("data-p21-5-route") === state.route);
    });

    document.querySelectorAll("[data-p21-5-wall]").forEach(btn => {
      btn.classList.toggle("is-selected", btn.getAttribute("data-p21-5-wall") === state.wall);
    });

    const summary = document.getElementById("p21-3-summary");
    if (summary) {
      summary.textContent = `${num(state.height, 30)}см · ${num(state.framePosts, 1)} пост. · ${total}/6 · потолок ${num(state.ceilingHeight, 270)}см`;
    }

    const version = document.getElementById("ep-pool-v21-db-pill");
    if (version) version.textContent = "V21.6";
  }

  function renderGroups() {
    const box = document.getElementById("p21-groups");
    if (!box || !window.PoolV21) return;

    const groups = window.PoolV21.groups || [];
    if (!groups.length) {
      box.innerHTML = `<div class="p21-3-empty">Пул пока пуст.</div>`;
      return;
    }

    box.innerHTML = groups.map(g => {
      const total = (
        num(g.sockets,0) +
        num(g.switches,0) +
        num(g.pass,0) +
        num(g.cross,0) +
        num(g.tv,0) +
        num(g.thermostat,0)
      ) * num(g.qty,1);

      return `
        <div class="p21-3-pool-item">
          <div>
            <b>${esc(g.room)} · ${esc(g.name)}</b>
            <p>${num(g.qty,1)} рам. · механизмов ${total} · кабель ${num(g.cableM,0) * num(g.qty,1)}м · штроба ${num(g.strobeM,0) * num(g.qty,1)}м</p>
            <small>${esc(g.meta?.routeLabel || "")} · ${esc(g.wall)} · ${g.meta?.height || ""}см · потолок ${g.meta?.ceilingHeight || "—"}см</small>
          </div>
          <button type="button" class="p21-6-remove-row" data-pool-v21-remove="${esc(g.id)}">×</button>
        </div>
      `;
    }).join("");
  }

  function removeGroup(id) {
    if (!window.PoolV21) return;

    window.PoolV21.groups = (window.PoolV21.groups || []).filter(g => g.id !== id);
    window.PoolV21.save?.();
    renderGroups();

    if (typeof window.PoolV21.buildDraft === "function") {
      window.PoolV21.buildDraft();
    }

    sound("success");
    toast("Строка удалена.");
    diag("ok", "pool-row-removed", "Удалена строка пула.");
  }

  function clearPool() {
    if (!window.PoolV21) return;

    if (!confirm("Очистить пул?")) return;

    window.PoolV21.groups = [];
    window.PoolV21.draft = [];
    window.PoolV21.save?.();
    renderGroups();
    window.PoolV21.renderDraft?.();

    sound("success");
    toast("Пул очищен.");
    diag("ok", "pool-cleared", "Пул очищен.");
  }

  function resetFrame() {
    const state = st();
    const keep = {
      route: state.route || "ceiling",
      wall: state.wall || "concrete",
      ceilingHeight: num(state.ceilingHeight, 270),
      room: state.room || "Комната",
      cableM: num(state.cableM, 10),
      strobeM: num(state.strobeM, 5)
    };

    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, keep, BASE_AFTER_ADD);

    const custom = document.getElementById("p21-3-custom-height");
    if (custom) {
      custom.value = "";
      custom.classList.add("hidden");
    }

    renderCounters();
  }

  function syncInputs() {
    const state = st();

    const room = document.getElementById("p21-3-room");
    const cable = document.getElementById("p21-3-cable");
    const strobe = document.getElementById("p21-3-strobe");
    const ceiling = document.getElementById("p21-5-ceiling");
    const custom = document.getElementById("p21-3-custom-height");

    if (room) state.room = room.value || "Комната";
    if (cable) state.cableM = num(cable.value, 10);
    if (strobe) state.strobeM = num(strobe.value, 5);
    if (ceiling) state.ceilingHeight = num(ceiling.value, 270);
    if (custom && !custom.classList.contains("hidden") && custom.value) state.height = num(custom.value, state.height);

    saveState();
  }

  function addFrame() {
    syncInputs();
    normalizeFrameState();

    const state = st();
    const total = totalMechanisms();

    if (total <= 0) {
      sound("error");
      toast("Добавь хотя бы один механизм.");
      return;
    }

    if (total > 6) {
      sound("error");
      toast("В одной рамке максимум 6 механизмов.");
      return;
    }

    if (!window.PoolV21) {
      alert("PoolV21 не найден.");
      return;
    }

    const wallText = {
      concrete: "бетон",
      panel: "панель",
      soft: "мягкий",
      brick: "кирпич"
    }[state.wall] || "бетон";

    const wallLabel = {
      concrete: "Бетон",
      panel: "Панелька",
      soft: "Мягкий",
      brick: "Кирпич"
    }[state.wall] || "Бетон";

    const routeLabel = {
      ceiling: "По потолку",
      floor: "По полу",
      wall: "По стене"
    }[state.route] || "По потолку";

    const g = {
      id: "g_" + Date.now() + "_" + Math.random().toString(16).slice(2),
      room: state.room || "Комната",
      name: `Высота ${state.height}см | ${state.framePosts} пост.`,
      qty: Math.max(1, num(state.framesQty, 1)),
      cableM: num(state.cableM, 10),
      strobeM: num(state.strobeM, 5),
      reserve: 10,
      sockets: num(state.sockets, 0),
      switches: num(state.switches, 0),
      pass: num(state.pass, 0),
      cross: num(state.cross, 0),
      tv: num(state.tv, 0),
      thermostat: num(state.floorReg, 0),
      wall: wallText,
      mount: "hidden",
      podType: "standard",
      boxes: 0,
      wago: 0,
      gml: 0,
      shrink: 0,
      meta: {
        route: state.route || "ceiling",
        routeLabel,
        wallLabel,
        height: num(state.height, 30),
        ceilingHeight: num(state.ceilingHeight, 270),
        framePosts: num(state.framePosts, 1)
      }
    };

    window.PoolV21.groups ||= [];
    window.PoolV21.groups.push(g);
    window.PoolV21.save?.();
    renderGroups();
    resetFrame();

    sound("success");
    toast("Добавлено в пул. Значения сброшены.");
    diag("ok", "pool-frame-added-v21-6", "Рамка добавлена и сброшена.");
  }

  function increment(key) {
    const state = st();

    if (key === "framesQty") {
      state.framesQty = Math.max(1, num(state.framesQty, 1) + 1);
      sound();
      renderCounters();
      return;
    }

    if (!KEYS.includes(key)) return;

    if (totalMechanisms() >= 6) {
      sound("error");
      toast("В одной рамке максимум 6 механизмов.");
      renderCounters();
      return;
    }

    state[key] = num(state[key], 0) + 1;
    const total = totalMechanisms();
    if (num(state.framePosts, 1) < total) state.framePosts = total;

    sound();
    renderCounters();
  }

  function decrement(key) {
    const state = st();

    if (key === "framesQty") {
      state.framesQty = Math.max(1, num(state.framesQty, 1) - 1);
      sound();
      renderCounters();
      return;
    }

    if (!KEYS.includes(key)) return;

    state[key] = Math.max(0, num(state[key], 0) - 1);

    // После убавления механизмов разрешаем вернуть посты ниже.
    // Если механизмов стало 0, рамка сбрасывается на 1 пост.
    if (totalMechanisms() === 0) state.framePosts = 1;

    sound();
    renderCounters();
  }

  function setPosts(value) {
    const state = st();
    const total = totalMechanisms();
    const next = Math.max(1, Math.min(6, num(value, 1)));

    if (total > 0 && next < total) {
      sound("error");
      toast(`Нельзя меньше ${total}: в рамке ${total} механизмов.`);
      state.framePosts = total;
    } else {
      state.framePosts = next;
      sound();
    }

    renderCounters();
  }

  function setHeight(value) {
    st().height = Math.max(0, num(value, 30));
    sound();
    renderCounters();
  }

  function setRoute(value) {
    st().route = value || "ceiling";
    sound();
    renderCounters();
  }

  function setWall(value) {
    st().wall = value || "concrete";
    sound();
    renderCounters();
  }

  function bind() {
    document.addEventListener("click", event => {
      const remove = event.target.closest("[data-pool-v21-remove]");
      if (remove) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        removeGroup(remove.getAttribute("data-pool-v21-remove"));
        return;
      }

      if (event.target.closest("[data-pool-v21-clear]")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        clearPool();
        return;
      }

      if (event.target.closest("[data-p21-3-add]")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        addFrame();
        return;
      }

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

      const post = event.target.closest("[data-p21-3-post]");
      if (post) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setPosts(post.getAttribute("data-p21-3-post"));
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

      const route = event.target.closest("[data-p21-5-route]");
      if (route) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setRoute(route.getAttribute("data-p21-5-route"));
        return;
      }

      const wall = event.target.closest("[data-p21-5-wall]");
      if (wall) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setWall(wall.getAttribute("data-p21-5-wall"));
      }
    }, true);

    document.addEventListener("input", event => {
      if (["p21-5-ceiling", "p21-3-custom-height", "p21-3-room", "p21-3-cable", "p21-3-strobe"].includes(event.target?.id)) {
        syncInputs();
        renderCounters();
      }
    }, true);
  }

  function patchRender() {
    if (!window.PoolV21 || window.PoolV21.__v216Patched) return false;

    const oldOpen = window.PoolV21.open?.bind(window.PoolV21);
    window.PoolV21.open = function (...args) {
      const res = oldOpen ? oldOpen(...args) : undefined;
      setTimeout(() => {
        renderCounters();
        renderGroups();
      }, 80);
      setTimeout(() => {
        renderCounters();
        renderGroups();
      }, 500);
      return res;
    };

    window.PoolV21.renderGroups = renderGroups;

    const oldClear = window.PoolV21.clear?.bind(window.PoolV21);
    window.PoolV21.clear = clearPool;

    window.PoolV21.__v216Patched = true;
    return true;
  }

  function init() {
    bind();

    const boot = () => {
      patchRender();
      renderCounters();
      renderGroups();
    };

    boot();
    setTimeout(boot, 700);
    setTimeout(boot, 1800);
    setTimeout(boot, 3200);

    window.PoolV216ResetDeleteSoundFix = {
      renderCounters,
      renderGroups,
      resetFrame,
      totalMechanisms,
      clearPool
    };

    diag("ok", "pool-v21-6-ready", "Pool V21.6 reset/delete/sound fix ready.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
