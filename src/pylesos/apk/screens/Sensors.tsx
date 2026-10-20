/*
 * Датчики: все показания пылесоса по группам — воздух (BME280: температура, влажность, давление и что из них
 * следует), турбины, воздушный тракт, сеть, бак, счётчики. У величин с записью — график за 10 минут;
 * нажатие открывает её на «Графиках».
 */
import { useMemo } from 'react';
import type { VacStatus } from '../../protocol';
import type { Ctx } from '../ctx';
import { SERIES_BY_KEY, fmt, type Sample } from '../history';
import { pickSeries } from './Charts';

interface Item {
  label: string;
  value: number | null;
  /** Не число, а слово («сухо», «бак полон»). */
  text?: string;
  unit: string;
  dec?: number;
  /** Ключ величины в записи (SERIES) — будет график. */
  series?: string;
  tone?: 'ok' | 'warn' | 'bad';
  hint?: string;
}

const WATER = ['сухо', 'вода есть', 'бак полон', 'перелив'];

/** Давление насыщенного пара, Па (формула Магнуса). */
const pSat = (t: number) => 610.94 * Math.exp((17.625 * t) / (t + 243.04));

/** Плотность влажного воздуха, кг/м³. */
export function airDensity(t: number, hpa: number, rh: number): number {
  const pv = (rh / 100) * pSat(t);
  const tk = t + 273.15;
  return (hpa * 100 - pv) / (287.05 * tk) + pv / (461.5 * tk);
}

/** Точка росы, °C. */
export function dewPoint(t: number, rh: number): number {
  const g = Math.log(Math.max(rh, 1) / 100) + (17.625 * t) / (243.04 + t);
  return (243.04 * g) / (17.625 - g);
}

function groups(s: VacStatus): { title: string; note?: string; items: Item[] }[] {
  const air = s.air ?? 0;
  const kg = s.kg !== undefined && s.kg >= 0 ? s.kg / 10 : null;
  const hot = (t: number) => (t >= 100 ? 'bad' : t >= 85 ? 'warn' : undefined);
  const out: { title: string; note?: string; items: Item[] }[] = [];
  if (air && s.ta !== undefined && s.pa !== undefined) {
    const rh = air === 2 && s.rh !== undefined ? s.rh : null;
    out.push({
      title: air === 2 ? 'Воздух · BME280' : 'Воздух · BMP280 (без влажности)',
      items: [
        { label: 'Температура', value: s.ta, unit: '°C', dec: 1, series: 'ta' },
        { label: 'Влажность', value: rh, unit: '%', series: 'rh', tone: rh !== null && rh >= 85 ? 'warn' : undefined },
        { label: 'Давление', value: s.pa, unit: 'гПа', dec: 1, series: 'pa', hint: `${fmt(s.pa * 0.750062)} мм рт. ст.` },
        { label: 'Плотность', value: airDensity(s.ta, s.pa, rh ?? 0), unit: 'кг/м³', dec: 3, hint: 'для расчёта расхода' },
        ...(rh !== null ? [{ label: 'Точка росы', value: dewPoint(s.ta, rh), unit: '°C', dec: 1, hint: 'ниже — конденсат на холодном' }] : []),
      ],
    });
  } else
    out.push({
      title: 'Воздух',
      note: 'Датчика BME280 нет. Модуль GY-BME280 — на шину I²C вместе с SDP811 (клеммник X25): VIN — 3,3 В, GND, SCL, SDA; адрес 0x76. Пылесос найдёт его сам в течение 30 с.',
      items: [],
    });
  out.push({
    title: 'Турбины',
    items: [
      { label: 'Т1 · температура', value: s.t1, unit: '°C', series: 't1', tone: hot(s.t1) },
      { label: 'Т2 · температура', value: s.t2, unit: '°C', series: 't2', tone: hot(s.t2) },
      { label: 'Т1 · мощность', value: s.w1 ?? null, unit: 'Вт', series: 'w1', hint: s.en1 ? `задано ${fmt(s.p1)} %` : 'выключена' },
      { label: 'Т2 · мощность', value: s.w2 ?? null, unit: 'Вт', series: 'w2', hint: s.en2 ? `задано ${fmt(s.p2)} %` : 'выключена' },
      { label: 'Т1 · ток', value: s.i1, unit: 'А', dec: 2, series: 'i1' },
      { label: 'Т2 · ток', value: s.i2, unit: 'А', dec: 2, series: 'i2' },
      { label: 'Т1 · наработка', value: s.h1, unit: 'ч', dec: 1 },
      { label: 'Т2 · наработка', value: s.h2, unit: 'ч', dec: 1 },
    ],
  });
  out.push({
    title: 'Воздушный тракт',
    items: [
      { label: 'Разрежение', value: s.vacuum, unit: 'кПа', dec: 2, series: 'vacuum' },
      { label: 'Расход', value: s.flow, unit: 'л/с', dec: 1, series: 'flow', hint: s.mode ? `уставка ${fmt(s.sp)} л/с` : undefined },
      { label: 'Скорость в шланге', value: s.speed, unit: 'м/с', dec: 1, series: 'speed', hint: s.hosemm ? `шланг ${fmt(s.hosemm)} мм` : undefined },
      { label: 'Перепад на фильтре', value: s.filter, unit: 'Па', series: 'filter' },
      { label: 'Фильтр R', value: s.r || null, unit: '', dec: 2, series: 'r', hint: s.rnew ? `новый ${fmt(s.rnew, 2)}` : undefined },
      { label: 'Загрузка фильтра', value: s.load, unit: '%', series: 'load', tone: s.load >= 90 ? 'warn' : undefined },
      { label: 'Фильтр клапанов', value: s.intake, unit: '%', series: 'intake', tone: s.intake && s.intake < 60 ? 'warn' : undefined, hint: 'сила удара от чистого' },
    ],
  });
  out.push({
    title: 'Сеть и инструмент',
    items: [
      { label: 'Напряжение', value: s.mains, unit: 'В', series: 'mains', tone: s.mains && (s.mains < 190 || s.mains > 250) ? 'warn' : undefined },
      { label: 'Ток всего', value: s.itotal, unit: 'А', dec: 1, series: 'itotal' },
      { label: 'Ток инструмента', value: s.itool, unit: 'А', dec: 2, series: 'itool', hint: s.tool ? 'инструмент работает' : 'инструмент стоит' },
      { label: 'Мощность всего', value: s.w1 !== undefined ? (s.w1 ?? 0) + (s.w2 ?? 0) : null, unit: 'Вт' },
    ],
  });
  out.push({
    title: 'Бак',
    items: [
      { label: 'Вода', value: null, text: WATER[s.water] ?? '—', unit: '', tone: s.water > 1 ? 'warn' : undefined, hint: s.float ? 'поплавок всплыл' : undefined },
      { label: 'Масса в баке', value: kg, unit: 'кг', dec: 1, series: 'kg', hint: kg === null ? 'весов нет' : undefined },
      { label: 'Электрод уровня', value: s.e1 ?? null, unit: 'мВ' },
      { label: 'Электрод перелива', value: s.e2 ?? null, unit: 'мВ' },
    ],
  });
  out.push({
    title: 'Счётчики',
    items: [
      { label: 'Ударов всего', value: s.pulses, unit: '' },
      { label: 'Ударов по фильтру', value: s.fpulses, unit: '' },
      { label: 'Работа фильтра', value: s.fwork, unit: 'ч', dec: 1 },
      { label: 'Моек фильтра', value: s.washes, unit: '' },
    ],
  });
  return out;
}

