from pathlib import Path
import re

p = Path("assets/js/database-v24-clean-monolith.js")
s = p.read_text(encoding="utf-8")
s = s.replace('const VERSION = "V24.4";', 'const VERSION = "V24.4.1";')

def replace_func(src, signature_start, new_code):
    i = src.find(signature_start)
    if i < 0:
        print(f"Внимание: не найдена функция: {signature_start}")
        return src
    brace = src.find("{", i)
    if brace < 0:
        print(f"Внимание: не найдена скобка функции: {signature_start}")
        return src
    depth = 0
    j = brace
    in_str = None
    esc = False
    while j < len(src):
        ch = src[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
        else:
            if ch in ("'", '"', "`"):
                in_str = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return src[:i] + new_code.strip() + src[j+1:]
        j += 1
    print(f"Внимание: не удалось заменить функцию: {signature_start}")
    return src

try_cloud_save = r'''
  async function tryCloudSave(base, items) {
    const payload = {
      base,
      items,
      workDB: (items || []).filter(x => x.type === "work").map(shortFormat),
      matDB: (items || []).filter(x => x.type === "material").map(shortFormat),
      updatedAt: new Date().toISOString(),
      ownerUid: currentUid() || "",
      ownerEmail: currentEmail() || "",
      version: VERSION
    };

    async function compatSet(path) {
      const firebase = window.firebase;
      if (!firebase?.auth || !firebase?.firestore) throw new Error("firebase compat unavailable");
      const user = firebase.auth().currentUser;
      if (!user) throw new Error("auth user unavailable");
      payload.ownerUid = user.uid;
      payload.ownerEmail = user.email || "";
      await firebase.firestore().doc(path).set(payload, { merge: true });
      return true;
    }

    async function modularSet(path) {
      const dbObj = window.db || window.firestoreDb || window.firebaseDb || window.epFirestore;
      const f = window.firestore || window.FirebaseFirestore || {};
      const doc = window.doc || f.doc;
      const setDoc = window.setDoc || f.setDoc;
      if (!dbObj || !doc || !setDoc) throw new Error("firebase modular unavailable");
      await setDoc(doc(dbObj, path), payload, { merge: true });
      return true;
    }

    const uid = currentUid() || currentEmail() || "local";
    const paths = base === "server"
      ? ["server_db/main","global_db/database","ep_database_v24/server","databases/server"]
      : [`user_db/${uid}`,`ep_user_database_v24/${uid}`,`users/${uid}/private/database`,`users/${uid}/database/my`];

    for (const path of paths) {
      try {
        await compatSet(path);
        localStorage.setItem(KEYS.cloudStatus, "Сервер: сохранено");
        localStorage.setItem("ep_db_v24_4_1_cloud_path", path);
        return true;
      } catch (e) {}
      try {
        await modularSet(path);
        localStorage.setItem(KEYS.cloudStatus, "Сервер: сохранено");
        localStorage.setItem("ep_db_v24_4_1_cloud_path", path);
        return true;
      } catch (e) {}
    }

    localStorage.setItem(KEYS.cloudStatus, "Сервер: сохранить не удалось, локально сохранено");
    return false;
  }
'''

try_cloud_load = r'''
  async function tryCloudLoad() {
    async function compatGet(path) {
      const firebase = window.firebase;
      if (!firebase?.auth || !firebase?.firestore) throw new Error("firebase compat unavailable");
      const user = firebase.auth().currentUser;
      if (!user) throw new Error("auth user unavailable");
      const snap = await firebase.firestore().doc(path).get();
      return snap.exists ? snap.data() : null;
    }

    async function modularGet(path) {
      const dbObj = window.db || window.firestoreDb || window.firebaseDb || window.epFirestore;
      const f = window.firestore || window.FirebaseFirestore || {};
      const doc = window.doc || f.doc;
      const getDoc = window.getDoc || f.getDoc;
      if (!dbObj || !doc || !getDoc) throw new Error("firebase modular unavailable");
      const snap = await getDoc(doc(dbObj, path));
      return snap.exists() ? snap.data() : null;
    }

    function rowsFromData(data, baseType) {
      if (!data) return [];
      if (Array.isArray(data.items)) return data.items;
      return parseImportData(data, baseType);
    }

    try {
      const uid = currentUid() || currentEmail() || "local";
      const paths = state.view === "server"
        ? ["server_db/main","global_db/database","ep_database_v24/server","databases/server"]
        : state.view === "my"
          ? [`user_db/${uid}`,`ep_user_database_v24/${uid}`,`users/${uid}/private/database`,`users/${uid}/database/my`]
          : [];

      if (!paths.length) return false;
      setStatus("loading", "Загрузка базы с сервера...");

      for (const path of paths) {
        let data = null;
        try { data = await compatGet(path); } catch (e) {}
        if (!data) {
          try { data = await modularGet(path); } catch (e) {}
        }
        const rows = rowsFromData(data, state.view === "server" ? "server" : "my");
        if (rows && rows.length) {
          writeJson(state.view === "server" ? KEYS.server : KEYS.my, rows);
          localStorage.setItem(KEYS.cloudStatus, "Сервер: загружено");
          localStorage.setItem("ep_db_v24_4_1_cloud_path", path);
          setStatus("saved", saveStatusText());
          return true;
        }
      }

      localStorage.setItem(KEYS.cloudStatus, "Сервер: данных нет");
    } catch (e) {
      console.warn("DB cloud load failed", e);
      localStorage.setItem(KEYS.cloudStatus, "Сервер: загрузка недоступна");
    } finally {
      setStatus("saved", saveStatusText());
    }
    return false;
  }
'''

masters_list = r'''
  function mastersList() {
    const all = readJson(KEYS.masters, {});
    const cached = readJson("ep_db_v24_4_1_masters_cache", {});
    return Array.from(new Set([
      ...Object.keys(all || {}),
      ...Object.keys(cached || {})
    ])).filter(Boolean).sort();
  }
'''

render_grouped = r'''
  function renderGrouped(rows, mode) {
    const groups = grouped(rows);
    if (!groups.length) return `<div class="db244-empty">Позиции не найдены.</div>`;

    return groups.map(cat => {
      const catKey = `${mode}|${state.view}|${state.section}|${cat.category}`;
      const isOpen = state.openCats.has(catKey);
      const catIds = cat.subgroups.flatMap(g => g.rows.map(r => r.id));
      const catChecked = catIds.length && catIds.every(id => state.selected.has(id));
      return `
        <div class="db244-folder ${isOpen ? "open" : ""}">
          <div class="db244-check-head">
            <label class="db244-folder-check">
              <input type="checkbox" data-db244-main-cat="${esc(catKey)}" ${catChecked ? "checked" : ""}>
            </label>
            <button type="button" class="db244-folder-head" data-db244-cat="${esc(catKey)}">
              <span>${isOpen ? "📂" : "📁"}</span>
              <b>${esc(cat.category)}</b>
              <em>${catIds.length}</em>
            </button>
          </div>
          <div class="db244-folder-body">
            ${cat.subgroups.map(sub => {
              const subKey = `${catKey}|${sub.subcategory}`;
              const subOpen = state.openSubs.has(subKey);
              const subIds = sub.rows.map(r => r.id);
              const subChecked = subIds.length && subIds.every(id => state.selected.has(id));
              return `
                <div class="db244-sub ${subOpen ? "open" : ""}">
                  <div class="db244-check-head">
                    <label class="db244-folder-check">
                      <input type="checkbox" data-db244-main-sub="${esc(subKey)}" ${subChecked ? "checked" : ""}>
                    </label>
                    <button type="button" class="db244-sub-head" data-db244-sub="${esc(subKey)}">
                      <span>${subOpen ? "▾" : "▸"}</span>
                      <b>${esc(sub.subcategory)}</b>
                      <em>${subIds.length}</em>
                    </button>
                  </div>
                  <div class="db244-items">
                    ${sub.rows.map(renderItem).join("")}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("");
  }
'''

s = replace_func(s, "async function tryCloudSave", try_cloud_save)
s = replace_func(s, "async function tryCloudLoad", try_cloud_load)
s = replace_func(s, "function mastersList", masters_list)
s = replace_func(s, "function renderGrouped", render_grouped)

load_masters_func = r'''
  async function loadMastersFromCloud() {
    if (!isAdmin()) return false;

    async function compatCollection(path) {
      const firebase = window.firebase;
      if (!firebase?.auth || !firebase?.firestore) throw new Error("firebase compat unavailable");
      const snap = await firebase.firestore().collection(path).get();
      const out = {};
      snap.forEach(doc => {
        const data = doc.data() || {};
        const rows = Array.isArray(data.items) ? data.items : parseImportData(data, "my");
        if (rows.length) {
          const label = data.ownerEmail || data.email || data.displayName || data.name || doc.id;
          out[label] = rows;
        }
      });
      return out;
    }

    async function modularCollection(path) {
      const dbObj = window.db || window.firestoreDb || window.firebaseDb || window.epFirestore;
      const f = window.firestore || window.FirebaseFirestore || {};
      const collection = window.collection || f.collection;
      const getDocs = window.getDocs || f.getDocs;
      if (!dbObj || !collection || !getDocs) throw new Error("firebase modular unavailable");
      const snap = await getDocs(collection(dbObj, path));
      const out = {};
      snap.forEach(docSnap => {
        const data = docSnap.data() || {};
        const rows = Array.isArray(data.items) ? data.items : parseImportData(data, "my");
        if (rows.length) {
          const label = data.ownerEmail || data.email || data.displayName || data.name || docSnap.id;
          out[label] = rows;
        }
      });
      return out;
    }

    const loaded = {};
    for (const path of ["user_db", "ep_user_database_v24"]) {
      try { Object.assign(loaded, await compatCollection(path)); } catch (e) {}
      try { Object.assign(loaded, await modularCollection(path)); } catch (e) {}
    }

    if (Object.keys(loaded).length) {
      const old = readJson(KEYS.masters, {});
      writeJson(KEYS.masters, { ...old, ...loaded });
      writeJson("ep_db_v24_4_1_masters_cache", loaded);
      localStorage.setItem(KEYS.cloudStatus, "Мастера: загружены");
      return true;
    }

    localStorage.setItem(KEYS.cloudStatus, "Мастера: список пуст или нет доступа");
    return false;
  }
'''
if "async function loadMastersFromCloud" not in s:
    s = s.replace("  function render() {", load_masters_func + "\n\n  function render() {", 1)

old_head = '''          <div class="db244-list-head">
            <h3>${state.section === "work" ? "Работы" : "Материалы"}</h3>
            <span>${rows.length} поз. · ${edit ? "редактирование доступно" : "только просмотр"}</span>
          </div>'''
new_head = '''          <div class="db244-list-head">
            <h3>${state.section === "work" ? "Работы" : "Материалы"}</h3>
            <span>${rows.length} поз. · ${edit ? "редактирование доступно" : "только просмотр"}</span>
            <button type="button" data-db244-toggle-all>${state.openCats.size ? "Свернуть" : "Развернуть"}</button>
          </div>'''
s = s.replace(old_head, new_head, 1)

old_open = '''    state.view = localStorage.getItem(KEYS.activeView) || "my";
    if (state.view === "masters" && !isAdmin()) state.view = "my";
    render();
    ensureScreen().classList.remove("hidden");
    tryCloudLoad().then(() => render());'''
new_open = '''    state.view = localStorage.getItem(KEYS.activeView) || "my";
    if (state.view === "masters" && !isAdmin()) state.view = "my";
    state.openCats.clear();
    state.openSubs.clear();
    render();
    ensureScreen().classList.remove("hidden");
    Promise.all([tryCloudLoad(), loadMastersFromCloud()]).then(() => render());'''
s = s.replace(old_open, new_open, 1)

s = s.replace("    render();\n    tryCloudLoad().then(() => render());", "    render();\n    Promise.all([tryCloudLoad(), loadMastersFromCloud()]).then(() => render());", 1)

click_marker = '''        if (e.target.closest("[data-db244-export]")) { e.preventDefault(); exportJson(); return; }'''
click_insert = '''        if (e.target.closest("[data-db244-toggle-all]")) {
          e.preventDefault();
          const rowsNow = viewItems();
          const groupsNow = grouped(rowsNow);
          const shouldOpen = state.openCats.size === 0;
          state.openCats.clear();
          state.openSubs.clear();
          if (shouldOpen) {
            groupsNow.forEach(cat => {
              const catKey = `main|${state.view}|${state.section}|${cat.category}`;
              state.openCats.add(catKey);
              cat.subgroups.forEach(sub => state.openSubs.add(`${catKey}|${sub.subcategory}`));
            });
          }
          render();
          return;
        }

''' + click_marker
s = s.replace(click_marker, click_insert, 1)

change_marker = '''      const check = e.target.closest("[data-db244-check]");
      if (check) { check.checked ? state.selected.add(check.getAttribute("data-db244-check")) : state.selected.delete(check.getAttribute("data-db244-check")); render(); return; }'''
change_insert = r'''      const mainCat = e.target.closest("[data-db244-main-cat]");
      if (mainCat) {
        const ids = idsByMainCat(mainCat.getAttribute("data-db244-main-cat"));
        ids.forEach(id => mainCat.checked ? state.selected.add(id) : state.selected.delete(id));
        render();
        return;
      }

      const mainSub = e.target.closest("[data-db244-main-sub]");
      if (mainSub) {
        const ids = idsByMainSub(mainSub.getAttribute("data-db244-main-sub"));
        ids.forEach(id => mainSub.checked ? state.selected.add(id) : state.selected.delete(id));
        render();
        return;
      }

''' + change_marker
s = s.replace(change_marker, change_insert, 1)

main_ids_funcs = r'''
  function idsByMainCat(key) {
    const parts = String(key || "").split("|");
    const category = parts.slice(3).join("|");
    return viewItems().filter(x => x.category === category).map(x => x.id);
  }

  function idsByMainSub(key) {
    const parts = String(key || "").split("|");
    const category = parts[3];
    const subcategory = parts.slice(4).join("|");
    return viewItems().filter(x => x.category === category && x.subcategory === subcategory).map(x => x.id);
  }

'''
if "function idsByMainCat" not in s:
    s = s.replace("  function idsByImportCat(key) {", main_ids_funcs + "\n  function idsByImportCat(key) {", 1)

p.write_text(s, encoding="utf-8")
