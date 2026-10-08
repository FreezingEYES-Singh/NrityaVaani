/**
 * Offline cleanup of a finished take: the jitter-proof pass.
 *
 * `smooth.ts` runs live, which forces it to be *causal* — it can only see
 * frames that have already happened, so every degree of steadiness it buys
 * costs lag. There is no way around that while the video is still playing.
 *
 * Once a take is baked the constraint is gone. The whole clip is on hand, so a
 * frame can be judged against the frames *after* it as well as before, and
 * three things become possible that a live filter cannot do at any price:
 *
 *   1. **Zero lag.** A symmetric window has no phase delay by construction.
 *      Not "small" delay — none. A hand lands on exactly the frame it landed
 *      on in the video.
 *   2. **Outlier removal.** A single frame where the tracker threw an elbow
 *      across the body is obvious when you can see both sides of it, and
 *      invisible when you cannot. Live, the best you can do is refuse to
 *      follow it quickly; offline it can be deleted outright.
 *   3. **Gap filling.** A hand the detector missed for eight frames can be
 *      interpolated from the poses on either side. Live, there is no "after"
 *      to interpolate from, so the fingers snap to rest and snap back — which
 *      reads as the worst jitter in the whole figure, and is not jitter at all.
 *
 * The smoothing is **bilateral**, not Gaussian, and that is the choice that
 * decides whether this looks good or looks like mush. A plain Gaussian window
 * treats a sharp strike and a noisy wobble identically, so the settings needed
 * to kill the wobble also round off every crisp adavu — the motion goes quiet
 * and lifeless. Bilateral weighting adds a second term: a neighbouring frame
 * counts only if it is *also* rotationally close. Noise, which is small and
 * random, gets averaged away; a genuine fast transition falls outside the
 * angular window and is left alone. Held poses lock solid, strikes stay sharp.
 */

import * as THREE from "three";
import type { Clip } from "./clip";
import { DIMS, PER_JOINT } from "./poseCodec";
import { JOINTS, JOINT_COUNT } from "./skeleton";

export interface PolishOptions {
  /**
   * Per-frame flags: was a hand actually detected this frame.
   *
   * Where it was not, `retarget` left that hand's fifteen finger joints at
   * rest — a confident, wrong, and very visible pose. Marking those frames
   * lets them be interpolated across instead of averaged in, which is the
   * difference between fingers that drift through a gap and fingers that
   * flick open and shut.
   */
  hands?: { left: Uint8Array; right: Uint8Array };
  /** Frames either side to consider when judging a frame an outlier. */
  outlierWindow?: number;
  /** How far from its neighbours' consensus a frame may sit, in degrees. */
  outlierThreshold?: number;
  /** Temporal width of the smoothing window, in frames. */
  sigmaT?: number;
  /**
   * Angular width, in degrees.
   *
   * The dial that matters. Below it, differences are treated as noise and
   * averaged out; above it, as real movement and preserved. Roughly: the
   * largest per-frame rotation you are willing to call jitter.
   */
  sigmaA?: number;
  /** Repeats of the smoothing pass. Two is usually enough; more only flattens. */
  passes?: number;
}

/**
 * Tuned against the sample take, where raw retargeting jitters about 4.3° a
 * frame and the fingers are the worst of it.
 *
 * These are deliberately heavier than a real-time filter would dare, because
 * nothing here is real time. Each bilateral pass compounds the last, so three
 * narrow passes suppress far more than one wide one while keeping the angular
 * gate tight enough that a fast strike still outruns it — the wide single pass
 * is what makes motion look underwater.
 */
const DEFAULTS: Required<Omit<PolishOptions, "hands">> = {
  outlierWindow: 3,
  outlierThreshold: 20,
  sigmaT: 3,
  sigmaA: 9,
  passes: 3,
};

export interface PolishStats {
  frames: number;
  /** Single-frame outliers replaced by their neighbours' consensus. */
  outliers: number;
  /** Joint-frames filled in because nothing was detected there. */
  filled: number;
  /** Mean high-frequency jitter before and after, in degrees. */
  jitterBefore: number;
  jitterAfter: number;
}

// --- quaternion helpers, on flat arrays -------------------------------------

/** Reads joint `j` of frame `f`. */
function get(p: Float32Array, f: number, j: number, into: THREE.Quaternion) {
  const at = f * DIMS + j * PER_JOINT;
  return into.set(p[at], p[at + 1], p[at + 2], p[at + 3]);
}

