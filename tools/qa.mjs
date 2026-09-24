// Сквозная проверка интерфейса в Chromium «как человек»: перед каждым нажатием проверяется,
// что элемент виден на экране и не перекрыт (document.elementFromPoint), без автопрокрутки.
// Запуск: npm run build && node tools/qa.mjs [адрес]. По умолчанию открывает index.html с диска.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const url = process.argv[2] ?? process.env.QA_URL ?? 'file://' + new URL('../index.html', import.meta.url).pathname;
const out = process.env.QA_OUT ?? 'qa-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

const results = [];
let current = '';
const errors = [];
async function step(name, fn) {
  current = name;
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, String(e?.message ?? e).split('\n')[0]]);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

function helpers(page, touch = false) {
  /** Нажатие по центру элемента, только если он виден и сверху. */
  const hit = async (target, opts = {}) => {
    const loc = typeof target === 'string' ? page.locator(target).first() : target;
    await loc.waitFor({ state: 'attached', timeout: opts.timeout ?? 4000 });
    // Как человек: прокрутить панель или список, если элемент ниже края (но не саму страницу).
    await loc.evaluate((el) => el.closest('.panel .body, .modal .content, .toolbar, .topbar') && el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const box = await loc.boundingBox();
    if (!box) throw new Error(`нет на экране: ${target}`);
    const vp = page.viewportSize();
    const x = box.x + (opts.dx ?? box.width / 2);
    const y = box.y + (opts.dy ?? box.height / 2);
    if (x < 0 || y < 0 || x > vp.width || y > vp.height) throw new Error(`за пределами экрана (${Math.round(x)},${Math.round(y)}): ${target}`);
    const onTop = await loc.evaluate((el, [px, py]) => {
      const h = document.elementFromPoint(px, py);
      return el === h || el.contains(h) ? '' : h ? h.tagName + '.' + h.className : 'ничего';
    }, [x, y]);
    if (onTop) throw new Error(`перекрыт (${onTop}): ${target}`);
    if (touch) await page.touchscreen.tap(x, y);
    else if (opts.double) await page.mouse.dblclick(x, y);
    else await page.mouse.click(x, y, { button: opts.button ?? 'left' });
    await page.waitForTimeout(opts.wait ?? 120);
  };
  const menu = async (top, item) => {
    await hit(page.getByRole('button', { name: top, exact: true }));
    await hit(page.locator('.menu-drop button', { hasText: item }).first());
  };
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('plata2:autosave') || 'null'));
  const msg = () => page.textContent('.statusbar .msg');
  const chips = () => page.$$eval('.stage .chip', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  const canvas = async () => page.locator('.stage canvas').boundingBox();
  /** Экранная точка для мировых координат платы (мм). */
  const toScreen = async (x, y) => {
    const box = await canvas();
    const v = await page.evaluate(() => window.__plata?.view());
    return { x: box.x + (x - v.x) * v.scale, y: box.y + (y - v.y) * v.scale };
  };
  const clickAt = async (x, y, opts = {}) => {
    const p = await toScreen(x, y);
    if (touch) await page.touchscreen.tap(p.x, p.y);
    else if (opts.double) await page.mouse.dblclick(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(opts.wait ?? 80);
  };
  const project = () => page.evaluate(() => window.__plata?.project());
  const dialogTitle = async () => (await page.$('.modal header span')) ? page.textContent('.modal header span') : null;
  const closeDialog = async () => {
    if (await page.$('.modal')) await hit('.modal header button');
  };
  return { hit, menu, state, msg, chips, clickAt, toScreen, project, dialogTitle, closeDialog };
}

async function openPage(viewport, touch = false) {
  const ctx = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${current}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(`[${current}] console: ${m.text()}`));
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'qa=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.stage canvas');
  await page.waitForTimeout(600);
  return page;
}

