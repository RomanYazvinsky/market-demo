import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ProducerService } from '../producer/producer.service';

/** Pause/Resume for the single producer; disabled while initializing or failed. */
@Component({
  selector: 'app-producer-toggle',
  imports: [MatButtonModule],
  templateUrl: './producer-toggle.html',
})
export class ProducerToggle {
  protected readonly producer = inject(ProducerService);
  protected readonly canToggle = computed(() => ['running', 'paused'].includes(this.producer.status()));

  toggle(): void {
    if (this.producer.status() === 'running') this.producer.pause();
    else if (this.producer.status() === 'paused') this.producer.resume();
  }
}
