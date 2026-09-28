import type { BjtModel, DiodeModel, MosModel, OpAmpModel, RegModel } from './elements';

/*
 * Справочник деталей для аналогового расчёта: по названию — модель с параметрами из
 * даташитов (типовые значения). Незнакомая деталь того же вида получает «среднюю» модель.
 */

const num = (s: string) => parseFloat(s.replace(',', '.'));

/** Ёмкость по номиналу: «0,47 мкФ*», «2200 мкФ × 10 В», «22 пФ», «100n», «4u7». */
export function parseFarads(value: string): number | null {
  const v = value.replace(/\*/g, '').replace(/\s+/g, '').toLowerCase();
  const code = /^(\d+)(p|n|u|µ|м|мк|п|н)(\d+)/.exec(v);
  const mulOf = (u: string) => (/^(p|п|пф|pf)$/.test(u) ? 1e-12 : /^(n|н|нф|nf)$/.test(u) ? 1e-9 : /^(u|µ|мк|мкф|uf|µf)$/.test(u) ? 1e-6 : /^(м|mf|мф)$/.test(u) ? 1e-3 : 1);
  if (code) return num(`${code[1]}.${code[3]}`) * mulOf(code[2]);
  const m = /^(\d+(?:[.,]\d+)?)(пф|pf|p|п|нф|nf|n|н|мкф|uf|µf|u|µ|мк|mf|мф|ф|f)?/.exec(v);
  if (!m) return null;
  const u = m[2] ?? '';
  if (!u) return num(m[1]) >= 1 ? num(m[1]) * 1e-6 : num(m[1]); // «100» без единиц — считаем мкФ
  return num(m[1]) * mulOf(u.replace(/ф|f$/, '') || u);
}

/** Сопротивление где угодно в строке: «MF52 10K», «NTC 4,7 кОм», «GL5528 (10 кОм)». */
export function findOhms(value: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(ком|kohm|k|к|мом|mohm|meg|m|м|ом|ohm|r|ω)(?![a-zа-я])/i.exec(value.replace(/\*/g, ''));
  if (!m) return null;
  const u = m[2].toLowerCase();
  const mul = /^(ком|kohm|k|к)$/.test(u) ? 1e3 : /^(мом|mohm|meg|m|м)$/.test(u) ? 1e6 : 1;
  return num(m[1]) * mul;
}

/** Ток в номинале: «2 А», «500 мА», «F2A», «T315mA». */
export function parseAmps(value: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(ма|ma|а|a)(?![a-zа-я])/i.exec(value);
  if (!m) return null;
  return num(m[1]) * (/^(ма|ma)$/i.test(m[2]) ? 1e-3 : 1);
}

/** Мощность: «5 Вт», «2 ВА», «10W», «3VA». */
export function parseWatts(value: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(вт|w|ва|va)(?![a-zа-я])/i.exec(value);
  return m ? num(m[1]) : null;
}

/** Напряжения трансформатора: «230/12 В», «220V/9V», «230 В → 2×9 В», «9 В». */
export function transformerVolts(value: string): { vp: number; vs: number } {
  const t = value.replace(/,/g, '.');
  const pair = /(\d+(?:\.\d+)?)\s*[вv]?\s*(?:\/|→|->|на)\s*(?:2\s*[x×]\s*)?(\d+(?:\.\d+)?)/i.exec(t);
  if (pair) return { vp: +pair[1], vs: +pair[2] };
  const one = parseVolts(t);
  return { vp: 230, vs: one && one < 100 ? one : 12 };
}

/** Индуктивность: «100 мкГн», «6,8 мкГн 1,5 А», «10mH», «0,8 мГн». */
export function parseHenry(value: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(нгн|nh|мкгн|uh|µh|мгн|mh|гн|h)/i.exec(value);
  if (!m) return null;
  const u = m[2].toLowerCase();
  const mul = /^(нгн|nh)$/.test(u) ? 1e-9 : /^(мкгн|uh|µh)$/.test(u) ? 1e-6 : /^(мгн|mh)$/.test(u) ? 1e-3 : 1;
  return num(m[1]) * mul;
}

/** Напряжение в названии: «12 В», «5V», «9V1» (стабилитрон 9,1 В). */
export function parseVolts(value: string): number | null {
  const code = /(\d+)[vв](\d+)/i.exec(value);
  if (code) return num(`${code[1]}.${code[2]}`);
  const m = /(\d+(?:[.,]\d+)?)\s*(в|v)(?![a-zа-я])/i.exec(value);
  return m ? num(m[1]) : null;
}

