(function(){const FILE='assets/js/app-shell.js';const overlays=[];function pushOverlay(n){if(!overlays.includes(n))overlays.push(n)}function removeOverlay(n){const i=overlays.lastIndexOf(n);if(i>=0)overlays.splice(i,1)}function closeTopOverlay(){const top=overlays.pop();if(!top)return false;if(top==='menu')closeMenu(true);if(top==='diagnostics')closeDiagnostics(true);if(top==='visual')window.VisualSettings?.close?.();return true}function openMenu(){document.getElementById('sideMenu')?.classList.add('open');document.getElementById('menuOverlay')?.classList.add('open');pushOverlay('menu')}function closeMenu(skip=false){document.getElementById('sideMenu')?.classList.remove('open');document.getElementById('menuOverlay')?.classList.remove('open');if(!skip)removeOverlay('menu')}function openDiagnostics(){document.getElementById('diagnosticsModal')?.classList.remove('hidden');window.Diagnostics?.render?.();pushOverlay('diagnostics')}function closeDiagnostics(skip=false){document.getElementById('diagnosticsModal')?.classList.add('hidden');if(!skip)removeOverlay('diagnostics')}function bind(){document.getElementById('burgerBtn')?.addEventListener('click',openMenu);document.getElementById('menuOverlay')?.addEventListener('click',()=>closeMenu());document.querySelectorAll('[data-route]').forEach(btn=>btn.addEventListener('click',()=>{const r=btn.dataset.route;if(r==='visual'){closeMenu();window.VisualSettings?.open?.();return}window.Router?.load(r)}));document.getElementById('firebaseStatusBtn')?.addEventListener('click',openDiagnostics);document.getElementById('closeDiagnosticsBtn')?.addEventListener('click',()=>closeDiagnostics());document.getElementById('closeVisualBtn')?.addEventListener('click',()=>window.VisualSettings?.close?.());document.getElementById('copyDiagnosticsBtn')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(window.Diagnostics?.text?.()||'');alert('Диагностика скопирована')}catch(e){window.Diagnostics?.error({file:FILE,module:'AppShell',functionName:'copyDiagnostics',place:'navigator.clipboard',code:'copy-error',message:e.message})}});document.getElementById('clearDiagnosticsBtn')?.addEventListener('click',()=>window.Diagnostics?.clear?.());document.getElementById('logoutBtn')?.addEventListener('click',()=>window.Auth?.logout?.());window.addEventListener('popstate',()=>window.Router?.back?.());history.replaceState({app:'electric-pro'},'',location.href);history.pushState({app:'electric-pro-start'},'',location.href)}function init(){bind();window.VisualSettings?.init?.();window.Auth?.init?.();window.Diagnostics?.wait({file:FILE,module:'AppShell',functionName:'init()',place:'app-start',code:'visual-start',message:'Первая визуальная сборка запущена'})}window.AppShell={init,openMenu,closeMenu,openDiagnostics,closeDiagnostics,pushOverlay,removeOverlay,closeTopOverlay};window.addEventListener('DOMContentLoaded',init)})();

/* === App version cache control === */
(function () {
  const FILE = "assets/js/app-shell.js";
  const VERSION_URL = "version.json?v=" + Date.now();
  const VERSION_KEY = "ep_app_version";

  async function checkAppVersion() {
    try {
      const res = await fetch(VERSION_URL, { cache: "no-store" });
      if (!res.ok) return;

      const data = await res.json();
      const newVersion = data.version;
      const oldVersion = localStorage.getItem(VERSION_KEY);

      if (oldVersion && newVersion && oldVersion !== newVersion) {
        localStorage.setItem(VERSION_KEY, newVersion);

        window.Diagnostics?.ok?.({
          file: FILE,
          module: "AppShell",
          functionName: "checkAppVersion()",
          place: "version.json",
          code: "new-version",
          message: "Найдена новая версия приложения. Перезагрузка."
        });

        setTimeout(() => location.reload(true), 500);
        return;
      }

      if (newVersion) {
        localStorage.setItem(VERSION_KEY, newVersion);
      }
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "AppShell",
        functionName: "checkAppVersion()",
        place: "version.json",
        code: "version-check-error",
        message: error.message
      });
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(checkAppVersion, 1200);
  });
})();
