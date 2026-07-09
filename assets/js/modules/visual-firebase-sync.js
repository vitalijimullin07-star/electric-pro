/* ============================================================
   Electric Pro V29 — Синхронизация визуала (АДАПТИРОВАНО ПО ПРАВИЛАМ)
   GPT писал в users/{uid}/settings/visual и settings/visual — правила
   это ЗАПРЕЩАЮТ. Переписано на РАЗРЕШЁННЫЙ путь:
       user_db/{uid}/settings/visual
   (правило user_db/{uid}/** разрешает чтение/запись своему пользователю).
   Локальные ключи те же, что у visual-settings.js:
       ep_visual_settings_clean_v5_3 , ep.visual.v29
   Логика: вход -> скачать; пусто в облаке, есть локально -> засеять;
   локальное изменение -> выгрузить (debounce). Пустое облако не трёт.
   ============================================================ */
(() => {
  "use strict";
  window.EP = window.EP || {};
  const KEYS = ["ep_visual_settings_clean_v5_3", "ep.visual.v29"];
  const SUB = "settings", DOC = "visual";
  const st = { suppress: false, timer: null, busy: false };

  function db() { try { return (EP.Firebase && EP.Firebase.db) || null; } catch (e) { return null; } }
  function uid() { try { return ((EP.Auth && EP.Auth.currentUser && EP.Auth.currentUser()) || (EP.state && EP.state.user) || {}).uid || null; } catch (e) { return null; } }
  function ref(u) { const d = db(); if (!d || !u) return null; return d.collection("user_db").doc(u).collection(SUB).doc(DOC); }
  function ts() { try { return firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { return new Date().toISOString(); } }

  function readLocal() {
    try {
      const a = JSON.parse(localStorage.getItem(KEYS[0]) || "{}");
      const b = JSON.parse(localStorage.getItem(KEYS[1]) || "{}");
      return Object.assign({}, a, b);
    } catch (e) { return {}; }
  }
  function hasLocal() { const v = readLocal(); return v && Object.keys(v).length > 0; }

  function applyDownloaded(settings) {
    if (!settings || typeof settings !== "object") return;
    st.suppress = true;
    try { localStorage.setItem(KEYS[0], JSON.stringify(settings)); localStorage.setItem(KEYS[1], JSON.stringify(settings)); } catch (e) {}
    st.suppress = false;
    try { if (EP.VisualSettings && EP.VisualSettings.apply) EP.VisualSettings.apply(settings); } catch (e) {}
  }

  async function download() {
    const u = uid(), r = ref(u); if (!r) return;
    st.busy = true;
    try {
      if (hasLocal()) {
        // на устройстве уже есть свои настройки — они главнее. Облако НЕ применяем
        // (иначе затрёт локальные), а наоборот отправляем локальные наверх.
        await upload("local-wins");
      } else {
        const snap = await r.get();
        const cloud = snap.exists ? (snap.data() || {}).settings : null;
        if (cloud && Object.keys(cloud).length) applyDownloaded(cloud); // только на чистом устройстве
      }
    } catch (e) { if (!(e && e.code === "permission-denied")) console.warn("[visual-sync-download]", e && (e.code || e.message)); }
    finally { st.busy = false; }
  }

  async function upload(reason) {
    const u = uid(), r = ref(u); if (!r) return;
    const settings = readLocal(); if (!settings || !Object.keys(settings).length) return;
    try { await r.set({ settings, reason: reason || "change", updatedAt: ts(), updatedAtClient: new Date().toISOString() }, { merge: true }); }
    catch (e) { if (!(e && e.code === "permission-denied")) console.warn("[visual-sync-upload]", e && (e.code || e.message)); }
  }

  function scheduleUpload() {
    if (st.suppress || st.busy || !db() || !uid()) return;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => upload("local-change"), 1200);
  }

  // перехват записи визуальных ключей в localStorage -> авто-выгрузка (как в исходнике, но узко)
  function hookStorage() {
    if (localStorage.__epVisualHook) return; localStorage.__epVisualHook = true;
    const native = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k, v) { native(k, v); if (KEYS.indexOf(String(k)) >= 0) scheduleUpload(); };
  }

  hookStorage();
  window.addEventListener("ep:auth-changed", (e) => { if (e && e.detail && e.detail.user) setTimeout(download, 350); });
  EP.VisualSync = { download, upload, scheduleUpload };
})();
