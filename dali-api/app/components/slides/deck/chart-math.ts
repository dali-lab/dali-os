export function niceTicks(min: number, max: number, count = 5): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [0, 1];
  const rough = (hi - lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

export function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${+(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${+(value / 1e3).toFixed(1)}k`;
  return String(+value.toFixed(2));
}

export function pieSlices(values: number[]): Array<{ start: number; end: number; share: number }> {
  const positive = values.map((v) => Math.max(0, v));
  const total = positive.reduce((a, b) => a + b, 0);
  if (total <= 0) return positive.map(() => ({ start: 0, end: 0, share: 0 }));
  let angle = 0;
  return positive.map((v) => {
    const sweep = (v / total) * Math.PI * 2;
    const slice = { start: angle, end: angle + sweep, share: v / total };
    angle += sweep;
    return slice;
  });
}
