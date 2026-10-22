import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { checkFirmware, parseImage, sha256 } from '../src/pylesos/apk/fw-check';

const file = (p: string) => new Uint8Array(readFileSync(p));
const part8 = file('firmware/vacuum-s3/flash/partitions-8m.bin');
const part16 = file('firmware/vacuum-s3/flash/partitions-16m.bin');
const app = file('import/vacuum-s3-app.bin');
const ver = /VAC_VERSION "([\d.]+)"/.exec(readFileSync('firmware/vacuum-s3/vac_core.h', 'utf8'))![1];

describe('Проверка файла прошивки перед записью по кабелю (APK)', () => {
  test('SHA-256 как у node:crypto', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 100_003]) {
      const d = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
      expect(Buffer.from(sha256(d)).toString('hex')).toBe(createHash('sha256').update(d).digest('hex'));
    }
  });

  test('программа контроллера: образ ESP32-S3, сумма и SHA-256 сходятся, версия из метки, влезает в раздел', () => {
    const im = parseImage(app);
    expect(typeof im).not.toBe('string');
    const r = checkFirmware(app, { flashMb: 8, partitions: part8, boardVer: '6.2' });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('app');
    expect(r.ver).toBe(ver);
    expect(r.app!.length).toBe(app.length);
    expect(r.items.some((i) => /SHA-256 сходятся/.test(i.text))).toBe(true);
    expect(r.items.some((i) => i.text.includes(`6.2 → будет ${ver}`))).toBe(true);
    expect(r.items.every((i) => i.level === 'ok')).toBe(true);
  });

  test('файл «целиком» 16 МБ: берётся только программа (та же, что app.bin); под 8 МБ — предупреждение', () => {
    const merged = file('import/vacuum-s3-proshivka.bin');
    const r16 = checkFirmware(merged, { flashMb: 16, partitions: part16 });
    expect(r16.ok).toBe(true);
    expect(r16.kind).toBe('merged');
    expect(Buffer.from(r16.app!).equals(Buffer.from(app))).toBe(true);
    expect(r16.items.some((i) => i.level === 'warn')).toBe(false);
    const r8 = checkFirmware(merged, { flashMb: 8, partitions: part8 });
    expect(r8.ok).toBe(true);
    expect(r8.items.some((i) => i.level === 'warn' && /под флеш 16 МБ/.test(i.text))).toBe(true);
  });

  test('откат на старую версию — предупреждение', () => {
    const r = checkFirmware(app, { flashMb: 8, partitions: part8, boardVer: '99.0' });
    expect(r.ok).toBe(true);
    expect(r.items.some((i) => i.level === 'warn' && /откат/.test(i.text))).toBe(true);
  });

  test('отказ: испорченный, обрезанный, прошивка пульта, другой чип, не образ, архив', () => {
    const broken = app.slice();
    broken[app.length >> 1] ^= 0x40;
    expect(checkFirmware(broken, { flashMb: 8, partitions: part8 }).items.at(-1)!.text).toMatch(/испорчен/);
    expect(checkFirmware(app.subarray(0, app.length - 5000), { flashMb: 8, partitions: part8 }).items.at(-1)!.text).toMatch(/обрезан/);
    const panel = checkFirmware(file('import/vacuum-panel-app.bin'), { flashMb: 8, partitions: part8 });
    expect(panel.ok).toBe(false);
    expect(panel.items.at(-1)!.text).toMatch(/экрана \(пульта/);
    const c3 = checkFirmware(file('import/vacuum-remote-proshivka.bin'), { flashMb: 8, partitions: part8 });
    expect(c3.ok).toBe(false);
    expect(c3.items.at(-1)!.text).toMatch(/ESP32-C3/);
    expect(checkFirmware(part8, { flashMb: 8, partitions: part8 }).ok).toBe(false);
    const zip = new Uint8Array(4096);
    zip.set([0x50, 0x4b, 3, 4]);
    expect(checkFirmware(zip, { flashMb: 8, partitions: part8 }).items[0].text).toMatch(/архив ZIP/);
  });

  test('чужая прошивка ESP32-S3 без метки: отказ, а с разрешением — предупреждение', () => {
    // Метку портим — остальное (сумма, SHA-256) пересчитываем, чтобы образ был целым.
    const a = app.slice();
    const mark = Buffer.from(a).indexOf('VACFW:S3-CTRL:');
    a[mark] = 'X'.charCodeAt(0);
    const im = parseImage(a) as { length: number };
    let p = 24;
    let sum = 0xef;
    for (let i = 0; i < a[1]; i++) {
      const len = new DataView(a.buffer).getUint32(p + 4, true);
      for (let k = p + 8; k < p + 8 + len; k++) sum ^= a[k];
      p += 8 + len;
    }
    p = (p + 16) & ~15;
    a[p - 1] = sum;
    a.set(sha256(a.subarray(0, p)), p);
    expect(im.length).toBe(p + 32);
    expect(checkFirmware(a, { flashMb: 8, partitions: part8 }).ok).toBe(false);
    const r = checkFirmware(a, { flashMb: 8, partitions: part8, allowForeign: true });
    expect(r.ok).toBe(true);
    expect(r.items.some((i) => i.level === 'warn' && /Чужая/.test(i.text))).toBe(true);
  });
});

