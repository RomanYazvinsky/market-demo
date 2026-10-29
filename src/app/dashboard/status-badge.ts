import { Component, input } from '@angular/core';
import type { ProducerStatus } from '../producer/protocol';

@Component({
  selector: 'app-status-badge',
  styleUrl: './status-badge.scss',
  template: `
    <p role="status" class="badge" [attr.data-status]="status()">
      <span class="word">{{ status() }}</span>
      @if (error(); as error) {
        <span class="error">{{ error }}</span>
      }
    </p>
  `,
})
export class StatusBadge {
  readonly status = input.required<ProducerStatus>();
  readonly error = input<string | null>(null);
}
