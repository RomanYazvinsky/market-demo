// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from './protocol';
import { toProducerConfig } from './symbols';

const sp500: string[] = JSON.parse(readFileSync(resolve(process.cwd(), 'public/resources/sp500.json'), 'utf8'));

describe('public/resources/sp500.json', () => {
  it('C01 is an array of enough unique tickers for the largest run', () => {
    expect(Array.isArray(sp500)).toBe(true);
    expect(sp500.length).toBeGreaterThanOrEqual(500);
    expect(new Set(sp500).size).toBe(sp500.length);
    expect(sp500.length).toBeGreaterThanOrEqual(SETTINGS_LIMITS.instrumentCount.max);
  });

  it('C02 contains only ticker-shaped strings', () => {
    sp500.forEach((s) => expect(s).toMatch(/^[A-Z]{1,5}(\.[A-Z])?$/));
  });

  it('C03 includes well-known constituents', () => {
    expect(sp500).toEqual(expect.arrayContaining(['AAPL', 'MSFT', 'BRK.B']));
  });
});

describe('toProducerConfig', () => {
  const all = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META'];

  it('C04 slices the list to instrumentCount and keeps the rest', () => {
    expect(toProducerConfig(DEFAULT_SETTINGS, all)).toEqual({
      symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL'],
      updatesPerBatch: 100,
      batchIntervalMs: 500,
    });
  });

  it('C05 returns a fresh array', () => {
    expect(toProducerConfig(DEFAULT_SETTINGS, all).symbols).not.toBe(toProducerConfig(DEFAULT_SETTINGS, all).symbols);
  });
});
