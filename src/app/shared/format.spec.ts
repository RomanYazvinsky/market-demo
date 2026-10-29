import { formatBigInt } from './format';

describe('formatBigInt', () => {
  it.each([
    [0n, '0'], [1234567n, '1,234,567'], [2n ** 64n, '18,446,744,073,709,551,616'],
  ])('U12 %s → %s', (value, expected) => expect(formatBigInt(value, 'en-US')).toBe(expected));
});
