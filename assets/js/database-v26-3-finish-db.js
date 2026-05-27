(function(){
  'use strict';

  const VERSION = 'V26.3';
  const FILE = 'assets/js/database-v26-3-finish-db.js';
  const OPEN_KEYS = new Set();

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  function esc(v){
    return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }
  function norm(v){
    return String(v || '').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  }
  function readJson(key, fallback){
    try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }catch(e){ return fallback; }
  }
  function log(code, message, extra={}){
    try{
      const rows = readJson('epdb26_log', []);
      rows.push({time:new Date().toLocaleString('ru-RU'), iso:new Date().toISOString(), code, message, extra, file:FILE});
      localStorage.setItem('epdb26_log', JSON.stringify(rows.slice(-120)));
    }catch(e){}
    try{ window.Diagnostics?.ok?.({file:FILE,module:'DBV263FinishDB',functionName:'runtime',place:'database',code,message,...extra}); }catch(e){}
  }

  function root(){ return document.getElementById('ep-db-v26'); }
  function inDb(el){ return !!el?.closest?.('#ep-db-v26,#db26modal,#db263-diag-overlay'); }
  function isVisible(el){
    if(!el) return false;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 20 && r.height > 20;
  }

  function injectCss(){
    if($('#db263-finish-style')) return;
    const st = document.createElement('style');
    st.id = 'db263-finish-style';
    st.textContent = `
#ep-db-v26{overflow:auto!important;overscroll-behavior:contain!important;scroll-behavior:auto!important}
#ep-db-v26 .db26h{top:6px!important;transform:none!important;will-change:auto!important}
#ep-db-v26 .db26body,#ep-db-v26 .db26items{display:none!important}
#ep-db-v26 .db26fold.open>.db26body,#ep-db-v26 .db26sub.open>.db26items{display:grid!important;gap:7px!important}
#ep-db-v26 [data-db26-toggle],#ep-db-v26 [data-db26-cat],#ep-db-v26 [data-db26-sub],#ep-db-v26 [data-db26-diag],#ep-db-v26 .db26dot{pointer-events:auto!important;touch-action:manipulation!important}
#ep-db-v26 .db263-version-ghost{display:none!important;visibility:hidden!important}
#ep-db-v26 .db26h p[data-db263-version-line="1"]{opacity:1!important;visibility:visible!important;color:#64748b!important}
[data-db263-route="1"] .db263-hide-extra{display:none!important;visibility:hidden!important}
[data-db263-route="1"] .db263-badge{min-width:64px!important;height:30px!important;display:grid!important;place-items:center!important;border-radius:999px!important;background:rgba(148,163,184,.22)!important;color:#e2e8f0!important;font-style:normal!important;font-size:12px!important;font-weight:950!important;white-space:nowrap!important}
#db263-diag-overlay.hidden{display:none!important}
#db263-diag-overlay{position:fixed!important;inset:0!important;z-index:2147483600!important;background:rgba(2,6,23,.52)!important;display:grid!important;place-items:end center!important;padding:12px!important}
.db263-panel{width:min(960px,100%)!important;max-height:88vh!important;overflow:auto!important;border-radius:24px!important;background:#f8fafc!important;color:#0f172a!important;padding:14px!important;box-shadow:0 24px 70px rgba(0,0,0,.36)!important;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
.db263-head{display:grid!important;grid-template-columns:1fr auto!important;gap:8px!important;align-items:center!important;margin-bottom:10px!important}
.db263-head h3{margin:0!important;font-size:18px!important;font-weight:950!important;color:#0f172a!important}
.db263-head button{width:40px!important;height:40px!important;border:0!important;border-radius:999px!important;background:rgba(239,68,68,.12)!important;color:#991b1b!important;font-size:22px!important;font-weight:950!important}
.db263-text{width:100%!important;min-height:300px!important;border:1px solid rgba(15,23,42,.12)!important;border-radius:14px!important;padding:10px!important;background:#fff!important;color:#0f172a!important;font-family:monospace!important;font-size:12px!important;white-space:pre!important}
.db263-actions{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important;margin-top:10px!important}
.db263-actions button{min-height:46px!important;border:1px solid rgba(15,23,42,.08)!important;border-radius:16px!important;background:#eef2f7!important;color:#475569!important;font-size:14px!important;font-weight:950!important}
@media(max-width:720px){.db263-actions{grid-template-columns:1fr!important}}
`;
    document.head.appendChild(st);
  }

  function roleText(){
    const txt = document.body.textContent || '';
    if(/(^|\s)admin(\s|$)|Админ/i.test(txt)) return 'Админ';
    return 'Мастер';
  }

  function fixHeaderVersion(){
    const r = root(); if(!r) return;
    const p = $('.db26h p', r);
    if(p){
      p.textContent = `${roleText()} · ${VERSION}`;
      p.setAttribute('data-db263-version-line','1');
    }

    $$('.db26shell span,.db26shell em,.db26shell b,.db26shell small,.db26shell i,.db26shell div,.db26shell button', r).forEach(el=>{
      const txt = String(el.textContent||'').trim();
      const cls = String(el.className||'').toLowerCase();
      if((/^v\d+(\.\d+){0,3}$/i.test(txt) || cls.includes('version') || cls.includes('badge')) && !/база данных/i.test(txt)){
        const rect = el.getBoundingClientRect();
        if(rect.width < 130 && rect.height < 70){
          el.classList.add('db263-version-ghost');
          el.style.setProperty('display','none','important');
          el.style.setProperty('visibility','hidden','important');
        }
      }
    });
  }

  function updateFolderIcon(fold){
    const span = fold?.querySelector('[data-db26-cat] span,.db26fh span');
    if(span) span.textContent = fold.classList.contains('open') ? '📂' : '📁';
  }
  function updateSubIcon(sub){
    const span = sub?.querySelector('[data-db26-sub] span,.db26sh span');
    if(span) span.textContent = sub.classList.contains('open') ? '▾' : '▸';
  }
  function keyForButton(btn){ return btn?.getAttribute('data-db26-cat') || btn?.getAttribute('data-db26-sub') || ''; }
  function setOpen(el, isOpen){
    if(!el) return;
    el.classList.toggle('open', !!isOpen);
    if(el.classList.contains('db26fold')) updateFolderIcon(el);
    if(el.classList.contains('db26sub')) updateSubIcon(el);
  }
  function applyOpenState(){
    const r = root(); if(!r) return;
    $$('[data-db26-cat]', r).forEach(btn=>{
      const key = keyForButton(btn);
      setOpen(btn.closest('.db26fold'), key && OPEN_KEYS.has(key));
    });
    $$('[data-db26-sub]', r).forEach(btn=>{
      const key = keyForButton(btn);
      setOpen(btn.closest('.db26sub'), key && OPEN_KEYS.has(key));
    });
    updateToggleText();
  }
  function updateToggleText(){
    const r = root(); if(!r) return;
    const btn = $('[data-db26-toggle]', r);
    if(!btn) return;
    const folds = $$('.db26fold', r);
    const allOpen = folds.length && folds.every(f=>f.classList.contains('open'));
    btn.textContent = allOpen ? 'Свернуть' : 'Развернуть';
  }
  function toggleFold(btn){
    const key = keyForButton(btn);
    const fold = btn.closest('.db26fold');
    const willOpen = !fold?.classList.contains('open');
    if(key){ willOpen ? OPEN_KEYS.add(key) : OPEN_KEYS.delete(key); }
    setOpen(fold, willOpen);
    updateToggleText();
    log('toggle-folder', willOpen ? 'Папка раскрыта' : 'Папка свернута', {key});
  }
  function toggleSub(btn){
    const key = keyForButton(btn);
    const sub = btn.closest('.db26sub');
    const willOpen = !sub?.classList.contains('open');
    if(key){ willOpen ? OPEN_KEYS.add(key) : OPEN_KEYS.delete(key); }
    setOpen(sub, willOpen);
    updateToggleText();
    log('toggle-sub', willOpen ? 'Подпапка раскрыта' : 'Подпапка свернута', {key});
  }
  function toggleAll(){
    const r = root(); if(!r) return;
    const folds = $$('.db26fold', r);
    const shouldOpen = folds.some(f=>!f.classList.contains('open'));
    folds.forEach(f=>{
      const key = keyForButton($('[data-db26-cat]', f));
      if(key){ shouldOpen ? OPEN_KEYS.add(key) : OPEN_KEYS.delete(key); }
      setOpen(f, shouldOpen);
    });
    $$('.db26sub', r).forEach(s=>{
      const key = keyForButton($('[data-db26-sub]', s));
      if(key){ shouldOpen ? OPEN_KEYS.add(key) : OPEN_KEYS.delete(key); }
      setOpen(s, shouldOpen);
    });
    updateToggleText();
    log('toggle-all', shouldOpen ? 'Все папки раскрыты' : 'Все папки свернуты');
  }

  function diagPayload(){
    const r = root();
    return {
      title:'Electric Pro DB diagnostics',
      version:VERSION,
      time:new Date().toISOString(),
      root:'#ep-db-v26',
      screenVisible:!!r && isVisible(r),
      folders:r ? $$('.db26fold', r).length : 0,
      subfolders:r ? $$('.db26sub', r).length : 0,
      openFolders:r ? $$('.db26fold.open', r).length : 0,
      openSubfolders:r ? $$('.db26sub.open', r).length : 0,
      dataCounts:{my:readJson('epdb26_my', []).length, server:readJson('epdb26_server', []).length, masters:Object.keys(readJson('epdb26_masters', {}) || {}).length},
      scripts:Array.from(document.scripts).map(s=>s.src).filter(Boolean).filter(s=>s.includes('database-v26')||s.includes('db-v26')),
      logs:readJson('epdb26_log', [])
    };
  }
  function ensureDiag(){
    let o = $('#db263-diag-overlay');
    if(!o){ o = document.createElement('div'); o.id='db263-diag-overlay'; o.className='hidden'; document.body.appendChild(o); }
    return o;
  }
  function openDiag(){
    injectCss();
    const txt = JSON.stringify(diagPayload(), null, 2);
    const o = ensureDiag();
    o.innerHTML = `<div class="db263-panel"><div class="db263-head"><h3>Диагностика БД</h3><button type="button" data-db263-diag-close>×</button></div><textarea class="db263-text" readonly>${esc(txt)}</textarea><div class="db263-actions"><button type="button" data-db263-diag-copy>Копировать</button><button type="button" data-db263-diag-clear>Очистить логи</button></div></div>`;
    o.classList.remove('hidden');
    log('diag-open','Открыта диагностика БД');
  }
  function closeDiag(){ $('#db263-diag-overlay')?.classList.add('hidden'); }
  function copyDiag(){
    const txt = JSON.stringify(diagPayload(), null, 2);
    if(navigator.clipboard?.writeText){ navigator.clipboard.writeText(txt).then(()=>alert('Диагностика скопирована.')); }
    else alert(txt);
  }

  function hideOldDbScreens(){
    $$('#ep-db-v25-screen,#ep-db-v256-screen,#ep-db-v244-screen,#ep-db-v243-screen,#ep-db-v24-screen,#ep-database-screen,[data-screen="database"]').forEach(el=>{
      if(el.id !== 'ep-db-v26'){
        el.classList.add('hidden');
        el.style.setProperty('display','none','important');
      }
    });
  }
  function openDb(){
    injectCss();
    hideOldDbScreens();
    if(window.DatabaseV26SurgicalMonolith?.open){ window.DatabaseV26SurgicalMonolith.open(); }
    else { alert('Не найден модуль DatabaseV26SurgicalMonolith.open'); return false; }
    setTimeout(afterOpen, 20); setTimeout(afterOpen, 160); setTimeout(afterOpen, 500);
    return true;
  }
  function afterOpen(){ injectCss(); hideOldDbScreens(); fixHeaderVersion(); applyOpenState(); fixBurgerBadge(); }

  function isDbExternalTrigger(el){
    if(!el || inDb(el)) return false;
    const t = norm(el.textContent);
    const attrs = [el.id, el.className, el.getAttribute?.('data-route'), el.getAttribute?.('data-screen'), el.getAttribute?.('data-ep-shell-route'), el.getAttribute?.('onclick'), el.getAttribute?.('href'), el.getAttribute?.('aria-label')].filter(Boolean).join(' ').toLowerCase();
    if(attrs.includes('database')) return true;
    return t.includes('база данных') && t.length < 180;
  }
  function findDbExternalTrigger(e){
    const path = e.composedPath ? e.composedPath() : [];
    for(const node of path){
      if(!(node instanceof Element)) continue;
      if(node === document.body || node === document.documentElement) break;
      if(isDbExternalTrigger(node)) return node;
    }
    return null;
  }

  function fixBurgerBadge(){
    $$('button,a,li,div,[role="button"]').forEach(row=>{
      if(inDb(row)) return;
      const t = norm(row.textContent);
      const rect = row.getBoundingClientRect();
      if(!t.includes('база данных') || t.length > 180 || rect.height > 170) return;
      row.setAttribute('data-db263-route','1');
      let badges = $$('span,em,b,strong,small,i,div', row).filter(el=>{
        const txt = String(el.textContent||'').trim();
        const cls = String(el.className||'').toLowerCase();
        return (/^v\d+(\.\d+){0,3}$/i.test(txt) || cls.includes('version') || cls.includes('badge')) && !/база данных/i.test(el.textContent||'');
      });
      if(!badges.length){ const b = document.createElement('span'); row.appendChild(b); badges = [b]; }
      badges.forEach((b,i)=>{
        if(i===0){ b.textContent = VERSION; b.classList.add('db263-badge'); b.classList.remove('db263-hide-extra'); b.style.removeProperty('display'); b.style.removeProperty('visibility'); }
        else { b.classList.add('db263-hide-extra'); b.style.setProperty('display','none','important'); b.style.setProperty('visibility','hidden','important'); }
      });
    });
  }

  function patchRouterObject(obj, name){
    if(!obj || typeof obj[name] !== 'function' || obj[name].__db263Patched) return;
    const old = obj[name];
    const wrapped = function(...args){
      const route = norm(args[0]);
      if(route === 'database' || route === 'db' || route.includes('database') || route.includes('база')){ openDb(); return true; }
      return old.apply(this, args);
    };
    wrapped.__db263Patched = true;
    wrapped.__db263Original = old;
    try{ obj[name] = wrapped; }catch(e){}
  }
  function patchRouters(){
    patchRouterObject(window.Router, 'load');
    patchRouterObject(window.Router, 'navigate');
    patchRouterObject(window.AppRouter, 'load');
    patchRouterObject(window.AppRouter, 'navigate');
    patchRouterObject(window, 'navigateTo');
    patchRouterObject(window, 'showScreen');
  }

  function clickTrap(e){
    injectCss();
    if(e.target.closest?.('#db263-diag-overlay')){
      if(e.target.closest('[data-db263-diag-close]')){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); closeDiag(); return; }
      if(e.target.closest('[data-db263-diag-copy]')){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); copyDiag(); return; }
      if(e.target.closest('[data-db263-diag-clear]')){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); localStorage.setItem('epdb26_log','[]'); openDiag(); return; }
      return;
    }

    const external = findDbExternalTrigger(e);
    if(external){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); openDb(); return; }

    const r = root();
    if(!r || !e.target.closest?.('#ep-db-v26')) return;

    const diag = e.target.closest('[data-db26-diag],.db26dot');
    if(diag){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); openDiag(); return; }
    const toggle = e.target.closest('[data-db26-toggle]');
    if(toggle){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); toggleAll(); return; }
    const cat = e.target.closest('[data-db26-cat]');
    if(cat){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); toggleFold(cat); return; }
    const sub = e.target.closest('[data-db26-sub]');
    if(sub){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); toggleSub(sub); return; }
  }

  function boot(){
    injectCss(); patchRouters(); fixHeaderVersion(); applyOpenState(); fixBurgerBadge();
    try{
      if(window.DatabaseV26SurgicalMonolith) window.DatabaseV26SurgicalMonolith.version = VERSION;
      if(window.DBV262InteractionFix) window.DBV262InteractionFix.version = VERSION;
      if(window.DBV2621VersionLock) window.DBV2621VersionLock.version = VERSION;
    }catch(e){}
  }
  function observe(){
    if(window.__db263Observer) return;
    const obs = new MutationObserver(()=>{ clearTimeout(window.__db263Timer); window.__db263Timer = setTimeout(boot, 80); });
    obs.observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['class','style']});
    window.__db263Observer = obs;
  }

  window.addEventListener('click', clickTrap, true);
  window.addEventListener('DOMContentLoaded', ()=>{ boot(); observe(); [120,300,700,1500,3000,5000].forEach(ms=>setTimeout(boot,ms)); });

  window.DatabaseV263FinishDB = {version:VERSION, openDb, openDiag, toggleAll, boot, applyOpenState};
  log('ready','V26.3 loaded: actual #ep-db-v26 structure patched');
})();