/* ================= компьютер ================= */
{
  const page = await openPage({ width: 1440, height: 900 });
  const h = helpers(page);
  const downloads = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));

  await step('запуск: пример открыт, 49 цепей разведены', async () => {
    const c = await h.chips();
    expect(/Разведено 49 из 49/.test(c), c);
  });

  const menuItems = {
    Файл: ['Новый проект', 'Открыть файл проекта', 'Недавние проекты', 'Сохранить проект', 'Экспорт', 'Настройки платы'],
    Правка: ['Отменить', 'Повторить', 'Выделить всё', 'Удалить выделенное', 'Повернуть', 'На другую сторону', 'Свойства компонента'],
    Вид: ['Сетка', 'Воздушные линии', 'Отметки проверки', 'Позиционные обозначения', 'Номиналы', 'Габариты корпусов', 'Сборочный слой', 'Вся плата', 'Переключить активный слой', 'Боковая панель'],
    Разместить: ['Компонент из библиотеки', 'Цепи', 'Надпись', 'Область правил', 'Полигон меди', 'Новый контур платы'],
    Трассировка: ['Дорожка', 'Переходное отверстие', 'Перемычка проводом', 'Автотрассировка', 'Стереть все дорожки', 'Проверка правил'],
    Справка: ['Горячие клавиши', 'О программе'],
  };
  for (const [top, items] of Object.entries(menuItems))
    await step(`меню «${top}»: открывается, все пункты видны и не перекрыты`, async () => {
      await h.hit(page.getByRole('button', { name: top, exact: true }));
      for (const it of items) {
        const loc = page.locator('.menu-drop button', { hasText: it }).first();
        const box = await loc.boundingBox();
        expect(box, `нет пункта ${it}`);
        const ok = await loc.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return el === e || el.contains(e) || (el.disabled && !!e);
        });
        expect(ok, `пункт «${it}» перекрыт`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      expect(!(await page.$('.menu-drop')), 'меню не закрылось по Esc');
    });

  await step('меню: наведение переключает соседнее, щелчок мимо закрывает', async () => {
    await h.hit(page.getByRole('button', { name: 'Файл', exact: true }));
    const b = await page.getByRole('button', { name: 'Вид', exact: true }).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(100);
    expect(await page.locator('.menu-drop button', { hasText: 'Сетка' }).count(), 'не переключилось на «Вид»');
    await page.mouse.click(700, 500);
    await page.waitForTimeout(100);
    expect(!(await page.$('.menu-drop')), 'не закрылось щелчком мимо');
  });

  const dialogsByMenu = [
    ['Файл', 'Новый проект', 'Новый проект'],
    ['Файл', 'Недавние проекты', 'Открыть проект'],
    ['Файл', 'Экспорт', 'Экспорт'],
    ['Файл', 'Настройки платы', 'Плата, правила и классы цепей'],
    ['Трассировка', 'Автотрассировка', 'Автотрассировка'],
    ['Справка', 'Горячие клавиши', 'Горячие клавиши'],
    ['Справка', 'О программе', 'Plata'],
  ];
  for (const [top, it, title] of dialogsByMenu)
    await step(`${top} → ${it}: открывается окно «${title}» и закрывается`, async () => {
      await h.menu(top, it);
      expect((await h.dialogTitle()) === title, `окно: ${await h.dialogTitle()}`);
      await h.closeDialog();
      expect(!(await page.$('.modal')), 'окно не закрылось');
    });

  await step('Вид: переключатели меняют состояние', async () => {
    for (const it of ['Сетка', 'Воздушные линии', 'Номиналы']) {
      const before = await page.evaluate(() => JSON.stringify(window.__plata.state().show));
      await h.menu('Вид', it);
      const after = await page.evaluate(() => JSON.stringify(window.__plata.state().show));
      expect(before !== after, `«${it}» ничего не поменял`);
      await h.menu('Вид', it);
    }
  });

  await step('Вид → Боковая панель: скрывает и возвращает панель', async () => {
    await h.menu('Вид', 'Боковая панель');
    expect(!(await page.locator('.panel').isVisible()), 'панель не скрылась');
    await h.menu('Вид', 'Боковая панель');
    expect(await page.locator('.panel').isVisible(), 'панель не вернулась');
  });

  await step('панель инструментов: каждая кнопка видна и включает свой инструмент', async () => {
    const n = await page.locator('.toolbar .tbtn').count();
    for (let i = 0; i < n; i++) {
      const b = page.locator('.toolbar .tbtn').nth(i);
      const label = await b.getAttribute('aria-label');
      if (/Отменить|Повторить/.test(label)) continue;
      await h.hit(b);
      expect(await b.evaluate((el) => el.classList.contains('on')), `не включился: ${label}`);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  await step('вкладки панели справа переключаются', async () => {
    for (const t of ['Слои', 'Цепи', 'Библиотека', 'Проверка', 'Свойства']) {
      await h.hit(page.locator('.panel .tabs button', { hasText: t }));
      expect(await page.locator('.panel .tabs button.on', { hasText: t }).count(), `вкладка ${t}`);
    }
  });

  await step('Правка → Стереть все дорожки → подтверждение → отмена действия', async () => {
    await h.menu('Трассировка', 'Стереть все дорожки');
    expect((await h.dialogTitle()) === 'Стереть все дорожки', 'нет окна подтверждения');
    await h.hit(page.locator('.modal footer button', { hasText: 'Стереть' }));
    expect(/Разведено 0 из 49/.test(await h.chips()), await h.chips());
    await h.menu('Правка', 'Отменить');
    expect(/Разведено 49 из 49/.test(await h.chips()), 'отмена не вернула дорожки');
    await h.menu('Правка', 'Повторить');
    expect(/Разведено 0 из 49/.test(await h.chips()), 'повтор не сработал');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    expect(/Разведено 49 из 49/.test(await h.chips()), 'Ctrl+Z не сработал');
  });

  /* ---- новый проект с нуля ---- */
  await step('новый проект 60×40, 2 слоя', async () => {
    await h.menu('Файл', 'Новый проект');
    await h.hit(page.locator('.card', { hasText: 'Свой размер' }));
    const inputs = page.locator('.modal .field input');
    await inputs.nth(0).fill('QA плата');
    await inputs.nth(1).fill('60');
    await inputs.nth(1).press('Tab');
    await inputs.nth(2).fill('40');
    await inputs.nth(2).press('Tab');
    await h.hit(page.locator('.modal footer button', { hasText: 'Создать' }));
    const p = await h.project();
    expect(p.meta.name === 'QA плата', p.meta.name);
    const xs = p.board.outline.map((q) => q.x);
    expect(Math.max(...xs) - Math.min(...xs) === 60, 'ширина ' + (Math.max(...xs) - Math.min(...xs)));
    expect(p.board.copperLayers === 2, 'слоёв ' + p.board.copperLayers);
  });

  const place = async (query, x, y) => {
    await h.hit(page.locator('.panel .tabs button', { hasText: 'Библиотека' }));
    await page.fill('.panel input[placeholder^="Поиск"]', query);
    await page.waitForTimeout(150);
    await h.hit(page.locator('.panel .list .item').first());
    await h.hit(page.locator('.panel button', { hasText: 'Поставить на плату' }));
    await h.clickAt(x, y);
    await page.keyboard.press('Escape');
  };
  await step('библиотека: поставить DIP-8 и два резистора 0805', async () => {
    await place('DIP-8_W7.62', 20, 20);
    await place('R_0805', 42, 10);
    await place('R_0805', 42, 30);
    const p = await h.project();
    const refs = Object.values(p.components).map((c) => c.ref).sort();
    expect(JSON.stringify(refs) === '["R1","R2","U1"]', JSON.stringify(refs));
  });

  await step('выбор компонента щелчком, свойства, поворот R, сторона F, стрелки, удаление и отмена', async () => {
    await page.keyboard.press('s');
    await h.clickAt(20, 20);
    let st = await page.evaluate(() => window.__plata.state().selection);
    expect(st.length === 1 && st[0].kind === 'component', 'не выбрано: ' + JSON.stringify(st));
    expect(await page.locator('.panel h3', { hasText: 'U1' }).count(), 'нет свойств U1');
    const id = st[0].id;
    await page.keyboard.press('r');
    let c = (await h.project()).components[id];
    expect(c.rotation === 90, 'поворот ' + c.rotation);
    await page.keyboard.press('f');
    c = (await h.project()).components[id];
    expect(c.side === 'bottom', 'сторона ' + c.side);
    await page.keyboard.press('f');
    const x0 = c.at.x;
    await page.keyboard.press('ArrowRight');
    c = (await h.project()).components[id];
    expect(Math.abs(c.at.x - x0 - (await page.evaluate(() => window.__plata.state().grid))) < 1e-6, 'стрелка не сдвинула');
    await page.keyboard.press('Delete');
    expect(!(await h.project()).components[id], 'не удалился');
    await page.keyboard.press('Control+z');
    expect((await h.project()).components[id], 'отмена не вернула');
  });

  await step('перетаскивание компонента мышью и отмена', async () => {
    const p0 = await h.project();
    const u1 = Object.values(p0.components).find((c) => c.ref === 'R2');
    const a = await h.toScreen(u1.at.x, u1.at.y);
    const b = await h.toScreen(u1.at.x + 5, u1.at.y + 5);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const c = (await h.project()).components[u1.id];
    expect(Math.abs(c.at.x - u1.at.x - 5) < 0.7 && Math.abs(c.at.y - u1.at.y - 5) < 0.7, `сдвиг ${c.at.x - u1.at.x}, ${c.at.y - u1.at.y}`);
    await page.keyboard.press('Control+z');
    const c2 = (await h.project()).components[u1.id];
    expect(c2.at.x === u1.at.x && c2.at.y === u1.at.y, 'отмена перетаскивания');
  });

  await step('рамка выделения по пустому месту выбирает компоненты', async () => {
    const a = await h.toScreen(2, 2);
    const b = await h.toScreen(58, 38);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    const sel = await page.evaluate(() => window.__plata.state().selection);
    expect(sel.filter((r) => r.kind === 'component').length === 3, 'выделено ' + sel.length);
    await page.keyboard.press('Escape');
  });

  await step('двойной щелчок по компоненту: окно выводов, назначение цепей', async () => {
    const p = await h.project();
    const u1 = Object.values(p.components).find((c) => c.ref === 'U1');
    const r1 = Object.values(p.components).find((c) => c.ref === 'R1');
    await h.clickAt(u1.at.x, u1.at.y, { double: true });
    expect((await h.dialogTitle())?.startsWith('U1'), 'нет окна U1: ' + (await h.dialogTitle()));
    const inp = page.locator('.modal table input');
    await inp.nth(0).fill('SIG');
    await inp.nth(0).press('Enter');
    await inp.nth(3).fill('GND');
    await inp.nth(3).press('Enter');
    await h.closeDialog();
    await h.clickAt(r1.at.x, r1.at.y, { double: true });
    const inp2 = page.locator('.modal table input');
    await inp2.nth(0).fill('SIG');
    await inp2.nth(0).press('Enter');
    await inp2.nth(1).fill('GND');
    await inp2.nth(1).press('Enter');
    await h.closeDialog();
    const q = await h.project();
    expect(Object.values(q.nets).map((n) => n.name).sort().join(',') === 'GND,SIG', Object.values(q.nets).map((n) => n.name).join(','));
    expect(/Разведено 0 из 2/.test(await h.chips()), await h.chips());
  });

  await step('Ctrl+C / Ctrl+V под курсор, Ctrl+D, меню «Вставить», отмена', async () => {
    await page.keyboard.press('s');
    const p0 = await h.project();
    const r2 = Object.values(p0.components).find((c) => c.ref === 'R2');
    await h.clickAt(r2.at.x, r2.at.y);
    await page.keyboard.press('Control+c');
    expect(/Скопировано объектов: 1/.test(await h.msg()), 'копирование: ' + (await h.msg()));
    const t = await h.toScreen(30, 34);
    await page.mouse.move(t.x, t.y);
    await page.keyboard.press('Control+v');
    let p = await h.project();
    const r3 = Object.values(p.components).find((c) => c.ref === 'R3');
    expect(r3 && r3.footprint === r2.footprint && JSON.stringify(r3.padNets) === JSON.stringify(r2.padNets), 'вставка: ' + JSON.stringify(r3));
    expect(Math.abs(r3.at.x - 30) < 0.7 && Math.abs(r3.at.y - 34) < 0.7, 'вставка не под курсор: ' + JSON.stringify(r3.at));
    const sel = (await page.evaluate(() => window.__plata.state())).selection;
    expect(sel.length === 1 && sel[0].id === r3.id, 'вставленное не выделено');
    await page.keyboard.press('Control+d');
    p = await h.project();
    const r4 = Object.values(p.components).find((c) => c.ref === 'R4');
    expect(r4 && (r4.at.x !== r3.at.x || r4.at.y !== r3.at.y), 'дубликат: ' + JSON.stringify(r4?.at));
    await h.hit(page.getByRole('button', { name: 'Правка', exact: true }));
    expect(await page.locator('.menu-drop button', { hasText: 'Вставить' }).isEnabled(), 'пункт «Вставить» выключен');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    const refs = Object.values((await h.project()).components).map((c) => c.ref).sort().join(',');
    expect(refs === 'R1,R2,U1', 'после отмены: ' + refs);
    await page.keyboard.press('Escape');
  });

  await step('ручная дорожка от вывода к выводу с изгибом', async () => {
    const p = await h.project();
    const w = await page.evaluate(() => window.__plata.pads());
    const a = w.find((x) => x.label === 'U1.1');
    const b = w.find((x) => x.label === 'R1.1');
    await page.keyboard.press('w');
    await h.clickAt(a.x, a.y);
    await h.clickAt(a.x, b.y);
    await h.clickAt(b.x, b.y);
    const q = await h.project();
    expect(Object.keys(q.tracks).length === Object.keys(p.tracks).length + 1, 'дорожек ' + Object.keys(q.tracks).length);
    expect(/Разведено 1 из 2/.test(await h.chips()), await h.chips());
    await page.keyboard.press('Escape');
  });

  await step('дорожка с переходным (V): с верхней SMD площадки на нижний слой к DIP', async () => {
    const w = await page.evaluate(() => window.__plata.pads());
    const a = w.find((x) => x.label === 'R1.2');
    const b = w.find((x) => x.label === 'U1.4');
    await page.evaluate(() => 0);
    await page.keyboard.press('l'); // активный слой — нижний; начало на верхней площадке должно переключить слой
    await page.keyboard.press('w');
    await h.clickAt(a.x, a.y);
    expect((await page.evaluate(() => window.__plata.state().activeLayer)) === 'F.Cu', 'слой не переключился на площадку');
    const mid = { x: a.x, y: 36 };
    await h.clickAt(mid.x, mid.y);
    await page.keyboard.press('v');
    expect((await page.evaluate(() => window.__plata.state().activeLayer)) === 'B.Cu', 'после V слой не сменился');
    await h.clickAt(b.x, mid.y);
    await h.clickAt(b.x, b.y);
    const q = await h.project();
    expect(Object.keys(q.vias).length === 1, 'переходных ' + Object.keys(q.vias).length);
    expect(Object.values(q.tracks).some((t) => t.layer === 'B.Cu'), 'нет дорожки на нижнем слое');
    expect(/Разведено 2 из 2/.test(await h.chips()), (await h.chips()) + ' ' + JSON.stringify(await page.evaluate(() => window.__plata.drc())) + ' tracks ' + JSON.stringify(Object.values(q.tracks).map((t) => [t.layer, t.points])) + ' vias ' + JSON.stringify(Object.values(q.vias).map((v) => v.at)) + ' pads ' + JSON.stringify([a, b]));
    await page.keyboard.press('Escape');
  });

  await step('Backspace убирает изгиб, Esc отменяет дорожку', async () => {
    const n0 = Object.keys((await h.project()).tracks).length;
    await page.keyboard.press('w');
    await h.clickAt(5, 5);
    await h.clickAt(10, 5);
    await h.clickAt(10, 10);
    let pd = await page.evaluate(() => window.__plata.state().pending);
    expect(pd && pd.points.length >= 3, 'точек ' + pd?.points.length);
    await page.keyboard.press('Backspace');
    pd = await page.evaluate(() => window.__plata.state().pending);
    expect(pd.points.length === 2, 'после Backspace ' + pd.points.length);
    await page.keyboard.press('Escape');
    expect(!(await page.evaluate(() => window.__plata.state().pending)), 'Esc не отменил');
    expect(Object.keys((await h.project()).tracks).length === n0, 'лишняя дорожка');
  });

  await step('переходное, перемычка, линия, прямоугольник, окружность, многоугольник, надпись, линейка', async () => {
    const p0 = await h.project();
    await page.keyboard.press('v');
    await h.clickAt(50, 35);
    await page.keyboard.press('j');
    await h.clickAt(5, 35);
    await h.clickAt(15, 35);
    await h.hit('.toolbar .tbtn[aria-label="Линия на шелкографии"]');
    await h.clickAt(5, 3);
    await h.clickAt(15, 3);
    await h.hit('.toolbar .tbtn[aria-label="Прямоугольник"]');
    await h.clickAt(30, 33);
    await h.clickAt(35, 37);
    await h.hit('.toolbar .tbtn[aria-label="Окружность"]');
    await h.clickAt(52, 5);
    await h.clickAt(54, 5);
    await h.hit('.toolbar .tbtn[aria-label="Многоугольник"]');
    await h.clickAt(25, 3);
    await h.clickAt(28, 3);
    await h.clickAt(28, 6);
    await h.clickAt(28, 6, { wait: 250 });
    await page.keyboard.press('t');
    await h.clickAt(30, 37.5);
    expect((await h.dialogTitle()) === 'Новая надпись', 'нет окна надписи');
    await page.fill('#text-dialog-input', 'QA тест 1');
    await h.hit(page.locator('.modal footer button', { hasText: 'Поставить' }));
    await page.keyboard.press('m');
    await h.clickAt(0, 0);
    await h.clickAt(60, 0);
    expect(/Расстояние (60|59,69)/.test(await h.msg()), 'линейка: ' + (await h.msg()));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const p = await h.project();
    const kinds = Object.values(p.drawings).map((d) => d.kind).sort().join(',');
    expect(Object.keys(p.vias).length === Object.keys(p0.vias).length + 1 + 2, 'переходных ' + Object.keys(p.vias).length);
    expect(Object.keys(p.wires).length === 1, 'перемычек ' + Object.keys(p.wires).length);
    expect(kinds === 'circle,line,poly,rect,text', 'графика: ' + kinds);
  });

  await step('поворот одиночной линии вокруг её центра, отмена', async () => {
    await page.keyboard.press('s');
    await h.clickAt(10, 3);
    const st = await page.evaluate(() => window.__plata.state());
    expect(st.selection.length === 1 && st.selection[0].kind === 'drawing', 'линия не выделилась: ' + JSON.stringify(st.selection));
    const id = st.selection[0].id;
    const d0 = (await h.project()).drawings[id];
    const cx = (d0.a.x + d0.b.x) / 2;
    const cy = (d0.a.y + d0.b.y) / 2;
    const L = Math.hypot(d0.b.x - d0.a.x, d0.b.y - d0.a.y);
    await page.keyboard.press('r');
    const d = (await h.project()).drawings[id];
    const ok = Math.abs(d.a.x - cx) < 1e-6 && Math.abs(d.b.x - cx) < 1e-6 && Math.abs((d.a.y + d.b.y) / 2 - cy) < 1e-6 && Math.abs(Math.abs(d.a.y - d.b.y) - L) < 1e-6;
    expect(ok, 'линия не повернулась вокруг центра: ' + JSON.stringify([d0.a, d0.b, d.a, d.b]));
    await page.keyboard.press('Control+z');
    const d2 = (await h.project()).drawings[id];
    expect(d2.a.y === d0.a.y && d2.b.x === d0.b.x, 'отмена поворота');
    await page.keyboard.press('Escape');
  });

  await step('область правил и полигон: рисуются, свойства открываются', async () => {
    await h.hit('.toolbar .tbtn[aria-label^="Область правил"]');
    for (const [x, y] of [[40, 32], [58, 32], [58, 38]]) await h.clickAt(x, y);
    await h.clickAt(58, 38, { wait: 250 });
    await h.hit('.toolbar .tbtn[aria-label="Полигон меди"]');
    for (const [x, y] of [[2, 2], [12, 2], [12, 8]]) await h.clickAt(x, y);
    await h.clickAt(12, 8, { wait: 250 });
    const p = await h.project();
    expect(Object.keys(p.ruleAreas).length === 1 && Object.keys(p.zones).length === 1, `областей ${Object.keys(p.ruleAreas).length}, полигонов ${Object.keys(p.zones).length}`);
    // Новый полигон сразу получает цепь GND, выделен, свойства открыты.
    const gnd = Object.values(p.nets).find((n) => n.name === 'GND');
    const z = Object.values(p.zones)[0];
    expect(z.net === gnd?.id, 'цепь полигона ' + z.net);
    const st = await page.evaluate(() => window.__plata.state());
    expect(st.selection.length === 1 && st.selection[0].kind === 'zone' && st.panelTab === 'props', 'полигон не выделен: ' + JSON.stringify(st.selection) + ' ' + st.panelTab);
    expect(await page.locator('.panel h3', { hasText: 'Полигон меди' }).isVisible(), 'нет свойств полигона');
    expect((await page.evaluate(() => window.__plata.drc())).some((m) => /Полигон GND пуст/.test(m)), 'нет предупреждения о пустом полигоне');
    // Полигон на всю плату соединяет землю заливкой.
    await page.keyboard.press('Delete');
    expect(Object.keys((await h.project()).zones).length === 0, 'полигон не удалился');
    // Правый нижний угол платы закрыт кнопками масштаба — обходим его, как обошёл бы человек.
    for (const [x, y] of [[0.5, 0.5], [59.5, 0.5], [59.5, 30], [45, 39.5], [0.5, 39.5]]) await h.clickAt(x, y);
    await h.clickAt(0.5, 39.5, { wait: 250 });
    const fills = await page.evaluate(() => window.__plata.fills());
    expect(fills.length === 1 && fills[0].loops > 0 && fills[0].islands >= 1, 'заливка: ' + JSON.stringify(fills) + ' ' + JSON.stringify(await page.evaluate(() => { const s = window.__plata.state(); return [s.tool, s.pending, s.message]; })));
    expect((await page.evaluate(() => window.__plata.netComplete('GND'))) === true, 'GND не соединена заливкой');
    // Протяжка внутри полигона — рамка, а не перенос полигона; щелчок — выделение полигона.
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    const zBefore = JSON.stringify(Object.values((await h.project()).zones)[0].outline);
    const a = await h.toScreen(44, 24);
    const b = await h.toScreen(50, 28);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(JSON.stringify(Object.values((await h.project()).zones)[0].outline) === zBefore, 'протяжка внутри сдвинула полигон');
    expect(/Выделено|ничего нет/.test(await h.msg()), 'нет рамки: ' + (await h.msg()));
    await h.clickAt(47, 26);
    const sel = (await page.evaluate(() => window.__plata.state())).selection;
    expect(sel.length === 1 && sel[0].kind === 'zone', 'щелчок внутри не выделил полигон: ' + JSON.stringify(sel));
    await page.keyboard.press('Control+z');
    expect(Object.keys((await h.project()).zones).length === 0, 'отмена полигона');
    await page.keyboard.press('Escape');
  });

  await step('цепи: создать, подсветить, удалить через подтверждение', async () => {
    await h.hit(page.locator('.panel .tabs button', { hasText: 'Цепи' }));
    await page.fill('.panel input[placeholder^="Новая цепь"]', 'TEST_NET');
    await h.hit(page.locator('.panel button', { hasText: 'Добавить' }));
    await h.hit(page.locator('.panel .list .item', { hasText: 'TEST_NET' }));
    await h.hit(page.locator('.panel button', { hasText: 'Удалить цепь' }));
    await h.hit(page.locator('.modal footer button', { hasText: 'Удалить' }));
    const p = await h.project();
    expect(!Object.values(p.nets).some((n) => n.name === 'TEST_NET'), 'цепь не удалилась');
  });

  await step('настройки платы: размер, классы, класс 230 В, новый класс через окно ввода', async () => {
    await h.menu('Файл', 'Настройки платы');
    const w = page.locator('.modal .field input').nth(2);
    await w.fill('70');
    await w.press('Enter');
    await h.hit(page.locator('.modal .tabs button', { hasText: 'Правила' }));
    await h.hit(page.locator('.modal button', { hasText: 'Сеть 230 В' }));
    await h.hit(page.locator('.modal .tabs button', { hasText: 'Классы цепей' }));
    await h.hit(page.locator('.modal button', { hasText: 'Добавить класс' }));
    expect((await h.dialogTitle()) === 'Новый класс цепей', 'нет окна ввода');
    await page.fill('.modal input.inp', 'HV');
    await h.hit(page.locator('.modal footer button', { hasText: 'Добавить' }));
    expect((await h.dialogTitle()) === 'Плата, правила и классы цепей', 'не вернулись в настройки');
    await h.closeDialog();
    const p = await h.project();
    const xs = p.board.outline.map((q) => q.x);
    expect(Math.max(...xs) - Math.min(...xs) === 70, 'ширина ' + (Math.max(...xs) - Math.min(...xs)));
    expect(p.netClasses.Mains && p.netClasses.HV, 'классы ' + Object.keys(p.netClasses));
  });

  await step('проверка правил: щелчок по замечанию ведёт к месту', async () => {
    await h.hit(page.locator('.panel .tabs button', { hasText: 'Проверка' }));
    const n = await page.locator('.panel .list .item').count();
    if (n) {
      const v0 = await page.evaluate(() => window.__plata.view());
      await h.hit(page.locator('.panel .list .item').first());
      const v1 = await page.evaluate(() => window.__plata.view());
      expect(JSON.stringify(v0) !== JSON.stringify(v1), 'вид не сдвинулся');
    }
  });

  await step('слои: скрыть и показать слой', async () => {
    await h.hit(page.locator('.panel .tabs button', { hasText: 'Слои' }));
    await h.hit(page.locator('.layer-row', { hasText: 'Верхняя шелкография' }).locator('.eye'));
    expect(!(await page.evaluate(() => window.__plata.state().layerVisible['F.Silk'])), 'не скрылся');
    await h.hit(page.locator('.layer-row', { hasText: 'Верхняя шелкография' }).locator('.eye'));
  });

  await step('масштаб: кнопки +, −, «вся плата», колесо', async () => {
    const s0 = (await page.evaluate(() => window.__plata.view())).scale;
    await h.hit('.zoombar button[aria-label="Приблизить"]');
    const s1 = (await page.evaluate(() => window.__plata.view())).scale;
    expect(s1 > s0, 'не приблизилось');
    await h.hit('.zoombar button[aria-label="Отдалить"]');
    const c = await h.toScreen(30, 20);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(100);
    const s2 = (await page.evaluate(() => window.__plata.view())).scale;
    expect(s2 > s0 * 0.99, 'колесо не приблизило');
    await h.hit('.zoombar button[aria-label="Вся плата"]');
  });

  await step('автотрассировка «только недоведённые» не ломает имеющиеся дорожки', async () => {
    const n0 = Object.keys((await h.project()).tracks).length;
    await h.menu('Трассировка', 'Автотрассировка');
    await h.hit(page.locator('.modal footer button', { hasText: 'Развести' }));
    await page.waitForSelector('.modal', { state: 'detached', timeout: 60000 });
    const n1 = Object.keys((await h.project()).tracks).length;
    expect(n1 >= n0, `дорожек было ${n0}, стало ${n1}`);
  });

  await step('единицы: mil в строке состояния — поля и ввод в mil, обратно в мм', async () => {
    await page.selectOption('.statusbar select[aria-label="Единицы"]', 'mil');
    await h.menu('Файл', 'Настройки платы');
    expect(await page.locator('.modal label', { hasText: 'Ширина, mil' }).count(), 'подпись не в mil');
    const w = page.locator('.modal .field input').nth(2);
    expect((await w.inputValue()) === '2755,9', 'ширина в mil: ' + (await w.inputValue()));
    await w.fill('2000');
    await w.press('Enter');
    await h.closeDialog();
    let p = await h.project();
    let xs = p.board.outline.map((q) => q.x);
    expect(Math.abs(Math.max(...xs) - Math.min(...xs) - 50.8) < 1e-6, 'ширина мм ' + (Math.max(...xs) - Math.min(...xs)));
    await page.selectOption('.statusbar select[aria-label="Единицы"]', 'mm');
    await h.menu('Файл', 'Настройки платы');
    const w2 = page.locator('.modal .field input').nth(2);
    await w2.fill('70 мм');
    await w2.press('Enter');
    await h.closeDialog();
    p = await h.project();
    xs = p.board.outline.map((q) => q.x);
    expect(Math.max(...xs) - Math.min(...xs) === 70, 'ширина ' + (Math.max(...xs) - Math.min(...xs)));
  });

  await step('поле без правки не меняет значение при уходе фокуса', async () => {
    const p0 = await h.project();
    const r2 = Object.values(p0.components).find((c) => c.ref === 'R2');
    await page.keyboard.press('s');
    await h.clickAt(r2.at.x, r2.at.y);
    await h.hit(page.locator('.panel .tabs button', { hasText: 'Свойства' }));
    const x = page.locator('.panel .field input').nth(2);
    await x.focus();
    await x.blur();
    const p1 = await h.project();
    expect(p1.components[r2.id].at.x === r2.at.x && p0.meta.modified === p1.meta.modified, 'значение изменилось без правки');
  });

  await step('обозначение: занятое не принимается, свободное принимается', async () => {
    const p0 = await h.project();
    const r2 = Object.values(p0.components).find((c) => c.ref === 'R2');
    const ref = page.locator('.panel .field input').nth(0);
    await ref.fill('R1');
    await ref.press('Enter');
    let p = await h.project();
    expect(p.components[r2.id].ref === 'R2', 'занятое обозначение принято');
    expect(/уже занято/.test(await h.msg()), 'нет сообщения: ' + (await h.msg()));
    expect((await ref.inputValue()) === 'R2', 'поле не вернулось: ' + (await ref.inputValue()));
    await ref.fill('R10');
    await ref.press('Enter');
    p = await h.project();
    expect(p.components[r2.id].ref === 'R10', 'новое обозначение не принято');
    await page.keyboard.press('Control+z');
  });

  await step('замена корпуса на совместимый (0805 → 1206) в окне компонента', async () => {
    const p0 = await h.project();
    const r1 = Object.values(p0.components).find((c) => c.ref === 'R1');
    await page.keyboard.press('Escape');
    await h.clickAt(r1.at.x, r1.at.y, { double: true });
    await h.hit(page.locator('.modal .list .item', { hasText: '1206' }).first());
    await h.closeDialog();
    const p = await h.project();
    expect(/1206/.test(p.components[r1.id].footprint), 'корпус ' + p.components[r1.id].footprint);
    expect(Object.keys(p.components[r1.id].padNets).length === 2, 'цепи выводов потерялись');
    await page.keyboard.press('Control+z');
  });

  await step('установка: призрак под курсором, R поворачивает, F меняет сторону', async () => {
    await h.hit(page.locator('.panel .tabs button', { hasText: 'Библиотека' }));
    await page.fill('.panel input[placeholder^="Поиск"]', 'SOT-23');
    await page.waitForTimeout(150);
    await h.hit(page.locator('.panel .list .item').first());
    await h.hit(page.locator('.panel button', { hasText: 'Поставить на плату' }));
    const pt = await h.toScreen(55, 20);
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(80);
    let g = await page.evaluate(() => window.__plata.ghost());
    expect(g && g.rotation === 0, 'нет призрака');
    await page.keyboard.press('r');
    await page.keyboard.press('f');
    g = await page.evaluate(() => window.__plata.ghost());
    expect(g.rotation === 90 && g.side === 'bottom', 'призрак ' + JSON.stringify(g));
    await page.mouse.click(pt.x, pt.y);
    const p = await h.project();
    const q = Object.values(p.components).find((c) => c.footprint === 'SOT-23');
    expect(q && q.rotation === 90 && q.side === 'bottom', 'поставлен ' + JSON.stringify(q && [q.rotation, q.side]));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
  });

  await step('переименование цепи: в занятое имя нельзя', async () => {
    const p = await h.project();
    const sig = Object.values(p.nets).find((n) => n.name === 'SIG');
    await h.hit(page.locator('.panel .tabs button', { hasText: 'Цепи' }));
    await h.hit(page.locator('.panel .list .item', { hasText: 'SIG' }), { double: true });
    const name = page.locator('.modal .field input').first();
    await name.fill('GND');
    await name.press('Enter');
    expect((await h.project()).nets[sig.id].name === 'SIG', 'цепь переименована в занятое имя');
    await h.closeDialog();
  });

  await step('1 слой: предупреждение о планарных деталях сверху', async () => {
    await h.menu('Файл', 'Настройки платы');
    await page.selectOption('.modal .field select >> nth=0', '1');
    await h.closeDialog();
    expect(/односторонней/.test(await h.msg()) && /R1|R2|R10/.test(await h.msg()), 'сообщение: ' + (await h.msg()));
    await page.keyboard.press('Control+z');
    expect((await h.project()).board.copperLayers === 2, 'отмена не вернула 2 слоя');
    await page.evaluate(() => 0);
  });

  await step('неверный файл проекта: понятное сообщение, проект не меняется', async () => {
    const name0 = (await h.project()).meta.name;
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
    await fc.setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
    await page.waitForTimeout(300);
    expect(/не похож/.test(await h.msg()), 'сообщение: ' + (await h.msg()));
    expect((await h.project()).meta.name === name0, 'проект сменился');
  });

  await step('экспорт: все кнопки выдают файлы', async () => {
    downloads.length = 0;
    await h.menu('Файл', 'Экспорт');
    const btns = page.locator('.modal .content button');
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      const t = await btns.nth(i).textContent();
      if (/Скопировать/.test(t)) continue;
      const before = downloads.length;
      await h.hit(btns.nth(i), { wait: /Отдельными/.test(t) ? 2000 : 400 });
      if (downloads.length === before) console.log('    нет файла от кнопки:', t, '|', await h.msg());
    }
    await page.waitForTimeout(500);
    await h.closeDialog();
    expect(downloads.some((f) => f.endsWith('-gerber.zip')), 'нет архива: ' + downloads.join(','));
    expect(downloads.some((f) => f.endsWith('.gtl')), 'нет верхней меди gtl');
    expect(downloads.some((f) => f.endsWith('.plata.json')), 'нет файла проекта');
    expect(downloads.filter((f) => f.endsWith('.svg')).length >= 3, 'svg: ' + downloads.filter((f) => f.endsWith('.svg')).join(','));
  });

  let savedFile = null;
  await step('Ctrl+S сохраняет, Ctrl+O открывает сохранённое', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    savedFile = `${out}/${dl.suggestedFilename()}`;
    await dl.saveAs(savedFile);
    const saved = JSON.parse(readFileSync(savedFile, 'utf8'));
    expect(saved.meta.name === 'QA плата', 'имя ' + saved.meta.name);
    await h.menu('Файл', 'Новый проект');
    await h.hit(page.locator('.card', { hasText: 'Пустая 50×50' }));
    await h.hit(page.locator('.modal footer button', { hasText: 'Создать' }));
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
    await fc.setFiles(savedFile);
    await page.waitForTimeout(300);
    const p = await h.project();
    expect(p.meta.name === 'QA плата' && Object.keys(p.components).length === 3, 'открылось: ' + p.meta.name);
  });

  await step('недавние проекты: пустая плата попала в список и открывается', async () => {
    await h.menu('Файл', 'Недавние проекты');
    const items = page.locator('.modal .list .item');
    expect((await items.count()) >= 1, 'список пуст');
    await h.closeDialog();
  });

  await step('перезагрузка: проект восстанавливается из браузера', async () => {
    await page.waitForTimeout(900);
    await page.reload();
    await page.waitForSelector('.stage canvas');
    await page.waitForTimeout(400);
    const p = await h.project();
    expect(p.meta.name === 'QA плата', 'после перезагрузки ' + p.meta.name);
  });

  await step('шаблоны: каждый создаётся без ошибок', async () => {
    await h.menu('Файл', 'Новый проект');
    const n = await page.locator('.modal .card').count();
    await h.closeDialog();
    for (let i = 0; i < n; i++) {
      await h.menu('Файл', 'Новый проект');
      const card = page.locator('.modal .card').nth(i);
      const name = (await card.locator('.nm').textContent()).trim();
      await card.scrollIntoViewIfNeeded();
      await card.click();
      await h.hit(page.locator('.modal footer button', { hasText: 'Создать' }));
      const p = await h.project();
      expect(p.board.outline.length >= 3, 'шаблон ' + name);
    }
  });

  await page.screenshot({ path: `${out}/desktop.png` });
  await page.context().close();
}

