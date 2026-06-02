(function(){
  "use strict";
  if(window.EPDBMoneyV287) return;

  const VERSION = "V28.7";
  const FILE = "assets/js/db-money-v28-7.js";
  const SETTINGS_KEY = "epdb28_money_settings";
  const DEFAULT = {
    currency: "BYN",
    currencySymbol: "BYN",
    moneyDecimals: 2,
    unitPriceMaxDecimals: 6
  };
  const CURRENCIES = {
    BYN: { label: "BYN", symbol: "BYN", title: "Белорусский рубль" },
    RUB: { label: "RUB", symbol: "₽", title: "Российский рубль" },
    USD: { label: "USD", symbol: "$", title: "Доллар США" },
    EUR: { label: "EUR", symbol: "€", title: "Евро" }
  };

  function readJson(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(e){ return fallback; }
  }
  function writeJson(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch(e){ return false; }
  }
  function emit(name, detail){
    try{ window.dispatchEvent(new CustomEvent(name, { detail })); }catch(e){}
  }
  function baseName(base){ return base === "server" ? "server" : "my"; }
  function normalizeCurrency(value){
    const cur = String(value || DEFAULT.currency).trim().toUpperCase();
    return CURRENCIES[cur] ? cur : DEFAULT.currency;
  }
  function currencySymbol(currency){
    const cur = normalizeCurrency(currency);
    return CURRENCIES[cur]?.symbol || cur;
  }
  function normalizeDecimals(value, fallback){
    const n = Number(value);
    if(!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(8, Math.trunc(n)));
  }
  function readAll(){
    const data = readJson(SETTINGS_KEY, null);
    if(data && typeof data === "object") return data;
    return { version: VERSION, updatedAt: "", byBase: {} };
  }
  function writeAll(data){
    const out = data && typeof data === "object" ? data : {};
    out.version = VERSION;
    out.updatedAt = new Date().toISOString();
    if(!out.byBase || typeof out.byBase !== "object") out.byBase = {};
    return writeJson(SETTINGS_KEY, out);
  }
  function normalizeSettings(raw){
    const cur = normalizeCurrency(raw?.currency || raw?.currencyCode || raw?.currencySymbol);
    return {
      currency: cur,
      currencySymbol: raw?.currencySymbol || currencySymbol(cur),
      moneyDecimals: normalizeDecimals(raw?.moneyDecimals, DEFAULT.moneyDecimals),
      unitPriceMaxDecimals: normalizeDecimals(raw?.unitPriceMaxDecimals, DEFAULT.unitPriceMaxDecimals)
    };
  }
  function getSettings(base){
    const all = readAll();
    const b = baseName(base);
    const raw = all.byBase?.[b] || all[b] || all.settings || all || {};
    const settings = normalizeSettings({ ...DEFAULT, ...raw });
    settings.base = b;
    return settings;
  }
  function setCurrency(base, currency){
    const all = readAll();
    const b = baseName(base);
    if(!all.byBase || typeof all.byBase !== "object") all.byBase = {};
    const cur = normalizeCurrency(currency);
    const prev = getSettings(b);
    const next = normalizeSettings({ ...prev, currency: cur, currencySymbol: currencySymbol(cur) });
    all.byBase[b] = next;
    writeAll(all);
    emit("epdb28:currency-changed", { base: b, settings: next, version: VERSION });
    return next;
  }
  function setSettings(base, settings){
    const all = readAll();
    const b = baseName(base);
    if(!all.byBase || typeof all.byBase !== "object") all.byBase = {};
    const next = normalizeSettings({ ...getSettings(b), ...(settings || {}) });
    all.byBase[b] = next;
    writeAll(all);
    emit("epdb28:currency-changed", { base: b, settings: next, version: VERSION });
    return next;
  }
  function extractSettings(payload){
    if(!payload || typeof payload !== "object") return null;
    const raw = payload.settings || payload.dbSettings || payload.moneySettings || null;
    if(!raw || typeof raw !== "object") return null;
    return normalizeSettings(raw);
  }
  function applyImportedSettings(base, payloadOrSettings){
    const settings = payloadOrSettings?.currency ? payloadOrSettings : extractSettings(payloadOrSettings);
    if(!settings) return getSettings(base);
    return setSettings(base, settings);
  }

  function parseMoneyInput(value){
    if(typeof value === "number") return Number.isFinite(value) ? value : 0;
    if(value == null) return 0;
    let s = String(value).trim();
    if(!s) return 0;
    s = s.replace(/\u00a0/g, " ").replace(/\s+/g, "");
    s = s.replace(/[₽$€]|BYN|RUB|USD|EUR|руб\.?|коп\.?/gi, "");
    const comma = s.lastIndexOf(",");
    const dot = s.lastIndexOf(".");
    if(comma >= 0 && dot >= 0){
      if(comma > dot){
        s = s.replace(/\./g, "").replace(",", ".");
      }else{
        s = s.replace(/,/g, "");
      }
    }else if(comma >= 0){
      s = s.replace(",", ".");
    }
    s = s.replace(/[^0-9.+-]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function round(value, decimals = 2){
    const n = Number(value);
    if(!Number.isFinite(n)) return 0;
    const p = Math.pow(10, decimals);
    return Math.round((n + Number.EPSILON) * p) / p;
  }
  function normalizeUnitPrice(value){
    const n = parseMoneyInput(value);
    return Number.isFinite(n) ? n : 0;
  }
  function calcLineTotal(price, qty){
    return round(parseMoneyInput(price) * (Number(qty) || 0), DEFAULT.moneyDecimals);
  }
  function fixedTrim(value, decimals){
    const n = parseMoneyInput(value);
    if(!Number.isFinite(n)) return "0";
    if(Math.abs(n) >= 1e21) return String(n);
    return n.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }
  function formatUnitPrice(value, base){
    const s = getSettings(base);
    return fixedTrim(value, s.unitPriceMaxDecimals);
  }
  function formatMoneyTotal(value, base){
    const s = getSettings(base);
    const num = round(value, s.moneyDecimals);
    return num.toLocaleString("ru-RU", {
      minimumFractionDigits: s.moneyDecimals,
      maximumFractionDigits: s.moneyDecimals
    }) + " " + (s.currencySymbol || s.currency);
  }
  function currencyLabel(base){
    const s = getSettings(base);
    return s.currencySymbol || s.currency;
  }
  function decorateExportPayload(payload, base){
    const out = payload && typeof payload === "object" ? payload : {};
    out.settings = getSettings(base);
    out.moneySettings = out.settings;
    out.schema = out.schema || "electric-pro-db-v28-money";
    return out;
  }
  function convertKmPriceToMeter(pricePerKm){
    return normalizeUnitPrice(pricePerKm) / 1000;
  }

  window.EPDBMoneyV287 = {
    version: VERSION,
    file: FILE,
    settingsKey: SETTINGS_KEY,
    currencies: CURRENCIES,
    defaults: DEFAULT,
    getSettings,
    setSettings,
    setCurrency,
    extractSettings,
    applyImportedSettings,
    parseMoneyInput,
    normalizeUnitPrice,
    calcLineTotal,
    formatUnitPrice,
    formatMoneyTotal,
    currencyLabel,
    decorateExportPayload,
    convertKmPriceToMeter
  };

  try{
    window.Diagnostics?.ok?.({ file: FILE, module: "EPDBMoneyV287", code: "db-money-ready", message: "Денежная математика и валюты БД загружены." });
  }catch(e){}
})();
