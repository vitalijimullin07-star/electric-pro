/* Electric Pro V29 — реестр иконок «под ключ».
   1) EP.Icon("имя") + элементы [data-icon] красятся набором.
   2) Глобальная подмена: при наборе НЕ «Эмодзи» все известные UI-эмодзи в тексте
      заменяются значками набора (контент комнат и статусы 🟢🔴🟡 не трогаем).
   В дефолте («Эмодзи») ничего не делаем — ноль риска/нагрузки. */
(() => {
  "use strict";
  const KEY = "ep_icon_pack_v29";
  const PACKS = {
    emoji: {
      shield: "🛡️", pool: "🔌", materials: "🗂️", work: "🧰", estimate: "📋", details: "📦",
      tools: "🧰", stock: "📦", costs: "💰", clients: "👤", database: "🗄️", documents: "📄",
      settings: "⚙️", home: "🏠", add: "➕", del: "✕", edit: "✏️", back: "←", search: "🔍",
      save: "💾", calc: "🧮", money: "💰", warn: "⚠️", ok: "✓", import: "⬇️", export: "⬆️", backup: "📦", reset: "↺"
    },
    line: {
      shield: "◈", pool: "⌁", materials: "▤", work: "✦", estimate: "☰", details: "▦",
      tools: "✦", stock: "▦", costs: "₽", clients: "◌", database: "▤", documents: "▢",
      settings: "✲", home: "⌂", add: "+", del: "×", edit: "✎", back: "←", search: "⌕",
      save: "▣", calc: "▦", money: "₽", warn: "△", ok: "✓", import: "↓", export: "↑", backup: "▦", reset: "↺"
    },
    mono: {
      shield: "▣", pool: "~", materials: "#", work: "#", estimate: "=", details: "#",
      tools: "#", stock: "#", costs: "$", clients: "@", database: "#", documents: "=",
      settings: "*", home: "^", add: "+", del: "x", edit: "/", back: "<", search: "?",
      save: "=", calc: "%", money: "$", warn: "!", ok: "v", import: "v", export: "^", backup: "#", reset: "~"
    }
  };
  // карта подмены UI-эмодзи → значок набора (контент комнат/статусы НЕ включаем)
  const SWAP = {
    "🛡": { line: "◈", mono: "▣" }, "🔌": { line: "⌁", mono: "~" }, "🗂": { line: "▤", mono: "#" },
    "🧰": { line: "✦", mono: "#" }, "📋": { line: "☰", mono: "=" }, "📦": { line: "▦", mono: "#" },
    "➕": { line: "+", mono: "+" }, "✚": { line: "+", mono: "+" }, "✕": { line: "×", mono: "x" },
    "✓": { line: "✓", mono: "v" }, "⚙": { line: "✲", mono: "*" }, "📄": { line: "▢", mono: "=" },
    "⚠": { line: "△", mono: "!" }, "📁": { line: "▸", mono: ">" }, "📂": { line: "▸", mono: ">" },
    "💾": { line: "▣", mono: "=" }, "⬆": { line: "↑", mono: "^" }, "⬇": { line: "↓", mono: "v" },
    "👤": { line: "◌", mono: "@" }, "👥": { line: "◌", mono: "@" }, "🗄": { line: "▤", mono: "#" },
    "💰": { line: "₽", mono: "$" }, "🗑": { line: "×", mono: "x" }, "💡": { line: "○", mono: "*" },
    "🧮": { line: "▦", mono: "%" }, "🏠": { line: "⌂", mono: "^" }, "🔍": { line: "⌕", mono: "?" },
    "🔎": { line: "⌕", mono: "?" }, "✏": { line: "✎", mono: "/" }, "✍": { line: "✎", mono: "/" },
    "📝": { line: "✎", mono: "/" }, "↻": { line: "↻", mono: "~" }, "🔁": { line: "↻", mono: "~" },
    "🔀": { line: "⇄", mono: "~" }, "📊": { line: "▦", mono: "#" }, "🧾": { line: "▤", mono: "=" },
    "📐": { line: "∟", mono: "L" }, "🏬": { line: "▦", mono: "#" }, "🛠": { line: "✦", mono: "#" },
    "🔧": { line: "✦", mono: "#" }, "🎨": { line: "◈", mono: "*" }, "💳": { line: "▭", mono: "=" },
    "👑": { line: "♔", mono: "*" }, "📥": { line: "↓", mono: "v" }, "🤖": { line: "◉", mono: "@" },
    "🌐": { line: "⊕", mono: "o" }, "📺": { line: "▭", mono: "#" }, "⚡": { line: "⌁", mono: "!" },
    "📜": { line: "▤", mono: "=" }, "🖨": { line: "▭", mono: "#" }, "⭐": { line: "★", mono: "*" }
  };

  function curPack() { try { const p = localStorage.getItem(KEY); return PACKS[p] ? p : "emoji"; } catch (e) { return "emoji"; } }
  function get(name) { const p = PACKS[curPack()] || PACKS.emoji; return p[name] || PACKS.emoji[name] || ""; }
  function paint(root) {
    try { (root || document).querySelectorAll("[data-icon]").forEach((el) => { const g = get(el.getAttribute("data-icon")); if (g) el.textContent = g; }); } catch (e) {}
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function walkText(node, fn) {
    let n = node && node.firstChild;
    while (n) {
      const next = n.nextSibling;
      if (n.nodeType === 3) { try { fn(n); } catch (e) {} }
      else if (n.nodeType === 1) {
        const tag = n.nodeName;
        if (tag !== "SCRIPT" && tag !== "STYLE" && tag !== "TEXTAREA" && tag !== "INPUT" && !n.isContentEditable) walkText(n, fn);
      }
      n = next;
    }
  }
  function swapAll(root) {
    const active = curPack();
    if (active === "emoji") return;
    const map = {}; let any = false;
    Object.keys(SWAP).forEach((e) => { const g = SWAP[e][active]; if (g) { map[e] = g; any = true; } });
    if (!any) return;
    const rx = new RegExp("(" + Object.keys(map).map(escapeRe).join("|") + ")\\uFE0F?", "g");
    walkText(root || document.body, (tn) => {
      const v = tn.nodeValue; if (!v) return;
      rx.lastIndex = 0;
      if (rx.test(v)) { rx.lastIndex = 0; tn.nodeValue = v.replace(rx, (m, e) => map[e] || m); }
    });
  }

  let appliedPack = null;
  function applyEverywhere() { paint(document); swapAll(document); }
  function use(pack) {
    pack = PACKS[pack] ? pack : "emoji";
    try { localStorage.setItem(KEY, pack); } catch (e) {}
    const changed = appliedPack !== null && appliedPack !== pack;
    appliedPack = pack;
    if (changed) {
      // перерисовать текущий экран исходными эмодзи → затем подмена (мгновенно + чистый откат)
      try {
        if (window.EP && EP.Router && EP.Router.go && EP.state) { EP.Router.go(EP.state.currentRoute || "main", { replace: true }); return; }
      } catch (e) {}
    }
    applyEverywhere();
  }
  function setPack(pack) { use(pack); }

  window.EP = window.EP || {};
  const Icon = function (name) { return get(name); };
  Icon.get = get; Icon.paint = paint; Icon.use = use; Icon.setPack = setPack; Icon.pack = curPack; Icon.swapAll = swapAll; Icon.PACKS = PACKS;
  EP.Icon = Icon;

  window.addEventListener("ep:route-loaded", () => { paint(document); swapAll(document); });
  if (document.readyState !== "loading") applyEverywhere();
  else document.addEventListener("DOMContentLoaded", applyEverywhere);
})();
