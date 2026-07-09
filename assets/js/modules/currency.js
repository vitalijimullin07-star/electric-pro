/* ============================================================
   Electric Pro V29 — Currency (валюта)
   Настраиваемая валюта приложения. По умолчанию RUB (₽).
   ВАЖНО: форматирование — ТОЛЬКО для отображения. Хранимые цены
   не округляются (точная математика сохраняется в Number).
   Совместимо по духу со старым EPCurrency: code/set/list/format/parse.
   ============================================================ */
(() => {
  "use strict";
  window.EP = window.EP || {};

  const KEY = "ep_currency_v29";
  const LIST = [
    { code: "RUB", symbol: "₽",  locale: "ru-RU" },
    { code: "USD", symbol: "$",  locale: "en-US" },
    { code: "EUR", symbol: "€",  locale: "de-DE" },
    { code: "KZT", symbol: "₸",  locale: "ru-KZ" },
    { code: "UAH", symbol: "₴",  locale: "uk-UA" },
    { code: "BYN", symbol: "Br", locale: "ru-BY" }
  ];
  const DEFAULT = "RUB";

  function byCode(code) {
    return LIST.find((c) => c.code === code) || LIST[0];
  }
  function code() {
    try { return localStorage.getItem(KEY) || DEFAULT; } catch (e) { return DEFAULT; }
  }
  function set(newCode) {
    const c = byCode(newCode).code;
    try { localStorage.setItem(KEY, c); } catch (e) {}
    window.dispatchEvent(new CustomEvent("ep:currency-changed", { detail: { code: c } }));
    return c;
  }
  function symbol(forCode) {
    return byCode(forCode || code()).symbol;
  }
  function list() { return LIST.map((c) => ({ ...c })); }

  function toNumber(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    if (v == null) return 0;
    const s = String(v).replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  // парсинг строки в число (для ввода цены) — НЕ округляет
  function parse(v) { return toNumber(v); }

  // отображение: группировка по локали + символ. Хранимое значение не меняется.
  function format(value, forCode) {
    const c = byCode(forCode || code());
    const n = toNumber(value);
    let num;
    try { num = new Intl.NumberFormat(c.locale, { maximumFractionDigits: 2 }).format(n); }
    catch (e) { num = String(n); }
    return num + " " + c.symbol;
  }

  window.EP.Currency = { code, set, symbol, list, format, parse, DEFAULT };
})();
