/**
 * Synthetic dancers for the /compare test suite (test-only, pure TS).
 *
 * A port of the design prototype's stick-figure model
 * (docs/video-compare/prototype/lib.ts) that outputs real PoseTracks: 33
 * MediaPipe-style image landmarks (height units, y down) and world landmarks
 * (metres, hip-centred, y down, z away from the camera), with a noise model.
 */
import { GRID_FPS, LANDMARK_COUNT, LM, type PoseFrame, type PoseTrack, type Pt } from "../types.ts";
import { DEG, gauss, rng } from "../math.ts";

export const FPS = GRID_FPS;
type V = number[];
const sub = (a: V, b: V) => a.map((x, i) => x - b[i]);
const add = (a: V, b: V) => a.map((x, i) => x + b[i]);
const sc = (a: V, k: number) => a.map((x) => x * k);
const dot = (a: V, b: V) => a.reduce((s, x, i) => s + x * b[i], 0);
const nrm = (a: V) => Math.sqrt(dot(a, a));
const unit = (a: V) => sc(a, 1 / (nrm(a) || 1e-9));
const mid = (a: V, b: V) => sc(add(a, b), 0.5);

export const bump = (t: number, t0: number, w: number) => (t >= t0 && t < t0 + w ? Math.sin((Math.PI * (t - t0)) / w) : 0);

/**
 * Pose parameters: [0 depth (0 standing .. 1 aramandi), 1 liftL, 2 liftR,
 * 3 abdL, 4 abdR (upper arm from the body, degrees), 5 elbL, 6 elbR (elbow bend, degrees),
 * 7 tilt (degrees), 8 knee roll-in (degrees), 9 turnout (0..1)].
 */
export const STAND = [0, 0, 0, 8, 8, 5, 5, 0, 0, 0];
export const BASE_P = [1, 0, 0, 90, 90, 20, 20, 0, 0, 1];
const norm10 = (p: number[]) => {
  const q = p.slice(0, 10);
  while (q.length < 10) q.push(q.length === 9 ? 1 : 0);
  return q;
};

/** 14 joints (y up, z forward toward the camera): 0 LSh 1 RSh 2 LEl 3 REl 4 LWr 5 RWr 6 LHip 7 RHip 8 LKn 9 RKn 10 LAn 11 RAn 12 LToe 13 RToe. */
export function pose(p0: number[]): V[] {
  const p = norm10(p0);
  const [depth, , , , , , , tiltD, kneeIn, turn] = p;
  const th = 0.45;
  const sh = 0.43;
  const L = th + sh;
  const t = tiltD * DEG;
  const J: V[] = new Array(14);
  const midHip = [0, 0.08 + L * (1 - 0.2 * depth), 0];
  const up = [Math.sin(t), Math.cos(t), 0];
  const across = [Math.cos(t), -Math.sin(t), 0];
  const midSh = add(midHip, sc(up, 0.5));
  for (const k of [0, 1]) {
    const s = k === 0 ? 1 : -1;
    const lift = p[1 + k];
    const a = p[3 + k] * DEG;
    const e = p[5 + k] * DEG;
    const H = add(midHip, [s * 0.15, 0, 0]);
    const A = [s * (0.12 + 0.12 * depth * turn + 0.06 * depth * (1 - turn)), 0.08 + lift, 0];
    const d = sub(A, H);
    const dl = Math.min(nrm(d), L * 0.9999);
    const u = unit(d);
    const cs = (th * th + dl * dl - sh * sh) / (2 * th * dl);
    const sn = Math.sqrt(Math.max(0, 1 - cs * cs));
    const pa = (turn * 59.5 + (1 - turn) * 5 - kneeIn) * DEG;
    const fa = turn * 37 * DEG;
    const pole = [s * Math.sin(pa), 0, Math.cos(pa)];
    const w = unit(sub(pole, sc(u, dot(pole, u))));
    J[6 + k] = H;
    J[8 + k] = add(H, add(sc(u, th * cs), sc(w, th * sn)));
    J[10 + k] = A;
    J[12 + k] = add(A, sc(unit([s * Math.sin(fa), -0.12, Math.cos(fa)]), 0.15));
    J[k] = add(midSh, sc(across, s * 0.18));
    J[2 + k] = add(J[k], sc([s * Math.sin(a), -Math.cos(a), 0], 0.3));
    J[4 + k] = add(J[2 + k], sc([s * Math.sin(a + e), -Math.cos(a + e), 0], 0.27));
  }
  return J;
}

