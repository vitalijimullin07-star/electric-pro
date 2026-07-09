/* Electric Pro V29 — «Что нового».
   Значок NEW на пункте меню горит, пока пользователь не открыл вкладку.
   Чтобы пометить новую фичу: добавь запись в pages/whatsnew.html (верхнюю — с классом is-new)
   и подними VERSION на 1. Значок снова загорится у всех. */
(() => {
  "use strict";
  const KEY = "ep_whatsnew_seen_v29";
  const VERSION = 3; // ← бампать +1 при каждой новой записи в whatsnew.html

  function seen() { try { return parseInt(localStorage.getItem(KEY) || "0", 10) || 0; } catch (e) { return 0; } }
  function hasNew() { return seen() < VERSION; }
  function markSeen() { try { localStorage.setItem(KEY, String(VERSION)); } catch (e) {} updateBadge(); }
  function updateBadge() {
    const b = document.getElementById("whatsnewBadge");
    if (b) b.style.display = hasNew() ? "inline-flex" : "none";
  }

  window.EP = window.EP || {};
  EP.WhatsNew = { version: VERSION, hasNew: hasNew, markSeen: markSeen };

  window.addEventListener("ep:route-loaded", (e) => {
    const r = e && e.detail && e.detail.route;
    if (r === "whatsnew") markSeen();   // открыл вкладку → гасим значок
    updateBadge();
  });
  if (document.readyState !== "loading") setTimeout(updateBadge, 0);
  else document.addEventListener("DOMContentLoaded", () => setTimeout(updateBadge, 0));
})();
