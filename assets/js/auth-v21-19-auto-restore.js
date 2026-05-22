(function(){
  const FILE="assets/js/auth-v21-19-auto-restore.js";
  const VERSION="V21.19";
  let listenerSet=false;
  let __authV2119LastRestoreLog=0;
  let __authV2119LastPersistenceLog=0;

  function diag(level,code,message,extra={}){
    try{
      const payload={file:FILE,module:"AuthV2119AutoRestore",functionName:"runtime",place:"auth",code,message,...extra};
      if(level==="error") window.Diagnostics?.error?.(payload);
      else window.Diagnostics?.ok?.(payload);
    }catch(e){}
  }

  function getAuth(){
    try{ if(window.firebase?.auth) return window.firebase.auth(); }catch(e){}
    try{ if(window.auth) return window.auth; }catch(e){}
    return null;
  }

  function getUser(){
    try{
      const auth=getAuth();
      return auth?.currentUser || window.currentUser || window.AppState?.user || null;
    }catch(e){ return null; }
  }

  async function setLocalPersistence(){
    const auth=getAuth();
    if(!auth?.setPersistence) return false;
    try{
      if(window.firebase?.auth?.Auth?.Persistence?.LOCAL){
        await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
        {const now=Date.now();if(now-__authV2119LastPersistenceLog>4000){__authV2119LastPersistenceLog=now;diag("ok","auth-persistence-local","Firebase Auth persistence LOCAL включён.");}}
        return true;
      }
    }catch(e){
      diag("error","auth-persistence-error",e?.message||String(e));
    }
    return false;
  }

  function remember(user){
    if(!user) return;
    try{
      const safe={
        uid:user.uid||"",
        email:user.email||"",
        displayName:user.displayName||"",
        photoURL:user.photoURL||"",
        savedAt:Date.now()
      };
      localStorage.setItem("ep_last_auth_user",JSON.stringify(safe));
      localStorage.setItem("ep_last_uid",safe.uid);
      localStorage.setItem("ep_last_email",safe.email);
    }catch(e){}
    try{
      window.currentUser=user;
      window.AppState=window.AppState||{};
      window.AppState.user=user;
      window.AppState.uid=user.uid||window.AppState.uid;
    }catch(e){}
  }

  function lastUser(){
    try{ return JSON.parse(localStorage.getItem("ep_last_auth_user")||"null"); }
    catch(e){ return null; }
  }

  function hideLogin(){
    const selectors=[
      "#login-screen","#auth-screen","#ep-login","#ep-auth",
      ".login-screen",".auth-screen","[data-auth-screen]","[data-login-screen]"
    ];
    selectors.forEach(sel=>{
      document.querySelectorAll(sel).forEach(el=>{
        el.classList.add("hidden");
        el.style.display="none";
      });
    });
    document.body.classList.add("ep-auth-restored");
    document.documentElement.classList.add("ep-auth-restored");
  }

  function showApp(){
    const selectors=[
      "#app","#main-app","#app-shell","#main-screen",
      ".app-shell",".main-screen","[data-app-shell]","[data-main-screen]"
    ];
    selectors.forEach(sel=>{
      document.querySelectorAll(sel).forEach(el=>{
        el.classList.remove("hidden");
        if(el.style.display==="none") el.style.display="";
      });
    });
  }

  function updateUserText(user){
    const saved=lastUser()||{};
    const name=user?.displayName||user?.email||saved.displayName||saved.email||"";
    const email=user?.email||saved.email||"";
    try{
      document.querySelectorAll("[data-user-name],.user-name,#user-name").forEach(el=>{ if(name) el.textContent=name; });
      document.querySelectorAll("[data-user-email],.user-email,#user-email").forEach(el=>{ if(email) el.textContent=email; });
    }catch(e){}
  }

  function callMain(user){
    const funcs=["openMainScreen","showMainScreen","renderMainScreen","openHome","showHome","renderHome","bootApp","startApp","initAppAfterLogin","afterLogin","onLoginSuccess"];
    for(const name of funcs){
      try{
        if(typeof window[name]==="function"){
          window[name](user);
          return name;
        }
      }catch(e){ diag("error","auth-main-call-error",name+": "+(e?.message||e)); }
    }
    try{
      if(window.App?.openMain){ window.App.openMain(user); return "App.openMain"; }
      if(window.App?.afterLogin){ window.App.afterLogin(user); return "App.afterLogin"; }
      if(window.Router?.go){ window.Router.go("home"); return "Router.go"; }
    }catch(e){ diag("error","auth-main-object-error",e?.message||String(e)); }
    return "";
  }

  function restore(user,source){
    if(!user) return false;
    remember(user);
    updateUserText(user);
    hideLogin();
    showApp();
    const opened=callMain(user);
    setTimeout(()=>{hideLogin();showApp();updateUserText(user);},150);
    setTimeout(()=>{hideLogin();showApp();updateUserText(user);},700);
    setTimeout(()=>{hideLogin();showApp();updateUserText(user);},1600);
    {const now=Date.now();if(now-__authV2119LastRestoreLog>4000){__authV2119LastRestoreLog=now;diag("ok","auth-restored","Вход восстановлен после обновления страницы.",{uid:user.uid||"",email:user.email||"",source,opened});}}
    return true;
  }

  function bindListener(){
    const auth=getAuth();
    if(!auth?.onAuthStateChanged || listenerSet) return false;
    listenerSet=true;
    try{
      auth.onAuthStateChanged(user=>{
        if(user) restore(user,"onAuthStateChanged");
        else diag("ok","auth-missing","Firebase пока не восстановил пользователя.");
      });
      diag("ok","auth-listener-ready","Auth listener installed.");
      return true;
    }catch(e){
      listenerSet=false;
      diag("error","auth-listener-error",e?.message||String(e));
      return false;
    }
  }

  function tryNow(){
    const user=getUser();
    if(user) return restore(user,"immediate");
    const saved=lastUser();
    if(saved?.email || saved?.uid){
      updateUserText(saved);
      diag("ok","auth-last-user-found","Последний пользователь найден, ждём Firebase.",{uid:saved.uid||"",email:saved.email||""});
    }
    return false;
  }

  function init(){
    setLocalPersistence();
    bindListener();
    tryNow();

    let ticks=0;
    const timer=setInterval(()=>{
      ticks++;
      setLocalPersistence();
      bindListener();
      const user=getUser();
      if(user) restore(user,"guard");
      if(ticks>24) clearInterval(timer);
    },500);

    document.addEventListener("click",()=>{
      setTimeout(()=>{ const user=getUser(); if(user) restore(user,"after-click"); },1200);
    },true);

    window.AuthV2119AutoRestore={version:VERSION,restore,getUser,setLocalPersistence};
    diag("ok","auth-v21-19-ready","Auth V21.19 auto restore ready.");
  }

  window.addEventListener("DOMContentLoaded",init);
})();
