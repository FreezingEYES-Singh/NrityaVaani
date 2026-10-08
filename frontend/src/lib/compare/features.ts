/**
 * Features for /compare (05-mvp.md §3.3). Pure TS.
 *
 * Everything works on a 14-joint body taken from MediaPipe's 33 landmarks,
 * in a y-up frame:
 * - p2: image landmarks (x right, y up), in units of the frame height;
 * - p3: world landmarks (metres, y up, z towards the camera).
 * Both flips (y and z) together are a rotation, so 3D handedness is kept.
 */
import { GRID_FPS, LM, type PartSwitches, type PoseTrack } from "./types.ts";
import { DEG, clamp, gauss, median, pct, rng, sgNoiseFactor, sgResidual } from "./math.ts";

export type V3 = [number, number, number];

/** Internal joint order (same as the design prototype). */
export const J = {
  LSH: 0, RSH: 1, LEL: 2, REL: 3, LWR: 4, RWR: 5,
  LHIP: 6, RHIP: 7, LKN: 8, RKN: 9, LAN: 10, RAN: 11, LTOE: 12, RTOE: 13,
} as const;
export const JOINTS = 14;
/** MediaPipe landmark index of each internal joint. */
export const J_TO_LM: number[] = [
  LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
  LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE, LM.L_FOOT, LM.R_FOOT,
];
/** Left/right partner of each internal joint. */
const SWAP = [1, 0, 3, 2, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12];

/** Swap a MediaPipe landmark index with its left/right partner (for markers on a mirrored reading). */
export function swapLandmark(i: number): number {
  if (i <= 0) return i;
  if (i >= 1 && i <= 10) {
    // eyes 1-6 and ears 7-8 and mouth 9-10 come in L/R pairs offset by 3/1
    if (i <= 3) return i + 3;
    if (i <= 6) return i - 3;
    return i % 2 === 1 ? i + 1 : i - 1;
  }
  return i % 2 === 1 ? i + 1 : i - 1;
}

export interface Body {
  p2: V3[];
  p3: V3[] | null;
  vis: number[];
}

/** One frame on the 15 fps analysis grid. body = null means masked. */
export interface GFrame {
  t: number;
  body: Body | null;
}

/**
 * Resample a track onto the analysis grid. Each grid time takes the nearest
 * usable frame within one grid step; otherwise the grid frame is masked.
 */
export function resample(track: PoseTrack, fps = GRID_FPS): GFrame[] {
  const fr = track.frames.filter((f) => Number.isFinite(f.t)).sort((a, b) => a.t - b.t);
  const [t0, t1] = track.range;
  const n = Math.max(0, Math.floor((t1 - t0) * fps + 1e-6) + 1);
  const out: GFrame[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = t0 + k / fps;
    while (j + 1 < fr.length && Math.abs(fr[j + 1].t - t) <= Math.abs(fr[j].t - t)) j++;
    const f = fr[j];
    let body: Body | null = null;
    if (f && Math.abs(f.t - t) <= 1 / fps && f.ok && f.img) {
      const p2: V3[] = [];
      const p3: V3[] | null = f.world ? [] : null;
      const vis: number[] = [];
      for (let q = 0; q < JOINTS; q++) {
        const a = f.img[J_TO_LM[q]];
        p2.push([a.x, -a.y, -a.z]);
        vis.push(Number.isFinite(a.v) ? a.v : 0);
        if (p3 && f.world) {
          const w = f.world[J_TO_LM[q]];
          p3.push([w.x, -w.y, -w.z]);
        }
      }
      body = { p2, p3, vis };
    }
    out.push({ t, body });
  }
  return out;
}

/** The mirror image of a body: left and right swapped, x flipped. */
export function mirrorBody(b: Body): Body {
  const flip = (p: V3[]): V3[] => p.map((_, j) => {
    const q = p[SWAP[j]];
    return [-q[0], q[1], q[2]];
  });
  return { p2: flip(b.p2), p3: b.p3 ? flip(b.p3) : null, vis: b.vis.map((_, j) => b.vis[SWAP[j]]) };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3) => Math.sqrt(dot(a, a));
