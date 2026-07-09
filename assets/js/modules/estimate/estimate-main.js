/* ============================================================
   Electric Pro V29 — Estimate (ОСНОВНАЯ смета)
   Кнопка «Добавить в основную» переносит сюда позиции из предварительной
   (EstimateDraft). Из основной растут: «Поставщику», «Смета работ»,
   документы, склад, затраты, расходники.
   Хранилище: localStorage ep_estimate_main_v29.
   ============================================================ */
(() => {
  "use strict";
  window.EP = window.EP || {};
  const KEY = "ep_estimate_main_v29";
  let _seq = 0;

  function read() {
    try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function write(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
    window.dispatchEvent(new CustomEvent("ep:estimate-main-changed", { detail: { count: items.length } }));
  }
  function num(v) { const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; }
  function lineId() { _seq += 1; return "em_" + Date.now().toString(36) + "_" + _seq.toString(36); }
  function norm(it, source) {
    return {
      id: lineId(),
      sourceId: it.sourceId != null ? String(it.sourceId) : "",
      type: it.type === "work" ? "work" : "material",
      name: String(it.name || "").trim(),
      unit: String(it.unit || "шт"),
      price: num(it.price),
      qty: num(it.qty != null ? it.qty : 1) || 1,
      base: it.base || "",
      source: source || it.source || "main"
    };
  }

  function getItems() { return read(); }
  function removeItem(id) { write(read().filter((x) => x.id !== id)); }
  function setQty(id, qty) { const items = read(); const it = items.find((x) => x.id === id); if (it) { it.qty = num(qty); write(items); } return it || null; }
  function clear() { write([]); }
  function count() { return read().length; }
  function total() { return read().reduce((s, x) => s + num(x.price) * num(x.qty), 0); }
  function addItem(item) { const items = read(); const line = norm(item || {}, (item && item.source) || "main"); items.push(line); write(items); return line; }

  // Объединить набор позиций в основную, агрегируя одинаковые (тип+имя+единица): количество складывается.
  function mergeItems(list) {
    const items = read();
    const keyOf = (x) => (x.type === "work" ? "w" : "m") + "|" + String(x.name || "").trim().toLowerCase() + "|" + String(x.unit || "").toLowerCase();
    const index = new Map();
    items.forEach((x) => index.set(keyOf(x), x));
    let added = 0;
    (Array.isArray(list) ? list : []).forEach((raw) => {
      const it = norm(raw, "main");
      if (!it.name) return;
      const k = keyOf(it);
      const ex = index.get(k);
      if (ex) { ex.qty = num(ex.qty) + num(it.qty); if (!num(ex.price) && num(it.price)) ex.price = num(it.price); }
      else { items.push(it); index.set(k, it); }
      added++;
    });
    write(items);
    return added;
  }

  // Паритет с черновиком (для модулей, что пишут через источник, напр. расходники).
  function setSourceItems(source, list) {
    source = String(source || "");
    const kept = read().filter((x) => x.source !== source);
    const add = (Array.isArray(list) ? list : []).map((it) => norm(it, source)).filter((x) => x.name);
    write(kept.concat(add));
    return add.length;
  }
  function removeSource(source) { write(read().filter((x) => x.source !== String(source || ""))); }
  function itemsBySource(source) { return read().filter((x) => x.source === String(source || "")); }

  window.EP.Estimate = { addItem, getItems, removeItem, setQty, clear, count, total, mergeItems, setSourceItems, removeSource, itemsBySource };
})();
