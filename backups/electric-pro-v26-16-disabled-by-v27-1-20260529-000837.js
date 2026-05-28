(function () {
  "use strict";

  if (window.__EP_V2616_STATUS_MAIN_FIX__) return;
  window.__EP_V2616_STATUS_MAIN_FIX__ = true;

  const VERSION = "V26.16";
  const ACCESS_KEY = "ep_access_v26_state";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function norm(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readJson(key, fallback = {}) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function css() {
    let st = $("#ep2616-status-main-style");
    if (st) return;
    st = document.createElement("style");
    st.id = "ep2616-status-main-style";
    st.textContent = `
#ep266-access-bar,
.ep266-access-bar,
[id*="ep266-access"]:not(#ep266-db-sync-line):not(#ep2661-db-sync-line){
  display:none!important;
  visibility:hidden!important;
  opacity:0!important;
  pointer-events:none!important;
}

#epTopStatusLine.ep-top-status-line{
  position:relative!important;
  top:auto!important;
  left:auto!important;
  right:auto!important;
  z-index:70!important;
  height:7mm!important;
  min-height:7mm!important;
  max-height:7mm!important;
  display:grid!important;
  grid-template-columns:minmax(0,1fr) auto!important;
  gap:6px!important;
  align-items:center!important;
  margin:0 8px 5px!important;
  padding:0 8px!important;
  border-radius:0 0 16px 16px!important;
  background:transparent!important;
  border:0!important;
  box-shadow:none!important;
  overflow:hidden!important;
}

#epTopStatusLine .ep-top-status-left,
#epTopStatusLine .ep-top-status-right{
  min-width:0!important;
  height:4.6mm!important;
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  padding:0 9px!important;
  border-radius:999px!important;
  font:950 9.5px/1 system-ui,-apple-system,"Segoe UI",sans-serif!important;
  white-space:nowrap!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  backdrop-filter:blur(12px)!important;
  box-shadow:0 4px 14px rgba(0,0,0,.10)!important;
}

#epTopStatusLine .ep-top-status-left{
  justify-content:flex-start!important;
}

#epTopStatusLine[data-status="pro"] .ep-top-status-left,
#epTopStatusLine[data-status="basic"] .ep-top-status-left,
#epTopStatusLine[data-status="trial"] .ep-top-status-left{
  background:rgba(187,247,208,.88)!important;
  color:#14532d!important;
}

#epTopStatusLine[data-status="none"] .ep-top-status-left{
  background:rgba(254,226,226,.92)!important;
  color:#7f1d1d!important;
}

#epTopStatusLine[data-ai="own_api"] .ep-top-status-right,
#epTopStatusLine[data-ai="admin_api"] .ep-top-status-right{
  background:rgba(187,247,208,.88)!important;
  color:#14532d!important;
}

#epTopStatusLine[data-ai="disabled"] .ep-top-status-right{
  background:rgba(254,226,226,.92)!important;
  color:#7f1d1d!important;
}

#epTopStatusLine .ep-top-status-right{
  max-width:34vw!important;
}

.ep2615-switch{display:none!important;visibility:hidden!important;pointer-events:none!important;}
.ep2615-active-base{
  min-height:38px!important;
  display:flex!important;
  align-items:center!important;
  justify-content:center!important;
  border-radius:18px!important;
  margin:4px 0 10px!important;
  padding:0 12px!important;
  background:rgba(187,247,208,.16)!important;
  border:1px solid rgba(34,197,94,.24)!important;
  color:#bbf7d0!important;
  font:900 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif!important;
  text-align:center!important;
}
.ep2615-active-base b{color:#dcfce7!important;}
`;
    document.head.appendChild(st);
  }

  function statusKind(text) {
    const t = norm(text);
    if (t.includes("с ии") || t.includes("pro") || t.includes("ai")) return "pro";
    if (t.includes("баз") || t.includes("basic")) return "basic";
    if (t.includes("тест") || t.includes("проб") || t.includes("trial")) return "trial";
    return "none";
  }

  function aiKind(text) {
    const t = norm(text);
    if (t.includes("api") || t.includes("клиент") || t.includes("мастер")) return "own_api";
    if (t.includes("₽") || t.includes("руб") || (t.includes("ии") && !t.includes("выкл"))) return "admin_api";
    return "disabled";
  }

  function getTopbar() {
    return $(".topbar") || $("header") || $("#appShell .glass");
  }

  function ensureLine() {
    css();
    $$("#ep266-access-bar,.ep266-access-bar").forEach(el => el.remove());

    const topbar = getTopbar();
    let line = $("#epTopStatusLine");
    if (!line) {
      line = document.createElement("div");
      line.id = "epTopStatusLine";
    }

    line.className = "ep-top-status-line";
    if (!line.querySelector(".ep-top-status-left") || !line.querySelector(".ep-top-status-right")) {
      line.innerHTML = '<div class="ep-top-status-left"></div><div class="ep-top-status-right"></div>';
    }

    if (topbar && topbar.parentElement && topbar.nextElementSibling !== line) {
      topbar.parentElement.insertBefore(line, topbar.nextSibling);
    } else if (!line.parentElement) {
      (document.getElementById("appShell") || document.body).prepend(line);
    }

    return line;
  }

  function apply(access = null) {
    const a = access && typeof access === "object" ? access : readJson(ACCESS_KEY, {});
    const line = ensureLine();
    const sub = line.querySelector(".ep-top-status-left");
    const ai = line.querySelector(".ep-top-status-right");
    const subText = a.subscriptionLabel || sub?.textContent?.trim() || "Нет подписки";
    const aiText = a.aiLabel || ai?.textContent?.trim() || "ИИ выкл.";

    if (sub) sub.textContent = subText;
    if (ai) ai.textContent = aiText;
    line.dataset.status = statusKind(subText);
    line.dataset.ai = aiKind(aiText);

    return line;
  }

  function boot() {
    apply();
  }

  function observe() {
    if (window.__ep2616StatusObserver) return;
    let timer = null;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => apply(), 40);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.__ep2616StatusObserver = obs;
  }

  window.EPTopStatusCompact = {
    version: VERSION,
    apply,
    boot
  };

  window.addEventListener("DOMContentLoaded", () => {
    boot();
    observe();
    [80, 250, 700, 1500, 3500, 6500].forEach(ms => setTimeout(boot, ms));
  });
})();