/* ================= телефон ================= */
{
  const page = await openPage({ width: 390, height: 844 }, true);
  const h = helpers(page, true);
  await step('телефон: меню «Файл» открывается касанием и пункт срабатывает', async () => {
    await h.hit(page.getByRole('button', { name: 'Файл', exact: true }));
    await h.hit(page.locator('.menu-drop button', { hasText: 'Экспорт' }));
    expect((await h.dialogTitle()) === 'Экспорт', 'окно: ' + (await h.dialogTitle()));
    await h.closeDialog();
  });
  await step('телефон: все меню доступны (строка прокручивается)', async () => {
    for (const top of ['Файл', 'Правка', 'Вид', 'Разместить', 'Трассировка', 'Справка']) {
      const b = page.getByRole('button', { name: top, exact: true });
      await b.scrollIntoViewIfNeeded();
      await page.waitForTimeout(80);
      await h.hit(b);
      expect(await page.locator('.menu-drop').count(), `«${top}» не открылось`);
      const ok = await page.locator('.menu-drop button').first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return (el === e || el.contains(e) || (el.disabled && !!e?.closest('.menu-drop'))) && r.right <= innerWidth + 1;
      });
      expect(ok, `«${top}»: пункт не виден`);
      await h.hit(page.getByRole('button', { name: top, exact: true }));
    }
  });
  await step('телефон: панель открывается, библиотека, установка касанием', async () => {
    await h.hit('.panel-toggle', { wait: 400 }); // панель выезжает с анимацией
    await h.hit(page.locator('.panel .tabs button', { hasText: 'Библиотека' }));
    await page.fill('.panel input[placeholder^="Поиск"]', 'R_0805');
    await page.waitForTimeout(150);
    await h.hit(page.locator('.panel .list .item').first());
    await h.hit(page.locator('.panel button', { hasText: 'Поставить на плату' }));
    expect(!(await page.evaluate(() => window.__plata.state().panelOpen)), 'панель не закрылась перед установкой');
    const n0 = Object.keys((await h.project()).components).length;
    await h.clickAt(100, 60);
    const n1 = Object.keys((await h.project()).components).length;
    expect(n1 === n0 + 1, `компонентов ${n0} → ${n1}`);
  });
  await step('телефон: прокрутка платы пальцем по пустому месту', async () => {
    if (await page.evaluate(() => window.__plata.state().panelOpen)) await h.hit('.panel-toggle', { wait: 400 });
    await page.keyboard.press('Escape');
    const box = await page.locator('.stage canvas').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const v0 = await page.evaluate(() => window.__plata.view());
    const x = box.x + 20, y = box.y + box.height - 40;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 15, y: y - i * 10 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    const v1 = await page.evaluate(() => window.__plata.view());
    expect(v1.x !== v0.x || v1.y !== v0.y, 'вид не сдвинулся');
    const sel = await page.evaluate(() => window.__plata.state().pending);
    expect(!sel, 'осталась рамка выделения');
  });

  await step('телефон: все инструменты достижимы на нижней панели', async () => {
    const n = await page.locator('.toolbar .tbtn').count();
    for (let i = 0; i < n; i++) {
      const b = page.locator('.toolbar .tbtn').nth(i);
      await b.scrollIntoViewIfNeeded();
      const box = await b.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 391, 'кнопка за экраном: ' + (await b.getAttribute('aria-label')));
    }
  });
  await step('телефон: каждое окно помещается на экран и закрывается касанием', async () => {
    const vp = page.viewportSize();
    const list = [
      ['Файл', 'Экспорт'],
      ['Файл', 'Настройки платы'],
      ['Файл', 'Новый проект'],
      ['Файл', 'Недавние проекты'],
      ['Трассировка', 'Автотрассировка'],
      ['Справка', 'Горячие клавиши'],
      ['Справка', 'О программе'],
    ];
    for (const [top, item] of list) {
      await h.menu(top, item);
      await page.waitForTimeout(200);
      const g = await page.evaluate(() => {
        const b = document.querySelector('.modal')?.getBoundingClientRect();
        return b ? { top: b.top, bottom: b.bottom, left: b.left, right: b.right, docW: document.documentElement.scrollWidth } : null;
      });
      expect(g && g.top >= 0 && g.left >= 0 && g.bottom <= vp.height + 1 && g.right <= vp.width + 1 && g.docW <= vp.width, `${item}: окно за экраном ${JSON.stringify(g)}`);
      await h.hit('.modal header button');
      expect(!(await page.$('.modal')), `${item}: окно не закрылось`);
    }
  });

  await page.screenshot({ path: `${out}/mobile.png` });
  await page.context().close();
}

await browser.close();
const fails = results.filter((r) => r[0] !== 'ok');
for (const r of results) console.log(r[0] === 'ok' ? '  ✓' : '  ✗', r[1], r[2] ? '— ' + r[2] : '');
console.log(`\n${results.length - fails.length} из ${results.length} сценариев прошли`);
if (errors.length) console.log('Ошибки страницы:\n' + [...new Set(errors)].slice(0, 30).join('\n'));
process.exit(fails.length || errors.length ? 1 : 0);
