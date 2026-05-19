(function(){
  'use strict';
  const EP=window.EP; const KEY='ep_current_estimate_v2';
  function norm(it){ return {id:it.id||EP.uid(), type:it.type==='work'?'work':'material', name:it.name||it.n||'', category:it.category||it.c||'', subcategory:it.subcategory||it.sc||'', qty:Number(it.qty??it.q??1)||1, price:Number(it.price??it.p??0)||0, unit:it.unit||it.u||'шт', tag:it.tag||'', note:it.note||'', sourceDb:it.sourceDb||EP.db?.activeSource||'my'}; }
  EP.estimate={
    items:[],
    load(){ this.items=EP.storage.get(KEY,[]).map(norm); return this.items; },
    save(){ EP.storage.set(KEY,this.items.map(norm)); this.saveRemoteDraft(); },
    async saveRemoteDraft(){
      try{ if(EP.state.demo||!EP.fb?.db||!EP.state.user||EP.state.user.uid==='demo') return; await EP.fb.db.collection('estimate_drafts').doc(EP.state.user.uid).set({items:this.items, customer:EP.customer.get(), updatedAt:firebase.firestore.FieldValue.serverTimestamp(), uid:EP.state.user.uid, email:EP.state.user.email||''},{merge:true}); }catch(e){ console.warn('draft save skipped',e); }
    },
    add(item){ this.load(); this.items.push(norm(item)); this.save(); this.render(); },
    addMany(items){ this.load(); items.forEach(x=>this.items.push(norm(x))); this.save(); this.render(); EP.toast('Добавлено в смету: '+items.length); },
    update(id,patch){ this.load(); this.items=this.items.map(x=>x.id===id?norm({...x,...patch}):x); this.save(); this.render(); },
    remove(id){ this.load(); this.items=this.items.filter(x=>x.id!==id); this.save(); this.render(); },
    clear(){ if(!confirm('Очистить текущую смету?')) return; this.items=[]; this.save(); this.render(); EP.toast('Смета очищена'); },
    totals(){ this.load(); let mat=0,work=0; for(const it of this.items){ const sum=(Number(it.qty)||0)*(Number(it.price)||0); if(it.type==='work') work+=sum; else mat+=sum; } return {mat,work,total:mat+work}; },
    render(){
      this.load(); const box=EP.$('estimate-box'); if(!box) return; const totals=this.totals();
      EP.qsa('[data-total]').forEach(el=>el.textContent=EP.money(totals.total)); EP.qsa('[data-total-mat]').forEach(el=>el.textContent=EP.money(totals.mat)); EP.qsa('[data-total-work]').forEach(el=>el.textContent=EP.money(totals.work));
      if(!this.items.length){ box.innerHTML='<div class="empty">Смета пустая. Добавь позиции из базы, щита или пула.</div>'; return; }
      const rows=this.items.map(it=>`<tr><td><b>${EP.esc(it.name)}</b><div class="mini">${EP.esc(it.category)} / ${EP.esc(it.subcategory)} · ${EP.esc(it.unit)} ${it.tag?`<span class="pill">${EP.esc(it.tag)}</span>`:''}</div></td><td><input class="qty" type="number" value="${it.qty}" onchange="EP.estimate.update('${it.id}',{qty:this.value})"></td><td class="right"><b>${EP.money(it.qty*it.price)}</b><div class="mini">${EP.money(it.price)}</div></td><td><button class="btn-danger" style="width:38px;padding:0" onclick="EP.estimate.remove('${it.id}')">×</button></td></tr>`).join('');
      box.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Позиция</th><th>Кол-во</th><th class="right">Сумма</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="status" style="margin-top:10px">Итого: ${EP.money(totals.total)} · Материалы: ${EP.money(totals.mat)} · Работы: ${EP.money(totals.work)}</div>`;
    },
    printHtml(mode='client'){
      this.load(); const c=EP.customer.get(); const totals=this.totals();
      const rows=this.items.filter(it=>mode!=='vendor'||it.type==='material').map((it,i)=>`<tr><td>${i+1}</td><td>${EP.esc(it.name)}<br><small>${EP.esc(it.category)} / ${EP.esc(it.subcategory)}</small></td><td>${EP.esc(it.unit)}</td><td>${it.qty}</td><td>${EP.money(it.price)}</td><td>${EP.money(it.price*it.qty)}</td></tr>`).join('');
      return `<div class="print-box"><div class="doc-title"><h2>${mode==='vendor'?'Заявка поставщику':mode==='details'?'Детализация сметы':'Смета на электромонтажные работы'}</h2><p>Заказчик: <b>${EP.esc(c.name||'')}</b> · Объект: ${EP.esc(c.addr||'')}</p></div><table><thead><tr><th>№</th><th>Наименование</th><th>Ед.</th><th>Кол.</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody></table><h3 style="text-align:right">Итого: ${EP.money(mode==='vendor'?totals.mat:totals.total)}</h3></div>`;
    },
    showPreview(mode){ const body=EP.$('preview-body'); if(body) body.innerHTML=this.printHtml(mode); EP.modal('preview-modal',true); }
  };
  document.addEventListener('DOMContentLoaded',()=>EP.estimate.render());
})();
