import { Component, afterNextRender, inject } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterOutlet } from '@angular/router';
import { ProducerService } from './producer/producer.service';
import { StatusBar } from './shell/status-bar/status-bar';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, MatToolbarModule, StatusBar],
  styleUrl: './app.scss',
  host: { class: 'block min-h-screen' },
  templateUrl: './app.html',
})
export class App {
  private readonly producer = inject(ProducerService);

  constructor() {
    // Browser only, after the first render (and hydration): the worker never blocks bootstrap.
    afterNextRender(() => void this.producer.load());
  }
}
