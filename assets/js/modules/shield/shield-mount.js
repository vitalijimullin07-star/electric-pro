/* Electric Pro V29 — мост БД щита на EP.Database + монтаж щита/схемы по маршруту (без MutationObserver) */
(() => {
  "use strict";
  if (!window.EPDatabaseV27) {
    window.EPDatabaseV27 = {
      getActiveBase: function () { try { return localStorage.getItem("epdb26_active_base") || "my"; } catch (e) { return "my"; } },
      getRows: function (base, type) {
        try {
          var EP = window.EP;
          if (EP && EP.Database && EP.Database.getItemsByType) {
            var b = base || window.EPDatabaseV27.getActiveBase();
            return EP.Database.getItemsByType(type, b) || [];
          }
        } catch (e) {}
        return [];
      }
    };
  }
  var shieldBound = false;
  window.addEventListener("ep:route-loaded", function (e) {
    var route = e && e.detail && e.detail.route;
    if (route === "shield") {
      var S = window.ShieldConfiguratorV28; if (!S) return;
      if (!shieldBound) { try { S.bindPage(); shieldBound = true; } catch (err) { try { S.render(); } catch (e2) {} } }
      else { try { S.render(); } catch (e3) {} }
    } else if (route === "scheme") {
      var M = window.ManualSchemeV28; if (M && M.bindPage) { try { M.bindPage(); } catch (err) {} }
    }
  });
})();