const unit = (a: V3): V3 => scale(a, 1 / (norm(a) || 1e-9));
const mid = (a: V3, b: V3): V3 => scale(add(a, b), 0.5);
const len2 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ------------------------------------------------------------------ */
/* Take-level geometry: de-roll angle and reference lengths             */
/* ------------------------------------------------------------------ */

/** The 10 alignment segments: upper arms, forearms, thighs, shins, torso, shoulder line. */
export const SEGMENTS: [number, number][] = [
  [J.LSH, J.LEL], [J.RSH, J.REL], [J.LEL, J.LWR], [J.REL, J.RWR],
  [J.LHIP, J.LKN], [J.RHIP, J.RKN], [J.LKN, J.LAN], [J.RKN, J.RAN],
  [-1, -2], // torso: mid hip -> mid shoulder
  [J.RSH, J.LSH], // shoulder line
];
export const SEG_PART: ("arms" | "legs" | "torso")[] = [
  "arms", "arms", "arms", "arms", "legs", "legs", "legs", "legs", "torso", "torso",
];
/** Tolerance of each segment's direction, from the tip tolerances (§3.3), in degrees. */
const SEG_TOL_DEG = [15, 15, 20, 20, 15, 15, 15, 15, 8, 8];
/** Limb segments whose foreshortening is an alignment feature (up/down movement). */
const LEN_SEGS = [0, 1, 2, 3, 4, 5, 6, 7];
const LEN_W = 0.25;
const HIP_W = 1;
/** Tolerance of the hip-height and segment-length features (torso lengths / ratio). */
const HIP_TOL = 0.1;
const LEN_TOL = 0.1;

function segEnds(p: V3[], s: number): [V3, V3] {
  if (s === 8) return [mid(p[J.LHIP], p[J.RHIP]), mid(p[J.LSH], p[J.RSH])];
  const [a, b] = SEGMENTS[s];
  return [p[a], p[b]];
}
function segVis(vis: number[], s: number): number {
  if (s === 8) return Math.min(vis[J.LHIP], vis[J.RHIP], vis[J.LSH], vis[J.RSH]);
  const [a, b] = SEGMENTS[s];
  return Math.min(vis[a], vis[b]);
}

export interface TakeGeom {
  /** Median torso angle from vertical (radians); bodies are rotated by -roll before 2D features. */
  roll: number;
  /** 90th percentile torso length (image units). */
  torso: number;
  /** 90th percentile 2D length of each limb segment (image units). */
  seg: number[];
  /** 90th percentile hip height above the lower ankle, torso lengths (a "standing tall" reference). */
  hipTall: number;
}

export function takeGeom(frames: GFrame[]): TakeGeom {
  const rolls: number[] = [];
  const tors: number[] = [];
  const segs: number[][] = LEN_SEGS.map(() => []);
  for (const f of frames) {
    if (!f.body) continue;
    const [a, b] = segEnds(f.body.p2, 8);
    const d = sub(b, a);
    if (segVis(f.body.vis, 8) >= 0.5) {
      rolls.push(Math.atan2(d[0], d[1]));
      tors.push(Math.hypot(d[0], d[1]));
    }
    for (const s of LEN_SEGS) {
      if (segVis(f.body.vis, s) < 0.5) continue;
      const [p, q] = segEnds(f.body.p2, s);
      segs[s].push(len2(p, q));
    }
  }
  const roll = rolls.length ? median(rolls) : 0;
  const torso = tors.length ? pct(tors, 0.9) : 0.25;
  const g: TakeGeom = { roll, torso: torso || 0.25, seg: segs.map((s) => (s.length ? pct(s, 0.9) : NaN)), hipTall: NaN };
  const hips: number[] = [];
  for (const f of frames) {
    if (!f.body) continue;
    const p = derolled(f.body.p2, g.roll);
    const h = hipHeight(p, f.body.vis, g.torso);
    if (Number.isFinite(h)) hips.push(h);
  }
  g.hipTall = hips.length ? pct(hips, 0.9) : NaN;
  return g;
}

