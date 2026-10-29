/// <reference types="vitest" />

import { defineConfig } from 'vite';
import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  build: {
    target: ['es2020'],
  },
  resolve: {
    mainFields: ['module'],
  },
  optimizeDeps: {
    // Pre-bundle lazily imported deps, so the first navigation doesn't trigger a full reload in dev.
    include: [
      '@angular/forms/signals',
      '@angular/material/button',
      '@angular/material/form-field',
      '@angular/material/input',
      '@angular/material/sort',
      '@angular/material/table',
      '@angular/material/toolbar',
      'chart.js',
    ],
  },
  worker: {
    // The producer worker uses ES imports and is loaded via `?worker`.
    format: 'es',
  },
  plugins: [
    analog({
      ssr: true,
      static: true,
      prerender: {
        routes: async () => ['/', '/settings'],
      },
      inlineStylesExtension: 'scss',
      vite: {
        // The worker is in the Angular program (tsconfig.app.json) so its TS gets compiled in dev,
        // but Vite's `?worker` wrapper module must be left to Vite.
        transformFilter: (_code, id) => !/[?&]worker(&|$)/.test(id),
      },
    }),
    tailwindcss(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
  },
}));
