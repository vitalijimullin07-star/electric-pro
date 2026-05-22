(function () {
  const FILE = "assets/js/pool-v21-3-frame-ui.js";
  const VERSION = "v21-3-pool-frame-ui";

  const defaults = {
    route: "ceiling",
    wall: "concrete",
    height: 30,
    framePosts: 1,
    sockets: 0,
    switches: 1,
    pass: 0,
    cross: 0,
    tv: 0,
    floorReg: 0,
    framesQty: 1,
    room: "Комната",
    cableM: 10,
    strobeM: 5
  };

  const labels = {
    route: {
      ceiling: "По потолку",
      floor: "По полу",
      wall: "По стене"
    },
    wall: {
      concrete: "Бетон",
      brick: "Кирпич",
      aerated: "Газоблок",
      drywall: "ГКЛ"
    },
    wallText: {
      concrete: "бетон",
      brick: "кирпич",
      aerated: "газоблок",
      drywall: "гкл"
    }
  };

  let state = { ...defaults };

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
      module: "PoolV213FrameUI",
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
    setTimeout(() => box.classList.remove("show"), 1800);
  }

  function counterValue(key) {
    return Number(state[key] || 0);
  }

  function setCounter(key, value) {
    state[key] = Math.max(0, Number(value || 0));
    renderCounters();
  }

  function changeCounter(key, delta) {
    setCounter(key, counterValue(key) + delta);
  }

  function selectedClass(current, value) {
    return current === value ? "is-selected" : "";
  }

  function saveUiState() {
    try {
      localStorage.setItem("ep_pool_v21_3_ui_state", JSON.stringify(state));
    } catch {}
  }

  function loadUiState() {
    try {
      const raw = JSON.parse(localStorage.getItem("ep_pool_v21_3_ui_state") || "{}");
      state = { ...defaults, ...raw };
    } catch {
      state = { ...defaults };
    }
  }

  function totalMechanisms() {
    return Number(state.sockets || 0) +
      Number(state.switches || 0) +
      Number(state.pass || 0) +
      Number(state.cross || 0) +
      Number(state.tv || 0) +
      Number(state.floorReg || 0);
  }

  function autoPosts() {
    const total = totalMechanisms();
    if (total <= 0) return state.framePosts;
    return Math.min(5, Math.max(1, total));
  }

  function renderCounters() {
    document.querySelectorAll("[data-p21-3-count]").forEach(el => {
      const key = el.dataset.p21_3Count || el.getAttribute("data-p21-3-count");
      el.textContent = String(counterValue(key));
    });

    const frameQty = document.querySelector("[data-p21-3-count='framesQty']");
    if (frameQty) frameQty.textContent = String(Math.max(1, counterValue("framesQty")));

    document.querySelectorAll("[data-p21-3-post]").forEach(btn => {
      btn.classList.toggle("is-selected", Number(btn.dataset.p21_3Post || btn.getAttribute("data-p21-3-post")) === Number(state.framePosts));
    });

    document.querySelectorAll("[data-p21-3-height]").forEach(btn => {
      btn.classList.toggle("is-selected", Number(btn.dataset.p21_3Height || btn.getAttribute("data-p21-3-height")) === Number(state.height));
    });

    const custom = document.getElementById("p21-3-custom-height");
    if (custom && ![30, 90, 110].includes(Number(state.height))) {
      custom.value = Number(state.height || 0);
    }

    saveUiState();
  }

  function renderScreen() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    screen.innerHTML = `
      <div class="ep-pool-v21-head p21-3-head">
        <button class="ep-pool-v21-close" type="button" data-pool-v21-close>←</button>
        <div>
          <h2>Пул розеток / штроб</h2>
          <p>Рамки, высоты, трассы, штробы и подбор из активной базы.</p>
        </div>
        <div class="ep-pool-v21-db" id="ep-pool-v21-db-pill">V21.3</div>
      </div>

      <div class="p21-3-shell">
        <section class="p21-3-card">
          <div class="p21-3-top-grid">
            <label>
              <span>Трассы (кабель)</span>
              <select id="p21-3-route">
                <option value="ceiling">По потолку</option>
                <option value="floor">По полу</option>
                <option value="wall">По стене</option>
              </select>
            </label>

            <label>
              <span>Стена (для штроб)</span>
              <select id="p21-3-wall">
                <option value="concrete">Бетон</option>
                <option value="brick">Кирпич</option>
                <option value="aerated">Газоблок</option>
                <option value="drywall">ГКЛ</option>
              </select>
            </label>
          </div>

          <div class="p21-3-panel">
            <div class="p21-3-label">Высота от пола (см)</div>
            <div class="p21-3-pills p21-3-pills-4">
              <button type="button" data-p21-3-height="30">30</button>
              <button type="button" data-p21-3-height="90">90</button>
              <button type="button" data-p21-3-height="110">110</button>
              <button type="button" data-p21-3-custom-btn>Своя</button>
            </div>
            <input id="p21-3-custom-height" class="p21-3-custom hidden" type="number" min="0" placeholder="Своя высота, см">
          </div>

          <div class="p21-3-panel">
            <div class="p21-3-label">Постов в рамке (всего мест)</div>
            <div class="p21-3-pills p21-3-pills-5">
              <button type="button" data-p21-3-post="1">1</button>
              <button type="button" data-p21-3-post="2">2</button>
              <button type="button" data-p21-3-post="3">3</button>
              <button type="button" data-p21-3-post="4">4</button>
              <button type="button" data-p21-3-post="5">5</button>
            </div>
          </div>

          <div class="p21-3-counter-box">
            ${counterRow("🔌", "Розетки 220В", "sockets")}
            ${counterRow("💡", "Выключатели", "switches")}
            ${counterRow("↩️", "Проходные (Марш)", "pass")}
            ${counterRow("🔀", "Перекрёстные", "cross")}
            ${counterRow("📺", "ТВ / Интернет", "tv")}
            ${counterRow("🌡️", "Регулятор (т. Пол)", "floorReg", true)}
          </div>

          <div class="p21-3-frames-row">
            <div>
              <b>Кол-во таких рамок:</b>
              <span id="p21-3-summary">Высота ${state.height}см | ${state.framePosts} пост.</span>
            </div>
            <div class="p21-3-inline-counter">
              <button type="button" data-p21-3-dec="framesQty">-</button>
              <strong data-p21-3-count="framesQty">${state.framesQty}</strong>
              <button type="button" data-p21-3-inc="framesQty">+</button>
            </div>
          </div>

          <div class="p21-3-details-grid">
            <label>
              <span>Помещение</span>
              <input id="p21-3-room" value="${esc(state.room)}">
            </label>
            <label>
              <span>Кабель на рамку, м</span>
              <input id="p21-3-cable" type="number" min="0" value="${Number(state.cableM || 0)}">
            </label>
            <label>
              <span>Штроба на рамку, м</span>
              <input id="p21-3-strobe" type="number" min="0" value="${Number(state.strobeM || 0)}">
            </label>
          </div>

          <button class="p21-3-add" type="button" data-p21-3-add>🧱 Добавить в Пул</button>
        </section>

        <button class="p21-3-calc" type="button" data-p21-3-build>⚡ Рассчитать черновую (быстро по пулу)</button>

        <section class="p21-3-card p21-3-list-card">
          <div class="p21-3-list-title">
            <h3>Пул</h3>
            <button type="button" data-pool-v21-clear>Очистить</button>
          </div>
          <div id="p21-groups" class="p21-3-list"></div>
        </section>

        <section class="p21-3-card p21-3-list-card">
          <div class="p21-3-list-title">
            <h3>Черновик расчёта</h3>
            <button type="button" data-pool-v21-resolve>Подобрать из БД</button>
          </div>
          <div id="p21-draft" class="p21-3-list"></div>
          <button class="p21-3-add" type="button" data-pool-v21-estimate>Добавить результат в смету</button>
        </section>
      </div>
    `;

    const route = document.getElementById("p21-3-route");
    const wall = document.getElementById("p21-3-wall");
    if (route) route.value = state.route;
    if (wall) wall.value = state.wall;

    renderCounters();
  }

  function counterRow(icon, title, key, danger = false) {
    return `
      <div class="p21-3-counter-row ${danger ? "danger" : ""}">
        <div class="p21-3-counter-title"><span>${icon}</span><b>${title}</b></div>
        <div class="p21-3-inline-counter">
          <button type="button" data-p21-3-dec="${key}">-</button>
          <strong data-p21-3-count="${key}">${counterValue(key)}</strong>
          <button type="button" data-p21-3-inc="${key}">+</button>
        </div>
      </div>
    `;
  }

  function syncInputsToState() {
    state.route = document.getElementById("p21-3-route")?.value || state.route;
    state.wall = document.getElementById("p21-3-wall")?.value || state.wall;
    state.room = document.getElementById("p21-3-room")?.value || state.room;
    state.cableM = Number(document.getElementById("p21-3-cable")?.value || state.cableM || 0);
    state.strobeM = Number(document.getElementById("p21-3-strobe")?.value || state.strobeM || 0);

    const custom = document.getElementById("p21-3-custom-height");
    if (custom && !custom.classList.contains("hidden") && custom.value) {
      state.height = Number(custom.value || state.height);
    }

    saveUiState();
  }

  function addFrameToPool() {
    syncInputsToState();

    const mechanisms = totalMechanisms();
    if (mechanisms <= 0) {
      toast("Добавь хотя бы один механизм.");
      return;
    }

    if (Number(state.framePosts || 1) < mechanisms) {
      state.framePosts = autoPosts();
      toast("Постов в рамке меньше механизмов. Поставил " + state.framePosts + ".");
    }

    const g = {
      id: "g_" + Date.now() + "_" + Math.random().toString(16).slice(2),
      room: state.room || "Комната",
      name: `Высота ${state.height}см | ${state.framePosts} пост.`,
      qty: Math.max(1, Number(state.framesQty || 1)),
      cableM: Number(state.cableM || 0),
      strobeM: Number(state.strobeM || 0),
      reserve: 10,
      sockets: Number(state.sockets || 0),
      switches: Number(state.switches || 0),
      pass: Number(state.pass || 0),
      cross: Number(state.cross || 0),
      tv: Number(state.tv || 0),
      thermostat: Number(state.floorReg || 0),
      wall: labels.wallText[state.wall] || "бетон",
      mount: "hidden",
      podType: state.wall === "drywall" ? "gkl" : "standard",
      boxes: 0,
      wago: 0,
      gml: 0,
      shrink: 0,
      meta: {
        route: state.route,
        routeLabel: labels.route[state.route],
        height: state.height,
        framePosts: state.framePosts
      }
    };

    if (!window.PoolV21) {
      alert("PoolV21 не найден. Сначала нужен V21.1.");
      return;
    }

    window.PoolV21.groups ||= [];
    window.PoolV21.groups.push(g);
    window.PoolV21.save?.();
    window.PoolV21.renderGroups?.();

    renderGroupsV213();
    toast("Добавлено в пул");
    diag("ok", "pool-frame-added", "Рамка добавлена в пул.");
  }

  function renderGroupsV213() {
    const box = document.getElementById("p21-groups");
    if (!box || !window.PoolV21) return;

    const groups = window.PoolV21.groups || [];
    if (!groups.length) {
      box.innerHTML = `<div class="p21-3-empty">Пул пока пуст.</div>`;
      return;
    }

    box.innerHTML = groups.map(g => {
      const total = (Number(g.sockets||0) + Number(g.switches||0) + Number(g.pass||0) + Number(g.cross||0) + Number(g.tv||0) + Number(g.thermostat||0)) * Number(g.qty||1);
      return `
        <div class="p21-3-pool-item">
          <div>
            <b>${esc(g.room)} · ${esc(g.name)}</b>
            <p>${g.qty} рам. · механизмов ${total} · кабель ${Number(g.cableM||0) * Number(g.qty||1)}м · штроба ${Number(g.strobeM||0) * Number(g.qty||1)}м</p>
            <small>${esc(g.meta?.routeLabel || "")} · ${esc(g.wall)} · ${g.meta?.height || ""}см</small>
          </div>
          <button type="button" data-pool-v21-remove="${esc(g.id)}">×</button>
        </div>
      `;
    }).join("");
  }

  function renderDraftV213() {
    if (window.PoolV21?.renderDraft) {
      window.PoolV21.renderDraft();
    }
  }

  function patchPool() {
    if (!window.PoolV21 || window.PoolV21.__v213Patched) return false;

    const oldOpen = window.PoolV21.open?.bind(window.PoolV21);
    window.PoolV21.open = function () {
      loadUiState();
      window.PoolV21.load?.();
      window.PoolV21.ensureScreen?.();
      document.getElementById("ep-pool-v21-screen")?.classList.remove("hidden");
      renderScreen();
      renderGroupsV213();
      renderDraftV213();
      diag("ok", "pool-v21-3-opened", "Пул V21.3 открыт.");
    };

    window.PoolV21.ensureScreen = function () {
      if (document.getElementById("ep-pool-v21-screen")) return;
      const screen = document.createElement("div");
      screen.id = "ep-pool-v21-screen";
      screen.className = "ep-pool-v21 hidden";
      document.body.appendChild(screen);
    };

    const oldRenderGroups = window.PoolV21.renderGroups?.bind(window.PoolV21);
    window.PoolV21.renderGroups = function () {
      renderGroupsV213();
      if (!document.getElementById("p21-groups") && oldRenderGroups) oldRenderGroups();
    };

    const oldRenderDraft = window.PoolV21.renderDraft?.bind(window.PoolV21);
    window.PoolV21.renderDraft = function () {
      const box = document.getElementById("p21-draft");
      const draft = window.PoolV21.draft || [];

      if (!box) {
        if (oldRenderDraft) oldRenderDraft();
        return;
      }

      if (!draft.length) {
        box.innerHTML = `<div class="p21-3-empty">Черновик пока пуст.</div>`;
        return;
      }

      let total = 0;
      box.innerHTML = draft.map(item => {
        const sum = Number(item.price || 0) * Number(item.qty || 0);
        total += sum;
        return `
          <div class="p21-3-draft-item ${item.missingDb ? "missing" : ""}">
            <div>
              <b>${esc(item.name)}</b>
              <p>${item.type === "work" ? "Работа" : "Материал"} · ${item.qty} ${esc(item.unit || "шт")}</p>
              <small>${item.dbName ? "БД: " + esc(item.dbName) : "Не подобрано из БД"}</small>
            </div>
            <div>
              <strong>${Math.round(Number(item.price || 0)).toLocaleString("ru-RU")} ₽</strong>
              <small>${Math.round(sum).toLocaleString("ru-RU")} ₽</small>
            </div>
          </div>
        `;
      }).join("") + `
        <div class="p21-3-total">
          <span>Итого</span>
          <b>${Math.round(total).toLocaleString("ru-RU")} ₽</b>
        </div>
      `;
    };

    window.PoolV21.__v213Patched = true;
    return true;
  }

  function bind() {
    document.addEventListener("click", event => {
      const inc = event.target.closest("[data-p21-3-inc]");
      if (inc) {
        event.preventDefault();
        changeCounter(inc.dataset.p21_3Inc || inc.getAttribute("data-p21-3-inc"), 1);
        return;
      }

      const dec = event.target.closest("[data-p21-3-dec]");
      if (dec) {
        event.preventDefault();
        const key = dec.dataset.p21_3Dec || dec.getAttribute("data-p21-3-dec");
        if (key === "framesQty") {
          state.framesQty = Math.max(1, Number(state.framesQty || 1) - 1);
          renderCounters();
        } else {
          changeCounter(key, -1);
        }
        return;
      }

      const height = event.target.closest("[data-p21-3-height]");
      if (height) {
        event.preventDefault();
        state.height = Number(height.dataset.p21_3Height || height.getAttribute("data-p21-3-height"));
        document.getElementById("p21-3-custom-height")?.classList.add("hidden");
        renderCounters();
        return;
      }

      const customBtn = event.target.closest("[data-p21-3-custom-btn]");
      if (customBtn) {
        event.preventDefault();
        const input = document.getElementById("p21-3-custom-height");
        input?.classList.toggle("hidden");
        input?.focus();
        return;
      }

      const post = event.target.closest("[data-p21-3-post]");
      if (post) {
        event.preventDefault();
        state.framePosts = Number(post.dataset.p21_3Post || post.getAttribute("data-p21-3-post"));
        renderCounters();
        return;
      }

      if (event.target.closest("[data-p21-3-add]")) {
        event.preventDefault();
        addFrameToPool();
        return;
      }

      if (event.target.closest("[data-p21-3-build]")) {
        event.preventDefault();
        syncInputsToState();
        window.PoolV21?.buildDraft?.();
        window.PoolV21?.resolveDraft?.();
        return;
      }
    }, true);

    document.addEventListener("change", event => {
      if (event.target?.id === "p21-3-route" || event.target?.id === "p21-3-wall") {
        syncInputsToState();
      }
    });

    document.addEventListener("input", event => {
      if (event.target?.id === "p21-3-custom-height") {
        state.height = Number(event.target.value || state.height || 0);
        renderCounters();
      }
    });
  }

  function init() {
    loadUiState();
    bind();

    const tryPatch = () => {
      if (patchPool()) {
        diag("ok", "pool-v21-3-ready", "UI рамок V21.3 подключён.");
      }
    };

    tryPatch();
    setTimeout(tryPatch, 700);
    setTimeout(tryPatch, 1800);

    window.PoolV213FrameUI = {
      state,
      renderScreen,
      addFrameToPool,
      patchPool
    };
  }

  window.addEventListener("DOMContentLoaded", init);
})();
