/* ============================================================
   Electric Pro — Currency V28
   Глобальная валюта: выбор хранится в localStorage и привязан ко всему.
   Цена с копейками: 10.43 = 10 руб 43 коп; умножается как 10.43 × кол-во.
   API: window.EPCurrency
     .code() / .symbol()        — текущая валюта
     .set(code)                 — сменить (сохраняет + событие 'ep-currency-changed')
     .list()                    — список валют
     .parse(str)               -> число (10.43), копейки сохраняются
     .format(value, withSymbol) -> "10.43 ₽" (2 знака, копейки)
     .amount(value)            -> "10.43" (без символа)
   ============================================================ */
(() => {
  "use strict";
  if (window.EPCurrency) return;

  const KEY = "ep_currency_v28";
  const LIST = [
    { code: "RUB", symbol: "₽", name: "Рубль" },
    { code: "KZT", symbol: "₸", name: "Тенге" },
    { code: "BYN", symbol: "Br", name: "Бел. рубль" },
    { code: "UAH", symbol: "₴", name: "Гривна" },
    { code: "USD", symbol: "$", name: "Доллар" },
    { code: "EUR", symbol: "€", name: "Евро" }
  ];

  function read() {
    try { const c = localStorage.getItem(KEY); if (c) return c; } catch (e) {}
    return "RUB";
  }
  let current = read();

  const def = () => LIST.find(x => x.code === current) || LIST[0];
  const code = () => def().code;
  const symbol = () => def().symbol;
  const list = () => LIST.slice();

  function set(c) {
    if (!LIST.some(x => x.code === c)) return;
    current = c;
    try { localStorage.setItem(KEY, c); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent("ep-currency-changed", { detail: { code: c, symbol: symbol() } })); } catch (e) {}
  }

  // строка -> число с копейками (принимает "10,43" и "10.43", убирает символы)
  function parse(str) {
    if (typeof str === "number") return isFinite(str) ? str : 0;
    let s = String(str == null ? "" : str).replace(/\s/g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }

  // число -> "10.43" (2 знака, разделение тысяч пробелом, копейки через точку)
  function amount(value) {
    const n = Number(value);
    const v = isFinite(n) ? n : 0;
    const neg = v < 0 ? "-" : "";
    const abs = Math.abs(v);
    const int = Math.floor(abs);
    const kop = Math.round((abs - int) * 100);
    // если из-за округления копейки = 100
    const intFixed = kop === 100 ? int + 1 : int;
    const kopFixed = kop === 100 ? 0 : kop;
    const intStr = intFixed.toLocaleString("ru-RU").replace(/\u00A0/g, " ");
    return neg + intStr + "." + String(kopFixed).padStart(2, "0");
  }

  function format(value, withSymbol) {
    const a = amount(value);
    return withSymbol === false ? a : (a + " " + symbol());
  }

  window.EPCurrency = { code, symbol, list, set, parse, amount, format };

  // компактный стиль селектора валюты в панели БД
  try {
    if (!document.getElementById("ep-currency-style")) {
      const st = document.createElement("style");
      st.id = "ep-currency-style";
      st.textContent = '.db26cur{height:34px;border:1px solid rgba(15,23,42,.18);border-radius:8px;padding:0 8px;background:#fff;color:#0f172a;font:800 12px/1 system-ui;cursor:pointer;}';
      (document.head || document.documentElement).appendChild(st);
    }
  } catch (e) {}
})();
