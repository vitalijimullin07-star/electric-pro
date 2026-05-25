(function () {
  const VERSION = "V24.2";
  const FILE = "assets/js/database-ui-v24-2-folders-cards.js";

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DatabaseUiV242FoldersCards",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function n(v, f = 0) {
    return Number.isFinite(Number(v)) ? Number(v) : f;
  }

  function activeScreen() {
    return document.getElementById("ep-db-v24-screen");
  }

  function isOpen() {
    const s = activeScreen();
    return s && !s.classList.contains("hidden");
  }

  function getActiveBaseFromBadge() {
    const txt = activeScreen()?.querySelector(".db-v24-head b")?.textContent || "";
    return /сервер/i.test(txt) ? "server" : "my";
  }

  function getItems() {
    try {
      const base = getActiveBaseFromBadge();
      return window.DatabaseCoreV241?.getBase?.(base) || [];
    } catch (e) {
      return [];
    }
  }

  function getItemById(id) {
    return getItems().find(x => x.id === id);
  }

  function currentType() {
    const select = activeScreen()?.querySelector("[data-db-type]");
    return select?.value || "all";
  }

  function setType(type) {
    const select = activeScreen()?.querySelector("[data-db-type]");
    if (!select) return;
    select.value = type;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(boot, 60);
  }

  function setCategory(category, subcategory = "all") {
    const screen = activeScreen();
    if (!screen) return;

    const cat = screen.querySelector("[data-db-category]");
    const sub = screen.querySelector("[data-db-subcategory]");

    if (cat) {
      cat.value = category || "all";
      cat.dispatchEvent(new Event("change", { bubbles: true }));
    }

    setTimeout(() => {
      const sub2 = activeScreen()?.querySelector("[data-db-subcategory]");
      if (sub2) {
        sub2.value = subcategory || "all";
        sub2.dispatchEvent(new Event("change", { bubbles: true }));
      }
      setTimeout(boot, 60);
    }, 60);
  }

  function injectTypeButtons() {
    const screen = activeScreen();
    if (!screen) return;

    const filters = screen.querySelector(".db-v24-filters");
    if (!filters || screen.querySelector(".db-v24-type-buttons")) return;

    const wrap = document.createElement("div");
    wrap.className = "db-v24-type-buttons";
    wrap.innerHTML = `
      <button type="button" data-db-v242-type="all">Все</button>
      <button type="button" data-db-v242-type="work">Работы</button>
      <button type="button" data-db-v242-type="material">Материалы</button>
    `;

    filters.insertAdjacentElement("beforebegin", wrap);
    syncTypeButtons();
  }

  function syncTypeButtons() {
    const screen = activeScreen();
    if (!screen) return;

    const type = currentType();
    screen.querySelectorAll("[data-db-v242-type]").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-db-v242-type") === type);
    });

    const nativeType = screen.querySelector("[data-db-type]");
    if (nativeType) {
      nativeType.closest("select")?.classList.add("db-v24-native-type-hidden");
    }
  }

  function buildFolderTree() {
    const screen = activeScreen();
    if (!screen) return;

    const tree = screen.querySelector(".db-v24-tree");
    if (!tree || tree.dataset.v242Ready === "1") return;

    tree.dataset.v242Ready = "1";

    tree.querySelectorAll(".db-v24-tree-cat").forEach(catEl => {
      const title = (catEl.querySelector("b")?.textContent || "").trim();
      const subs = Array.from(catEl.querySelectorAll("span")).map(s => s.textContent.trim()).filter(Boolean);

      catEl.classList.add("folder-closed");
      catEl.innerHTML = `
        <button type="button" class="db-v242-folder-head" data-db-v242-folder="${esc(title)}">
          <span class="db-v242-folder-icon">📁</span>
          <b>${esc(title)}</b>
          <em>${subs.length}</em>
        </button>
        <div class="db-v242-folder-body">
          <button type="button" data-db-v242-open-cat="${esc(title)}">Все в категории</button>
          ${subs.map(sub => `<button type="button" data-db-v242-open-sub="${esc(title)}||${esc(sub)}">${esc(sub)}</button>`).join("")}
        </div>
      `;
    });
  }

  function openCard(id) {
    const item = getItemById(id);
    if (!item) return;

    let modal = document.getElementById("db-v242-card-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db-v242-card-modal";
      modal.className = "db-v242-card-modal hidden";
      document.body.appendChild(modal);
    }

    const specs = item.specs && typeof item.specs === "object"
      ? Object.entries(item.specs).filter(([_, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `<span>${esc(k)}: ${esc(v)}</span>`).join("")
      : "";

    const aliases = Array.isArray(item.aliases) && item.aliases.length
      ? item.aliases.map(a => `<span>${esc(a)}</span>`).join("")
      : "";

    modal.innerHTML = `
      <div class="db-v242-modal-backdrop" data-db-v242-close></div>
      <div class="db-v242-card-sheet">
        <div class="db-v242-card-head">
          <div>
            <h3>${esc(item.name)}</h3>
            <p>${item.type === "work" ? "Работа" : "Материал"} · ${esc(item.category)} / ${esc(item.subcategory)}</p>
          </div>
          <button type="button" data-db-v242-close>×</button>
        </div>

        <div class="db-v242-price">
          <span>Цена</span>
          <b>${esc(item.price)} ₽ / ${esc(item.unit || "шт")}</b>
        </div>

        <div class="db-v242-card-grid">
          <div><span>База</span><b>${esc(item.baseType || getActiveBaseFromBadge())}</b></div>
          <div><span>Источник</span><b>${esc(item.source || "manual")}</b></div>
          <div><span>ID</span><b>${esc(item.id)}</b></div>
          <div><span>Обновлено</span><b>${esc((item.updatedAt || "").slice(0, 19).replace("T", " "))}</b></div>
        </div>

        <div class="db-v242-tags">
          <h4>Характеристики</h4>
          <div>${specs || "<span>Нет характеристик</span>"}</div>
        </div>

        <div class="db-v242-tags">
          <h4>Псевдонимы / поиск</h4>
          <div>${aliases || "<span>Нет псевдонимов</span>"}</div>
        </div>

        <div class="db-v242-card-actions">
          <button type="button" data-db-v242-edit="${esc(item.id)}">Редактировать</button>
          <button type="button" data-db-v242-copy-name="${esc(item.id)}">Копировать название</button>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  function closeCard() {
    document.getElementById("db-v242-card-modal")?.classList.add("hidden");
  }

  function decorateItems() {
    const screen = activeScreen();
    if (!screen) return;

    screen.querySelectorAll(".db-v24-item").forEach(itemEl => {
      if (itemEl.dataset.v242Ready === "1") return;
      itemEl.dataset.v242Ready = "1";

      const id = itemEl.querySelector("[data-db-check]")?.getAttribute("data-db-check");
      if (!id) return;

      const hint = document.createElement("div");
      hint.className = "db-v242-card-hint";
      hint.textContent = "Открыть карточку позиции";
      itemEl.querySelector(".db-v24-item-main")?.appendChild(hint);

      itemEl.querySelector(".db-v24-item-main")?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openCard(id);
      }, true);
    });
  }

  function markVersion() {
    const screen = activeScreen();
    if (!screen) return;

    const p = screen.querySelector(".db-v24-head p");
    if (p) {
      p.textContent = p.textContent.replace(/V24\.\d+/g, VERSION);
      if (!p.textContent.includes(VERSION)) p.textContent += " · " + VERSION;
    }

    try {
      window.ModuleVersionBadgesV212?.setVersion?.("database", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}
  }

  function boot() {
    if (!isOpen()) return;
    injectTypeButtons();
    syncTypeButtons();
    buildFolderTree();
    decorateItems();
    markVersion();
  }

  function bind() {
    if (window.__dbV242Bound) return;
    window.__dbV242Bound = true;

    document.addEventListener("click", event => {
      const typeBtn = event.target.closest("[data-db-v242-type]");
      if (typeBtn) {
        event.preventDefault();
        setType(typeBtn.getAttribute("data-db-v242-type"));
        return;
      }

      const folder = event.target.closest("[data-db-v242-folder]");
      if (folder) {
        event.preventDefault();
        const cat = folder.closest(".db-v24-tree-cat");
        if (cat) cat.classList.toggle("folder-closed");
        if (cat) cat.classList.toggle("folder-open");
        return;
      }

      const openCat = event.target.closest("[data-db-v242-open-cat]");
      if (openCat) {
        event.preventDefault();
        setCategory(openCat.getAttribute("data-db-v242-open-cat"), "all");
        return;
      }

      const openSub = event.target.closest("[data-db-v242-open-sub]");
      if (openSub) {
        event.preventDefault();
        const [cat, sub] = String(openSub.getAttribute("data-db-v242-open-sub") || "").split("||");
        setCategory(cat, sub);
        return;
      }

      if (event.target.closest("[data-db-v242-close]")) {
        event.preventDefault();
        closeCard();
        return;
      }

      const edit = event.target.closest("[data-db-v242-edit]");
      if (edit) {
        event.preventDefault();
        const id = edit.getAttribute("data-db-v242-edit");
        closeCard();
        try { window.DatabaseCoreV241?.editItem?.(id); } catch (e) {}
        setTimeout(boot, 250);
        return;
      }

      const copy = event.target.closest("[data-db-v242-copy-name]");
      if (copy) {
        event.preventDefault();
        const item = getItemById(copy.getAttribute("data-db-v242-copy-name"));
        if (item && navigator.clipboard) navigator.clipboard.writeText(item.name);
        return;
      }
    }, true);

    document.addEventListener("change", event => {
      if (!event.target.closest("#ep-db-v24-screen")) return;
      setTimeout(boot, 80);
    }, true);

    document.addEventListener("input", event => {
      if (!event.target.closest("#ep-db-v24-screen")) return;
      setTimeout(boot, 120);
    }, true);
  }

  function patchOpen() {
    if (!window.DatabaseCoreV241 || window.DatabaseCoreV241.__v242Patched) return;
    const oldOpen = window.DatabaseCoreV241.open?.bind(window.DatabaseCoreV241);
    if (typeof oldOpen === "function") {
      window.DatabaseCoreV241.open = function (...args) {
        const result = oldOpen(...args);
        [60, 180, 450, 900].forEach(ms => setTimeout(boot, ms));
        return result;
      };
      window.DatabaseCoreV241.__v242Patched = true;
    }
  }

  window.addEventListener("DOMContentLoaded", function () {
    bind();
    patchOpen();

    [500, 1500, 3000].forEach(ms => setTimeout(function () {
      patchOpen();
      boot();
    }, ms));
  });

  window.DatabaseUiV242FoldersCards = {
    version: VERSION,
    boot,
    openCard,
    closeCard
  };

  diag("database-ui-v24-2-ready", "Database UI V24.2 folders/cards ready.");
})();
