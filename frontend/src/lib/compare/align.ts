/**
 * Alignment for /compare (05-mvp.md §3.2, §3.4, §3.5). Pure TS.
 *
 * Works on alignment frames (features.ts) on the 15 fps grid. A null frame is
 * masked: it gets a neutral cost in the matching and is left out of counts.
 */
import { GRID_FPS } from "./types.ts";
import { type AFrame, cost, medianFrame, runsOf } from "./features.ts";
import { mean, median } from "./math.ts";

export const MOTION_MOVEMENT = 0.07;
export const HOLD_STILL_SHARE = 0.6;

/** §3.2.2: noise-corrected spread of the teacher's features around their median. */
export function motionOf(Q: (AFrame | null)[], jitterCost: number): number {
  const ok = Q.filter((q): q is AFrame => !!q);
  const m = medianFrame(ok);
  if (!m) return NaN;
  const raw = mean(ok.map((q) => cost(q, m)));
  return Math.sqrt(Math.max(0, raw * raw - jitterCost * jitterCost));
}

/* ------------------------------------------------------------------ */
/* Pauses (§3.2.3), movement steps only                                 */
/* ------------------------------------------------------------------ */

export const PAUSE_MIN_SEC = 1.5;
export const TRANSITION_SEC = 1;

export interface PauseCut {
  /** Still runs that were cut, as [first, last] grid indices. */
  runs: [number, number][];
  /** Grid indices kept, in order. */
  keep: number[];
  /** Kept frames inside a transition around a cut: neutral in matching, not scored. */
  neutral: Set<number>;
}

/**
 * Cut still runs of >= 1.5 s that are not part of the step. `partOfStep(pose, run)`
 * decides: for the student, whether the teacher *holds* that pose in the step
 * (a pose the teacher only passes through doesn't count); for the teacher, whether
 * the run is at the edge of the selection or its pose is held elsewhere in the step.
 */
export function cutPauses(
  F: (AFrame | null)[],
  still: boolean[],
  partOfStep: (pose: AFrame, run: [number, number]) => boolean,
): PauseCut {
  const minLen = Math.round(PAUSE_MIN_SEC * GRID_FPS);
  const runs: [number, number][] = [];
  for (const [a, b] of runsOf(still)) {
    if (b - a + 1 < minLen) continue;
    const pose = medianFrame(F.slice(a, b + 1).filter((f): f is AFrame => !!f));
    if (!pose) continue;
    if (!partOfStep(pose, [a, b])) runs.push([a, b]);
  }
  const cut = new Uint8Array(F.length);
  for (const [a, b] of runs) for (let i = a; i <= b; i++) cut[i] = 1;
  const keep: number[] = [];
  for (let i = 0; i < F.length; i++) if (!cut[i]) keep.push(i);
  const neutral = new Set<number>();
  const tr = Math.round(TRANSITION_SEC * GRID_FPS);
  for (const [a, b] of runs) {
    for (let i = Math.max(0, a - tr); i < a; i++) if (!cut[i]) neutral.add(i);
    for (let i = b + 1; i <= Math.min(F.length - 1, b + tr); i++) if (!cut[i]) neutral.add(i);
  }
  return { runs, keep, neutral };
}

/**
 * Is `pose` held somewhere in `frames` (indices given): a run of at least
 * `minLen` frames that are still and within tauP of the pose?
 */
export function heldIn(
  pose: AFrame,
  F: (AFrame | null)[],
  still: boolean[],
  idx: number[],
  tauP: number,
  minLen: number,
): boolean {
  let run = 0;
  let prev = -2;
  for (const i of idx) {
    const f = F[i];
    const c = f ? cost(pose, f) : NaN;
    const ok = still[i] && Number.isFinite(c) && c <= tauP;
    if (ok) {
      run = i === prev + 1 ? run + 1 : 1;
      if (run >= minLen) return true;
    } else run = 0;
    prev = i;
  }
  return false;
}