function derolled(p: V3[], roll: number): V3[] {
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  // rotate by -roll about the origin, so the median torso axis points straight up
  return p.map(([x, y, z]) => [x * c - y * s, x * s + y * c, z]);
}

function hipHeight(p: V3[], vis: number[], torso: number): number {
  if (Math.min(vis[J.LHIP], vis[J.RHIP], vis[J.LAN], vis[J.RAN]) < 0.5) return NaN;
  const mh = mid(p[J.LHIP], p[J.RHIP]);
  return (mh[1] - Math.min(p[J.LAN][1], p[J.RAN][1])) / torso;
}

/* ------------------------------------------------------------------ */
/* Alignment features                                                   */
/* ------------------------------------------------------------------ */

/** Feature layout: 10 unit directions (20 numbers), hip height, 8 length ratios. */
export const A_DIRS = 10;
export const A_LEN = 8;
export const A_DIM = A_DIRS * 2 + 1 + A_LEN;
/** One weight per term: 10 directions, hip height, 8 lengths. */
export const A_TERMS = A_DIRS + 1 + A_LEN;

export interface AFrame {
  f: Float64Array;
  w: Float64Array;
}

function partOn(parts: PartSwitches, p: "arms" | "legs" | "torso") {
  return parts[p];
}

export function alignFrame(b: Body, g: TakeGeom, parts: PartSwitches): AFrame {
  const p = derolled(b.p2, g.roll);
  const f = new Float64Array(A_DIM);
  const w = new Float64Array(A_TERMS);
  for (let s = 0; s < A_DIRS; s++) {
    const [a, c] = segEnds(p, s);
    const d = unit([c[0] - a[0], c[1] - a[1], 0]);
    f[2 * s] = d[0];
    f[2 * s + 1] = d[1];
    w[s] = partOn(parts, SEG_PART[s]) ? clamp(segVis(b.vis, s), 0, 1) : 0;
  }
  const h = hipHeight(p, b.vis, g.torso);
  f[2 * A_DIRS] = Number.isFinite(h) ? h : 0;
  w[A_DIRS] = parts.legs && Number.isFinite(h) ? HIP_W * Math.min(b.vis[J.LAN], b.vis[J.RAN]) : 0;
  for (let k = 0; k < A_LEN; k++) {
    const s = LEN_SEGS[k];
    const [a, c] = segEnds(p, s);
    const r = len2(a, c) / g.seg[s];
    const okR = Number.isFinite(r);
    f[2 * A_DIRS + 1 + k] = okR ? Math.min(r, 1.5) : 0;
    w[A_DIRS + 1 + k] = okR && partOn(parts, SEG_PART[s]) ? LEN_W * clamp(segVis(b.vis, s), 0, 1) : 0;
  }
  return { f, w };
}

/** Minimum total weight for a frame pair to be judged (otherwise it's "doubtful", i.e. masked). */
export const MIN_WEIGHT = 2;

/** Cost between two alignment frames: weighted mean distance per term (about radians for directions). */
export function cost(a: AFrame, b: AFrame): number {
  let s = 0;
  let W = 0;
  for (let g = 0; g < A_DIRS; g++) {
    const w = Math.min(a.w[g], b.w[g]);
    if (w <= 0) continue;
    s += w * Math.hypot(a.f[2 * g] - b.f[2 * g], a.f[2 * g + 1] - b.f[2 * g + 1]);
    W += w;
  }
  for (let k = 0; k <= A_LEN; k++) {
    const w = Math.min(a.w[A_DIRS + k], b.w[A_DIRS + k]);
    if (w <= 0) continue;
    s += w * Math.abs(a.f[2 * A_DIRS + k] - b.f[2 * A_DIRS + k]);
    W += w;
  }
  return W >= MIN_WEIGHT ? s / W : NaN;
}

