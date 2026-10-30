import type { Project } from '../../model/types';
import { BUS, BUS_DOORS, busTaps, LUT_BOARD, LUT_GAP, type LutFloor } from './lut5';
import { DESCRIPTIONS } from './stack';

/*
 * Памятка к этажерке под ЛУТ (HTML для печати в PDF): что заказать у мастера, как собрать этажи,
 * шина между ними, клеммники, перечень по этажам.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FLOOR_TEXT: Record<LutFloor, string> = {
  1: 'Лицевой: экран 3,5″ на стойках 11 мм, кнопки 1–3 слева и 4–6 справа, внизу «Турбина 1», «Турбина 2», энкодер, «Выкл», светодиод, зуммер. PCA9555 (SOIC-24) — на нижней стороне платы.',
  2: 'Контроллер: ESP32-S3-DevKitC-1 на гнёздах (антенна — вверх, USB — вниз, под угловой штекер удлинителя), ULN2003 в панельке, подтяжки второй шины I²C.',
  3: 'Датчики и голос: ADS1115, часы ZS-042, плеер DFPlayer Mini, датчик разрежения MPX5100DP (трубка — к правому краю), разъём динамика XA1.',
  4: 'Разъёмы: клеммники KF2EDGR по краям — слева термисторы и I²C, снизу I²C-B, трансформаторы тока, бак, питание 5 В, справа жгут к силовой части (реле, клапаны, МР248, ZMPT101B).',
};

/** Подписи клеммников из шелкографии: деталь → «вывод: подпись». */
function terminals(p: Project): { ref: string; value: string; description: string }[] {
  return Object.values(p.components)
    .filter((c) => /^X(\d+|P1|A1)$/.test(c.ref))
    .sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }))
    .map((c) => ({ ref: c.ref, value: c.value, description: c.description ?? '' }));
}

