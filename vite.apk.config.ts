import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import type { Plugin } from 'vite';

// Интерфейс приложения «Пылесос S3» для Android (APK): src/pylesos/apk → android/pylesos/build/www
// (оттуда его берёт android/pylesos/build.sh). Отдельными файлами: их отдаёт приложение из своих assets.

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
  root: fileURLToPath(new URL('./src/pylesos/apk', import.meta.url)),
  base: './',
  publicDir: false,
  plugins: [react()],
  worker: { format: 'es', plugins: () => [vacuumFw()] },
  build: {
    target: 'es2022',
    outDir: fileURLToPath(new URL('./android/pylesos/build/www', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
