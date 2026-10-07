// Приложение «Пылесос S3» одним файлом: pylesos.html в корне (сайт, с демо) и
// firmware/vacuum-s3/app_page.h — сжатая страница без демо для самого пылесоса (Wi-Fi).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url).pathname;

function inline(dir) {
  let html = readFileSync(join(dir, 'pylesos-app.html'), 'utf8');
  html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_, href) => `<style>\n${readFileSync(join(dir, href), 'utf8')}\n</style>`);
  html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, src) => {
    const js = readFileSync(join(dir, src), 'utf8')
      .replace(/\n\/\/# sourceMappingURL=.*$/m, '')
      .replace(/<\/script/gi, '<\\/script');
    return `<script type="module">\n${js}\n</script>`;
  });
  // Иконка — та же, что у сайта (рядом со страницей), а не копия из assets.
  html = html.replace(/href="\.\/assets\/icon-192-[^"]+\.png"/, 'href="icon-192.png"');
  html = html.replace(/href="\.\/assets\/pylesos-[^"]+\.webmanifest"/, 'href="pylesos.webmanifest"');
  if (/(src|href)="\.\/assets\//.test(html)) throw new Error(`${dir}: не все ресурсы встроены в страницу`);
  return html;
}

const full = inline(join(root, 'dist-pylesos'));
writeFileSync(join(root, 'pylesos.html'), full);
console.log(`pylesos.html ${(full.length / 1024).toFixed(0)} КБ`);

const liteDir = join(root, 'dist-pylesos-lite');
if (existsSync(liteDir) && readdirSync(liteDir).length) {
  // На пылесосе нет ни иконок, ни манифеста: только страница.
  const lite = inline(liteDir)
    .replace(/<link rel="manifest"[^>]*>\s*/, '')
    .replace(/<link rel="icon"[^>]*>\s*/, '');
  const gz = gzipSync(Buffer.from(lite), { level: 9 });
  const bytes = [];
  for (let i = 0; i < gz.length; i += 24) bytes.push('  ' + [...gz.subarray(i, i + 24)].join(',') + ',');
  writeFileSync(
    join(root, 'firmware/vacuum-s3/app_page.h'),
    `/* Приложение «Пылесос S3» для телефона (src/pylesos, без демо), gzip. Создаёт npm run build — не править. */\n` +
      `#pragma once\n#include <stdint.h>\n#include <stddef.h>\n` +
      `static const size_t APP_PAGE_GZ_LEN = ${gz.length};\n` +
      `static const uint8_t APP_PAGE_GZ[] = {\n${bytes.join('\n')}\n};\n`,
  );
  console.log(`firmware/vacuum-s3/app_page.h ${(gz.length / 1024).toFixed(0)} КБ (gzip)`);
}
