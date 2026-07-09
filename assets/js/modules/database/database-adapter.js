/* ============================================================
   Electric Pro V29 — Database / Adapter
   Слой-источник данных. СЕЙЧАС: localStorage (старые ключи).
   ПОЗЖЕ: здесь же можно заменить источник на Firestore, не трогая
   core/ui — нужно лишь сохранить контракт loadBase/saveBase.

   Контракт (синхронный на этом этапе, т.к. localStorage синхронный):
     loadBase("my"|"server")            -> Array<item>
     saveBase("my"|"server", items)     -> boolean
   Для Firestore-версии этот слой получит внутренний кэш и фоновую
   синхронизацию, чтобы публичный API EP.Database остался синхронным.
   ============================================================ */
(() => {
  "use strict";
  window.EP = window.EP || {};
  EP.Database = EP.Database || {};
  const S = EP.Database.Storage;

  function keyOf(base) {
    return base === "server" ? S.KEYS.server : S.KEYS.my;
  }

  function loadBase(base) {
    const arr = S.readJson(keyOf(base), []);
    return Array.isArray(arr) ? arr : [];
  }

  function saveBase(base, items) {
    return S.writeJson(keyOf(base), Array.isArray(items) ? items : []);
  }

  // Источник на текущем этапе — всегда локальный.
  function sourceOf(/* base */) {
    return "local";
  }

  EP.Database.Adapter = { loadBase, saveBase, sourceOf };
})();
