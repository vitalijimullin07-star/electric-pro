(function(){
  'use strict'; const EP=window.EP;
  async function approveUsers(){
    if(EP.state.role!=='admin' || !EP.fb?.db) return; const box=EP.$('pending-users'); if(!box) return; const snap=await EP.fb.db.collection('users').where('status','==','pending').get();
    if(snap.empty){ box.innerHTML='<div class="empty">Заявок нет</div>'; return; }
    box.innerHTML=snap.docs.map(d=>{ const u=d.data(); return `<div class="item"><div><div class="item-title">${EP.esc(u.name||'Мастер')}</div><div class="item-meta">${EP.esc(u.email||'')}</div></div><button class="btn-success" onclick="EP.settings.approve('${d.id}')">Одобрить</button></div>`; }).join('');
  }
  EP.settings={
    async approve(uid){ await EP.fb.db.collection('users').doc(uid).set({isApproved:true,status:'approved',approvedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}); EP.toast('Одобрено'); approveUsers(); },
    async clearLocal(){ if(confirm('Очистить локальные данные демо/сметы на этом устройстве?')){ ['ep_current_estimate_v2','ep_pool_groups_v1','ep_demo_db_v1'].forEach(k=>localStorage.removeItem(k)); EP.toast('Локальные данные очищены'); } },
    async clearMyDb(){ if(!confirm('Очистить мою базу?')) return; const items=await EP.db.load('my'); for(const it of items) await EP.db.delete('my',it.id); EP.toast('Моя база очищена'); },
    init(){ EP.shell.renderNav('settings.html'); EP.customer.fillForm(); EP.theme.init(); approveUsers(); }
  };
  document.addEventListener('DOMContentLoaded',()=>EP.settings.init());
})();
