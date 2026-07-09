/* Electric Pro V29 — единая шапка «← Назад + заголовок» на всех страницах (кроме главной/входа).
   Заменяет разнородные .page-head, использует историю роутера (EP.Router.back). */
(() => {
  "use strict";
  const TITLES = { shield: "Конфигуратор щита", pool: "Пул розеток", consumables: "Расходники", materials: "Материалы", work: "Работа", scheme: "Однолинейная схема", settings: "Настройки", subscription: "Подписка", admin: "Админка" };
  const NO_BAR = { main: 1, login: 1 };
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function clean(s) { return String(s == null ? "" : s).replace(/[&<>]/g, ""); }

  function build(route) {
    const app = document.getElementById("app"); if (!app) return;
    const page = app.querySelector("section.page") || app.querySelector(".page");
    if (!page) return;
    const old = page.querySelector(".ep-navbar"); if (old && old.remove) old.remove();
    if (NO_BAR[route]) return;
    const head = page.querySelector(".page-head");
    let title = "", sub = "";
    if (head) {
      const h1 = head.querySelector("h1"); if (h1) title = (h1.textContent || "").trim();
      const p = head.querySelector("p"); if (p) sub = (p.textContent || "").trim();
      if (head.remove) head.remove();
    }
    if (!title) title = TITLES[route] || cap(route);
    const bar = document.createElement("div");
    bar.className = "ep-navbar";
    bar.innerHTML = `<button type="button" class="ep-navback" data-nav-back aria-label="Назад">←</button>` +
      `<div class="ep-navtitles"><div class="ep-navtitle">${clean(title)}</div>${sub ? `<div class="ep-navsub">${clean(sub)}</div>` : ""}</div>`;
    page.insertBefore(bar, page.firstChild);
  }

  window.addEventListener("ep:route-loaded", (e) => { build(e && e.detail && e.detail.route); });
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.closest && t.closest("[data-nav-back]")) {
      e.preventDefault();
      if (window.EP && EP.Router && EP.Router.back) EP.Router.back();
      else if (window.EP && EP.Router && EP.Router.go) EP.Router.go("main");
    }
  });
  // если первый маршрут уже отрисован до загрузки этого модуля
  try {
    const app = document.getElementById("app");
    if (app && app.querySelector(".page")) build((location.hash || "#/main").replace("#/", "") || "main");
  } catch (e) {}
})();
