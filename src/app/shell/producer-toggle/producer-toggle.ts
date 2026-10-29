import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ProducerService } from '../../producer/producer.service';

/** Start before the first run, then Pause/Resume; disabled while initializing or failed. */
@Component({
  selector: 'app-producer-toggle',
  imports: [MatButtonModule],
  templateUrl: './producer-toggle.html',
})
export class ProducerToggle {
  protected readonly producer = inject(ProducerService);

  protected readonly canToggle = computed(() => ['idle', 'running', 'paused'].includes(this.producer.status()));

  protected readonly label = computed(() => {
    const status = this.producer.status();
    return status === 'idle' ? 'Start' : status === 'paused' ? 'Resume' : 'Pause';
  });

  toggle(): void {
    if (this.producer.status() === 'idle') this.producer.start();
    else if (this.producer.status() === 'running') this.producer.pause();
    else if (this.producer.status() === 'paused') this.producer.resume();
  }
}
