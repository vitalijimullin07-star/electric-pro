(function(){
  'use strict';

  const W = window;
  const D = document;

  const Admin = W.EPAdmin = W.EPAdmin || {};
  const state = Admin.state = Admin.state || {
    db:null, auth:null, user:null, profile:null, isAdmin:false,
    users:[], subscriptions:{}, ai:{}, logs:[], security:[],
    activeTab:'users', selectedUid:null, loading:false, lastError:null
  };

  function esc(v){
    return String(v ?? '').replace(/[&<>"']/g, s => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[s]));
  }

  function byId(id){ return D.getElementById(id); }
  function qs(sel, root=D){ return root.querySelector(sel); }
  function qsa(sel, root=D){ return Array.from(root.querySelectorAll(sel)); }

  function nowIso(){ return new Date().toISOString(); }

  function toDateInput(v){
    if(!v) return '';
    try{
      if(v && typeof v.toDate === 'function') return v.toDate().toISOString().slice(0,10);
      if(typeof v === 'string') return new Date(v).toISOString().slice(0,10);
      if(typeof v === 'number') return new Date(v).toISOString().slice(0,10);
    }catch(e){}
    return '';
  }

  function fmtDate(v){
    if(!v) return '—';
    try{
      const d = v && typeof v.toDate === 'function' ? v.toDate() : new Date(v);
      if(Number.isNaN(d.getTime())) return esc(v);
      return d.toLocaleString('ru-RU');
    }catch(e){ return esc(v); }
  }

  function money(v){
    const n = Number(v || 0);
    return n.toLocaleString('ru-RU', {maximumFractionDigits:2}) + ' ₽';
  }

  function toast(text, type){
    const old = qs('.ep-admin-toast');
    if(old) old.remove();
    const el = D.createElement('div');
    el.className = 'ep-admin-toast';
    el.textContent = text;
    if(type === 'bad') el.style.borderColor = 'rgba(239,68,68,.45)';
    if(type === 'good') el.style.borderColor = 'rgba(34,197,94,.45)';
    D.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function getCompat(){
    const fb = W.firebase;
    let db = W.epFirestore || W.db || W.firestore || W.firebaseDb || null;
    let auth = W.epAuth || W.auth || W.firebaseAuth || null;

    try{
      if(!db && fb && typeof fb.firestore === 'function') db = fb.firestore();
      if(!auth && fb && typeof fb.auth === 'function') auth = fb.auth();
    }catch(e){}

    state.db = db;
    state.auth = auth;
    return {db, auth};
  }

  function assertDb(){
    const {db} = getCompat();
    if(!db) throw new Error('Firebase/Firestore не найден. Проверь firebase-config и подключение Firebase до admin-core.js');
    if(typeof db.collection !== 'function' || typeof db.doc !== 'function'){
      throw new Error('Нужен compat-интерфейс Firestore: db.collection()/db.doc(). Если проект на modular SDK, нужен bridge в firebase-config.');
    }
    return db;
  }

  async function waitAuth(){
    const {auth} = getCompat();
    if(!auth) throw new Error('Firebase Auth не найден. Проверь auth/firebase-config.');
    if(auth.currentUser) return auth.currentUser;
    return await new Promise(resolve => {
      const off = auth.onAuthStateChanged(u => {
        try{ off && off(); }catch(e){}
        resolve(u);
      });
      setTimeout(() => resolve(auth.currentUser || null), 4500);
    });
  }

  async function getDoc(path){
    const db = assertDb();
    const snap = await db.doc(path).get();
    if(!snap.exists) return null;
    return {id:snap.id, ...snap.data()};
  }

  async function setDoc(path, data, merge=true){
    const db = assertDb();
    return db.doc(path).set(data, merge ? {merge:true} : undefined);
  }

  async function updateDoc(path, data){
    const db = assertDb();
    try{
      return await db.doc(path).update(data);
    }catch(e){
      return await db.doc(path).set(data, {merge:true});
    }
  }

  async function listCol(name, limit){
    const db = assertDb();
    const snap = await db.collection(name).limit(limit || 250).get();
    return snap.docs.map(d => ({id:d.id, ...d.data()}));
  }

  async function addCol(name, data){
    const db = assertDb();
    return db.collection(name).add(data);
  }

  function normalizeUser(u){
    const sub = state.subscriptions[u.id] || state.subscriptions[u.uid] || {};
    const ai = state.ai[u.id] || state.ai[u.uid] || {};
    return {
      uid: u.uid || u.id,
      email: u.email || u.mail || '',
      name: u.displayName || u.name || u.fullName || '',
      role: u.role || 'master',
      status: u.status || (u.securityPolicy && u.securityPolicy.blocked ? 'blocked' : 'active'),
      lastLoginAt: u.lastLoginAt || u.lastSeen || u.updatedAt || '',
      sub,
      ai,
      raw:u
    };
  }

  async function addAdminLog(action, targetUid, beforeData, afterData){
    try{
      await addCol('admin_logs', {
        action,
        targetUid: targetUid || '',
        adminUid: state.user ? state.user.uid : '',
        adminEmail: state.user ? state.user.email : '',
        before: beforeData || null,
        after: afterData || null,
        createdAt: nowIso(),
        source: 'v29-admin'
      });
    }catch(e){
      console.warn('[EPAdmin] admin log failed', e);
    }
  }

  function metrics(){
    const users = state.users.map(normalizeUser);
    const total = users.length;
    const activeSubs = users.filter(u => (u.sub.status || '') === 'active').length;
    const noSubs = users.filter(u => !u.sub.status || u.sub.status === 'expired').length;
    const aiOn = users.filter(u => u.ai.allowAi === true || u.ai.aiMode === 'admin_api' || u.ai.aiMode === 'user_api').length;
    const blocked = users.filter(u => u.status === 'blocked' || (u.raw.securityPolicy && u.raw.securityPolicy.blocked)).length;
    const errors = state.logs.filter(l => String(l.type || l.level || '').toLowerCase().includes('error')).length;
    return {total, activeSubs, noSubs, aiOn, blocked, errors};
  }

  function shell(root){
    const m = metrics();
    root.innerHTML = `
      <div class="ep-admin-header">
        <div class="ep-admin-title">
          <h1>Админка Electric Pro</h1>
          <p>Пользователи, подписки, ИИ-баланс, безопасность и логи. БД Claude не трогаем.</p>
        </div>
        <div class="ep-admin-actions">
          <span class="ep-admin-status" id="ep-admin-status">Готово</span>
          <button class="ep-admin-btn primary" data-admin-action="reload">Обновить</button>
        </div>
      </div>

      <div class="ep-admin-grid">
        <div class="ep-admin-metric"><b>${m.total}</b><span>Всего пользователей</span></div>
        <div class="ep-admin-metric"><b>${m.activeSubs}</b><span>Активные подписки</span></div>
        <div class="ep-admin-metric"><b>${m.noSubs}</b><span>Без подписки</span></div>
        <div class="ep-admin-metric"><b>${m.aiOn}</b><span>ИИ включён</span></div>
        <div class="ep-admin-metric"><b>${m.blocked}</b><span>Заблокированы</span></div>
        <div class="ep-admin-metric"><b>${m.errors}</b><span>Ошибки</span></div>
      </div>

      <div class="ep-admin-tabs">
        ${tabButton('users','Пользователи')}
        ${tabButton('subscriptions','Подписки')}
        ${tabButton('ai','ИИ-баланс')}
        ${tabButton('security','Безопасность')}
        ${tabButton('logs','Логи')}
        ${tabButton('docs','Документы')}
        ${tabButton('db','БД Claude')}
      </div>

      <div class="ep-admin-panel ${state.activeTab==='users'?'active':''}" data-admin-panel="users">${usersPanel()}</div>
      <div class="ep-admin-panel ${state.activeTab==='subscriptions'?'active':''}" data-admin-panel="subscriptions">${subscriptionsPanel()}</div>
      <div class="ep-admin-panel ${state.activeTab==='ai'?'active':''}" data-admin-panel="ai">${aiPanel()}</div>
      <div class="ep-admin-panel ${state.activeTab==='security'?'active':''}" data-admin-panel="security">${securityPanel()}</div>
      <div class="ep-admin-panel ${state.activeTab==='logs'?'active':''}" data-admin-panel="logs">${logsPanel()}</div>
      <div class="ep-admin-panel ${state.activeTab==='docs'?'active':''}" data-admin-panel="docs">${docsPanel()}</div>
      <div class="ep-admin-panel ${state.activeTab==='db'?'active':''}" data-admin-panel="db">${dbPanel()}</div>
    `;
    bind(root);
  }

  function tabButton(id, title){
    return `<button class="ep-admin-tab ${state.activeTab===id?'active':''}" data-admin-tab="${id}">${title}</button>`;
  }

  function badge(text, kind){
    return `<span class="ep-admin-badge ${kind || ''}">${esc(text || '—')}</span>`;
  }

  function usersPanel(){
    const users = state.users.map(normalizeUser);
    const rows = users.map(u => `
      <tr data-user-row="${esc(u.uid)}">
        <td><button class="ep-admin-btn" data-admin-action="open-user" data-uid="${esc(u.uid)}">Открыть</button></td>
        <td>${esc(u.email) || '—'}<br><span class="ep-admin-note">${esc(u.uid)}</span></td>
        <td>${esc(u.name) || '—'}</td>
        <td>${badge(u.role, u.role === 'admin' ? 'good' : '')}</td>
        <td>${badge(u.status, u.status === 'blocked' ? 'bad' : 'good')}</td>
        <td>${badge(u.sub.planName || u.sub.planId || 'нет', u.sub.status === 'active' ? 'good' : 'warn')}<br><span class="ep-admin-note">${fmtDate(u.sub.expiresAt)}</span></td>
        <td>${money(u.ai.balanceRub)}<br><span class="ep-admin-note">${esc(u.ai.aiMode || '—')}</span></td>
        <td>${fmtDate(u.lastLoginAt)}</td>
      </tr>
    `).join('');

    return `
      <div class="ep-admin-two">
        <div class="ep-admin-card">
          <h2>Пользователи</h2>
          <input class="ep-admin-search" id="ep-admin-user-search" placeholder="Поиск по email, имени, UID, роли, статусу">
          <div class="ep-admin-table-wrap">
            <table class="ep-admin-table" id="ep-admin-users-table">
              <thead><tr>
                <th></th><th>Email / UID</th><th>Имя</th><th>Роль</th><th>Статус</th><th>Подписка</th><th>ИИ</th><th>Последний вход</th>
              </tr></thead>
              <tbody>${rows || `<tr><td colspan="8" class="ep-admin-empty">Пользователи не загрузились или коллекция users пустая</td></tr>`}</tbody>
            </table>
          </div>
        </div>
        <div class="ep-admin-card" id="ep-admin-user-card">
          ${userCard()}
        </div>
      </div>
    `;
  }

  function selectedUser(){
    if(!state.selectedUid && state.users.length) state.selectedUid = state.users[0].uid || state.users[0].id;
    const raw = state.users.find(u => (u.uid || u.id) === state.selectedUid);
    return raw ? normalizeUser(raw) : null;
  }

  function userCard(){
    const u = selectedUser();
    if(!u) return `<h2>Карточка пользователя</h2><div class="ep-admin-empty">Выбери пользователя из списка</div>`;
    const raw = u.raw || {};
    const sp = raw.securityPolicy || {};
    return `
      <h2>Карточка пользователя</h2>
      <div class="ep-admin-note">UID: ${esc(u.uid)}</div>
      <div class="ep-admin-form">
        <label>Email<input value="${esc(u.email)}" readonly></label>
        <label>Имя<input value="${esc(u.name)}" readonly></label>
        <label>Роль
          <select id="ep-user-role">
            ${option('admin', u.role, 'admin')}
            ${option('master', u.role, 'master')}
            ${option('user', u.role, 'user')}
          </select>
        </label>
        <label>Статус
          <select id="ep-user-status">
            ${option('active', u.status, 'active')}
            ${option('blocked', u.status, 'blocked')}
            ${option('pending', u.status, 'pending')}
            ${option('deleted', u.status, 'deleted')}
          </select>
        </label>
        <label>Тариф
          <select id="ep-sub-plan">
            ${option('basic', u.sub.planId, 'Базовая')}
            ${option('ai', u.sub.planId, 'С ИИ')}
            ${option('test_2_days', u.sub.planId, 'Тест 2 дня')}
          </select>
        </label>
        <label>Статус подписки
          <select id="ep-sub-status">
            ${option('active', u.sub.status, 'active')}
            ${option('expired', u.sub.status, 'expired')}
            ${option('cancelled', u.sub.status, 'cancelled')}
            ${option('blocked', u.sub.status, 'blocked')}
          </select>
        </label>
        <label>Дата окончания подписки<input type="date" id="ep-sub-expires" value="${toDateInput(u.sub.expiresAt)}"></label>
        <label>ИИ-режим
          <select id="ep-ai-mode">
            ${option('admin_api', u.ai.aiMode, 'admin_api')}
            ${option('user_api', u.ai.aiMode, 'user_api')}
            ${option('disabled', u.ai.aiMode, 'disabled')}
          </select>
        </label>
        <label>ИИ-баланс, ₽<input type="number" step="0.01" id="ep-ai-balance" value="${Number(u.ai.balanceRub || 0)}"></label>
        <label>Комментарий админа<textarea id="ep-admin-comment">${esc(u.sub.adminComment || raw.adminComment || '')}</textarea></label>
      </div>
      <div class="ep-admin-button-row">
        <button class="ep-admin-btn good" data-admin-action="save-user-main" data-uid="${esc(u.uid)}">Сохранить роль/статус</button>
        <button class="ep-admin-btn primary" data-admin-action="save-subscription" data-uid="${esc(u.uid)}">Выдать/продлить подписку</button>
        <button class="ep-admin-btn primary" data-admin-action="save-ai" data-uid="${esc(u.uid)}">Сохранить ИИ-баланс</button>
        <button class="ep-admin-btn warn" data-admin-action="disable-ai" data-uid="${esc(u.uid)}">Отключить ИИ</button>
        <button class="ep-admin-btn bad" data-admin-action="block-user" data-uid="${esc(u.uid)}">Заблокировать</button>
        <button class="ep-admin-btn good" data-admin-action="unblock-user" data-uid="${esc(u.uid)}">Разблокировать</button>
      </div>
      <div class="ep-admin-note" style="margin-top:10px">
        securityPolicy: blocked=${esc(sp.blocked)}, aiBlocked=${esc(sp.aiBlocked)}, onlineOnly=${esc(sp.onlineOnly)}, reviewRequired=${esc(sp.reviewRequired)}
      </div>
    `;
  }

  function option(value, current, label){
    const sel = String(value) === String(current || '') ? 'selected' : '';
    return `<option value="${esc(value)}" ${sel}>${esc(label || value)}</option>`;
  }

  function subscriptionsPanel(){
    const users = state.users.map(normalizeUser);
    const rows = users.map(u => `
      <tr>
        <td>${esc(u.email) || esc(u.uid)}</td>
        <td>${esc(u.sub.planName || u.sub.planId || 'нет')}</td>
        <td>${badge(u.sub.status || 'нет', u.sub.status === 'active' ? 'good' : 'warn')}</td>
        <td>${fmtDate(u.sub.startsAt)}</td>
        <td>${fmtDate(u.sub.expiresAt)}</td>
        <td><button class="ep-admin-btn" data-admin-tab-jump="users" data-admin-action="open-user" data-uid="${esc(u.uid)}">Открыть</button></td>
      </tr>
    `).join('');
    return `
      <div class="ep-admin-card">
        <h2>Подписки</h2>
        <p class="ep-admin-note">Ручное назначение тарифов: Базовая, С ИИ, Тест 2 дня. Запись идёт в user_subscriptions/{uid}.</p>
        <div class="ep-admin-table-wrap"><table class="ep-admin-table">
          <thead><tr><th>Пользователь</th><th>Тариф</th><th>Статус</th><th>Начало</th><th>Окончание</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="ep-admin-empty">Нет данных</td></tr>`}</tbody>
        </table></div>
      </div>`;
  }

  function aiPanel(){
    const users = state.users.map(normalizeUser);
    const rows = users.map(u => `
      <tr>
        <td>${esc(u.email) || esc(u.uid)}</td>
        <td>${badge(u.ai.allowAi ? 'включён' : 'выключен', u.ai.allowAi ? 'good' : 'warn')}</td>
        <td>${esc(u.ai.aiMode || '—')}</td>
        <td>${money(u.ai.balanceRub)}</td>
        <td>${money(u.ai.spentRub)}</td>
        <td>${money(u.ai.limitRub)}</td>
        <td><button class="ep-admin-btn" data-admin-tab-jump="users" data-admin-action="open-user" data-uid="${esc(u.uid)}">Открыть</button></td>
      </tr>
    `).join('');
    return `
      <div class="ep-admin-card">
        <h2>ИИ-баланс</h2>
        <p class="ep-admin-note">Ключи openaiKey/geminiKey/apiKey в интерфейсе не показываются.</p>
        <div class="ep-admin-table-wrap"><table class="ep-admin-table">
          <thead><tr><th>Пользователь</th><th>ИИ</th><th>Режим</th><th>Баланс</th><th>Расход</th><th>Лимит</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="ep-admin-empty">Нет данных</td></tr>`}</tbody>
        </table></div>
      </div>`;
  }

  function securityPanel(){
    const users = state.users.map(normalizeUser);
    const rows = users.map(u => {
      const sp = u.raw.securityPolicy || {};
      return `
        <tr>
          <td>${esc(u.email) || esc(u.uid)}</td>
          <td>${badge(sp.blocked || u.status === 'blocked' ? 'blocked' : 'active', sp.blocked || u.status === 'blocked' ? 'bad' : 'good')}</td>
          <td>${badge(sp.aiBlocked ? 'ИИ заблокирован' : 'ИИ норм', sp.aiBlocked ? 'bad' : 'good')}</td>
          <td>${badge(sp.onlineOnly ? 'online only' : 'обычный', sp.onlineOnly ? 'warn' : '')}</td>
          <td>${badge(sp.reviewRequired ? 'до проверки' : 'нет', sp.reviewRequired ? 'warn' : '')}</td>
          <td><button class="ep-admin-btn" data-admin-tab-jump="users" data-admin-action="open-user" data-uid="${esc(u.uid)}">Открыть</button></td>
        </tr>`;
    }).join('');
    return `
      <div class="ep-admin-card">
        <h2>Безопасность</h2>
        <p class="ep-admin-note">Блокировка аккаунта, отключение ИИ, online-only и reviewRequired через users/{uid}.securityPolicy.</p>
        <div class="ep-admin-table-wrap"><table class="ep-admin-table">
          <thead><tr><th>Пользователь</th><th>Аккаунт</th><th>ИИ</th><th>Кэш/режим</th><th>Проверка</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="ep-admin-empty">Нет данных</td></tr>`}</tbody>
        </table></div>
      </div>`;
  }

  function logsPanel(){
    const rows = state.logs.slice(0,120).map(l => `
      <tr>
        <td>${fmtDate(l.createdAt || l.time || l.timestamp)}</td>
        <td>${esc(l.action || l.type || l.level || 'log')}</td>
        <td>${esc(l.adminEmail || l.adminUid || '')}</td>
        <td>${esc(l.targetUid || l.uid || '')}</td>
        <td>${esc(l.message || l.error || JSON.stringify(l.after || l.data || {}).slice(0,160))}</td>
      </tr>
    `).join('');
    return `
      <div class="ep-admin-card">
        <h2>Логи</h2>
        <p class="ep-admin-note">admin_logs + error_logs. Обычные клики не логируются.</p>
        <div class="ep-admin-table-wrap"><table class="ep-admin-table">
          <thead><tr><th>Дата</th><th>Действие</th><th>Админ</th><th>Пользователь</th><th>Детали</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="ep-admin-empty">Логи пустые или нет прав чтения</td></tr>`}</tbody>
        </table></div>
      </div>`;
  }

  function docsPanel(){
    return `
      <div class="ep-admin-card">
        <h2>Документы, сметы, черновики, бухгалтерия</h2>
        <p class="ep-admin-note">
          Каркас готов. Подключать будем после стабилизации БД и прав доступа.
          Планируемые пути: users/{uid}/drafts, users/{uid}/estimates, users/{uid}/documents, users/{uid}/accounting.
        </p>
      </div>`;
  }

  function dbPanel(){
    return `
      <div class="ep-admin-card">
        <h2>БД Claude</h2>
        <div class="ep-admin-ok">
          Зона БД защищена. Наша админка не меняет epdb26_my, epdb26_server, материалы, работы, щит и ручную однолинейку.
        </div>
        <p class="ep-admin-note">
          Claude должен связать БД с сервером по путям:
          <br>server_database/{itemId}
          <br>users/{uid}/my_database/{itemId}
        </p>
      </div>`;
  }

  function setStatus(text){ const s = byId('ep-admin-status'); if(s) s.textContent = text; }

  async function loadAll(root){
    state.loading = true;
    state.lastError = null;
    if(root){
      root.innerHTML = `<div class="ep-admin-loading"><div class="ep-admin-loader"></div><div><h2>Админка Electric Pro</h2><p>Проверяю права администратора...</p></div></div>`;
    }

    try{
      state.user = await waitAuth();
      if(!state.user){
        root.innerHTML = `<div class="ep-admin-error"><b>Нет входа.</b><br>Сначала войди в аккаунт.</div>`;
        return;
      }

      state.profile = await getDoc(`users/${state.user.uid}`);
      state.isAdmin = !!(state.profile && state.profile.role === 'admin');

      if(!state.isAdmin){
        root.innerHTML = `
          <div class="ep-admin-error">
            <b>Доступ запрещён.</b><br>
            Админка доступна только пользователю с users/{uid}.role = "admin".<br>
            Текущий email: ${esc(state.user.email || '')}
          </div>`;
        return;
      }

      setStatus('Загружаю Firestore...');
      const [users, subs, ai, adminLogs, errorLogs, security] = await Promise.allSettled([
        listCol('users', 500),
        listCol('user_subscriptions', 500),
        listCol('ai_accounts', 500),
        listCol('admin_logs', 150),
        listCol('error_logs', 150),
        listCol('security_events', 150)
      ]);

      state.users = users.status === 'fulfilled' ? users.value : [];
      const subArr = subs.status === 'fulfilled' ? subs.value : [];
      const aiArr = ai.status === 'fulfilled' ? ai.value : [];
      const logArr = [
        ...(adminLogs.status === 'fulfilled' ? adminLogs.value : []),
        ...(errorLogs.status === 'fulfilled' ? errorLogs.value : [])
      ];
      state.security = security.status === 'fulfilled' ? security.value : [];

      state.subscriptions = Object.fromEntries(subArr.map(x => [x.uid || x.id, x]));
      state.ai = Object.fromEntries(aiArr.map(x => [x.uid || x.id, x]));
      state.logs = logArr.sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

      shell(root);
      setStatus('Загружено с Firebase');
      toast('Админка загружена', 'good');
    }catch(e){
      console.error('[EPAdmin] load failed', e);
      state.lastError = e;
      root.innerHTML = `
        <div class="ep-admin-error">
          <b>Ошибка админки</b><br>${esc(e.message || e)}
          <br><br>
          Если видишь permission-denied — нужны права Firestore для admin role. Rules/functions этот установщик не деплоит.
        </div>`;
    }finally{
      state.loading = false;
    }
  }

  function bind(root){
    qsa('[data-admin-tab]', root).forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.adminTab;
        qsa('.ep-admin-tab', root).forEach(x => x.classList.toggle('active', x === btn));
        qsa('.ep-admin-panel', root).forEach(p => p.classList.toggle('active', p.dataset.adminPanel === state.activeTab));
      });
    });

    const search = byId('ep-admin-user-search');
    if(search){
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        qsa('[data-user-row]', root).forEach(tr => {
          tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-admin-action]');
      if(!btn) return;
      const action = btn.dataset.adminAction;
      const uid = btn.dataset.uid;

      if(btn.dataset.adminTabJump){
        state.activeTab = btn.dataset.adminTabJump;
      }

      try{
        if(action === 'reload') return loadAll(root);
        if(action === 'open-user'){
          state.selectedUid = uid;
          shell(root);
          return;
        }
        if(action === 'save-user-main') return saveUserMain(uid, root);
        if(action === 'save-subscription') return saveSubscription(uid, root);
        if(action === 'save-ai') return saveAi(uid, root);
        if(action === 'disable-ai') return disableAi(uid, root);
        if(action === 'block-user') return setBlocked(uid, true, root);
        if(action === 'unblock-user') return setBlocked(uid, false, root);
      }catch(err){
        console.error('[EPAdmin] action failed', err);
        toast(err.message || String(err), 'bad');
      }
    });
  }

  function planName(planId){
    if(planId === 'basic') return 'Базовая';
    if(planId === 'ai') return 'С ИИ';
    if(planId === 'test_2_days') return 'Тест 2 дня';
    return planId || 'Базовая';
  }

  async function saveUserMain(uid, root){
    const role = byId('ep-user-role').value;
    const status = byId('ep-user-status').value;
    const before = state.users.find(u => (u.uid || u.id) === uid) || {};
    await updateDoc(`users/${uid}`, {
      role, status,
      updatedAt: nowIso(),
      updatedBy: state.user.uid
    });
    await addAdminLog('user_update_role_status', uid, before, {role, status});
    toast('Роль/статус сохранены', 'good');
    await loadAll(root);
  }

  async function saveSubscription(uid, root){
    const planId = byId('ep-sub-plan').value;
    const status = byId('ep-sub-status').value;
    const expires = byId('ep-sub-expires').value;
    const comment = byId('ep-admin-comment').value || '';
    const before = state.subscriptions[uid] || null;
    const data = {
      uid,
      planId,
      planName: planName(planId),
      status,
      startsAt: before && before.startsAt ? before.startsAt : nowIso(),
      expiresAt: expires ? new Date(expires + 'T23:59:59').toISOString() : '',
      updatedAt: nowIso(),
      updatedBy: state.user.uid,
      adminComment: comment
    };
    await setDoc(`user_subscriptions/${uid}`, data, true);
    await addAdminLog('subscription_save', uid, before, data);
    toast('Подписка сохранена', 'good');
    await loadAll(root);
  }

  async function saveAi(uid, root){
    const aiMode = byId('ep-ai-mode').value;
    const balanceRub = Number(byId('ep-ai-balance').value || 0);
    const before = state.ai[uid] || null;
    const data = {
      uid,
      allowAi: aiMode !== 'disabled' && balanceRub > 0,
      aiMode,
      balanceRub,
      updatedAt: nowIso(),
      updatedBy: state.user.uid
    };
    await setDoc(`ai_accounts/${uid}`, data, true);
    await addAdminLog('ai_account_save', uid, before, data);
    toast('ИИ-баланс сохранён', 'good');
    await loadAll(root);
  }

  async function disableAi(uid, root){
    const before = state.ai[uid] || null;
    const data = {
      uid,
      allowAi:false,
      aiMode:'disabled',
      updatedAt: nowIso(),
      updatedBy: state.user.uid
    };
    await setDoc(`ai_accounts/${uid}`, data, true);
    await updateDoc(`users/${uid}`, {
      'securityPolicy.aiBlocked': true,
      'securityPolicy.reviewRequired': true,
      updatedAt: nowIso(),
      updatedBy: state.user.uid
    });
    await addAdminLog('ai_disabled', uid, before, data);
    toast('ИИ отключён', 'good');
    await loadAll(root);
  }

  async function setBlocked(uid, blocked, root){
    const before = state.users.find(u => (u.uid || u.id) === uid) || {};
    const data = {
      status: blocked ? 'blocked' : 'active',
      'securityPolicy.blocked': blocked,
      'securityPolicy.blockReason': blocked ? 'blocked_by_admin' : '',
      'securityPolicy.reviewRequired': blocked,
      updatedAt: nowIso(),
      updatedBy: state.user.uid
    };
    await updateDoc(`users/${uid}`, data);
    await addCol('security_events', {
      uid,
      type: blocked ? 'account_blocked' : 'account_unblocked',
      adminUid: state.user.uid,
      adminEmail: state.user.email || '',
      createdAt: nowIso(),
      source:'v29-admin'
    });
    await addAdminLog(blocked ? 'account_blocked' : 'account_unblocked', uid, before, data);
    toast(blocked ? 'Аккаунт заблокирован' : 'Аккаунт разблокирован', 'good');
    await loadAll(root);
  }

  function ensureAdminContainerIfRoute(){
    const routeText = (location.hash + ' ' + location.pathname + ' ' + location.search).toLowerCase();
    if(!routeText.includes('admin')) return null;

    let root = qs('#ep-admin-root');
    if(root) return root;

    const container = qs('#app') || qs('#page-content') || qs('#content') || qs('main') || qs('.app-main') || D.body;
    const section = D.createElement('section');
    section.id = 'ep-admin-root';
    section.className = 'ep-admin-root';
    section.dataset.adminVersion = 'v29.29';
    section.innerHTML = `<div class="ep-admin-loading"><div class="ep-admin-loader"></div><div><h2>Админка Electric Pro</h2><p>Открываю...</p></div></div>`;
    container.innerHTML = '';
    container.appendChild(section);
    return section;
  }

  function mount(){
    const root = qs('#ep-admin-root') || ensureAdminContainerIfRoute();
    if(!root) return;
    if(root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    loadAll(root);
  }

  async function maybeInjectAdminLink(){
    try{
      const {auth} = getCompat();
      if(!auth) return;
      const user = auth.currentUser || await waitAuth();
      if(!user) return;
      const profile = await getDoc(`users/${user.uid}`);
      if(!profile || profile.role !== 'admin') return;
      if(qs('[data-ep-admin-open]')) return;

      const link = D.createElement('a');
      link.href = '#admin';
      link.className = 'ep-admin-menu-link';
      link.dataset.epAdminOpen = '1';
      link.textContent = 'Админка';
      link.addEventListener('click', () => setTimeout(mount, 60));

      const target = qs('#burger-menu') || qs('.burger-menu') || qs('.side-menu') || qs('.drawer') || qs('nav') || null;
      if(target) target.appendChild(link);
    }catch(e){
      console.warn('[EPAdmin] menu inject skipped', e);
    }
  }

  Admin.init = mount;
  Admin.reload = () => {
    const root = qs('#ep-admin-root');
    if(root) loadAll(root);
  };

  D.addEventListener('DOMContentLoaded', () => {
    mount();
    setTimeout(maybeInjectAdminLink, 1200);
  });
  W.addEventListener('hashchange', () => setTimeout(mount, 30));

  const mo = new MutationObserver(() => {
    if(qs('#ep-admin-root:not([data-mounted="1"])')) mount();
  });
  D.addEventListener('DOMContentLoaded', () => {
    if(D.body) mo.observe(D.body, {childList:true, subtree:true});
  });
})();
