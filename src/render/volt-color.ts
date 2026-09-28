/** Цвет напряжения: 0 В — синий, наибольшее — красный, ниже нуля — фиолетовый. */
export function voltColor(v: number, vmax: number): string {
  if (v < -0.05) return '#bf5af2';
  const k = Math.max(0, Math.min(1, v / Math.max(0.1, vmax)));
  return `hsl(${Math.round(225 - 225 * k)},90%,${Math.round(55 + 5 * k)}%)`;
}
