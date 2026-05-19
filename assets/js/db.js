(function(){
  'use strict';
  const EP=window.EP;
  const DBKEY='ep_demo_db_v1';
  const ACTIVE='ep_active_db_v1';
  function seed(){ return (window.EP_SEED_ITEMS||[]).map(x=>({...x, id:x.id||EP.uid(), deleted:false, source:'seed'})); }
  function normalize(it){
    return {
      id:it.id||EP.uid(), type:it.type==='work'?'work':'material',
      name:String(it.name||it.n||'').trim(), category:String(it.category||it.c||'Без категории').trim(),
      subcategory:String(it.subcategory||it.sc||it.g||'Без подкатегории').trim(),
      price:Number(it.price??it.p??0)||0, unit:String(it.unit||it.u||'шт').trim(),
      brand:it.brand||'', model:it.model||'', specs:it.specs||'', deleted:!!it.deleted,
      createdAt:it.createdAt||Date.now(), updatedAt:Date.now()
    };
  }
  EP.db={
    activeSource:localStorage.getItem(ACTIVE)||'my',
    renderLimit:350,
    normalize,
    setActive(source){ this.activeSource=source==='server'?'server':'my'; localStorage.setItem(ACTIVE,this.activeSource); this.refreshActiveInfo(); EP.toast('Активная база: '+this.label(this.activeSource)); },
    label(source){ return source==='server'?'База сервера':'Моя база'; },
    collection(source){
      if(source==='server') return EP.fb.db.collection('server_db');
      return EP.fb.db.collection('user_db').doc(EP.state.user.uid).collection('items');
    },
    canEdit(source){ return EP.state.demo || source==='my' || EP.state.role==='admin'; },
    localAll(){ let all=EP.storage.get(DBKEY,null); if(!all){ all={server:seed(), my:[]}; EP.storage.set(DBKEY,all); } return all; },
    localSave(all){ EP.storage.set(DBKEY,all); },
    async load(source=this.activeSource,type=null,query=''){
      source=source==='server'?'server':'my'; let items=[];
      if(EP.state.demo || !EP.fb?.db || !EP.state.user || EP.state.user.uid==='demo'){
        items=this.localAll()[source]||[];
      }else{
        let ref=this.collection(source).where('deleted','==',false);
        if(type) ref=ref.where('type','==',type);
        const snap=await ref.get(); items=snap.docs.map(d=>normalize({id:d.id,...d.data()}));
      }
      items=items.filter(x=>!x.deleted).map(normalize);
      if(type) items=items.filter(x=>x.type===type);
      const q=String(query||'').trim().toLowerCase();
      if(q) items=items.filter(it=>[it.name,it.category,it.subcategory,it.price,it.unit,it.brand,it.model].join(' ').toLowerCase().includes(q));
      return items.sort((a,b)=>(a.category+a.subcategory+a.name).localeCompare(b.category+b.subcategory+b.name,'ru'));
    },
    async save(source,item){
      source=source==='server'?'server':'my'; if(!this.canEdit(source)) throw new Error('Нет прав на редактирование '+this.label(source));
      const data=normalize(item);
      if(EP.state.demo || !EP.fb?.db || !EP.state.user || EP.state.user.uid==='demo'){
        const all=this.localAll(); const arr=all[source]||[]; const idx=arr.findIndex(x=>x.id===data.id);
        if(idx>=0) arr[idx]={...arr[idx],...data}; else arr.unshift(data); all[source]=arr; this.localSave(all); return data.id;
      }
      const col=this.collection(source); const id=data.id&&String(data.id).length>3?data.id:col.doc().id;
      await col.doc(id).set({...data,id,updatedBy:EP.state.user.uid,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),createdAt:data.createdAt||firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      return id;
    },
    async delete(source,id){
      source=source==='server'?'server':'my'; if(!this.canEdit(source)) throw new Error('Нет прав на удаление');
      if(EP.state.demo || !EP.fb?.db || !EP.state.user || EP.state.user.uid==='demo'){
        const all=this.localAll(); all[source]=(all[source]||[]).map(x=>x.id===id?{...x,deleted:true}:x); this.localSave(all); return;
      }
      await this.collection(source).doc(id).set({deleted:true,deletedAt:firebase.firestore.FieldValue.serverTimestamp(),deletedBy:EP.state.user.uid},{merge:true});
    },
    async seedTo(source){
      if(!this.canEdit(source)) throw new Error('Нет прав');
      const existing=await this.load(source); const keys=new Set(existing.map(x=>(x.type+'|'+x.name).toLowerCase())); let added=0;
      for(const it of seed()){ const key=(it.type+'|'+it.name).toLowerCase(); if(!keys.has(key)){ await this.save(source,it); added++; } }
      return added;
    },
    async copyToMy(items,withPrice=true){
      const my=await this.load('my'); const keys=new Set(my.map(x=>(x.type+'|'+x.name).toLowerCase())); let added=0;
      for(const raw of items){ const it=normalize({...raw, price:withPrice?raw.price:0, id:EP.uid()}); const key=(it.type+'|'+it.name).toLowerCase(); if(!keys.has(key)){ await this.save('my',it); keys.add(key); added++; } }
      return added;
    },
    async export(source=this.activeSource){ const items=await this.load(source); const blob=new Blob([JSON.stringify(items,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`electric-pro-${source}-db.json`; a.click(); URL.revokeObjectURL(a.href); },
    parseText(text,type){
      return String(text||'').split(/\n+/).map(l=>l.trim()).filter(Boolean).map(line=>{
        const parts=line.split(/[;\t]/).map(x=>x.trim());
        if(parts.length<2){ const csv=line.split(',').map(x=>x.trim()); if(csv.length>parts.length) parts.splice(0,parts.length,...csv); }
        return normalize({type:type||this.detectType(line), name:parts[0]||'', category:parts[1]||'Без категории', subcategory:parts[2]||'Без подкатегории', price:String(parts[3]||'0').replace(',','.'), unit:parts[4]||'шт'});
      }).filter(x=>x.name);
    },
    detectType(text){ return /монтаж|проклад|штроб|бурен|сверл|установ|сборк|подключ|демонтаж|работ/i.test(text)?'work':'material'; },
    async importRows(source,rows){ let added=0; for(const r of rows.map(normalize).filter(x=>x.name)){ await this.save(source,r); added++; } return added; },
    async lookup(type,keywords,source=this.activeSource){
      const words=(Array.isArray(keywords)?keywords:String(keywords).split(/\s+/)).map(x=>String(x).toLowerCase()).filter(Boolean);
      const items=await this.load(source,type);
      let best=null,score=0;
      for(const it of items){ const hay=[it.name,it.category,it.subcategory,it.brand,it.model].join(' ').toLowerCase(); let s=0; for(const w of words){ if(hay.includes(w)) s+=1; } if(s>score){ score=s; best=it; } }
      return best;
    },
    async price(type,keywords,fallback,source=this.activeSource){ const it=await this.lookup(type,keywords,source); return {price:it?Number(it.price)||0:Number(fallback)||0, item:it||null}; },
    refreshActiveInfo(){ EP.qsa('[data-active-db]').forEach(el=>el.textContent=this.label(this.activeSource)); EP.qsa('[data-active-db-badge]').forEach(el=>el.textContent='Активная база: '+this.label(this.activeSource)); }
  };
})();