/** Плата на кабеле: до перезапуска молчит (осталась в загрузчике), после — отвечает кодом. */
function fakeBoard() {
  let alive = false;
  const sent: string[] = [];
  const g = globalThis as unknown as { __vac?: (s: string) => void };
  const emit = (o: object) => setTimeout(() => g.__vac?.(JSON.stringify(o)), 5);
  const rx = (t: string) => emit({ t: 'usb', rx: Buffer.from(t).toString('base64') });
  const api = {
    ready: () => '{}',
    usbOpen: () => emit({ t: 'usb', s: 'open' }),
    usbReopen: () => {
      alive = true;
      emit({ t: 'usb', s: 'open' });
      rx('ESP-ROM:esp32s3-20210327\r\nrst:0x15 (USB_UART_CHIP_RESET),boot:0x8 (SPI_FAST_FLASH_BOOT)\r\nКонтроллер пылесоса S3 6.3 (плата на модулях), ESP32-S3. Команды: help\r\n');
    },
    usbWrite: (b64: string) => {
      const line = Buffer.from(b64, 'base64').toString();
      sent.push(line);
      if (alive && line === 'ble code\n') rx('Код для телефона: 482915 (Android спросит его при первом подключении по Bluetooth)\n');
      return true;
    },
    usbLines: () => {},
    usbClose: () => {},
  };
  return { api, sent };
}

describe('Кабель: код Bluetooth и вывод платы', () => {
  test('плата молчит — перезапуск линией RTS и код со второго раза', async () => {
    const { api, sent } = fakeBoard();
    (globalThis as unknown as { PylesosNative?: unknown }).PylesosNative = api;
    vi.resetModules();
    const { readBleCode } = await import('../src/pylesos/apk/usb');
    const log: string[] = [];
    const code = await readBleCode(api as never, (l) => log.push(l));
    expect(code).toBe('482915');
    expect(log).toContain('Перезапускаю плату и спрашиваю ещё раз…');
    expect(sent.filter((l) => l === 'ble code\n').length).toBeGreaterThan(2);
  }, 20000);

  test('что пишет плата: вывод при запуске и итог', async () => {
    const { api } = fakeBoard();
    (globalThis as unknown as { PylesosNative?: unknown }).PylesosNative = api;
    vi.resetModules();
    const { bootLog, bootDiagnosis } = await import('../src/pylesos/apk/usb');
    const log: string[] = [];
    expect(await bootLog(api as never, (l) => log.push(l))).toBe('Прошивка пылесоса запустилась');
    expect(log.some((l) => l.startsWith('ESP-ROM:esp32s3'))).toBe(true);
    expect(bootDiagnosis('rst:0x1 (POWERON),boot:0x0 (DOWNLOAD(USB/UART0))\nwaiting for download')).toMatch(/режиме прошивки/);
    expect(bootDiagnosis('Guru Meditation Error: Core  1 panic')).toMatch(/падает/);
    delete (globalThis as unknown as { PylesosNative?: unknown }).PylesosNative;
  }, 20000);
});
