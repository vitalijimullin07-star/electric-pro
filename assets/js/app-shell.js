(function(){const FILE="assets/js/app-shell.js";const overlays=[];function pushOverlay(n){if(!overlays.includes(n))overlays.push(n)}function removeOverlay(n){const i=overlays.lastIndexOf(n);if(i>=0)overlays.splice(i,1)}function closeTopOverlay(){const t=overlays.pop();if(!t)return false;if(t==="menu")closeMenu(true);if(t==="diagnostics")closeDiagnostics(true);if(t==="visual")window.VisualSettings?.close?.();return true}function openMenu(){document.getElementById("sideMenu")?.classList.add("open");document.getElementById("menuOverlay")?.classList.add("open");pushOverlay("menu");window.SoundAPI?.click?.()}function closeMenu(skip=false){document.getElementById("sideMenu")?.classList.remove("open");document.getElementById("menuOverlay")?.classList.remove("open");if(!skip)removeOverlay("menu")}function openDiagnostics(){document.getElementById("diagnosticsModal")?.classList.remove("hidden");window.Diagnostics?.render?.();pushOverlay("diagnostics");window.SoundAPI?.click?.()}function closeDiagnostics(skip=false){document.getElementById("diagnosticsModal")?.classList.add("hidden");if(!skip)removeOverlay("diagnostics")}async function hardReload(){try{if("caches" in window){const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)))}localStorage.setItem("ep_force_reload_at",String(Date.now()));location.href=location.pathname+"?fresh="+Date.now()}catch{location.reload()}}function bind(){document.getElementById("burgerBtn")?.addEventListener("click",openMenu);document.getElementById("menuOverlay")?.addEventListener("click",closeMenu);document.getElementById("loginDiagnosticsBtn")?.addEventListener("click",openDiagnostics);document.querySelectorAll("[data-route]").forEach(b=>b.addEventListener("click",()=>{const r=b.dataset.route;if(r==="visual"){closeMenu();window.VisualSettings?.open?.();return}window.Router?.load(r)}));document.addEventListener("click",e=>{if(e.target.closest(".ep-clickable"))window.SoundAPI?.click?.()},{capture:true});document.getElementById("firebaseStatusBtn")?.addEventListener("click",openDiagnostics);document.getElementById("closeDiagnosticsBtn")?.addEventListener("click",()=>closeDiagnostics());document.getElementById("closeVisualBtn")?.addEventListener("click",()=>window.VisualSettings?.close?.());document.getElementById("copyDiagnosticsBtn")?.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(window.Diagnostics?.text?.()||"");alert("Диагностика скопирована")}catch(e){window.Diagnostics?.error({file:FILE,module:"AppShell",functionName:"copyDiagnostics",place:"navigator.clipboard",code:"copy-error",message:e.message})}});document.getElementById("clearDiagnosticsBtn")?.addEventListener("click",()=>window.Diagnostics?.clear?.());document.getElementById("hardReloadBtn")?.addEventListener("click",hardReload);document.getElementById("testSoundBtn")?.addEventListener("click",async()=>{await window.SoundAPI?.unlock?.();});document.getElementById("logoutBtn")?.addEventListener("click",()=>window.Auth?.logout?.());window.addEventListener("popstate",()=>window.Router?.back?.());history.replaceState({app:"electric-pro"},"",location.href);history.pushState({app:"electric-pro-start"},"",location.href)}async function checkVersion(){try{const r=await fetch("version.json?v="+Date.now(),{cache:"no-store"});if(!r.ok)return;const d=await r.json(),key="ep_app_version_clean_v4",old=localStorage.getItem(key);if(old&&d.version&&old!==d.version){localStorage.setItem(key,d.version);setTimeout(()=>location.href=location.pathname+"?fresh="+Date.now(),400);return}if(d.version)localStorage.setItem(key,d.version)}catch{}}function init(){bind();window.VisualSettings?.init?.();window.Auth?.init?.();window.Diagnostics?.startNewSession?.();window.Diagnostics?.wait({file:FILE,module:"AppShell",functionName:"init()",place:"app-start",code:"app-start",message:"Приложение запущено",firebaseText:"проверка"});setTimeout(checkVersion,1000)}window.AppShell={init,openMenu,closeMenu,openDiagnostics,closeDiagnostics,pushOverlay,removeOverlay,closeTopOverlay,hardReload};window.addEventListener("DOMContentLoaded",init)})();

/* === Toggle click fix V5.1 === */
(function () {
  function bindSwitchRows() {
    document.querySelectorAll(".switch-row").forEach(row => {
      if (row.dataset.switchFixed === "true") return;
      row.dataset.switchFixed = "true";

      row.addEventListener("click", event => {
        const input = row.querySelector('input[type="checkbox"]');
        if (!input) return;

        if (event.target !== input) {
          event.preventDefault();
          input.checked = !input.checked;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(bindSwitchRows, 500);
  });

  const oldOpen = window.VisualSettings?.open;
  if (oldOpen) {
    window.VisualSettings.open = function () {
      oldOpen.apply(this, arguments);
      setTimeout(bindSwitchRows, 100);
    };
  }

  window.EP_BIND_SWITCH_ROWS = bindSwitchRows;
})();

/* === Final Fix V5.2: reliable switches and sound test === */
(function () {
  function forceSwitchState(input) {
    if (!input) return;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  document.addEventListener("click", function (event) {
    const testSound = event.target.closest("#testSoundBtn");
    if (testSound) {
      event.preventDefault();
      event.stopPropagation();
      window.SoundAPI?.test?.();
      return;
    }

    const row = event.target.closest(".switch-row");
    if (!row) return;

    const input = row.querySelector('input[type="checkbox"]');
    if (!input) return;

    if (event.target !== input) {
      event.preventDefault();
      event.stopPropagation();
      input.checked = !input.checked;
      forceSwitchState(input);
      window.SoundAPI?.click?.();
    }
  }, true);

  document.addEventListener("change", function (event) {
    const input = event.target;
    if (!input || !input.matches || !input.matches(".switch-row input[type='checkbox']")) return;
    forceSwitchState(input);
  }, true);
})();

/* === Final Fix V5.3: sound button only, switches handled by VisualSettings === */
(function () {
  document.addEventListener("click", function (event) {
    const btn = event.target.closest("#testSoundBtn");
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    window.SoundAPI?.test?.();
  }, true);
})();

/* === Sound after reload fix === */
(function () {
  async function wakeSoundAfterReload() {
    if (!window.SoundAPI?.isEnabled?.()) return;
    if (window.SoundAPI?.isUnlocked?.()) return;
    await window.SoundAPI.unlock();
  }

  ["pointerdown", "touchstart", "click"].forEach(eventName => {
    document.addEventListener(eventName, wakeSoundAfterReload, {
      capture: true,
      passive: true
    });
  });
})();
