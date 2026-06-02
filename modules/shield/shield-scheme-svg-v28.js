/* ============================================================
   Electric Pro — Shield Scheme SVG V28.4
   Движок отрисовки однолинейной схемы (адаптирован из scheme.html).
   Рисует дерево узлов {id,type,label,rating,isCrossModule,children}
   с УГО-символами. Используется конфигуратором: дерево строится из щита.
   API: window.ShieldSchemeSVG.render(svgEl, tree)
   Типы: switch, mcb, rcd, rcbo, relay, meter, spd, contactor
   ============================================================ */
(() => {
  "use strict";
  if (window.__EP_SHIELD_SCHEME_SVG__) return;
  window.__EP_SHIELD_SCHEME_SVG__ = true;

  const NS = "http://www.w3.org/2000/svg";
  const SPACING_X = 140, SPACING_Y = 220, START_Y = 100, TEXT_OFFSET_X = 30;

  const DEFS = `
    <symbol id="epsym-mcb" viewBox="0 0 40 100"><line x1="20" y1="0" x2="20" y2="30" class="ep-sd"/><line x1="20" y1="30" x2="10" y2="50" class="ep-sd"/><circle cx="20" cy="55" r="2" fill="black"/><line x1="20" y1="55" x2="20" y2="100" class="ep-sd"/><rect x="15" y="65" width="10" height="15" class="ep-sd" stroke-width="1.5"/><line x1="15" y1="65" x2="25" y2="80" class="ep-sd" stroke-width="1.5"/></symbol>
    <symbol id="epsym-rcd" viewBox="0 0 40 100"><line x1="20" y1="0" x2="20" y2="30" class="ep-sd"/><line x1="20" y1="30" x2="10" y2="50" class="ep-sd"/><circle cx="20" cy="55" r="2" fill="black"/><line x1="20" y1="55" x2="20" y2="100" class="ep-sd"/><ellipse cx="20" cy="75" rx="10" ry="15" class="ep-sd" stroke-width="1.5"/></symbol>
    <symbol id="epsym-rcbo" viewBox="0 0 40 100"><line x1="20" y1="0" x2="20" y2="30" class="ep-sd"/><line x1="20" y1="30" x2="10" y2="50" class="ep-sd"/><circle cx="20" cy="55" r="2" fill="black"/><line x1="20" y1="55" x2="20" y2="100" class="ep-sd"/><rect x="15" y="62" width="10" height="10" class="ep-sd" stroke-width="1.5"/><line x1="15" y1="62" x2="25" y2="72" class="ep-sd" stroke-width="1.5"/><ellipse cx="20" cy="85" rx="8" ry="12" class="ep-sd" stroke-width="1.5"/></symbol>
    <symbol id="epsym-switch" viewBox="0 0 40 100"><line x1="20" y1="0" x2="20" y2="30" class="ep-sd"/><line x1="20" y1="30" x2="10" y2="50" class="ep-sd"/><circle cx="20" cy="55" r="2" fill="black"/><line x1="20" y1="55" x2="20" y2="100" class="ep-sd"/><line x1="3" y1="50" x2="17" y2="50" class="ep-sd"/></symbol>
    <symbol id="epsym-relay" viewBox="0 0 40 100"><line x1="20" y1="0" x2="20" y2="25" class="ep-sd"/><rect x="5" y="25" width="30" height="50" class="ep-sd" stroke-width="1.5"/><text x="20" y="55" font-size="14" text-anchor="middle" font-weight="bold">U</text><line x1="20" y1="75" x2="20" y2="100" class="ep-sd"/></symbol>
    <symbol id="epsym-meter" viewBox="0 0 40 100"><line x1="20" y1="0" x2="20" y2="20" class="ep-sd"/><rect x="5" y="20" width="30" height="60" class="ep-sd" stroke-width="1.5"/><text x="20" y="55" font-size="10" text-anchor="middle" font-weight="bold">kWh</text><line x1="20" y1="80" x2="20" y2="100" class="ep-sd"/></symbol>
    <symbol id="epsym-spd" viewBox="0 0 40 100"><line x1="20" y1="0" x2="20" y2="30" class="ep-sd"/><rect x="10" y="30" width="20" height="40" class="ep-sd" stroke-width="1.5"/><line x1="10" y1="70" x2="30" y2="30" class="ep-sd"/><line x1="20" y1="70" x2="20" y2="100" class="ep-sd"/></symbol>
    <symbol id="epsym-contactor" viewBox="0 0 40 100"><line x1="20" y1="0" x2="20" y2="30" class="ep-sd"/><line x1="20" y1="30" x2="10" y2="50" class="ep-sd"/><circle cx="20" cy="55" r="2" fill="black"/><line x1="20" y1="55" x2="20" y2="100" class="ep-sd"/><rect x="15" y="70" width="10" height="15" class="ep-sd" stroke-width="1.5"/><line x1="15" y1="70" x2="25" y2="85" class="ep-sd"/></symbol>`;

  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function render(svgEl, tree) {
    if (!svgEl || !tree) return;
    svgEl.innerHTML = `<defs>${DEFS}</defs><g class="ep-scheme-root"></g>`;
    const root = svgEl.querySelector(".ep-scheme-root");
    let leafCount = 0, maxY = 0;

    const line = (x1, y1, x2, y2, color = "black", w = 2, dash = "") => {
      const a = { x1, y1, x2, y2, stroke: color, "stroke-width": w };
      if (dash) a["stroke-dasharray"] = dash;
      root.appendChild(el("line", a));
    };
    const term = (x, y) => root.appendChild(el("circle", { cx: x, cy: y, r: 3.5, fill: "black" }));

    function calc(node, depth = 0) {
      node.y = START_Y + depth * SPACING_Y;
      if (node.y > maxY) maxY = node.y;
      if (!node.children || !node.children.length) { node.x = leafCount * SPACING_X; leafCount++; }
      else {
        node.children.forEach(c => calc(c, depth + 1));
        node.x = (node.children[0].x + node.children[node.children.length - 1].x) / 2;
      }
    }
    function shift(node, off) { node.x += off; if (node.children) node.children.forEach(c => shift(c, off)); }

    function device(node) {
      const g = el("g", { transform: `translate(${node.x}, ${node.y})`, class: "ep-dev", "data-id": node.id });
      const use = el("use", { href: `#epsym-${node.type}`, x: -20, y: 0, width: 40, height: 100 });
      use.setAttributeNS("http://www.w3.org/1999/xlink", "href", `#epsym-${node.type}`);
      g.appendChild(use);
      const tId = el("text", { x: TEXT_OFFSET_X, y: 20, class: "ep-id" }); tId.textContent = node.id; g.appendChild(tId);
      const hasCh = node.children && node.children.length > 0;
      if (hasCh || node.isCrossModule) {
        const tL = el("text", { x: TEXT_OFFSET_X, y: 45, class: "ep-lbl" }); tL.textContent = node.label; g.appendChild(tL);
        const tR = el("text", { x: TEXT_OFFSET_X, y: 65, class: "ep-rt" }); tR.textContent = node.rating; g.appendChild(tR);
      } else {
        const lg = el("g", { transform: "translate(0,115)" });
        lg.appendChild(el("rect", { x: TEXT_OFFSET_X - 5, y: -10, width: 150, height: 35, class: "ep-bd" }));
        const tL = el("text", { x: TEXT_OFFSET_X, y: 5, class: "ep-lbl" }); tL.textContent = node.label; lg.appendChild(tL);
        const tR = el("text", { x: TEXT_OFFSET_X, y: 23, class: "ep-rt" }); tR.textContent = node.rating; lg.appendChild(tR);
        g.appendChild(lg);
      }
      root.appendChild(g);
    }

    function draw(node, isRoot) {
      device(node);
      if (isRoot) {
        const totalW = Math.max(1, leafCount - 1) * SPACING_X;
        const x0 = node.x - 50, x1 = node.x + totalW + 50;
        line(x0, 30, x1, 30, "#16a34a", 3, "6 4");
        line(node.x, 30, node.x, node.y, "#16a34a", 2);
        line(x0, 50, x1, 50, "#2563eb", 3);
        line(node.x - 10, 50, node.x - 10, node.y, "#2563eb", 2);
      }
      if (node.children && node.children.length > 0) {
        let busY = node.y + 115, lineStartY = node.y + 100;
        if (node.isCrossModule) {
          const cx = node.x - 20, cy = node.y + 110;
          root.appendChild(el("rect", { x: cx, y: cy, width: 40, height: 45, fill: "#f8f9fa", stroke: "#adb5bd", rx: 4 }));
          line(cx + 8, cy + 8, cx + 8, cy + 37, "#dc2626", 2);
          line(cx + 16, cy + 8, cx + 16, cy + 37, "#dc2626", 2);
          line(cx + 24, cy + 8, cx + 24, cy + 37, "#dc2626", 2);
          line(cx + 32, cy + 8, cx + 32, cy + 37, "#2563eb", 2);
          busY = cy + 65; lineStartY = cy + 45;
          line(node.x, node.y + 100, node.x, cy);
        }
        line(node.x, lineStartY, node.x, busY);
        if (node.children.length > 1) {
          line(node.children[0].x, busY, node.children[node.children.length - 1].x, busY, "black", 3);
        }
        node.children.forEach(c => { line(c.x, busY, c.x, c.y); draw(c, false); });
      } else {
        const tailY = node.y + 140;
        line(node.x, node.y + 100, node.x, tailY);
        term(node.x, tailY);
      }
    }

    calc(tree);
    shift(tree, 120);
    svgEl.setAttribute("width", Math.max(500, leafCount * SPACING_X + 160));
    svgEl.setAttribute("height", maxY + 300);
    draw(tree, true);
  }

  window.ShieldSchemeSVG = { render };
})();
