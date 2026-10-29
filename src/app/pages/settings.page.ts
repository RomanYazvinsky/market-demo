import { Component, inject } from '@angular/core';
import { FormField, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { RouteMeta } from '@analogjs/router';
import { ProducerService } from '../producer/producer.service';
import { SETTINGS_LIMITS } from '../producer/protocol';
import { createSettingsForm, toSettings } from '../settings/settings-form';

export const routeMeta: RouteMeta = { title: 'Settings' };

@Component({
  selector: 'app-settings-page',
  imports: [FormField, MatFormFieldModule, MatInputModule, MatButtonModule],
  host: { class: 'block' },
  templateUrl: './settings.page.html',
})
export default class SettingsPage {
  private readonly producer = inject(ProducerService);
  protected readonly limits = SETTINGS_LIMITS;
  // A local copy: editing never touches the producer until Apply.
  private readonly settingsForm = createSettingsForm(this.producer.settings());
  protected readonly model = this.settingsForm.model;
  protected readonly form = this.settingsForm.form;

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.form, async () => {
      this.producer.apply(toSettings(this.model()));
    });
  }
}
