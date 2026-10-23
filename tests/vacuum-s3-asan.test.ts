import { describe, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * Память ядра прошивки «S3» (6.4): ядро собирается gcc с AddressSanitizer и UBSan, в состояние и
 * настройки кладутся предельные значения (огромные, отрицательные, NaN, полные истории), ядро
 * выполняет все команды и выдаёт все строки экрану, журнал, JSON и CSV «чёрного ящика»
 * (tests/fixtures/vac-asan/harness.c). Переполнение буфера строки или неопределённое поведение —
 * падение. Без gcc тест пропускается.
 */

const gcc = spawnSync('gcc', ['--version']).status === 0;

describe('Прошивка S3: память ядра (ASan, UBSan)', () => {
  test.skipIf(!gcc)('предельные значения во всех полях: ни одного выхода за буфер', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vac-asan-'));
    try {
      const exe = join(dir, 'vac_asan');
      const src = ['tests/fixtures/vac-asan/harness.c', ...['vac_core.c', 'vac_ext.c', 'vac_link.c', 'vac_drv.c'].map((f) => `firmware/vacuum-s3/${f}`)];
      execFileSync('gcc', ['-std=c11', '-g', '-O1', '-fsanitize=address,undefined', '-fno-sanitize-recover=undefined', '-fno-omit-frame-pointer', '-Ifirmware/vacuum-s3', '-o', exe, ...src, '-lm'], { stdio: 'pipe' });
      const r = spawnSync(exe, [], { encoding: 'utf8', env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=0' } });
      expect(r.stderr).not.toMatch(/ERROR: AddressSanitizer|runtime error/);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^ok /m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});
