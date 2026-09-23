// Сквозной прогон интерфейса в Chromium: автотрассировка примера, новый проект, установка компонентов,
// назначение цепей, автотрассировка, экспорт. Запуск: npm run build && npm run preview & && npm run e2e.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.env.E2E_OUT ?? 'e2e-out';
mkdirSync(out, { recursive: true });
const url = process.env.E2E_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('dialog', (d) => d.accept());
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const status = () => page.textContent('.statusbar .msg');
const chips = () => page.$$eval('.stage .chip', (els) => els.map((e) => e.textContent.trim()));

// 1. Автотрассировка примера с нуля через воркер
await page.click('.menu > button:has-text("Трассировка")');
await page.click('.menu .drop button:has-text("Автотрассировка")');
await page.selectOption('.modal select.sel >> nth=1', 'redo');
await page.click('.modal button:has-text("Развести")');
await page.waitForSelector('.modal', { state: 'detached', timeout: 120000 });
console.log('autoroute:', await status());
console.log('chips:', await chips());
await page.screenshot({ path: `${out}/10-autorouted.png` });

// 2. Отмена
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
console.log('undo chips:', await chips());

// 3. Новый проект 2 слоя, поставить DIP-8 и резистор, назначить цепь, провести дорожку
await page.click('.menu > button:has-text("Файл")');
await page.click('.menu .drop button:has-text("Новый проект")');
await page.click('.card:has-text("Пустая 50×50")');
await page.click('.modal button:has-text("Создать")');
await page.waitForTimeout(300);
await page.click('button[role=tab]:has-text("Библиотека")');
await page.fill('input[placeholder^="Поиск: 0805"]', 'dip-8');
await page.waitForTimeout(200);
await page.click('.list .item:first-child');
await page.click('button:has-text("Поставить на плату")');
const canvas = await page.$('.stage canvas');
const box = await canvas.boundingBox();
await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
await page.keyboard.press('Escape');
await page.fill('input[placeholder^="Поиск: 0805"]', 'R_0805');
await page.waitForTimeout(200);
await page.click('.list .item:first-child');
await page.click('button:has-text("Поставить на плату")');
await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
console.log('placed:', await status());
const summary1 = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('plata2:autosave') || '{}');
  const p = s.project;
  return { comps: Object.values(p.components).map((c) => c.ref + ':' + c.footprint) };
});
console.log(JSON.stringify(summary1));
await page.screenshot({ path: `${out}/11-placed.png` });

// 4. Открыть свойства U1 через двойной щелчок и назначить цепь выводу 1 и R1.1
await page.click('button[role=tab]:has-text("Свойства")');
await page.keyboard.press('s');
await page.mouse.dblclick(box.x + box.width * 0.4, box.y + box.height * 0.5);
await page.waitForSelector('.modal');
const netInputs = await page.$$('.modal table input');
await netInputs[0].fill('SIG');
await netInputs[0].press('Enter');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/12-component.png` });
await page.keyboard.press('Escape');
await page.mouse.dblclick(box.x + box.width * 0.6, box.y + box.height * 0.3);
await page.waitForSelector('.modal');
const netInputs2 = await page.$$('.modal table input');
await netInputs2[0].fill('SIG');
await netInputs2[0].press('Enter');
await page.waitForTimeout(150);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
console.log('after nets chips:', await chips());

// 5. Автотрассировка маленькой платы (2 слоя)
await page.click('.menu > button:has-text("Трассировка")');
await page.click('.menu .drop button:has-text("Автотрассировка")');
await page.click('.modal button:has-text("Развести")');
await page.waitForSelector('.modal', { state: 'detached', timeout: 60000 });
console.log('small autoroute:', await status());
console.log('chips:', await chips());
await page.screenshot({ path: `${out}/13-small-routed.png` });

// 6. Проверка панели DRC и экспорт Gerber (скачивание)
await page.click('button[role=tab]:has-text("Проверка")');
await page.waitForTimeout(200);
console.log('drc panel:', (await page.textContent('.panel .body')).slice(0, 200));
const [download] = await Promise.all([
  page.waitForEvent('download'),
  (async () => {
    await page.click('.menu > button:has-text("Файл")');
    await page.click('.menu .drop button:has-text("Экспорт")');
    await page.click('.modal button:has-text("Скачать архив Gerber")');
  })(),
]);
console.log('download:', download.suggestedFilename());
await page.keyboard.press('Escape');
await page.screenshot({ path: `${out}/14-after.png` });
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
if (errors.length) process.exit(1);