/** Still frames: windowed displacement below k x jitter. Unknown frames are not still. */
export function stillMask(disp: number[], jitterPos: number, k: number): boolean[] {
  return disp.map((d) => Number.isFinite(d) && d <= k * jitterPos);
}

/* ------------------------------------------------------------------ */
/* Subsequence DTW (§3.4)                                               */
/* ------------------------------------------------------------------ */

export interface CostMatrix {
  N: number;
  M: number;
  C: Float32Array;
  /** 0.1 x median row minimum, charged per extra cell of a slow step. */
  lambda: number;
}

/**
 * The cost matrix between query Q (rows) and search space S (columns).
 * - A masked or neutral teacher row doesn't discriminate between your frames, so it gets
 *   the typical good-match cost (the median row minimum): it neither helps nor sinks a match.
 * - A masked or neutral column of yours gets halfway between the row's best and median
 *   cost, so the match can't route a hard part of the step through it for free.
 */
export function costMatrix(
  Q: (AFrame | null)[],
  S: (AFrame | null)[],
  qNeutral: (n: number) => boolean = () => false,
  sNeutral: (m: number) => boolean = () => false,
): CostMatrix {
  const N = Q.length;
  const M = S.length;
  const C = new Float32Array(N * M);
  const rowMin: number[] = [];
  const rowMed = new Float64Array(N).fill(NaN);
  const row: number[] = [];
  for (let n = 0; n < N; n++) {
    let mn = Infinity;
    const q = Q[n];
    row.length = 0;
    for (let m = 0; m < M; m++) {
      const s = S[m];
      const c = q && s && !qNeutral(n) && !sNeutral(m) ? cost(q, s) : NaN;
      C[n * M + m] = c;
      if (Number.isFinite(c)) {
        row.push(c);
        if (c < mn) mn = c;
      }
    }
    if (Number.isFinite(mn)) rowMin.push(mn);
    if (row.length) rowMed[n] = median(row);
  }
  const typical = rowMin.length ? median(rowMin) : 0.1;
  for (let n = 0; n < N; n++) {
    let mn = Infinity;
    for (let m = 0; m < M; m++) {
      const c = C[n * M + m];
      if (Number.isFinite(c) && c < mn) mn = c;
    }
    const fill = Number.isFinite(rowMed[n]) && Number.isFinite(mn) ? mn + 0.5 * (rowMed[n] - mn) : typical;
    for (let m = 0; m < M; m++) if (!Number.isFinite(C[n * M + m])) C[n * M + m] = fill;
  }
  return { N, M, C, lambda: 0.1 * typical };
}

export interface SdtwRun {
  /** Normalised cost of the best path ending at each column (D / N). Infinity if blocked. */
  E: Float64Array;
  start: Int32Array;
  /** Path for a given end column: [student col, teacher row] pairs, in order. */
  path: (mEnd: number) => [number, number][];
  /** Share of path steps that are compressions (student faster), for an end column. */
  compression: (mEnd: number) => number;
}

/**
 * Subsequence DTW with steps (1,1), (1,2), (2,1), (1,3), (3,1).
 * Teacher row n, student column m. A slow step (one teacher row over k
 * student columns) is charged the mean of the covered cells plus λ per extra cell;
 * a fast step (k teacher rows in one column) charges each skipped teacher cell.
 */
