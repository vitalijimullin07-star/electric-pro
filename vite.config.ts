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
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 180_000,
  },
});
