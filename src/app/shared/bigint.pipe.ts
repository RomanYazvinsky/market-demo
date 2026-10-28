import { Pipe, PipeTransform } from '@angular/core';

/** Grouped digits for bigint values (DecimalPipe has no bigint support). */
@Pipe({ name: 'bigint' })
export class BigIntPipe implements PipeTransform {
  transform(value: bigint | null | undefined): string | null {
    void value;
    throw new Error('not implemented');
  }
}
