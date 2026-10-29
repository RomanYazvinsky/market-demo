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
  template: `
    <section class="flex max-w-md flex-col gap-4">
      <h1>Producer settings</h1>
      <form class="flex flex-col gap-2" (submit)="submit($event)" novalidate>
        <mat-form-field>
          <mat-label>Instrument count</mat-label>
          <input matInput type="number" step="1" [formField]="form.instrumentCount" />
          <mat-hint>{{ limits.instrumentCount.min }}–{{ limits.instrumentCount.max }}</mat-hint>
          <mat-error>
            @for (e of form.instrumentCount().errors(); track e.kind) {
              <span>{{ e.message }}</span>
            }
          </mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Updates per batch</mat-label>
          <input matInput type="number" step="1" [formField]="form.updatesPerBatch" />
          <mat-hint>{{ limits.updatesPerBatch.min }}–{{ limits.updatesPerBatch.max }}</mat-hint>
          <mat-error>
            @for (e of form.updatesPerBatch().errors(); track e.kind) {
              <span>{{ e.message }}</span>
            }
          </mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Batch interval (ms)</mat-label>
          <input matInput type="number" step="1" [formField]="form.batchIntervalMs" />
          <mat-hint>{{ limits.batchIntervalMs.min }}–{{ limits.batchIntervalMs.max }}</mat-hint>
          <mat-error>
            @for (e of form.batchIntervalMs().errors(); track e.kind) {
              <span>{{ e.message }}</span>
            }
          </mat-error>
        </mat-form-field>
        <p class="text-hint m-0">Apply starts a new run and clears current totals.</p>
        <div class="flex justify-end">
          <button matButton="filled" type="submit" [disabled]="form().invalid()">Apply</button>
        </div>
      </form>
    </section>
  `,
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
