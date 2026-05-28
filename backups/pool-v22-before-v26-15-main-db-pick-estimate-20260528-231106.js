

/* =========================================================
   MERGED INTO POOL V22.7 MONOLITH FROM: pool-v22-clean-monolith.js
   ========================================================= */

(function () {
  const VERSION = "V22.8";
  const FILE = "assets/js/pool-v22-clean-monolith.js";
  const STORAGE_GROUPS = "ep_pool_v22_groups";
  const STORAGE_DRAFT = "ep_pool_v22_draft";
  const STORAGE_STATE = "ep_pool_v22_state";
  const STORAGE_LOGIC = "ep_pool_v22_logic";
  const STORAGE_TEMPLATES = "ep_pool_v22_templates";

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const ceil = v => Math.ceil(Math.max(0, n(v, 0)));
  const money = v => Math.round(n(v, 0)).toLocaleString("ru-RU") + " ₽";
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

  const DEFAULT_STATE = {
    route: "ceiling",
    wall: "concrete",
    ceilingHeight: 270,
    height: 30,
    framePosts: 1,
    sockets: 0,
    switches: 0,
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
    connectorMode: "gml",
    dropsPerSocketJunction: 2,
    dropsPerSwitchJunction: 2,
    heatShrinkType: "12/4",
    shrinkCmPerJoint: 5
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

  const WALLS = [
    ["concrete", "Бетон", "бетон"],
    ["panel", "Панелька", "панель"],
    ["soft", "Мягкий", "мягкий"],
    ["brick", "Кирпич", "кирпич"]
  ];

  const ROUTES = [
    ["ceiling", "По потолку"],
    ["floor", "По полу"]
  ];

  const KEYS = ["sockets", "switches", "pass", "cross", "tv", "floorReg"];
  const PIN_KEYS = ["pin2", "pin3", "pin4", "pin5", "pin6", "pin8", "pin10"];
  const PIN_LABELS = {
    pin2: "2 пров.",
    pin3: "3 пров.",
    pin4: "4 пров.",
    pin5: "5 пров.",
    pin6: "6 пров.",
    pin8: "8 пров.",
    pin10: "10 пров."
  };

  const TEMPLATE_LABELS = {
    switch_1: "Выкл. 1кл",
    switch_2: "Выкл. 2кл",
    switch_3: "Выкл. 3кл",
    pass_1: "Проходной 1кл",
    pass_2: "Двойной проходной",
    cross_1: "Перекрёстный",
    cross_2: "Двойной перекрёстный"
  };

  let state = { ...DEFAULT_STATE };
  let logic = { ...DEFAULT_LOGIC };
  let templates = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  let groups = [];
  let draft = [];
  let logicOpen = false;
  let connOpen = false;

  function diag(level, code, message, extra = {}) {
    try {
      const payload = { file: FILE, module: "PoolV22CleanMonolith", functionName: "runtime", place: "pool", code, message, ...extra };
      if (level === "error") window.Diagnostics?.error?.(payload);
      else window.Diagnostics?.ok?.(payload);
    } catch {}
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
    let box = document.getElementById("ep-pool-v22-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-pool-v22-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__poolV22Toast);
    window.__poolV22Toast = setTimeout(() => box.classList.remove("show"), 1600);
  }

  function load() {
    try { state = { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(STORAGE_STATE) || "{}") }; } catch { state = { ...DEFAULT_STATE }; }
    try { logic = { ...DEFAULT_LOGIC, ...JSON.parse(localStorage.getItem(STORAGE_LOGIC) || "{}") }; } catch { logic = { ...DEFAULT_LOGIC }; }
    try { templates = mergeTemplates(JSON.parse(localStorage.getItem(STORAGE_TEMPLATES) || "{}")); } catch { templates = mergeTemplates({}); }
    try { groups = JSON.parse(localStorage.getItem(STORAGE_GROUPS) || "[]"); } catch { groups = []; }
    try { draft = JSON.parse(localStorage.getItem(STORAGE_DRAFT) || "[]"); } catch { draft = []; }
    normalize();
  }

  function mergeTemplates(saved) {
    const out = {};
    Object.keys(DEFAULT_TEMPLATES).forEach(k => {
      out[k] = { ...DEFAULT_TEMPLATES[k], ...(saved[k] || {}) };
      PIN_KEYS.forEach(pin => out[k][pin] = Math.max(0, n(out[k][pin], 0)));
    });
    return out;
  }

  function save() {
    try { localStorage.setItem(STORAGE_STATE, JSON.stringify(state)); } catch {}
    try { localStorage.setItem(STORAGE_LOGIC, JSON.stringify(logic)); } catch {}
    try { localStorage.setItem(STORAGE_TEMPLATES, JSON.stringify(templates)); } catch {}
    try { localStorage.setItem(STORAGE_GROUPS, JSON.stringify(groups)); } catch {}
    try { localStorage.setItem(STORAGE_DRAFT, JSON.stringify(draft)); } catch {}
  }

  function totalMechanisms() {
    return KEYS.reduce((s, k) => s + Math.max(0, n(state[k], 0)), 0);
  }

  function normalize() {
    KEYS.forEach(k => state[k] = Math.max(0, n(state[k], 0)));
    state.framesQty = Math.max(1, n(state.framesQty, 1));
    state.switchKeys = Math.max(1, Math.min(3, n(state.switchKeys, 1)));
    state.passKeys = Math.max(1, Math.min(2, n(state.passKeys, 1)));
    state.height = Math.max(0, n(state.height, 30));
    state.ceilingHeight = Math.max(180, n(state.ceilingHeight, 270));
    const total = totalMechanisms();
    state.framePosts = Math.max(1, Math.min(6, n(state.framePosts, 1)));
    if (total > state.framePosts) state.framePosts = Math.min(6, total);
    if (total === 0) state.framePosts = 1;
  }

  const wallDb = c => (WALLS.find(x => x[0] === c) || WALLS[0])[2];
  const routeLabel = c => (ROUTES.find(x => x[0] === c) || ROUTES[0])[1];

  function askNumber(title, current, min = 0) {
    const raw = prompt(title, String(current ?? ""));
    if (raw === null) return null;
    const value = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(value) || value < min) {
      toast("Введите корректное число.");
      sound("error");
      return null;
    }
    return value;
  }

  function askText(title, current) {
    const raw = prompt(title, String(current ?? ""));
    if (raw === null) return null;
    return String(raw).trim();
  }

  function ensureScreen() {
    let el = document.getElementById("ep-pool-v22-screen");
    if (!el) {
      el = document.createElement("div");
      el.id = "ep-pool-v22-screen";
      el.className = "ep-pool-v22 hidden";
      document.body.appendChild(el);
    }
    return el;
  }

  function closeOtherOldScreens() {
    document.querySelectorAll("#ep-pool-v21-screen").forEach(el => {
      el.classList.add("hidden");
      el.style.display = "none";
    });
  }

  function valueTile(label, value, attr) {
    return `<button type="button" class="p22-value" ${attr}><span>${esc(label)}</span><b>${esc(value)}</b></button>`;
  }

  function logicTile(key, label) {
    return valueTile(label, logic[key], `data-p22-logic="${key}"`);
  }

  function counter(icon, title, key, keySelector) {
    return `
      <div class="p22-counter">
        <div class="p22-counter-title"><span>${icon}</span><b>${title}</b></div>
        <div class="p22-mini">
          <button type="button" data-p22-dec="${key}">-</button>
          <strong>${n(state[key], 0)}</strong>
          <button type="button" data-p22-inc="${key}">+</button>
        </div>
        ${keySelector || ""}
      </div>
    `;
  }

  function keySelector(kind) {
    const current = kind === "switch" ? state.switchKeys : state.passKeys;
    const max = kind === "switch" ? 3 : 2;
    return `
      <div class="p22-keys">
        <span>Клавиши</span>
        ${Array.from({ length: max }, (_, i) => i + 1).map(v => `
          <button type="button" data-p22-key="${kind}" data-value="${v}" class="${current === v ? "active" : ""}">${v}кл</button>
        `).join("")}
      </div>
    `;
  }

  function templateSummary(k) {
    const parts = [];
    PIN_KEYS.forEach(pin => {
      const qty = n(templates[k]?.[pin], 0);
      if (qty) parts.push(`${PIN_LABELS[pin]} × ${qty}`);
    });
    return parts.length ? parts.join(" · ") : "пусто";
  }

  function render() {
    normalize();
    const el = ensureScreen();
    el.style.display = "";
    el.classList.remove("hidden");

    el.innerHTML = `
      <div class="p22-head">
        <button type="button" data-p22-close>←</button>
        <div><h2>Пул розеток / штроб</h2><p>Монолитный модуль без V21-патчей</p></div>
        <b>${VERSION}</b>
      </div>

      <div class="p22-shell">
        <section class="p22-card">
          <div class="p22-route">
            <div>
              <span class="p22-label">Трассы (кабель)</span>
              <div class="p22-buttons two">
                ${ROUTES.map(([k, l]) => `<button type="button" data-p22-route="${k}" class="${state.route === k ? "active" : ""}">${l}</button>`).join("")}
              </div>
            </div>
            ${valueTile("Потолок, см", state.ceilingHeight, 'data-p22-edit="ceilingHeight"')}
          </div>
          <span class="p22-label">Стена (для штроб)</span>
          <div class="p22-buttons four">
            ${WALLS.map(([k, l]) => `<button type="button" data-p22-wall="${k}" class="${state.wall === k ? "active" : ""}">${l}</button>`).join("")}
          </div>
        </section>

        <section class="p22-card">
          <button class="p22-toggle" type="button" data-p22-logic-toggle>${logicOpen ? "Скрыть логику" : "Изменить логику"}</button>
          <div class="p22-logic ${logicOpen ? "" : "hidden"}">
            ${logicTile("ordinaryBoxDepthMin", "Обыч. от")}
            ${logicTile("ordinaryBoxDepthMax", "Обыч. до")}
            ${logicTile("deepBoxDepthMin", "Глуб. от")}
            ${logicTile("deepBoxDepthMax", "Глуб. до")}
            ${logicTile("strobeJunction", "Штр. распайка")}
            ${logicTile("strobeInBoxes", "Штр. подроз.")}
            ${logicTile("strobeCeilingThermostat", "Т.п. сверху")}
            ${logicTile("strobeFloorThermostat", "Т.п. вниз")}
            ${logicTile("dropsPerSocketJunction", "Спусков/расп. роз.")}
            ${logicTile("dropsPerSwitchJunction", "Спусков/расп. выкл.")}
            ${logicTile("heatShrinkType", "Термоус.")}
            ${logicTile("shrinkCmPerJoint", "См/соед.")}
            <div class="p22-mode wide">
              <button type="button" data-p22-conn-mode="in_boxes" class="${logic.connectionMode === "in_boxes" ? "active" : ""}">В подрозетниках<br><small>мастер гинекологии</small></button>
              <button type="button" data-p22-conn-mode="junction_boxes" class="${logic.connectionMode === "junction_boxes" ? "active" : ""}">В распайках<br><small>проктолог</small></button>
            </div>
            <div class="p22-mode wide">
              <button type="button" data-p22-material-mode="wago" class="${logic.connectorMode === "wago" ? "active" : ""}">WAGO</button>
              <button type="button" data-p22-material-mode="gml" class="${logic.connectorMode === "gml" ? "active" : ""}">ГМЛ</button>
              <button type="button" data-p22-material-mode="siz" class="${logic.connectorMode === "siz" ? "active" : ""}">СИЗ</button>
            </div>
          </div>
        </section>

        <section class="p22-card">
          <button class="p22-toggle" type="button" data-p22-conn-toggle>${connOpen ? "Скрыть соединители" : "Шаблоны WAGO-схемы"}</button>
          <div class="p22-templates ${connOpen ? "" : "hidden"}">
            ${Object.keys(TEMPLATE_LABELS).map(tpl => `
              <div class="p22-template">
                <b>${TEMPLATE_LABELS[tpl]}</b>
                <small>${templateSummary(tpl)}</small>
                <div class="p22-pin-grid">
                  ${PIN_KEYS.map(pin => `<button type="button" data-p22-template="${tpl}" data-p22-pin="${pin}" class="${n(templates[tpl]?.[pin], 0) ? "active" : ""}"><span>${PIN_LABELS[pin]}</span><b>${n(templates[tpl]?.[pin], 0)}</b></button>`).join("")}
                </div>
              </div>
            `).join("")}
          </div>
        </section>

        <section class="p22-card">
          <span class="p22-label">Высота от пола (см)</span>
          <div class="p22-buttons four">
            ${[30, 90, 110].map(v => `<button type="button" data-p22-height="${v}" class="${state.height === v ? "active" : ""}">${v}</button>`).join("")}
            <button type="button" data-p22-edit="height" class="${[30, 90, 110].includes(state.height) ? "" : "active"}">Своя</button>
          </div>
        </section>

        <section class="p22-card">
          <span class="p22-label">Постов в рамке (всего мест)</span>
          <div class="p22-buttons six">
            ${[1,2,3,4,5,6].map(v => `<button type="button" data-p22-post="${v}" class="${state.framePosts === v ? "active" : ""}">${v}</button>`).join("")}
          </div>
        </section>

        <section class="p22-card p22-counters">
          ${counter("🔌", "Розетки 220В", "sockets")}
          ${counter("💡", "Выключатели", "switches", keySelector("switch"))}
          ${counter("↩️", "Проходные (Марш)", "pass", keySelector("pass"))}
          ${counter("🔀", "Перекрёстные", "cross")}
          ${counter("📺", "ТВ / Интернет", "tv")}
          ${counter("🌡️", "Регулятор (т. Пол)", "floorReg")}
        </section>

        <section class="p22-card">
          <div class="p22-frame-row">
            <div>
              <b>Кол-во таких рамок:</b>
              <small>${state.height}см · ${state.framePosts} пост. · ${totalMechanisms()}/6 · ${routeLabel(state.route)} · потолок ${state.ceilingHeight}см</small>
            </div>
            <div class="p22-mini">
              <button type="button" data-p22-dec="framesQty">-</button>
              <strong>${state.framesQty}</strong>
              <button type="button" data-p22-inc="framesQty">+</button>
            </div>
          </div>
          <button type="button" class="p22-add" data-p22-add>Добавить в пул</button>
        </section>

        <button type="button" class="p22-calc" data-p22-build>Рассчитать черновую</button>

        <section class="p22-card">
          <div class="p22-list-head"><h3>Пул</h3><button type="button" data-p22-clear>Очистить</button></div>
          <div id="p22-groups"></div>
        </section>

        <section id="p22-connectors-panel" class="p22-card"></section>

        <section class="p22-card">
          <div class="p22-list-head"><h3>Черновик расчёта</h3><button type="button" data-p22-pick-db>Подобрать из БД</button></div>
          <div id="p22-draft"></div>
          <button type="button" class="p22-add" data-p22-estimate>Добавить результат в смету</button>
        </section>
      </div>
    `;

    renderGroups();
    renderDraft();
    renderConnectorsPanel(null);
    save();
    syncVersionBadges();
  }

  function open() {
    load();
    closeOtherOldScreens();
    render();
    diag("ok", "pool-v22-open", "Пул V22 открыт монолитом.");
  }

  function close() {
    ensureScreen().classList.add("hidden");
    ensureScreen().style.display = "none";
    save();
  }

  function inc(key) {
    normalize();
    if (key === "framesQty") state.framesQty += 1;
    else if (KEYS.includes(key)) {
      if (totalMechanisms() >= 6) {
        toast("В рамке максимум 6 механизмов.");
        sound("error");
        return;
      }
      state[key] += 1;
      state.framePosts = Math.max(state.framePosts, totalMechanisms());
    }
    sound();
    render();
  }

  function dec(key) {
    normalize();
    if (key === "framesQty") state.framesQty = Math.max(1, state.framesQty - 1);
    else if (KEYS.includes(key)) {
      state[key] = Math.max(0, state[key] - 1);
      const total = totalMechanisms();
      state.framePosts = total ? Math.min(state.framePosts, total) : 1;
    }
    sound();
    render();
  }

  function setPost(v) {
    v = Math.max(1, Math.min(6, n(v, 1)));
    const total = totalMechanisms();
    if (total && v < total) {
      toast(`Нельзя меньше ${total}: уже выбрано ${total} механизмов.`);
      sound("error");
      return;
    }
    state.framePosts = v;
    sound();
    render();
  }

  function editState(key) {
    const labels = { ceilingHeight: "Высота потолка, см", height: "Высота от пола, см" };
    const val = askNumber(labels[key] || key, state[key], key === "ceilingHeight" ? 180 : 0);
    if (val === null) return;
    state[key] = val;
    sound("success");
    render();
  }

  function editLogic(key) {
    const textKeys = new Set(["strobeJunction", "strobeInBoxes", "strobeCeilingThermostat", "strobeFloorThermostat", "heatShrinkType"]);
    const val = textKeys.has(key) ? askText(key, logic[key]) : askNumber(key, logic[key], 0);
    if (val === null) return;
    logic[key] = val;
    sound("success");
    render();
  }

  function addFrame() {
    normalize();
    const total = totalMechanisms();
    if (total <= 0) {
      toast("Добавь хотя бы один механизм.");
      sound("error");
      return;
    }

    groups.push({
      id: "g_" + Date.now() + "_" + Math.random().toString(16).slice(2),
      room: "Комната",
      qty: Math.max(1, n(state.framesQty, 1)),
      sockets: n(state.sockets),
      switches: n(state.switches),
      pass: n(state.pass),
      cross: n(state.cross),
      tv: n(state.tv),
      thermostat: n(state.floorReg),
      wall: wallDb(state.wall),
      meta: {
        route: state.route,
        routeLabel: routeLabel(state.route),
        height: n(state.height),
        ceilingHeight: n(state.ceilingHeight),
        framePosts: n(state.framePosts),
        switchKeys: n(state.switchKeys),
        passKeys: n(state.passKeys)
      }
    });

    const keep = { route: state.route, wall: state.wall, ceilingHeight: state.ceilingHeight };
    state = { ...DEFAULT_STATE, ...keep };
    save();
    sound("success");
    toast("Добавлено в пул.");
    render();
  }

  function renderGroups() {
    const box = document.getElementById("p22-groups");
    if (!box) return;
    if (!groups.length) {
      box.innerHTML = `<div class="p22-empty">Пул пока пуст.</div>`;
      return;
    }

    box.innerHTML = groups.map(g => {
      const total = (n(g.sockets) + n(g.switches) + n(g.pass) + n(g.cross) + n(g.tv) + n(g.thermostat)) * Math.max(1, n(g.qty, 1));
      return `
        <div class="p22-item">
          <div>
            <b>${esc(g.room)} · Высота ${esc(g.meta?.height)}см | ${esc(g.meta?.framePosts)} пост.</b>
            <p>${n(g.qty, 1)} рам. · механизмов ${total}</p>
            <small>${esc(g.meta?.routeLabel)} · ${esc(g.wall)} · потолок ${esc(g.meta?.ceilingHeight)}см</small>
          </div>
          <button type="button" data-p22-remove="${esc(g.id)}">×</button>
        </div>
      `;
    }).join("");
  }

  function addStrobe(map, size, meters, wall) {
    meters = Math.max(0, n(meters, 0));
    if (!meters) return;
    const key = `${size}|${wall || "бетон"}`;
    map[key] = (map[key] || 0) + meters;
  }

  function toCeiling(ceiling, height) {
    return Math.max(0, (n(ceiling, 270) - n(height, 30)) / 100);
  }

  function toFloor(height) {
    return Math.max(0, n(height, 30) / 100);
  }

  function raw(type, name, qty, unit, query) {
    return { id: "p22_" + Math.random().toString(16).slice(2), type, name, qty, unit, price: 0, dbName: "", dbItemId: "", missingDb: false, query: Array.isArray(query) ? query : [name] };
  }

  function buildBaseDraft() {
    const result = { strobe: {}, ordinary: 0, deep: 0 };

    groups.forEach(g => {
      const qty = Math.max(1, n(g.qty, 1));
      const height = n(g.meta?.height, 30);
      const ceiling = n(g.meta?.ceilingHeight, 270);
      const route = g.meta?.route || "ceiling";
      const wall = g.wall || "бетон";
      const ordinarySize = logic.connectionMode === "in_boxes" ? logic.strobeInBoxes : logic.strobeJunction;

      const sockets = n(g.sockets), switches = n(g.switches), pass = n(g.pass), cross = n(g.cross), tv = n(g.tv), thermostat = n(g.thermostat);

      result.ordinary += sockets * qty;
      result.deep += (switches + pass + cross + tv + thermostat) * qty;

      if (sockets > 0) addStrobe(result.strobe, ordinarySize, (route === "floor" ? toFloor(height) : toCeiling(ceiling, height)) * qty, wall);
      if ((switches + pass + cross) > 0) addStrobe(result.strobe, ordinarySize, toCeiling(ceiling, height) * qty, wall);
      if (thermostat > 0) {
        if (route === "ceiling") addStrobe(result.strobe, logic.strobeCeilingThermostat, toCeiling(ceiling, height) * qty, wall);
        addStrobe(result.strobe, logic.strobeFloorThermostat, toFloor(height) * qty, wall);
      }
      if (tv > 0) addStrobe(result.strobe, ordinarySize, (route === "floor" ? toFloor(height) : toCeiling(ceiling, height)) * qty, wall);
    });

    const rows = [];
    Object.entries(result.strobe).forEach(([key, meters]) => {
      const [size, wall] = key.split("|");
      rows.push(raw("work", `Штробление ${size} ${wall}`, Math.round(meters * 100) / 100, "м", ["штробление", size, wall]));
    });

    if (result.ordinary > 0) {
      rows.push(raw("material", `Подрозетник ${logic.ordinaryBoxDepthMin}-${logic.ordinaryBoxDepthMax} мм`, result.ordinary, "шт", ["подрозетник", `${logic.ordinaryBoxDepthMin}`, `${logic.ordinaryBoxDepthMax}`]));
      rows.push(raw("work", "Высверливание подрозетников обычных", result.ordinary, "шт", ["высверливание подрозетник"]));
    }

    if (result.deep > 0) {
      rows.push(raw("material", `Подрозетник глубокий ${logic.deepBoxDepthMin}-${logic.deepBoxDepthMax} мм`, result.deep, "шт", ["подрозетник глубокий", `${logic.deepBoxDepthMin}`, `${logic.deepBoxDepthMax}`]));
      rows.push(raw("work", "Высверливание подрозетников глубоких", result.deep, "шт", ["высверливание подрозетник глубокий"]));
    }

    return rows;
  }

  function addMap(map, key, qty) {
    qty = Math.max(0, n(qty, 0));
    if (!qty) return;
    map[key] = (map[key] || 0) + qty;
  }

  function applyTemplate(pinMap, key, multiplier) {
    const tpl = templates[key] || {};
    Object.entries(tpl).forEach(([pin, qty]) => {
      if (/^pin\d+$/.test(pin)) addMap(pinMap, pin, n(qty) * multiplier);
    });
  }

  function sleeveByWires(wires) {
    wires = n(wires);
    if (wires <= 4) return "gml4";
    if (wires <= 6) return "gml6";
    if (wires <= 8) return "gml8";
    return "gml10";
  }

  function materialName(key) {
    return ({
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
    })[key] || key;
  }

  function calculateConnectors() {
    const pinMap = {};
    let socketDrops = 0;
    let switchDrops = 0;

    groups.forEach(g => {
      const qty = Math.max(1, n(g.qty, 1));
      const sockets = n(g.sockets), switches = n(g.switches), pass = n(g.pass), cross = n(g.cross);
      const switchKeys = Math.max(1, Math.min(3, n(g.meta?.switchKeys, 1)));
      const passKeys = Math.max(1, Math.min(2, n(g.meta?.passKeys, 1)));

      if (switches > 0) applyTemplate(pinMap, `switch_${switchKeys}`, switches * qty);
      if (pass > 0) applyTemplate(pinMap, passKeys >= 2 ? "pass_2" : "pass_1", pass * qty);
      if (cross > 0) applyTemplate(pinMap, passKeys >= 2 ? "cross_2" : "cross_1", cross * qty);

      if (sockets > 0) {
        if (logic.connectionMode === "in_boxes") {
          const wires = 2 + sockets;
          addMap(pinMap, `pin${wires}`, 3 * qty);
        } else {
          socketDrops += qty;
        }
      }

      if ((switches + pass + cross) > 0 && logic.connectionMode === "junction_boxes") switchDrops += qty;
    });

    function addJunction(totalDrops, dropsPerBox) {
      totalDrops = Math.max(0, n(totalDrops, 0));
      dropsPerBox = Math.max(1, n(dropsPerBox, 2));
      const boxes = ceil(totalDrops / dropsPerBox);
      let left = totalDrops;
      for (let i = 0; i < boxes; i++) {
        const here = Math.min(dropsPerBox, left);
        left -= here;
        if (here > 0) addMap(pinMap, `pin${2 + here}`, 3);
      }
      return boxes;
    }

    const socketJunctions = logic.connectionMode === "junction_boxes" ? addJunction(socketDrops, logic.dropsPerSocketJunction) : 0;
    const switchJunctions = logic.connectionMode === "junction_boxes" ? addJunction(switchDrops, logic.dropsPerSwitchJunction) : 0;

    const materials = {};
    let shrinkCount = 0;
    Object.entries(pinMap).forEach(([pin, qty]) => {
      const wires = n(pin.replace("pin", ""));
      if (logic.connectorMode === "wago") {
        addMap(materials, pin, qty);
      } else if (logic.connectorMode === "siz") {
        addMap(materials, `siz${wires}`, qty);
        shrinkCount += qty;
      } else {
        addMap(materials, sleeveByWires(wires), qty);
        shrinkCount += qty;
      }
    });

    const shrinkM = Math.round((shrinkCount * n(logic.shrinkCmPerJoint, 5) / 100) * 100) / 100;
    return { pinMap, materials, shrinkM, socketDrops, switchDrops, socketJunctions, switchJunctions };
  }

  function buildDraft() {
    draft = buildBaseDraft();
    const connectors = calculateConnectors();

    Object.entries(connectors.materials).forEach(([key, qty]) => {
      draft.push(raw("material", materialName(key), qty, "шт", [materialName(key), key]));
    });

    if (connectors.shrinkM > 0) {
      draft.push(raw("material", `Термоусадка ${logic.heatShrinkType}`, connectors.shrinkM, "м", ["термоусадка", logic.heatShrinkType]));
    }

    if (logic.connectionMode === "junction_boxes") {
      if (connectors.socketJunctions > 0) draft.push(raw("material", `Распайки розеток: ${connectors.socketDrops} спуск. / ${logic.dropsPerSocketJunction}`, connectors.socketJunctions, "шт", ["распаячная коробка", "розетки"]));
      if (connectors.switchJunctions > 0) draft.push(raw("material", `Распайки выключателей: ${connectors.switchDrops} спуск. / ${logic.dropsPerSwitchJunction}`, connectors.switchJunctions, "шт", ["распаячная коробка", "выключатели"]));
    }

    save();
    renderDraft();
    renderConnectorsPanel(connectors);
    toast("Черновая рассчитана монолитом V22.");
    sound("success");
    diag("ok", "pool-v22-build", "Черновая рассчитана монолитом.", { connectors });
  }

  function renderConnectorsPanel(connectors) {
    const box = document.getElementById("p22-connectors-panel");
    if (!box) return;

    if (!connectors) {
      box.innerHTML = `<div class="p22-list-head"><h3>Соединители и распайки</h3></div><div class="p22-empty">После расчёта здесь будут ГМЛ/WAGO/СИЗ, распайки и термоусадка.</div>`;
      return;
    }

    const pins = Object.entries(connectors.pinMap).filter(([, q]) => q > 0);
    const mats = Object.entries(connectors.materials).filter(([, q]) => q > 0);

    box.innerHTML = `
      <div class="p22-list-head"><h3>Соединители и распайки</h3><button type="button" data-p22-build>Пересчитать</button></div>
      <div class="p22-badge">Режим: ${logic.connectorMode === "wago" ? "WAGO" : logic.connectorMode === "siz" ? "СИЗ" : "ГМЛ"} · ${VERSION}</div>
      <div class="p22-pins">${pins.length ? pins.map(([p, q]) => `<span>${p.replace("pin", "")} пров. × ${q}</span>`).join("") : "<span>нет соединений</span>"}</div>
      <div class="p22-list">
        ${mats.length ? mats.map(([k, q]) => `<div class="p22-row"><b>${esc(materialName(k))}</b><strong>${q} шт</strong></div>`).join("") : `<div class="p22-empty">Соединители не рассчитались.</div>`}
        ${connectors.shrinkM > 0 ? `<div class="p22-row"><b>Термоусадка ${esc(logic.heatShrinkType)}</b><strong>${connectors.shrinkM} м</strong></div>` : ""}
        ${logic.connectionMode === "junction_boxes" ? `
          <div class="p22-row muted"><b>Распайки розеток</b><strong>${connectors.socketJunctions} шт</strong></div>
          <div class="p22-row muted"><b>Распайки выключателей</b><strong>${connectors.switchJunctions} шт</strong></div>
        ` : `<div class="p22-small">Соединение в подрозетниках: вход + выход + розетки, затем ×3 жилы L/N/PE.</div>`}
      </div>
    `;
  }

  function renderDraft() {
    const box = document.getElementById("p22-draft");
    if (!box) return;
    if (!draft.length) {
      box.innerHTML = `<div class="p22-empty">Черновик пока пуст.</div>`;
      return;
    }

    let total = 0;
    box.innerHTML = draft.map(i => {
      const sum = n(i.price) * n(i.qty);
      total += sum;
      return `
        <div class="p22-draft-row">
          <div>
            <b>${esc(i.name)}</b>
            <p>${i.type === "work" ? "Работа" : "Материал"} · ${esc(i.qty)} ${esc(i.unit || "шт")}</p>
            <small>${i.dbName ? "БД: " + esc(i.dbName) : "Не подобрано из БД"}</small>
          </div>
          <div><strong>${money(i.price)}</strong><small>${money(sum)}</small></div>
        </div>
      `;
    }).join("") + `<div class="p22-total"><span>Итого</span><b>${money(total)}</b></div>`;
  }

  function clearPool() {
    if (!confirm("Очистить пул?")) return;
    groups = [];
    draft = [];
    save();
    render();
  }

  function removeGroup(id) {
    groups = groups.filter(g => g.id !== id);
    save();
    render();
  }

  function editTemplate(tpl, pin) {
    const val = askNumber(`${TEMPLATE_LABELS[tpl]} · ${PIN_LABELS[pin]}`, templates[tpl]?.[pin] || 0, 0);
    if (val === null) return;
    templates[tpl][pin] = val;
    sound("success");
    render();
  }

  async function pickDb() {
    toast("Подбор из БД подключим следующим шагом к монолиту.");
  }

  function syncVersionBadges() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch {}
  }

  function bind() {
    document.addEventListener("click", event => {
      const root = event.target.closest("#ep-pool-v22-screen");
      if (!root) return;

      let el;
      if (event.target.closest("[data-p22-close]")) { event.preventDefault(); close(); return; }
      if (el = event.target.closest("[data-p22-route]")) { state.route = el.dataset.p22Route; sound(); render(); return; }
      if (el = event.target.closest("[data-p22-wall]")) { state.wall = el.dataset.p22Wall; sound(); render(); return; }
      if (el = event.target.closest("[data-p22-height]")) { state.height = n(el.dataset.p22Height); sound(); render(); return; }
      if (el = event.target.closest("[data-p22-post]")) { setPost(el.dataset.p22Post); return; }
      if (el = event.target.closest("[data-p22-inc]")) { inc(el.dataset.p22Inc); return; }
      if (el = event.target.closest("[data-p22-dec]")) { dec(el.dataset.p22Dec); return; }
      if (el = event.target.closest("[data-p22-edit]")) { editState(el.dataset.p22Edit); return; }
      if (el = event.target.closest("[data-p22-logic]")) { editLogic(el.dataset.p22Logic); return; }
      if (event.target.closest("[data-p22-logic-toggle]")) { logicOpen = !logicOpen; sound(); render(); return; }
      if (event.target.closest("[data-p22-conn-toggle]")) { connOpen = !connOpen; sound(); render(); return; }
      if (el = event.target.closest("[data-p22-conn-mode]")) { logic.connectionMode = el.dataset.p22ConnMode; sound("success"); render(); return; }
      if (el = event.target.closest("[data-p22-material-mode]")) { logic.connectorMode = el.dataset.p22MaterialMode; sound("success"); render(); return; }
      if (el = event.target.closest("[data-p22-key]")) {
        if (el.dataset.p22Key === "switch") state.switchKeys = n(el.dataset.value, 1);
        if (el.dataset.p22Key === "pass") state.passKeys = n(el.dataset.value, 1);
        sound();
        render();
        return;
      }
      if (el = event.target.closest("[data-p22-template][data-p22-pin]")) { editTemplate(el.dataset.p22Template, el.dataset.p22Pin); return; }
      if (event.target.closest("[data-p22-add]")) { addFrame(); return; }
      if (event.target.closest("[data-p22-build]")) { buildDraft(); return; }
      if (event.target.closest("[data-p22-clear]")) { clearPool(); return; }
      if (el = event.target.closest("[data-p22-remove]")) { removeGroup(el.dataset.p22Remove); return; }
      if (event.target.closest("[data-p22-pick-db]")) { pickDb(); return; }
      if (event.target.closest("[data-p22-estimate]")) { toast("Добавление в смету подключим после стабилизации монолита."); return; }
    }, true);
  }

  function installGlobal() {
    window.PoolV21 = {
      open,
      close,
      load,
      save,
      groups,
      draft,
      renderGroups,
      renderDraft,
      buildDraft,
      clear: clearPool
    };

    window.PoolV22CleanMonolith = {
      version: VERSION,
      open,
      close,
      buildDraft,
      calculateConnectors,
      state: () => ({ ...state }),
      logic: () => ({ ...logic }),
      groups: () => groups.slice(),
      draft: () => draft.slice()
    };
  }

  function init() {
    load();
    bind();
    installGlobal();
    syncVersionBadges();
    setTimeout(syncVersionBadges, 600);
    setTimeout(syncVersionBadges, 1600);
    diag("ok", "pool-v22-ready", "Pool V22 clean monolith ready.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();




/* =========================================================
   MERGED INTO POOL V22.7 MONOLITH FROM: pool-v22-2-force-route.js
   ========================================================= */

(function () {
  const VERSION = "V22.7";

  function openPoolV22() {
    if (window.PoolV22CleanMonolith && typeof window.PoolV22CleanMonolith.open === "function") {
      window.PoolV22CleanMonolith.open();
      return true;
    }

    console.warn("[Pool V22.2] PoolV22CleanMonolith.open не найден");
    return false;
  }

  function isPoolTarget(el) {
    if (!el) return false;

    const text = (el.textContent || "").toLowerCase();
    const route = (
      (el.getAttribute && (
        el.getAttribute("data-route") ||
        el.getAttribute("data-module") ||
        el.getAttribute("href") ||
        el.getAttribute("onclick")
      )) || ""
    ).toLowerCase();

    return (
      text.includes("пул розеток") ||
      text.includes("пул розеток/штроб") ||
      text.includes("пул розеток / bim") ||
      text.includes("розетки, выключатели") ||
      route.includes("pool") ||
      route.includes("bim")
    );
  }

  function patchRouter() {
    if (window.Router && typeof window.Router.load === "function" && !window.Router.__poolV22ForcePatched) {
      const oldLoad = window.Router.load.bind(window.Router);

      window.Router.load = function (route, ...args) {
        if (String(route).toLowerCase() === "pool" || String(route).toLowerCase() === "bim") {
          return openPoolV22();
        }

        return oldLoad(route, ...args);
      };

      window.Router.__poolV22ForcePatched = true;
    }

    [
      "openPool",
      "openPoolScreen",
      "openSocketPool",
      "openStrobePool",
      "openBim",
      "openBIM",
      "showPool",
      "showPoolScreen"
    ].forEach(name => {
      try {
        window[name] = openPoolV22;
      } catch (e) {}
    });
  }

  function patchClicks() {
    if (window.__poolV22ForceClickPatched) return;
    window.__poolV22ForceClickPatched = true;

    document.addEventListener("click", function (event) {
      if (event.target.closest("#ep-pool-v22-screen")) return;

      const el = event.target.closest("button,a,[role='button'],[data-route],[data-module],.card,.module-card,section,div");
      if (!isPoolTarget(el)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openPoolV22();
    }, true);
  }

  function syncVersion() {
    try {
      if (window.ModuleVersionBadgesV212) {
        window.ModuleVersionBadgesV212.setVersion?.("pool", VERSION);
        window.ModuleVersionBadgesV212.setVersion?.("rough", VERSION);
        window.ModuleVersionBadgesV212.apply?.();
      }
    } catch (e) {}
  }

  function boot() {
    patchRouter();
    patchClicks();
    syncVersion();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    setTimeout(boot, 300);
    setTimeout(boot, 1000);
    setTimeout(boot, 2500);
  });
})();




/* =========================================================
   MERGED INTO POOL V22.7 MONOLITH FROM: v22-3-back-home-menu-fix.js
   ========================================================= */

(function () {
  const VERSION = "V22.7";

  function isPoolOpen() {
    const pool = document.getElementById("ep-pool-v22-screen");
    return pool && !pool.classList.contains("hidden") && pool.style.display !== "none";
  }

  function closePoolToHome() {
    const pool = document.getElementById("ep-pool-v22-screen");
    if (pool) {
      pool.classList.add("hidden");
      pool.style.display = "none";
    }

    document.body.classList.remove("ep-pool-open");

    if (window.Router && typeof window.Router.load === "function") {
      try {
        window.Router.load("home");
        return true;
      } catch (e) {}
    }

    const homeSelectors = [
      "#home-screen",
      "#main-screen",
      "#dashboard-screen",
      ".home-screen",
      ".main-screen",
      "[data-screen='home']",
      "[data-route='home']"
    ];

    homeSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.classList.remove("hidden");
        if (el.style.display === "none") el.style.display = "";
      });
    });

    return true;
  }

  function pushPoolHistory() {
    if (!isPoolOpen()) return;

    if (history.state && history.state.epPoolV22) return;

    try {
      history.pushState(
        { epPoolV22: true, screen: "pool" },
        "",
        location.href
      );
    } catch (e) {}
  }

  function patchPoolOpen() {
    if (!window.PoolV22CleanMonolith || window.PoolV22CleanMonolith.__backHomePatched) return;

    const oldOpen = window.PoolV22CleanMonolith.open.bind(window.PoolV22CleanMonolith);

    window.PoolV22CleanMonolith.open = function () {
      const result = oldOpen();
      document.body.classList.add("ep-pool-open");
      setTimeout(pushPoolHistory, 50);
      setTimeout(pushPoolHistory, 300);
      return result;
    };

    window.PoolV22CleanMonolith.__backHomePatched = true;
  }

  function handleBackButton() {
    window.addEventListener("popstate", function () {
      if (isPoolOpen()) {
        closePoolToHome();
      }
    });
  }

  function openHome() {
    const oldPool = document.getElementById("ep-pool-v22-screen");
    if (oldPool) {
      oldPool.classList.add("hidden");
      oldPool.style.display = "none";
    }

    if (window.Router && typeof window.Router.load === "function") {
      try {
        window.Router.load("home");
      } catch (e) {}
    }

    const menu = document.querySelector(".sidebar, .side-menu, .drawer, .burger-menu, #side-menu, #drawer, [data-menu]");
    if (menu) {
      menu.classList.remove("open", "active", "show");
    }

    document.body.classList.remove("menu-open", "drawer-open", "ep-pool-open");
  }

  function addHomeButtonToBurger() {
    const candidates = [
      document.querySelector("#side-menu"),
      document.querySelector("#drawer"),
      document.querySelector(".side-menu"),
      document.querySelector(".sidebar"),
      document.querySelector(".drawer"),
      document.querySelector(".burger-menu"),
      document.querySelector("[data-menu]")
    ].filter(Boolean);

    candidates.forEach(menu => {
      if (menu.querySelector("[data-v223-home]")) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-v223-home", "1");
      btn.className = "v223-home-btn";
      btn.innerHTML = "🏠 Главный экран";

      btn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openHome();
      }, true);

      const firstButton = menu.querySelector("button, a, [role='button']");
      if (firstButton && firstButton.parentElement) {
        firstButton.parentElement.insertBefore(btn, firstButton);
      } else {
        menu.insertBefore(btn, menu.firstChild);
      }
    });
  }

  function patchMainCardsVersion() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}

    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el => {
      el.textContent = VERSION;
    });
  }

  function boot() {
    patchPoolOpen();
    addHomeButtonToBurger();
    patchMainCardsVersion();
  }

  window.addEventListener("DOMContentLoaded", function () {
    handleBackButton();
    boot();

    setTimeout(boot, 300);
    setTimeout(boot, 1000);
    setTimeout(boot, 2500);
    setTimeout(boot, 5000);
  });

  window.V223BackHomeMenuFix = {
    version: VERSION,
    closePoolToHome,
    openHome,
    addHomeButtonToBurger
  };
})();




