// Собирает dist/plata.html и index.html в корне репозитория — весь редактор в одном файле.
// Такой файл можно открыть с диска, переслать или опубликовать как одну страницу.
// Воркер автотрассировки кладётся рядом (dist/router.worker-*.js); если его нет,
// автотрассировка работает в основном потоке.
import { copyFileSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const root = new URL('../', import.meta.url).pathname;
let html = readFileSync(join(dist, 'app.html'), 'utf8');

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
writeFileSync(join(dist, 'index.html'), html);

// Корень репозитория — сайт для GitHub Pages (публикация из ветки main): index.html и воркер.
for (const f of readdirSync(root)) if (/^router\.worker-.*\.js$/.test(f)) unlinkSync(join(root, f));
writeFileSync(join(root, 'index.html'), html);
for (const f of readdirSync(dist)) if (/^router\.worker-.*\.js$/.test(f)) copyFileSync(join(dist, f), join(root, f));
console.log(`dist/plata.html ${(html.length / 1024).toFixed(0)} КБ`);
