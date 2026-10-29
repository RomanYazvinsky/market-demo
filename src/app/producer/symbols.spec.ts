// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from './protocol';
import { toProducerConfig } from './symbols';

import type { Instrument } from './producer.service';

const sp500: Instrument[] = JSON.parse(readFileSync(resolve(process.cwd(), 'public/resources/sp500.json'), 'utf8'));
const tickers = sp500.map((instrument) => instrument.symbol);

describe('public/resources/sp500.json', () => {
  it('C01 is an array of enough unique tickers for the largest run', () => {
    expect(Array.isArray(sp500)).toBe(true);
    expect(sp500.length).toBeGreaterThanOrEqual(500);
    expect(new Set(tickers).size).toBe(sp500.length);
    expect(sp500.length).toBeGreaterThanOrEqual(SETTINGS_LIMITS.instrumentCount.max);
  });

  it('C02 every entry is a ticker-shaped symbol with a company name', () => {
    sp500.forEach((instrument) => {
      expect(instrument.symbol).toMatch(/^[A-Z]{1,5}(\.[A-Z])?$/);
      expect(instrument.name.trim()).not.toBe('');
    });
  });

  it('C03 includes well-known constituents with their names', () => {
    expect(sp500).toEqual(expect.arrayContaining([
      { symbol: 'AAPL', name: 'Apple Inc.' },
      { symbol: 'NVDA', name: 'Nvidia' },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway' },
    ]));
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
