import { describe, expect, test } from 'vitest';
import { libraryFootprint, libraryFootprints } from '../src/core/library';
import { textWidth } from '../src/core/render/stroke-font';

const silkLabels = (id: string) => libraryFootprint(id)!.graphics.filter((g) => g.kind === 'text' && g.layer === 'F.Silk' && !g.text.includes('${'));

describe('распиновка на шелкографии', () => {
  test('микросхемы с распиновкой: имена по даташиту, подпись у каждого вывода', () => {
    const ne555 = libraryFootprint('IC_NE555_DIP-8')!;
    expect(ne555.pads.map((p) => p.name)).toEqual(['GND', 'TRIG', 'OUT', 'RST', 'CTRL', 'THR', 'DIS', 'VCC']);
    expect(silkLabels('IC_NE555_DIP-8').map((g) => (g.kind === 'text' ? g.text : '')).sort()).toEqual(['CTRL', 'DIS', 'GND', 'OUT', 'RST', 'THR', 'TRIG', 'VCC']);
    const m328 = libraryFootprint('IC_ATmega328P_DIP-28')!;
    expect(m328.pads.find((p) => p.number === '19')!.name).toBe('D13');
    expect(libraryFootprint('REG_7805_TO-220')!.pads.map((p) => p.name)).toEqual(['IN', 'GND', 'OUT']);
  });

  test('модули: у каждого именованного вывода есть подпись, подписи не залезают на площадки', () => {
    const mods = libraryFootprints().filter((f) => f.id.startsWith('Module_KY') || f.id.startsWith('Module_MQ') || f.id === 'Module_Arduino_Nano' || f.id === 'Module_HC-SR04');
    expect(mods.length).toBeGreaterThan(40);
    for (const f of mods) {
      const labels = f.graphics.filter((g) => g.kind === 'text' && g.layer === 'F.Silk' && !g.text.includes('${'));
      const named = f.pads.filter((p) => p.type !== 'npth' && p.name && p.name !== p.number);
      expect(labels.length, f.id).toBe(named.length);
      for (const g of labels) {
        if (g.kind !== 'text') continue;
        expect(g.size, f.id).toBeGreaterThanOrEqual(0.8);
        const w = textWidth(g.text, g.size) / 2;
        const h = g.size / 2;
        const [hx, hy] = g.rotation === 90 ? [h, w] : [w, h];
        for (const p of f.pads) {
          const inside = Math.abs(p.at.x - g.at.x) < hx + p.size.x / 2 && Math.abs(p.at.y - g.at.y) < hy + p.size.y / 2;
          expect(inside, `${f.id}: «${g.text}» на площадке ${p.number}`).toBe(false);
        }
      }
    }
  });

  test('большой набор модулей для Arduino', () => {
    const ids = new Set(libraryFootprints().map((f) => f.id));
    for (const id of ['Module_Arduino_Uno_R3_Shield', 'Module_KY-040', 'Module_HC-SR04', 'Module_MQ-135', 'Module_HX711', 'Module_DFPlayer_Mini', 'Module_TFT_2.8_ILI9341_Touch', 'Module_RS485_MAX485', 'Module_HLK-PM12']) expect(ids.has(id), id).toBe(true);
    expect(libraryFootprints().filter((f) => f.id.startsWith('Module_')).length).toBeGreaterThan(200);
  });
});
