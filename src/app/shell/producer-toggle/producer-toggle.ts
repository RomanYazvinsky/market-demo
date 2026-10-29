import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ProducerService } from '../../producer/producer.service';

/** Start before the first run, then Pause/Resume, and Retry after an error; disabled while initializing. */
@Component({
  selector: 'app-producer-toggle',
  imports: [MatButtonModule],
  templateUrl: './producer-toggle.html',
})
export class ProducerToggle {
  protected readonly producer = inject(ProducerService);

  protected readonly canToggle = computed(() => this.producer.status() !== 'initializing');

  protected readonly label = computed(() => {
    const status = this.producer.status();
    if (status === 'idle') return 'Start';
    if (status === 'paused') return 'Resume';
    return status === 'error' ? 'Retry' : 'Pause';
  });

  toggle(): void {
    if (this.producer.status() === 'idle') this.producer.start();
    else if (this.producer.status() === 'error') this.producer.retry();
    else if (this.producer.status() === 'running') this.producer.pause();
    else if (this.producer.status() === 'paused') this.producer.resume();
  }
}
