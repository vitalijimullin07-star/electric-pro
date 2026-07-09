/* Electric Pro V29 — Логи/ошибки на точке статуса.
   Точка #firebaseStatusDot красится: 🔴 ошибки / 🟡 предупреждения / 🟢 норма.
   Тап по точке → панель с логами и кнопкой «Копировать» (чтобы прислать на анализ).
   EP.Log.info/warn/error(...) — ручные записи. */
(() => {
  "use strict";
  const MAX = 300;
  const logs = [];
  let worst = "ok";
  let panelOpen = false;
  const COLORS = { error: "#ef4444", warn: "#f59e0b", ok: "#22c55e" };
  const LABEL = { error: "ОШИБКА", warn: "ВНИМАНИЕ", ok: "OK" };
  const ICON = { error: "🔴", warn: "🟡", ok: "🟢" };

  function rank(l) { return l === "error" ? 2 : (l === "warn" ? 1 : 0); }
  function now() { try { return new Date().toTimeString().slice(0, 8); } catch (e) { return ""; } }
  function fmt(args) {
    return Array.prototype.map.call(args, (a) => {
      try {
        if (a instanceof Error) return a.message + (a.stack ? ("\n" + String(a.stack).split("\n").slice(0, 3).join("\n")) : "");
        return (a && typeof a === "object") ? JSON.stringify(a) : String(a);
      } catch (e) { return String(a); }
    }).join(" ");
  }
  function add(level, msg) {
    logs.push({ t: now(), level: level, msg: String(msg).slice(0, 1200) });
    if (logs.length > MAX) logs.shift();
    if (rank(level) > rank(worst)) worst = level;
    paintDot();
    if (panelOpen) renderPanel();
  }

  // ---- перехват ошибок ----
  try {
    window.addEventListener("error", (e) => {
      const f = e && e.filename ? (" @ " + String(e.filename).split("/").pop() + ":" + e.lineno) : "";
      add("error", ((e && e.message) || "Ошибка скрипта") + f);
    });
    window.addEventListener("unhandledrejection", (e) => {
      const r = e && e.reason; add("error", "Promise: " + ((r && (r.message || r)) || "rejection"));
    });
  } catch (e) {}
  const _err = (window.console && console.error) ? console.error : function () {};
  const _warn = (window.console && console.warn) ? console.warn : function () {};
  try {
    console.error = function () { try { add("error", fmt(arguments)); } catch (e) {} try { return _err.apply(console, arguments); } catch (e) {} };
    console.warn = function () { try { add("warn", fmt(arguments)); } catch (e) {} try { return _warn.apply(console, arguments); } catch (e) {} };
  } catch (e) {}

  // ---- точка ----
  function dotEl() { return document.getElementById("firebaseStatusDot"); }
  function paintDot() { const d = dotEl(); if (d) { d.style.background = COLORS[worst]; d.style.boxShadow = "0 0 6px " + COLORS[worst]; } }

  // ---- панель ----
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  function panelEl() { return document.getElementById("ep-log-panel"); }
  function renderPanel() {
    let p = panelEl();
    if (!p) { p = document.createElement("div"); p.id = "ep-log-panel"; document.body.appendChild(p); }
    const rows = logs.length
      ? logs.slice().reverse().map((l) => `<div class="ep-log-row ${l.level}"><span class="ep-log-t">${l.t}</span><span class="ep-log-m">${esc(l.msg)}</span></div>`).join("")
      : `<div class="ep-log-empty">🟢 Ошибок нет — всё работает.</div>`;
    p.innerHTML = `<div class="ep-log-box">
        <div class="ep-log-head">
          <b>Логи</b>
          <span class="ep-log-sum" style="color:${COLORS[worst]}">${ICON[worst]} ${worst === "error" ? "есть ошибки" : worst === "warn" ? "предупреждения" : "норма"}</span>
          <button type="button" class="ep-log-x" data-log-close aria-label="Закрыть">✕</button>
        </div>
        <div class="ep-log-list">${rows}</div>
        <div class="ep-log-actions">
          <button type="button" class="btn btn-primary ep-clickable" data-log-copy>📋 Копировать всё</button>
          <button type="button" class="btn btn-ghost ep-clickable" data-log-clear>Очистить</button>
        </div>
      </div>`;
    p.style.display = "flex";
  }
  function openPanel() { panelOpen = true; renderPanel(); }
  function closePanel() { panelOpen = false; const p = panelEl(); if (p) p.style.display = "none"; }

  function copyText() {
    const head = "Electric Pro — логи (" + logs.length + ")\n" + (location.href || "") + "\n" + ((navigator && navigator.userAgent) || "") + "\n\n";
    const body = logs.map((l) => "[" + LABEL[l.level] + " " + l.t + "] " + l.msg).join("\n");
    const text = head + (body || "ошибок нет");
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => toast("Скопировано — пришли мне")).catch(() => fallbackCopy(text));
        return;
      }
    } catch (e) {}
    fallbackCopy(text);
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea"); ta.value = text;
      ta.style.position = "fixed"; ta.style.top = "0"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand("copy"); ta.remove(); toast("Скопировано");
    } catch (e) { toast("Не удалось — выдели текст вручную"); }
  }
  function toast(m) {
    try {
      let el = document.getElementById("ep-log-toast");
      if (!el) { el = document.createElement("div"); el.id = "ep-log-toast"; document.body.appendChild(el); }
      el.textContent = m; el.style.opacity = "1";
      clearTimeout(toast._t); toast._t = setTimeout(() => { try { el.style.opacity = "0"; } catch (e) {} }, 1800);
    } catch (e) {}
  }

  // клики (capture — чтобы перехватить тап по точке раньше обработчика статуса Firebase)
  document.addEventListener("click", (e) => {
    const t = e.target; if (!t || !t.closest) return;
    if (t.closest("#firebaseStatusBtn")) { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); else e.stopPropagation(); openPanel(); return; }
    if (t.closest("[data-log-close]")) { closePanel(); return; }
    if (t.closest("[data-log-copy]")) { copyText(); return; }
    if (t.closest("[data-log-clear]")) { logs.length = 0; worst = "ok"; paintDot(); renderPanel(); return; }
    const p = panelEl();
    if (p && p.style.display !== "none" && t === p) { closePanel(); return; } // тап по затемнению
  }, true);

  window.EP = window.EP || {};
  EP.Log = { info: (m) => add("ok", m), warn: (m) => add("warn", m), error: (m) => add("error", m), open: openPanel };

  function init() { paintDot(); add("ok", "Запущено"); }
  if (document.readyState !== "loading") init(); else document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("ep:route-loaded", () => paintDot());
})();
