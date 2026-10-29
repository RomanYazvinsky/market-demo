import { Injectable, inject, signal } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

/** UI-only preferences from the settings page; unlike producer settings they apply at once. */
@Injectable({ providedIn: 'root' })
export class DisplaySettings {
  /** The instrument page with its charts; off by default. */
  readonly showCharts = signal(false);
}

/** The instrument page opens only while "Show charts" is on; otherwise it goes to the dashboard. */
export const chartsEnabledGuard: CanActivateFn = () =>
  inject(DisplaySettings).showCharts() || inject(Router).createUrlTree(['/']);