export function lutGuideHtml(floors: Record<LutFloor, Project>): string {
  const taps = busTaps();
  const h: string[] = [];
  h.push(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Пылесос S3 — этажерка под ЛУТ</title><style>
@page { size: A4; margin: 14mm 12mm; }
body { font: 10.5pt/1.4 'Inter', 'DejaVu Sans', sans-serif; color: #1b1b1b; }
h1 { font-size: 17pt; margin: 0 0 4pt; } h2 { font-size: 13pt; margin: 14pt 0 4pt; border-bottom: 1px solid #bbb; } h3 { font-size: 11pt; margin: 10pt 0 3pt; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 4pt 0; } td, th { border: 1px solid #ccc; padding: 2pt 4pt; vertical-align: top; text-align: left; } th { background: #f1f1f1; }
.mut { color: #666; } .warn { background: #fff4d6; border-left: 3px solid #e0a000; padding: 4pt 8pt; margin: 6pt 0; }
ol, ul { margin: 2pt 0 2pt 16pt; padding: 0; } li { margin: 1pt 0; } .pb { break-before: page; }
</style></head><body>`);
  h.push(`<h1>Пылесос S3 — этажерка под ЛУТ с масками</h1><p class="mut">Прошивка 6.4. Четыре двусторонние платы ${LUT_BOARD.w}×${LUT_BOARD.h} мм без металлизации, между платами ${LUT_GAP} мм.</p>`);

  h.push('<h2>Что отдать мастеру</h2><ul>');
  h.push('<li>Папки <b>etazh-1 … etazh-4</b>: в каждой <b>gerber/</b> (медь верх и низ, маски верх и низ, шелкография, контур, сверловка) и два PDF 1:1 — <b>LUT-zerkalno</b> (верхние слои зеркально, как кладут на плату для ЛУТ) и <b>vid-sverhu</b> (все слои без зеркала, для сверки).</li>');
  h.push('<li>Металлизации нет: все выводы паяются <b>снизу</b> (медь вокруг отверстий только снизу). Сверху — дорожки между <b>переходными</b>: в отверстие переходного вставить проволочку (ножка резистора) и пропаять с двух сторон.</li>');
  h.push('<li>Маска снизу открывает все площадки и переходные, сверху — только переходные (и площадки PCA9555 этажа 1 — снизу).</li>');
  h.push('<li>Сверление: выводы 1,0 мм, клеммники 1,3 мм, переходные 0,8–0,9 мм, крепёж 3,2 мм. Медная надпись не нужна — проверка сторон по шелкографии и подписям в PDF.</li></ul>');

  h.push('<h2>Этажи</h2><table><tr><th>Этаж</th><th>Что на нём</th></tr>');
  for (const f of [1, 2, 3, 4] as LutFloor[]) h.push(`<tr><td><b>${f}</b></td><td>${esc(FLOOR_TEXT[f])}</td></tr>`);
  h.push('</table>');
  h.push(`<div class="warn">Порядок от лица: 1 (экран наружу) → 2 → 3 → 4. Детали всех этажей смотрят к лицу; стойки M3 ${LUT_GAP} мм в углах. Глубина блока ≈ ${(4 * 1.6 + 3 * LUT_GAP + 17).toFixed(0)} мм вместе с экраном. Антенна ESP32 — у верхнего края: над ней и под ней на всех этажах меди нет, корпус в этом месте — без металла.</div>`);

  h.push('<h2>Шина между этажами</h2>');
  h.push(`<p>Два ряда по 22 штыря — в столбцах выводов ESP32 (этаж 2): <b>левый ряд</b> (L) напротив выводов 3V3 … GND, <b>правый</b> (R) — напротив GND … GND. Этаж 1: длинные штыри 25 мм назад (пластик сверху, под экраном). Этажи 2 и 3: гнездо от предыдущего этажа и длинные штыри к следующему — через ряд (2,54 мм). Этаж 4: гнездо. Столбцы свободных выводов ESP32 («двери») несут выходы ULN2003, поплавок и термисторы.</p>`);
  h.push('<table><tr><th>Столбец</th><th>Цепь</th><th>Этажи</th><th>Что это</th></tr>');
  for (const side of ['L', 'R'] as const)
    for (let c = 1; c <= 22; c++) {
      const id = `${side}${c}`;
      const net = BUS[side][c];
      if (!net) continue;
      const t = [...(taps.get(id) ?? [])].sort().join(', ');
      h.push(`<tr><td>${id}${BUS_DOORS.has(id) ? ' (дверь)' : ''}</td><td>${esc(net)}</td><td>${t || '—'}</td><td class="mut">${esc(DESCRIPTIONS[net] ?? '')}</td></tr>`);
    }
  h.push('</table>');

  h.push('<h2 class="pb">Клеммники</h2><p>На плате — угловые вилки <b>KF2EDGR</b> 5,08, на проводе — гнёзда <b>KF2EDGK</b> с винтами. Подписи выводов — на шелкографии у каждого клеммника.</p><table><tr><th>Клеммник</th><th>Назначение</th><th>Что подключать</th></tr>');
  for (const f of [3, 4] as LutFloor[]) for (const t of terminals(floors[f])) h.push(`<tr><td>${t.ref} (этаж ${f})</td><td>${esc(t.value)}</td><td>${esc(t.description)}</td></tr>`);
  h.push('</table>');

  h.push('<h2>Сборка</h2><ol>');
  h.push('<li>Проверить платы на просвет и прозвонить замыкания соседних дорожек. Вставить и пропаять с двух сторон все переходные (проволочки), откусить заподлицо — до установки деталей.</li>');
  h.push('<li>Этаж 1: PCA9555 — снизу (ключ — по шелкографии), затем мелочь, кнопки, энкодер, зуммер (TMB12A05, «+» по метке), светодиод с длинными ногами до панели, гнездо экрана 1×14, длинные штыри шины (пластик сверху). Стойки экрана 11 мм.</li>');
  h.push('<li>Этаж 2: панелька ULN2003 (ключ вверх), гнёзда ESP32 (правое — в ряд, подходящий вашей плате: 22,86 или 25,4 мм), гнёзда шины от этажа 1 и длинные штыри к этажу 3 — через ряд.</li>');
  h.push('<li>Этаж 3: гнёзда модулей (ADS1115 1×10, часы 1×6 и опора 1×4, плеер 2×8), датчик разрежения, мелочь, гнездо шины и длинные штыри к этажу 4.</li>');
  h.push('<li>Этаж 4: клеммники KF2EDGR (вход провода — к краю), мелочь, гнёзда шины.</li>');
  h.push('<li>После каждого этажа — отмыть флюс (ЛТИ-120: изопропиловый спирт и щётка), просушить. Прозвонить по таблице шины: каждая цепь на всех своих этажах.</li>');
  h.push('<li>Собрать этажерку на стойках, проверить, что штыри вошли в гнёзда всех рядов. Первое включение — от лабораторного источника 5 В с ограничением тока 0,5 А, без силовой части.</li></ol>');

  h.push('<h2>Силовая часть (230 В)</h2><p>Модули реле 30 А, МР248, AOD4184, ZMPT101B и блоки питания 5 и 24 В — в отдельном отсеке корпуса, на пластине с защёлками или стойками; ток 30 А и сеть — проводами между их клеммами (не по дорожкам самодельной платы). К этажерке — только низковольтный жгут на клеммники правого края этажа 4 и питание 5 В на XP1.</p>');

  for (const f of [1, 2, 3, 4] as LutFloor[]) {
    const p = floors[f];
    h.push(`<h2 class="pb">Перечень: этаж ${f}</h2><table><tr><th>Обозначение</th><th>Номинал</th><th>Описание</th></tr>`);
    const comps = Object.values(p.components)
      .filter((c) => !/^H\d$/.test(c.ref))
      .sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }));
    for (const c of comps) h.push(`<tr><td>${c.ref}</td><td>${esc(c.value)}</td><td>${esc(c.description ?? '')}</td></tr>`);
    h.push('</table>');
  }
  h.push('</body></html>');
  return h.join('\n');
}
