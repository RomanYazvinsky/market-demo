import { Component } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export const routeMeta: RouteMeta = { title: 'Settings' };

@Component({
  selector: 'app-settings-page',
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule],
  styleUrl: './settings.page.scss',
  template: `
    <section class="flex max-w-md flex-col gap-4">
      <h1>Producer settings</h1>
      <form class="flex flex-col gap-2" novalidate>
        <mat-form-field>
          <mat-label>Instrument count</mat-label>
          <input matInput type="number" step="1" />
          <mat-hint>1–50</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Updates per batch</mat-label>
          <input matInput type="number" step="1" />
          <mat-hint>1–1000</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Batch interval (ms)</mat-label>
          <input matInput type="number" step="1" />
          <mat-hint>50–2000</mat-hint>
        </mat-form-field>
        <p class="note">Apply starts a new run and clears current totals.</p>
        <div class="flex justify-end">
          <button matButton="filled" type="submit">Apply</button>
        </div>
      </form>
    </section>
  `,
})
export default class SettingsPage {}
