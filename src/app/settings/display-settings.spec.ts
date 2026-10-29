import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { chartsEnabledGuard, DisplaySettings } from './display-settings';

describe('chartsEnabledGuard', () => {
  const runGuard = () => TestBed.runInInjectionContext(() => chartsEnabledGuard({} as never, {} as never));

  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('U48 charts are off by default and the guard sends the instrument page to the dashboard', () => {
    expect(TestBed.inject(DisplaySettings).showCharts()).toBe(false);
    const result = runGuard();
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/');
  });

  it('U48 the guard lets the instrument page open when charts are on', () => {
    TestBed.inject(DisplaySettings).showCharts.set(true);
    expect(runGuard()).toBe(true);
  });
});