export function sdtw(cm: CostMatrix, blocked: Uint8Array): SdtwRun {
  const { N, M, C, lambda: lam } = cm;
  const D = new Float64Array(N * M).fill(Infinity);
  const B = new Int8Array(N * M);
  const St = new Int32Array(N * M);
  const Cm = new Int32Array(N * M);
  const Ns = new Int32Array(N * M);
  const c = (n: number, m: number) => (blocked[m] ? Infinity : C[n * M + m]);
  for (let m = 0; m < M; m++) {
    D[m] = c(0, m);
    St[m] = m;
  }
  for (let n = 1; n < N; n++) {
    for (let m = 0; m < M; m++) {
      const cc = c(n, m);
      if (!Number.isFinite(cc)) continue;
      let best = Infinity;
      let code = 0;
      let pid = -1;
      const consider = (v: number, k: number, id: number) => {
        if (v < best) {
          best = v;
          code = k;
          pid = id;
        }
      };
      if (m >= 1) consider(D[(n - 1) * M + m - 1], 1, (n - 1) * M + m - 1);
      if (m >= 2) consider(D[(n - 1) * M + m - 2] + 0.5 * (c(n, m - 1) - cc) + lam, 2, (n - 1) * M + m - 2);
      if (m >= 3)
        consider(D[(n - 1) * M + m - 3] + (c(n, m - 1) + c(n, m - 2) - 2 * cc) / 3 + 2 * lam, 3, (n - 1) * M + m - 3);
      if (n >= 2 && m >= 1) consider(D[(n - 2) * M + m - 1] + c(n - 1, m) + lam, 4, (n - 2) * M + m - 1);
      if (n >= 3 && m >= 1)
        consider(D[(n - 3) * M + m - 1] + c(n - 1, m) + c(n - 2, m) + 2 * lam, 5, (n - 3) * M + m - 1);
      if (pid < 0 || !Number.isFinite(best)) continue;
      const id = n * M + m;
      D[id] = cc + best;
      B[id] = code;
      St[id] = St[pid];
      Cm[id] = Cm[pid] + (code >= 4 ? 1 : 0);
      Ns[id] = Ns[pid] + 1;
    }
  }
  const E = new Float64Array(M);
  const start = new Int32Array(M);
  for (let m = 0; m < M; m++) {
    E[m] = D[(N - 1) * M + m] / N;
    start[m] = St[(N - 1) * M + m];
  }
  const path = (mEnd: number) => {
    const pairs: [number, number][] = [];
    let n = N - 1;
    let m = mEnd;
    while (n >= 0 && m >= 0) {
      pairs.push([m, n]);
      if (n === 0) break;
      const b = B[n * M + m];
      if (b === 1) {
        n--;
        m--;
      } else if (b === 2) {
        pairs.push([m - 1, n]);
        n--;
        m -= 2;
      } else if (b === 3) {
        pairs.push([m - 1, n], [m - 2, n]);
        n--;
        m -= 3;
      } else if (b === 4) {
        pairs.push([m, n - 1]);
        n -= 2;
        m--;
      } else if (b === 5) {
        pairs.push([m, n - 1], [m, n - 2]);
        n -= 3;
        m--;
      } else break;
    }
    return pairs.reverse();
  };
  const compression = (mEnd: number) => Cm[(N - 1) * M + mEnd] / Math.max(1, Ns[(N - 1) * M + mEnd]);
  return { E, start, path, compression };
}

/* ------------------------------------------------------------------ */
/* Search: found tests and tries (§3.4)                                 */
/* ------------------------------------------------------------------ */

export interface Found {
  /** Student span in search-space indices (inclusive). */
  s: number;
  e: number;
  cost: number;
  /** Student span length / teacher length. */
  span: number;
  pairs: [number, number][];
  compression: number;
  ceilOk: boolean;
  moveOk: boolean;
  /** The cost of the query against the student's frozen median pose over the span. */
  nullCost: number;
  /**
   * The same test with each side's own median pose taken out: how well your movement
   * follows the teacher's, whatever constant pose error you have (1 = no better than frozen).
   */
  centred: number;
}