export function Sensors(c: Ctx) {
  const data = useMemo(() => c.ring.since(600), [c.ring, c.tick]);
  return (
    <div className="screen">
      <header className="bar">
        <h1 className="grow">Датчики</h1>
        <span className="muted small">нажмите — график</span>
      </header>
      {groups(c.s).map((g) => (
        <section key={g.title} className="stack tight">
          <div className="group">{g.title}</div>
          {g.note && <div className="card small muted">{g.note}</div>}
          {g.items.length > 0 && (
            <div className="grid2">
              {g.items.map((it) => (
                <Sensor key={it.label} it={it} data={data} onOpen={it.series ? () => (pickSeries(it.series!), c.go('charts')) : undefined} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function Sensor({ it, data, onOpen }: { it: Item; data: Sample[]; onOpen?: () => void }) {
  const text = it.text ?? (it.value === null || !Number.isFinite(it.value) ? '—' : fmt(it.value, it.dec ?? 0));
  const body = (
    <>
      <div className="tile-l">{it.label}</div>
      <div className={`tile-v ${it.text && it.tone ? it.tone : ''}`}>
        {text} {it.unit && !it.text && <span className={`tile-u ${it.tone ?? ''}`}>{it.unit}</span>}
      </div>
      {it.series && data.length > 1 && <Spark data={data} k={it.series} />}
      {it.hint && <div className="tile-h">{it.hint}</div>}
    </>
  );
  return onOpen ? (
    <button type="button" className="tile sensor" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="tile sensor">{body}</div>
  );
}

const AIR = new Set(['ta', 'rh', 'pa']);

/** Маленький график за 10 минут (свой масштаб). */
function Spark({ data, k }: { data: Sample[]; k: string }) {
  const s = SERIES_BY_KEY[k];
  if (!s) return null;
  const W = 120;
  const H = 26;
  // Воздух: 0 — датчик ещё не прочитан (выборки до первого замера не рисуем).
  if (AIR.has(k)) data = data.filter((d) => s.get(d.v) !== 0);
  if (data.length < 2) return null;
  const step = Math.max(1, Math.floor(data.length / 120));
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of data) {
    const v = s.get(d.v);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // Масштаб не меньше десятой части величины: 0,1 °C при 25 °C — почти прямая, а не обрыв.
  const rng = Math.max(hi - lo, 0.1 * Math.max(Math.abs(hi), Math.abs(lo), 1));
  lo = (lo + hi) / 2 - rng / 2;
  hi = lo + rng;
  const t0 = data[0].t;
  const span = Math.max(1, data[data.length - 1].t - t0);
  const pts: string[] = [];
  for (let i = 0; i < data.length; i += step) pts.push(`${(((data[i].t - t0) / span) * W).toFixed(1)},${(H - 2 - ((s.get(data[i].v) - lo) / (hi - lo)) * (H - 4)).toFixed(1)}`);
  return (
    <svg className="spark" width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke={s.color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" points={pts.join(' ')} />
    </svg>
  );
}
