import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import type { Plugin } from 'vite';

// Приложение «Пылесос S3» для телефона: исходная страница — pylesos-app.html, собранная одним
// файлом — pylesos.html в корне (сайт) и, без демо, — в прошивку пылесоса (VITE_PYLESOS_LITE=1).
const lite = !!process.env.VITE_PYLESOS_LITE;

/** Прошивка контроллера для демо — строкой base64 (модуль «virtual:vacuum-fw»). */
function vacuumFw(): Plugin {
  const id = 'virtual:vacuum-fw';
  return {
    name: 'vacuum-fw',
    resolveId: (s) => (s === id ? '\0' + id : null),
    load: (s) => (s === '\0' + id ? `export default ${JSON.stringify(readFileSync(fileURLToPath(new URL('./firmware/vacuum-s3/vacuum-s3.wasm', import.meta.url))).toString('base64'))};` : null),
  };
}

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es', plugins: () => [vacuumFw()] },
  build: {
    target: 'es2022',
    outDir: lite ? 'dist-pylesos-lite' : 'dist-pylesos',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: fileURLToPath(new URL('./pylesos-app.html', import.meta.url)),
      output: { codeSplitting: false },
    },
  },
});
