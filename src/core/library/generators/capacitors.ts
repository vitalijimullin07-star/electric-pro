import type { FootprintDef } from '../../model/types';
import { CAT } from '../categories';
import { CHIP_SPECS, chip, tantalum } from './smd';
import { radialBoxCap, radialCap } from './tht';
import { fmtP, twoPadSmd, twoPinTht } from './util';

/* Конденсаторы: SMD керамика, тантал, алюминиевые SMD, электролиты выводные, диски, плёночные и X2. */

const G = {
  smd: 'SMD керамика',
  tant: 'Танталовые SMD',
  alSmd: 'Электролитические SMD',
  alTht: 'Электролитические выводные',
  disc: 'Керамические дисковые',
  film: 'Плёночные и X2',
  other: 'Прочие',
};

/** Алюминиевый SMD электролит (V-chip): квадратное основание со скошенным углом у плюса. */
function smdElectrolytic(D: number, H: number): FootprintDef {
  const S: Record<number, { span: number; pad: [number, number]; base: number }> = {
    4: { span: 4.2, pad: [1.8, 1.4], base: 4.3 },
    5: { span: 5.2, pad: [2.1, 1.6], base: 5.3 },
    6.3: { span: 6.4, pad: [2.4, 1.8], base: 6.6 },
    8: { span: 8.0, pad: [3.0, 2.0], base: 8.3 },
    10: { span: 9.8, pad: [3.5, 2.2], base: 10.3 },
    12.5: { span: 12.0, pad: [4.0, 2.4], base: 13.0 },
    16: { span: 15.5, pad: [4.5, 3.0], base: 17.0 },
  };
  const s = S[D];
  return twoPadSmd({
    id: `CP_Elec_${D}x${H}`,
    name: `Электролит SMD ${D}×${H}`,
    description: `Алюминиевый электролитический конденсатор SMD Ø${D}×${H} мм (V-chip), плюс — вывод 1`,
    category: CAT.C,
    group: G.alSmd,
    refPrefix: 'C',
    span: s.span,
    pad: s.pad,
    body: [s.base, s.base],
    polar: true,
    padNames: ['+', '-'],
    silkBox: true,
    tags: ['electrolytic', 'aluminum', 'vchip'],
    verified: false,
    height: H,
    source: 'Типовые размеры (Panasonic/Nichicon), номинал',
  });
}

/** Дисковый керамический конденсатор стоя. */
function discCap(D: number, P: number, T = 2.5): FootprintDef {
  return twoPinTht({
    id: `C_Disc_D${D}mm_W${T}mm_P${P}mm`,
    name: `Диск Ø${D}, ${fmtP(P)}`,
    description: `Керамический дисковый конденсатор Ø${D} мм, толщина ${T} мм, шаг ${fmtP(P)} мм`,
    category: CAT.C,
    group: G.disc,
    refPrefix: 'C',
    pitch: P,
    drill: P >= 7 ? 1.0 : 0.8,
    pad: P >= 7 ? 2.0 : 1.6,
    body: { len: D, wid: T },
    tags: ['ceramic', 'disc'],
    verified: true,
    height: D + 1,
  });
}

/** Плёночный конденсатор в прямоугольном корпусе (в т. ч. X2). */
function filmCap(P: number, L: number, W: number, H: number, x2 = false): FootprintDef {
  return twoPinTht({
    id: `C_Film_L${L}mm_W${W}mm_P${P}mm${x2 ? '_X2' : ''}`,
    name: `${x2 ? 'X2 ' : 'Плёночный '}${fmtP(P)} мм`,
    description: `${x2 ? 'Помехоподавляющий конденсатор X2 (сетевой)' : 'Плёночный конденсатор'} ${L}×${W}×${H} мм, шаг ${fmtP(P)} мм`,
    category: CAT.C,
    group: G.film,
    refPrefix: 'C',
    pitch: P,
    drill: P >= 15 ? 1.2 : 0.9,
    pad: P >= 15 ? 2.4 : 1.8,
    body: { len: L, wid: W },
    tags: ['film', ...(x2 ? ['x2', 'mains'] : [])],
    verified: false,
    height: H,
  });
}

