(function(){
  'use strict';
  const EP = window.EP = window.EP || {};
  EP.version = 'Master Clean V1';
  EP.state = { user:null, profile:null, role:'guest', demo:false, ready:false };
  EP.$ = (id)=>document.getElementById(id);
  EP.qs = (s,root=document)=>root.querySelector(s);
  EP.qsa = (s,root=document)=>Array.from(root.querySelectorAll(s));
  EP.money = (n)=> `${Math.round(Number(n)||0).toLocaleString('ru-RU')} ₽`;
  EP.esc = (v)=>String(v ?? '').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
  EP.uid = ()=> Date.now().toString(36)+'_'+Math.random().toString(16).slice(2);
  EP.toast = (text)=>{ const t=EP.$('toast')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'toast',className:'toast'})); t.textContent=text; t.classList.add('show'); clearTimeout(EP._toastTimer); EP._toastTimer=setTimeout(()=>t.classList.remove('show'),2600); };
  EP.show = (id)=>{ const el=EP.$(id); if(el) el.classList.remove('hidden'); };
  EP.hide = (id)=>{ const el=EP.$(id); if(el) el.classList.add('hidden'); };
  EP.modal = (id,show=true)=>{ const el=EP.$(id); if(el) el.classList.toggle('show',show); };
  EP.setText = (id,text)=>{ const el=EP.$(id); if(el) el.textContent=text; };
  EP.storage = {
    get(key,fallback){ try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));}catch(e){return fallback;} },
    set(key,val){ localStorage.setItem(key, JSON.stringify(val)); },
    del(key){ localStorage.removeItem(key); }
  };
  EP.theme = {
    init(){ const theme=localStorage.getItem('ep_theme')||'light'; document.documentElement.dataset.theme=theme; const s=EP.$('theme-select'); if(s) s.value=theme; },
    set(v){ localStorage.setItem('ep_theme',v); document.documentElement.dataset.theme=v; EP.toast('Тема: '+v); }
  };
  EP.customer = {
    key:'ep_customer_v1',
    get(){ return EP.storage.get(this.key,{name:'',phone:'',addr:'',ceil:270,performer:'',tg:'',wa:'',site:''}); },
    save(data){ EP.storage.set(this.key,{...this.get(),...data}); EP.toast('Данные сохранены'); },
    fillForm(){ const c=this.get(); ['c-name','c-phone','c-addr','c-ceil','c-performer','c-tg','c-wa','c-site'].forEach(id=>{ const el=EP.$(id); if(el){ const k=id.replace('c-',''); el.value=c[k]||''; }}); },
    readForm(){ const get=id=>EP.$(id)?.value||''; this.save({name:get('c-name'),phone:get('c-phone'),addr:get('c-addr'),ceil:Number(get('c-ceil')||270),performer:get('c-performer'),tg:get('c-tg'),wa:get('c-wa'),site:get('c-site')}); }
  };
  EP.auth = {
    async init(){
      EP.theme.init();
      if(!window.firebase || !window.EP_FIREBASE_CONFIG){ EP.useDemo('Firebase не загружен, включён демо-режим'); return; }
      try{
        if(!firebase.apps.length) firebase.initializeApp(window.EP_FIREBASE_CONFIG);
        EP.fb = { auth: firebase.auth(), db: firebase.firestore() };
        EP.fb.auth.onAuthStateChanged(async user=>{
          if(!user){ EP.state.user=null; EP.state.profile=null; EP.state.role='guest'; EP.state.demo=false; EP.renderAuthState(); return; }
          EP.state.user=user; EP.state.demo=false; await EP.loadProfile(user); EP.renderAuthState();
        });
      }catch(e){ console.error(e); EP.useDemo('Ошибка Firebase: '+e.message); }
    },
    async login(){
      try{ const p=new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({prompt:'select_account'}); await EP.fb.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); await EP.fb.auth.signInWithPopup(p); }
      catch(e){ console.error(e); EP.toast('Ошибка входа: '+(e.code||e.message)); }
    },
    async logout(){ if(EP.state.demo){ EP.state.demo=false; location.href='index.html'; return; } if(EP.fb?.auth) await EP.fb.auth.signOut(); },
    demo(){ EP.useDemo('Демо-режим: всё хранится только на этом устройстве'); }
  };
  EP.useDemo = (msg)=>{ EP.state.user={uid:'demo',email:'demo@local',displayName:'Демо мастер'}; EP.state.profile={name:'Демо мастер',email:'demo@local',role:'master',isApproved:true}; EP.state.role='master'; EP.state.demo=true; EP.renderAuthState(); if(msg) EP.toast(msg); };
  EP.loadProfile = async(user)=>{
    const adminEmails=(window.EP_ADMIN_EMAILS||[]).map(x=>String(x).toLowerCase());
    const isEmailAdmin=adminEmails.includes(String(user.email||'').toLowerCase());
    const ref=EP.fb.db.collection('users').doc(user.uid);
    const snap=await ref.get();
    if(!snap.exists){
      const profile={name:user.displayName||'Мастер',email:user.email||'',role:isEmailAdmin?'admin':'master',isApproved:isEmailAdmin,status:isEmailAdmin?'approved':'pending',createdAt:firebase.firestore.FieldValue.serverTimestamp()};
      await ref.set(profile,{merge:true}); EP.state.profile=profile; EP.state.role=profile.role; return;
    }
    const p=snap.data()||{}; const isAdmin=isEmailAdmin||p.role==='admin'||p.isAdmin===true||p.admin===true;
    EP.state.profile={...p,role:isAdmin?'admin':(p.role||'master')}; EP.state.role=EP.state.profile.role;
  };
  EP.isApproved = ()=> EP.state.demo || EP.state.role==='admin' || EP.state.profile?.isApproved===true || EP.state.profile?.status==='approved';
  EP.renderAuthState = ()=>{
    const authed=!!EP.state.user && EP.isApproved();
    EP.qsa('[data-auth="guest"]').forEach(el=>el.classList.toggle('hidden',!!EP.state.user));
    EP.qsa('[data-auth="user"]').forEach(el=>el.classList.toggle('hidden',!authed));
    EP.qsa('[data-auth="waiting"]').forEach(el=>el.classList.toggle('hidden',!EP.state.user || authed));
    EP.qsa('[data-admin]').forEach(el=>el.classList.toggle('hidden',EP.state.role!=='admin'));
    const p=EP.state.profile||{}; EP.qsa('[data-user-badge]').forEach(el=>{ el.textContent= EP.state.demo ? 'ДЕМО' : (EP.state.role==='admin'?'АДМИН':'МАСТЕР'); });
    EP.qsa('[data-user-name]').forEach(el=>{ el.textContent=(p.name||EP.state.user?.displayName||'Пользователь')+' · '+(p.email||EP.state.user?.email||''); });
    if(authed && EP.db) EP.db.refreshActiveInfo();
    if(authed && EP.estimate) EP.estimate.render();
  };
  EP.shell = {
    renderNav(active){
      const nav=EP.$('main-nav'); if(!nav) return;
      const pages=[['index.html','Главная'],['database.html','База'],['shield.html','Щит'],['pool.html','Пул'],['documents.html','Документы'],['settings.html','Настройки']];
      nav.innerHTML=pages.map(([href,label])=>`<a class="${active===href?'active':''}" href="${href}">${label}</a>`).join('');
    }
  };
  document.addEventListener('click',e=>{ const close=e.target.closest('[data-close-modal]'); if(close) EP.modal(close.dataset.closeModal,false); });
  document.addEventListener('DOMContentLoaded',()=>EP.auth.init());
})();
