(function(){
  "use strict";
  if(window.__EP_TOP_STATUS_V27__) return;
  window.__EP_TOP_STATUS_V27__ = true;

  const VERSION = "V27.1";
  const ACCESS_KEY = "ep_access_v26_state";
  const $ = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));

  function norm(v){return String(v ?? "").toLowerCase().replace(/ё/g,"е").replace(/\s+/g," ").trim();}
  function readJson(key, fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch(e){return fallback;}}

  function css(){
    if($("#ep-top-status-v27-style")) return;
    const st=document.createElement("style");
    st.id="ep-top-status-v27-style";
    st.textContent = `
#ep266-access-bar,.ep266-access-bar,#epHeaderStatusMini,.ep-header-status-mini,.ep-status-strip{
  display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;
}
#epTopStatusLine.ep-top-status-line{
  position:relative!important;top:auto!important;left:auto!important;right:auto!important;z-index:70!important;
  height:7mm!important;min-height:7mm!important;max-height:7mm!important;
  display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:6px!important;align-items:center!important;
  margin:0 8px 5px!important;padding:0 8px!important;border-radius:0 0 16px 16px!important;
  background:transparent!important;border:0!important;box-shadow:none!important;overflow:hidden!important;
}
#epTopStatusLine .ep-top-status-left,#epTopStatusLine .ep-top-status-right{
  min-width:0!important;height:4.6mm!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;
  padding:0 9px!important;border-radius:999px!important;font:950 9.5px/1 system-ui,-apple-system,"Segoe UI",sans-serif!important;
  white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;backdrop-filter:blur(12px)!important;
  box-shadow:0 4px 14px rgba(0,0,0,.10)!important;
}
#epTopStatusLine .ep-top-status-left{justify-content:flex-start!important;}
#epTopStatusLine[data-status="pro"] .ep-top-status-left,
#epTopStatusLine[data-status="basic"] .ep-top-status-left,
#epTopStatusLine[data-status="trial"] .ep-top-status-left{background:rgba(187,247,208,.88)!important;color:#14532d!important;}
#epTopStatusLine[data-status="none"] .ep-top-status-left{background:rgba(254,226,226,.92)!important;color:#7f1d1d!important;}
#epTopStatusLine[data-ai="own_api"] .ep-top-status-right,
#epTopStatusLine[data-ai="admin_api"] .ep-top-status-right{background:rgba(187,247,208,.88)!important;color:#14532d!important;}
#epTopStatusLine[data-ai="disabled"] .ep-top-status-right{background:rgba(254,226,226,.92)!important;color:#7f1d1d!important;}
#epTopStatusLine .ep-top-status-right{max-width:34vw!important;}
`;
    document.head.appendChild(st);
  }

  function statusKind(text){
    const t=norm(text);
    if(t.includes("с ии")||t.includes("pro")||t.includes("ai")) return "pro";
    if(t.includes("баз")||t.includes("basic")) return "basic";
    if(t.includes("тест")||t.includes("проб")||t.includes("trial")) return "trial";
    return "none";
  }
  function aiKind(text){
    const t=norm(text);
    if(t.includes("api")||t.includes("клиент")||t.includes("мастер")) return "own_api";
    if(t.includes("₽")||t.includes("руб")||(t.includes("ии")&&!t.includes("выкл"))) return "admin_api";
    return "disabled";
  }

  function ensureLine(){
    css();
    $$("#ep266-access-bar,.ep266-access-bar,#epHeaderStatusMini,.ep-header-status-mini,.ep-status-strip").forEach(el=>el.remove());
    const topbar = $(".topbar") || $("header") || $("#appShell .glass");
    let line = $("#epTopStatusLine");
    if(!line){
      line=document.createElement("div");
      line.id="epTopStatusLine";
      line.className="ep-top-status-line";
    }
    line.className="ep-top-status-line";
    if(!line.querySelector(".ep-top-status-left") || !line.querySelector(".ep-top-status-right")){
      line.innerHTML='<div class="ep-top-status-left"></div><div class="ep-top-status-right"></div>';
    }
    if(topbar && topbar.parentElement && topbar.nextElementSibling !== line){
      topbar.parentElement.insertBefore(line, topbar.nextSibling);
    }else if(!line.parentElement){
      (document.getElementById("appShell") || document.body).prepend(line);
    }
    return line;
  }

  function accessFromStorage(){
    const a=readJson(ACCESS_KEY,{});
    return a && typeof a === "object" ? a : {};
  }

  function render(access){
    const a = access && typeof access === "object" ? access : accessFromStorage();
    const line=ensureLine();
    const left=line.querySelector(".ep-top-status-left");
    const right=line.querySelector(".ep-top-status-right");
    const subText = a.subscriptionLabel || left?.textContent?.trim() || "Нет подписки";
    const aiText = a.aiLabel || right?.textContent?.trim() || "ИИ выкл.";
    if(left) left.textContent=subText;
    if(right) right.textContent=aiText;
    line.dataset.status=statusKind(subText);
    line.dataset.ai=aiKind(aiText);
    return line;
  }

  function boot(){render();}

  window.EPTopStatusV27={version:VERSION,render,boot};
  window.addEventListener("DOMContentLoaded",()=>{
    boot();
    [80,250,700,1500,3500,6500].forEach(ms=>setTimeout(boot,ms));
  });
  window.addEventListener("storage",e=>{if(e.key===ACCESS_KEY) setTimeout(boot,30);});
})();
