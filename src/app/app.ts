import { Component, afterNextRender, inject } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ProducerService } from './producer/producer.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule],
  styleUrl: './app.scss',
  host: { class: 'block min-h-screen' },
  template: `
    <mat-toolbar class="app-toolbar sticky top-0 z-10 flex gap-6">
      <span class="app-title">Market producer</span>
      <nav class="flex gap-4" aria-label="Main">
        <a class="py-1" routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Dashboard</a>
        <a class="py-1" routerLink="/settings" routerLinkActive="active">Settings</a>
      </nav>
    </mat-toolbar>
    <main class="mx-auto w-full max-w-5xl p-4 md:p-6">
      <router-outlet />
    </main>
  `,
})
export class App {
  private readonly producer = inject(ProducerService);

  constructor() {
    // Browser only, after the first render (and hydration): the worker never blocks bootstrap.
    afterNextRender(() => void this.producer.start());
  }
}
