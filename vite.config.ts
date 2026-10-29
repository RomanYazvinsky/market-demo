/// <reference types="vitest" />

import { defineConfig } from 'vite';
import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { SETTINGS_LIMITS } from './src/app/producer/protocol.ts';

// Every instrument of the largest possible run gets a prerendered page, so a deep link on static hosting loads the
// app (not a 404); "Show charts" is off on a fresh load, so the route guard then sends it to the dashboard.
const instrumentRoutes = (JSON.parse(readFileSync('public/resources/sp500.json', 'utf8')) as Array<{ symbol: string }>)
  .slice(0, SETTINGS_LIMITS.instrumentCount.max)
  .map((instrument) => `/instrument/${instrument.symbol}`);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // '/' locally; '/<repo>/' for GitHub Pages (BASE_PATH is set by .github/workflows/pages.yml).
  base: process.env['BASE_PATH'] ?? '/',
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
      '@angular/material/button-toggle',
      '@angular/material/form-field',
      '@angular/material/input',
      '@angular/material/slide-toggle',
      '@angular/material/sort',
      '@angular/material/table',
      '@angular/material/toolbar',
      '@angular/material/tooltip',
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
        routes: async () => ['/', '/settings', ...instrumentRoutes],
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
