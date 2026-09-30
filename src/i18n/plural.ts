/** Russian plural form: 1 элемент, 2 элемента, 5 элементов (21 элемент, 22 элемента, 11 элементов). */
export function plural(count: number | string, one: string, few: string, many: string): string {
  const n = Math.abs(Number(count)) % 100;
  if (n >= 11 && n <= 14) return many;
  const last = n % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
