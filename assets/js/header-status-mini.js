(function () {
  const FILE = "assets/js/header-status-mini.js";
  let currentSub = null, currentAi = null, boundUid = null, unsubSub = null, unsubAi = null;

  function money(value){return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(Number(value||0))+"₽";}
  function toDate(value){try{if(!value)return null;if(value.toDate)return value.toDate();if(typeof value==="string")return new Date(value);if(typeof value==="number")return new Date(value);return null;}catch{return null;}}
  function daysLeft(date){if(!date)return null;return Math.ceil((date.getTime()-Date.now())/86400000);}
  function planName(planId){if(planId==="pro_ai")return "С ИИ";if(planId==="basic")return "Базовая";return "Нет подписки";}

  function ensureTopStatus(){
    let line=document.getElementById("epTopStatusLine");
    if(line)return line;
    line=document.createElement("div");
    line.id="epTopStatusLine";
    line.className="ep-top-status-line";
    line.innerHTML='<div class="ep-top-status-left">Подписка: проверка...</div><div class="ep-top-status-right">ИИ: —</div>';
    const app=document.getElementById("appShell")||document.querySelector(".app-shell")||document.querySelector("main")||document.body;
    app.prepend(line);
    return line;
  }

  function render(){
    const line=ensureTopStatus(); if(!line)return;
    const left=line.querySelector(".ep-top-status-left"), right=line.querySelector(".ep-top-status-right");
    const sub=currentSub||{}, ai=currentAi||{};
    const planId=sub.planId||"none", status=sub.status||"none", expiresAt=toDate(sub.expiresAt), leftDays=daysLeft(expiresAt);
    let statusClass="none", subText="Нет подписки";
    if((status==="active"||status==="trial")&&leftDays!==null&&leftDays>=0){
      subText=status==="trial" ? `${planName(planId)} · пробный · ${leftDays}д` : `${planName(planId)} · ${leftDays}д`;
      statusClass=planId==="pro_ai"?"pro":"basic"; if(status==="trial")statusClass="trial";
    }
    const mode=ai.accessMode||"disabled", balance=Number(ai.balanceRub||0);
    let aiText=`ИИ ${money(balance)}`; if(mode==="own_api")aiText="API мастера"; if(mode==="disabled")aiText="ИИ выкл.";
    left.textContent=subText; right.textContent=aiText; line.dataset.status=statusClass; line.dataset.ai=mode;
  }

  async function bind(uid){
    if(!uid||boundUid===uid){render();return;}
    boundUid=uid;
    try{
      if(unsubSub)unsubSub(); if(unsubAi)unsubAi();
      if(!window.ServerAPI?.isReady?.()) await window.ServerAPI.initFirebase();
      const db=window.ServerAPI.db(); if(!db)return;
      unsubSub=db.collection("user_subscriptions").doc(uid).onSnapshot(s=>{currentSub=s.exists?s.data():null;render();},e=>{window.Diagnostics?.error?.({file:FILE,module:"HeaderStatusMini",functionName:"bindSubscription()",place:"user_subscriptions/"+uid,code:e.code||"top-status-subscription-error",message:e.message});render();});
      unsubAi=db.collection("ai_accounts").doc(uid).onSnapshot(s=>{currentAi=s.exists?s.data():null;render();},e=>{window.Diagnostics?.error?.({file:FILE,module:"HeaderStatusMini",functionName:"bindAi()",place:"ai_accounts/"+uid,code:e.code||"top-status-ai-error",message:e.message});render();});
    }catch(e){window.Diagnostics?.error?.({file:FILE,module:"HeaderStatusMini",functionName:"bind()",place:"top status line",code:e.code||"top-status-error",message:e.message});}
  }

  function init(){
    ensureTopStatus(); render();
    const timer=setInterval(()=>{const u=window.Auth?.getUser?.(); if(u?.uid)bind(u.uid);},1000);
    setTimeout(()=>clearInterval(timer),30000);
  }

  window.HeaderStatusMini={init,bind,render};
  window.addEventListener("DOMContentLoaded",()=>setTimeout(init,500));
})();
