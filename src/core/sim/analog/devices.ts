import type { Device, DeviceView, SimParam } from '../devices';
import type { AnalogSim } from './build';
import type { AnalogPart } from './models';

/*
 * Карточки деталей из аналогового расчёта для панели симуляции и платы: светодиод светится
 * по среднему току, динамик звучит на частоте тока, реле показывает контакты, двигатель —
 * обороты, тумблер и кнопка нажимаются касанием, у датчиков — ползунки (температура, свет,
 * поле). С контроллером они заменяют логические карточки тех же деталей (кнопки остаются
 * логическими — их читает прошивка), без контроллера — единственные.
 */

function toSimParam(q: AnalogPart['params'][number]): SimParam {
  const step = q.options ? 1 : (q.max - q.min) / 200;
  return { key: q.key, label: q.label, value: q.value, min: q.min, max: q.max, step, unit: q.unit, options: q.options };
}

/** Карточки для деталей, у которых есть вид (part.ui) или действия. */
export function analogDevices(a: AnalogSim): Device[] {
  const out: Device[] = [];
  for (const part of a.parts) {
    const ui = part.ui;
    if (!ui && !part.actions) continue;
    const comp = part.comp;
    const id = ui?.kind === 'button' ? `${comp.id}:B` : comp.id;
    const knobs = ui?.knobs ? part.params.filter((q) => ui.knobs!.includes(q.key)) : part.actions ? part.params : [];
    out.push({
      id,
      comp,
      press: ui?.press ? (down) => ui.press!(down) : undefined,
      set: knobs.length ? (k, v) => a.set(comp.id, k, v) : undefined,
      act: part.act ? (k) => part.act!(k) : undefined,
      view: (): DeviceView => {
        if (part.sim === 'dd-coil') {
          // Катушка металлоискателя: цель, глубина, сведение, «провести над целью».
          const [amp, , freq] = part.readings();
          const hz = freq?.value ?? 0;
          return { id, comp: comp.id, ref: comp.ref, kind: 'coil', title: `${comp.ref} катушка DD: ${hz ? `TX ${Math.round(hz)} Гц, ${Math.round((amp?.value ?? 0) * 1000)} мА` : 'передатчик выключен'} · аналоговый расчёт`, params: part.params.map(toSimParam), actions: part.actions, level: part.level?.() };
        }
        const base: DeviceView = { id, comp: comp.id, ref: comp.ref, kind: ui?.kind ?? 'sensor', title: ui?.title?.() ?? `${comp.ref} ${part.kind}` };
        if (!ui) return { ...base, params: knobs.map(toSimParam), actions: part.actions, readings: part.readings().filter((r) => !/[а-я]{4,}/i.test(r.unit)).map((r) => ({ label: r.label, value: r.value, unit: r.unit })) };
        switch (ui.kind) {
          case 'led': {
            const b = ui.brightness?.() ?? 0;
            return { ...base, on: ui.on?.() ?? b > 0.02, brightness: b, color: ui.color };
          }
          case 'buzzer':
            return { ...base, on: ui.on?.() ?? false, hz: ui.hz?.() ?? 0 };
          case 'relay':
            return { ...base, channels: ui.channels?.() ?? [] };
          case 'button':
            return { ...base, pressed: ui.pressed?.() ?? false, toggle: ui.toggle };
          case 'motor':
            return { ...base, params: knobs.map(toSimParam), readings: part.readings().map((r) => ({ label: r.label, value: r.value, unit: r.unit })) };
          default:
            return { ...base, params: knobs.map(toSimParam) };
        }
      },
    });
  }
  return out;
}
