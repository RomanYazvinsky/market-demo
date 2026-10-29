import { Component, input } from '@angular/core';
import type { ProducerStatus } from '../../producer/protocol';

@Component({
  selector: 'app-status-badge',
  styleUrl: './status-badge.scss',
  templateUrl: './status-badge.html',
})
export class StatusBadge {
  readonly status = input.required<ProducerStatus>();
  readonly error = input<string | null>(null);
}
