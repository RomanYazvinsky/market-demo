import { Pipe, PipeTransform } from '@angular/core';

/** Integer cents -> dollars, for chaining into `currency`. */
@Pipe({ name: 'cents' })
export class CentsPipe implements PipeTransform {
  transform(cents: number | null | undefined): number | null {
    return cents == null ? null : cents / 100;
  }
}
