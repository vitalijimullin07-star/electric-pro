// node print-pdf.cjs in.html out.pdf [landscape] — печать HTML в PDF (A4) Chromium из playwright.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [inp, out, land] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + path.resolve(inp), { waitUntil: 'load' });
  await p.pdf({ path: out, format: 'A4', landscape: land === 'landscape', printBackground: true, preferCSSPageSize: true });
  await b.close();
})();
