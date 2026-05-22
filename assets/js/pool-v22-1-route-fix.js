(function(){
  const V="V22.1";
  const FILE="assets/js/pool-v22-1-route-fix.js";
  let lastAuth=Object.create(null);

  function diag(code,msg){
    try{window.Diagnostics?.ok?.({file:FILE,module:"PoolV221RouteFix",functionName:"runtime",place:"pool-route",code,message:msg});}catch(e){}
  }

  function openV22(){
    if(window.PoolV22CleanMonolith?.open){
      window.PoolV22CleanMonolith.open();
      setTimeout(syncV,50); setTimeout(syncV,400);
      diag("pool-v22-route-open","Открыт пул V22 через route fix.");
      return true;
    }
    if(window.PoolV21?.open){
      window.PoolV21.open();
      setTimeout(syncV,50); setTimeout(syncV,400);
      return true;
    }
    diag("pool-v22-open-missing","PoolV22CleanMonolith.open не найден.");
    return false;
  }

  function syncV(){
    try{
      window.ModuleVersionBadgesV212?.setVersion?.("pool",V);
      window.ModuleVersionBadgesV212?.setVersion?.("rough",V);
      window.ModuleVersionBadgesV212?.apply?.();
    }catch(e){}
    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el=>el.textContent=V);
  }

  function isPoolText(t){
    t=String(t||"").toLowerCase();
    return t.includes("пул розеток")||t.includes("штроб")||t.includes("розетки, выключатели");
  }

  function patchOpeners(){
    ["openPool","openPoolScreen","openSocketPool","openStrobePool","showPool","showPoolScreen","openRoughPool"].forEach(name=>{
      try{window[name]=function(){return openV22();};}catch(e){}
    });
  }

  function closeOldPool(){
    const old=document.getElementById("ep-pool-v21-screen");
    if(old && !old.classList.contains("hidden") && old.style.display!=="none"){
      old.classList.add("hidden"); old.style.display="none"; openV22();
    }
  }

  function bindClicks(){
    document.addEventListener("click",e=>{
      if(e.target.closest("#ep-pool-v22-screen,#ep-pool-v21-screen"))return;
      const c=e.target.closest("button,a,[role='button'],[data-route],[data-module],.card,.module-card,div,section");
      if(!c)return;
      const txt=c.textContent||"";
      const meta=(c.getAttribute("data-route")||"")+" "+(c.getAttribute("data-module")||"")+" "+(c.getAttribute("href")||"")+" "+(c.getAttribute("onclick")||"");
      if(!isPoolText(txt) && !/pool|rough|socket|sockets|strobe/i.test(meta))return;
      e.preventDefault(); e.stopImmediatePropagation(); openV22();
    },true);
  }

  function dedupeAuth(){
    const D=window.Diagnostics;
    if(!D||D.__v221AuthDedupe)return;
    ["ok","error"].forEach(m=>{
      if(typeof D[m]!=="function")return;
      const old=D[m].bind(D);
      D[m]=function(payload){
        try{
          const code=payload?.code||"", file=payload?.file||"";
          if(file.includes("auth-v21-19-auto-restore.js")&&(code==="auth-restored"||code==="auth-persistence-local")){
            const key=code+"|"+(payload?.email||payload?.user||"");
            const now=Date.now();
            if(lastAuth[key]&&now-lastAuth[key]<4000)return;
            lastAuth[key]=now;
          }
        }catch(e){}
        return old(payload);
      };
    });
    D.__v221AuthDedupe=true;
  }

  function boot(){patchOpeners();syncV();closeOldPool();dedupeAuth();}

  function init(){
    bindClicks();
    boot(); [300,800,1500,3000,5000].forEach(ms=>setTimeout(boot,ms));
    window.PoolV221RouteFix={version:V,openV22,syncV};
    diag("pool-v22-1-ready","Pool V22.1 route fix ready.");
  }
  window.addEventListener("DOMContentLoaded",init);
})();
