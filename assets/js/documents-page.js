(function(){
  'use strict'; const EP=window.EP;
  function rows(){ EP.estimate.load(); return EP.estimate.items.map((it,i)=>`<tr><td>${i+1}</td><td>${EP.esc(it.name)}</td><td>${EP.esc(it.unit)}</td><td>${it.qty}</td><td>${EP.money(it.price*it.qty)}</td></tr>`).join(''); }
  function totals(){ return EP.estimate.totals(); }
  function data(){ return EP.customer.get(); }
  function render(type='contract'){
    const c=data(), t=totals(); let html='';
    if(type==='contract') html=`<div class="doc-title"><h2>Договор на электромонтажные работы</h2></div><p>Исполнитель: <b>${EP.esc(c.performer||'________________')}</b></p><p>Заказчик: <b>${EP.esc(c.name||'________________')}</b>, телефон ${EP.esc(c.phone||'')}</p><p>Объект: ${EP.esc(c.addr||'')}</p><p>Исполнитель обязуется выполнить электромонтажные работы по согласованной смете. Стоимость по текущей смете: <b>${EP.money(t.total)}</b>.</p><p>Сроки, порядок оплаты и гарантийные условия заполняются мастером перед печатью.</p><p style="margin-top:40px">Исполнитель: ____________ / Заказчик: ____________</p>`;
    if(type==='act') html=`<div class="doc-title"><h2>Акт выполненных работ</h2></div><p>Объект: ${EP.esc(c.addr||'')}</p><table><thead><tr><th>№</th><th>Работа/материал</th><th>Ед.</th><th>Кол.</th><th>Сумма</th></tr></thead><tbody>${rows()}</tbody></table><h3 style="text-align:right">Итого принято: ${EP.money(t.total)}</h3><p style="margin-top:40px">Работы сдал: ____________ / Работы принял: ____________</p>`;
    if(type==='offer') html=`<div class="doc-title"><h2>Коммерческое предложение</h2></div><p>Для: <b>${EP.esc(c.name||'заказчика')}</b></p><p>Адрес объекта: ${EP.esc(c.addr||'')}</p>${EP.estimate.printHtml('client')}<p>Контакты мастера: Telegram ${EP.esc(c.tg||'')}, WhatsApp ${EP.esc(c.wa||'')}, сайт ${EP.esc(c.site||'')}</p>`;
    if(type==='checklist') html=`<div class="doc-title"><h2>Чек-лист объекта</h2></div><p>Объект: ${EP.esc(c.addr||'')}</p><ul><li>Проверить вводной кабель и заземление.</li><li>Сверить количество линий со щитом.</li><li>Проверить влажные зоны: 10 мА.</li><li>Сфотографировать трассы до штукатурки.</li><li>Проверить подписи линий в щите.</li><li>Передать заказчику смету, детализацию, акт.</li></ul>`;
    const out=EP.$('doc-output'); if(out) out.innerHTML=`<div class="print-box">${html}</div>`;
  }
  EP.docs={render,saveCustomer(){ EP.customer.readForm(); render(EP.$('doc-type')?.value||'contract'); }};
  document.addEventListener('DOMContentLoaded',()=>{ EP.shell.renderNav('documents.html'); EP.customer.fillForm(); EP.estimate.render(); render('contract'); });
})();