/** Componentwise median of alignment frames (directions renormalised); weights = median weights. */
export function medianFrame(fs: AFrame[]): AFrame | null {
  if (!fs.length) return null;
  const f = new Float64Array(A_DIM);
  const w = new Float64Array(A_TERMS);
  const col: number[] = new Array(fs.length);
  for (let c = 0; c < A_DIM; c++) {
    for (let i = 0; i < fs.length; i++) col[i] = fs[i].f[c];
    f[c] = median(col);
  }
  for (let c = 0; c < A_TERMS; c++) {
    for (let i = 0; i < fs.length; i++) col[i] = fs[i].w[c];
    w[c] = median(col);
  }
  for (let g = 0; g < A_DIRS; g++) {
    const n = Math.hypot(f[2 * g], f[2 * g + 1]) || 1;
    f[2 * g] /= n;
    f[2 * g + 1] /= n;
  }
  return { f, w };
}

/** A standing pose in feature space: limbs straight down, torso up, shoulders level, standing tall. */
export function neutralFrame(g: TakeGeom): AFrame {
  const f = new Float64Array(A_DIM);
  const w = new Float64Array(A_TERMS).fill(1);
  for (let s = 0; s < 8; s++) {
    f[2 * s] = 0;
    f[2 * s + 1] = -1;
  }
  f[16] = 0;
  f[17] = 1; // torso up
  f[18] = -1;
  f[19] = 0; // R shoulder -> L shoulder points to image left when facing the camera
  f[20] = Number.isFinite(g.hipTall) ? g.hipTall : 1.7;
  w[A_DIRS] = HIP_W;
  for (let k = 0; k < A_LEN; k++) {
    f[2 * A_DIRS + 1 + k] = 1;
    w[A_DIRS + 1 + k] = LEN_W;
  }
  return { f, w };
}

/**
 * The cost of a pose that is off by each feature's tolerance (all at once),
 * used as the floor of the found tests and as the posture threshold (§3.4–3.5).
 */
export function toleranceCost(parts: PartSwitches): number {
  let s = 0;
  let W = 0;
  for (let g = 0; g < A_DIRS; g++) {
    if (!parts[SEG_PART[g]]) continue;
    s += 2 * Math.sin((SEG_TOL_DEG[g] * DEG) / 2);
    W += 1;
  }
  if (parts.legs) {
    s += HIP_W * HIP_TOL;
    W += HIP_W;
  }
  for (const seg of LEN_SEGS) {
    if (!parts[SEG_PART[seg]]) continue;
    s += LEN_W * LEN_TOL;
    W += LEN_W;
  }
  return W ? s / W : NaN;
}

/** Per-frame velocity of the direction features (for the mirror decision). */
export function dirVelocity(a: AFrame, prev: AFrame): number[] {
  const v: number[] = [];
  for (let c = 0; c < 2 * A_DIRS; c++) v.push(a.f[c] - prev.f[c]);
  return v;
}

/* ------------------------------------------------------------------ */
/* Jitter (§3.2.1): one definition, per video                           */
/* ------------------------------------------------------------------ */

export interface Jitter {
  /** Landmark position noise SD, torso lengths. */
  pos: number;
  /** Noise of the alignment features, in cost units. */
  cost: number;
  /** World landmark noise SD, metres (for the 3D angle bias). */
  world: number;
}

const FIT_HALF = Math.round(GRID_FPS / 2); // a 1 s local fit

/** Runs of consecutive unmasked frames. */
export function runsOf(ok: boolean[]): [number, number][] {
  const r: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= ok.length; i++) {
    if (i < ok.length && ok[i]) {
      if (s < 0) s = i;
    } else if (s >= 0) {
      r.push([s, i - 1]);
      s = -1;
    }
  }
  return r;
}

function robustSD(r: number[]): number {
  const a = r.filter(Number.isFinite).map(Math.abs);
  return a.length ? 1.4826 * median(a) : NaN;
}

