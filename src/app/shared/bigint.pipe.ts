import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';
import { formatBigInt } from './format';

/** Grouped digits for bigint values (DecimalPipe has no bigint support). */
@Pipe({ name: 'bigint' })
export class BigIntPipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(value: bigint | null | undefined): string | null {
    return value == null ? null : formatBigInt(value, this.locale);
  }
}