export const MOSFETS: [RegExp, MosModel][] = [
  [/IRF840/i, { type: 'n', vth: 3, ron: 0.85, cgs: 1.3e-9 , vds: 500 }],
  [/IRF9640/i, { type: 'p', vth: 3, ron: 0.5, cgs: 1.2e-9 , vds: 200 }],
  [/IRF740/i, { type: 'n', vth: 3, ron: 0.55, cgs: 1.4e-9 , vds: 400 }],
  [/IRF640/i, { type: 'n', vth: 3, ron: 0.18, cgs: 1.3e-9 , vds: 200 }],
  [/IRF540/i, { type: 'n', vth: 3, ron: 0.077, cgs: 1.7e-9 , vds: 100 }],
  [/IRF9540/i, { type: 'p', vth: 3, ron: 0.2, cgs: 1.4e-9 , vds: 100 }],
  [/IRFZ44/i, { type: 'n', vth: 3, ron: 0.0175, cgs: 1.5e-9 , vds: 55 }],
  [/IRLZ44/i, { type: 'n', vth: 1.5, ron: 0.022, cgs: 3.3e-9 , vds: 55 }],
  [/IRF3205/i, { type: 'n', vth: 3, ron: 0.008, cgs: 3.2e-9 , vds: 55 }],
  [/IRF4905/i, { type: 'p', vth: 3, ron: 0.02, cgs: 3.4e-9 , vds: 55 }],
  [/IRF5305/i, { type: 'p', vth: 3, ron: 0.06, cgs: 1.2e-9 , vds: 55 }],
  [/IRLML2502/i, { type: 'n', vth: 0.8, ron: 0.045, cgs: 0.7e-9 , vds: 20 }],
  [/AO3400|SI2302/i, { type: 'n', vth: 1, ron: 0.04, cgs: 0.6e-9 , vds: 30 }],
  [/AO3401|SI2301/i, { type: 'p', vth: 0.9, ron: 0.06, cgs: 0.6e-9 , vds: 30 }],
  [/2N7000|BS170|2N7002/i, { type: 'n', vth: 2.1, ron: 5, cgs: 50e-12 , vds: 60 }],
];

const npn = (beta: number, extra: Partial<BjtModel> = {}): BjtModel => ({ type: 'npn', beta, vbe: 0.65, rbe: 50, vcesat: 0.15, rsat: 1, ...extra });
const pnp = (beta: number, extra: Partial<BjtModel> = {}): BjtModel => ({ type: 'pnp', beta, vbe: 0.65, rbe: 50, vcesat: 0.15, rsat: 1, ...extra });

export const BJTS: [RegExp, BjtModel][] = [
  [/2N5551/i, npn(150, { vceo: 160 })],
  [/2N5401/i, pnp(150, { vceo: 150 })],
  [/C945|S8050|BC(5|8)4[678]|2N2222|2N3904|MMBT3904|SS9014|KT315/i, npn(200, { vceo: 45 })],
  [/A733|S8550|BC(5|8)5[678]|2N2907|2N3906|MMBT3906|SS9015|KT361/i, pnp(200, { vceo: 45 })],
  [/TIP12[012]|BDX53/i, npn(1000, { vbe: 1.3, vcesat: 0.9, rsat: 0.2, rbe: 200, vceo: 80 })],
  [/TIP12[567]|BDX54/i, pnp(1000, { vbe: 1.3, vcesat: 0.9, rsat: 0.2, rbe: 200, vceo: 80 })],
  [/TIP31|TIP41|BD139|D882|KT815|KT817/i, npn(60, { rbe: 10, rsat: 0.2, vcesat: 0.3, vceo: 60 })],
  [/TIP32|TIP42|BD140|B772|KT814|KT816/i, pnp(60, { rbe: 10, rsat: 0.2, vcesat: 0.3, vceo: 60 })],
];

export const DIODES: [RegExp, DiodeModel][] = [
  [/1N4148|LL4148|1N914|BAV|BAS16/i, { vf: 0.65, rd: 5 }],
  [/1N400\d|M7|UF400\d|1N540\d|FR10\d|HER/i, { vf: 0.75, rd: 0.05 }],
  [/SS\d\d|1N58\d\d|SB\d|MBR|BAT|SR\d|SK\d/i, { vf: 0.35, rd: 0.05 }],
];

/** Светодиод по цвету из номинала и описания. */
export function ledModel(text: string): DiodeModel {
  const t = text.toLowerCase();
  if (/син|blue|бел|white|uv|ультраф/.test(t)) return { vf: 2.9, rd: 12, led: /бел|white/.test(t) ? '#f5f5ff' : '#3a8bff' };
  if (/зел|green/.test(t)) return { vf: 2.1, rd: 12, led: '#34c759' };
  if (/жёлт|желт|yellow|оранж|orange|amber/.test(t)) return { vf: 2.0, rd: 12, led: '#ffcc00' };
  if (/ик|ir\b|infra/.test(t)) return { vf: 1.25, rd: 5, led: '#8a0000' };
  return { vf: 1.85, rd: 12, led: '#ff3b30' };
}

