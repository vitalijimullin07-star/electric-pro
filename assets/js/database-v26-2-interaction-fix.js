(function(){
  'use strict';
  const VERSION='V26.2';
  const FILE='assets/js/database-v26-2-interaction-fix.js';

  function log(code,msg,extra={}){try{window.Diagnostics?.ok?.({file:FILE,module:'DBV262InteractionFix',functionName:'runtime',place:'database',code,message:msg,...extra})}catch(e){}}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
  function norm(v){return String(v||'').toLowerCase().replace(/\s+/g,' ').trim()}
  function db(){return document.getElementById('ep-db-v26-screen')||document.getElementById('ep-db-v262-screen')}
  function inDb(el){return !!el?.closest?.('#ep-db-v26-screen,#ep-db-v262-screen')}

  function injectCss(){
    if(document.getElementById('db262-interaction-style'))return;
    const s=document.createElement('style');
    s.id='db262-interaction-style';
    s.textContent=`
#ep-db-v26-screen .db26-folder-body,#ep-db-v26-screen .db26-items{display:none!important}
#ep-db-v26-screen .db26-folder.open>.db26-folder-body,#ep-db-v26-screen .db26-sub.open>.db26-items{display:grid!important;gap:7px!important}
#ep-db-v26-screen [data-db26-toggle-all],#ep-db-v26-screen [data-db26-cat],#ep-db-v26-screen [data-db26-sub],#ep-db-v26-screen [data-db26-diag]{pointer-events:auto!important;touch-action:manipulation!important}
#ep-db-v26-screen .db26-head{transform:none!important;will-change:auto!important}
.db262-diag-overlay{position:fixed!important;inset:0!important;z-index:2147483600!important;background:rgba(2,6,23,.52)!important;display:grid!important;place-items:end center!important;padding:12px!important}
.db262-diag-overlay.hidden{display:none!important}
.db262-diag-panel{width:min(960px,100%)!important;max-height:88vh!important;overflow:auto!important;border-radius:24px!important;background:#f8fafc!important;color:#0f172a!important;padding:14px!important;box-shadow:0 24px 70px rgba(0,0,0,.36)!important;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
.db262-diag-head{display:grid!important;grid-template-columns:1fr auto!important;gap:8px!important;align-items:center!important;margin-bottom:10px!important}
.db262-diag-head h3{margin:0!important;font-size:18px!important;font-weight:950!important;color:#0f172a!important}
.db262-diag-head button{width:40px!important;height:40px!important;border:0!important;border-radius:999px!important;background:rgba(239,68,68,.12)!important;color:#991b1b!important;font-size:22px!important;font-weight:950!important}
.db262-diag-text{width:100%!important;min-height:300px!important;border:1px solid rgba(15,23,42,.12)!important;border-radius:14px!important;padding:10px!important;background:#fff!important;color:#0f172a!important;font-family:monospace!important;font-size:12px!important;white-space:pre!important}
.db262-diag-actions{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important;margin-top:10px!important}
.db262-diag-actions button{min-height:46px!important;border:1px solid rgba(15,23,42,.08)!important;border-radius:16px!important;background:#eef2f7!important;color:#475569!important;font-size:14px!important;font-weight:950!important}
.db262-burger-badge{min-width:64px!important;height:30px!important;display:grid!important;place-items:center!important;border-radius:999px!important;background:rgba(148,163,184,.22)!important;color:#e2e8f0!important;font-style:normal!important;font-size:12px!important;font-weight:950!important;white-space:nowrap!important}
.db262-hide-extra-badge{display:none!important}
`;
    document.head.appendChild(s);
  }

  function folderIcon(folder){const span=folder?.querySelector('[data-db26-cat] span,.db26-folder-head span');if(span)span.textContent=folder.classList.contains('open')?'📂':'📁'}
  function subIcon(sub){const span=sub?.querySelector('[data-db26-sub] span,.db26-sub-head span');if(span)span.textContent=sub.classList.contains('open')?'▾':'▸'}

  function toggleFolder(btn){
    const folder=btn.closest('.db26-folder');
    if(!folder)return;
    folder.classList.toggle('open');
    folderIcon(folder);
  }
  function toggleSub(btn){
    const sub=btn.closest('.db26-sub');
    if(!sub)return;
    sub.classList.toggle('open');
    subIcon(sub);
  }
  function toggleAll(){
    const root=db();
    if(!root)return;
    const folders=Array.from(root.querySelectorAll('.db26-folder'));
    const shouldOpen=folders.some(f=>!f.classList.contains('open'));
    folders.forEach(f=>{f.classList.toggle('open',shouldOpen);folderIcon(f)});
    root.querySelectorAll('.db26-sub').forEach(s=>{s.classList.toggle('open',shouldOpen);subIcon(s)});
    const b=root.querySelector('[data-db26-toggle-all]');
    if(b)b.textContent=shouldOpen?'Свернуть':'Развернуть';
    log('toggle-all',shouldOpen?'Папки раскрыты':'Папки свернуты');
  }

  function diagPayload(){
    let logs=[];
    try{logs=JSON.parse(localStorage.getItem('ep_db_v26_diag')||'[]')}catch(e){}
    return {
      title:'Electric Pro DB V26.2 interaction diagnostics',
      version:VERSION,
      time:new Date().toISOString(),
      screenFound:!!db(),
      folders:db()?db().querySelectorAll('.db26-folder').length:0,
      subfolders:db()?db().querySelectorAll('.db26-sub').length:0,
      openedFolders:db()?db().querySelectorAll('.db26-folder.open').length:0,
      openedSubfolders:db()?db().querySelectorAll('.db26-sub.open').length:0,
      scripts:Array.from(document.scripts).map(s=>s.src).filter(Boolean).filter(s=>s.includes('database-v26')||s.includes('db-v26')),
      logs
    };
  }
  function openDiag(){
    injectCss();
    let overlay=document.getElementById('db262-diag-overlay');
    if(!overlay){overlay=document.createElement('div');overlay.id='db262-diag-overlay';overlay.className='db262-diag-overlay hidden';document.body.appendChild(overlay)}
    overlay.innerHTML=`<div class="db262-diag-panel"><div class="db262-diag-head"><h3>Диагностика БД</h3><button type="button" data-db262-diag-close>×</button></div><textarea class="db262-diag-text" readonly>${esc(JSON.stringify(diagPayload(),null,2))}</textarea><div class="db262-diag-actions"><button type="button" data-db262-diag-copy>Копировать</button><button type="button" data-db262-diag-clear>Очистить логи</button></div></div>`;
    overlay.classList.remove('hidden');
  }
  function closeDiag(){document.getElementById('db262-diag-overlay')?.classList.add('hidden')}
  function copyDiag(){const txt=JSON.stringify(diagPayload(),null,2);navigator.clipboard?.writeText?navigator.clipboard.writeText(txt).then(()=>alert('Диагностика скопирована.')):alert(txt)}

  function setHeaderVersion(){
    const root=db();
    if(root){
      const p=root.querySelector('.db26-head p');
      if(p)p.textContent=p.textContent.replace(/V\d+(\.\d+)*/i,VERSION);
    }
  }

  function fixBurgerBadge(){
    document.querySelectorAll('button,a,li,div,[role="button"]').forEach(row=>{
      if(inDb(row))return;
      const t=norm(row.textContent),r=row.getBoundingClientRect();
      if(!t.includes('база данных')||t.length>180||r.height>150)return;
      row.setAttribute('data-db262-route','1');
      let badges=Array.from(row.querySelectorAll('span,em,b,strong,small,i,div')).filter(el=>{
        const txt=String(el.textContent||'').trim();
        const cls=String(el.className||'').toLowerCase();
        return (/^v\d+(\.\d+){0,3}$/i.test(txt)||cls.includes('version')||cls.includes('badge'))&&!/база данных/i.test(el.textContent||'');
      });
      if(!badges.length){const b=document.createElement('span');row.appendChild(b);badges=[b]}
      badges.forEach((el,i)=>{if(i===0){el.textContent=VERSION;el.classList.add('db262-burger-badge');el.classList.remove('db262-hide-extra-badge');el.style.removeProperty('display');el.style.removeProperty('visibility')}else{el.classList.add('db262-hide-extra-badge');el.style.setProperty('display','none','important')}});
    });
  }

  function clickTrap(e){
    injectCss();
    const target=e.target;
    if(target.closest?.('#db262-diag-overlay')){
      if(target.closest('[data-db262-diag-close]')){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();closeDiag();return}
      if(target.closest('[data-db262-diag-copy]')){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();copyDiag();return}
      if(target.closest('[data-db262-diag-clear]')){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();localStorage.setItem('ep_db_v26_diag','[]');openDiag();return}
      return;
    }
    if(!target.closest?.('#ep-db-v26-screen'))return;

    const diag=target.closest('[data-db26-diag]');
    if(diag){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();openDiag();return}

    const all=target.closest('[data-db26-toggle-all]');
    if(all){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();toggleAll();return}

    const cat=target.closest('[data-db26-cat]');
    if(cat){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();toggleFolder(cat);return}

    const sub=target.closest('[data-db26-sub]');
    if(sub){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();toggleSub(sub);return}
  }

  function boot(){
    injectCss();
    setHeaderVersion();
    fixBurgerBadge();
  }
  function observe(){
    if(window.__db262InteractionObserver)return;
    const obs=new MutationObserver(()=>{clearTimeout(window.__db262InteractionTimer);window.__db262InteractionTimer=setTimeout(boot,80)});
    obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
    window.__db262InteractionObserver=obs;
  }

  window.addEventListener('click',clickTrap,true);
  window.addEventListener('DOMContentLoaded',()=>{boot();observe();[200,700,1500,3000].forEach(ms=>setTimeout(boot,ms))});
  window.DBV262InteractionFix={version:VERSION,boot,openDiag,toggleAll};
  log('ready','V26.2 interaction fix loaded');
})();
