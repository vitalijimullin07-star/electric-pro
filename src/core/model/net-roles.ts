import { netClassOf, requiredClearance } from './rules';
import type { Id, NetRole, Project } from './types';

/*
 * Роли цепей для расстановки и трассировки: сеть 230 В (держать отдельно, большой зазор),
 * питание и силовые (шире, короче), помехоопасные (ШИМ, ключи, кварц, тактовые — короче и
 * подальше от чувствительных), чувствительные (аналог, датчики, опорное напряжение).
 * Роль задаётся у цепи явно (Net.role) или угадывается по классу, имени и деталям.
 */

export const ROLE_TITLES: Record<NetRole, string> = {
  hv: 'Сеть 230 В',
  power: 'Питание и силовые',
  noisy: 'Помехоопасные',
  sensitive: 'Чувствительные',
  signal: 'Обычные',
};

export const ROLE_HINTS: Record<NetRole, string> = {
  hv: 'держатся отдельной зоной, зазор до остального — по классу Mains',
  power: 'дорожки шире (класс Power), земля — заливкой, если есть полигон',
  noisy: 'ШИМ, ключи, кварц, тактовые: короче и подальше от чувствительных',
  sensitive: 'аналог, датчики, АЦП, опорное: подальше от помехоопасных',
  signal: 'без особых требований',
};

const HV_NAME = /^(~?230.*|MAINS.*|L|N|PE|L\d?_?(IN|F|OUT)?|N\d?_?(IN|OUT)?|LINE|NEUTRAL|AC_?L|AC_?N|ФАЗА|НОЛЬ|СЕТЬ.*)$/i;
const POWER_NAME = /^([+-]?\d+(V|В)\d*|[+-]?\d+V\d*_?\w*|3V3|5V|12V|24V|GND\w*|[AD]GND|PGND|VCC\w*|VDD\w*|AVCC|AVDD|VSS|VEE|VIN|VBAT|VBUS|VMOT|VM|V\+|V-|ЗЕМЛЯ|ПИТ\w*)$/i;
const NOISY_NAME = /(PWM|ШИМ|GATE|^G\d+$|_G$|DRV|DRIVE|^SW\d*$|CLK|SCK|SCL|XTAL|XT[12]|OSC|QUARTZ|КВАРЦ|STEP|DIR|MOT|BZ|BUZ|ZC|TX|MOSI|_LED$|^LED\d*$|RELAY|РЕЛЕ)/i;
const SENSITIVE_NAME = /(ADC|AIN|^A\d+$|ANALOG|АНАЛОГ|SENS|ДАТЧ|NTC|THERM|^CT\d|_CT$|VREF|AREF|REF$|^REF|MIC|VAC|TEMP|^FB\d*$|_FB$|VMID|OPAMP|IN[+-]$|^INP|^INN|HALL|LDR|PT100|LOAD)/i;

/** Угаданная роль цепи (без учёта явной). */
export function guessRole(p: Project, netId: Id): NetRole {
  const net = p.nets[netId];
  if (!net) return 'signal';
  const name = net.name.trim();
  const cls = netClassOf(p, netId);
  // Класс с особым зазором до остальных (например, 6 мм у Mains) или имя класса про сеть.
  const others = Object.values(p.netClasses).filter((c) => c.name !== cls.name);
  // Особый класс — с большим зазором до всех остальных (6 мм у Mains до «*»), а не любой класс рядом с ним.
  const bigGap = others.length > 0 && others.every((o) => requiredClearance(p.rules, cls, o) >= 2.5);
  if (/mains|230|hv|сеть/i.test(cls.name) || bigGap || HV_NAME.test(name)) return 'hv';
  if (POWER_NAME.test(name)) return 'power';
  // По деталям: вывод кварца, затвор ключа, узел дросселя — помехоопасные; термистор, опорное — чувствительные.
  let noisy = false;
  let sensitive = false;
  for (const c of Object.values(p.components)) {
    const fp = p.footprints[c.footprint];
    const tags = fp?.tags ?? [];
    for (const [pad, n] of Object.entries(c.padNets)) {
      if (n !== netId) continue;
      const padName = fp?.pads.find((q) => q.number === pad)?.name ?? pad;
      if (tags.includes('crystal')) noisy = true;
      if ((tags.includes('mosfet') || tags.includes('triac') || tags.includes('igbt')) && /^G/i.test(padName)) noisy = true;
      if (tags.includes('inductor') && !POWER_NAME.test(name) && switching(p, netId)) noisy = true;
      if (tags.includes('ntc') || tags.includes('thermistor') || tags.includes('opamp') || tags.includes('current')) sensitive = true;
    }
  }
  if (NOISY_NAME.test(name)) return 'noisy';
  if (SENSITIVE_NAME.test(name)) return 'sensitive';
  if (noisy) return 'noisy';
  if (sensitive) return 'sensitive';
  if (cls.name === 'Power') return 'power';
  return 'signal';
}

/** Узел импульсного преобразователя: к цепи подключены дроссель и диод или микросхема преобразователя. */
function switching(p: Project, netId: Id): boolean {
  for (const c of Object.values(p.components)) {
    const tags = p.footprints[c.footprint]?.tags ?? [];
    if (!Object.values(c.padNets).includes(netId)) continue;
    if (tags.includes('diode') || tags.includes('buck') || tags.includes('dc-dc') || tags.includes('regulator')) return true;
  }
  return false;
}

/** Роль цепи: явная или угаданная. */
export function roleOf(p: Project, netId: Id): NetRole {
  return p.nets[netId]?.role ?? guessRole(p, netId);
}

export type RoleSets = Record<NetRole, Id[]>;

/** Цепи по ролям (только цепи, у которых есть хотя бы два вывода на плате). */
export function netsByRole(p: Project): RoleSets {
  const pins = new Map<Id, number>();
  for (const c of Object.values(p.components)) {
    if (c.offBoard) continue;
    for (const n of Object.values(c.padNets)) pins.set(n, (pins.get(n) ?? 0) + 1);
  }
  const out: RoleSets = { hv: [], power: [], noisy: [], sensitive: [], signal: [] };
  for (const id of Object.keys(p.nets)) if ((pins.get(id) ?? 0) >= 2) out[roleOf(p, id)].push(id);
  for (const k of Object.keys(out) as NetRole[]) out[k].sort((a, b) => p.nets[a].name.localeCompare(p.nets[b].name, 'ru', { numeric: true }));
  return out;
}