function put(p: Float32Array, f: number, j: number, q: THREE.Quaternion) {
  const at = f * DIMS + j * PER_JOINT;
  p[at] = q.x;
  p[at + 1] = q.y;
  p[at + 2] = q.z;
  p[at + 3] = q.w;
}

/** Angle between two rotations, degrees. Absolute, because q and -q are equal. */
function angleBetween(x: THREE.Quaternion, y: THREE.Quaternion) {
  return THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(x.dot(y)))));
}

interface Term {
  q: THREE.Quaternion;
  w: number;
}

/**
 * Weighted average of rotations, as a normalised linear blend.
 *
 * Exact spherical averaging needs an iterative solve; the linear one is
 * accurate to well under a degree for the spreads involved here — a window
 * whose members are 30 degrees apart is one this filter has already decided
 * not to average — and it is the difference between a pass that runs in a
 * second and one that runs in a minute.
 *
 * Every term is sign-flipped onto the same hemisphere as the reference first.
 * Skipping that averages a rotation with its own negation and lands on
 * something near zero, which normalises to noise.
 */
function blend(terms: Term[], ref: THREE.Quaternion, into: THREE.Quaternion) {
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 0;
  for (const t of terms) {
    const s = t.q.dot(ref) < 0 ? -t.w : t.w;
    x += s * t.q.x;
    y += s * t.q.y;
    z += s * t.q.z;
    w += s * t.q.w;
  }
  const len = Math.hypot(x, y, z, w);
  if (len < 1e-9) return into.copy(ref);
  return into.set(x / len, y / len, z / len, w / len);
}

/** Mean deviation of each frame from the straight line through its neighbours. */
function jitterOf(p: Float32Array, n: number) {
  const prev = new THREE.Quaternion();
  const next = new THREE.Quaternion();
  const cur = new THREE.Quaternion();
  const mid = new THREE.Quaternion();
  const terms: Term[] = [
    { q: prev, w: 1 },
    { q: next, w: 1 },
  ];

  let sum = 0;
  let count = 0;
  for (let f = 1; f < n - 1; f++) {
    for (let j = 0; j < JOINT_COUNT; j++) {
      get(p, f - 1, j, prev);
      get(p, f + 1, j, next);
      get(p, f, j, cur);
      blend(terms, prev, mid);
      sum += angleBetween(mid, cur);
      count++;
    }
  }
  return count ? sum / count : 0;
}

// --- the passes -------------------------------------------------------------

/**
 * Which joints have no real data on which frames.
 *
 * Only the fingers can go missing this way: the body is solved from the pose
 * model, which returns something for every frame, but a hand is a separate
 * detection that either found the hand or did not.
 */
function missingMask(n: number, hands: PolishOptions["hands"]) {
  const mask = new Uint8Array(n * JOINT_COUNT);
  if (!hands) return mask;

  for (let j = 0; j < JOINT_COUNT; j++) {
    const joint = JOINTS[j];
    if (joint.group !== "hand") continue;
    const flags = joint.side === "L" ? hands.left : hands.right;
    if (!flags) continue;
    for (let f = 0; f < n; f++) if (!flags[f]) mask[f * JOINT_COUNT + j] = 1;
  }
  return mask;
}

/**
 * Interpolates every joint across the frames where it had no data.
 *
 * A run with real poses on both sides is slerped through. A run that reaches
 * either end of the take is held at the nearest real pose rather than
 * extrapolated — a hand that was never found in the first second has no
 * evidence behind a guess about it, and holding still is the honest answer.
 */
function fillGaps(p: Float32Array, n: number, mask: Uint8Array) {
  const from = new THREE.Quaternion();
  const to = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  let filled = 0;

  for (let j = 0; j < JOINT_COUNT; j++) {
    let f = 0;
    while (f < n) {
      if (!mask[f * JOINT_COUNT + j]) {
        f++;
        continue;
      }

      const start = f;
      while (f < n && mask[f * JOINT_COUNT + j]) f++;
      const end = f; // one past the gap

      const before = start - 1;
      const after = end;
      const haveBefore = before >= 0;
      const haveAfter = after < n;
      if (!haveBefore && !haveAfter) break; // this joint is empty for the whole take

      if (haveBefore) get(p, before, j, from);
      if (haveAfter) get(p, after, j, to);
      if (!haveBefore) from.copy(to);
      if (!haveAfter) to.copy(from);
      if (from.dot(to) < 0) to.set(-to.x, -to.y, -to.z, -to.w);

      const span = end - start + 1;
      for (let k = start; k < end; k++) {
        q.copy(from).slerp(to, (k - start + 1) / span);
        put(p, k, j, q);
        filled++;
      }
    }
  }
  return filled;
}