/* =========================================================
   MERGED INTO POOL V22.7 MONOLITH FROM: pool-v22-5-safe-db-picker.js
   ========================================================= */

(function () {
  const VERSION = "V22.7";
  const FILE = "assets/js/pool-v22-5-safe-db-picker.js";
  const DRAFT_KEY = "ep_pool_v22_draft";
  const RESULT_KEY = "ep_pool_v22_db_pick_result";

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV225SafeDbPicker",
        functionName: "runtime",
        place: "pool-db-picker",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    try { if (window.PoolV21?.toast) return window.PoolV21.toast(text); } catch (e) {}
    let box = document.getElementById("ep-pool-v22-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-pool-v22-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__p225Toast);
    window.__p225Toast = setTimeout(() => box.classList.remove("show"), 1800);
  }

  function money(v) {
    return Math.round(n(v, 0)).toLocaleString("ru-RU") + " ₽";
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function getDraft() { return readJson(DRAFT_KEY, []); }
  function saveDraft(draft) { writeJson(DRAFT_KEY, draft); }

  function normalizeName(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[×хx]/g, "x")
      .replace(/[^a-zа-я0-9x.,\s/-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getTokens(v) {
    return normalizeName(v).split(/\s+/).filter(t => t.length >= 2);
  }

  function itemHay(item) {
    return normalizeName([
      item.name,
      item.type,
      item.category,
      item.subcategory,
      item.sourceKey
    ].join(" "));
  }

  function deepWalk(value, out, sourceKey, depth = 0) {
    if (depth > 7 || value == null) return;

    if (Array.isArray(value)) {
      value.forEach(x => deepWalk(x, out, sourceKey, depth + 1));
      return;
    }

    if (typeof value === "object") {
      const name =
        value.name || value.title || value.label || value.workName ||
        value.materialName || value.itemName || value.fullName;

      const price =
        value.price ?? value.cost ?? value.amount ?? value.sum ??
        value.value ?? value.clientPrice ?? value.sellPrice;

      if (name && Number.isFinite(Number(price))) {
        const typeText = normalizeName(value.type || value.kind || value.categoryType || value.category || value.group || value.section || sourceKey);
        out.push({
          id: value.id || value.uid || value.key || `${sourceKey}_${out.length}`,
          name: String(name),
          price: Number(price),
          unit: value.unit || value.measure || value.uom || "шт",
          type: value.type || value.kind || value.categoryType || "",
          category: value.category || value.group || value.section || "",
          subcategory: value.subcategory || value.subgroup || "",
          sourceKey,
          inferredKind: inferItemKind(typeText + " " + normalizeName(name))
        });
      }

      Object.values(value).forEach(x => deepWalk(x, out, sourceKey, depth + 1));
    }
  }

  function inferItemKind(text) {
    text = normalizeName(text);
    if (/работ|монтаж|штроб|сверл|высверл|бурен|установк|демонтаж|ниша|резк/.test(text)) return "work";
    if (/материал|подроз|подраз|гмл|wago|ваго|сиз|термоусад|короб|кабель|гофр|провод|автомат|узо|диф|щит|распаечн|распаячн/.test(text)) return "material";
    return "";
  }

  function collectDbItems() {
    const out = [];
    const keyRx = /(db|database|base|база|materials|works|prices|server|global|my|active)/i;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !keyRx.test(key)) continue;

      const raw = localStorage.getItem(key);
      if (!raw || raw.length < 5) continue;

      try { deepWalk(JSON.parse(raw), out, key); } catch (e) {}
    }

    const seen = new Set();
    return out.filter(item => {
      const sig = `${item.name}|${item.price}|${item.unit}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }

  function rowKind(row) {
    if (row.type === "work") return "work";
    if (row.type === "material") return "material";

    const name = normalizeName(row.name);
    if (/штроб|сверл|высверл|монтаж|работ/.test(name)) return "work";
    return "material";
  }

  function isWorkItem(item) {
    const hay = itemHay(item);
    if (item.inferredKind === "work") return true;
    return /работ|монтаж|штроб|сверл|высверл|бурен|установк|демонтаж|ниша|резк/.test(hay);
  }

  function isMaterialItem(item) {
    const hay = itemHay(item);
    if (item.inferredKind === "material") return true;
    return /материал|подроз|подраз|гмл|wago|ваго|сиз|термоусад|короб|кабель|гофр|провод|автомат|узо|диф|щит|распаечн|распаячн/.test(hay);
  }

  function isCompatibleKind(row, item) {
    const kind = rowKind(row);
    const rowName = normalizeName(row.name);
    const hay = itemHay(item);

    if (kind === "work") {
      if (!isWorkItem(item)) return false;

      // Работа "высверливание" не должна брать материал "подрозетник".
      if (/высверл|сверл/.test(rowName) && /подроз|подраз/.test(hay) && !/высверл|сверл|бурен/.test(hay)) return false;

      // Штробление ищет только штробление.
      if (/штроб/.test(rowName) && !/штроб/.test(hay)) return false;

      // Монтаж распайки ищет монтаж/установку, а не саму коробку.
      if (/монтаж.*расп|монтаж.*короб/.test(rowName) && !/монтаж|установ/.test(hay)) return false;

      return true;
    }

    if (kind === "material") {
      if (!isMaterialItem(item)) return false;

      // Материал не должен брать работы.
      if (isWorkItem(item) && !/материал|подроз|гмл|wago|ваго|сиз|термоусад|короб/.test(hay)) return false;

      // Подрозетник не должен брать высверливание.
      if (/подроз|подраз/.test(rowName) && /высверл|сверл|бурен/.test(hay)) return false;

      // Распаечная коробка как материал не должна брать работу монтажа.
      if (/распайк|распаяч|короб/.test(rowName) && /монтаж|установ/.test(hay) && !/короб|распайк|распаяч/.test(hay)) return false;

      return true;
    }

    return true;
  }

  function extractSize(text) {
    text = normalizeName(text);
    const m = text.match(/(\d{2,3})\s*x\s*(\d{2,3})/);
    if (!m) return null;
    return `${Number(m[1])}x${Number(m[2])}`;
  }

  function sizeDistance(a, b) {
    if (!a || !b) return 0;
    const pa = a.split("x").map(Number);
    const pb = b.split("x").map(Number);
    return Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]);
  }

  function hasNumberInRange(text, min, max) {
    const nums = String(text).match(/\d+/g) || [];
    return nums.some(x => {
      const v = Number(x);
      return v >= min && v <= max;
    });
  }

  function getWarning(row, item) {
    const rowName = normalizeName(row.name);
    const hay = itemHay(item);
    const warnings = [];

    if (/штроб/.test(rowName)) {
      const need = extractSize(rowName);
      const got = extractSize(hay);
      if (need && got && need !== got) {
        warnings.push(`размер отличается: нужно ${need}, найдено ${got}`);
      }
    }

    if (/подрозетник.*глубок|глубок.*подрозетник/.test(rowName)) {
      if (!/глубок/.test(hay) && !hasNumberInRange(hay, 60, 75)) {
        warnings.push("проверь глубину подрозетника 60–75 мм");
      }
    }

    if (/подрозетник/.test(rowName) && /40-50|40.*50/.test(rowName)) {
      if (!hasNumberInRange(hay, 40, 50)) {
        warnings.push("проверь глубину подрозетника 40–50 мм");
      }
    }

    return warnings;
  }

  function scoreItem(row, item) {
    if (!isCompatibleKind(row, item)) return -9999;

    const rowName = normalizeName(row.name);
    const hay = itemHay(item);
    const query = Array.isArray(row.query) ? row.query.join(" ") : row.name;
    let score = 0;

    getTokens(query).forEach(t => { if (hay.includes(t)) score += 6; });
    getTokens(row.name).forEach(t => { if (hay.includes(t)) score += 4; });

    const kind = rowKind(row);
    if (kind === "work" && isWorkItem(item)) score += 30;
    if (kind === "material" && isMaterialItem(item)) score += 30;

    if (/гмл\s*4/i.test(row.name) && /гмл.*4|4.*гмл/i.test(hay)) score += 50;
    if (/гмл\s*6/i.test(row.name) && /гмл.*6|6.*гмл/i.test(hay)) score += 50;
    if (/гмл\s*8/i.test(row.name) && /гмл.*8|8.*гмл/i.test(hay)) score += 50;

    if (/wago|ваго/i.test(row.name) && /wago|ваго/i.test(hay)) score += 35;
    if (/сиз/i.test(row.name) && /сиз/i.test(hay)) score += 35;

    if (/подрозетник/i.test(rowName) && /подрозетник|подразетник/i.test(hay)) score += 35;

    if (/глубок/i.test(rowName)) {
      if (/глубок/i.test(hay)) score += 25;
      if (hasNumberInRange(hay, 60, 75)) score += 35;
    }

    if (/40-50|40.*50/i.test(rowName) && hasNumberInRange(hay, 40, 50)) score += 35;

    if (/штроб/i.test(rowName) && /штроб/i.test(hay)) score += 45;

    const rowSize = extractSize(rowName);
    const itemSize = extractSize(hay);
    if (rowSize && itemSize) {
      if (rowSize === itemSize) score += 45;
      else score -= Math.min(30, sizeDistance(rowSize, itemSize));
    }

    if (/бетон/i.test(rowName) && /бетон/i.test(hay)) score += 15;
    if (/кирпич/i.test(rowName) && /кирпич/i.test(hay)) score += 15;
    if (/панел/i.test(rowName) && /панел/i.test(hay)) score += 15;

    if (/распайк|распаяч/i.test(rowName) && /распайк|распаяч|короб/i.test(hay)) score += 40;
    if (/термоусад/i.test(rowName) && /термоусад/i.test(hay)) score += 40;

    if (/высверл|сверл/.test(rowName) && /высверл|сверл|бурен/.test(hay)) score += 50;
    if (/монтаж/.test(rowName) && /монтаж|установ/.test(hay)) score += 35;

    return score;
  }

  function findBest(row, dbItems) {
    return dbItems
      .map(item => ({ item, score: scoreItem(row, item), warnings: getWarning(row, item) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  function pickDb() {
    const draft = getDraft();

    if (!draft.length) {
      toast("Сначала рассчитай черновую.");
      return;
    }

    const dbItems = collectDbItems();

    if (!dbItems.length) {
      toast("База не найдена. Нужен адаптер активной базы.");
      renderResult({
        dbCount: 0,
        picked: 0,
        missed: draft.length,
        warningsCount: 0,
        rows: draft.map(row => ({ row, candidates: [] }))
      });
      return;
    }

    let picked = 0;
    let warningsCount = 0;
    const rows = [];

    const updated = draft.map(row => {
      const candidates = findBest(row, dbItems);
      const best = candidates[0];

      if (best && best.score >= 45) {
        const rn = normalizeName(row.name);
        const bh = itemHay(best.item);
        if (/высверл|сверл/.test(rn) && /подроз|подраз/.test(bh) && !/высверл|сверл|бурен|работ/.test(bh)) {
          rows.push({ row, picked: null, score: best.score, warnings: ["кандидат отклонён: это материал, а нужна работа"], candidates });
          return { ...row, missingDb: true, dbPickScore: best.score, dbPickWarnings: ["кандидат отклонён: это материал, а нужна работа"] };
        }
        picked += 1;
        warningsCount += best.warnings.length;

        rows.push({
          row,
          picked: best.item,
          score: best.score,
          warnings: best.warnings,
          candidates
        });

        return {
          ...row,
          price: best.item.price,
          unit: row.unit || best.item.unit || "шт",
          dbName: best.item.name,
          dbItemId: best.item.id,
          missingDb: false,
          dbSourceKey: "safe_db_picker_v22_5_1",
          dbPickScore: best.score,
          dbPickWarnings: best.warnings
        };
      }

      rows.push({
        row,
        picked: null,
        score: best?.score || 0,
        warnings: best?.warnings || [],
        candidates
      });

      return {
        ...row,
        missingDb: true,
        dbPickScore: best?.score || 0,
        dbPickWarnings: best?.warnings || []
      };
    });

    saveDraft(updated);

    const result = {
      dbCount: dbItems.length,
      picked,
      missed: updated.length - picked,
      warningsCount,
      rows
    };

    writeJson(RESULT_KEY, result);
    renderResult(result);

    if (window.PoolV22CleanMonolith?.open) {
      setTimeout(() => window.PoolV22CleanMonolith.open(), 100);
      setTimeout(() => renderResult(result), 250);
      setTimeout(() => renderResult(result), 700);
    }

    toast(`Безопасный подбор: найдено ${picked} из ${updated.length}.`);
    diag("pool-v22-5-safe-db-picked", "Безопасный подбор результата пула выполнен.", {
      dbCount: dbItems.length,
      picked,
      total: updated.length,
      warningsCount
    });
  }

  function ensurePanel() {
    const screen = document.getElementById("ep-pool-v22-screen");
    if (!screen) return null;

    let panel = document.getElementById("p224-db-result");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "p224-db-result";
      panel.className = "p22-card p224-db-result";

      const draftCard = Array.from(screen.querySelectorAll(".p22-card")).find(card => {
        return /Черновик расчета|Черновик расчёта/i.test(card.textContent || "");
      });

      if (draftCard) draftCard.insertAdjacentElement("beforebegin", panel);
      else screen.querySelector(".p22-shell")?.appendChild(panel);
    }

    return panel;
  }

  function renderResult(result) {
    const panel = ensurePanel();
    if (!panel) return;

    if (!result) result = readJson(RESULT_KEY, null);

    if (!result) {
      panel.innerHTML = `
        <div class="p22-list-head">
          <h3>Безопасный подбор из БД</h3>
          <button type="button" data-p225-pick>Подобрать</button>
        </div>
        <div class="p22-empty">После расчёта нажми «Подобрать из БД».</div>
      `;
      return;
    }

    const rowsHtml = (result.rows || []).map(x => {
      const row = x.row || {};
      const picked = x.picked;
      const warnings = x.warnings || [];

      if (picked) {
        return `
          <div class="p224-row ${warnings.length ? "warn" : "ok"}">
            <div>
              <b>${esc(row.name)}</b>
              <p>Подобрано: ${esc(picked.name)}</p>
              <small>safe_db_picker_v22_5_1 · score ${esc(x.score)}</small>
              ${warnings.length ? `<em>${warnings.map(esc).join("<br>")}</em>` : ""}
            </div>
            <strong>${money(picked.price)}</strong>
          </div>
        `;
      }

      const c = (x.candidates || [])[0];

      return `
        <div class="p224-row miss">
          <div>
            <b>${esc(row.name)}</b>
            <p>Не подобрано безопасно</p>
            <small>${c ? "Лучший кандидат: " + esc(c.item.name) + " · score " + esc(c.score) : "Кандидатов нет"}</small>
          </div>
          <strong>—</strong>
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="p22-list-head">
        <h3>Безопасный подбор из БД</h3>
        <button type="button" data-p225-pick>Повторить</button>
      </div>
      <div class="p224-summary">
        <span>База: ${esc(result.dbCount || 0)} поз.</span>
        <span>Найдено: ${esc(result.picked || 0)}</span>
        <span>Не найдено: ${esc(result.missed || 0)}</span>
        <span>Предупр.: ${esc(result.warningsCount || 0)}</span>
        <span>${VERSION}</span>
      </div>
      <div class="p224-list">${rowsHtml || `<div class="p22-empty">Нет строк для подбора.</div>`}</div>
    `;
  }

  function patchPickButton() {
    document.addEventListener("click", event => {
      const root = event.target.closest("#ep-pool-v22-screen");
      if (!root) return;

      const btn = event.target.closest("[data-p22-pick-db], [data-p224-pick], [data-p225-pick]");
      if (!btn) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pickDb();
    }, true);
  }

  function syncVersion() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}

    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el => {
      el.textContent = VERSION;
    });
  }

  function boot() {
    syncVersion();
    const screen = document.getElementById("ep-pool-v22-screen");
    if (screen && !screen.classList.contains("hidden") && screen.style.display !== "none") renderResult();
  }

  window.addEventListener("DOMContentLoaded", function () {
    patchPickButton();
    boot();
    setTimeout(boot, 500);
    setTimeout(boot, 1500);
    setTimeout(boot, 3000);
  });

  window.PoolV225SafeDbPicker = {
    version: VERSION,
    pickDb,
    collectDbItems,
    renderResult,
    scoreItem,
    isCompatibleKind
  };
})();




/* =========================================================
   MERGED INTO POOL V22.7 MONOLITH FROM: pool-v22-5-1-force-safe-picker.js
   ========================================================= */

(function () {
  const VERSION = "V22.7";
  const FILE = "assets/js/pool-v22-5-1-force-safe-picker.js";
  const RESULT_KEY = "ep_pool_v22_db_pick_result";

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV2251ForceSafePicker",
        functionName: "runtime",
        place: "pool-db-picker",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function clearOldPickResult() {
    try {
      localStorage.removeItem(RESULT_KEY);
    } catch (e) {}
  }

  function removeOldV224Panel() {
    const panel = document.getElementById("p224-db-result");
    if (!panel) return;
    const txt = panel.textContent || "";
    if (txt.includes("V22.4") || txt.includes("ep_pool_v22_db_pick_result")) {
      panel.remove();
    }
  }

  function markVersion() {
    if (window.PoolV226ManualDbCandidatePicker || window.PoolV2261VersionLockFix) return;
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}

    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el => {
      el.textContent = VERSION;
    });

    const panel = document.getElementById("p224-db-result");
    if (panel) {
      panel.querySelectorAll(".p224-summary span").forEach(el => {
        if ((el.textContent || "").startsWith("V22.")) el.textContent = VERSION;
      });

      const h3 = panel.querySelector("h3");
      if (h3) h3.textContent = "Безопасный подбор из БД";

      panel.querySelectorAll("small").forEach(sm => {
        sm.textContent = (sm.textContent || "").replace(/ep_pool_v22_db_pick_result/g, "safe_db_picker_v22_5_1");
      });
    }
  }

  function runSafePicker() {
    clearOldPickResult();
    removeOldV224Panel();

    if (window.PoolV225SafeDbPicker && typeof window.PoolV225SafeDbPicker.pickDb === "function") {
      window.PoolV225SafeDbPicker.pickDb();
      setTimeout(markVersion, 100);
      setTimeout(markVersion, 400);
      setTimeout(markVersion, 900);
      diag("pool-v22-5-1-safe-picker-run", "Запущен безопасный подбор V22.5.1.");
      return true;
    }

    console.warn("[V22.5.1] PoolV225SafeDbPicker.pickDb не найден");
    diag("pool-v22-5-1-safe-picker-missing", "PoolV225SafeDbPicker.pickDb не найден.");
    return false;
  }

  function interceptPickButtons() {
    if (window.__poolV2251InterceptInstalled) return;
    window.__poolV2251InterceptInstalled = true;

    document.addEventListener("click", function (event) {
      const root = event.target.closest("#ep-pool-v22-screen");
      if (!root) return;

      const btn = event.target.closest("[data-p22-pick-db], [data-p224-pick], [data-p225-pick]");
      if (!btn) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      runSafePicker();
    }, true);
  }

  function patchOldPicker() {
    if (window.PoolV224DbPicker) {
      try {
        window.PoolV224DbPicker.pickDb = runSafePicker;
        window.PoolV224DbPicker.renderResult = function () {};
      } catch (e) {}
    }
  }

  function patchOpen() {
    if (!window.PoolV22CleanMonolith || window.PoolV22CleanMonolith.__v2251Patched) return;

    const oldOpen = window.PoolV22CleanMonolith.open.bind(window.PoolV22CleanMonolith);

    window.PoolV22CleanMonolith.open = function () {
      const result = oldOpen();
      setTimeout(function () {
        removeOldV224Panel();
        markVersion();
      }, 150);
      setTimeout(markVersion, 700);
      return result;
    };

    window.PoolV22CleanMonolith.__v2251Patched = true;
  }

  function boot() {
    clearOldPickResult();
    removeOldV224Panel();
    interceptPickButtons();
    patchOldPicker();
    patchOpen();
    markVersion();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    setTimeout(boot, 300);
    setTimeout(boot, 1000);
    setTimeout(boot, 2500);
  });

  window.PoolV2251ForceSafePicker = {
    version: VERSION,
    runSafePicker,
    clearOldPickResult,
    removeOldV224Panel
  };
})();




/* =========================================================
   MERGED INTO POOL V22.7 MONOLITH FROM: pool-v22-6-manual-db-candidate-picker.js
   ========================================================= */

(function () {
  const VERSION = "V22.7";
  const FILE = "assets/js/pool-v22-6-manual-db-candidate-picker.js";
  const DRAFT_KEY = "ep_pool_v22_draft";
  const RESULT_KEY = "ep_pool_v22_db_pick_result";
  const MANUAL_KEY = "ep_pool_v22_manual_db_choices";

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV226ManualDbCandidatePicker",
        functionName: "runtime",
        place: "pool-db-picker",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    let box = document.getElementById("ep-pool-v22-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-pool-v22-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__p226Toast);
    window.__p226Toast = setTimeout(() => box.classList.remove("show"), 1700);
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function money(v) {
    return Math.round(n(v, 0)).toLocaleString("ru-RU") + " ₽";
  }

  function normalize(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[×хx]/g, "x")
      .replace(/[^a-zа-я0-9x.,\s/-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getDraft() {
    return readJson(DRAFT_KEY, []);
  }

  function saveDraft(draft) {
    writeJson(DRAFT_KEY, draft);
  }

  function getResult() {
    return readJson(RESULT_KEY, null);
  }

  function saveResult(result) {
    writeJson(RESULT_KEY, result);
  }

  function getManualChoices() {
    return readJson(MANUAL_KEY, {});
  }

  function saveManualChoices(value) {
    writeJson(MANUAL_KEY, value);
  }

  function rowKey(row) {
    return normalize([row?.type, row?.name, row?.unit, row?.query].join("|"));
  }

  function applyManualChoice(row, item) {
    const draft = getDraft();
    const key = rowKey(row);

    const updated = draft.map(d => {
      if (rowKey(d) !== key) return d;

      return {
        ...d,
        price: n(item.price, 0),
        unit: d.unit || item.unit || "шт",
        dbName: item.name,
        dbItemId: item.id,
        dbSourceKey: "manual_db_choice_v22_6",
        missingDb: false,
        dbPickScore: item.score || 999,
        dbPickWarnings: ["выбрано вручную"]
      };
    });

    saveDraft(updated);

    const choices = getManualChoices();
    choices[key] = {
      item,
      rowName: row.name,
      updatedAt: new Date().toISOString()
    };
    saveManualChoices(choices);

    const result = getResult();
    if (result && Array.isArray(result.rows)) {
      result.rows = result.rows.map(r => {
        if (rowKey(r.row) !== key) return r;
        return {
          ...r,
          picked: item,
          score: item.score || 999,
          warnings: ["выбрано вручную"],
          manual: true
        };
      });
      result.picked = result.rows.filter(r => r.picked).length;
      result.missed = result.rows.length - result.picked;
      result.warningsCount = result.rows.reduce((s, r) => s + ((r.warnings || []).length ? 1 : 0), 0);
      saveResult(result);
    }

    closeModal();

    if (window.PoolV22CleanMonolith?.open) {
      window.PoolV22CleanMonolith.open();
      setTimeout(() => window.PoolV225SafeDbPicker?.renderResult?.(getResult()), 160);
      setTimeout(markVersion, 260);
      setTimeout(markVersion, 800);
    }

    toast("Позиция выбрана вручную.");
    diag("pool-v22-6-manual-choice-applied", "Позиция БД выбрана вручную.", {
      row: row.name,
      item: item.name,
      price: item.price
    });
  }

  function removeManualChoice(row) {
    const key = rowKey(row);
    const choices = getManualChoices();
    delete choices[key];
    saveManualChoices(choices);
    toast("Ручной выбор сброшен. Нажми «Повторить» для автоподбора.");
    closeModal();
  }

  function ensureModal() {
    let modal = document.getElementById("p226-candidate-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "p226-candidate-modal";
    modal.className = "p226-modal hidden";
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    const modal = document.getElementById("p226-candidate-modal");
    if (modal) modal.classList.add("hidden");
  }

  function openCandidates(rowIndex) {
    const result = getResult();
    if (!result || !Array.isArray(result.rows)) {
      toast("Сначала сделай подбор из БД.");
      return;
    }

    const entry = result.rows[rowIndex];
    if (!entry) {
      toast("Строка подбора не найдена.");
      return;
    }

    const row = entry.row || {};
    const candidates = entry.candidates || [];
    const picked = entry.picked;

    const modal = ensureModal();

    const candidateRows = candidates.length ? candidates.map((c, idx) => {
      const item = {
        ...(c.item || c.picked || {}),
        score: c.score || 0,
        warnings: c.warnings || []
      };

      return `
        <button type="button" class="p226-candidate ${picked && picked.name === item.name ? "active" : ""}" data-p226-select="${idx}">
          <div>
            <b>${esc(item.name)}</b>
            <p>${esc(item.category || "")}${item.subcategory ? " · " + esc(item.subcategory) : ""}</p>
            <small>${esc(item.sourceKey || "БД")} · score ${esc(item.score || c.score || 0)}${(item.warnings || c.warnings || []).length ? " · есть предупреждение" : ""}</small>
          </div>
          <strong>${money(item.price)}</strong>
        </button>
      `;
    }).join("") : `<div class="p226-empty">Кандидатов нет. Можно добавить позицию в базу или улучшить название.</div>`;

    modal.innerHTML = `
      <div class="p226-backdrop" data-p226-close></div>
      <div class="p226-sheet">
        <div class="p226-head">
          <div>
            <h3>Выбор позиции из БД</h3>
            <p>${esc(row.name || "")}</p>
          </div>
          <button type="button" data-p226-close>×</button>
        </div>

        <div class="p226-current">
          <span>Сейчас:</span>
          <b>${picked ? esc(picked.name) : "не выбрано"}</b>
        </div>

        <div class="p226-list">
          ${candidateRows}
        </div>

        <div class="p226-actions">
          <button type="button" data-p226-reset>Сбросить ручной выбор</button>
          <button type="button" data-p226-close>Закрыть</button>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");

    modal.querySelectorAll("[data-p226-select]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = n(btn.getAttribute("data-p226-select"), -1);
        const candidate = candidates[idx];
        if (!candidate) return;
        const item = {
          ...(candidate.item || {}),
          score: candidate.score || 0,
          warnings: candidate.warnings || []
        };
        applyManualChoice(row, item);
      }, true);
    });

    modal.querySelectorAll("[data-p226-close]").forEach(btn => {
      btn.addEventListener("click", closeModal, true);
    });

    const reset = modal.querySelector("[data-p226-reset]");
    if (reset) reset.addEventListener("click", () => removeManualChoice(row), true);
  }

  function decorateRows() {
    const panel = document.getElementById("p224-db-result");
    const result = getResult();
    if (!panel || !result || !Array.isArray(result.rows)) return;

    const rows = Array.from(panel.querySelectorAll(".p224-row"));
    rows.forEach((el, index) => {
      if (el.dataset.p226Ready === "1") return;
      el.dataset.p226Ready = "1";
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");

      const hint = document.createElement("div");
      hint.className = "p226-row-hint";
      hint.textContent = "Нажми, чтобы выбрать другую позицию";
      el.appendChild(hint);

      el.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openCandidates(index);
      }, true);
    });
  }

  function applyManualBadges() {
    const result = getResult();
    const panel = document.getElementById("p224-db-result");
    if (!result || !panel) return;

    const choices = getManualChoices();
    const rows = Array.from(panel.querySelectorAll(".p224-row"));

    rows.forEach((el, index) => {
      const row = result.rows?.[index]?.row;
      if (!row) return;
      if (choices[rowKey(row)]) {
        el.classList.add("manual");
        if (!el.querySelector(".p226-manual-badge")) {
          const badge = document.createElement("div");
          badge.className = "p226-manual-badge";
          badge.textContent = "Выбрано вручную";
          el.appendChild(badge);
        }
      }
    });
  }

  function markVersion() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}

    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el => {
      el.textContent = VERSION;
    });

    const panel = document.getElementById("p224-db-result");
    if (panel) {
      panel.querySelectorAll(".p224-summary span").forEach(el => {
        if ((el.textContent || "").startsWith("V22.")) el.textContent = VERSION;
      });
    }
  }

  function boot() {
    markVersion();
    decorateRows();
    applyManualBadges();
  }

  function bindAfterPick() {
    document.addEventListener("click", event => {
      if (!event.target.closest("#ep-pool-v22-screen")) return;
      if (!event.target.closest("[data-p22-pick-db], [data-p224-pick], [data-p225-pick]")) return;
      setTimeout(boot, 300);
      setTimeout(boot, 900);
    }, true);
  }

  window.addEventListener("DOMContentLoaded", function () {
    bindAfterPick();
    boot();
    setTimeout(boot, 600);
    setTimeout(boot, 1600);
    setTimeout(boot, 3200);
  });

  window.PoolV226ManualDbCandidatePicker = {
    version: VERSION,
    openCandidates,
    applyManualChoice,
    removeManualChoice,
    decorateRows
  };
})();