export const OPAMPS: [RegExp, OpAmpModel][] = [
  [/MCP60[0-4]\b|MCP601/i, { a0: 3e5, gbw: 2.8e6, hrHi: 0.025, hrLo: 0.025, rout: 50, en: 29e-9 }],
  [/MCP600[1-4]|MCP602/i, { a0: 1e5, gbw: 1e6, hrHi: 0.025, hrLo: 0.025, rout: 50, en: 28e-9 }],
  [/MCP63[0-9]/i, { a0: 3e5, gbw: 24e6, hrHi: 0.02, hrLo: 0.02, rout: 30, en: 13e-9 }],
  [/LM39[37]|LM339|LM2903|LM311/i, { a0: 2e5, gbw: 1e6, hrHi: 0, hrLo: 0.1, rout: 20, en: 0, openCollector: true }],
  [/LM358|LM324|LM2904|LM2902/i, { a0: 1e5, gbw: 1e6, hrHi: 1.5, hrLo: 0.02, rout: 50, en: 40e-9 }],
  [/TL0[78]\d/i, { a0: 2e5, gbw: 3e6, hrHi: 1.5, hrLo: 1.5, rout: 50, en: 18e-9 }],
  [/NE5532|NE5534/i, { a0: 1e5, gbw: 10e6, hrHi: 1.5, hrLo: 1.5, rout: 30, en: 5e-9 }],
  [/OPA2?13[24]|OPA2?1[67]\d/i, { a0: 1e6, gbw: 8e6, hrHi: 0.5, hrLo: 0.5, rout: 30, en: 8e-9 }],
  [/TDA20[35]0|LM1875|LM3886/i, { a0: 3e4, gbw: 3e6, hrHi: 1.5, hrLo: 1.5, rout: 0.1, en: 3e-9 }],
  [/LM741|UA741|К140УД7/i, { a0: 2e5, gbw: 1e6, hrHi: 1.5, hrLo: 1.5, rout: 75, en: 20e-9 }],
  [/OP07/i, { a0: 4e5, gbw: 0.6e6, hrHi: 1.2, hrLo: 1.2, rout: 60, en: 10e-9 }],
  [/CA3140/i, { a0: 1e5, gbw: 4.5e6, hrHi: 1.8, hrLo: 0.1, rout: 60, en: 40e-9 }],
];
/** ОУ по умолчанию (незнакомое название). */
export const OPAMP_DEFAULT: OpAmpModel = { a0: 1e5, gbw: 1e6, hrHi: 0.1, hrLo: 0.1, rout: 50, en: 20e-9 };

/** Линейные стабилизаторы: название → напряжение (если не в названии), перепад, собственный ток. */
export function regulatorModel(value: string): RegModel | null {
  const v = value.toUpperCase();
  // Регулируемые: между выходом и ADJ держат 1,25 В (делитель задаёт выход).
  if (/LM317|LM338|LM350|LM1117-?ADJ|AMS1117-?ADJ|LM2941/.test(v)) return { vout: 1.25, vdrop: /1117/.test(v) ? 1.1 : 1.7, rout: 0.05, iq: 50e-6 };
  let vout: number | null = null;
  const m = /(?:-|V|_)(\d{1,2}(?:[.,]\d)?)(?![\d.])/.exec(v.replace(/^LD1117V/, 'LD1117-'));
  if (/78L?M?(\d\d)|79L?(\d\d)/.test(v)) {
    const x = /7[89]L?M?(\d\d)/.exec(v)!;
    vout = parseInt(x[1], 10);
  } else if (/LD1117V33|HT7333|XC6206P33|MCP1700-33|3302/.test(v)) vout = 3.3;
  else if (m) vout = num(m[1].length === 2 && !m[1].includes('.') && +m[1] >= 18 ? `${m[1][0]}.${m[1][1]}` : m[1]);
  if (vout === null) return null;
  const drop = /1117/.test(v) ? 1.1 : /78|79/.test(v) ? 2 : /LM2931|LP295|MCP1700|HT73|XC6206|LM2941/.test(v) ? 0.3 : /L4940/.test(v) ? 0.5 : 0.4;
  const iq = /LM2931|LP295|MCP1700|HT73|XC6206/.test(v) ? 0.4e-3 : 5e-3;
  return { vout, vdrop: drop, rout: 0.05, iq };
}
