/** "Nvidia (NVDA)"; just the ticker while its name is unknown. */
export function instrumentLabel(symbol: string, names: ReadonlyMap<string, string>): string {
  const name = names.get(symbol);
  return name ? `${name} (${symbol})` : symbol;
}
