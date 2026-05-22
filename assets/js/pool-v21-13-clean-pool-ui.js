(function () {
  const FILE = "assets/js/pool-v21-13-clean-pool-ui.js";
  const VERSION = "V21.13";

  const KEYS = ["sockets", "switches", "pass", "cross", "tv", "floorReg"];
  const DEF = {
    route: "ceiling",
    wall: "concrete",
    ceilingHeight: 270,
    height: 30,
    framePosts: 1,
    sockets: 0,
    switches: 1,
    pass: 0,
    cross: 0,
    tv: 0,
    floorReg: 0,
    framesQty: 1,
    switchKeys: 1,
    passKeys: 1
  };

  const DEFAULT_LOGIC = {
    ordinaryBoxDepthMin: 40,
    ordinaryBoxDepthMax: 50,
    deepBoxDepthMin: 60,
    deepBoxDepthMax: 75,
    strobeJunction: "20x30",
    strobeInBoxes: "30x30",
    strobeCeilingThermostat: "20x25",
    strobeFloorThermostat: "50x40",
    connectionMode: "junction_boxes",
    junctionSocketsPerDrop: 1,
    junctionSwitchesPerDrop: 1,
    heatShrinkType: "12/4",
    heatShrinkCmPerJoint: 5
  };

  const ROUTES = [
    ["ceiling", "По потолку"],
    ["floor", "По полу"]
  ];

  const WALLS = [
    ["concrete", "Бетон", "бетон"],
    ["panel", "Панелька", "панель"],
    ["soft", "Мягкий", "мягкий"],
    ["brick", "Кирпич", "кирпич"]
  ];

  let state = { ...DEF };
  let logic = { ...DEFAULT_LOGIC };
  let editorOpen = false;

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;

  function diag(level, code, message) {
    const payload = { file: FILE, module: "PoolV2113CleanPoolUI", functionName: "runtime", place: "pool", code, message };
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
    if (window.PoolV21?.toast) return window.PoolV21.toast(text);
    let box = document.getElementById("ep-pool-v21-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-pool-v21-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__p2113toast);
    window.__p2113toast = setTimeout(() => box.classList.remove("show"), 1500);
  }

  function load() {
    try { state = { ...DEF, ...JSON.parse(localStorage.getItem("ep_pool_v21_13_state") || "{}") }; }
    catch { state = { ...DEF }; }

    try { logic = { ...DEFAULT_LOGIC, ...JSON.parse(localStorage.getItem("ep_pool_v21_13_logic") || "{}") }; }
    catch { logic = { ...DEFAULT_LOGIC }; }

    try { editorOpen = localStorage.getItem("ep_pool_v21_13_editor_open") === "1"; }
    catch { editorOpen = false; }

    normalize(false);
  }

  function save() {
    try { localStorage.setItem("ep_pool_v21_13_state", JSON.stringify(state)); } catch {}
    try { localStorage.setItem("ep_pool_v21_13_logic", JSON.stringify(logic)); } catch {}
    try { localStorage.setItem("ep_pool_v21_13_editor_open", editorOpen ? "1" : "0"); } catch {}
  }

  function total() {
    return KEYS.reduce((s, k) => s + Math.max(0, n(state[k], 0)), 0);
  }

  function normalize(doSound = false) {
    KEYS.forEach(k => state[k] = Math.max(0, n(state[k], 0)));
    state.framesQty = Math.max(1, n(state.framesQty, 1));
    state.switchKeys = Math.max(1, Math.min(3, n(state.switchKeys, 1)));
    state.passKeys = Math.max(1, Math.min(3, n(state.passKeys, 1)));
    state.ceilingHeight = Math.max(180, n(state.ceilingHeight, 270));
    state.height = Math.max(0, n(state.height, 30));

    const t = total();
    if (t === 0) state.framePosts = 1;
    else {
      state.framePosts = Math.max(1, Math.min(6, n(state.framePosts, 1)));
      if (state.framePosts < t) state.framePosts = t;
    }

    state.framePosts = Math.max(1, Math.min(6, n(state.framePosts, 1)));
    if (doSound) sound();
    save();
  }

  const routeLabel = c => (ROUTES.find(x => x[0] === c) || ROUTES[0])[1];
  const wallDb = c => (WALLS.find(x => x[0] === c) || WALLS[0])[2];
  const money = v => Math.round(n(v, 0)).toLocaleString("ru-RU") + " ₽";

  function ensureScreen() {
    let el = document.getElementById("ep-pool-v21-screen");
    if (!el) {
      el = document.createElement("div");
      el.id = "ep-pool-v21-screen";
      el.className = "ep-pool-v21 hidden";
      document.body.appendChild(el);
    }
    return el;
  }

  function summary() {
    return `${n(state.height, 30)}см · ${n(state.framePosts, 1)} пост. · ${total()}/6 · ${routeLabel(state.route)} · потолок ${n(state.ceilingHeight, 270)}см`;
  }

  function counter(icon, title, key, withKeys = false, keyKind = "") {
    return `
      <div class="p2113-counter-row ${withKeys ? "has-keys" : ""}">
        <div class="p2113-counter-title"><span>${icon}</span><b>${title}</b></div>
        <div class="p2113-mini-counter">
          <button type="button" data-p2113-dec="${key}">-</button>
          <strong data-p2113-count="${key}">${n(state[key], 0)}</strong>
          <button type="button" data-p2113-inc="${key}">+</button>
        </div>
        ${withKeys ? keySelector(keyKind) : ""}
      </div>
    `;
  }

  function keySelector(kind) {
    const current = kind === "switch" ? state.switchKeys : state.passKeys;
    return `
      <div class="p2113-key-selector">
        <span>Клавиши</span>
        ${[1,2,3].map(v => `<button type="button" data-p2113-key="${kind}" data-value="${v}" class="${current === v ? "is-selected" : ""}">${v}кл</button>`).join("")}
      </div>
    `;
  }

  function logicField(key, label, type = "text") {
    return `
      <label>
        <span>${label}</span>
        <input data-p2113-logic="${key}" type="${type}" value="${esc(logic[key])}">
      </label>
    `;
  }

  function logicEditor() {
    return `
      <section class="p2113-card p2113-logic-card">
        <button type="button" class="p2113-logic-toggle" data-p2113-editor-toggle>
          ${editorOpen ? "Скрыть редактор" : "Изменить логику"}
        </button>

        <div class="p2113-logic-body ${editorOpen ? "" : "hidden"}" data-p2113-editor-body>
          <div class="p2113-grid">
            ${logicField("ordinaryBoxDepthMin", "Обыч. от", "number")}
            ${logicField("ordinaryBoxDepthMax", "Обыч. до", "number")}
            ${logicField("deepBoxDepthMin", "Глуб. от", "number")}
            ${logicField("deepBoxDepthMax", "Глуб. до", "number")}
            ${logicField("strobeJunction", "Штр. распайка")}
            ${logicField("strobeInBoxes", "Штр. подроз.")}
            ${logicField("strobeCeilingThermostat", "Т.п. сверху")}
            ${logicField("strobeFloorThermostat", "Т.п. вниз")}
            ${logicField("junctionSocketsPerDrop", "Расп. роз.", "number")}
            ${logicField("junctionSwitchesPerDrop", "Расп. выкл.", "number")}
            ${logicField("heatShrinkType", "Термоус.")}
            ${logicField("heatShrinkCmPerJoint", "См/соед.", "number")}
          </div>

          <div class="p2113-mode">
            <button type="button" data-p2113-mode="in_boxes" class="${logic.connectionMode === "in_boxes" ? "is-selected" : ""}">
              В подрозетниках<br><small>мастер гинекологии</small>
            </button>
            <button type="button" data-p2113-mode="junction_boxes" class="${logic.connectionMode === "junction_boxes" ? "is-selected" : ""}">
              В распайках<br><small>проктолог</small>
            </button>
          </div>

          <p class="p2113-note">Следующий шаг — редактор шаблонов WAGO/ГМЛ/СИЗ и выбор позиций из БД.</p>
        </div>
      </section>
    `;
  }

  function render() {
    normalize(false);
    const el = ensureScreen();

    el.innerHTML = `
      <div class="p2113-head">
        <button class="p2113-back" type="button" data-p2113-close>←</button>
        <h2>Пул розеток / штроб</h2>
        <b>${VERSION}</b>
      </div>

      <div class="p2113-shell">
        <section class="p2113-card">
          <div class="p2113-route-row">
            <div>
              <span>Трассы (кабель)</span>
              <div class="p2113-buttons p2113-routes">
                ${ROUTES.map(([k,l]) => `<button type="button" data-p2113-route="${k}" class="${state.route === k ? "is-selected" : ""}">${l}</button>`).join("")}
              </div>
            </div>
            <label>
              <span>Высота потолка, см</span>
              <input data-p2113-input="ceilingHeight" type="number" min="180" value="${n(state.ceilingHeight,270)}">
            </label>
          </div>

          <div class="p2113-wall-block">
            <span>Стена (для штроб)</span>
            <div class="p2113-buttons p2113-walls">
              ${WALLS.map(([k,l]) => `<button type="button" data-p2113-wall="${k}" class="${state.wall === k ? "is-selected" : ""}">${l}</button>`).join("")}
            </div>
          </div>
        </section>

        ${logicEditor()}

        <section class="p2113-card">
          <div class="p2113-label">Высота от пола (см)</div>
          <div class="p2113-buttons p2113-heights">
            ${[30,90,110].map(v => `<button type="button" data-p2113-height="${v}" class="${n(state.height,30) === v ? "is-selected" : ""}">${v}</button>`).join("")}
            <button type="button" data-p2113-custom-height class="${[30,90,110].includes(n(state.height,30)) ? "" : "is-selected"}">Своя</button>
          </div>
          <input data-p2113-input="height" class="p2113-custom-height ${[30,90,110].includes(n(state.height,30)) ? "hidden" : ""}" type="number" min="0" value="${[30,90,110].includes(n(state.height,30)) ? "" : n(state.height,30)}">
        </section>

        <section class="p2113-card">
          <div class="p2113-label">Постов в рамке (всего мест)</div>
          <div class="p2113-buttons p2113-posts">
            ${[1,2,3,4,5,6].map(v => `<button type="button" data-p2113-post="${v}" class="${n(state.framePosts,1) === v ? "is-selected" : ""}">${v}</button>`).join("")}
          </div>
        </section>

        <section class="p2113-card p2113-counters">
          ${counter("🔌","Розетки 220В","sockets")}
          ${counter("💡","Выключатели","switches",true,"switch")}
          ${counter("↩️","Проходные (Марш)","pass",true,"pass")}
          ${counter("🔀","Перекрёстные","cross")}
          ${counter("📺","ТВ / Интернет","tv")}
          ${counter("🌡️","Регулятор (т. Пол)","floorReg")}
        </section>

        <section class="p2113-card">
          <div class="p2113-frames-row">
            <div><b>Кол-во таких рамок:</b><span data-p2113-summary>${summary()}</span></div>
            <div class="p2113-mini-counter">
              <button type="button" data-p2113-dec="framesQty">-</button>
              <strong data-p2113-count="framesQty">${state.framesQty}</strong>
              <button type="button" data-p2113-inc="framesQty">+</button>
            </div>
          </div>

          <button class="p2113-add" type="button" data-p2113-add>Добавить в пул</button>
        </section>

        <button class="p2113-calc" type="button" data-p2113-build>Рассчитать черновую</button>

        <section class="p2113-card">
          <div class="p2113-list-head"><h3>Пул</h3><button type="button" data-p2113-clear>Очистить</button></div>
          <div id="p2113-groups" class="p2113-list"></div>
        </section>

        <section class="p2113-card">
          <div class="p2113-list-head"><h3>Черновик расчёта</h3><button type="button" data-p2113-resolve>Подобрать из БД</button></div>
          <div id="p2113-draft" class="p2113-list"></div>
          <button class="p2113-add" type="button" data-p2113-estimate>Добавить результат в смету</button>
        </section>
      </div>
    `;

    renderGroups();
    renderDraft();
    setTimeout(focusGuards, 30);
  }

  function vals() {
    normalize(false);

    document.querySelectorAll("[data-p2113-count]").forEach(el => {
      const k = el.getAttribute("data-p2113-count");
      el.textContent = String(k === "framesQty" ? Math.max(1, n(state[k], 1)) : Math.max(0, n(state[k], 0)));
    });

    document.querySelectorAll("[data-p2113-post]").forEach(b => b.classList.toggle("is-selected", n(b.getAttribute("data-p2113-post"), 0) === n(state.framePosts, 1)));
    document.querySelectorAll("[data-p2113-height]").forEach(b => b.classList.toggle("is-selected", n(b.getAttribute("data-p2113-height"), 0) === n(state.height, 30)));
    document.querySelectorAll("[data-p2113-route]").forEach(b => b.classList.toggle("is-selected", b.getAttribute("data-p2113-route") === state.route));
    document.querySelectorAll("[data-p2113-wall]").forEach(b => b.classList.toggle("is-selected", b.getAttribute("data-p2113-wall") === state.wall));
    document.querySelectorAll("[data-p2113-key='switch']").forEach(b => b.classList.toggle("is-selected", n(b.getAttribute("data-value"), 1) === n(state.switchKeys, 1)));
    document.querySelectorAll("[data-p2113-key='pass']").forEach(b => b.classList.toggle("is-selected", n(b.getAttribute("data-value"), 1) === n(state.passKeys, 1)));

    document.querySelectorAll("[data-p2113-mode]").forEach(b => b.classList.toggle("is-selected", b.getAttribute("data-p2113-mode") === logic.connectionMode));

    const sum = document.querySelector("[data-p2113-summary]");
    if (sum) sum.textContent = summary();

    const body = document.querySelector("[data-p2113-editor-body]");
    const toggle = document.querySelector("[data-p2113-editor-toggle]");
    if (body) body.classList.toggle("hidden", !editorOpen);
    if (toggle) toggle.textContent = editorOpen ? "Скрыть редактор" : "Изменить логику";

    save();
  }

  function syncInputs() {
    document.querySelectorAll("[data-p2113-input]").forEach(input => {
      const key = input.getAttribute("data-p2113-input");
      if (key === "ceilingHeight") state.ceilingHeight = n(input.value, 270);
      if (key === "height" && !input.classList.contains("hidden") && input.value) state.height = n(input.value, state.height);
    });

    document.querySelectorAll("[data-p2113-logic]").forEach(input => {
      const key = input.getAttribute("data-p2113-logic");
      logic[key] = input.type === "number" ? n(input.value, 0) : input.value;
    });

    normalize(false);
  }

  function inc(k) {
    syncInputs();
    if (k === "framesQty") { state.framesQty = Math.max(1, n(state.framesQty,1) + 1); sound(); vals(); return; }
    if (!KEYS.includes(k)) return;
    if (total() >= 6) { sound("error"); toast("В одной рамке максимум 6 механизмов."); vals(); return; }
    state[k] = n(state[k], 0) + 1;
    state.framePosts = Math.max(n(state.framePosts, 1), total());
    sound();
    vals();
  }

  function dec(k) {
    syncInputs();
    if (k === "framesQty") { state.framesQty = Math.max(1, n(state.framesQty,1) - 1); sound(); vals(); return; }
    if (!KEYS.includes(k)) return;
    state[k] = Math.max(0, n(state[k], 0) - 1);
    const t = total();
    state.framePosts = t === 0 ? 1 : Math.min(n(state.framePosts, 1), t);
    sound();
    vals();
  }

  function setPost(v) {
    syncInputs();
    const next = Math.max(1, Math.min(6, n(v, 1)));
    const t = total();
    if (t > 0 && next < t) { state.framePosts = t; sound("error"); toast(`Нельзя меньше ${t}: в рамке ${t} механизмов.`); }
    else { state.framePosts = next; sound(); }
    vals();
  }

  function setHeight(v) { syncInputs(); state.height = Math.max(0, n(v, 30)); sound(); vals(); }
  function setRoute(v) { syncInputs(); state.route = v === "floor" ? "floor" : "ceiling"; sound(); vals(); }
  function setWall(v) { syncInputs(); state.wall = WALLS.some(x => x[0] === v) ? v : "concrete"; sound(); vals(); }

  function resetFrame() {
    const keep = { route: state.route, wall: state.wall, ceilingHeight: state.ceilingHeight };
    state = { ...DEF, ...keep };
    save();
    render();
  }

  function addFrame() {
    syncInputs();
    const t = total();
    if (t <= 0) { sound("error"); toast("Добавь хотя бы один механизм."); return; }
    if (!window.PoolV21) { sound("error"); alert("PoolV21 не найден."); return; }
    if (state.framePosts < t) state.framePosts = t;

    const g = {
      id: "g_" + Date.now() + "_" + Math.random().toString(16).slice(2),
      room: "Комната",
      name: `Высота ${state.height}см | ${state.framePosts} пост.`,
      qty: Math.max(1, n(state.framesQty, 1)),
      cableM: 0,
      strobeM: 0,
      reserve: 10,
      sockets: n(state.sockets,0),
      switches: n(state.switches,0),
      pass: n(state.pass,0),
      cross: n(state.cross,0),
      tv: n(state.tv,0),
      thermostat: n(state.floorReg,0),
      wall: wallDb(state.wall),
      mount: "hidden",
      podType: "standard",
      boxes: 0,
      wago: 0,
      gml: 0,
      shrink: 0,
      meta: {
        route: state.route,
        routeLabel: routeLabel(state.route),
        height: n(state.height,30),
        ceilingHeight: n(state.ceilingHeight,270),
        framePosts: n(state.framePosts,1),
        switchKeys: n(state.switchKeys,1),
        passKeys: n(state.passKeys,1)
      }
    };

    window.PoolV21.groups ||= [];
    window.PoolV21.groups.push(g);
    window.PoolV21.save?.();
    renderGroups();
    resetFrame();
    sound("success");
    toast("Добавлено в пул.");
  }

  function addStrobe(map, size, meters, wall) {
    meters = Math.max(0, n(meters, 0));
    if (!meters) return;
    const key = `${size}|${wall || "бетон"}`;
    map[key] = (map[key] || 0) + meters;
  }

  function toCeiling(ceiling, height) { return Math.max(0, (n(ceiling,270) - n(height,30)) / 100); }
  function toFloor(height) { return Math.max(0, n(height,30) / 100); }

  function buildDraft() {
    if (!window.PoolV21) return;
    const result = { strobe: {}, ordinary: 0, deep: 0, junction: 0, connectors: {}, shrink: 0 };

    (window.PoolV21.groups || []).forEach(g => {
      const qty = Math.max(1, n(g.qty,1));
      const height = n(g.meta?.height,30);
      const ceiling = n(g.meta?.ceilingHeight,270);
      const route = g.meta?.route || "ceiling";
      const wall = g.wall || "бетон";
      const ordinarySize = logic.connectionMode === "in_boxes" ? logic.strobeInBoxes : logic.strobeJunction;
      const sockets = n(g.sockets,0), switches = n(g.switches,0), pass = n(g.pass,0), cross = n(g.cross,0), tv = n(g.tv,0), thermostat = n(g.thermostat,0);

      result.ordinary += sockets * qty;
      result.deep += (switches + pass + cross + tv + thermostat) * qty;

      if (sockets > 0) addStrobe(result.strobe, ordinarySize, (route === "floor" ? toFloor(height) : toCeiling(ceiling,height)) * qty, wall);
      if ((switches + pass + cross) > 0) addStrobe(result.strobe, ordinarySize, toCeiling(ceiling,height) * qty, wall);
      if (thermostat > 0) {
        if (route === "ceiling") addStrobe(result.strobe, logic.strobeCeilingThermostat, toCeiling(ceiling,height) * qty, wall);
        addStrobe(result.strobe, logic.strobeFloorThermostat, toFloor(height) * qty, wall);
      }
      if (tv > 0) addStrobe(result.strobe, ordinarySize, (route === "floor" ? toFloor(height) : toCeiling(ceiling,height)) * qty, wall);

      if (logic.connectionMode === "junction_boxes") {
        if (sockets > 0) result.junction += n(logic.junctionSocketsPerDrop,1) * qty;
        if ((switches + pass + cross) > 0) result.junction += n(logic.junctionSwitchesPerDrop,1) * qty;
      }
    });

    const draft = [];
    Object.entries(result.strobe).forEach(([key, meters]) => {
      const [size, wall] = key.split("|");
      draft.push(raw("work", `Штробление ${size} ${wall}`, round2(meters), "м", ["штробление", size, wall]));
    });

    if (result.ordinary > 0) {
      draft.push(raw("material", `Подрозетник ${logic.ordinaryBoxDepthMin}-${logic.ordinaryBoxDepthMax} мм`, result.ordinary, "шт", ["подрозетник", `${logic.ordinaryBoxDepthMin}`, `${logic.ordinaryBoxDepthMax}`]));
      draft.push(raw("work", "Высверливание подрозетников обычных", result.ordinary, "шт", ["высверливание подрозетник"]));
    }

    if (result.deep > 0) {
      draft.push(raw("material", `Подрозетник глубокий ${logic.deepBoxDepthMin}-${logic.deepBoxDepthMax} мм`, result.deep, "шт", ["подрозетник глубокий", `${logic.deepBoxDepthMin}`, `${logic.deepBoxDepthMax}`]));
      draft.push(raw("work", "Высверливание подрозетников глубоких", result.deep, "шт", ["высверливание подрозетник глубокий"]));
    }

    if (result.junction > 0) {
      draft.push(raw("material", "Распаячная коробка", result.junction, "шт", ["распаячная коробка"]));
      draft.push(raw("work", "Монтаж распаячной коробки", result.junction, "шт", ["монтаж распаячная коробка"]));
    }

    window.PoolV21.draft = draft;
    window.PoolV21.save?.();
    renderDraft();
    toast("Черновик собран.");
    sound("success");
  }

  function raw(type, name, qty, unit, query) {
    return { id: "p2113_" + Math.random().toString(16).slice(2), type, name, qty, unit, price: 0, dbName: "", dbItemId: "", missingDb: false, query };
  }

  function round2(v) { return Math.round(n(v,0) * 100) / 100; }

  function renderGroups() {
    const box = document.getElementById("p2113-groups");
    if (!box || !window.PoolV21) return;
    const groups = window.PoolV21.groups || [];
    if (!groups.length) { box.innerHTML = `<div class="p2113-empty">Пул пока пуст.</div>`; return; }

    box.innerHTML = groups.map(g => {
      const t = (n(g.sockets,0) + n(g.switches,0) + n(g.pass,0) + n(g.cross,0) + n(g.tv,0) + n(g.thermostat,0)) * n(g.qty,1);
      return `<div class="p2113-item">
        <div><b>${esc(g.room)} · ${esc(g.name)}</b><p>${n(g.qty,1)} рам. · механизмов ${t}</p><small>${esc(g.meta?.routeLabel || "")} · ${esc(g.wall)} · потолок ${esc(g.meta?.ceilingHeight || "—")}см</small></div>
        <button type="button" data-p2113-remove="${esc(g.id)}">×</button>
      </div>`;
    }).join("");
  }

  function renderDraft() {
    const box = document.getElementById("p2113-draft");
    if (!box || !window.PoolV21) return;
    const draft = window.PoolV21.draft || [];
    if (!draft.length) { box.innerHTML = `<div class="p2113-empty">Черновик пока пуст.</div>`; return; }

    let totalSum = 0;
    box.innerHTML = draft.map(i => {
      const sum = n(i.price,0) * n(i.qty,0);
      totalSum += sum;
      return `<div class="p2113-draft ${i.missingDb ? "missing" : ""}">
        <div><b>${esc(i.name)}</b><p>${i.type === "work" ? "Работа" : "Материал"} · ${n(i.qty,0)} ${esc(i.unit || "шт")}</p><small>${i.dbName ? "БД: " + esc(i.dbName) : "Не подобрано из БД"}</small></div>
        <div><strong>${money(i.price)}</strong><small>${money(sum)}</small></div>
      </div>`;
    }).join("") + `<div class="p2113-total"><span>Итого</span><b>${money(totalSum)}</b></div>`;
  }

  function removeGroup(id) {
    if (!window.PoolV21) return;
    window.PoolV21.groups = (window.PoolV21.groups || []).filter(g => g.id !== id);
    window.PoolV21.save?.();
    renderGroups();
    buildDraft();
    sound("success");
    toast("Строка удалена.");
  }

  function clearPool() {
    if (!window.PoolV21) return;
    if (!confirm("Очистить пул?")) return;
    window.PoolV21.groups = [];
    window.PoolV21.draft = [];
    window.PoolV21.save?.();
    renderGroups();
    renderDraft();
    sound("success");
    toast("Пул очищен.");
  }

  async function resolveDraft() {
    if (!window.PoolV21) return;
    if (!window.PoolV21.draft?.length) buildDraft();
    await window.PoolV21.resolveDraft?.();
    renderDraft();
    sound("success");
  }

  function bind() {
    document.addEventListener("click", event => {
      const root = event.target.closest("#ep-pool-v21-screen");
      if (!root) return;

      // Важно: input не должен запускать никакие toggle/перерисовки.
      if (event.target.closest("input, textarea, select")) return;

      let el;
      if (el = event.target.closest("[data-p2113-close]")) { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
      if (el = event.target.closest("[data-p2113-editor-toggle]")) { event.preventDefault(); event.stopImmediatePropagation(); editorOpen = !editorOpen; sound(); vals(); return; }
      if (el = event.target.closest("[data-p2113-inc]")) { event.preventDefault(); event.stopImmediatePropagation(); inc(el.getAttribute("data-p2113-inc")); return; }
      if (el = event.target.closest("[data-p2113-dec]")) { event.preventDefault(); event.stopImmediatePropagation(); dec(el.getAttribute("data-p2113-dec")); return; }
      if (el = event.target.closest("[data-p2113-post]")) { event.preventDefault(); event.stopImmediatePropagation(); setPost(el.getAttribute("data-p2113-post")); return; }
      if (el = event.target.closest("[data-p2113-height]")) { event.preventDefault(); event.stopImmediatePropagation(); setHeight(el.getAttribute("data-p2113-height")); return; }
      if (el = event.target.closest("[data-p2113-custom-height]")) { event.preventDefault(); event.stopImmediatePropagation(); document.querySelector("[data-p2113-input='height']")?.classList.toggle("hidden"); sound(); vals(); return; }
      if (el = event.target.closest("[data-p2113-route]")) { event.preventDefault(); event.stopImmediatePropagation(); setRoute(el.getAttribute("data-p2113-route")); return; }
      if (el = event.target.closest("[data-p2113-wall]")) { event.preventDefault(); event.stopImmediatePropagation(); setWall(el.getAttribute("data-p2113-wall")); return; }
      if (el = event.target.closest("[data-p2113-key]")) { event.preventDefault(); event.stopImmediatePropagation(); const kind = el.getAttribute("data-p2113-key"); if (kind === "switch") state.switchKeys = n(el.getAttribute("data-value"),1); if (kind === "pass") state.passKeys = n(el.getAttribute("data-value"),1); sound(); vals(); return; }
      if (el = event.target.closest("[data-p2113-mode]")) { event.preventDefault(); event.stopImmediatePropagation(); logic.connectionMode = el.getAttribute("data-p2113-mode"); sound(); vals(); return; }
      if (event.target.closest("[data-p2113-add]")) { event.preventDefault(); event.stopImmediatePropagation(); addFrame(); return; }
      if (event.target.closest("[data-p2113-build]")) { event.preventDefault(); event.stopImmediatePropagation(); syncInputs(); buildDraft(); return; }
      if (event.target.closest("[data-p2113-resolve]")) { event.preventDefault(); event.stopImmediatePropagation(); syncInputs(); resolveDraft(); return; }
      if (event.target.closest("[data-p2113-estimate]")) { event.preventDefault(); event.stopImmediatePropagation(); window.PoolV21?.addToEstimate?.(); sound("success"); return; }
      if (event.target.closest("[data-p2113-clear]")) { event.preventDefault(); event.stopImmediatePropagation(); clearPool(); return; }
      if (el = event.target.closest("[data-p2113-remove]")) { event.preventDefault(); event.stopImmediatePropagation(); removeGroup(el.getAttribute("data-p2113-remove")); return; }
    }, true);

    document.addEventListener("input", event => {
      if (!event.target.closest("#ep-pool-v21-screen")) return;
      if (event.target.closest("[data-p2113-input], [data-p2113-logic]")) {
        syncInputs();
        save();
      }
    }, true);
  }

  function focusGuards() {
    document.querySelectorAll("#ep-pool-v21-screen input, #ep-pool-v21-screen textarea, #ep-pool-v21-screen select").forEach(input => {
      if (input.dataset.p2113FocusGuard === "1") return;
      input.dataset.p2113FocusGuard = "1";
      ["pointerdown","touchstart","mousedown","click"].forEach(type => {
        input.addEventListener(type, ev => ev.stopPropagation(), true);
      });
      input.addEventListener("focus", () => { if (input.closest("[data-p2113-editor-body]")) { editorOpen = true; vals(); } }, true);
    });
  }

  function open() {
    load();
    window.PoolV21?.load?.();
    ensureScreen().classList.remove("hidden");
    render();
    diag("ok", "pool-v21-13-opened", "Пул V21.13 открыт чистым UI.");
  }

  function close() {
    syncInputs();
    ensureScreen().classList.add("hidden");
    save();
    window.PoolV21?.save?.();
    sound();
  }

  function patchPool() {
    if (!window.PoolV21 || window.PoolV21.__v2113CleanPatched) return false;
    window.PoolV21.open = open;
    window.PoolV21.ensureScreen = ensureScreen;
    window.PoolV21.renderGroups = renderGroups;
    window.PoolV21.renderDraft = renderDraft;
    window.PoolV21.buildDraft = buildDraft;
    window.PoolV21.clear = clearPool;
    window.PoolV21.__v2113CleanPatched = true;
    return true;
  }

  function updateBadges() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch {}
  }

  function init() {
    bind();
    const boot = () => { patchPool(); updateBadges(); };
    boot();
    setTimeout(boot, 700);
    setTimeout(boot, 1800);
    setTimeout(boot, 3500);

    window.PoolV2113CleanPoolUI = { open, close, render, state: () => ({...state}), logic: () => ({...logic}) };
    diag("ok", "pool-v21-13-ready", "Pool V21.13 clean UI ready.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
