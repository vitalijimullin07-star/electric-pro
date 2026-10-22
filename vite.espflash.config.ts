import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Интерфейс «Прошивальщика ESP32» (APK): src/espflash → android/espflash/build/www
// (оттуда его берёт android/espflash/build.sh). Отдельными файлами: их отдаёт приложение из своих assets.

export default defineConfig({
  root: fileURLToPath(new URL('./src/espflash', import.meta.url)),
  base: './',
  publicDir: false,
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: fileURLToPath(new URL('./android/espflash/build/www', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
