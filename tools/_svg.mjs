import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const svg = readFileSync(process.argv[2], 'utf8').replace(/width="[^"]*mm"/, 'width="1600"').replace(/height="[^"]*mm"/, 'height="900"');
await p.setContent(`<body style="margin:0;background:#fff">${svg}</body>`);
await p.screenshot({ path: process.argv[3] });
await b.close();
