/* Electric Pro V29 — монтаж пула по маршруту (открыть/закрыть оверлей). Каталог пул берёт сам из epdb26_my/server. */
(() => {
  "use strict";
  function P() { return window.PoolV22CleanMonolith || null; }
  window.addEventListener("ep:route-loaded", function (e) {
    var route = e && e.detail && e.detail.route;
    var api = P(); if (!api) return;
    if (route === "pool") { try { setTimeout(function () { api.open && api.open(); }, 0); } catch (err) {} }
    else { try { api.close && api.close(); } catch (err) {} }
  });
})();
