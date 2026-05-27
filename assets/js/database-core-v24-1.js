(function () {
  const VERSION = "V24.1";
  const FILE = "assets/js/database-core-v24-1.js";

  const KEYS = {
    active: "ep_db_v24_active_base",
    my: "ep_db_v24_my",
    server: "ep_db_v24_server",
    selected: "ep_db_v24_selected_ids"
  };

  const state = {
    activeBase: "my",
    search: "",
    typeFilter: "all",
    categoryFilter: "all",
    subcategoryFilter: "all",
    selectedIds: new Set()
  };

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const uid = () => "db_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DatabaseCoreV241",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    let box = document.getElementById("ep-db-v24-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-db-v24-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__dbV24Toast);
    window.__dbV24Toast = setTimeout(() => box.classList.remove("show"), 1800);
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "");
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
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

  function currentEmail() {
    try {
      return window.firebase?.auth?.().currentUser?.email || "";
    } catch (e) {}
    try {
      return window.auth?.currentUser?.email || "";
    } catch (e) {}
    try {
      return window.AppState?.user?.email || window.AppState?.profile?.email || "";
    } catch (e) {}
    return "";
  }

  function isAdmin() {
    const email = String(currentEmail() || "").toLowerCase();
    if (email === "vits0007@gmail.com") return true;

    try {
      const profile = window.AppState?.profile || {};
      if (profile.role === "admin" || profile.isAdmin === true) return true;
    } catch (e) {}

    try {
      const raw = localStorage.getItem("ep_user_role") || "";
      if (String(raw).toLowerCase().includes("admin")) return true;
    } catch (e) {}

    return false;
  }

  function seedItems() {
    return [
      {
        type: "work",
        name: "Штробление 20x30 бетон",
        category: "Штробление",
        subcategory: "Бетон",
        unit: "м",
        price: 550,
        aliases: ["штроба 20x30 бетон", "штробление бетон 20 на 30"],
        specs: { size: "20x30", wall: "бетон" }
      },
      {
        type: "work",
        name: "Штробление 25x30 бетон",
        category: "Штробление",
        subcategory: "Бетон",
        unit: "м",
        price: 600,
        aliases: ["штроба 25x30 бетон"],
        specs: { size: "25x30", wall: "бетон" }
      },
      {
        type: "work",
        name: "Штробление 30x30 бетон",
        category: "Штробление",
        subcategory: "Бетон",
        unit: "м",
        price: 700,
        aliases: ["штроба 30x30 бетон"],
        specs: { size: "30x30", wall: "бетон" }
      },
      {
        type: "work",
        name: "Штробление 50x40 бетон",
        category: "Штробление",
        subcategory: "Бетон",
        unit: "м",
        price: 950,
        aliases: ["штроба 50x40 бетон", "теплый пол штроба"],
        specs: { size: "50x40", wall: "бетон" }
      },
      {
        type: "work",
        name: "Высверливание подрозетников обычных бетон",
        category: "Высверливание",
        subcategory: "Обычные",
        unit: "шт",
        price: 450,
        aliases: ["высверливание подрозетник обычный", "сверление подрозетников"],
        specs: { wall: "бетон", depthType: "ordinary", depthMin: 40, depthMax: 50 }
      },
      {
        type: "work",
        name: "Высверливание подрозетников глубоких бетон",
        category: "Высверливание",
        subcategory: "Глубокие",
        unit: "шт",
        price: 650,
        aliases: ["высверливание глубоких подрозетников", "сверление глубокий подрозетник"],
        specs: { wall: "бетон", depthType: "deep", depthMin: 60, depthMax: 75 }
      },
      {
        type: "material",
        name: "Подрозетник 68x45",
        category: "Подрозетники",
        subcategory: "Обычные",
        unit: "шт",
        price: 35,
        aliases: ["подрозетник 40-50", "подрозетник обычный"],
        specs: { diameterMm: 68, depthMm: 45, depthType: "ordinary" }
      },
      {
        type: "material",
        name: "Подрозетник глубокий 68x65",
        category: "Подрозетники",
        subcategory: "Глубокие",
        unit: "шт",
        price: 55,
        aliases: ["подрозетник глубокий 60-75", "подрозетник глубокий"],
        specs: { diameterMm: 68, depthMm: 65, depthType: "deep" }
      },
      {
        type: "material",
        name: "ГМЛ 4",
        category: "Соединители",
        subcategory: "ГМЛ",
        unit: "шт",
        price: 12,
        aliases: ["гильза гмл 4", "гмл4"],
        specs: { connectorType: "gml", size: "4" }
      },
      {
        type: "material",
        name: "ГМЛ 6",
        category: "Соединители",
        subcategory: "ГМЛ",
        unit: "шт",
        price: 16,
        aliases: ["гильза гмл 6", "гмл6"],
        specs: { connectorType: "gml", size: "6" }
      },
      {
        type: "material",
        name: "ГМЛ 8",
        category: "Соединители",
        subcategory: "ГМЛ",
        unit: "шт",
        price: 20,
        aliases: ["гильза гмл 8", "гмл8"],
        specs: { connectorType: "gml", size: "8" }
      },
      {
        type: "material",
        name: "WAGO 2-пин",
        category: "Соединители",
        subcategory: "WAGO",
        unit: "шт",
        price: 35,
        aliases: ["ваго 2", "wago 2"],
        specs: { connectorType: "wago", pins: 2 }
      },
      {
        type: "material",
        name: "WAGO 3-пин",
        category: "Соединители",
        subcategory: "WAGO",
        unit: "шт",
        price: 42,
        aliases: ["ваго 3", "wago 3"],
        specs: { connectorType: "wago", pins: 3 }
      },
      {
        type: "material",
        name: "Термоусадка 12/4",
        category: "Расходники",
        subcategory: "Термоусадка",
        unit: "м",
        price: 80,
        aliases: ["термоусадка"],
        specs: { size: "12/4" }
      },
      {
        type: "material",
        name: "Распаячная коробка 80 мм",
        category: "Коробки",
        subcategory: "Распаячные",
        unit: "шт",
        price: 90,
        aliases: ["распайка", "распаячная коробка"],
        specs: { diameterMm: 80 }
      }
    ].map(item => normalizeItem({
      ...item,
      baseType: "server",
      source: "seed_v24_1"
    }));
  }

  function normalizeItem(item, baseType = state.activeBase) {
    const now = new Date().toISOString();
    const type = item.type === "work" ? "work" : "material";

    return {
      id: item.id || uid(),
      baseType: item.baseType || baseType,
      ownerUid: item.ownerUid || (baseType === "my" ? currentEmail() : "server"),
      type,
      name: String(item.name || "Позиция").trim(),
      category: String(item.category || (type === "work" ? "Работы" : "Материалы")).trim(),
      subcategory: String(item.subcategory || "Без подкатегории").trim(),
      unit: item.unit || "шт",
      price: n(item.price, 0),
      aliases: Array.isArray(item.aliases) ? item.aliases : [],
      specs: item.specs && typeof item.specs === "object" ? item.specs : {},
      source: item.source || "manual",
      sourceItemId: item.sourceItemId || "",
      active: item.active !== false,
      createdAt: item.createdAt || now,
      updatedAt: now
    };
  }

  function getBase(baseType = state.activeBase) {
    const key = baseType === "server" ? KEYS.server : KEYS.my;
    return readJson(key, []);
  }

  function setBase(baseType, items) {
    const key = baseType === "server" ? KEYS.server : KEYS.my;
    writeJson(key, Array.isArray(items) ? items : []);
  }

  function activeItems() {
    return getBase(state.activeBase).filter(item => item.active !== false);
  }

  function ensureSeed() {
    const server = getBase("server");
    if (!server.length) {
      setBase("server", seedItems());
    }

    const active = localStorage.getItem(KEYS.active);
    if (active === "server" || active === "my") state.activeBase = active;
    else state.activeBase = "my";
  }

  function canEditActive() {
    if (state.activeBase === "my") return true;
    return isAdmin();
  }

  function canCopyServerToMy() {
    return state.activeBase === "server";
  }

  function saveActiveBase() {
    localStorage.setItem(KEYS.active, state.activeBase);
  }

  function setActiveBase(baseType) {
    state.activeBase = baseType === "server" ? "server" : "my";
    state.selectedIds.clear();
    saveActiveBase();
    render();
  }

  function addItem() {
    if (!canEditActive()) {
      toast("БД сервера редактирует только админ. Можно добавить позицию в Мою БД.");
      return;
    }

    const typeRaw = prompt("Тип позиции: work = работа, material = материал", "material");
    if (typeRaw === null) return;

    const type = String(typeRaw).toLowerCase().includes("work") || String(typeRaw).toLowerCase().includes("работ") ? "work" : "material";
    const name = prompt("Название позиции", "");
    if (!name) return;

    const category = prompt("Категория", type === "work" ? "Работы" : "Материалы") || (type === "work" ? "Работы" : "Материалы");
    const subcategory = prompt("Подкатегория", "Без подкатегории") || "Без подкатегории";
    const unit = prompt("Единица измерения", "шт") || "шт";
    const price = n(prompt("Цена", "0"), 0);

    const items = getBase(state.activeBase);
    items.push(normalizeItem({ type, name, category, subcategory, unit, price }, state.activeBase));
    setBase(state.activeBase, items);
    toast("Позиция добавлена.");
    render();
  }

  function editItem(id) {
    if (!canEditActive()) {
      toast("БД сервера редактирует только админ.");
      return;
    }

    const items = getBase(state.activeBase);
    const item = items.find(x => x.id === id);
    if (!item) return;

    const name = prompt("Название", item.name);
    if (name === null) return;

    const category = prompt("Категория", item.category);
    if (category === null) return;

    const subcategory = prompt("Подкатегория", item.subcategory);
    if (subcategory === null) return;

    const unit = prompt("Единица", item.unit);
    if (unit === null) return;

    const price = prompt("Цена", String(item.price));
    if (price === null) return;

    Object.assign(item, {
      name,
      category,
      subcategory,
      unit,
      price: n(price, 0),
      updatedAt: new Date().toISOString()
    });

    setBase(state.activeBase, items);
    toast("Позиция обновлена.");
    render();
  }

  function deleteSelected() {
    if (!canEditActive()) {
      toast("БД сервера удаляет только админ.");
      return;
    }

    const ids = Array.from(state.selectedIds);
    if (!ids.length) {
      toast("Ничего не выбрано.");
      return;
    }

    if (!confirm(`Удалить выбранные позиции: ${ids.length}?`)) return;

    const items = getBase(state.activeBase).filter(item => !state.selectedIds.has(item.id));
    setBase(state.activeBase, items);
    state.selectedIds.clear();
    toast("Выбранные позиции удалены.");
    render();
  }

  function moveSelected() {
    if (!canEditActive()) {
      toast("БД сервера перемещает только админ.");
      return;
    }

    const ids = Array.from(state.selectedIds);
    if (!ids.length) {
      toast("Ничего не выбрано.");
      return;
    }

    const category = prompt("Новая категория", "");
    if (!category) return;

    const subcategory = prompt("Новая подкатегория", "Без подкатегории") || "Без подкатегории";

    const items = getBase(state.activeBase);
    items.forEach(item => {
      if (state.selectedIds.has(item.id)) {
        item.category = category;
        item.subcategory = subcategory;
        item.updatedAt = new Date().toISOString();
      }
    });

    setBase(state.activeBase, items);
    toast("Позиции перемещены.");
    render();
  }

  function createCategory() {
    if (!canEditActive()) {
      toast("БД сервера редактирует только админ.");
      return;
    }

    const category = prompt("Название новой категории", "");
    if (!category) return;

    const typeRaw = prompt("Для чего категория? work/material", "material");
    const type = String(typeRaw || "").toLowerCase().includes("work") || String(typeRaw || "").toLowerCase().includes("работ") ? "work" : "material";

    const items = getBase(state.activeBase);
    items.push(normalizeItem({
      type,
      name: "_category_placeholder_" + category,
      category,
      subcategory: "Без подкатегории",
      unit: "шт",
      price: 0,
      active: false,
      source: "category_placeholder"
    }, state.activeBase));

    setBase(state.activeBase, items);
    toast("Категория создана.");
    render();
  }

  function createSubcategory() {
    if (!canEditActive()) {
      toast("БД сервера редактирует только админ.");
      return;
    }

    const category = prompt("Категория", state.categoryFilter !== "all" ? state.categoryFilter : "");
    if (!category) return;

    const subcategory = prompt("Новая подкатегория", "");
    if (!subcategory) return;

    const typeRaw = prompt("Для чего подкатегория? work/material", "material");
    const type = String(typeRaw || "").toLowerCase().includes("work") || String(typeRaw || "").toLowerCase().includes("работ") ? "work" : "material";

    const items = getBase(state.activeBase);
    items.push(normalizeItem({
      type,
      name: "_subcategory_placeholder_" + category + "_" + subcategory,
      category,
      subcategory,
      unit: "шт",
      price: 0,
      active: false,
      source: "subcategory_placeholder"
    }, state.activeBase));

    setBase(state.activeBase, items);
    toast("Подкатегория создана.");
    render();
  }

  function copyServerToMy() {
    if (state.activeBase !== "server") {
      toast("Переключись на БД сервера.");
      return;
    }

    const ids = Array.from(state.selectedIds);
    if (!ids.length) {
      toast("Выбери позиции из БД сервера.");
      return;
    }

    const server = getBase("server");
    const my = getBase("my");

    let added = 0;
    let skipped = 0;

    ids.forEach(id => {
      const src = server.find(x => x.id === id);
      if (!src) return;

      const sig = normalize(src.type + "|" + src.name + "|" + src.unit);
      const exists = my.some(x => normalize(x.type + "|" + x.name + "|" + x.unit) === sig);

      if (exists) {
        skipped += 1;
        return;
      }

      my.push(normalizeItem({
        ...src,
        id: uid(),
        baseType: "my",
        ownerUid: currentEmail(),
        source: "server_copy",
        sourceItemId: src.id
      }, "my"));

      added += 1;
    });

    setBase("my", my);
    toast(`В Мою БД добавлено: ${added}. Дубли пропущены: ${skipped}.`);
    state.selectedIds.clear();
    render();
  }

  function exportJson() {
    const items = getBase(state.activeBase);
    const data = {
      version: VERSION,
      baseType: state.activeBase,
      exportedAt: new Date().toISOString(),
      items
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `electric-pro-${state.activeBase}-db-v24-1.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function importJsonFile(file) {
    if (!file) return;

    const name = file.name || "";
    const ext = name.split(".").pop().toLowerCase();

    if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
      toast("Картинка: режим ИИ-импорта будет подключён позже.");
      return;
    }

    if (["xlsx", "xls"].includes(ext)) {
      toast("Excel: внутренний импорт будет подключён отдельным шагом.");
      return;
    }

    if (ext === "pdf") {
      toast("PDF: внутренний импорт будет подключён отдельным шагом.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      try {
        let parsed = null;

        if (ext === "json") {
          parsed = JSON.parse(String(reader.result || "{}"));
        } else {
          const lines = String(reader.result || "")
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(Boolean);

          parsed = {
            items: lines.map(line => {
              const parts = line.split(/[;\t]/).map(x => x.trim());
              return {
                type: /работ|монтаж|штроб|сверл/i.test(parts[0]) ? "work" : "material",
                name: parts[0],
                category: parts[1] || "Импорт",
                subcategory: parts[2] || "Без подкатегории",
                unit: parts[3] || "шт",
                price: n(parts[4], 0),
                source: "import_text"
              };
            })
          };
        }

        const incoming = Array.isArray(parsed) ? parsed : (parsed.items || parsed.rows || []);
        if (!Array.isArray(incoming) || !incoming.length) {
          toast("Не удалось найти позиции в файле.");
          return;
        }

        if (!canEditActive()) {
          toast("БД сервера импортирует только админ. Переключись на Мою БД.");
          return;
        }

        const items = getBase(state.activeBase);
        incoming.forEach(x => items.push(normalizeItem(x, state.activeBase)));
        setBase(state.activeBase, items);

        toast(`Импортировано позиций: ${incoming.length}`);
        render();
      } catch (e) {
        toast("Ошибка импорта файла.");
        console.error(e);
      }
    };

    if (ext === "json" || ext === "txt" || ext === "csv") {
      reader.readAsText(file);
    } else {
      toast("Этот формат пока только заложен в интерфейс.");
    }
  }

  function search(query, options = {}) {
    const baseType = options.baseType || state.activeBase;
    const type = options.type || "";
    const q = normalize(Array.isArray(query) ? query.join(" ") : query);

    return getBase(baseType)
      .filter(item => item.active !== false)
      .filter(item => !type || item.type === type)
      .map(item => {
        const hay = normalize([
          item.name,
          item.category,
          item.subcategory,
          (item.aliases || []).join(" "),
          JSON.stringify(item.specs || {})
        ].join(" "));

        let score = 0;
        q.split(/\s+/).filter(Boolean).forEach(t => {
          if (hay.includes(t)) score += 10;
        });

        if (q && hay.includes(q)) score += 40;

        return { item, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  function categories(items = getBase(state.activeBase)) {
    const map = new Map();

    items.forEach(item => {
      const cat = item.category || "Без категории";
      const sub = item.subcategory || "Без подкатегории";
      if (!map.has(cat)) map.set(cat, new Set());
      map.get(cat).add(sub);
    });

    return Array.from(map.entries()).map(([category, subs]) => ({
      category,
      subcategories: Array.from(subs).sort()
    })).sort((a, b) => a.category.localeCompare(b.category));
  }

  function filteredItems() {
    const q = normalize(state.search);

    return getBase(state.activeBase)
      .filter(item => item.active !== false)
      .filter(item => state.typeFilter === "all" || item.type === state.typeFilter)
      .filter(item => state.categoryFilter === "all" || item.category === state.categoryFilter)
      .filter(item => state.subcategoryFilter === "all" || item.subcategory === state.subcategoryFilter)
      .filter(item => {
        if (!q) return true;
        const hay = normalize([
          item.name,
          item.category,
          item.subcategory,
          item.unit,
          item.price,
          (item.aliases || []).join(" ")
        ].join(" "));
        return hay.includes(q);
      });
  }

  function ensureScreen() {
    let screen = document.getElementById("ep-db-v24-screen");
    if (screen) return screen;

    screen = document.createElement("div");
    screen.id = "ep-db-v24-screen";
    screen.className = "db-v24-screen hidden";
    document.body.appendChild(screen);
    return screen;
  }

  function open() {
    ensureSeed();
    render();
    const screen = ensureScreen();
    screen.classList.remove("hidden");
    diag("database-open", "Экран БД открыт.", { activeBase: state.activeBase });
  }

  function close() {
    ensureScreen().classList.add("hidden");
  }

  function render() {
    const screen = ensureScreen();
    const admin = isAdmin();
    const items = filteredItems();
    const cats = categories();
    const selectedCount = state.selectedIds.size;
    const canEdit = canEditActive();

    const subcategories = state.categoryFilter === "all"
      ? Array.from(new Set(getBase(state.activeBase).map(x => x.subcategory || "Без подкатегории"))).sort()
      : Array.from(new Set(getBase(state.activeBase).filter(x => x.category === state.categoryFilter).map(x => x.subcategory || "Без подкатегории"))).sort();

    const editorActions = state.activeBase === "server" && !admin
      ? `<button type="button" data-db-copy-my>Добавить выбранное в Мою БД</button>`
      : `
        <button type="button" data-db-add>Добавить позицию</button>
        <button type="button" data-db-move>Переместить</button>
        <button type="button" data-db-delete>Удалить</button>
      `;

    screen.innerHTML = `
      <div class="db-v24-head">
        <button type="button" data-db-close>←</button>
        <div>
          <h2>База данных</h2>
          <p>${admin ? "Админ" : "Мастер"} · ${VERSION}</p>
        </div>
        <b>${state.activeBase === "server" ? "Сервер" : "Моя"}</b>
      </div>

      <div class="db-v24-shell">
        <section class="db-v24-card">
          <div class="db-v24-switch">
            <button type="button" data-db-base="server" class="${state.activeBase === "server" ? "active" : ""}">БД сервера</button>
            <button type="button" data-db-base="my" class="${state.activeBase === "my" ? "active" : ""}">Моя БД</button>
          </div>
          <div class="db-v24-note">
            ${state.activeBase === "server"
              ? (admin ? "Вы редактируете серверную базу." : "Мастер может смотреть и копировать позиции в Мою БД.")
              : "Личная база мастера. Редактирует только владелец."}
          </div>
        </section>

        <section class="db-v24-card">
          <div class="db-v24-card-head">
            <h3>Редактор выбранной БД</h3>
            <span>Выбрано: ${selectedCount}</span>
          </div>

          <div class="db-v24-file-actions">
            <button type="button" data-db-cat>+ Категория</button>
            <button type="button" data-db-subcat>+ Подкатегория</button>
            ${editorActions}
          </div>

          <div class="db-v24-tree">
            ${cats.map(cat => `
              <div class="db-v24-tree-cat">
                <b>${esc(cat.category)}</b>
                <div>
                  ${cat.subcategories.map(sub => `<span>${esc(sub)}</span>`).join("")}
                </div>
              </div>
            `).join("") || `<div class="db-v24-empty">Категорий пока нет.</div>`}
          </div>
        </section>

        <section class="db-v24-card">
          <div class="db-v24-card-head">
            <h3>Экспорт / импорт</h3>
            <span>режим авто</span>
          </div>

          <div class="db-v24-import">
            <button type="button" data-db-export>Экспорт JSON</button>
            <label>
              Импорт файла
              <input type="file" data-db-import accept=".json,.txt,.csv,.pdf,.xlsx,.xls,.png,.jpg,.jpeg,.webp">
            </label>
          </div>

          <p class="db-v24-small">
            Картинка → ИИ позже. PDF/Excel/JSON/текст → внутренние логики. Сейчас работает JSON и простой текст/CSV.
          </p>
        </section>

        <section class="db-v24-card">
          <div class="db-v24-card-head">
            <h3>Работы и материалы</h3>
            <span>${items.length} поз.</span>
          </div>

          <div class="db-v24-filters">
            <input type="search" data-db-search placeholder="Поиск..." value="${esc(state.search)}">
            <select data-db-type>
              <option value="all" ${state.typeFilter === "all" ? "selected" : ""}>Все</option>
              <option value="work" ${state.typeFilter === "work" ? "selected" : ""}>Работы</option>
              <option value="material" ${state.typeFilter === "material" ? "selected" : ""}>Материалы</option>
            </select>
            <select data-db-category>
              <option value="all">Все категории</option>
              ${cats.map(cat => `<option value="${esc(cat.category)}" ${state.categoryFilter === cat.category ? "selected" : ""}>${esc(cat.category)}</option>`).join("")}
            </select>
            <select data-db-subcategory>
              <option value="all">Все подкатегории</option>
              ${subcategories.map(sub => `<option value="${esc(sub)}" ${state.subcategoryFilter === sub ? "selected" : ""}>${esc(sub)}</option>`).join("")}
            </select>
          </div>

          <div class="db-v24-list">
            ${items.map(item => `
              <div class="db-v24-item ${state.selectedIds.has(item.id) ? "selected" : ""}">
                <label>
                  <input type="checkbox" data-db-check="${esc(item.id)}" ${state.selectedIds.has(item.id) ? "checked" : ""}>
                  <span>${item.type === "work" ? "Работа" : "Материал"}</span>
                </label>
                <div class="db-v24-item-main">
                  <b>${esc(item.name)}</b>
                  <p>${esc(item.category)} / ${esc(item.subcategory)}</p>
                  <small>${esc(item.unit)} · ${esc(item.price)} ₽ · ${esc(item.source || "manual")}</small>
                </div>
                <div class="db-v24-item-actions">
                  <strong>${esc(item.price)} ₽</strong>
                  ${canEdit ? `<button type="button" data-db-edit="${esc(item.id)}">Изм.</button>` : ""}
                </div>
              </div>
            `).join("") || `<div class="db-v24-empty">Позиции не найдены.</div>`}
          </div>
        </section>

        <section class="db-v24-card db-v24-warehouse">
          <div class="db-v24-card-head">
            <h3>Склад</h3>
            <span>следующий слой</span>
          </div>
          <p>Склад будет отдельным модулем: остатки, приход, списание, резерв на объект. Он будет брать позиции из этой БД.</p>
        </section>
      </div>
    `;
  }

  function addMenuButton() {
    const menus = [
      document.querySelector("#side-menu"),
      document.querySelector("#drawer"),
      document.querySelector(".side-menu"),
      document.querySelector(".sidebar"),
      document.querySelector(".drawer"),
      document.querySelector(".burger-menu"),
      document.querySelector("[data-menu]")
    ].filter(Boolean);

    menus.forEach(menu => {
      if (menu.querySelector("[data-db-v24-open]")) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-db-v24-open", "1");
      btn.className = "db-v24-menu-btn";
      btn.textContent = "🗂️ База данных";

      const homeBtn = menu.querySelector("[data-v223-home]");
      if (homeBtn && homeBtn.parentElement) {
        homeBtn.parentElement.insertBefore(btn, homeBtn.nextSibling);
      } else {
        menu.insertBefore(btn, menu.firstChild);
      }
    });
  }

  function patchRouter() {
    if (window.Router && typeof window.Router.load === "function" && !window.Router.__dbV24Patched) {
      const oldLoad = window.Router.load.bind(window.Router);
      window.Router.load = function (route, ...args) {
        const r = String(route || "").toLowerCase();
        if (r === "database" || r === "db" || r === "base") {
          open();
          return true;
        }
        return oldLoad(route, ...args);
      };
      window.Router.__dbV24Patched = true;
    }
  }

  function bindClicks() {
    if (window.__dbV24ClicksBound) return;
    window.__dbV24ClicksBound = true;

    document.addEventListener("click", event => {
      if (event.target.closest("[data-db-v24-open]")) {
        event.preventDefault();
        open();
        return;
      }

      const root = event.target.closest("#ep-db-v24-screen");
      if (!root) return;

      const closeBtn = event.target.closest("[data-db-close]");
      if (closeBtn) {
        event.preventDefault();
        close();
        return;
      }

      const baseBtn = event.target.closest("[data-db-base]");
      if (baseBtn) {
        event.preventDefault();
        setActiveBase(baseBtn.getAttribute("data-db-base"));
        return;
      }

      if (event.target.closest("[data-db-add]")) {
        event.preventDefault();
        addItem();
        return;
      }

      if (event.target.closest("[data-db-delete]")) {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if (event.target.closest("[data-db-move]")) {
        event.preventDefault();
        moveSelected();
        return;
      }

      if (event.target.closest("[data-db-cat]")) {
        event.preventDefault();
        createCategory();
        return;
      }

      if (event.target.closest("[data-db-subcat]")) {
        event.preventDefault();
        createSubcategory();
        return;
      }

      if (event.target.closest("[data-db-copy-my]")) {
        event.preventDefault();
        copyServerToMy();
        return;
      }

      if (event.target.closest("[data-db-export]")) {
        event.preventDefault();
        exportJson();
        return;
      }

      const edit = event.target.closest("[data-db-edit]");
      if (edit) {
        event.preventDefault();
        editItem(edit.getAttribute("data-db-edit"));
        return;
      }
    }, true);

    document.addEventListener("change", event => {
      const root = event.target.closest("#ep-db-v24-screen");
      if (!root) return;

      const check = event.target.closest("[data-db-check]");
      if (check) {
        const id = check.getAttribute("data-db-check");
        if (check.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        render();
        return;
      }

      const type = event.target.closest("[data-db-type]");
      if (type) {
        state.typeFilter = type.value;
        render();
        return;
      }

      const cat = event.target.closest("[data-db-category]");
      if (cat) {
        state.categoryFilter = cat.value;
        state.subcategoryFilter = "all";
        render();
        return;
      }

      const sub = event.target.closest("[data-db-subcategory]");
      if (sub) {
        state.subcategoryFilter = sub.value;
        render();
        return;
      }

      const importInput = event.target.closest("[data-db-import]");
      if (importInput) {
        importJsonFile(importInput.files && importInput.files[0]);
        importInput.value = "";
      }
    }, true);

    document.addEventListener("input", event => {
      const root = event.target.closest("#ep-db-v24-screen");
      if (!root) return;

      const searchInput = event.target.closest("[data-db-search]");
      if (searchInput) {
        state.search = searchInput.value;
        render();
      }
    }, true);
  }

  function boot() {
    ensureSeed();
    ensureScreen();
    bindClicks();
    patchRouter();
    addMenuButton();

    try {
      window.ModuleVersionBadgesV212?.setVersion?.("database", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [500, 1500, 3000].forEach(ms => setTimeout(boot, ms));
  });

  window.DatabaseCoreV241 = {
    version: VERSION,
    keys: KEYS,
    open,
    close,
    isAdmin,
    getBase,
    setBase,
    activeItems,
    setActiveBase,
    search,
    addItem,
    editItem,
    deleteSelected,
    moveSelected,
    copyServerToMy,
    exportJson,
    importJsonFile,
    normalizeItem,
    categories
  };

  diag("database-core-ready", "Database Core V24.1 ready.");
})();
