// Pipes rendered through a host template, which also pins the chaining with Angular pipes.
import { Component, input } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { render, screen } from '@testing-library/angular';
import { BigIntPipe } from './bigint.pipe';
import { CentsPipe } from './cents.pipe';

@Component({
  imports: [CentsPipe, BigIntPipe, CurrencyPipe, DecimalPipe],
  template: `
    <span data-kind="price">{{ (cents() | cents | currency: 'USD') ?? '—' }}</span>
    <span data-kind="imbalance">{{ (imbalance() | number: '1.2-2') ?? '—' }}</span>
    <span data-kind="volume">{{ volume() | bigint }}</span>
  `,
})
class Host {
  cents = input<number | null>(null);
  imbalance = input<number | null>(null);
  volume = input(0n);
}

const text = (kind: string) => document.querySelector(`[data-kind="${kind}"]`)!.textContent;

describe('display pipes', () => {
  it.each([
    [10150, '$101.50'], [4, '$0.04'], [123456789, '$1,234,567.89'], [10150.33, '$101.50'], [null, '—'],
  ])('U10 U13 price %s → %s', async (cents, out) => {
    await render(Host, { inputs: { cents } });
    expect(text('price')).toBe(out);
  });

  it.each([[0.2, '0.20'], [-1, '-1.00'], [1, '1.00'], [0, '0.00'], [null, '—']])(
    'U11 U13 imbalance %s → %s', async (imbalance, out) => {
      await render(Host, { inputs: { imbalance } });
      expect(text('imbalance')).toBe(out);
    },
  );

  it('U12 volume groups digits', async () => {
    await render(Host, { inputs: { volume: 1234567n } });
    expect(text('volume')).toBe('1,234,567');
  });
});
