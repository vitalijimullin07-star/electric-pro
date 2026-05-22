(function () {
  const VERSION = "V22.2";
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