/* =========================================================
   MERGED INTO POOL V22.7 MONOLITH FROM: pool-v22-6-1-version-lock-fix.js
   ========================================================= */

(function () {
  const VERSION = "V22.7";
  const FILE = "assets/js/pool-v22-6-1-version-lock-fix.js";

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV2261VersionLockFix",
        functionName: "runtime",
        place: "pool-db-picker",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function markVersion() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}

    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el => {
      el.textContent = VERSION;
    });

    const panel = document.getElementById("p224-db-result");
    if (panel) {
      panel.querySelectorAll(".p224-summary span").forEach(el => {
        if ((el.textContent || "").startsWith("V22.")) el.textContent = VERSION;
      });
    }
  }

  function decorateRowsAgain() {
    try {
      window.PoolV226ManualDbCandidatePicker?.decorateRows?.();
    } catch (e) {}
  }

  function patchOpen() {
    if (!window.PoolV22CleanMonolith || window.PoolV22CleanMonolith.__v2261VersionLockPatched) return;

    const oldOpen = window.PoolV22CleanMonolith.open.bind(window.PoolV22CleanMonolith);

    window.PoolV22CleanMonolith.open = function () {
      const result = oldOpen();
      [80, 250, 700, 1200, 2200].forEach(ms => {
        setTimeout(function () {
          markVersion();
          decorateRowsAgain();
        }, ms);
      });
      return result;
    };

    window.PoolV22CleanMonolith.__v2261VersionLockPatched = true;
  }

  function patchPickerClicks() {
    if (window.__v2261PickerClickLock) return;
    window.__v2261PickerClickLock = true;

    document.addEventListener("click", function (event) {
      if (!event.target.closest("#ep-pool-v22-screen")) return;
      if (!event.target.closest("[data-p22-pick-db], [data-p224-pick], [data-p225-pick]")) return;

      [100, 350, 850, 1400, 2400].forEach(ms => {
        setTimeout(function () {
          markVersion();
          decorateRowsAgain();
        }, ms);
      });
    }, true);
  }

  function boot() {
    patchOpen();
    patchPickerClicks();
    markVersion();
    decorateRowsAgain();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 800, 1500, 2500, 4000].forEach(ms => setTimeout(boot, ms));
  });

  window.PoolV2261VersionLockFix = {
    version: VERSION,
    markVersion,
    boot
  };

  diag("pool-v22-6-1-ready", "V22.6.1 version lock ready.");
})();




