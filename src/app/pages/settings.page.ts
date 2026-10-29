import { Location } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormField, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import type { RouteMeta } from '@analogjs/router';
import { ProducerService } from '../producer/producer.service';
import { SETTINGS_LIMITS } from '../producer/protocol';
import { DisplaySettings } from '../settings/display-settings';
import { createSettingsForm, toSettings } from '../settings/settings-form';

export const routeMeta: RouteMeta = { title: 'Settings' };

@Component({
  selector: 'app-settings-page',
  imports: [FormField, MatFormFieldModule, MatInputModule, MatButtonModule, MatSlideToggleModule, MatTooltipModule],
  host: { class: 'block' },
  templateUrl: './settings.page.html',
})
export default class SettingsPage {
  private readonly producer = inject(ProducerService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  protected readonly display = inject(DisplaySettings);
  protected readonly limits = SETTINGS_LIMITS;
  // A local copy: editing never touches the producer until Apply.
  private readonly settingsForm = createSettingsForm(this.producer.settings());
  protected readonly model = this.settingsForm.model;
  protected readonly form = this.settingsForm.form;
  protected readonly applied = signal(false);
  private appliedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.appliedTimer));
  }

  /** The previous page of this app, or the dashboard when settings was opened directly. */
  back(): void {
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) this.location.back();
    else void this.router.navigateByUrl('/');
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.form, async () => {
      this.producer.apply(toSettings(this.model()));
      this.applied.set(true);
      clearTimeout(this.appliedTimer);
      this.appliedTimer = setTimeout(() => this.applied.set(false), 3000);
    });
  }
}