/**
 * Replaces frames that disagree with the neighbourhood around them.
 *
 * A Hampel test, per joint: compare a frame against the consensus of the
 * window either side and, if it sits further away than the threshold, take the
 * consensus instead. This is aimed squarely at the tracker's worst failure — a
 * single frame where a limb is reported somewhere it has never been and never
 * goes again, which smoothing alone only smears over its neighbours.
 */
function rejectOutliers(p: Float32Array, n: number, window: number, threshold: number) {
  const out = new Float32Array(p);
  const cur = new THREE.Quaternion();
  const consensus = new THREE.Quaternion();
  let replaced = 0;

  // Allocated once per joint rather than per frame: the window is a fixed size
  // and its contents are overwritten each time.
  const pool: THREE.Quaternion[] = [];
  for (let i = 0; i < window * 2; i++) pool.push(new THREE.Quaternion());

  for (let j = 0; j < JOINT_COUNT; j++) {
    for (let f = 0; f < n; f++) {
      const lo = Math.max(0, f - window);
      const hi = Math.min(n - 1, f + window);

      const terms: Term[] = [];
      for (let k = lo; k <= hi; k++) {
        if (k === f) continue;
        terms.push({ q: get(p, k, j, pool[terms.length]), w: 1 });
      }
      if (terms.length < 2) continue;

      get(p, f, j, cur);
      blend(terms, terms[0].q, consensus);
      if (angleBetween(cur, consensus) > threshold) {
        put(out, f, j, consensus);
        replaced++;
      }
    }
  }

  p.set(out);
  return replaced;
}

/** One bilateral pass: smooth in time, but only across rotationally-near frames. */
function bilateral(p: Float32Array, n: number, sigmaT: number, sigmaA: number) {
  const out = new Float32Array(p);
  const radius = Math.max(1, Math.ceil(sigmaT * 2.5));
  const cur = new THREE.Quaternion();
  const result = new THREE.Quaternion();
  const t2 = 2 * sigmaT * sigmaT;
  const a2 = 2 * sigmaA * sigmaA;

  const pool: THREE.Quaternion[] = [];
  for (let i = 0; i <= radius * 2; i++) pool.push(new THREE.Quaternion());

  for (let j = 0; j < JOINT_COUNT; j++) {
    for (let f = 0; f < n; f++) {
      get(p, f, j, cur);
      const terms: Term[] = [];

      for (let k = Math.max(0, f - radius); k <= Math.min(n - 1, f + radius); k++) {
        const q = get(p, k, j, pool[terms.length]);
        const dt = k - f;
        const da = angleBetween(cur, q);
        const w = Math.exp(-(dt * dt) / t2) * Math.exp(-(da * da) / a2);
        if (w > 1e-4) terms.push({ q, w });
      }

      blend(terms, cur, result);
      put(out, f, j, result);
    }
  }

  p.set(out);
}

/**
 * Cleans a clip in place and reports what it did.
 *
 * Order matters and is not interchangeable. Outliers go first, because a wild
 * frame left in place poisons every window that overlaps it — including the
 * angular term, which would read the wild frame as a genuine fast movement and
 * politely decline to smooth it. Gaps are filled second, so the smoothing has
 * real values everywhere instead of averaging in rest poses. Smoothing is last.
 */
export function polishClip(clip: Clip, opts: PolishOptions = {}): PolishStats {
  const o = { ...DEFAULTS, ...opts };
  const n = clip.meta.count;
  const p = clip.poses;

  const jitterBefore = jitterOf(p, n);
  const outliers = rejectOutliers(p, n, o.outlierWindow, o.outlierThreshold);
  const filled = fillGaps(p, n, missingMask(n, opts.hands));
  for (let i = 0; i < o.passes; i++) bilateral(p, n, o.sigmaT, o.sigmaA);
  const jitterAfter = jitterOf(p, n);

  return {
    frames: n,
    outliers,
    filled,
    jitterBefore: +jitterBefore.toFixed(3),
    jitterAfter: +jitterAfter.toFixed(3),
  };
}
