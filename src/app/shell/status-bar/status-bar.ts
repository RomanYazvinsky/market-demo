import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { ProducerService } from '../../producer/producer.service';
import { formatDuration } from '../../shared/format';
import { ProducerToggle } from '../producer-toggle/producer-toggle';
import { StatusBadge } from '../status-badge/status-badge';

/** Producer status, run time, Start/Pause/Resume and the settings link, in the app toolbar. */
@Component({
  selector: 'app-status-bar',
  imports: [MatButtonModule, RouterLink, ProducerToggle, StatusBadge],
  host: { class: 'flex items-center gap-3' },
  styleUrl: './status-bar.scss',
  templateUrl: './status-bar.html',
})
export class StatusBar {
  protected readonly producer = inject(ProducerService);
  protected readonly runTime = computed(() => formatDuration(this.producer.elapsedMs()));
}
