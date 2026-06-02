(function(){
  "use strict";
  if(window.__EP_DATABASE_GATEWAY_V27__) return;
  window.__EP_DATABASE_GATEWAY_V27__=true;

  const VERSION="V28.7";
  const KEYS={
    my:"epdb26_my",
    server:"epdb26_server",
    active26:"epdb26_active_base",
    active27:"epdb27_active_base",
    activeMeta:"epdb27_active_base_meta",
    active24:"ep_db_v24_active_base",
    clear:"epdb26_clear_meta"
  };

  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const norm=v=>String(v??"").toLowerCase().replace(/ё/g,"е").replace(/[×хx]/g,"x").replace(/[^a-zа-я0-9x.,\s/_-]/gi," ").replace(/\s+/g," ").trim();
  const uid=s=>"dbv27_"+Math.abs(Array.from(String(s)).reduce((h,ch)=>((h<<5)-h+ch.charCodeAt(0))|0,0)).toString(36);
  const moneyApi=()=>window.EPDBMoneyV287;
  const parsePrice=v=>moneyApi()?.parseMoneyInput?.(v) ?? (Number(String(v??0).replace(",","."))||0);

  function readJson(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch(e){return fallback;}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(e){return false;}}
  function emit(name,detail){try{window.dispatchEvent(new CustomEvent(name,{detail}));}catch(e){}}

  function validBase(base){return base === "server" ? "server" : "my";}
  function baseTitle(base){return validBase(base)==="server"?"БД сервера":"БД моя";}
  function baseKey(base){return validBase(base)==="server"?KEYS.server:KEYS.my;}

  function rememberBase(base, source="v27"){
    const b=validBase(base);
    try{localStorage.setItem(KEYS.active26,b);}catch(e){}
    try{localStorage.setItem(KEYS.active27,b);}catch(e){}
    try{localStorage.setItem(KEYS.active24,b);}catch(e){}
    try{writeJson(KEYS.activeMeta,{base:b,source,version:VERSION,updatedAt:new Date().toISOString(),time:Date.now()});}catch(e){}
    document.body.dataset.epActiveBase=b;
    return b;
  }

  function setActiveBase(base, source="v27"){
    const b=rememberBase(base,source);
    emit("epdb27:active-base-changed",{base:b,title:baseTitle(b),source,version:VERSION});
    return b;
  }

  function domActiveBase(){
    const btn=$("#ep-db-v26 [data-db26-base].on");
    const val=btn?.dataset?.db26Base;
    return val==="server"||val==="my"?val:"";
  }

  function getActiveBase(){
    // V26 editor saves the real choice into epdb26_active_base.
    // In V27.2 epdb27_active_base could stay stale as "my", so V26 key is now the priority.
    const v26=localStorage.getItem(KEYS.active26);
    if(v26==="my"||v26==="server") return setActiveBase(v26,"read-v26-priority");

    const dom=domActiveBase();
    if(dom) return setActiveBase(dom,"read-dom");

    const v27=localStorage.getItem(KEYS.active27);
    if(v27==="my"||v27==="server") return setActiveBase(v27,"read-v27");

    const meta=readJson(KEYS.activeMeta,null);
    if(meta?.base==="my"||meta?.base==="server") return setActiveBase(meta.base,"read-meta");

    return setActiveBase("my","default");
  }

  function normalizeItem(raw={}, typeHint=""){
    const typeText=norm(typeHint || raw.type || raw.kind || raw.categoryType || "");
    const type=typeText.includes("work")||typeText.includes("работ")?"work":"material";
    const name=String(raw.name||raw.n||raw.title||raw["Наименование"]||"Позиция").trim();
    const category=String(raw.category||raw.c||raw.cat||raw.folder||raw["Папка"]||(type==="work"?"Работы":"Материалы")).trim();
    const subcategory=String(raw.subcategory||raw.sc||raw.sub||raw.g||raw.group||raw["Подпапка"]||"Без подкатегории").trim();
    const unit=String(raw.unit||raw.u||raw.ed||raw["Ед"]||"шт").trim();
    const price=parsePrice(raw.price ?? raw.p ?? raw.cost ?? raw["Цена"] ?? 0);
    const id=String(raw.id||uid([type,name,unit,category,subcategory].join("|")));
    return {...raw,id,type,name,n:name,category,c:category,subcategory,sc:subcategory,unit,u:unit,price,p:price,active:raw.active!==false};
  }

  function sortRows(rows){
    return (Array.isArray(rows)?rows:[])
      .map(x=>normalizeItem(x,x?.type))
      .filter(x=>x.active!==false)
      .sort((a,b)=>String(a.category).localeCompare(String(b.category),"ru")||String(a.subcategory).localeCompare(String(b.subcategory),"ru")||String(a.name).localeCompare(String(b.name),"ru"));
  }

  function getRows(base=getActiveBase(), type=""){
    const rows=sortRows(readJson(baseKey(base),[]));
    const t=type==="work"||type==="material"?type:"";
    return t?rows.filter(x=>x.type===t):rows;
  }

  function saveRows(base, rows, source="v27"){
    const b=validBase(base);
    const fixed=sortRows(rows);
    if(window.DatabaseV26SurgicalMonolith?.save){
      try{window.DatabaseV26SurgicalMonolith.save(b,fixed);}catch(e){writeJson(baseKey(b),fixed);}
    }else{
      writeJson(baseKey(b),fixed);
    }
    emit("epdb27:rows-changed",{base:b,count:fixed.length,source,version:VERSION});
    return fixed;
  }

  function syncFromDbButtons(){
    const b=domActiveBase();
    if(b==="my"||b==="server") setActiveBase(b,"db-ui-dom");
  }

  function bind(){
    document.addEventListener("click",event=>{
      const b=event.target.closest?.("[data-db26-base]");
      if(b){
        const val=b.dataset.db26Base;
        if(val==="my"||val==="server") setActiveBase(val,"db-ui-click");
      }
    },true);
    window.addEventListener("storage",event=>{
      if(event.key===KEYS.active26||event.key===KEYS.active27) getActiveBase();
    });
  }

  function boot(){syncFromDbButtons();getActiveBase();}

  window.EPDatabaseV27={version:VERSION,keys:KEYS,getActiveBase,setActiveBase,baseTitle,getRows,saveRows,normalizeItem,sortRows,readJson,writeJson,getMoneySettings:(base)=>moneyApi()?.getSettings?.(base||getActiveBase()),formatMoney:(value,base)=>moneyApi()?.formatMoneyTotal?.(value,base||getActiveBase()),formatUnitPrice:(value,base)=>moneyApi()?.formatUnitPrice?.(value,base||getActiveBase()),boot};
  window.addEventListener("DOMContentLoaded",()=>{bind();boot();[200,800,1800].forEach(ms=>setTimeout(boot,ms));});
})();