export function measureJitter(frames: GFrame[], af: (AFrame | null)[], g: TakeGeom): Jitter {
  const k = sgNoiseFactor(FIT_HALF);
  const pos: number[] = [];
  const world: number[] = [];
  const nanSeries = () => new Array<number>(frames.length).fill(NaN);
  for (let j = 0; j < JOINTS; j++) {
    for (let ax = 0; ax < 2; ax++) {
      const s = nanSeries();
      const w = nanSeries();
      frames.forEach((f, i) => {
        if (!f.body || f.body.vis[j] < 0.5) return;
        const p = derolled([f.body.p2[j]], g.roll)[0];
        s[i] = p[ax] / g.torso;
        if (f.body.p3) w[i] = f.body.p3[j][ax];
      });
      const r = robustSD(sgResidual(s, FIT_HALF));
      if (Number.isFinite(r)) pos.push(r * k);
      const rw = robustSD(sgResidual(w, FIT_HALF));
      if (Number.isFinite(rw)) world.push(rw * k);
    }
  }
  // feature noise: cost of each frame against its own local fit
  const fitCost: number[] = [];
  for (let i = FIT_HALF; i < af.length - FIT_HALF; i++) {
    const a = af[i];
    if (!a) continue;
    let ok = true;
    for (let d = -FIT_HALF; d <= FIT_HALF; d++) if (!af[i + d]) ok = false;
    if (!ok) continue;
    const fit = new Float64Array(A_DIM);
    const sw = sgW();
    for (let d = -FIT_HALF; d <= FIT_HALF; d++) {
      const b = af[i + d]!;
      for (let c = 0; c < A_DIM; c++) fit[c] += sw[d + FIT_HALF] * b.f[c];
    }
    const fc = cost(a, { f: fit, w: a.w });
    if (Number.isFinite(fc)) fitCost.push(fc);
  }
  return {
    pos: pos.length ? median(pos) : 0.02,
    cost: fitCost.length ? median(fitCost) * k * JITTER_COST_K : 0.03,
    world: world.length ? median(world) : 0.01,
  };
}
let SGW: number[] | null = null;
function sgW() {
  if (!SGW) {
    const m = FIT_HALF;
    const den = (2 * m - 1) * (2 * m + 1) * (2 * m + 3);
    SGW = [];
    for (let i = -m; i <= m; i++) SGW.push((3 * (3 * m * m + 3 * m - 1) - 15 * i * i) / den);
  }
  return SGW;
}
/**
 * Turns the median residual cost into the mean cost of noise against the
 * true pose. Calibrated on synthetic still takes (testing/calibrate.ts).
 */
export const JITTER_COST_K = 1.0;

/* ------------------------------------------------------------------ */
/* Stillness (§3.2.3): windowed displacement against 3 x jitter          */
/* ------------------------------------------------------------------ */

const STILL_HALF = Math.round(GRID_FPS / 2); // ±0.5 s
export const STILL_K = 3;