export function allCapacitors(): FootprintDef[] {
  const out: FootprintDef[] = [];
  out.push({ ...chip('C', { code: '0201', metric: '0603', body: [0.6, 0.3], span: 0.66, pad: [0.4, 0.42], verified: false }), group: G.smd });
  for (const s of CHIP_SPECS) if (s.code !== '2010' && s.code !== '2512') out.push({ ...chip('C', s), group: G.smd });
  out.push(
    { ...chip('C', { code: '1812', metric: '4532', body: [4.5, 3.2], span: 3.9, pad: [1.2, 3.4], verified: false }), group: G.smd },
    { ...chip('C', { code: '2220', metric: '5750', body: [5.7, 5.0], span: 5.1, pad: [1.4, 5.2], verified: false }), group: G.smd },
  );
  for (const k of ['A', 'B', 'C', 'D'] as const) out.push({ ...tantalum(k), group: G.tant });
  out.push(twoPadSmd({ id: 'CP_EIA-7343-43_Kemet-E', name: 'Тантал E', description: 'Танталовый конденсатор, типоразмер E (EIA 7343-43), плюс — вывод 1', category: CAT.C, group: G.tant, refPrefix: 'C', span: 6.4, pad: [2.4, 2.6], body: [7.3, 4.3], polar: true, padNames: ['+', '-'], tags: ['tantalum'], verified: false, height: 4.3 }));
  for (const [d, h] of [
    [4, 5.4],
    [5, 5.4],
    [6.3, 5.4],
    [6.3, 7.7],
    [8, 10.5],
    [10, 10.5],
    [12.5, 13.5],
    [16, 16.5],
  ] as [number, number][])
    out.push(smdElectrolytic(d, h));
  for (const [d, p] of [
    [4, 1.5],
    [5, 2.0],
    [6.3, 2.5],
    [8, 3.5],
    [10, 5.0],
    [12.5, 5.0],
    [13, 5.0],
    [16, 7.5],
    [18, 7.5],
    [22, 10.0],
    [25, 12.5],
    [30, 12.5],
  ] as [number, number][])
    out.push({ ...radialCap(d, p), group: G.alTht });
  out.push(discCap(3, 2.5, 1.5), discCap(4, 2.5, 2), discCap(5, 2.5), discCap(6, 5.0), discCap(7, 5.0), discCap(8, 5.0, 3), discCap(9, 7.5, 3.5), discCap(12, 7.5, 4));
  // Плёночные: маленькие (радиальные прямоугольные) и X2.
  out.push({ ...radialBoxCap(2.5, [3.5, 2.0]), group: G.film }, { ...radialBoxCap(5.0, [5.5, 2.5]), group: G.film }, { ...radialBoxCap(5.08, [7.2, 2.5]), group: G.film }, { ...radialBoxCap(7.5, [10.0, 4.0]), group: G.film }, { ...radialBoxCap(10.0, [13.0, 5.0]), group: G.film }, { ...radialBoxCap(15.0, [18.0, 7.0]), group: G.film });
  out.push(filmCap(10.0, 13.0, 6.0, 12.0, true), filmCap(15.0, 18.0, 8.5, 14.5, true), filmCap(22.5, 26.5, 8.5, 17.0, true), filmCap(27.5, 31.5, 11.0, 21.0, true), filmCap(22.5, 26.0, 10.0, 18.0), filmCap(27.5, 32.0, 13.0, 22.0));
  // Прочие: ионисторы и триммеры.
  out.push(
    twoPinTht({ id: 'C_Supercap_D11.5mm_P5mm', name: 'Ионистор Ø11,5', description: 'Суперконденсатор радиальный Ø11,5 мм (1 Ф 5,5 В), шаг 5 мм, плюс — вывод 1', category: CAT.C, group: G.other, refPrefix: 'C', pitch: 5.0, drill: 1.0, pad: 2.0, body: { d: 11.5, at: 2.5 }, polar: true, padNames: ['+', '-'], tags: ['supercap', 'edlc'], verified: false, height: 20 }),
    twoPinTht({ id: 'C_Supercap_Coin_5.5V_P5.08mm', name: 'Ионистор монета 5,5 В', description: 'Суперконденсатор монетного типа 5,5 В (0,1–1 Ф), горизонтальный, два вывода стоя, шаг 5,08 мм', category: CAT.C, group: G.other, refPrefix: 'C', pitch: 5.08, drill: 0.9, pad: 1.8, body: { len: 20.5, wid: 5.0 }, polar: true, padNames: ['+', '-'], tags: ['supercap', 'coin'], verified: false, height: 21 }),
    twoPinTht({ id: 'C_Trimmer_Ceramic_D6mm_P5mm', name: 'Триммер Ø6', description: 'Подстроечный керамический конденсатор Ø6 мм (5–20 пФ), шаг 5 мм', category: CAT.C, group: G.other, refPrefix: 'C', pitch: 5.0, drill: 0.8, pad: 1.6, body: { d: 6.5, at: 0 }, tags: ['trimmer'], verified: false, height: 4 }),
  );
  return out;
}