/* ---- motion programs ---- */
export type Prog = { dur: number; f: (t: number) => number[] };
export const LIFT = 0.09;
export const stampProg = (dur: number, stamps: [number, number][], base = BASE_P, cyc = 0, lw = 0.35): Prog => ({
  dur,
  f: (t) => {
    const p = base.slice();
    const tc = cyc ? t % cyc : t;
    for (const [k, t0] of stamps) p[1 + k] += LIFT * bump(tc, t0, lw);
    return p;
  },
});
/** Step P: Thattadavu-like (aramandi, alternating stamps). */
export const P = stampProg(6, [[1, 0], [0, 0.75]], undefined, 1.5);
/** Step A: irregular stamps, arm sweeps, a dip and a sway (no cycle). */
export const A: Prog = {
  dur: 6,
  f: (t) => {
    const p = stampProg(6, [[1, 0], [0, 0.75], [1, 1.5], [1, 2.1], [0, 3], [0, 3.6], [1, 4.5]]).f(t);
    p[0] = 1 - 0.4 * bump(t, 4.8, 1.2);
    p[4] += 60 * bump(t, 0, 3);
    p[3] += 60 * bump(t, 3, 3);
    p[6] += 40 * bump(t, 1, 2);
    p[5] += 40 * bump(t, 4, 2);
    p[7] = 5 * Math.sin((2 * Math.PI * t) / 6);
    return p;
  },
};
/** Step W: arms only (standing). */
export const W: Prog = {
  dur: 6,
  f: (t) => [0, 0, 0, 8 + 140 * bump(t, 3, 3), 8 + 140 * bump(t, 0, 3), 5 + 60 * bump(t, 3.5, 2), 5 + 60 * bump(t, 0.5, 2), 0, 0, 0],
};
export const EXTRA = stampProg(9, [[1, 0], [1, 0.75], [0, 1.5]], undefined, 2.25);
export const HOLD: Prog = { dur: 5, f: () => BASE_P.slice() };

/* ---- take builder ---- */
export type Fr = { p: number[] };
export const still = (sec: number, p: number[]): Fr[] => Array.from({ length: Math.round(sec * FPS) }, () => ({ p: p.slice() }));
export const stand = (sec: number): Fr[] => still(sec, STAND);
export const walk = (sec: number): Fr[] =>
  Array.from({ length: Math.round(sec * FPS) }, (_, i) => {
    const t = i / FPS;
    const ph = t % 1;
    return { p: [0.1, 0.12 * bump(ph, 0, 0.45), 0.12 * bump(ph, 0.5, 0.45), 10 + 6 * Math.sin(2 * Math.PI * t), 10 - 6 * Math.sin(2 * Math.PI * t), 10, 10, 0, 0, 0] };
  });
export const wave = (sec: number): Fr[] =>
  Array.from({ length: Math.round(sec * FPS) }, (_, i) => {
    const t = i / FPS;
    return { p: [0, 0, 0, 8, 105 + 45 * Math.sin((2 * Math.PI * t) / 1.2), 5, 30 + 25 * Math.sin((2 * Math.PI * t) / 0.6), 0, 0, 0] };
  });
export const squats = (sec: number): Fr[] =>
  Array.from({ length: Math.round(sec * FPS) }, (_, i) => ({ p: [0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FPS / 2), 0, 0, 20, 20, 10, 10, 0, 0, 0] }));

