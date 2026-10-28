/** Grouped digits for a bigint (Intl accepts bigint; DecimalPipe does not). */
export function formatBigInt(value: bigint, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}
