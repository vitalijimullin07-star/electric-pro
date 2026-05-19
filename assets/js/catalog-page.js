(function(){
  'use strict'; const EP=window.EP; let state={type:'material',source:'my',items:[],selected:new Set(),query:''};
  function typeLabel(){ return state.type==='work'?'Работы':'Материалы'; }
  function sourceLabel(){ return EP.db.label(state.source); }
  async function load(){ state.query=EP.$('db-search')?.value||''; state.items=await EP.db.load(state.source,state.type,state.query); render(); }
  function setSource(s){ state.source=s==='server'?'server':'my'; state.selected.clear(); EP.$('src-my')?.classList.toggle('active',state.source==='my'); EP.$('src-server')?.classList.toggle('active',state.source==='server'); load(); }
  function setType(t){ state.type=t==='work'?'work':'material'; state.selected.clear(); EP.$('type-material')?.classList.toggle('active',state.type==='material'); EP.$('type-work')?.classList.toggle('active',state.type==='work'); load(); }
  function group(items){ const g={}; for(const it of items){ const c=it.category||'Без категории'; const s=it.subcategory||'Без подкатегории'; (g[c]||(g[c]={}))[s]||(g[c][s]=[]); g[c][s].push(it); } return g; }
  function render(){
    EP.setText('db-title',`${typeLabel()} · ${sourceLabel()}`); EP.setText('db-count',`${state.items.length} позиций`); const can=EP.db.canEdit(state.source);
    EP.qsa('[data-edit-only]').forEach(el=>el.classList.toggle('hidden',!can)); EP.qsa('[data-server-only]').forEach(el=>el.classList.toggle('hidden',state.source!=='server'));
    const list=EP.$('db-list'); if(!list) return; if(!state.items.length){ list.innerHTML='<div class="empty">Пусто. Добавь позицию или импортируй список.</div>'; return; }
    const limited=state.items.slice(0,EP.db.renderLimit); const hidden=state.items.length-limited.length; const gr=group(limited);
    let html=hidden>0?`<div class="note">Показаны первые ${limited.length} из ${state.items.length}. Для полного списка используй поиск — браузер не будет перегружаться.</div>`:'';
    Object.keys(gr).sort((a,b)=>a.localeCompare(b,'ru')).forEach(cat=>{
      const count=Object.values(gr[cat]).reduce((s,a)=>s+a.length,0); html+=`<div class="cat open"><div class="cat-head" onclick="this.parentElement.classList.toggle('open')"><span>${EP.esc(cat)}</span><span>${count}</span></div><div class="cat-body">`;
      Object.keys(gr[cat]).sort((a,b)=>a.localeCompare(b,'ru')).forEach(sub=>{
        html+=`<div class="subhead">${EP.esc(sub)} · ${gr[cat][sub].length}</div>`;
        gr[cat][sub].forEach(it=>{ const chk=state.selected.has(it.id)?'checked':''; html+=`<div class="item"><div><label style="display:flex;gap:8px;align-items:flex-start;text-transform:none;font-size:13px;color:var(--text)"><input type="checkbox" ${chk} onchange="EP.catalog.toggle('${it.id}',this.checked)" style="width:20px;height:20px;accent-color:var(--primary);margin:0"><span><span class="item-title">${EP.esc(it.name)}</span><span class="item-meta">${EP.esc(it.unit)} · ${EP.esc(it.category)} / ${EP.esc(it.subcategory)}</span></span></label></div><div><div class="item-price">${EP.money(it.price)}</div><button class="btn-success" style="margin-top:6px;width:44px;padding:8px" onclick="EP.catalog.addToEstimate('${it.id}')">+</button></div></div>`; });
      }); html+='</div></div>';
    }); list.innerHTML=html;
  }
  async function addToEstimate(id){ const it=state.items.find(x=>x.id===id); if(!it) return; const qty=Number(prompt('Количество:', '1')||1); if(qty<=0) return; EP.estimate.add({...it, qty, sourceDb:state.source}); EP.toast('Добавлено в смету'); }
  function toggle(id,checked){ checked?state.selected.add(id):state.selected.delete(id); }
  function selectAll(){ state.items.slice(0,EP.db.renderLimit).forEach(x=>state.selected.add(x.id)); render(); }
  function clearSel(){ state.selected.clear(); render(); }
  async function createItem(){ const name=EP.$('new-name').value.trim(); if(!name) return EP.toast('Введите название'); const item={type:state.type,name,category:EP.$('new-cat').value||'Без категории',subcategory:EP.$('new-sub').value||'Без подкатегории',price:EP.$('new-price').value||0,unit:EP.$('new-unit').value||'шт'}; await EP.db.save(state.source,item); ['new-name','new-price'].forEach(id=>EP.$(id).value=''); EP.toast('Позиция сохранена'); await load(); }
  async function deleteSelected(){ if(!state.selected.size) return EP.toast('Ничего не выбрано'); if(!confirm('Удалить выбранные позиции?')) return; for(const id of state.selected){ await EP.db.delete(state.source,id); } state.selected.clear(); await load(); EP.toast('Удалено'); }
  async function copySelected(){ const rows=state.items.filter(x=>state.selected.has(x.id)); if(!rows.length) return EP.toast('Ничего не выбрано'); const keep=confirm('Копировать с ценами? OK — с ценами, Отмена — без цен'); const n=await EP.db.copyToMy(rows,keep); state.selected.clear(); EP.toast('Добавлено в мою базу: '+n); }
  async function seedActive(){ const n=await EP.db.seedTo(state.source); EP.toast('Добавлено из стартовой базы: '+n); await load(); }
  async function exportActive(){ await EP.db.export(state.source); }
  async function importText(){ const text=EP.$('import-text').value; const rows=EP.db.parseText(text,state.type); if(!rows.length) return EP.toast('Не нашла строк для импорта'); if(!confirm('Импортировать '+rows.length+' позиций?')) return; const n=await EP.db.importRows(state.source,rows); EP.$('import-text').value=''; EP.toast('Импортировано: '+n); await load(); }
  async function importFile(ev){ const file=ev.target.files?.[0]; if(!file) return; const text=await file.text(); let rows=[]; try{ const json=JSON.parse(text); rows=(Array.isArray(json)?json:json.items||[]).map(EP.db.normalize); }catch(e){ rows=EP.db.parseText(text,state.type); } if(!rows.length) return EP.toast('Файл не разобран'); if(confirm('Импортировать '+rows.length+' позиций?')){ const n=await EP.db.importRows(state.source,rows); EP.toast('Импортировано: '+n); await load(); } ev.target.value=''; }
  EP.catalog={load,setSource,setType,addToEstimate,toggle,selectAll,clearSel,createItem,deleteSelected,copySelected,seedActive,exportActive,importText,importFile};
  document.addEventListener('DOMContentLoaded',()=>{ EP.shell.renderNav('database.html'); EP.db.refreshActiveInfo(); setSource(EP.db.activeSource); setType('material'); });
})();
