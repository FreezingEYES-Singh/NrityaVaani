/** Small numeric helpers for the pure /compare modules. No DOM, no dependencies. */

export const DEG = Math.PI / 180;

export function finite(a: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) out.push(a[i]);
  return out;
}

export function mean(a: ArrayLike<number>): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isFinite(a[i])) {
      s += a[i];
      n++;
    }
  }
  return n ? s / n : NaN;
}

/** Quantile with linear interpolation over the finite values (q in 0..1). NaN when empty. */
export function pct(a: ArrayLike<number>, q: number): number {
  const b = finite(a).sort((x, y) => x - y);
  if (!b.length) return NaN;
  const i = q * (b.length - 1);
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, b.length - 1);
  return b[lo] + (b[hi] - b[lo]) * (i - lo);
}

export function median(a: ArrayLike<number>): number {
  return pct(a, 0.5);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Deterministic PRNG (mulberry32), so analysis results never depend on Math.random. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rnd: () => number): number {
  return Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
}

/**
 * Savitzky-Golay quadratic smoothing weights for a centred window of 2m+1
 * samples. Used as the "robust local fit" behind every jitter estimate.
 */
export function sgWeights(m: number): number[] {
  const den = (2 * m - 1) * (2 * m + 1) * (2 * m + 3);
  const w: number[] = [];
  for (let i = -m; i <= m; i++) w.push((3 * (3 * m * m + 3 * m - 1) - 15 * i * i) / den);
  return w;
}

/**
 * Residuals of a series against its local quadratic fit (window 2m+1).
 * NaN where the window is not complete or contains a NaN.
 */
export function sgResidual(x: ArrayLike<number>, m: number): number[] {
  const w = sgWeights(m);
  const out = new Array<number>(x.length).fill(NaN);
  for (let t = m; t < x.length - m; t++) {
    let s = 0;
    let ok = true;
    for (let i = -m; i <= m; i++) {
      const v = x[t + i];
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      s += w[i + m] * v;
    }
    if (ok) out[t] = x[t] - s;
  }
  return out;
}

/** Factor turning the SD of SG residuals back into the SD of white noise. */
export function sgNoiseFactor(m: number): number {
  return 1 / Math.sqrt(1 - sgWeights(m)[m]);
}
