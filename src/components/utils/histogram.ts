const DEFAULT_BINS = 50;

export function computeHistogram(
  values: ArrayLike<number>,
  low: number,
  high: number,
  binCount = DEFAULT_BINS
) {
  const bins = new Array<number>(binCount).fill(0);
  const width = high - low;
  if (!(Number.isFinite(low) && Number.isFinite(high)) || width <= 0) {
    return bins;
  }

  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < low || v > high) continue;
    let idx = Math.floor(((v - low) / width) * binCount);
    if (idx < 0) idx = 0;
    if (idx >= binCount) idx = binCount - 1;
    bins[idx] += 1;
  }
  return bins;
}

export function sampleFiniteValues(values: ArrayLike<number>, maxSamples = 600) {
  const out: number[] = [];
  if (values.length === 0) return out;

  const stride = Math.max(1, Math.floor(values.length / maxSamples));
  for (let i = 0; i < values.length; i += stride) {
    const v = values[i];
    if (Number.isFinite(v)) out.push(v);
    if (out.length >= maxSamples) break;
  }
  return out;
}
