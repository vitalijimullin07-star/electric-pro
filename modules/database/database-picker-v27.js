(function(){
  "use strict";
  if(window.__EP_DATABASE_PICKER_V27__) return;
  window.__EP_DATABASE_PICKER_V27__=true;

  const VERSION="V27.1";
  const ESTIMATE_KEY="ep_estimate_draft_v23";
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const norm=v=>String(v??"").toLowerCase().replace(/ё/g,"е").replace(/\s+/g," ").trim();
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const money=v=>Math.round(Number(v||0)).toLocaleString("ru-RU")+" ₽";
  const hash=s=>Math.abs(Array.from(String(s)).reduce((h,ch)=>((h<<5)-h+ch.charCodeAt(0))|0,0)).toString(36);

  const state={type:"material",base:"my",query:""};

  function api(){return window.EPDatabaseV27;}
  function readJson(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch(e){return fallback;}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(e){}}

  function getDraft(){
    try{if(window.EstimateCoreV231?.getDraft) return window.EstimateCoreV231.getDraft();}catch(e){}
    const d=readJson(ESTIMATE_KEY,null);
    return d && Array.isArray(d.rows)?d:{version:"V23.1",updatedAt:"",rows:[]};
  }
  function saveDraft(draft){
    const out={version:draft.version||"V23.1",updatedAt:new Date().toISOString(),rows:Array.isArray(draft.rows)?draft.rows:[]};
    try{if(window.EstimateCoreV231?.saveDraft) window.EstimateCoreV231.saveDraft(out); else writeJson(ESTIMATE_KEY,out);}catch(e){writeJson(ESTIMATE_KEY,out);}
    renderMainEstimate();
    renderQtyOnly();
    return out;
  }
  function rowKey(base,item){return [base,item.type,item.id||item.name,item.unit].join("|");}
  function findDraftRow(rows,key){return (rows||[]).find(r=>r?.raw?.dbPickKey===key||[r?.raw?.dbSourceBase,r?.type,r?.dbItemId||r?.raw?.dbItemId,r?.unit].join("|")===key);}
  function qtyInDraft(base,item){return Number(findDraftRow(getDraft().rows,rowKey(base,item))?.qty||0)||0;}

  function toast(text){
    let box=$("#ep-db-picker-v27-toast");
    if(!box){box=document.createElement("div");box.id="ep-db-picker-v27-toast";document.body.appendChild(box);}
    box.textContent=text;box.classList.add("show");clearTimeout(window.__epDbPickerV27Toast);window.__epDbPickerV27Toast=setTimeout(()=>box.classList.remove("show"),1400);
  }

  function css(){
    if($("#ep-db-picker-v27-style")) return;
    const st=document.createElement("style");st.id="ep-db-picker-v27-style";st.textContent=`
.ep27-picker{position:fixed;inset:0;z-index:2500;background:linear-gradient(135deg,rgba(2,20,21,.97),rgba(13,28,52,.97));color:#f8fafc;display:flex;flex-direction:column;padding:12px 14px 18px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}
.ep27-picker.hidden{display:none!important;}.ep27-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;}.ep27-back{width:50px;height:50px;border:0;border-radius:22px;background:rgba(241,245,249,.92);color:#0f172a;font:900 22px/1 system-ui;}.ep27-title{flex:1;min-width:0;}.ep27-title h2{margin:0;font:950 26px/1.05 system-ui;letter-spacing:-.02em;}.ep27-title p{margin:5px 0 0;color:#b8c4d3;font:800 13px/1.2 system-ui;}.ep27-pill{height:40px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:0 16px;background:rgba(187,247,208,.20);color:#bbf7d0;font:950 14px/1 system-ui;white-space:nowrap;}.ep27-active-base{min-height:38px;display:flex;align-items:center;justify-content:center;border-radius:18px;margin:4px 0 10px;padding:0 12px;background:rgba(187,247,208,.16);border:1px solid rgba(34,197,94,.24);color:#bbf7d0;font:900 13px/1 system-ui;text-align:center;}.ep27-active-base b{color:#dcfce7;}.ep27-search{width:100%;height:52px;border:0;border-radius:20px;background:rgba(248,250,252,.94);color:#0f172a;padding:0 18px;font:850 17px/1 system-ui;outline:none;margin-bottom:10px;}.ep27-list{flex:1;overflow:auto;padding:2px 0 90px;display:flex;flex-direction:column;gap:10px;}.ep27-card{background:rgba(248,250,252,.96);color:#0f172a;border-radius:22px;padding:14px;box-shadow:0 14px 34px rgba(0,0,0,.20);}.ep27-card-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start;}.ep27-card b{display:block;font:950 20px/1.15 system-ui;letter-spacing:-.015em;}.ep27-card p{margin:7px 0 0;color:#64748b;font:800 13px/1.25 system-ui;}.ep27-price{font:950 19px/1 system-ui;white-space:nowrap;}.ep27-qty{display:grid;grid-template-columns:54px minmax(0,1fr) 54px;gap:10px;align-items:center;margin-top:12px;}.ep27-qty button{height:50px;border:0;border-radius:15px;background:#020617;color:white;font:950 25px/1 system-ui;}.ep27-qty strong{height:50px;display:flex;align-items:center;justify-content:center;border-radius:15px;background:rgba(226,232,240,.85);font:950 22px/1 system-ui;}.ep27-empty{padding:28px 18px;border-radius:24px;background:rgba(248,250,252,.92);color:#334155;font:900 18px/1.3 system-ui;}
.ep27-estimate-card{margin-top:14px;}.ep27-estimate-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}.ep27-estimate-head h3{margin:0;font:950 24px/1.1 system-ui;}.ep27-estimate-total{display:inline-flex;align-items:center;border-radius:999px;background:rgba(34,197,94,.18);color:#bbf7d0;padding:8px 12px;font:950 13px/1 system-ui;white-space:nowrap;}.ep27-estimate-list{display:flex;flex-direction:column;gap:8px;margin:10px 0 12px;}.ep27-estimate-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border-radius:17px;background:rgba(15,23,42,.42);border:1px solid rgba(148,163,184,.16);padding:10px 12px;}.ep27-estimate-row b{display:block;color:#f8fafc;font:900 15px/1.2 system-ui;}.ep27-estimate-row p{margin:4px 0 0;color:#94a3b8;font:800 12px/1.15 system-ui;}.ep27-estimate-row strong{color:#f8fafc;font:950 14px/1 system-ui;white-space:nowrap;}.ep27-estimate-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;}.ep27-estimate-actions button{height:48px;border:0;border-radius:18px;font:950 15px/1 system-ui;}.ep27-estimate-actions .primary{background:#22c55e;color:white;}.ep27-estimate-actions .ghost{background:rgba(15,23,42,.50);color:white;border:1px solid rgba(148,163,184,.22);}#ep-db-picker-v27-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(20px);z-index:3100;opacity:0;pointer-events:none;background:rgba(15,23,42,.94);color:#f8fafc;border:1px solid rgba(148,163,184,.24);border-radius:999px;padding:12px 16px;font:900 14px/1 system-ui;box-shadow:0 12px 34px rgba(0,0,0,.35);transition:.18s ease;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis;}#ep-db-picker-v27-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}`;
    document.head.appendChild(st);
  }

  function ensureRoot(){css();let root=$("#ep-db-picker-v27");if(root) return root;root=document.createElement("div");root.id="ep-db-picker-v27";root.className="ep27-picker hidden";document.body.appendChild(root);return root;}
  function typeTitle(type){return type==="work"?"Работа":"Материалы";}
  function baseTitle(base){return api()?.baseTitle?.(base) || (base==="server"?"БД сервера":"БД моя");}
  function rows(){
    const q=norm(state.query);
    return (api()?.getRows?.(state.base,state.type)||[]).filter(x=>!q||norm([x.name,x.category,x.subcategory,x.unit,x.price].join(" ")).includes(q));
  }
  function cssAttr(value){if(window.CSS?.escape) return CSS.escape(String(value));return String(value).replace(/"/g,'\\"');}
  function card(row){
    const qty=qtyInDraft(state.base,row);
    return `<article class="ep27-card" data-ep27-id="${esc(row.id)}"><div class="ep27-card-top"><div><b>${esc(row.name)}</b><p>${esc(row.type==="work"?"Работа":"Материал")} · ${esc(row.category)} / ${esc(row.subcategory)} · ${esc(row.unit)}</p></div><div class="ep27-price">${esc(money(row.price))}</div></div><div class="ep27-qty"><button type="button" data-ep27-dec="${esc(row.id)}">-</button><strong data-ep27-qty="${esc(row.id)}">${esc(qty)}</strong><button type="button" data-ep27-inc="${esc(row.id)}">+</button></div></article>`;
  }
  function render(){
    const root=ensureRoot();const rs=rows();
    root.innerHTML=`<div class="ep27-head"><button type="button" class="ep27-back" data-ep27-close>←</button><div class="ep27-title"><h2>${esc(typeTitle(state.type))}</h2><p>${esc(baseTitle(state.base))} · плюс/минус сразу меняет предварительную смету</p></div><span class="ep27-pill">${esc(rs.length)} поз.</span></div><div class="ep27-active-base">Активная база: <b>${esc(baseTitle(state.base))}</b></div><input class="ep27-search" data-ep27-search placeholder="Поиск..." value="${esc(state.query)}"><div class="ep27-list">${rs.length?rs.map(card).join(""):`<div class="ep27-empty">Позиции не найдены. Проверь выбранную базу или импорт БД.</div>`}</div>`;
  }
  function renderQtyOnly(){const root=$("#ep-db-picker-v27:not(.hidden)");if(!root)return;rows().forEach(row=>{const el=root.querySelector(`[data-ep27-qty="${cssAttr(row.id)}"]`);if(el)el.textContent=String(qtyInDraft(state.base,row));});}
  function findRow(id){return rows().find(x=>String(x.id)===String(id));}
  function upsert(base,item,qty){
    const draft=getDraft();const rows=Array.isArray(draft.rows)?draft.rows:[];const key=rowKey(base,item);const index=rows.findIndex(r=>r?.raw?.dbPickKey===key);const safeQty=Math.max(0,Number(qty||0));
    if(safeQty<=0){if(index>=0) rows.splice(index,1);saveDraft({...draft,rows});toast("Позиция убрана из сметы");return;}
    const row={id:"dbpick_"+hash(key),createdAt:new Date().toISOString(),source:"dbpick",sourceVersion:VERSION,sourceBatchId:"manual_db_pick",type:item.type,category:item.category||"",subcategory:item.subcategory||"",name:item.name,calcName:item.name,dbName:item.name,dbItemId:item.id,qty:safeQty,unit:item.unit||"шт",price:Number(item.price||0)||0,total:Math.round(safeQty*(Number(item.price||0)||0)*100)/100,missingDb:false,warning:"",note:base==="server"?"Добавлено из БД сервера":"Добавлено из Моей БД",customerVisible:item.type==="work",supplierVisible:item.type==="material",raw:{dbPickKey:key,dbSourceBase:base,dbItemId:item.id,dbSourceKey:base==="server"?"epdb26_server":"epdb26_my",dbPickScore:100}};
    if(index>=0) rows[index]={...rows[index],...row,id:rows[index].id||row.id,createdAt:rows[index].createdAt||row.createdAt}; else rows.push(row);
    saveDraft({...draft,rows});toast("Добавлено в предварительную смету");
  }
  function changeQty(id,delta){const item=findRow(id);if(!item)return;const next=Math.max(0,qtyInDraft(state.base,item)+delta);upsert(state.base,item,next);}
  function open(type){state.type=type==="work"?"work":"material";state.base=api()?.getActiveBase?.()||"my";state.query="";render();ensureRoot().classList.remove("hidden");document.body.classList.add("ep27-picker-open");setTimeout(()=>$("[data-ep27-search]")?.focus?.(),80);}
  function close(){$("#ep-db-picker-v27")?.classList.add("hidden");document.body.classList.remove("ep27-picker-open");renderMainEstimate();}

  function totals(rows){return (rows||[]).reduce((acc,row)=>{const val=Number(row.total||(Number(row.qty||0)*Number(row.price||0))||0);acc.all+=val;if(row.type==="work")acc.work+=val;else acc.material+=val;return acc;},{all:0,work:0,material:0});}
  function findMainEstimateCard(){return $$(".card").find(card=>/Предварительная смета/i.test(card.textContent||""));}
  function renderMainEstimate(){
    if(document.body.dataset.route && document.body.dataset.route!=="main") return;
    const target=findMainEstimateCard();if(!target)return;
    target.classList.add("ep27-estimate-card");const dr=getDraft();const rows=dr.rows||[];const t=totals(rows);const preview=rows.slice(-8).reverse();
    target.innerHTML=`<div class="ep27-estimate-head"><h3>Предварительная смета</h3><span class="ep27-estimate-total">${esc(money(t.all))}</span></div>${rows.length?`<p class="badge">${esc(rows.length)} поз. · работы ${esc(money(t.work))} · материалы ${esc(money(t.material))}</p>`:`<p class="badge">Пока пусто</p>`}<div class="ep27-estimate-list">${preview.length?preview.map(row=>`<div class="ep27-estimate-row"><div><b>${esc(row.dbName||row.name)}</b><p>${esc(row.type==="work"?"Работа":"Материал")} · ${esc(row.qty)} ${esc(row.unit)} · ${esc(money(row.price))}</p></div><strong>${esc(money(row.total))}</strong></div>`).join(""):`<p style="color:var(--muted);">Нажми «Материалы» или «Работа», выбери позиции плюсиками — они появятся здесь.</p>`}</div><div class="ep27-estimate-actions"><button type="button" class="primary" data-ep27-open-estimate>Открыть черновик</button><button type="button" class="ghost" data-ep27-clear-estimate>Очистить</button></div>`;
  }
  function clearEstimate(){if(!confirm("Очистить предварительную смету?"))return;saveDraft({version:"V23.1",rows:[]});toast("Предварительная смета очищена");}
  function patchRouter(){
    if(!window.Router || typeof window.Router.load!=="function" || window.Router.load.__ep27PickerPatched) return;
    const old=window.Router.load.bind(window.Router);
    const wrapped=async function(route,...args){const out=await old(route,...args);if(route==="main"||route==="home"){setTimeout(renderMainEstimate,80);setTimeout(renderMainEstimate,400);}return out;};
    wrapped.__ep27PickerPatched=true;wrapped.__ep27Original=old;window.Router.load=wrapped;
  }
  function bind(){
    document.addEventListener("click",event=>{
      const pick=event.target.closest?.("[data-ep27-db-picker]");
      if(pick){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();open(pick.dataset.ep27DbPicker);return;}
      if(event.target.closest?.("[data-ep27-close]")){event.preventDefault();close();return;}
      const inc=event.target.closest?.("[data-ep27-inc]");if(inc){event.preventDefault();changeQty(inc.dataset.ep27Inc,1);return;}
      const dec=event.target.closest?.("[data-ep27-dec]");if(dec){event.preventDefault();changeQty(dec.dataset.ep27Dec,-1);return;}
      if(event.target.closest?.("[data-ep27-open-estimate]")){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();try{if(window.Router?.load)window.Router.load("estimate");else window.EstimateCoreV231?.openPanel?.();}catch(e){}return;}
      if(event.target.closest?.("[data-ep27-clear-estimate]")){event.preventDefault();clearEstimate();return;}
    },true);
    document.addEventListener("input",event=>{const input=event.target.closest?.("[data-ep27-search]");if(!input)return;state.query=input.value||"";render();const next=$("[data-ep27-search]");if(next){next.focus();try{next.setSelectionRange(next.value.length,next.value.length);}catch(e){}}},true);
    window.addEventListener("storage",e=>{if([ESTIMATE_KEY,"epdb26_my","epdb26_server","epdb26_active_base","epdb27_active_base"].includes(e.key)){setTimeout(renderMainEstimate,80);if(!$("#ep-db-picker-v27")?.classList.contains("hidden")) render();}});
    window.addEventListener("epdb27:active-base-changed",()=>{if(!$("#ep-db-picker-v27")?.classList.contains("hidden")){state.base=api()?.getActiveBase?.()||state.base;render();}});
  }
  function boot(){css();patchRouter();renderMainEstimate();}

  window.EPDatabasePickerV27={version:VERSION,open,close,renderMainEstimate};
  window.addEventListener("DOMContentLoaded",()=>{bind();boot();[150,500,1200,2500].forEach(ms=>setTimeout(boot,ms));});
})();