/** Path cost with both sides re-centred on their own median pose, over the teacher's own spread. */
export function centredRatio(Q: (AFrame | null)[], S: (AFrame | null)[], pairs: [number, number][], sMed: AFrame): number {
  const qOk = Q.filter((q): q is AFrame => !!q);
  const qMed = medianFrame(qOk);
  if (!qMed) return Infinity;
  const shift = sMed.f.map((x, c) => qMed.f[c] - x);
  const moved = (a: AFrame): AFrame => ({ f: a.f.map((x, c) => x + shift[c]), w: a.w });
  const path: number[] = [];
  for (const [m, n] of pairs) {
    const q = Q[n];
    const sm = S[m];
    if (!q || !sm) continue;
    const c = cost(q, moved(sm));
    if (Number.isFinite(c)) path.push(c);
  }
  const spread = mean(qOk.map((q) => cost(q, qMed)));
  return path.length && spread > 0 ? mean(path) / spread : Infinity;
}

export interface SearchResult {
  tries: Found[];
  /** The best candidate, accepted or not. */
  first: Found | null;
  tau: number;
}

export const MAX_TRIES = 6;
const MAX_CANDIDATES = 14;

/**
 * Find the query inside the search space.
 * - Ceiling: cost <= tau.
 * - Real movement: cost <= 0.7 x the cost of the query against the student's
 *   frozen median pose over the matched span, or the same test with each side's
 *   median pose taken out (centredRatio) <= 0.75.
 * - Tries: candidates in order of cost; a failing one doesn't stop the scan;
 *   up to 6 non-overlapping tries, each <= 1.5 x the best accepted cost.
 */
export function search(
  Q: (AFrame | null)[],
  S: (AFrame | null)[],
  cm: CostMatrix,
  tau: number,
  opts: {
    maxTries?: number;
    /** Real-movement test: cost <= moveK x the frozen-pose cost ... */
    moveK?: number;
    /** ... or the centred ratio <= centredK. */
    centredK?: number;
    /** Columns that count as real evidence (not masked, not a pause transition). */
    scored?: (m: number) => boolean;
  } = {},
): SearchResult {
  const maxTries = opts.maxTries ?? MAX_TRIES;
  const moveK = opts.moveK ?? 0.7;
  const centredK = opts.centredK ?? 0.75;
  const scored = opts.scored ?? ((m: number) => !!S[m]);
  const { N, M } = cm;
  const blocked = new Uint8Array(M);
  const tries: Found[] = [];
  let first: Found | null = null;
  const Qok = Q.filter((q): q is AFrame => !!q);
  for (let k = 0; k < MAX_CANDIDATES && tries.length < maxTries; k++) {
    const r = sdtw(cm, blocked);
    let e = -1;
    let best = Infinity;
    for (let m = 0; m < M; m++) {
      if (r.E[m] < best) {
        best = r.E[m];
        e = m;
      }
    }
    if (e < 0 || !Number.isFinite(best)) break;
    const s = r.start[e];
    const pairs = r.path(e);
    const frozen = medianFrame(S.slice(s, e + 1).filter((f): f is AFrame => !!f));
    const nullCost = frozen ? mean(Qok.map((q) => cost(q, frozen))) : Infinity;
    const centred = frozen ? centredRatio(Q, S, pairs, frozen) : Infinity;
    const cand: Found = {
      s,
      e,
      cost: best,
      span: (e - s + 1) / N,
      pairs,
      compression: r.compression(e),
      ceilOk: best <= tau,
      // real movement: clearly better than your frozen pose, either as is or with each
      // side's constant pose error taken out (a beginner's shallow knees raise both costs)
      moveOk: best <= moveK * nullCost || centred <= centredK,
      nullCost,
      centred,
    };
    if (!first) first = cand;
    // "<= 1.5 x the best": the best candidate overall, accepted or not
    if (best > 1.5 * first.cost) break; // costs only rise from here
    // a try must be mostly real frames: neutral cells cost as little as a good match
    const cols = new Set(pairs.map(([m]) => m));
    let real = 0;
    for (const m of cols) if (scored(m)) real++;
    const enough = real >= 0.5 * cols.size && real >= GRID_FPS;
    if (cand.ceilOk && cand.moveOk && enough) tries.push(cand);
    for (let m = s; m <= e; m++) blocked[m] = 1;
  }
  tries.sort((a, b) => a.s - b.s);
  return { tries, first, tau };
}

