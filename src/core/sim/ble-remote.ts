import type { Component } from '../model/types';
import type { Device, SimParam } from './devices';
import type { Esp32 } from './esp32';

/*
 * Беспроводной пульт пылесоса «S3» (firmware/vacuum-remote, ESP32-C3) в симуляции: те же
 * посылки, что уходят в эфир рекламой Bluetooth, — «VR» с номером пульта, счётчиком, событием
 * и подписью SipHash-2-4, «VP» — привязка (ключ). Контроллер получает их через vac_remote().
 */

const MASK = (1n << 64n) - 1n;
const rotl = (x: bigint, b: bigint) => ((x << b) | (x >> (64n - b))) & MASK;

function le64(p: Uint8Array, o: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(p[o + i]);
  return v;
}

/** SipHash-2-4 (как siphash24 в vac_drv.c): 64 бита. */
export function siphash24(key: Uint8Array, data: Uint8Array): bigint {
  const k0 = le64(key, 0);
  const k1 = le64(key, 8);
  let v0 = 0x736f6d6570736575n ^ k0;
  let v1 = 0x646f72616e646f6dn ^ k1;
  let v2 = 0x6c7967656e657261n ^ k0;
  let v3 = 0x7465646279746573n ^ k1;
  const round = () => {
    v0 = (v0 + v1) & MASK;
    v1 = rotl(v1, 13n) ^ v0;
    v0 = rotl(v0, 32n);
    v2 = (v2 + v3) & MASK;
    v3 = rotl(v3, 16n) ^ v2;
    v0 = (v0 + v3) & MASK;
    v3 = rotl(v3, 21n) ^ v0;
    v2 = (v2 + v1) & MASK;
    v1 = rotl(v1, 17n) ^ v2;
    v2 = rotl(v2, 32n);
  };
  const full = data.length & ~7;
  for (let i = 0; i < full; i += 8) {
    const m = le64(data, i);
    v3 ^= m;
    round();
    round();
    v0 ^= m;
  }
  let b = BigInt(data.length) << 56n;
  for (let i = 0; i < (data.length & 7); i++) b |= BigInt(data[full + i]) << BigInt(8 * i);
  v3 ^= b;
  round();
  round();
  v0 ^= b;
  v2 ^= 0xffn;
  for (let i = 0; i < 4; i++) round();
  return (v0 ^ v1 ^ v2 ^ v3) & MASK;
}

const put32 = (p: Uint8Array, o: number, v: number) => {
  for (let i = 0; i < 4; i++) p[o + i] = (v >>> (8 * i)) & 0xff;
};

/** События пульта (как в vac_link.c). */
export const REMOTE_EVENTS = { b1: 1, b1h: 2, b2: 3, b2h: 4, enc: 5, sw: 6 } as const;

export class BleRemote {
  readonly id: number;
  readonly key = new Uint8Array(16);
  counter = 0;
  sent = 0;
  private last: Uint8Array | null = null;
  readonly params: SimParam[] = [
    { key: 'rssi', label: 'сигнал (расстояние)', value: -60, min: -95, max: -35, step: 1, unit: 'дБм' },
    { key: 'forge', label: 'подпись', value: 0, min: 0, max: 1, step: 1, unit: '', options: ['своя', 'чужой ключ (проверка защиты)'] },
  ];

  constructor(private esp: Esp32, seed = 0x5ec0de) {
    // Номер и ключ — детерминированные (тесты повторяемы), как у пульта после первого включения.
    let x = seed >>> 0;
    const rnd = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0), x >>> 24);
    this.id = ((rnd() << 24) | (rnd() << 16) | (rnd() << 8) | rnd()) >>> 0;
    for (let i = 0; i < 16; i++) this.key[i] = rnd();
  }

  private get rssi(): number {
    return this.params[0].value;
  }

  /** Событие: посылка «VR» с новым счётчиком. */
  send(ev: number, arg = 0): void {
    const p = new Uint8Array(17);
    p.set([0x56, 0x52, 1]);
    this.counter++;
    put32(p, 3, this.id);
    put32(p, 7, this.counter);
    p[11] = ev;
    p[12] = arg & 0xff;
    const key = this.params[1].value ? this.key.map((b) => b ^ 0x5a) : this.key;
    put32(p, 13, Number(siphash24(key, p.subarray(3, 13)) & 0xffffffffn));
    this.last = p;
    this.sent++;
    this.esp.remote(p, this.rssi);
  }

  /** Повтор последней посылки как есть (перехват и повтор — должен отбрасываться). */
  replay(): void {
    if (this.last) this.esp.remote(this.last, this.rssi);
  }

  /** Привязка: обе кнопки 5 с — пульт шлёт свой номер и ключ слабым сигналом (рядом с контроллером на 20 дБ сильнее). */
  pair(): void {
    const p = new Uint8Array(23);
    p.set([0x56, 0x50, 1]);
    put32(p, 3, this.id);
    p.set(this.key, 7);
    this.esp.remote(p, Math.min(-35, this.rssi + 20));
  }

  device(comp: Component): Device {
    const id = `${comp.id}:remote`;
    const act = (k: string) => {
      if (k === 'pair') this.pair();
      else if (k === 'replay') this.replay();
      else if (k === 'enc+') this.send(REMOTE_EVENTS.enc, 1);
      else if (k === 'enc-') this.send(REMOTE_EVENTS.enc, -1);
      else if (k in REMOTE_EVENTS) this.send(REMOTE_EVENTS[k as keyof typeof REMOTE_EVENTS]);
    };
    return {
      id,
      comp,
      act,
      set: (k, v) => {
        const pp = this.params.find((x) => x.key === k);
        if (pp) pp.value = v;
      },
      view: () => ({
        id,
        comp: comp.id,
        ref: comp.ref,
        kind: 'remote',
        title: `${comp.ref} беспроводной пульт (Bluetooth, номер ${this.id.toString(16).toUpperCase().padStart(8, '0')})`,
        params: this.params,
        readings: [{ label: 'посылок', value: this.sent, unit: '' }],
        actions: [
          { key: 'b1', label: 'Кнопка 1: пуск/стоп' },
          { key: 'b1h', label: 'Кнопка 1 держать: очистка' },
          { key: 'b2', label: 'Кнопка 2: турбина 2' },
          { key: 'b2h', label: 'Кнопка 2 держать: авто/ручной' },
          { key: 'enc-', label: 'Энкодер −' },
          { key: 'enc+', label: 'Энкодер +' },
          { key: 'sw', label: 'Нажать энкодер: очистка' },
          { key: 'pair', label: 'Привязка (обе кнопки 5 с)' },
          { key: 'replay', label: 'Повтор старой посылки' },
        ],
      }),
    };
  }
}
