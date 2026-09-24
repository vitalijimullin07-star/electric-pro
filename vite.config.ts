import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Относительные пути: собранный редактор открывается и с GitHub Pages, и из папки.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': dir('./src/core'),
      '@editor': dir('./src/editor'),
      '@render': dir('./src/render'),
      '@ui': dir('./src/ui'),
    },
  },
  // Исходная страница — app.html: корень репозитория занимает собранный index.html для GitHub Pages.
  server: { open: '/app.html' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: { input: fileURLToPath(new URL('./app.html', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 180_000,
  },
});