export interface StepOpts {
  /** Time stretch: 2 = twice as slow. */
  k?: number;
  reps?: number;
  /** Tempo wobble (beginner unevenness). */
  jit?: number;
  from?: number;
  to?: number;
  mod?: (p: number[], t: number) => number[];
  pauseAt?: number;
  pauseSec?: number;
  pausePose?: number[];
}
export function step(prog: Prog, o: StepOpts = {}): Fr[] {
  const k = o.k ?? 1;
  const reps = o.reps ?? 1;
  const from = (o.from ?? 0) * prog.dur;
  const to = (o.to ?? 1) * prog.dur;
  const out: Fr[] = [];
  for (let r = 0; r < reps; r++) {
    let t = from;
    let tau = 0;
    let paused = false;
    while (t < to) {
      if (o.pauseAt !== undefined && !paused && t >= o.pauseAt * prog.dur) {
        paused = true;
        out.push(...still(o.pauseSec ?? 4, o.pausePose ?? STAND));
      }
      let p = prog.f(t);
      if (o.mod) p = o.mod(p.slice(), t);
      out.push({ p });
      const j = o.jit ?? 0;
      const rate = (1 / k) * (1 + j * Math.sin((2 * Math.PI * tau) / 2.3 + r) + 0.6 * j * Math.sin((2 * Math.PI * tau) / 0.9 + 2 * r));
      t += rate / FPS;
      tau += 1 / FPS;
    }
  }
  return out;
}

/* ---- render: camera (yaw, roll, mirror), noise, then to a PoseTrack ---- */
export const NOISE0 = 0.0075;
export interface Cam {
  /** Position noise SD, metres (NOISE0 = an adult at a normal distance). */
  noise?: number;
  /** Depth noise multiplier. */
  zMul?: number;
  yaw?: number;
  roll?: number;
  mirror?: boolean;
  /** Temporal correlation of the noise (0 = white; MediaPipe's smoothing is roughly 0.85). */
  rho?: number;
  seed?: number;
  /** Frame rate of the output track (the analysis resamples to 15 fps). */
  fps?: number;
  /** Start time of the first frame, seconds. */
  t0?: number;
}

const MAP14 = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE, LM.L_FOOT, LM.R_FOOT];

/** Fill all 33 landmarks from the 14 joints (head, hands and heels approximated). */
function to33(J: V[]): V[] {
  const out: V[] = new Array(LANDMARK_COUNT);
  J.forEach((p, i) => (out[MAP14[i]] = p));
  const ms = mid(J[0], J[1]);
  const head = add(ms, [0, 0.25, 0.02]);
  out[LM.NOSE] = add(head, [0, 0, 0.08]);
  for (const [i, dx, dy] of [[1, 0.02, 0.03], [2, 0.035, 0.03], [3, 0.05, 0.03], [4, -0.02, 0.03], [5, -0.035, 0.03], [6, -0.05, 0.03], [7, 0.075, 0.0], [8, -0.075, 0.0], [9, 0.025, -0.04], [10, -0.025, -0.04]] as const)
    out[i] = add(head, [dx, dy, i >= 7 && i <= 8 ? 0 : 0.06]);
  for (const [w, e, base] of [[J[4], J[2], 17], [J[5], J[3], 18]] as const) {
    const d = unit(sub(w, e));
    out[base] = add(w, sc(d, 0.08)); // pinky
    out[base + 2] = add(w, sc(d, 0.09)); // index
    out[base + 4] = add(w, sc(d, 0.05)); // thumb
  }
  out[LM.L_HEEL] = add(J[10], [0, -0.03, -0.05]);
  out[LM.R_HEEL] = add(J[11], [0, -0.03, -0.05]);
  return out;
}

