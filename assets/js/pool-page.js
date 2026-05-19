(function(){
  'use strict'; const EP=window.EP; const KEY='ep_pool_groups_v1';
  function load(){ return EP.storage.get(KEY,[]); } function save(groups){ EP.storage.set(KEY,groups); }
  async function priced(type,name,qty,fallback,keywords,meta={}){ const r=await EP.db.price(type,keywords||name,fallback); return {type,name,qty,price:r.price,unit:meta.unit||'шт',category:meta.category||'',subcategory:meta.subcategory||'',tag:'pool',note:r.item?'из базы':'цена по умолчанию'}; }
  function readForm(){ return {id:EP.uid(),room:EP.$('p-room').value||'Помещение',name:EP.$('p-name').value||'Группа',sockets:Number(EP.$('p-sockets').value||0),switches:Number(EP.$('p-switches').value||0),lights:Number(EP.$('p-lights').value||0),utp:Number(EP.$('p-utp').value||0),tv:Number(EP.$('p-tv').value||0),distance:Number(EP.$('p-distance').value||8),height:Number(EP.$('p-height').value||270),wall:EP.$('p-wall').value||'Бетон',box:EP.$('p-box').value||'Бетон',createdAt:Date.now()}; }
  function render(){ const groups=load(); const box=EP.$('pool-list'); if(!box) return; if(!groups.length){ box.innerHTML='<div class="empty">Пока нет групп. Добавь группу розеток/выключателей.</div>'; return; } box.innerHTML=groups.map(g=>`<div class="item"><div><div class="item-title">${EP.esc(g.room)} · ${EP.esc(g.name)}</div><div class="item-meta">Розетки ${g.sockets}, выключатели ${g.switches}, свет ${g.lights}, UTP ${g.utp}, TV ${g.tv}; трасса ${g.distance} м; ${EP.esc(g.wall)}</div></div><div><button class="btn-danger" style="width:42px;padding:8px" onclick="EP.pool.remove('${g.id}')">×</button></div></div>`).join(''); }
  function addGroup(){ const g=readForm(); if(!(g.sockets+g.switches+g.lights+g.utp+g.tv)) return EP.toast('Укажи хотя бы один механизм'); const groups=load(); groups.push(g); save(groups); render(); EP.toast('Группа добавлена'); }
  function remove(id){ save(load().filter(x=>x.id!==id)); render(); }
  function clear(){ if(!confirm('Очистить группы пула?')) return; save([]); render(); }
  async function generate(){
    const groups=load(); if(!groups.length) return EP.toast('Сначала добавь группы'); const total={sockets:0,switches:0,lights:0,utp:0,tv:0,boxes:0,cable25:0,cable15:0,utpCable:0,tvCable:0,strobe:0,drill:0};
    for(const g of groups){ total.sockets+=g.sockets; total.switches+=g.switches; total.lights+=g.lights; total.utp+=g.utp; total.tv+=g.tv; total.boxes+=g.sockets+g.switches+g.utp+g.tv; total.cable25+=Math.ceil(g.distance*Math.max(1,g.sockets>0?1:0)+g.sockets*0.8); total.cable15+=Math.ceil(g.distance*Math.max(1,g.lights+g.switches>0?1:0)+g.lights*1.2); total.utpCable+=Math.ceil(g.distance*g.utp+g.utp*1.5); total.tvCable+=Math.ceil(g.distance*g.tv+g.tv*1.5); total.strobe+=Math.ceil(g.distance+(g.sockets+g.switches)*1.4); total.drill+=g.boxes; }
    const items=[];
    if(total.cable25) items.push(await priced('material','Кабель ВВГнг-LS 3x2.5',total.cable25,0,['ввг','3x2.5'],{category:'Кабель',subcategory:'ВВГ',unit:'м'}));
    if(total.cable15) items.push(await priced('material','Кабель ВВГнг-LS 3x1.5',total.cable15,0,['ввг','3x1.5'],{category:'Кабель',subcategory:'ВВГ',unit:'м'}));
    if(total.utpCable) items.push(await priced('material','UTP cat.5e / cat.6',total.utpCable,0,['utp'],{category:'Слаботочка',subcategory:'Интернет',unit:'м'}));
    if(total.tvCable) items.push(await priced('material','Коаксиальный кабель RG-6',total.tvCable,0,['rg','6'],{category:'Слаботочка',subcategory:'TV',unit:'м'}));
    if(total.boxes) items.push(await priced('material','Подрозетник 68 мм',total.boxes,0,['подрозетник'],{category:'Расходники',subcategory:'Подрозетники'}));
    if(total.sockets) items.push(await priced('material','Розетка скрытая 1 пост',total.sockets,0,['розетка'],{category:'Чистовая электрика',subcategory:'Розетки'}));
    if(total.switches) items.push(await priced('material','Выключатель',total.switches,0,['выключатель'],{category:'Чистовая электрика',subcategory:'Выключатели'}));
    items.push(await priced('material','WAGO / соединители',Math.ceil((total.sockets+total.switches+total.lights)/3),0,['wago'],{category:'Расходники',subcategory:'Соединители'}));
    items.push(await priced('work','Прокладка кабеля 3x2.5',total.cable25,140,['прокладка','3x2.5'],{category:'Черновая электрика',subcategory:'Прокладка кабеля',unit:'м'}));
    items.push(await priced('work','Прокладка кабеля 3x1.5',total.cable15,120,['прокладка','3x1.5'],{category:'Черновая электрика',subcategory:'Прокладка кабеля',unit:'м'}));
    if(total.utpCable+total.tvCable) items.push(await priced('work','Прокладка слаботочного кабеля',total.utpCable+total.tvCable,100,['прокладка','слаботочного'],{category:'Черновая электрика',subcategory:'Слаботочка',unit:'м'}));
    items.push(await priced('work','Штробление под трассы',total.strobe,450,['штробление','20x20'],{category:'Штробление и резка',subcategory:'Штробление',unit:'м'}));
    items.push(await priced('work','Высверливание подрозетника',total.drill,650,['высверливание','подрозетника'],{category:'Подрозетники',subcategory:'Бурение'}));
    items.push(await priced('work','Установка подрозетника',total.boxes,180,['установка','подрозетника'],{category:'Подрозетники',subcategory:'Монтаж'}));
    EP.estimate.addMany(items.filter(x=>x.qty>0)); renderSummary(total);
  }
  function renderSummary(t){ const b=EP.$('pool-summary'); if(!b) return; b.innerHTML=`<div class="status">Пул рассчитан: подрозетников ${t.boxes}, штробы ${t.strobe} м, кабеля силового ${t.cable25} м, света ${t.cable15} м</div>`; }
  EP.pool={addGroup,remove,clear,generate,render};
  document.addEventListener('DOMContentLoaded',()=>{ EP.shell.renderNav('pool.html'); EP.db.refreshActiveInfo(); render(); });
})();
