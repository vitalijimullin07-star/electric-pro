(function(){
  const FILE='assets/js/pool-v21-1.js';
  const PoolV21={
    groups:[], draft:[], key:'ep_pool_v21_state',
    esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])),
    money:n=>Math.round(Number(n||0)).toLocaleString('ru-RU')+' ₽',
    norm:s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim(),
    num:(id,d=0)=>Number(document.getElementById(id)?.value||d)||0,
    val:(id,d='')=>document.getElementById(id)?.value||d,
    toast(t){let b=document.getElementById('ep-pool-v21-toast'); if(!b){b=document.createElement('div');b.id='ep-pool-v21-toast';document.body.appendChild(b)} b.textContent=t;b.classList.add('show');clearTimeout(this.tt);this.tt=setTimeout(()=>b.classList.remove('show'),1700)},
    diag(level,code,msg){const p={file:FILE,module:'PoolV21',functionName:'runtime',place:'pool',code,message:msg}; level==='error'?window.Diagnostics?.error?.(p):window.Diagnostics?.ok?.(p)},
    save(){try{localStorage.setItem(this.key,JSON.stringify({groups:this.groups,draft:this.draft}))}catch{}},
    load(){try{const x=JSON.parse(localStorage.getItem(this.key)||'{}');this.groups=Array.isArray(x.groups)?x.groups:[];this.draft=Array.isArray(x.draft)?x.draft:[]}catch{this.groups=[];this.draft=[]}},
    activeSource(){try{return window.EPDB?.activeSource?.()||window.ActiveDB?.activeSource?.()||window.State?.activeSource||localStorage.getItem('ep_clean_active_db')||localStorage.getItem('ep_active_db')||'my'}catch{return 'my'}},
    sourceLabel(){return this.activeSource()==='server'?'База сервера':'Моя база'},
    uid(){try{return firebase?.auth?.().currentUser?.uid||window.Auth?.getUser?.()?.uid||window.State?.user?.uid||''}catch{return window.Auth?.getUser?.()?.uid||window.State?.user?.uid||''}},
    async dbItems(){
      try{
        const src=this.activeSource();
        if(window.ActiveDB?.getItems) return await window.ActiveDB.getItems(src)||[];
        if(window.EPDB?.getItems) return await window.EPDB.getItems(src)||[];
        if(window.DB?.items?.length) return DB.items.filter(x=>!x.deleted);
        if(window.firebase?.firestore){
          const fs=firebase.firestore(), uid=this.uid();
          const col=src==='server'?fs.collection('server_db'):(uid?fs.collection('user_db').doc(uid).collection('items'):null);
          if(col){const s=await col.limit(800).get();return s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>!x.deleted)}
        }
      }catch(e){this.diag('error','pool-db-load-error',e.message||String(e))}
      return [];
    },
    score(x,words,type){
      const hay=this.norm([x.name,x.n,x.title,x.category,x.c,x.group,x.g,x.subcategory,x.sc,x.type].join(' '));
      let sc=0; words.forEach(w=>{if(w.length>1&&hay.includes(w))sc++});
      const t=String(x.type||x.kind||'').toLowerCase();
      if(type==='work'&&(t.includes('work')||t.includes('работ')))sc+=2;
      if(type==='material'&&(t.includes('mat')||t.includes('мат')))sc+=2;
      return sc;
    },
    async find(raw){
      const all=this._items?.length?this._items:await this.dbItems(); this._items=all;
      const words=this.norm([raw.name].concat(raw.query||[]).join(' ')).split(' ').filter(Boolean);
      let best=null,bs=0; all.forEach(x=>{const s=this.score(x,words,raw.type); if(s>bs){bs=s;best=x}});
      return bs>=2?best:null;
    },
    ensure(){
      if(document.getElementById('ep-pool-v21-screen'))return;
      const el=document.createElement('div'); el.id='ep-pool-v21-screen'; el.className='ep-pool-v21 hidden';
      el.innerHTML=`
      <div class="ep-pool-v21-head">
        <button class="ep-pool-v21-close" data-p21-close>←</button>
        <div><h2>Пул розеток / штроб</h2><p>Группы, трассы, расходка и подбор из активной базы.</p></div>
        <div class="ep-pool-v21-db" id="p21-db-pill">БД</div>
      </div>
      <div class="ep-pool-v21-grid">
        <section class="ep-pool-card">
          <div class="ep-pool-card-title"><h3>Новая группа</h3><span>V21.1</span></div>
          <div class="ep-pool-form-grid">
            <label>Помещение<input id="p21-room" value="Комната"></label>
            <label>Название<input id="p21-name" value="Розеточная группа"></label>
            <label>Кол-во групп<input id="p21-qty" type="number" value="1"></label>
            <label>Кабель, м<input id="p21-cable" type="number" value="10"></label>
            <label>Штроба, м<input id="p21-strobe" type="number" value="5"></label>
            <label>Запас, %<input id="p21-reserve" type="number" value="10"></label>
            <label>Розетки 220<input id="p21-sockets" type="number" value="1"></label>
            <label>Выключатели<input id="p21-switches" type="number" value="0"></label>
            <label>Проходные<input id="p21-pass" type="number" value="0"></label>
            <label>Перекрёстные<input id="p21-cross" type="number" value="0"></label>
            <label>ТВ/интернет<input id="p21-tv" type="number" value="0"></label>
            <label>Терморегулятор<input id="p21-thermo" type="number" value="0"></label>
            <label>Стены<select id="p21-wall"><option>бетон</option><option>кирпич</option><option>газоблок</option><option>гкл</option></select></label>
            <label>Монтаж<select id="p21-mount"><option value="hidden">Скрытый</option><option value="surface">Накладной</option></select></label>
            <label>Подрозетник<select id="p21-pod"><option value="standard">Стандартный</option><option value="deep">Глубокий</option><option value="gkl">ГКЛ</option></select></label>
            <label>Коробки<input id="p21-boxes" type="number" value="0"></label>
            <label>WAGO<input id="p21-wago" type="number" value="0"></label>
            <label>ГМЛ<input id="p21-gml" type="number" value="0"></label>
            <label>Термоусадка, м<input id="p21-shrink" type="number" value="0"></label>
          </div>
          <div class="ep-pool-actions">
            <button class="ep-pool-primary" data-p21-add>Добавить группу</button>
            <button data-p21-build>Собрать черновик</button>
            <button data-p21-resolve>Подобрать из БД</button>
          </div>
        </section>
        <section class="ep-pool-card">
          <div class="ep-pool-card-title"><h3>Группы</h3><span id="p21-gc">0</span></div>
          <div id="p21-groups" class="ep-pool-list"><div class="ep-pool-empty">Пока нет групп.</div></div>
        </section>
        <section class="ep-pool-card ep-pool-wide">
          <div class="ep-pool-card-title"><h3>Черновик расчёта</h3><span id="p21-dc">0</span></div>
          <div id="p21-draft" class="ep-pool-list"><div class="ep-pool-empty">Черновик пока пуст.</div></div>
          <div class="ep-pool-actions"><button class="ep-pool-primary" data-p21-estimate>Добавить в смету</button><button class="ep-pool-danger" data-p21-clear>Очистить пул</button></div>
        </section>
      </div>`;
      document.body.appendChild(el);
    },
    open(){this.load();this.ensure();document.getElementById('ep-pool-v21-screen')?.classList.remove('hidden');document.getElementById('p21-db-pill').textContent=this.sourceLabel();this.renderGroups();this.renderDraft();this.diag('ok','pool-v21-opened','Пул V21 открыт')},
    close(){document.getElementById('ep-pool-v21-screen')?.classList.add('hidden');this.save()},
    read(){
      return {id:'g_'+Date.now()+Math.random().toString(16).slice(2),room:this.val('p21-room','Комната'),name:this.val('p21-name','Группа'),qty:Math.max(1,this.num('p21-qty',1)),cable:this.num('p21-cable'),strobe:this.num('p21-strobe'),reserve:this.num('p21-reserve'),sockets:this.num('p21-sockets'),switches:this.num('p21-switches'),pass:this.num('p21-pass'),cross:this.num('p21-cross'),tv:this.num('p21-tv'),thermo:this.num('p21-thermo'),wall:this.val('p21-wall','бетон'),mount:this.val('p21-mount','hidden'),pod:this.val('p21-pod','standard'),boxes:this.num('p21-boxes'),wago:this.num('p21-wago'),gml:this.num('p21-gml'),shrink:this.num('p21-shrink')};
    },
    addGroup(){this.groups.push(this.read());this.save();this.renderGroups();this.toast('Группа добавлена')},
    removeGroup(id){this.groups=this.groups.filter(g=>g.id!==id);this.save();this.renderGroups();this.build()},
    renderGroups(){
      const b=document.getElementById('p21-groups'),c=document.getElementById('p21-gc'); if(c)c.textContent=this.groups.length; if(!b)return;
      if(!this.groups.length){b.innerHTML='<div class="ep-pool-empty">Пока нет групп.</div>';return}
      b.innerHTML=this.groups.map(g=>`<div class="ep-pool-group"><div><b>${this.esc(g.room)} · ${this.esc(g.name)}</b><p>${g.qty} шт · механизмов ${(g.sockets+g.switches+g.pass+g.cross+g.tv+g.thermo)*g.qty} · кабель ${g.cable*g.qty} м · штроба ${g.strobe*g.qty} м</p><small>${this.esc(g.wall)} · ${g.mount==='surface'?'накладной':'скрытый'} · ${this.esc(g.pod)}</small></div><button data-p21-remove="${this.esc(g.id)}">×</button></div>`).join('')
    },
    raw(type,name,qty,unit,query){return {id:'d_'+Math.random().toString(16).slice(2),type,name,qty:Number(qty||0),unit:unit||'шт',price:0,dbName:'',dbItemId:'',missingDb:false,query:query||[name]}},
    merge(items){const m=new Map();items.forEach(x=>{if(!x.qty)return;const k=[x.type,this.norm(x.name),x.unit].join('|');if(m.has(k)){m.get(k).qty+=x.qty;m.get(k).query=[...new Set([...(m.get(k).query||[]),...(x.query||[])])]}else m.set(k,{...x})});return [...m.values()].map(x=>({...x,qty:Math.round(x.qty*100)/100}))},
    build(){
      const arr=[];
      this.groups.forEach(g=>{
        const k=Math.max(1,g.qty), mechs=(g.sockets+g.switches+g.pass+g.cross+g.tv+g.thermo)*k, cab=g.cable*k*(1+g.reserve/100), st=g.strobe*k, pod=g.mount==='surface'?0:mechs;
        if(cab>0)arr.push(this.raw('material','Кабель ВВГнг-LS 3x2.5',cab,'м',['кабель 3x2.5','ввг 3х2.5']));
        if(st>0){arr.push(this.raw('work','Штробление '+g.wall,st,'м',['штробление',g.wall]));arr.push(this.raw('work','Замазка штробы',st,'м',['замазка штробы']))}
        if(pod>0){arr.push(this.raw('material',g.pod==='deep'?'Подрозетник глубокий 68 мм':g.pod==='gkl'?'Подрозетник ГКЛ 68 мм':'Подрозетник бетон 68 мм',pod,'шт',['подрозетник',g.pod,g.wall]));arr.push(this.raw('work','Высверливание подрозетников '+g.wall,pod,'шт',['высверливание подрозетников',g.wall]));arr.push(this.raw('work','Установка подрозетника',pod,'шт',['установка подрозетника','вклейка подрозетника']))}
        if(g.mount==='surface'&&mechs>0)arr.push(this.raw('work','Установка накладного механизма',mechs,'шт',['установка накладного механизма']));
        if(g.sockets*k>0){arr.push(this.raw('material','Розетка скрытая 1 пост',g.sockets*k,'шт',['розетка скрытая']));arr.push(this.raw('work','Установка розетки 220В',g.sockets*k,'шт',['установка розетки 220']))}
        const sw=(g.switches+g.pass+g.cross)*k; if(sw>0){arr.push(this.raw('material','Выключатель 1-клавишный',sw,'шт',['выключатель проходной']));arr.push(this.raw('work','Установка выключателя',sw,'шт',['установка выключателя']))}
        if(g.tv*k>0){arr.push(this.raw('material','Розетка ТВ/интернет',g.tv*k,'шт',['розетка тв интернет слаботочная']));arr.push(this.raw('work','Установка слаботочной розетки',g.tv*k,'шт',['установка слаботочной розетки']))}
        if(g.thermo*k>0){arr.push(this.raw('material','Терморегулятор',g.thermo*k,'шт',['терморегулятор']));arr.push(this.raw('work','Установка терморегулятора',g.thermo*k,'шт',['установка терморегулятора']))}
        if(g.boxes*k>0){arr.push(this.raw('material','Коробка распределительная',g.boxes*k,'шт',['коробка распределительная']));arr.push(this.raw('work','Монтаж распаячной коробки',g.boxes*k,'шт',['монтаж распаячной коробки']))}
        if(g.wago*k>0)arr.push(this.raw('material','Клемма WAGO',g.wago*k,'шт',['wago клемма']));
        if(g.gml*k>0)arr.push(this.raw('material','Гильза ГМЛ',g.gml*k,'шт',['гмл гильза']));
        if(g.shrink*k>0)arr.push(this.raw('material','Термоусадка',g.shrink*k,'м',['термоусадка']));
      });
      this.draft=this.merge(arr);this.save();this.renderDraft();this.toast('Черновик собран');return this.draft;
    },
    async resolve(){
      if(!this.draft.length)this.build(); if(!this.draft.length)return this.toast('Черновик пуст');
      this.toast('Ищу позиции в '+this.sourceLabel()); this._items=await this.dbItems();
      for(const x of this.draft){const db=await this.find(x); if(db){x.dbItemId=db.id;x.dbName=db.name||db.n||db.title||x.name;x.price=Number(db.clientPrice||db.price||db.p||0);x.unit=db.unit||db.u||x.unit;x.missingDb=!x.price}else{x.price=0;x.missingDb=true}}
      this.save();this.renderDraft();this.toast('Подбор из БД завершён');
    },
    renderDraft(){
      const b=document.getElementById('p21-draft'),c=document.getElementById('p21-dc'); if(c)c.textContent=this.draft.length; if(!b)return;
      if(!this.draft.length){b.innerHTML='<div class="ep-pool-empty">Черновик пока пуст.</div>';return}
      let total=0; b.innerHTML=this.draft.map(x=>{const sum=x.qty*(x.price||0);total+=sum;return `<div class="ep-pool-result ${x.missingDb?'missing':''}"><div><b>${this.esc(x.name)}</b><p>${x.type==='work'?'Работа':'Материал'} · ${x.qty} ${this.esc(x.unit)} ${x.dbName?'· БД: '+this.esc(x.dbName):''}</p></div><div><strong>${this.money(x.price)}</strong><small>${this.money(sum)}</small></div></div>`}).join('')+`<div class="ep-pool-total"><span>Итого черновик</span><b>${this.money(total)}</b></div>`
    },
    addToEstimate(){
      if(!this.draft.length)this.build(); if(!this.draft.length)return this.toast('Черновик пуст');
      const items=this.draft.map(x=>({n:x.dbName||x.name,name:x.dbName||x.name,q:x.qty,qty:x.qty,p:x.price||0,price:x.price||0,u:x.unit,unit:x.unit,type:x.type==='work'?'work':'material',source:'pool_v21',sourceId:x.dbItemId||''}));
      if(typeof window.addAuto==='function'){window.addAuto(items.map(i=>({n:i.name,q:i.qty,p:i.price,u:i.unit,type:i.type==='work'?'work':'mat'})),'rough');return this.toast('Пул добавлен в смету')}
      if(window.Estimate){let ok=false;items.forEach(i=>{for(const m of ['addItem','add','addPosition'])if(typeof Estimate[m]==='function'){Estimate[m](i);ok=true;break}}); if(ok){Estimate.render?.();return this.toast('Пул добавлен в смету')}}
      localStorage.setItem('ep_pool_v21_pending_estimate',JSON.stringify(items)); alert('Смета пока не найдена. Позиции сохранены в ep_pool_v21_pending_estimate.');
    },
    clear(){if(!confirm('Очистить пул?'))return;this.groups=[];this.draft=[];this.save();this.renderGroups();this.renderDraft();this.toast('Пул очищен')},
    bind(){
      document.addEventListener('click',e=>{
        if(e.target.closest('[data-p21-close]')){e.preventDefault();return this.close()}
        if(e.target.closest('[data-p21-add]')){e.preventDefault();return this.addGroup()}
        if(e.target.closest('[data-p21-build]')){e.preventDefault();return this.build()}
        if(e.target.closest('[data-p21-resolve]')){e.preventDefault();return this.resolve()}
        if(e.target.closest('[data-p21-estimate]')){e.preventDefault();return this.addToEstimate()}
        if(e.target.closest('[data-p21-clear]')){e.preventDefault();return this.clear()}
        const rm=e.target.closest('[data-p21-remove]'); if(rm){e.preventDefault();return this.removeGroup(rm.dataset.p21Remove)}
        const hit=e.target.closest('button,.card,[data-route],[data-module]'); if(!hit)return;
        const txt=(hit.textContent||'').toLowerCase(), route=String(hit.dataset?.route||hit.dataset?.module||'').toLowerCase();
        if(txt.includes('пул розет')||txt.includes('розеток/штроб')||(txt.includes('штроб')&&txt.includes('пул'))||route.includes('pool')||route.includes('rough')){e.preventDefault();e.stopPropagation();this.open()}
      },true)
    },
    patch(){
      if(window.App?.openModule&&!window.App.openModule.__poolV21){const old=window.App.openModule.bind(window.App);window.App.openModule=(name)=>{const n=String(name||'').toLowerCase();if(n==='rough'||n==='pool'||n.includes('пул'))return this.open();return old(name)};window.App.openModule.__poolV21=true}
      if(window.Router?.navigate&&!window.Router.navigate.__poolV21){const old=window.Router.navigate.bind(window.Router);window.Router.navigate=(r,...a)=>{const n=String(r||'').toLowerCase();if(n==='pool'||n==='rough')return this.open();return old(r,...a)};window.Router.navigate.__poolV21=true}
    },
    init(){this.load();this.ensure();this.bind();this.patch();setTimeout(()=>this.patch(),900);setTimeout(()=>this.patch(),2200);window.PoolV21=this;this.diag('ok','pool-v21-ready','Pool V21.1 готов')}
  };
  window.PoolV21=PoolV21;
  window.addEventListener('DOMContentLoaded',()=>setTimeout(()=>PoolV21.init(),350));
})();
