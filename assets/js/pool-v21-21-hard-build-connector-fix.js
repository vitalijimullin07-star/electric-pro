(function(){
  const V="V21.21";
  const FILE="assets/js/pool-v21-21-hard-build-connector-fix.js";
  const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const add=(m,k,q)=>{q=Math.max(0,num(q)); if(q)m[k]=(m[k]||0)+q;};
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  let baseBuild=null;

  const DEF_SET={connectorMode:"gml",dropsPerSocketJunction:2,dropsPerSwitchJunction:2,shrinkCmPerJoint:5,heatShrinkType:"12/4"};
  const DEF_TPL={
    switch_1:{pin2:4}, switch_2:{pin2:3,pin4:2}, switch_3:{pin2:4,pin4:2},
    pass_1:{pin2:6}, pass_2:{pin2:8,pin4:1},
    cross_1:{pin2:9}, cross_2:{pin2:15,pin3:1}
  };

  function diag(code,msg,extra={}){
    try{window.Diagnostics?.ok?.({file:FILE,module:"PoolV2121HardBuildConnectorFix",functionName:"runtime",place:"pool",code,message:msg,...extra});}catch(e){}
  }
  function toast(t){try{if(window.PoolV21?.toast)return window.PoolV21.toast(t)}catch(e){}}
  function settings(){try{return {...DEF_SET,...JSON.parse(localStorage.getItem("ep_pool_v21_16_settings")||"{}")}}catch(e){return {...DEF_SET}}}
  function templates(){try{return {...DEF_TPL,...JSON.parse(localStorage.getItem("ep_pool_v21_16_templates")||"{}")}}catch(e){return {...DEF_TPL}}}
  function logic(){return window.PoolV2114PromptEditFields?.logic?.()||{connectionMode:"junction_boxes"}}

  function matName(k){
    return ({
      pin2:"WAGO 2-пин",pin3:"WAGO 3-пин",pin4:"WAGO 4-пин",pin5:"WAGO 5-пин",pin6:"WAGO 6-пин",pin8:"WAGO 8-пин",pin10:"WAGO 10-пин",
      gml4:"ГМЛ 4",gml6:"ГМЛ 6",gml8:"ГМЛ 8",gml10:"ГМЛ 10",
      siz2:"СИЗ на 2 провода",siz3:"СИЗ на 3 провода",siz4:"СИЗ на 4 провода",siz5:"СИЗ на 5 проводов",siz6:"СИЗ на 6 проводов",siz8:"СИЗ на 8 проводов",siz10:"СИЗ на 10 проводов"
    })[k]||k;
  }
  function sleeve(w){w=num(w); if(w<=4)return"gml4"; if(w<=6)return"gml6"; if(w<=8)return"gml8"; return"gml10";}
  function raw(name,qty,unit="шт",query=[name]){return{id:"p2121_"+Math.random().toString(16).slice(2),type:"material",name,qty,unit,price:0,dbName:"",dbItemId:"",missingDb:false,query};}
  function apply(pinMap,tpls,key,mul){Object.entries(tpls[key]||{}).forEach(([p,q])=>/^pin\d+$/.test(p)&&add(pinMap,p,num(q)*mul));}

  function calc(){
    const set=settings(), log=logic(), tpls=templates(), groups=window.PoolV21?.groups||[], pins={};
    let socketDrops=0, switchDrops=0;

    groups.forEach(g=>{
      const qty=Math.max(1,num(g.qty,1)), sockets=num(g.sockets), sw=num(g.switches), pass=num(g.pass), cross=num(g.cross);
      const swKeys=Math.max(1,Math.min(3,num(g.meta?.switchKeys,1)));
      const passKeys=Math.max(1,Math.min(3,num(g.meta?.passKeys,1)));

      if(sw>0) apply(pins,tpls,"switch_"+swKeys,sw*qty);
      if(pass>0) apply(pins,tpls,passKeys>=2?"pass_2":"pass_1",pass*qty);
      if(cross>0) apply(pins,tpls,passKeys>=2?"cross_2":"cross_1",cross*qty);

      if(sockets>0){
        if(log.connectionMode==="in_boxes"){
          const wires=2+sockets;          // вход + выход + розетки
          add(pins,"pin"+wires,3*qty);   // L/N/PE
        }else{
          socketDrops+=qty;              // одна рамка = один розеточный спуск
        }
      }
      if((sw+pass+cross)>0 && log.connectionMode==="junction_boxes") switchDrops+=qty;
    });

    function addJunction(total,dropsPer){
      total=Math.max(0,num(total)); dropsPer=Math.max(1,num(dropsPer,2));
      const boxes=Math.ceil(total/dropsPer); let left=total;
      for(let i=0;i<boxes;i++){
        const here=Math.min(dropsPer,left); left-=here;
        if(here>0)add(pins,"pin"+(2+here),3); // вход + выход + спуски, L/N/PE
      }
      return boxes;
    }

    let socketBoxes=0, switchBoxes=0;
    if(log.connectionMode==="junction_boxes"){
      socketBoxes=addJunction(socketDrops,set.dropsPerSocketJunction);
      switchBoxes=addJunction(switchDrops,set.dropsPerSwitchJunction);
    }

    const materials={}; let shrinkCount=0;
    Object.entries(pins).forEach(([pin,qty])=>{
      const wires=num(pin.replace("pin",""));
      if(set.connectorMode==="wago") add(materials,pin,qty);
      else if(set.connectorMode==="siz"){ add(materials,"siz"+wires,qty); shrinkCount+=qty; }
      else { add(materials,sleeve(wires),qty); shrinkCount+=qty; }
    });

    const shrinkM=Math.round((shrinkCount*num(set.shrinkCmPerJoint,5)/100)*100)/100;
    return {set,log,pins,materials,shrinkM,socketDrops,switchDrops,socketBoxes,switchBoxes};
  }

  function clean(d){return(d||[]).filter(i=>!/^(WAGO|ГМЛ|СИЗ|Термоусадка|Распайки розеток:|Распайки выключателей:)/i.test(String(i.name||"")))}
  function append(res){
    let d=clean(window.PoolV21?.draft||[]);
    Object.entries(res.materials).forEach(([k,q])=>q&&d.push(raw(matName(k),q,"шт",[matName(k),k])));
    if(res.shrinkM>0)d.push(raw("Термоусадка "+(res.set.heatShrinkType||"12/4"),res.shrinkM,"м",["термоусадка"]));
    if(res.log.connectionMode==="junction_boxes"){
      if(res.socketBoxes>0)d.push(raw(`Распайки розеток: ${res.socketDrops} спуск. / ${res.set.dropsPerSocketJunction}`,res.socketBoxes,"шт",["распаячная коробка"]));
      if(res.switchBoxes>0)d.push(raw(`Распайки выключателей: ${res.switchDrops} спуск. / ${res.set.dropsPerSwitchJunction}`,res.switchBoxes,"шт",["распаячная коробка"]));
    }
    window.PoolV21.draft=d; window.PoolV21.save?.(); window.PoolV21.renderDraft?.();
  }

  function panel(res){
    const shell=document.querySelector("#ep-pool-v21-screen .p2114-shell"); if(!shell)return;
    let p=document.getElementById("p2121-visible-connectors");
    if(!p){
      p=document.createElement("section"); p.id="p2121-visible-connectors"; p.className="p2121-panel";
      const draft=Array.from(shell.querySelectorAll(".p2114-card")).find(c=>/Черновик расч/i.test(c.textContent||""));
      draft?draft.before(p):shell.appendChild(p);
    }
    const mats=Object.entries(res.materials).filter(([,q])=>q>0);
    const pins=Object.entries(res.pins).filter(([,q])=>q>0);
    p.innerHTML=`<div class="p2121-head"><h3>Соединители и распайки</h3><button type="button" data-p2121-recalc>Пересчитать</button></div>
      <div class="p2121-badge">Режим: ${res.set.connectorMode==="wago"?"WAGO":res.set.connectorMode==="siz"?"СИЗ":"ГМЛ"} · ${V}</div>
      <div class="p2121-pins">${pins.length?pins.map(([k,q])=>`<span>${esc(k.replace("pin",""))} пров. × ${q}</span>`).join(""):"<span>нет соединений</span>"}</div>
      <div class="p2121-list">
        ${mats.length?mats.map(([k,q])=>`<div class="p2121-row"><b>${esc(matName(k))}</b><strong>${q} шт</strong></div>`).join(""):`<div class="p2121-empty">Соединители не рассчитались.</div>`}
        ${res.shrinkM>0?`<div class="p2121-row"><b>Термоусадка ${esc(res.set.heatShrinkType||"12/4")}</b><strong>${res.shrinkM} м</strong></div>`:""}
        ${res.log.connectionMode==="junction_boxes"?`<div class="p2121-row muted"><b>Распайки розеток</b><strong>${res.socketBoxes} шт</strong></div><div class="p2121-row muted"><b>Распайки выключателей</b><strong>${res.switchBoxes} шт</strong></div>`:`<div class="p2121-small">Соединение в подрозетниках: вход + выход + розетки, затем ×3 жилы.</div>`}
      </div>`;
  }

  function syncV(){
    const s=document.getElementById("ep-pool-v21-screen");
    if(s)s.querySelectorAll(".p2114-head b,.p2113-head b,.p21-7-head b,.ep-pool-v21-db,#ep-pool-v21-db-pill").forEach(e=>e.textContent=V);
    try{window.ModuleVersionBadgesV212?.setVersion?.("pool",V);window.ModuleVersionBadgesV212?.setVersion?.("rough",V);window.ModuleVersionBadgesV212?.apply?.();}catch(e){}
  }

  function hardBuild(){
    if(baseBuild)try{baseBuild();}catch(e){diag("base-build-error",String(e))}
    const r=calc(); append(r);
    setTimeout(()=>{panel(r);syncV();},50);
    setTimeout(()=>{panel(r);syncV();},300);
    toast("Расчёт с WAGO/ГМЛ/СИЗ выполнен.");
    diag("hard-build-done","Расчёт с соединителями выполнен.",{materials:r.materials,pins:r.pins});
  }

  function replaceBtn(){
    const s=document.getElementById("ep-pool-v21-screen"); if(!s)return;
    const btn=Array.from(s.querySelectorAll("button")).find(b=>/Рассчитать\s+черновую/i.test(b.textContent||""));
    if(!btn||btn.dataset.p2121BuildButton==="1")return;
    const c=btn.cloneNode(true); c.dataset.p2121BuildButton="1"; c.setAttribute("data-p2121-build","1");
    c.removeAttribute("data-p2114-build"); c.removeAttribute("data-p2113-build"); c.removeAttribute("data-p21-7-build");
    c.textContent="Рассчитать черновую";
    c.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation();hardBuild();},true);
    btn.replaceWith(c);
  }

  function patch(){
    if(!window.PoolV21)return;
    if(!baseBuild && typeof window.PoolV21.buildDraft==="function")baseBuild=window.PoolV21.buildDraft.bind(window.PoolV21);
    window.PoolV21.buildDraft=hardBuild;
    if(!window.PoolV21.__v2121OpenPatched){
      const old=window.PoolV21.open?.bind(window.PoolV21);
      window.PoolV21.open=function(...a){const r=old?old(...a):undefined;[50,250,800,1600].forEach(ms=>setTimeout(()=>{replaceBtn();syncV();},ms));return r;};
      window.PoolV21.__v2121OpenPatched=true;
    }
  }

  function init(){
    document.addEventListener("click",e=>{
      if(!e.target.closest("#ep-pool-v21-screen"))return;
      if(e.target.closest("[data-p2121-build],[data-p2121-recalc]")){e.preventDefault();e.stopImmediatePropagation();hardBuild();}
    },true);
    const boot=()=>{patch();replaceBtn();syncV();};
    boot(); [500,1200,2500,5000].forEach(ms=>setTimeout(boot,ms));
    window.PoolV2121HardBuildConnectorFix={hardBuild,calc,version:V};
    diag("pool-v21-21-ready","Pool V21.21 ready.");
  }
  window.addEventListener("DOMContentLoaded",init);
})();
