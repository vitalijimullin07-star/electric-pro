/*
 * Прошивка в формате Intel HEX (так её выдаёт Arduino IDE: «Скетч → Экспорт бинарного файла»)
 * → образ флеш-памяти.
 */

export function parseHex(text: string, size = 0x8000): Uint8Array {
  const flash = new Uint8Array(size).fill(0xff);
  let base = 0;
  let any = false;
  let lineNo = 0;
  for (const raw of text.split(/\r?\n/)) {
    lineNo++;
    const line = raw.trim();
    if (!line) continue;
    if (line[0] !== ':' || line.length < 11 || !/^:[0-9a-f]+$/i.test(line)) throw new Error(`Файл не похож на Intel HEX (строка ${lineNo}).`);
    const bytes = new Uint8Array((line.length - 1) / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(line.substr(1 + i * 2, 2), 16);
    const len = bytes[0];
    if (bytes.length !== len + 5) throw new Error(`Строка ${lineNo}: неверная длина записи.`);
    let sum = 0;
    for (const b of bytes) sum = (sum + b) & 0xff;
    if (sum !== 0) throw new Error(`Строка ${lineNo}: не сходится контрольная сумма — файл повреждён.`);
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    if (type === 0) {
      for (let i = 0; i < len; i++) {
        const a = base + addr + i;
        if (a >= size) throw new Error(`Прошивка больше памяти контроллера (${size / 1024} КБ).`);
        flash[a] = bytes[4 + i];
      }
      any = true;
    } else if (type === 1) break;
    else if (type === 2) base = ((bytes[4] << 8) | bytes[5]) * 16;
    else if (type === 4) base = ((bytes[4] << 8) | bytes[5]) << 16;
  }
  if (!any) throw new Error('В файле нет данных прошивки.');
  return flash;
}

/** Образ флеш-памяти как слова (так его ждёт процессор). */
export function flashWords(flash: Uint8Array): Uint16Array {
  return new Uint16Array(flash.buffer, flash.byteOffset, flash.byteLength >> 1);
}
