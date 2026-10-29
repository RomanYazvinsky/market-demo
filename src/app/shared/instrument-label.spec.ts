import { instrumentLabel } from './instrument-label';

describe('instrumentLabel', () => {
  it('U43 is "full name (ticker)", or the ticker while the name is unknown', () => {
    const names = new Map([['NVDA', 'Nvidia']]);
    expect(instrumentLabel('NVDA', names)).toBe('Nvidia (NVDA)');
    expect(instrumentLabel('TSLA', names)).toBe('TSLA');
  });
});