/** Per frame: the largest RMS displacement of any visible joint over ±0.5 s, in torso lengths. NaN if unknown. */
export function displacement(frames: GFrame[], g: TakeGeom): number[] {
  const P = frames.map((f) => (f.body ? derolled(f.body.p2, g.roll) : null));
  const out = new Array<number>(frames.length).fill(NaN);
  for (let t = 0; t < frames.length; t++) {
    const a = Math.max(0, t - STILL_HALF);
    const b = Math.min(frames.length - 1, t + STILL_HALF);
    const idx: number[] = [];
    for (let i = a; i <= b; i++) if (P[i]) idx.push(i);
    if (idx.length < STILL_HALF + 1) continue;
    let worst = 0;
    for (let j = 0; j < JOINTS; j++) {
      let cx = 0;
      let cy = 0;
      let n = 0;
      for (const i of idx) {
        if (frames[i].body!.vis[j] < 0.5) continue;
        cx += P[i]![j][0];
        cy += P[i]![j][1];
        n++;
      }
      if (n < STILL_HALF + 1) continue;
      cx /= n;
      cy /= n;
      let ss = 0;
      for (const i of idx) {
        if (frames[i].body!.vis[j] < 0.5) continue;
        ss += (P[i]![j][0] - cx) ** 2 + (P[i]![j][1] - cy) ** 2;
      }
      worst = Math.max(worst, Math.sqrt(ss / n) / g.torso);
    }
    out[t] = worst;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Tip features (§3.3 table)                                            */
/* ------------------------------------------------------------------ */

export const TIP_KEYS = [
  "kneeL", "kneeR", "elbL", "elbR", "armL", "armR", "kneeSp", "footSp", "tilt", "bob",
] as const;
export type TipKey = (typeof TIP_KEYS)[number];

export interface TipF {
  v: Record<TipKey, number>;
  /** Visibility of the joints behind each feature (min over them). */
  vis: Record<TipKey, number>;
  /** Knee roll-in angle (+ = the knee bends more toward the midline than the foot points), degrees. */
  rollL: number;
  rollR: number;
  /** > 0 = the knee sits inside the ankle on screen (hip widths). */
  medL: number;
  medR: number;
  /** Body turn from the 3D shoulder line, degrees (0 = facing the camera). */
  yaw: number;
}

const ang3 = (a: V3, b: V3, c: V3) =>
  Math.acos(clamp(dot(unit(sub(a, b)), unit(sub(c, b))), -1, 1)) / DEG;
const ang2 = (u: V3, v: V3) => {
  const a = unit([u[0], u[1], 0]);
  const b = unit([v[0], v[1], 0]);
  return Math.acos(clamp(a[0] * b[0] + a[1] * b[1], -1, 1)) / DEG;
};
const fromVertical = (u: V3) => Math.atan2(u[0], u[1]) / DEG;

function rollIn(p: V3[], k: 0 | 1): number {
  const H = p[J.LHIP + k];
  const K = p[J.LKN + k];
  const A = p[J.LAN + k];
  const T = p[J.LTOE + k];
  const u = unit(sub(A, H));
  const perp = (v: V3) => sub(v, scale(u, dot(v, u)));
  const b = perp(sub(K, H));
  const f = perp(sub(T, A));
  const med = unit(perp(sub(p[J.LHIP + (1 - k)], H)));
  if (norm(b) < 1e-6 || norm(f) < 1e-6) return NaN;
  const bu = unit(b);
  const fu = unit(f);
  const angle = Math.acos(clamp(dot(bu, fu), -1, 1)) / DEG;
  const sign = Math.sign(dot(sub(bu, fu), med)) || 1;
  return sign * angle;
}

export function tipFrame(b: Body, g: TakeGeom): TipF {
  const p = derolled(b.p2, g.roll);
  const w = b.p3;
  const v = b.vis;
  const mh = mid(p[J.LHIP], p[J.RHIP]);
  const ms = mid(p[J.LSH], p[J.RSH]);
  const ma = mid(p[J.LAN], p[J.RAN]);
  const hipW = Math.abs(p[J.LHIP][0] - p[J.RHIP][0]);
  const wideOk = hipW >= 0.25 * g.torso;
  const tdown = sub(mh, ms);
  const m = Math.min;
  const medial = (k: 0 | 1) => {
    const s = Math.sign(p[J.LHIP + k][0] - p[J.LHIP + (1 - k)][0]) || (k === 0 ? 1 : -1);
    return wideOk ? (-s * (p[J.LKN + k][0] - p[J.LAN + k][0])) / hipW : NaN;
  };
  let yaw = NaN;
  if (w) {
    const d = sub(w[J.LSH], w[J.RSH]);
    yaw = Math.atan2(d[2], d[0]) / DEG;
  }
  const vals: Record<TipKey, number> = {
    kneeL: w ? ang3(w[J.LHIP], w[J.LKN], w[J.LAN]) : NaN,
    kneeR: w ? ang3(w[J.RHIP], w[J.RKN], w[J.RAN]) : NaN,
    elbL: w ? ang3(w[J.LSH], w[J.LEL], w[J.LWR]) : NaN,
    elbR: w ? ang3(w[J.RSH], w[J.REL], w[J.RWR]) : NaN,
    armL: ang2(tdown, sub(p[J.LEL], p[J.LSH])),
    armR: ang2(tdown, sub(p[J.REL], p[J.RSH])),
    kneeSp: wideOk ? Math.abs(p[J.LKN][0] - p[J.RKN][0]) / hipW : NaN,
    footSp: wideOk ? Math.abs(p[J.LAN][0] - p[J.RAN][0]) / hipW : NaN,
    tilt: fromVertical(sub(ms, mh)) - fromVertical(sub(mh, ma)),
    bob: (mh[1] - Math.min(p[J.LAN][1], p[J.RAN][1])) / g.torso,
  };
  const vis: Record<TipKey, number> = {
    kneeL: m(v[J.LHIP], v[J.LKN], v[J.LAN]),
    kneeR: m(v[J.RHIP], v[J.RKN], v[J.RAN]),
    elbL: m(v[J.LSH], v[J.LEL], v[J.LWR]),
    elbR: m(v[J.RSH], v[J.REL], v[J.RWR]),
    armL: m(v[J.LSH], v[J.LEL], v[J.LHIP], v[J.RHIP]),
    armR: m(v[J.RSH], v[J.REL], v[J.LHIP], v[J.RHIP]),
    kneeSp: m(v[J.LKN], v[J.RKN], v[J.LHIP], v[J.RHIP]),
    footSp: m(v[J.LAN], v[J.RAN], v[J.LHIP], v[J.RHIP]),
    tilt: m(v[J.LSH], v[J.RSH], v[J.LHIP], v[J.RHIP], v[J.LAN], v[J.RAN]),
    bob: m(v[J.LHIP], v[J.RHIP], v[J.LAN], v[J.RAN]),
  };
  return {
    v: vals,
    vis,
    rollL: w ? rollIn(w, 0) : NaN,
    rollR: w ? rollIn(w, 1) : NaN,
    medL: medial(0),
    medR: medial(1),
    yaw,
  };
}

/** The four 3D angle features, whose depth noise biases them (§3.3 "Noise bias on 3D angles"). */
export const ANGLE3D: TipKey[] = ["kneeL", "kneeR", "elbL", "elbR"];

/**
 * Bias that a video's noise adds to each 3D angle: noise of SD `sd` (metres)
 * is applied to a reference world pose 20 times, and the mean change is the bias.
 * Depth (z) noise is taken as 3x the measured x/y noise, as MediaPipe's depth is far noisier.
 */
export function angleBias(ref: V3[], sd: number, seed = 1): Record<string, number> {
  const rnd = rng(seed);
  const clean = angles3(ref);
  const acc: Record<string, number> = { kneeL: 0, kneeR: 0, elbL: 0, elbR: 0 };
  const DRAWS = 20;
  for (let d = 0; d < DRAWS; d++) {
    const noisy = ref.map((q) => [q[0] + sd * gauss(rnd), q[1] + sd * gauss(rnd), q[2] + 3 * sd * gauss(rnd)] as V3);
    const a = angles3(noisy);
    for (const k of Object.keys(acc)) acc[k] += (a[k] - clean[k]) / DRAWS;
  }
  return acc;
}
function angles3(w: V3[]): Record<string, number> {
  return {
    kneeL: ang3(w[J.LHIP], w[J.LKN], w[J.LAN]),
    kneeR: ang3(w[J.RHIP], w[J.RKN], w[J.RAN]),
    elbL: ang3(w[J.LSH], w[J.LEL], w[J.LWR]),
    elbR: ang3(w[J.RSH], w[J.REL], w[J.RWR]),
  };
}
