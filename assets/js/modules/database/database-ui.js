/* ============================================================
   Electric Pro V29 — Database / UI
   Экран-редактор БД в стиле файлового менеджера.
   Монтируется ЧИСТО по событию ep:route-loaded (route==="database"),
   без MutationObserver. Слушатели навешиваются на свой контейнер
   #ep-db-root (живёт ровно столько, сколько открыта страница).
   Стиль — токены V29 (page/card/btn/badge/grid + database.css).
   ============================================================ */
(() => {
  "use strict";
  window.EP = window.EP || {};
  EP.Database = EP.Database || {};
  const DB = EP.Database;

  const state = {
    base: null,            // "my" | "server"
    type: "material",      // "material" | "work"
    category: "",          // "" = все
    subcategory: "",       // "" = все
    search: "",
    selected: new Set(),
    expanded: new Set(),   // раскрытые папки/подпапки: "c:Категория", "c:Категория|s:Подкат"
    addOpen: false,
    editId: null
  };
  let rootEl = null;

  // ---------- утилиты ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function priceText(n, cur) {
    if (window.EP.Currency && EP.Currency.format) return EP.Currency.format(n, cur);
    const v = typeof n === "number" ? n : parseFloat(String(n).replace(",", ".")) || 0;
    return v.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";
  }
  function isMy() { return state.base === "my"; }

  // ---------- выборка под текущие фильтры ----------
  function visibleItems() {
    let items = DB.getItemsByType(state.type, state.base);
    if (state.category) items = items.filter((x) => x.category === state.category);
    if (state.subcategory) items = items.filter((x) => x.subcategory === state.subcategory);
    if (state.search) {
      const q = state.search.toLowerCase();
      items = items.filter((x) =>
        x.name.toLowerCase().includes(q) ||
        x.category.toLowerCase().includes(q) ||
        x.subcategory.toLowerCase().includes(q));
    }
    return items;
  }

  // ---------- рендер ----------
  function render() {
    if (!rootEl) return;
    const c = DB.counts(state.base);
    const cats = DB.categories(state.type, state.base);
    const items = visibleItems();
    const selCount = state.selected.size;

    rootEl.innerHTML = `
      <div class="ep-db">
        <div class="ep-db-bases">
          <button class="ep-db-pill ${state.base === "server" ? "is-active" : ""}" data-db-base="server" type="button">🗄️ БД сервера</button>
          <button class="ep-db-pill ${state.base === "my" ? "is-active" : ""}" data-db-base="my" type="button">⭐ Моя БД</button>
          <span class="badge ep-db-count">${c.material} мат · ${c.work} раб</span>
        </div>

        ${renderSyncBlock()}

        <div class="ep-db-actions">
          ${isMy() ? `
            <button class="btn btn-primary ep-clickable" data-db-add type="button">＋ Добавить</button>
            <button class="btn btn-ghost ep-clickable" data-db-move type="button" ${selCount ? "" : "disabled"}>🗂️ Переместить</button>
            <button class="btn btn-ghost ep-clickable ep-db-danger" data-db-del type="button" ${selCount ? "" : "disabled"}>🗑️ Удалить</button>
            <button class="btn btn-ghost ep-clickable" data-db-import type="button">⬇️ Импорт</button>
            <button class="btn btn-ghost ep-clickable" data-db-export type="button">⬆️ Экспорт</button>
            <button class="btn btn-ghost ep-clickable" data-db-backup type="button">📦 Бэкап всего</button>
            <button class="btn btn-ghost ep-clickable" data-db-restore type="button">📦 Восстановить</button>
          ` : `
            <button class="btn btn-primary ep-clickable" data-db-copy type="button" ${selCount ? "" : "disabled"}>⭐ В Мою БД (${selCount})</button>
            <button class="btn btn-ghost ep-clickable" data-db-export type="button">⬆️ Экспорт</button>
          `}
        </div>

        <div class="ep-db-toolbar">
          <div class="ep-db-types">
            <button class="ep-db-tab ${state.type === "material" ? "is-active" : ""}" data-db-type="material" type="button">📦 Материалы</button>
            <button class="ep-db-tab ${state.type === "work" ? "is-active" : ""}" data-db-type="work" type="button">🧰 Работа</button>
          </div>
          <input class="ep-db-search" type="search" placeholder="Поиск по названию…" value="${esc(state.search)}" data-db-search />
          ${renderCurrencyPicker()}
        </div>

        <div class="ep-db-chips" data-db-cats>
          <button class="ep-db-chip ${!state.category ? "is-active" : ""}" data-db-cat="" type="button">📂 Все категории</button>
          ${cats.map((cat) => `<button class="ep-db-chip ${state.category === cat ? "is-active" : ""}" data-db-cat="${esc(cat)}" type="button">${esc(cat)}</button>`).join("")}
        </div>

        ${isMy() && state.addOpen ? renderAddForm() : ""}

        <div class="ep-db-listhead">
          <label class="ep-db-selall"><input type="checkbox" data-db-selall ${selCount && selCount === items.length ? "checked" : ""}/> Выбрать все</label>
          <span class="ep-db-listinfo">${items.length} позиц.${selCount ? " · выбрано " + selCount : ""}</span>
        </div>

        <div class="ep-db-list">
          ${renderContent()}
        </div>
      </div>
    `;
  }

  // выбор валюты
  function renderCurrencyPicker() {
    if (!(window.EP.Currency && EP.Currency.list)) return "";
    const cur = EP.Currency.code();
    return `<select class="ep-db-cur" data-db-cur title="Валюта">
      ${EP.Currency.list().map((c) => `<option value="${c.code}" ${c.code === cur ? "selected" : ""}>${c.symbol} ${c.code}</option>`).join("")}
    </select>`;
  }

  // блок статуса синхронизации с Firebase
  const SYNC_STATE_RU = { init: "проверка…", connected: "подключено", "signed-out": "нет входа", error: "ошибка", "permission-denied": "нет прав", cache: "локальный кэш", offline: "недоступно" };
  const SYNC_DOT = { connected: "#22c55e", "permission-denied": "#f59e0b", cache: "#f59e0b", error: "#ef4444", "signed-out": "#a7b0c0" };

  let syncOpen = false;
  function renderSyncBlock() {
    const s = (EP.Database.getFirestoreStatus && EP.Database.getFirestoreStatus()) || { state: "offline" };
    const admin = !!(EP.DatabaseSync && EP.DatabaseSync.isAdmin && EP.DatabaseSync.isAdmin());
    const dot = SYNC_DOT[s.state] || "#a7b0c0";
    const time = s.lastSync ? new Date(s.lastSync).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
    return `
      <div class="card ep-db-sync" data-db-syncblock>
        <div class="ep-db-syncline">
          <span class="ep-db-sync-dot" style="background:${dot}"></span>
          <span class="ep-db-sync-state">Firebase: ${SYNC_STATE_RU[s.state] || s.state}</span>
          <span class="ep-db-sync-counts">Моя ${s.myCount == null ? "–" : s.myCount} · Сервер ${s.serverCount == null ? "–" : s.serverCount}</span>
          ${time ? `<span class="ep-db-sync-time">${time}</span>` : ""}
          <button class="ep-db-sync-toggle" data-db-sync-toggle type="button" aria-label="Синхронизация">⇅</button>
        </div>
        ${s.message && s.state !== "connected" ? `<div class="ep-db-sync-msg">${esc(s.message)}</div>` : ""}
        ${syncOpen ? `<div class="ep-db-sync-btns">
          <button class="btn btn-ghost ep-clickable" data-db-pull type="button">⬇️ Firebase → локально</button>
          <button class="btn btn-ghost ep-clickable" data-db-push-my type="button">⬆️ Моя → Firebase</button>
          ${admin ? `<button class="btn btn-ghost ep-clickable" data-db-push-server type="button">⬆️ Сервер → Firebase</button>` : ""}
        </div>` : ""}
      </div>`;
  }

  function updateSyncBlock() {
    if (!rootEl || !document.body.contains(rootEl)) return;
    const el = rootEl.querySelector("[data-db-syncblock]");
    if (!el) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = renderSyncBlock();
    const fresh = tmp.firstElementChild;
    if (fresh) el.replaceWith(fresh);
  }

  // контент: при поиске — плоский список; иначе — дерево папок
  function renderContent() {
    if (state.search) {
      const items = visibleItems();
      return items.length ? items.map(renderRow).join("") : `<div class="ep-db-empty">Ничего не найдено.</div>`;
    }
    return renderTree();
  }

  function renderFolderCount(n) {
    return `<span class="ep-db-fold-count">${n}</span>`;
  }

  // дерево: Категория(папка) → Подкатегория(подпапка) → карточки
  function renderTree() {
    const type = state.type, base = state.base;
    const all = DB.getItemsByType(type, base);
    if (!all.length) return `<div class="ep-db-empty">Пусто. ${isMy() ? "Добавь позицию или импортируй." : "В серверной базе нет позиций этого типа."}</div>`;
    const cats = state.category ? [state.category] : DB.categories(type, base);
    // позиции без категории — отдельной псевдо-папкой, если есть
    const noCat = all.filter((x) => !x.category);
    let html = "";
    cats.forEach((cat) => { html += renderCatFolder(cat, all.filter((x) => x.category === cat)); });
    if (!state.category && noCat.length) html += renderCatFolder("", noCat);
    return html || `<div class="ep-db-empty">Нет позиций.</div>`;
  }

  function renderCatFolder(cat, catItems) {
    const ckey = "c:" + cat;
    const open = state.category ? true : state.expanded.has(ckey);
    const subs = Array.from(new Set(catItems.map((x) => x.subcategory).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "ru"));
    const noSub = catItems.filter((x) => !x.subcategory);
    return `
      <div class="ep-db-folder ${open ? "is-open" : ""}">
        <button class="ep-db-folder-head" data-db-folder="${esc(ckey)}" type="button">
          <span class="ep-db-fold-ico">${open ? "📂" : "📁"}</span>
          <span class="ep-db-fold-name">${esc(cat) || "Без категории"}</span>
          ${renderFolderCount(catItems.length)}
        </button>
        ${open ? `
          <div class="ep-db-folder-body">
            ${noSub.map(renderRow).join("")}
            ${subs.map((sub) => {
              const skey = ckey + "|s:" + sub;
              const sopen = state.expanded.has(skey);
              const subItems = catItems.filter((x) => x.subcategory === sub);
              return `
                <div class="ep-db-subfolder ${sopen ? "is-open" : ""}">
                  <button class="ep-db-subfolder-head" data-db-folder="${esc(skey)}" type="button">
                    <span class="ep-db-fold-ico">${sopen ? "📂" : "📁"}</span>
                    <span class="ep-db-subfold-name">${esc(sub)}</span>
                    ${renderFolderCount(subItems.length)}
                  </button>
                  ${sopen ? `<div class="ep-db-subfolder-body">${subItems.map(renderRow).join("")}</div>` : ""}
                </div>`;
            }).join("")}
          </div>` : ""}
      </div>`;
  }

  function renderRow(it) {
    const checked = state.selected.has(it.id) ? "checked" : "";
    if (isMy() && state.editId === it.id) return renderEditRow(it);
    return `
      <div class="ep-db-row" data-db-row="${esc(it.id)}">
        <input type="checkbox" class="ep-db-check" data-db-pick="${esc(it.id)}" ${checked}/>
        <div class="ep-db-row-main">
          <div class="ep-db-row-name">${esc(it.name) || "<без названия>"}</div>
        </div>
        <div class="ep-db-row-price">${priceText(it.price, it.currency)}${it.unit ? `<span class="ep-db-row-unit">${esc(it.unit)}</span>` : ""}</div>
        ${isMy() ? `<button class="ep-db-iconbtn" data-db-edit="${esc(it.id)}" type="button" aria-label="Изменить">✏️</button>` : ""}
        <button class="ep-db-iconbtn" data-db-toest="${esc(it.id)}" type="button" aria-label="В смету">＋</button>
      </div>`;
  }

  function renderEditRow(it) {
    return `
      <div class="ep-db-row ep-db-row-edit" data-db-editrow="${esc(it.id)}">
        <div class="ep-db-edit-grid">
          <input class="ep-db-input" data-ef="name" value="${esc(it.name)}" placeholder="Название"/>
          <input class="ep-db-input" data-ef="category" value="${esc(it.category)}" placeholder="Категория"/>
          <input class="ep-db-input" data-ef="subcategory" value="${esc(it.subcategory)}" placeholder="Подкатегория"/>
          <input class="ep-db-input ep-db-input-sm" data-ef="unit" value="${esc(it.unit)}" placeholder="Ед."/>
          <input class="ep-db-input ep-db-input-sm" data-ef="price" value="${esc(it.price)}" inputmode="decimal" placeholder="Цена"/>
        </div>
        <div class="ep-db-edit-actions">
          <button class="btn btn-primary ep-clickable" data-db-savedit="${esc(it.id)}" type="button">Сохранить</button>
          <button class="btn btn-ghost ep-clickable" data-db-canceledit type="button">Отмена</button>
        </div>
      </div>`;
  }

  function renderAddForm() {
    return `
      <div class="card ep-db-addform">
        <div class="ep-db-edit-grid">
          <input class="ep-db-input" data-af="name" placeholder="Название (${state.type === "work" ? "работа" : "материал"})"/>
          <input class="ep-db-input" data-af="category" placeholder="Категория" value="${esc(state.category)}"/>
          <input class="ep-db-input" data-af="subcategory" placeholder="Подкатегория" value="${esc(state.subcategory)}"/>
          <input class="ep-db-input ep-db-input-sm" data-af="unit" placeholder="Ед." value="шт"/>
          <input class="ep-db-input ep-db-input-sm" data-af="price" placeholder="Цена" inputmode="decimal"/>
        </div>
        <div class="ep-db-edit-actions">
          <button class="btn btn-primary ep-clickable" data-db-saveadd type="button">Добавить</button>
          <button class="btn btn-ghost ep-clickable" data-db-canceladd type="button">Отмена</button>
        </div>
      </div>`;
  }

  // ---------- модалка (overlay поверх всего) ----------
  function openModal(title, bodyHTML, onMount) {
    closeModal();
    const ov = document.createElement("div");
    ov.className = "ep-db-modal-ov";
    ov.innerHTML = `
      <div class="ep-db-modal card" role="dialog" aria-modal="true">
        <div class="ep-db-modal-head"><strong>${esc(title)}</strong>
          <button class="ep-db-iconbtn" data-db-mclose type="button" aria-label="Закрыть">✕</button>
        </div>
        <div class="ep-db-modal-body">${bodyHTML}</div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-db-mclose]")) closeModal(); });
    if (onMount) onMount(ov);
  }
  function closeModal() {
    document.querySelectorAll(".ep-db-modal-ov").forEach((n) => n.remove());
  }

  // ---------- действия ----------
  function toggleAll(on) {
    state.selected.clear();
    if (on) visibleItems().forEach((x) => state.selected.add(x.id));
    render();
  }

  function doDelete() {
    const ids = Array.from(state.selected);
    if (!ids.length) return;
    openModal("Удалить позиции?", `
      <p>Будет удалено: <strong>${ids.length}</strong> поз. из «Моя БД». Действие необратимо.</p>
      <div class="ep-db-edit-actions">
        <button class="btn btn-ghost ep-clickable ep-db-danger" data-db-delok type="button">Удалить</button>
        <button class="btn btn-ghost ep-clickable" data-db-mclose type="button">Отмена</button>
      </div>`);
  }

  function doMove() {
    const ids = Array.from(state.selected);
    if (!ids.length) return;
    const cats = DB.categories(state.type, "my");
    openModal("Переместить выбранные", `
      <p>Новая категория и подкатегория для ${ids.length} поз.:</p>
      <input class="ep-db-input" id="mvCat" list="mvCatList" placeholder="Категория"/>
      <datalist id="mvCatList">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      <input class="ep-db-input" id="mvSub" placeholder="Подкатегория (необязательно)"/>
      <div class="ep-db-edit-actions">
        <button class="btn btn-primary ep-clickable" data-db-moveok type="button">Переместить</button>
        <button class="btn btn-ghost ep-clickable" data-db-mclose type="button">Отмена</button>
      </div>`);
  }

  function doImport() {
    openModal("Импорт в Мою БД", `
      <p>Вставь JSON или CSV, либо выбери файл. CSV-колонки: name, type, category, subcategory, unit, price.</p>
      <div class="ep-db-imp-modes">
        <label><input type="radio" name="impfmt" value="json" checked/> JSON</label>
        <label><input type="radio" name="impfmt" value="csv"/> CSV</label>
        <label><input type="checkbox" id="impReplace"/> заменить (а не добавить)</label>
      </div>
      <input type="file" id="impFile" accept=".json,.csv,application/json,text/csv" class="ep-db-input"/>
      <textarea id="impText" class="ep-db-textarea" placeholder="…или вставь текст сюда"></textarea>
      <div class="ep-db-edit-actions">
        <button class="btn btn-primary ep-clickable" data-db-importok type="button">Импортировать</button>
        <button class="btn btn-ghost ep-clickable" data-db-mclose type="button">Отмена</button>
      </div>
      <p class="ep-db-imp-msg" id="impMsg"></p>
    `, (ov) => {
      const file = ov.querySelector("#impFile");
      file.addEventListener("change", () => {
        const f = file.files && file.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          ov.querySelector("#impText").value = String(r.result || "");
          const isCsv = /\.csv$/i.test(f.name);
          ov.querySelector('input[name="impfmt"][value="' + (isCsv ? "csv" : "json") + '"]').checked = true;
        };
        r.readAsText(f);
      });
    });
  }

  function runImport(ov) {
    const fmt = ov.querySelector('input[name="impfmt"]:checked').value;
    const replace = ov.querySelector("#impReplace").checked;
    const text = ov.querySelector("#impText").value;
    if (!text.trim()) { ov.querySelector("#impMsg").textContent = "Пусто."; return; }
    const res = fmt === "csv"
      ? DB.importCsv(text, { base: "my" })
      : DB.importJson(text, { base: "my", mode: replace ? "replace" : "merge" });
    if (res.ok) { closeModal(); render(); }
    else ov.querySelector("#impMsg").textContent = "Ошибка: " + res.error;
  }

  function doExport() {
    const json = DB.exportJson(state.base);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "electric-pro-" + state.base + "-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function doBackupAll() {
    const json = DB.exportAllData();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "electric-pro-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function doRestoreAll() {
    openModal("Восстановить всё из бэкапа", `
      <p>Полный бэкап: база, документы/сметы, клиенты, инструмент, склад, расходка, затраты, реквизиты, визуал. Данные с этими ключами будут заменены из файла. После восстановления страница перезагрузится.</p>
      <input type="file" id="bakFile" accept=".json,application/json" class="ep-db-input"/>
      <textarea id="bakText" class="ep-db-textarea" placeholder="…или вставь JSON бэкапа сюда"></textarea>
      <div class="ep-db-edit-actions">
        <button class="btn btn-primary ep-clickable" data-db-restoreok type="button">Восстановить и перезагрузить</button>
        <button class="btn btn-ghost ep-clickable" data-db-mclose type="button">Отмена</button>
      </div>
      <p class="ep-db-imp-msg" id="bakMsg"></p>
    `, (ov) => {
      const file = ov.querySelector("#bakFile");
      file.addEventListener("change", () => {
        const f = file.files && file.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { ov.querySelector("#bakText").value = String(r.result || ""); };
        r.readAsText(f);
      });
    });
  }
  function runRestoreAll(ov) {
    const text = ov.querySelector("#bakText").value;
    if (!text.trim()) { ov.querySelector("#bakMsg").textContent = "Пусто."; return; }
    const res = DB.importAllData(text);
    if (res.ok) { ov.querySelector("#bakMsg").textContent = "Восстановлено ключей: " + res.keys + ". Перезагрузка…"; setTimeout(() => { try { location.reload(); } catch (e) {} }, 800); }
    else ov.querySelector("#bakMsg").textContent = "Ошибка: " + res.error;
  }

  // ---------- делегирование событий (на своём контейнере) ----------
  function onClick(e) {
    const t = e.target;
    const hit = (sel) => t.closest(sel);

    if (hit("[data-db-base]")) { state.base = hit("[data-db-base]").dataset.dbBase; DB.setActiveDb(state.base); state.category = ""; state.subcategory = ""; state.selected.clear(); state.addOpen = false; state.editId = null; render(); return; }
    if (hit("[data-db-type]")) { state.type = hit("[data-db-type]").dataset.dbType; state.category = ""; state.subcategory = ""; state.selected.clear(); state.editId = null; render(); return; }
    if (hit("[data-db-cat]")) { state.category = hit("[data-db-cat]").dataset.dbCat; state.subcategory = ""; render(); return; }
    if (hit("[data-db-sub]")) { state.subcategory = hit("[data-db-sub]").dataset.dbSub; render(); return; }
    if (hit("[data-db-folder]")) { const k = hit("[data-db-folder]").dataset.dbFolder; if (state.expanded.has(k)) state.expanded.delete(k); else state.expanded.add(k); render(); return; }

    if (hit("[data-db-pick]")) { const id = hit("[data-db-pick]").dataset.dbPick; if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id); render(); return; }
    if (hit("[data-db-edit]")) { state.editId = hit("[data-db-edit]").dataset.dbEdit; render(); return; }
    if (hit("[data-db-canceledit]")) { state.editId = null; render(); return; }
    if (hit("[data-db-savedit]")) { saveEdit(hit("[data-db-savedit]").dataset.dbSavedit); return; }
    if (hit("[data-db-toest]")) { addToEstimate(hit("[data-db-toest]").dataset.dbToest); return; }

    if (hit("[data-db-add]")) { state.addOpen = true; render(); return; }
    if (hit("[data-db-canceladd]")) { state.addOpen = false; render(); return; }
    if (hit("[data-db-saveadd]")) { saveAdd(); return; }

    if (hit("[data-db-move]")) { doMove(); return; }
    if (hit("[data-db-del]")) { doDelete(); return; }
    if (hit("[data-db-import]")) { doImport(); return; }
    if (hit("[data-db-export]")) { doExport(); return; }
    if (hit("[data-db-backup]")) { doBackupAll(); return; }
    if (hit("[data-db-restore]")) { doRestoreAll(); return; }
    if (hit("[data-db-copy]")) { copySelectedToMy(); return; }

    if (hit("[data-db-sync-toggle]")) { syncOpen = !syncOpen; updateSyncBlock(); return; }
    if (hit("[data-db-pull]")) { syncPull(); return; }
    if (hit("[data-db-push-my]")) { syncPushMy(); return; }
    if (hit("[data-db-push-server]")) { syncPushServer(); return; }
  }

  function onChange(e) {
    if (e.target.matches("[data-db-selall]")) toggleAll(e.target.checked);
    if (e.target.matches("[data-db-cur]") && window.EP.Currency) { EP.Currency.set(e.target.value); render(); }
  }
  function onInput(e) {
    if (e.target.matches("[data-db-search]")) { state.search = e.target.value; renderListOnly(); }
  }

  // лёгкая перерисовка только списка при вводе поиска (без перестроения чипов/фокуса)
  function renderListOnly() {
    const list = rootEl.querySelector(".ep-db-list");
    const info = rootEl.querySelector(".ep-db-listinfo");
    if (!list) return render();
    list.innerHTML = renderContent();
    if (info) {
      const n = visibleItems().length;
      info.textContent = n + " позиц." + (state.selected.size ? " · выбрано " + state.selected.size : "");
    }
  }

  function readForm(prefix) {
    const get = (f) => { const el = rootEl.querySelector(`[data-${prefix}="${f}"]`); return el ? el.value : ""; };
    return { name: get("name"), category: get("category"), subcategory: get("subcategory"), unit: get("unit"), price: get("price"), type: state.type };
  }
  function saveAdd() {
    const data = readForm("af");
    if (!data.name.trim()) return;
    DB.addMyItem(data);
    state.addOpen = false;
    if (data.category) state.category = data.category.trim();
    render();
  }
  function saveEdit(id) {
    const data = readForm("ef");
    DB.updateMyItem(id, data);
    state.editId = null;
    render();
  }
  function addToEstimate(id) {
    const it = DB.getItems(state.base).find((x) => x.id === id);
    if (!it || !EP.EstimateDraft) return;
    EP.EstimateDraft.addItem({ sourceId: it.id, type: it.type, name: it.name, unit: it.unit, price: it.price, qty: 1, base: state.base, source: "database" });
    flash("Добавлено в смету: " + it.name);
  }
  function copySelectedToMy() {
    const ids = Array.from(state.selected);
    if (!ids.length) return;
    const added = DB.copyServerItemsToMyDb(ids, {});
    state.selected.clear();
    flash(added ? `Скопировано в Мою БД: ${added}` : "Уже есть в Моей БД (дубли пропущены)");
    render();
  }

  // --- синхронизация с Firebase ---
  async function syncPull() {
    const localHas = DB.getLocalItems("my").length || DB.getLocalItems("server").length;
    if (localHas && !confirm("Загрузить из Firebase в локальный кэш? Пустые базы в Firebase локальные данные НЕ затрут.")) return;
    flash("Загрузка из Firebase…");
    const r = await (EP.DatabaseSync ? EP.DatabaseSync.pullToLocal() : Promise.resolve({ ok: false, error: "no-sync" }));
    if (r && r.ok) { state.base = DB.getActiveDb(); state.selected.clear(); render(); flash("Готово · Моя " + (r.my == null ? "–" : r.my) + " · Сервер " + (r.server == null ? "–" : r.server)); }
    else flash("Не удалось: " + ((r && r.error) || ""));
  }
  async function syncPushMy() {
    const n = DB.getLocalItems("my").length;
    if (!n) { flash("Моя БД пуста — нечего выгружать"); return; }
    if (!confirm("Выгрузить «Мою БД» (" + n + " поз.) в Firebase? Позиции с теми же id обновятся.")) return;
    flash("Выгрузка Моей БД…");
    const r = await DB.uploadMyDbToFirestore();
    flash(r && r.ok ? ("Моя БД выгружена: " + r.count) : ("Ошибка: " + ((r && r.error) || "")));
    updateSyncBlock();
  }
  async function syncPushServer() {
    if (!(EP.DatabaseSync && EP.DatabaseSync.isAdmin && EP.DatabaseSync.isAdmin())) { flash("Только для администратора"); return; }
    const n = DB.getLocalItems("server").length;
    if (!n) { flash("БД сервера пуста — нечего выгружать"); return; }
    if (!confirm("Выгрузить «БД сервера» (" + n + " поз.) в общий Firebase? Её видят все мастера. Только админ.")) return;
    flash("Выгрузка БД сервера…");
    const r = await DB.uploadServerDbToFirestore();
    if (r && r.error === "permission-denied") flash("Нет прав записи (permission-denied)");
    else flash(r && r.ok ? ("БД сервера выгружена: " + r.count) : ("Ошибка: " + ((r && r.error) || "")));
    updateSyncBlock();
  }

  // действия из модалок
  function onBodyClick(e) {
    const t = e.target;
    if (t.closest("[data-db-delok]")) { const n = DB.deleteMyItems(Array.from(state.selected)); state.selected.clear(); closeModal(); render(); flash("Удалено: " + n); return; }
    if (t.closest("[data-db-moveok]")) {
      const ov = t.closest(".ep-db-modal-ov");
      const cat = ov.querySelector("#mvCat").value.trim();
      const sub = ov.querySelector("#mvSub").value.trim();
      DB.moveMyItems(Array.from(state.selected), { category: cat, subcategory: sub });
      state.selected.clear(); closeModal(); render(); flash("Перемещено");
      return;
    }
    if (t.closest("[data-db-importok]")) { runImport(t.closest(".ep-db-modal-ov")); return; }
    if (t.closest("[data-db-restoreok]")) { runRestoreAll(t.closest(".ep-db-modal-ov")); return; }
  }

  let flashTimer = null;
  function flash(msg) {
    let el = document.querySelector(".ep-db-flash");
    if (!el) { el = document.createElement("div"); el.className = "ep-db-flash"; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  // ---------- монтирование ----------
  function mount() {
    rootEl = document.querySelector("#ep-db-root");
    if (!rootEl) return;
    if (!state.base) state.base = DB.getActiveDb();
    state.selected.clear();
    state.editId = null;
    state.addOpen = false;
    if (rootEl.dataset.epDbBound !== "1") {
      rootEl.dataset.epDbBound = "1";
      rootEl.addEventListener("click", onClick);
      rootEl.addEventListener("change", onChange);
      rootEl.addEventListener("input", onInput);
    }
    render();
  }

  // глобальный хук — один раз, по событию роутера (НЕ наблюдатель)
  window.addEventListener("ep:route-loaded", (e) => {
    if (e.detail && e.detail.route === "database") mount();
  });
  // обновление блока статуса синхронизации (без перерисовки всего экрана)
  window.addEventListener("ep:db-sync-status", updateSyncBlock);
  // действия модалок — модалки висят на body
  document.addEventListener("click", onBodyClick);

  EP.Database.UI = { mount, render };
})();
