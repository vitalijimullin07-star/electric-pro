// Собирает dist/plata.html — весь редактор в одном файле: скрипт и стили встроены в страницу.
// Такой файл можно открыть с диска, переслать или опубликовать как одну страницу.
// Воркер автотрассировки кладётся рядом (dist/router.worker-*.js); если его нет,
// автотрассировка работает в основном потоке.
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
let html = readFileSync(join(dist, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_, href) => `<style>\n${readFileSync(join(dist, href), 'utf8')}\n</style>`);

html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, src) => {
  const js = readFileSync(join(dist, src), 'utf8')
    .replace(/\n\/\/# sourceMappingURL=.*$/m, '')
    .replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${js}\n</script>`;
});

if (/src="\.\/assets\//.test(html) || /href="\.\/assets\/[^"]+\.css"/.test(html)) throw new Error('Не все ресурсы встроены в страницу');

// Воркер ищется относительно страницы, поэтому кладём его в корень dist.
for (const f of readdirSync(join(dist, 'assets'))) if (/^router\.worker-.*\.js$/.test(f)) copyFileSync(join(dist, 'assets', f), join(dist, f));

writeFileSync(join(dist, 'plata.html'), html);
console.log(`dist/plata.html ${(html.length / 1024).toFixed(0)} КБ`);