/** Render a take (frames at 15 fps) into a PoseTrack. */
export function render(fr: Fr[], cam: Cam = {}): PoseTrack {
  const noise = cam.noise ?? NOISE0;
  const zMul = cam.zMul ?? 3;
  const yaw = (cam.yaw ?? 0) * DEG;
  const roll = (cam.roll ?? 0) * DEG;
  const rho = cam.rho ?? 0;
  const rnd = rng(cam.seed ?? 3);
  const outFps = cam.fps ?? FPS;
  const t0 = cam.t0 ?? 0;
  // smooth some channels so programs have no instant jumps (as the prototype did)
  const P2 = fr.map((f) => norm10(f.p));
  for (const c of [0, 3, 4, 5, 6, 7, 8]) {
    const src = P2.map((p) => p[c]);
    for (let i = 0; i < fr.length; i++) {
      let s = 0;
      let n = 0;
      for (let d = -3; d <= 3; d++) {
        const q = src[i + d];
        if (q !== undefined) {
          s += q;
          n++;
        }
      }
      P2[i][c] = s / n;
    }
  }
  const nOut = Math.max(1, Math.round(((fr.length - 1) / FPS) * outFps) + 1);
  const inn = Math.sqrt(1 - rho * rho);
  let prev: V[] | null = null;
  const frames: PoseFrame[] = [];
  const raw: V[][] = [];
  for (let k = 0; k < nOut; k++) {
    const x = (k / outFps) * FPS;
    const i0 = Math.min(fr.length - 1, Math.floor(x));
    const i1 = Math.min(fr.length - 1, i0 + 1);
    const a = x - i0;
    const p = P2[i0].map((v, c) => v + (P2[i1][c] - v) * a);
    const nz: V[] = Array.from({ length: LANDMARK_COUNT }, (_, j) => [0, 1, 2].map((c) => (prev ? rho * prev[j][c] + inn * gauss(rnd) : gauss(rnd))));
    prev = nz;
    const J = to33(pose(p)).map((q, j) => {
      let [X, Y, Z] = q;
      [X, Z] = [X * Math.cos(yaw) + Z * Math.sin(yaw), -X * Math.sin(yaw) + Z * Math.cos(yaw)];
      const cy = 1.0;
      [X, Y] = [X * Math.cos(roll) - (Y - cy) * Math.sin(roll), X * Math.sin(roll) + (Y - cy) * Math.cos(roll) + cy];
      return [X + noise * nz[j][0], Y + noise * nz[j][1], Z + zMul * noise * nz[j][2]];
    });
    raw.push(J);
  }
  // a 3-frame median per coordinate (like the cleaning step)
  const med = raw.map((J, i) =>
    J.map((q, j) =>
      q.map((_, c) => {
        const v = [raw[Math.max(0, i - 1)][j][c], q[c], raw[Math.min(raw.length - 1, i + 1)][j][c]].sort((u, w) => u - w);
        return v[1];
      }),
    ),
  );
  const S = 0.45; // image height units per metre
  const aspect = 16 / 9;
  for (let k = 0; k < med.length; k++) {
    let J = med[k];
    if (cam.mirror) J = J.map((_, j) => { const q = J[mirrorIdx(j)]; return [-q[0], q[1], q[2]]; });
    const hip = mid(J[LM.L_HIP], J[LM.R_HIP]);
    const img: Pt[] = J.map((q) => ({ x: aspect / 2 + q[0] * S, y: 0.95 - q[1] * S, z: -q[2] * S, v: 0.95 }));
    const world: Pt[] = J.map((q) => ({ x: q[0] - hip[0], y: -(q[1] - hip[1]), z: -(q[2] - hip[2]), v: 0.95 }));
    frames.push({ t: t0 + k / outFps, img, world, ok: true });
  }
  return {
    frames,
    width: 1280,
    height: 720,
    range: [t0, t0 + (nOut - 1) / outFps],
    effectiveFps: outFps,
    warnings: [],
  };
}

/** MediaPipe index of the left/right partner. */
export function mirrorIdx(i: number): number {
  if (i === 0) return 0;
  if (i <= 3) return i + 3;
  if (i <= 6) return i - 3;
  return i % 2 === 1 ? i + 1 : i - 1;
}