/* ------------------------------------------------------------------ */
/* Posture steps and holds (§3.5)                                       */
/* ------------------------------------------------------------------ */

/** Student frames whose cost to the teacher's median pose is <= tauP. */
export function inPosture(S: (AFrame | null)[], pose: AFrame, tauP: number): boolean[] {
  return S.map((s) => {
    if (!s) return false;
    const c = cost(s, pose);
    return Number.isFinite(c) && c <= tauP;
  });
}

/** Runs of true values that may bridge masked gaps of up to `gap` frames. */
export function runsBridged(ok: boolean[], masked: boolean[], gap: number): [number, number][] {
  const r: [number, number][] = [];
  let s = -1;
  let lastTrue = -1;
  for (let i = 0; i < ok.length; i++) {
    if (ok[i]) {
      if (s < 0) s = i;
      lastTrue = i;
    } else if (s >= 0 && !(masked[i] && i - lastTrue <= gap)) {
      r.push([s, lastTrue]);
      s = -1;
    }
  }
  if (s >= 0) r.push([s, lastTrue]);
  return r;
}

/** The steadiest window of `len` frames inside [a, b] (lowest mean displacement). */
export function steadiest(disp: number[], a: number, b: number, len: number): [number, number] {
  if (b - a + 1 <= len) return [a, b];
  let bi = a;
  let bv = Infinity;
  for (let i = a; i + len - 1 <= b; i++) {
    const v = mean(disp.slice(i, i + len));
    if (v < bv) {
      bv = v;
      bi = i;
    }
  }
  return [bi, bi + len - 1];
}

/* ------------------------------------------------------------------ */
/* Phases (§3.6): split the teacher step at its velocity minima          */
/* ------------------------------------------------------------------ */

export function phases(Q: (AFrame | null)[]): [number, number][] {
  const N = Q.length;
  const MIN = Math.round(0.5 * GRID_FPS);
  const MAX = 2 * GRID_FPS;
  const v = Q.map((q, n) => {
    const p = n ? Q[n - 1] : null;
    return q && p ? cost(q, p) : NaN;
  });
  for (let n = 0; n < N; n++) if (!Number.isFinite(v[n])) v[n] = n ? v[n - 1] : 0;
  if (N > 1) v[0] = v[1];
  // smooth over ±2 frames, so noise doesn't create minima
  const vs = v.map((_, n) => mean(v.slice(Math.max(0, n - 2), Math.min(N, n + 3))));
  let bounds: number[] = [];
  for (let n = 1; n < N - 1; n++) if (vs[n] <= vs[n - 1] && vs[n] < vs[n + 1]) bounds.push(n);
  let changed = true;
  while (changed) {
    changed = false;
    const b = [0, ...bounds, N];
    for (let i = 0; i + 1 < b.length; i++) {
      if (b[i + 1] - b[i] >= MIN) continue;
      const cand = [i, i + 1].filter((j) => j > 0 && j < b.length - 1);
      if (!cand.length) continue;
      const j = cand.sort((x, y) => vs[b[y]] - vs[b[x]])[0];
      bounds = bounds.filter((x) => x !== b[j]);
      changed = true;
      break;
    }
  }
  const out: [number, number][] = [];
  const split = (a: number, z: number) => {
    if (z - a <= MAX) {
      out.push([a, z]);
      return;
    }
    let bi = -1;
    let bv = Infinity;
    for (let n = a + MIN; n <= z - MIN; n++) {
      if (vs[n] < bv) {
        bv = vs[n];
        bi = n;
      }
    }
    if (bi < 0) {
      out.push([a, z]);
      return;
    }
    split(a, bi);
    split(bi, z);
  };
  const b = [0, ...bounds, N];
  for (let i = 0; i + 1 < b.length; i++) split(b[i], b[i + 1]);
  return out;
}
