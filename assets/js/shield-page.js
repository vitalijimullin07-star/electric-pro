(function(){
  'use strict'; const EP=window.EP;
  const sizes=[6,12,24,36,48,60,72];
  function $(id){return EP.$(id);} function val(id,def=''){return $(id)?.value||def;} function chk(id){return !!$(id)?.checked;} function num(id,def=0){return Number($(id)?.textContent||$(id)?.value||def)||0;} function ceilBox(mods){return sizes.find(x=>x>=mods)||72;}
  async function priced(type,name,qty,fallback,keywords,meta={}){ const r=await EP.db.price(type,keywords||name,fallback); return {type,name,qty,price:r.price,unit:meta.unit||'шт',category:meta.category||'',subcategory:meta.subcategory||'',tag:'shield',note:r.item?'из базы':'цена по умолчанию'}; }
  function line(name,nominal,group,wet=false,light=false){return {name,nominal,group,wet,light};}
  async function generate(){
    const phase=val('cfg-phase','1'), curve=val('cfg-curve','C'), rcdType=val('cfg-rcd','A'), protection=val('cfg-protection','uzo_auto');
    const boxBrand=val('cfg-box-brand',''), autoBrand=val('cfg-auto-brand',''), install=val('cfg-install','Встраиваемый');
    const kitchens=num('kits'), baths=num('baths'), toilets=num('toilets'), rooms=num('rooms'), bals=num('bals');
    let lines=[];
    for(let i=1;i<=kitchens;i++){ lines.push(line(`Кухня ${i}: розетки`,16,'Кухня')); lines.push(line(`Кухня ${i}: освещение`,10,'Освещение',false,true)); }
    for(let i=1;i<=baths;i++){ lines.push(line(`Ванная ${i}: розетки`,16,'Влажные зоны',true)); lines.push(line(`Ванная ${i}: освещение`,10,'Освещение',true,true)); }
    for(let i=1;i<=toilets;i++){ lines.push(line(`Туалет ${i}: розетки`,16,'Влажные зоны',true)); lines.push(line(`Туалет ${i}: освещение`,10,'Освещение',true,true)); }
    for(let i=1;i<=rooms;i++){ lines.push(line(`Комната ${i}: розетки`,16,'Комнаты')); lines.push(line(`Комната ${i}: освещение`,10,'Освещение',false,true)); }
    for(let i=1;i<=bals;i++){ lines.push(line(`Балкон ${i}: розетки`,16,'Балконы')); lines.push(line(`Балкон ${i}: освещение`,10,'Освещение',false,true)); }
    if(chk('c-apron')) lines.push(line('Кухонный фартук',16,'Кухня'));
    if(chk('c-dish')) lines.push(line('Посудомойка',10,'Техника'));
    if(chk('c-washer')) lines.push(line('Стиральная/сушильная машина',10,'Влажные зоны',true));
    if(chk('c-towel')) lines.push(line('Полотенцесушитель',10,'Влажные зоны',true));
    if(chk('c-fridge')) lines.push(line('Холодильник неотключаемый',10,'Неотключаемые'));
    if(chk('c-router')) lines.push(line('Роутер неотключаемый',6,'Неотключаемые'));
    if(chk('c-oven')) lines.push(line('Духовой шкаф',16,'Техника'));
    if(chk('c-hob')) lines.push(line('Варочная панель',32,'Техника'));
    if(chk('c-ac')) lines.push(line('Кондиционер',16,'Климат'));
    const autos={}; lines.forEach(l=>{autos[l.nominal]=(autos[l.nominal]||0)+1;});
    const wet=lines.filter(l=>l.wet).length, light=lines.filter(l=>l.light).length, power=lines.length-light;
    let twoPole=0, difs=0, mainDif=0;
    if(protection==='uzo_auto'){ twoPole=Math.ceil(power/6)+(light?1:0)+(wet?1:0); }
    if(protection==='dif_auto'){ difs=lines.length; }
    if(protection==='main_dif_auto'){ mainDif=1; }
    if(protection==='mixed'){ difs=wet; twoPole=Math.ceil((lines.length-wet)/6); }
    const relay=chk('cfg-relay')? (phase==='3'?4:2):0, contactor=chk('cfg-master')&&light?2:0;
    const modules=Object.values(autos).reduce((a,b)=>a+b,0)+(twoPole*2)+(difs*2)+(mainDif*2)+relay+contactor+(phase==='3'?4:2);
    const box=ceilBox(modules), rows=Math.ceil(box/12), comb1=Math.ceil(Object.values(autos).reduce((a,b)=>a+b,0)/12), comb2=Math.ceil((twoPole+difs+mainDif)/6), nBus=twoPole+difs+mainDif;
    const items=[];
    items.push(await priced('material',`Щит ${install.toLowerCase()} ${box} мод. ${boxBrand}`,1,0,['щит',String(box),'мод'],{category:'Щитовое',subcategory:install.includes('Наклад')?'Корпуса накладные':'Корпуса встраиваемые'}));
    for(const [nom,q] of Object.entries(autos)){ items.push(await priced('material',`Автомат ${curve}${nom} 1P ${autoBrand}`,q,0,['автомат',curve+nom,'1p',autoBrand],{category:'Автоматика',subcategory:'Автоматы'})); }
    if(twoPole) items.push(await priced('material',`УЗО 2P 40A 30mA тип ${rcdType} ${autoBrand}`,twoPole,0,['узо','40','30','тип',rcdType,autoBrand],{category:'Автоматика',subcategory:'УЗО'}));
    if(wet && (protection==='uzo_auto'||protection==='mixed')) items.push(await priced('material',`Защита влажных зон 10mA тип ${rcdType}`,1,0,['узо','10ma',rcdType],{category:'Автоматика',subcategory:'УЗО/ДИФ 10мА'}));
    if(difs) items.push(await priced('material',`Дифавтомат ${curve}16 30mA тип ${rcdType} ${autoBrand}`,difs,0,['диф',curve+'16','30',rcdType,autoBrand],{category:'Автоматика',subcategory:'Дифавтоматы'}));
    if(mainDif) items.push(await priced('material',`Главный дифавтомат ${phase==='3'?'4P':'2P'} тип ${rcdType}`,1,0,['главный','диф',rcdType],{category:'Автоматика',subcategory:'Дифавтоматы'}));
    if(relay) items.push(await priced('material',`Реле напряжения ${phase==='3'?'3Ф':'1Ф'}`,1,0,['реле','напряжения'],{category:'Автоматика',subcategory:'Реле напряжения'}));
    if(contactor) items.push(await priced('material','Контактор мастер-кнопки света 25A',1,0,['контактор','25'],{category:'Автоматика',subcategory:'Контакторы'}));
    items.push(await priced('material','Гребёнка 1P 12 модулей / 25 см',comb1,0,['гребёнка','1p'],{category:'Щитовое',subcategory:'Гребёнки'}));
    items.push(await priced('material','Гребёнка 2P 12 модулей / 25 см',comb2,0,['гребёнка','2p'],{category:'Щитовое',subcategory:'Гребёнки'}));
    items.push(await priced('material','Шина N на DIN-рейку',Math.max(1,nBus),0,['шина','n'],{category:'Щитовое',subcategory:'Шины'}));
    items.push(await priced('material','Шина PE на DIN-рейку',1,0,['шина','pe'],{category:'Щитовое',subcategory:'Шины'}));
    items.push(await priced('material','Провод ПуГВ 1x6 для щита',Math.max(3,rows*2),0,['пугв','1x6'],{category:'Щитовое',subcategory:'Провод щитовой',unit:'м'}));
    items.push(await priced('material','НШВИ 6',Math.max(20,lines.length*2),0,['ншви','6'],{category:'Щитовое',subcategory:'Наконечники'}));
    items.push(await priced('work','Сборка щита',modules,500,['сборка','щита'],{category:'Щитовое',subcategory:'Сборка щита',unit:'мод.'}));
    items.push(await priced('work','Установка щита',1,install.includes('Наклад')?2500:4500,['монтаж','щит'],{category:'Щитовое',subcategory:'Монтаж щита'}));
    items.push(await priced('work','Подключение вводного кабеля',1,1500,['подключение','вводного','кабеля'],{category:'Щитовое',subcategory:'Монтаж щита'}));
    items.push(await priced('work','Прозвонка / проверка линий',lines.length,150,['проверка','линий'],{category:'Щитовое',subcategory:'Проверка',unit:'линия'}));
    items.push({type:'work',name:`ℹ️ Щит: линий ${lines.length}; занято ${modules} мод.; корпус ${box}М; свободно ${Math.max(0,box-modules)} мод.`,qty:1,price:0,unit:'шт',category:'Щитовое',subcategory:'Инфо',tag:'shield'});
    EP.estimate.addMany(items.filter(x=>x.qty>0)); renderDetails(lines,{modules,box,protection,curve,rcdType,wet,light,comb1,comb2,nBus});
  }
  function renderDetails(lines,d){ const box=EP.$('shield-details'); if(!box) return; box.innerHTML=`<div class="status">Щит рассчитан: ${lines.length} линий, ${d.modules} модулей, корпус ${d.box}М</div><div class="table-wrap"><table><thead><tr><th>Линия</th><th>Автомат</th><th>Группа</th></tr></thead><tbody>${lines.map(l=>`<tr><td>${EP.esc(l.name)}</td><td>${EP.esc(d.curve)}${l.nominal}</td><td>${EP.esc(l.group)}${l.wet?' · 10мА':''}</td></tr>`).join('')}</tbody></table></div>`; }
  function mod(id,delta){ const el=$(id); if(!el) return; el.textContent=Math.max(0,Number(el.textContent||0)+delta); }
  EP.shield={generate,mod};
  document.addEventListener('DOMContentLoaded',()=>{ EP.shell.renderNav('shield.html'); EP.db.refreshActiveInfo(); });
})();
