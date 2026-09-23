/** Короткие уникальные идентификаторы объектов проекта. */
let counter = 0;
const rnd = (): string => Math.random().toString(36).slice(2, 7);

export function newId(prefix: string): string {
  counter = (counter + 1) % 1_679_616;
  return `${prefix}${Date.now().toString(36).slice(-5)}${counter.toString(36)}${rnd()}`;
}

/**
 * Следующее свободное позиционное обозначение: R1, R2… Берёт наименьший
 * свободный номер, как это делают EasyEDA и KiCad.
 */
export function nextRef(prefix: string, used: Iterable<string>): string {
  const nums = new Set<number>();
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
  for (const r of used) {
    const m = re.exec(r);
    if (m) nums.add(+m[1]);
  }
  let n = 1;
  while (nums.has(n)) n++;
  return `${prefix}${n}`;
}