/* =========================================================
   MERGED INTO POOL V22.7 MONOLITH FROM: pool-v22-6-2-pool-version-guard.js
   ========================================================= */

(function () {
  const VERSION = "V22.7";
  const FILE = "assets/js/pool-v22-6-2-pool-version-guard.js";

  const POOL_SELECTORS = [
    "#ep-pool-v22-screen",
    "#p224-db-result"
  ];

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV2262VersionGuard",
        functionName: "runtime",
        place: "pool",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function isPoolOpen() {
    const screen = document.getElementById("ep-pool-v22-screen");
    if (!screen) return false;
    return !screen.classList.contains("hidden") && screen.style.display !== "none";
  }

  function forceVersion() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}

    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el => {
      el.textContent = VERSION;
    });

    const panel = document.getElementById("p224-db-result");
    if (panel) {
      panel.querySelectorAll(".p224-summary span").forEach(el => {
        const t = el.textContent || "";
        if (t.startsWith("V22.") || t.includes("V22.")) el.textContent = VERSION;
      });
    }

    // Иногда в карточках/бейджах версия текстом лежит отдельно.
    document.querySelectorAll("[data-module='pool'] .version, [data-route='pool'] .version, .pool-version, .module-version").forEach(el => {
      if ((el.textContent || "").includes("V22.")) el.textContent = VERSION;
    });
  }

  function decorateManualRows() {
    try { window.PoolV226ManualDbCandidatePicker?.decorateRows?.(); } catch (e) {}
    try { window.PoolV2261VersionLockFix?.markVersion?.(); } catch (e) {}
  }

  function afterPoolMutation(reason) {
    // Старые слои часто рисуют экран повторно с таймерами.
    [0, 60, 180, 420, 900, 1600, 2600].forEach(ms => {
      setTimeout(function () {
        forceVersion();
        decorateManualRows();
      }, ms);
    });

    diag("pool-v22-6-2-version-guard", "Версия пула зафиксирована после действия: " + reason);
  }

  function patchPoolOpen() {
    if (!window.PoolV22CleanMonolith || window.PoolV22CleanMonolith.__v2262VersionGuardPatched) return;

    const oldOpen = window.PoolV22CleanMonolith.open.bind(window.PoolV22CleanMonolith);

    window.PoolV22CleanMonolith.open = function () {
      const result = oldOpen();
      afterPoolMutation("open");
      return result;
    };

    window.PoolV22CleanMonolith.__v2262VersionGuardPatched = true;
  }

  function patchKnownPoolMethods() {
    const pool = window.PoolV22CleanMonolith;
    if (!pool || pool.__v2262MethodsPatched) return;

    [
      "render",
      "renderPool",
      "renderDraft",
      "removeGroup",
      "deleteGroup",
      "clearPool",
      "resetPool",
      "calculate",
      "calculateDraft",
      "addGroup"
    ].forEach(name => {
      if (typeof pool[name] !== "function") return;
      const old = pool[name].bind(pool);
      pool[name] = function (...args) {
        const result = old(...args);
        afterPoolMutation(name);
        return result;
      };
    });

    pool.__v2262MethodsPatched = true;
  }

  function patchClicks() {
    if (window.__v2262PoolClickGuard) return;
    window.__v2262PoolClickGuard = true;

    document.addEventListener("click", function (event) {
      if (!event.target.closest("#ep-pool-v22-screen")) return;

      const text = (event.target.textContent || "") + " " + (event.target.closest("button")?.textContent || "");
      const attr = [
        event.target.getAttribute?.("data-action"),
        event.target.getAttribute?.("data-p22-action"),
        event.target.closest("button")?.getAttribute?.("data-action"),
        event.target.closest("button")?.getAttribute?.("data-p22-action")
      ].filter(Boolean).join(" ");

      if (
        /удал|очист|рассчит|подобр|добав/i.test(text) ||
        /delete|remove|clear|calc|pick|add|reset/i.test(attr)
      ) {
        afterPoolMutation("click");
      }
    }, true);
  }

  function observePool() {
    if (window.__v2262PoolObserver) return;

    const target = document.body;
    if (!target) return;

    let timer = null;
    const observer = new MutationObserver(function (mutations) {
      if (!isPoolOpen()) return;

      const important = mutations.some(m => {
        if (!m.target) return false;
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!el) return false;
        return POOL_SELECTORS.some(sel => el.closest?.(sel) || el.matches?.(sel));
      });

      if (!important) return;

      clearTimeout(timer);
      timer = setTimeout(function () {
        forceVersion();
        decorateManualRows();
      }, 40);
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.__v2262PoolObserver = observer;
  }

  function boot() {
    patchPoolOpen();
    patchKnownPoolMethods();
    patchClicks();
    observePool();
    forceVersion();
    decorateManualRows();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();

    // Финальный страховочный проход после всех старых setTimeout.
    [250, 700, 1300, 2400, 4200, 7000].forEach(ms => setTimeout(boot, ms));
  });

  window.PoolV2262VersionGuard = {
    version: VERSION,
    forceVersion,
    afterPoolMutation,
    boot
  };

  diag("pool-v22-6-2-ready", "Pool V22.6.2 version guard ready.");
})();



/* =========================================================
   FINAL V22.7 MONOLITH GUARD
   ========================================================= */
(function(){
  const VERSION = "V22.7";
  function forceVersion(){
    try{
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    }catch(e){}
    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el=>{ el.textContent = VERSION; });
    const panel = document.getElementById("p224-db-result");
    if(panel){
      panel.querySelectorAll(".p224-summary span").forEach(el=>{
        const t = el.textContent || "";
        if(t.startsWith("V22.") || t.includes("V22.")) el.textContent = VERSION;
      });
    }
  }
  function decorate(){
    try{ window.PoolV226ManualDbCandidatePicker?.decorateRows?.(); }catch(e){}
  }
  function boot(){
    forceVersion();
    decorate();
  }
  window.addEventListener("DOMContentLoaded", function(){
    boot();
    [250,700,1300,2400,4200,7000].forEach(ms=>setTimeout(boot,ms));
    document.addEventListener("click", function(e){
      if(!e.target.closest("#ep-pool-v22-screen")) return;
      [80,250,700,1300,2400].forEach(ms=>setTimeout(boot,ms));
    }, true);
  });
  window.PoolV227StableMonolith = { version: VERSION, forceVersion, boot };
})();
