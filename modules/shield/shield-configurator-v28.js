/* ============================================================
   Electric Pro — Shield Configurator (clean module) V28.2
   Только экран КОНФИГУРАЦИИ: шаблоны, помещения, отдельные линии,
   марка/размер щита. Расчёт по БД -> V28.3, визуализация -> V28.4.

   Архитектура (как admin/subscription):
   - роутер грузит pages/shield.html (контейнер #ep-shield-v28-root)
   - роутер вызывает window.ShieldConfiguratorV28.bindPage()
   - модуль рисует UI в контейнер, состояние хранит в localStorage.
   Никакого прямого обращения к Firebase здесь нет.
   ============================================================ */
(() => {
  "use strict";
  if (window.__EP_SHIELD_V28_LOADED__) return;
  window.__EP_SHIELD_V28_LOADED__ = true;

  const CFG_KEY = "ep_shield_v28_config";

  // ---- помещения (счётчики) ----
  const ROOMS = [
    { key: "kits",       label: "Кухни",            icon: "🍳" },
    { key: "baths",      label: "Ванные",           icon: "🛁" },
    { key: "toilets",    label: "Санузлы",          icon: "🚽" },
    { key: "rooms",      label: "Комнаты",          icon: "🛋️" },
    { key: "bals",       label: "Балконы / лоджии", icon: "🌿" },
    { key: "warmFloors", label: "Тёплые полы",      icon: "♨️" },
    { key: "climates",   label: "Кондиционеры",     icon: "❄️" }
  ];

  // ---- отдельные линии (галочки) ----
  const LINES = [
    { key: "apron",   label: "Фартук кухни",        nom: "C16" },
    { key: "dish",    label: "Посудомойка",          nom: "C16" },
    { key: "washer",  label: "Стиралка / сушилка",   nom: "C16" },
    { key: "fridge",  label: "Холодильник (неоткл.)", nom: "C10" },
    { key: "router",  label: "Роутер (неоткл.)",     nom: "C6" },
    { key: "neptun",  label: "Нептун (неоткл.)",     nom: "C10" },
    { key: "towel",   label: "Полотенцесушитель",    nom: "C10" },
    { key: "boiler",  label: "Бойлер",               nom: "C16" },
    { key: "cooktop", label: "Варочная панель",      nom: "C32" },
    { key: "oven",    label: "Духовой шкаф",         nom: "C16" }
  ];

  // ---- опции щита (переключатели) ----
  const OPTS = [
    { key: "master", label: "Мастер-кнопка (только свет)" },
    { key: "uzm",    label: "Реле напряжения (УЗМ)" },
    { key: "scheme", label: "Однолинейная схема" },
    { key: "glands", label: "Кабельные вводы / сальники" }
  ];

  const BRANDS = ["IEK", "ABB", "Schneider", "EKF", "Legrand", "Tekfor"];
  const SIZES = [6, 12, 24, 36, 48, 60, 72];

  // ---- шаблоны быстрого старта ----
  const TEMPLATES = {
    studio: { kits: 1, baths: 1, toilets: 0, rooms: 1, bals: 0, warmFloors: 1, climates: 1 },
    one:    { kits: 1, baths: 1, toilets: 0, rooms: 1, bals: 1, warmFloors: 1, climates: 1 },
    two:    { kits: 1, baths: 1, toilets: 1, rooms: 2, bals: 1, warmFloors: 1, climates: 2 },
    three:  { kits: 1, baths: 1, toilets: 1, rooms: 3, bals: 1, warmFloors: 2, climates: 2 },
    euro:   { kits: 1, baths: 1, toilets: 0, rooms: 2, bals: 1, warmFloors: 1, climates: 1 },
    house:  { kits: 1, baths: 2, toilets: 1, rooms: 4, bals: 0, warmFloors: 3, climates: 3 }
  };
  const TEMPLATE_LABELS = {
    studio: "Студия", one: "1-комн.", two: "2-комн.",
    three: "3-комн.", euro: "Евро-2", house: "Дом"
  };

  function defaultConfig() {
    const rooms = {};
    ROOMS.forEach(r => rooms[r.key] = TEMPLATES.two[r.key] || 0);
    const lines = {};
    LINES.forEach(l => lines[l.key] = ["apron", "dish", "washer", "fridge", "router"].includes(l.key));
    const opts = { master: true, uzm: true, scheme: true, glands: false };
    return { template: "two", rooms, lines, opts, brand: "IEK", sizeMode: "auto", size: 24 };
  }

  function load() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (!raw) return defaultConfig();
      const c = JSON.parse(raw);
      const d = defaultConfig();
      return {
        template: c.template || d.template,
        rooms: Object.assign(d.rooms, c.rooms || {}),
        lines: Object.assign(d.lines, c.lines || {}),
        opts: Object.assign(d.opts, c.opts || {}),
        brand: c.brand || d.brand,
        sizeMode: c.sizeMode || d.sizeMode,
        size: c.size || d.size
      };
    } catch (e) { return defaultConfig(); }
  }

  function save(c) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {}
  }

  let cfg = load();

  const esc = v => String(v == null ? "" : v).replace(/[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Грубый предпросмотр количества линий (НЕ финальный расчёт — он в V28.3).
  function previewCounts() {
    const r = cfg.rooms;
    const lightGroups = (r.kits + r.baths + r.toilets + r.rooms + r.bals) || 0;
    const socketGroups = (r.kits + r.rooms) || 0;
    const wet = (r.baths + r.toilets) || 0;
    const warm = r.warmFloors || 0;
    const clim = r.climates || 0;
    const sepLines = LINES.reduce((n, l) => n + (cfg.lines[l.key] ? 1 : 0), 0);
    const lines = lightGroups + socketGroups + wet + warm + clim + sepLines;
    // очень грубо: ~2 модуля на линию + ввод/УЗМ/реле
    const modules = lines * 2 + (cfg.opts.uzm ? 2 : 0) + 4;
    const suggestedSize = SIZES.find(s => s >= modules) || 72;
    return { lines, modules, suggestedSize, sepLines, lightGroups, socketGroups };
  }

  // ---------- РЕНДЕР ----------
  function render() {
    const root = document.getElementById("ep-shield-v28-root");
    if (!root) return;

    const pc = previewCounts();
    const size = cfg.sizeMode === "auto" ? pc.suggestedSize : cfg.size;

    root.innerHTML = `
      <div class="shv28">
        <div class="shv28-card">
          <h3>Шаблон объекта</h3>
          <div class="shv28-note">Быстрый старт — потом поправь помещения вручную.</div>
          <div class="shv28-tpl">
            ${Object.keys(TEMPLATES).map(k =>
              `<button type="button" class="shv28-tpl-btn ${cfg.template === k ? "active" : ""}" data-tpl="${k}">${esc(TEMPLATE_LABELS[k])}</button>`
            ).join("")}
          </div>
        </div>

        <div class="shv28-card">
          <h3>Помещения</h3>
          <div class="shv28-rooms">
            ${ROOMS.map(r => `
              <div class="shv28-room">
                <span class="shv28-room-ic">${r.icon}</span>
                <span class="shv28-room-lb">${esc(r.label)}</span>
                <div class="shv28-stepper">
                  <button type="button" data-dec="${r.key}">−</button>
                  <input type="number" inputmode="numeric" min="0" data-room="${r.key}" value="${esc(cfg.rooms[r.key] || 0)}">
                  <button type="button" data-inc="${r.key}">+</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="shv28-card">
          <h3>Отдельные линии</h3>
          <div class="shv28-lines">
            ${LINES.map(l => `
              <button type="button" class="shv28-line ${cfg.lines[l.key] ? "on" : ""}" data-line="${l.key}">
                <span class="shv28-line-lb">${esc(l.label)}</span>
                <span class="shv28-nom">${esc(l.nom)}</span>
                <span class="shv28-tick">${cfg.lines[l.key] ? "✓" : ""}</span>
              </button>
            `).join("")}
          </div>
        </div>

        <div class="shv28-card">
          <h3>Опции щита</h3>
          <div class="shv28-opts">
            ${OPTS.map(o => `
              <button type="button" class="shv28-opt ${cfg.opts[o.key] ? "on" : ""}" data-opt="${o.key}">
                <span>${esc(o.label)}</span><b>${cfg.opts[o.key] ? "вкл" : "выкл"}</b>
              </button>
            `).join("")}
          </div>
        </div>

        <div class="shv28-card">
          <h3>Корпус щита</h3>
          <div class="shv28-grid2">
            <label>Марка
              <select data-brand>
                ${BRANDS.map(b => `<option ${cfg.brand === b ? "selected" : ""}>${esc(b)}</option>`).join("")}
              </select>
            </label>
            <label>Размер (модулей)
              <select data-size ${cfg.sizeMode === "auto" ? "disabled" : ""}>
                ${SIZES.map(s => `<option value="${s}" ${size === s ? "selected" : ""}>${s}</option>`).join("")}
              </select>
            </label>
          </div>
          <button type="button" class="shv28-sizemode ${cfg.sizeMode === "auto" ? "on" : ""}" data-sizemode>
            <span>Размер автоматически по числу модулей</span><b>${cfg.sizeMode === "auto" ? "авто" : "вручную"}</b>
          </button>
        </div>

        <div class="shv28-summary">
          <div><span>Линий (примерно)</span><b>${pc.lines}</b></div>
          <div><span>Модулей (примерно)</span><b>~${pc.modules}</b></div>
          <div><span>Щит</span><b>${esc(cfg.brand)} · ${size} мод.</b></div>
        </div>

        <button type="button" class="shv28-next" data-next>
          Рассчитать щит по БД →
          <small>подключим на шаге V28.3</small>
        </button>
      </div>
    `;
  }

  // ---------- СОБЫТИЯ ----------
  function clamp(n) { n = Math.floor(Number(n) || 0); return n < 0 ? 0 : n; }

  function bindOnce() {
    if (window.__EP_SHIELD_V28_BOUND__) return;
    window.__EP_SHIELD_V28_BOUND__ = true;

    document.addEventListener("click", (e) => {
      const root = document.getElementById("ep-shield-v28-root");
      if (!root || !root.contains(e.target)) return;

      const tpl = e.target.closest?.("[data-tpl]");
      if (tpl) {
        const k = tpl.dataset.tpl;
        cfg.template = k;
        ROOMS.forEach(r => cfg.rooms[r.key] = (TEMPLATES[k] || {})[r.key] || 0);
        save(cfg); render(); return;
      }
      const inc = e.target.closest?.("[data-inc]");
      if (inc) { cfg.rooms[inc.dataset.inc] = clamp((cfg.rooms[inc.dataset.inc] || 0) + 1); save(cfg); render(); return; }
      const dec = e.target.closest?.("[data-dec]");
      if (dec) { cfg.rooms[dec.dataset.dec] = clamp((cfg.rooms[dec.dataset.dec] || 0) - 1); save(cfg); render(); return; }
      const line = e.target.closest?.("[data-line]");
      if (line) { const k = line.dataset.line; cfg.lines[k] = !cfg.lines[k]; save(cfg); render(); return; }
      const opt = e.target.closest?.("[data-opt]");
      if (opt) { const k = opt.dataset.opt; cfg.opts[k] = !cfg.opts[k]; save(cfg); render(); return; }
      const sm = e.target.closest?.("[data-sizemode]");
      if (sm) { cfg.sizeMode = cfg.sizeMode === "auto" ? "manual" : "auto"; save(cfg); render(); return; }
      const next = e.target.closest?.("[data-next]");
      if (next) {
        alert("Конфигурация сохранена.\nРасчёт по БД и смета появятся на шаге V28.3, визуализация щита — V28.4.");
        return;
      }
    });

    // ручной ввод числа помещений + выбор марки/размера
    document.addEventListener("change", (e) => {
      const root = document.getElementById("ep-shield-v28-root");
      if (!root || !root.contains(e.target)) return;
      const ri = e.target.closest?.("input[data-room]");
      if (ri) { cfg.rooms[ri.dataset.room] = clamp(ri.value); save(cfg); render(); return; }
      const br = e.target.closest?.("select[data-brand]");
      if (br) { cfg.brand = br.value; save(cfg); render(); return; }
      const sz = e.target.closest?.("select[data-size]");
      if (sz) { cfg.size = Number(sz.value) || 24; save(cfg); render(); return; }
    });
  }

  // ---------- ТОЧКА ВХОДА (роутер) ----------
  function bindPage() {
    cfg = load();
    bindOnce();
    render();
  }

  window.ShieldConfiguratorV28 = { bindPage, render, getConfig: () => JSON.parse(JSON.stringify(cfg)) };
})();
