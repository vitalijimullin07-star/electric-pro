(function () {
  const FILE = "assets/js/pool-v21-5-controls-ceiling-fix.js";

  const KEYS = ["sockets", "switches", "pass", "cross", "tv", "floorReg"];

  const WALLS = [
    ["concrete", "Бетон", "бетон"],
    ["panel", "Панелька", "панель"],
    ["soft", "Мягкий", "мягкий"],
    ["brick", "Кирпич", "кирпич"]
  ];

  const ROUTES = [
    ["ceiling", "По потолку"],
    ["floor", "По полу"],
    ["wall", "По стене"]
  ];

  const BASE_FRAME = {
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

  function s() {
    window.PoolV213FrameUI ||= {};
    window.PoolV213FrameUI.state ||= {};
    const state = window.PoolV213FrameUI.state;

    if (!state.route) state.route = "ceiling";
    if (!state.wall) state.wall = "concrete";
    if (!state.ceilingHeight) state.ceilingHeight = 270;
    if (!state.room) state.room = "Комната";
    if (!state.cableM) state.cableM = 10;
    if (!state.strobeM) state.strobeM = 5;
    if (!state.height) state.height = 30;
    if (!state.framePosts) state.framePosts = 1;
    if (!state.framesQty) state.framesQty = 1;

    KEYS.forEach(k => {
      if (state[k] === undefined || state[k] === null) state[k] = 0;
    });

    return state;
  }

  function n(value, fallback = 0) {
    const x = Number(value);
    return Number.isFinite(x) ? x : fallback;
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
      module: "PoolV215ControlsCeilingFix",
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
    clearTimeout(window.__pool215Toast);
    window.__pool215Toast = setTimeout(() => box.classList.remove("show"), 1600);
  }

  function wallText(code) {
    return (WALLS.find(x => x[0] === code) || WALLS[0])[2];
  }

  function wallLabel(code) {
    return (WALLS.find(x => x[0] === code) || WALLS[0])[1];
  }

  function routeLabel(code) {
    return (ROUTES.find(x => x[0] === code) || ROUTES[0])[1];
  }

  function totalMechanisms() {
    const state = s();
    return KEYS.reduce((sum, key) => sum + n(state[key], 0), 0);
  }

  function saveState() {
    try {
      localStorage.setItem("ep_pool_v21_3_ui_state", JSON.stringify(s()));
    } catch {}
  }

  function renderMiniSelectors() {
    const state = s();

    document.querySelectorAll("[data-p21-5-route]").forEach(btn => {
      btn.classList.toggle("is-selected", btn.getAttribute("data-p21-5-route") === state.route);
    });

    document.querySelectorAll("[data-p21-5-wall]").forEach(btn => {
      btn.classList.toggle("is-selected", btn.getAttribute("data-p21-5-wall") === state.wall);
    });

    document.querySelectorAll("[data-p21-3-height]").forEach(btn => {
      btn.classList.toggle("is-selected", n(btn.getAttribute("data-p21-3-height"), 0) === n(state.height, 30));
    });

    document.querySelectorAll("[data-p21-3-post]").forEach(btn => {
      btn.classList.toggle("is-selected", n(btn.getAttribute("data-p21-3-post"), 0) === n(state.framePosts, 1));
    });

    document.querySelectorAll("[data-p21-3-count]").forEach(el => {
      const key = el.getAttribute("data-p21-3-count");
      if (!key) return;
      el.textContent = String(key === "framesQty" ? Math.max(1, n(state[key], 1)) : Math.max(0, n(state[key], 0)));
    });

    const ceiling = document.getElementById("p21-5-ceiling");
    if (ceiling && document.activeElement !== ceiling) ceiling.value = n(state.ceilingHeight, 270);

    const summary = document.getElementById("p21-3-summary");
    if (summary) {
      summary.textContent = `${n(state.height, 30)}см · ${n(state.framePosts, 1)} пост. · ${totalMechanisms()}/6 · потолок ${n(state.ceilingHeight, 270)}см`;
    }

    const version = document.getElementById("ep-pool-v21-db-pill");
    if (version) version.textContent = "V21.5";

    saveState();
  }

  function buildRouteWallBlock() {
    const state = s();

    return `
      <div class="p21-5-route-wall-card">
        <div class="p21-5-route-head">
          <div>
            <span>Трассы (кабель)</span>
            <div class="p21-5-route-buttons">
              ${ROUTES.map(([key, label]) => `
                <button type="button" data-p21-5-route="${key}" class="${state.route === key ? "is-selected" : ""}">${label}</button>
              `).join("")}
            </div>
          </div>

          <label class="p21-5-ceiling-label">
            <span>Высота потолка, см</span>
            <input id="p21-5-ceiling" type="number" min="180" value="${n(state.ceilingHeight, 270)}">
          </label>
        </div>

        <div class="p21-5-wall-block">
          <span>Стена (для штроб)</span>
          <div class="p21-5-wall-buttons">
            ${WALLS.map(([key, label]) => `
              <button type="button" data-p21-5-wall="${key}" class="${state.wall === key ? "is-selected" : ""}">${label}</button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function replaceSelectsWithButtons() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const oldTopGrid = screen.querySelector(".p21-3-top-grid");
    if (oldTopGrid && !screen.querySelector(".p21-5-route-wall-card")) {
      oldTopGrid.outerHTML = buildRouteWallBlock();
    }

    // Если вдруг селекты остались, не даём им ломать вид.
    const routeSelect = document.getElementById("p21-3-route");
    const wallSelect = document.getElementById("p21-3-wall");
    routeSelect?.closest("label")?.classList.add("p21-5-hidden-old-select");
    wallSelect?.closest("label")?.classList.add("p21-5-hidden-old-select");

    ensureSixPosts();
    renderMiniSelectors();
  }

  function ensureSixPosts() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const panel = Array.from(screen.querySelectorAll(".p21-3-panel")).find(el =>
      (el.textContent || "").includes("Постов в рамке")
    );

    if (!panel) return;

    const pills = panel.querySelector(".p21-3-pills");
    if (!pills) return;

    pills.classList.remove("p21-3-pills-5");
    pills.classList.add("p21-3-pills-6");

    if (!pills.querySelector("[data-p21-3-post='6']")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-p21-3-post", "6");
      btn.textContent = "6";
      pills.appendChild(btn);
    }
  }

  function setHeight(value) {
    const state = s();
    state.height = Math.max(0, n(value, 30));
    renderMiniSelectors();
  }

  function setPosts(value) {
    const state = s();
    const total = totalMechanisms();
    const next = Math.max(1, Math.min(6, n(value, 1)));

    // Важно: теперь можно уменьшать с 6 на 5/4/3 и т.д., если механизмов позволяет.
    if (next < total) {
      toast(`Нельзя меньше ${total}: в рамке уже ${total} механизмов.`);
      state.framePosts = total;
    } else {
      state.framePosts = next;
    }

    renderMiniSelectors();
  }

  function inc(key) {
    const state = s();

    if (key === "framesQty") {
      state.framesQty = Math.max(1, n(state.framesQty, 1) + 1);
      renderMiniSelectors();
      return;
    }

    if (!KEYS.includes(key)) return;

    if (totalMechanisms() >= 6) {
      toast("В одной рамке максимум 6 механизмов.");
      renderMiniSelectors();
      return;
    }

    state[key] = n(state[key], 0) + 1;

    const total = totalMechanisms();
    if (n(state.framePosts, 1) < total) state.framePosts = total;

    renderMiniSelectors();
  }

  function dec(key) {
    const state = s();

    if (key === "framesQty") {
      state.framesQty = Math.max(1, n(state.framesQty, 1) - 1);
      renderMiniSelectors();
      return;
    }

    if (!KEYS.includes(key)) return;

    state[key] = Math.max(0, n(state[key], 0) - 1);
    // Здесь специально НЕ зажимаем framePosts вниз. Пользователь сам может поставить меньше.
    renderMiniSelectors();
  }

  function syncSimpleInputs() {
    const state = s();

    const room = document.getElementById("p21-3-room");
    const cable = document.getElementById("p21-3-cable");
    const strobe = document.getElementById("p21-3-strobe");
    const ceiling = document.getElementById("p21-5-ceiling");
    const custom = document.getElementById("p21-3-custom-height");

    if (room) state.room = room.value || "Комната";
    if (cable) state.cableM = n(cable.value, 10);
    if (strobe) state.strobeM = n(strobe.value, 5);
    if (ceiling) state.ceilingHeight = n(ceiling.value, 270);
    if (custom && !custom.classList.contains("hidden") && custom.value) state.height = n(custom.value, state.height);

    saveState();
  }

  function resetAfterAdd() {
    const state = s();
    const keep = {
      route: state.route,
      wall: state.wall,
      ceilingHeight: state.ceilingHeight,
      room: state.room,
      cableM: state.cableM,
      strobeM: state.strobeM
    };

    Object.assign(state, keep, BASE_FRAME);

    const custom = document.getElementById("p21-3-custom-height");
    if (custom) {
      custom.value = "";
      custom.classList.add("hidden");
    }

    renderMiniSelectors();
  }

  function addFrame() {
    syncSimpleInputs();

    const state = s();
    const total = totalMechanisms();

    if (total <= 0) {
      toast("Добавь хотя бы один механизм.");
      return;
    }

    if (total > 6) {
      toast("В одной рамке максимум 6 механизмов.");
      return;
    }

    if (n(state.framePosts, 1) < total) {
      state.framePosts = total;
      toast(`Постов в рамке поставлено ${total}.`);
    }

    if (!window.PoolV21) {
      alert("PoolV21 не найден. Сначала нужен V21.1.");
      return;
    }

    const g = {
      id: "g_" + Date.now() + "_" + Math.random().toString(16).slice(2),
      room: state.room || "Комната",
      name: `Высота ${state.height}см | ${state.framePosts} пост.`,
      qty: Math.max(1, n(state.framesQty, 1)),
      cableM: n(state.cableM, 10),
      strobeM: n(state.strobeM, 5),
      reserve: 10,
      sockets: n(state.sockets, 0),
      switches: n(state.switches, 0),
      pass: n(state.pass, 0),
      cross: n(state.cross, 0),
      tv: n(state.tv, 0),
      thermostat: n(state.floorReg, 0),
      wall: wallText(state.wall),
      mount: "hidden",
      podType: "standard",
      boxes: 0,
      wago: 0,
      gml: 0,
      shrink: 0,
      meta: {
        route: state.route,
        routeLabel: routeLabel(state.route),
        wallLabel: wallLabel(state.wall),
        height: state.height,
        ceilingHeight: state.ceilingHeight,
        framePosts: state.framePosts
      }
    };

    window.PoolV21.groups ||= [];
    window.PoolV21.groups.push(g);
    window.PoolV21.save?.();
    window.PoolV21.renderGroups?.();

    resetAfterAdd();
    toast("Добавлено в пул.");
    diag("ok", "pool-frame-added-v21-5", "Рамка добавлена в пул V21.5.");
  }

  function patchOpen() {
    if (!window.PoolV21 || window.PoolV21.__v215Patched) return false;

    const oldOpen = window.PoolV21.open?.bind(window.PoolV21);

    window.PoolV21.open = function (...args) {
      const result = oldOpen ? oldOpen(...args) : undefined;

      setTimeout(() => {
        replaceSelectsWithButtons();
        renderMiniSelectors();
      }, 60);

      setTimeout(() => {
        replaceSelectsWithButtons();
        renderMiniSelectors();
      }, 500);

      return result;
    };

    window.PoolV21.__v215Patched = true;
    return true;
  }

  function bind() {
    document.addEventListener("click", event => {
      const route = event.target.closest("[data-p21-5-route]");
      if (route) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        s().route = route.getAttribute("data-p21-5-route");
        renderMiniSelectors();
        return;
      }

      const wall = event.target.closest("[data-p21-5-wall]");
      if (wall) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        s().wall = wall.getAttribute("data-p21-5-wall");
        renderMiniSelectors();
        return;
      }

      const incBtn = event.target.closest("[data-p21-3-inc]");
      if (incBtn) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        inc(incBtn.getAttribute("data-p21-3-inc"));
        return;
      }

      const decBtn = event.target.closest("[data-p21-3-dec]");
      if (decBtn) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        dec(decBtn.getAttribute("data-p21-3-dec"));
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

      const custom = event.target.closest("[data-p21-3-custom-btn]");
      if (custom) {
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
        setPosts(post.getAttribute("data-p21-3-post"));
        return;
      }

      if (event.target.closest("[data-p21-3-add]")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        addFrame();
        return;
      }
    }, true);

    document.addEventListener("input", event => {
      if (["p21-5-ceiling", "p21-3-custom-height", "p21-3-room", "p21-3-cable", "p21-3-strobe"].includes(event.target?.id)) {
        syncSimpleInputs();
        renderMiniSelectors();
      }
    }, true);
  }

  function init() {
    bind();

    const boot = () => {
      if (patchOpen()) {
        diag("ok", "pool-v21-5-ready", "Pool V21.5 controls fix ready.");
      }
      replaceSelectsWithButtons();
      renderMiniSelectors();
    };

    boot();
    setTimeout(boot, 700);
    setTimeout(boot, 1800);

    window.PoolV215ControlsCeilingFix = {
      state: s,
      render: renderMiniSelectors,
      replaceSelectsWithButtons,
      totalMechanisms
    };
  }

  window.addEventListener("DOMContentLoaded", init);
})();
