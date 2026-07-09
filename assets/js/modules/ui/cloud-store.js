/* Electric Pro V29 — общий помощник облачной синхронизации (Firestore).
   Источник истины — localStorage (офлайн). Облако — поверх, best-effort, НИКОГДА не роняет
   приложение. Пишем в drafts/{uid}/v29/{name} — эта ветка уже разрешена владельцу в правилах
   (менять правила не нужно). Используется складом, затратами, инструментом и т.п. */
(function () {
  "use strict";
  window.EP = window.EP || {};

  function db() { try { return (window.EP && window.EP.Firebase && window.EP.Firebase.db) || null; } catch (e) { return null; } }
  function authUid() { try { var u = window.EP && window.EP.Auth && window.EP.Auth.currentUser && window.EP.Auth.currentUser(); return u && u.uid ? u.uid : null; } catch (e) { return null; } }
  function ref(name) { var d = db(), u = authUid(); if (!d || !u || !name) return null; try { return d.collection("drafts").doc(u).collection("v29").doc(name); } catch (e) { return null; } }

  function push(name, data) {
    var r = ref(name); if (!r) return Promise.resolve(false);
    try { return r.set(Object.assign({ updatedAt: Date.now() }, data || {}), { merge: true }).then(function () { return true; }).catch(function () { return false; }); }
    catch (e) { return Promise.resolve(false); }
  }
  function pull(name) {
    var r = ref(name); if (!r) return Promise.resolve(null);
    try { return r.get().then(function (s) { return (s && s.exists ? s.data() : null); }).catch(function () { return null; }); }
    catch (e) { return Promise.resolve(null); }
  }
  // объединение массивов по id (облако перекрывает при совпадении id; итог — надмножество, ничего не теряется)
  function mergeById(localArr, cloudArr) {
    var m = {};
    (localArr || []).forEach(function (x) { if (x && x.id) m[x.id] = x; });
    (cloudArr || []).forEach(function (x) { if (x && x.id) m[x.id] = x; });
    return Object.keys(m).map(function (k) { return m[k]; });
  }

  var loginFns = [], fired = false;
  function runLogin() { if (!authUid()) return; loginFns.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function onLogin(fn) { if (typeof fn === "function") { loginFns.push(fn); if (fired && authUid()) { try { fn(); } catch (e) {} } } }

  window.addEventListener("ep:auth-changed", function (e) { if (e && e.detail && e.detail.user) { fired = true; runLogin(); } });
  setTimeout(function () { if (!fired) { fired = true; runLogin(); } }, 1900); // если вход случился до загрузки модуля

  window.EP.Cloud = { ref: ref, push: push, pull: pull, mergeById: mergeById, onLogin: onLogin, authUid: authUid, isReady: function () { return !!(db() && authUid()); } };
})();
