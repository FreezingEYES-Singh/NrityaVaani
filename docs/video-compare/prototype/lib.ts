// Round-5 red-team prototype of 05-mvp.md §3.2–3.6 (revision 4). Throwaway.
// Derived from critic-p1-algo/_lib.ts + sim2.ts (round 4), extended to the revised rules.
export const FPS = 15, DEG = Math.PI / 180;
let seed = 7;
export const setSeed = (s: number) => { seed = s; };
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
export const bump = (t: number, t0: number, w: number) => (t >= t0 && t < t0 + w ? Math.sin((Math.PI * (t - t0)) / w) : 0);
export const median = (a: number[]) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : 0.5 * (b[b.length / 2 - 1] + b[b.length / 2])) : NaN; };
export const pct = (a: number[], q: number) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); if (!b.length) return NaN; const i = q * (b.length - 1), lo = Math.floor(i); return b[lo] + (b[Math.min(lo + 1, b.length - 1)] - b[lo]) * (i - lo); };
export const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
export type V = number[];
export const sub = (a: V, b: V) => a.map((x, i) => x - b[i]); export const add = (a: V, b: V) => a.map((x, i) => x + b[i]);
export const sc = (a: V, k: number) => a.map((x) => x * k); export const dot = (a: V, b: V) => a.reduce((s, x, i) => s + x * b[i], 0);
export const nrm = (a: V) => Math.sqrt(dot(a, a)); export const unit = (a: V) => sc(a, 1 / (nrm(a) || 1e-9));
const cross = (a: V, b: V) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const mid = (a: V, b: V) => sc(add(a, b), 0.5);

// Par = [0 depth, 1 liftL, 2 liftR, 3 abdL, 4 abdR, 5 elbL, 6 elbR, 7 tiltDeg, 8 kneeInDeg, 9 turnout(0..1), 10 headless spare]
// joints 0 LSh 1 RSh 2 LEl 3 REl 4 LWr 5 RWr 6 LHip 7 RHip 8 LKn 9 RKn 10 LAn 11 RAn 12 LToe 13 RToe
export const STAND = [0, 0, 0, 8, 8, 5, 5, 0, 0, 0, 0];
export const BASE_P = [1, 0, 0, 90, 90, 20, 20, 0, 0, 1, 0];
const norm11 = (p: number[]) => { const q = p.slice(); while (q.length < 11) q.push(q.length === 9 ? 1 : 0); return q; };
export function pose(p0: number[]): V[] {
  const p = norm11(p0);
  const [depth, , , , , , , tiltD, kneeIn, turn] = p, th = 0.45, sh = 0.43, L = th + sh, t = tiltD * DEG;
  const J: V[] = new Array(14); const midHip = [0, 0.08 + L * (1 - 0.2 * depth), 0];
  const up = [Math.sin(t), Math.cos(t), 0], across = [Math.cos(t), -Math.sin(t), 0], midSh = add(midHip, sc(up, 0.5));
  for (const k of [0, 1]) {
    const s = k === 0 ? 1 : -1, lift = p[1 + k], a = p[3 + k] * DEG, e = p[5 + k] * DEG;
    const H = add(midHip, [s * 0.15, 0, 0]), A = [s * (0.12 + 0.12 * depth * turn + 0.06 * depth * (1 - turn)), 0.08 + lift, 0];
    const d = sub(A, H), dl = Math.min(nrm(d), L * 0.9999), u = unit(d);
    const cs = (th * th + dl * dl - sh * sh) / (2 * th * dl), sn = Math.sqrt(Math.max(0, 1 - cs * cs));
    const pa = (turn * 59.5 + (1 - turn) * 5 - kneeIn) * DEG, fa = (turn * 37) * DEG;
    const pole = [s * Math.sin(pa), 0, Math.cos(pa)], w = unit(sub(pole, sc(u, dot(pole, u))));
    J[6 + k] = H; J[8 + k] = add(H, add(sc(u, th * cs), sc(w, th * sn))); J[10 + k] = A;
    J[12 + k] = add(A, sc(unit([s * Math.sin(fa), -0.12, Math.cos(fa)]), 0.15));
    J[k] = add(midSh, sc(across, s * 0.18));
    J[2 + k] = add(J[k], sc([s * Math.sin(a), -Math.cos(a), 0], 0.3));
    J[4 + k] = add(J[2 + k], sc([s * Math.sin(a + e), -Math.cos(a + e), 0], 0.27));
  }
  return J;
}
// ---- motion programs ----
export type Prog = { dur: number; f: (t: number) => number[] };
export let LIFT = 0.09;
export const stampProg = (dur: number, stamps: [number, number][], base = BASE_P, cyc = 0, lw = 0.35, lift = () => LIFT): Prog => ({
  dur, f: (t) => { const p = base.slice(), tc = cyc ? t % cyc : t; for (const [k, t0] of stamps) p[1 + k] += lift() * bump(tc, t0, lw); return p; } });
export const P = stampProg(6, [[1, 0], [0, 0.75]], undefined, 1.5);
export const A: Prog = { dur: 6, f: (t) => { const p = stampProg(6, [[1, 0], [0, 0.75], [1, 1.5], [1, 2.1], [0, 3], [0, 3.6], [1, 4.5]]).f(t);
  p[0] = 1 - 0.4 * bump(t, 4.8, 1.2); p[4] += 60 * bump(t, 0, 3); p[3] += 60 * bump(t, 3, 3); p[6] += 40 * bump(t, 1, 2); p[5] += 40 * bump(t, 4, 2);
  p[7] = 5 * Math.sin((2 * Math.PI * t) / 6); return p; } };
export const W: Prog = { dur: 6, f: (t) => [0, 0, 0, 8 + 140 * bump(t, 3, 3), 8 + 140 * bump(t, 0, 3), 5 + 60 * bump(t, 3.5, 2), 5 + 60 * bump(t, 0.5, 2), 0, 0, 0] };
export const EXTRA = stampProg(9, [[1, 0], [1, 0.75], [0, 1.5]], undefined, 2.25);
export const HOLD: Prog = { dur: 5, f: () => BASE_P.slice() };
// ---- take builder ----
export type Fr = { p: number[]; tt: number; pause: boolean };
export const still = (sec: number, p: number[]): Fr[] => Array.from({ length: Math.round(sec * FPS) }, () => ({ p: p.slice(), tt: -1, pause: false }));
export const stand = (sec: number): Fr[] => still(sec, STAND);
export const walk = (sec: number): Fr[] => Array.from({ length: Math.round(sec * FPS) }, (_, i) => { const t = i / FPS, ph = t % 1;
  return { p: [0.1, 0.12 * bump(ph, 0, 0.45), 0.12 * bump(ph, 0.5, 0.45), 10 + 6 * Math.sin(2 * Math.PI * t), 10 - 6 * Math.sin(2 * Math.PI * t), 10, 10, 0, 0, 0], tt: -1, pause: false }; });
export const wave = (sec: number): Fr[] => Array.from({ length: Math.round(sec * FPS) }, (_, i) => { const t = i / FPS;
  return { p: [0, 0, 0, 8, 105 + 45 * Math.sin(2 * Math.PI * t / 1.2), 5, 30 + 25 * Math.sin(2 * Math.PI * t / 0.6), 0, 0, 0], tt: -1, pause: false }; });
export const squats = (sec: number): Fr[] => Array.from({ length: Math.round(sec * FPS) }, (_, i) => ({ p: [0.5 - 0.5 * Math.cos(2 * Math.PI * i / FPS / 2), 0, 0, 20, 20, 10, 10, 0, 0, 0], tt: -1, pause: false }));
export function step(prog: Prog, o: { k?: number; reps?: number; jit?: number; from?: number; to?: number; mod?: (p: number[], t: number) => number[]; pauseAt?: number; pauseSec?: number; pausePose?: number[] } = {}): Fr[] {
  const k = o.k ?? 1, reps = o.reps ?? 1, from = (o.from ?? 0) * prog.dur, to = (o.to ?? 1) * prog.dur, out: Fr[] = [];
  for (let r = 0; r < reps; r++) {
    let t = from, tau = 0, paused = false;
    while (t < to) {
      if (o.pauseAt !== undefined && !paused && t >= o.pauseAt * prog.dur) { paused = true; out.push(...still(o.pauseSec!, o.pausePose ?? STAND).map((f) => ({ ...f, pause: true }))); }
      let p = prog.f(t); if (o.mod) p = o.mod(p.slice(), t);
      out.push({ p, tt: t, pause: false });
      const j = o.jit ?? 0, rate = (1 / k) * (1 + j * Math.sin(2 * Math.PI * tau / 2.3 + r) + 0.6 * j * Math.sin(2 * Math.PI * tau / 0.9 + 2 * r));
      t += rate / FPS; tau += 1 / FPS;
    }
  }
  return out;
}
// ---- render: camera (yaw, roll), noise (xy, z multiplier), 3-frame median ----
export type Trk = { J: V[][]; tt: number[]; pause: boolean[]; p: number[][] };
export type Cam = { noise?: number; zMul?: number; yaw?: number; roll?: number; mirror?: boolean };
export const NOISE0 = 0.0075; export let NOISE_RHO = Number(process.env.RHO ?? 0); export const setRho = (r: number) => { NOISE_RHO = r; };
export function render(fr: Fr[], cam: Cam = {}): Trk {
  const noise = cam.noise ?? NOISE0, zMul = cam.zMul ?? 3, yaw = (cam.yaw ?? 0) * DEG, roll = (cam.roll ?? 0) * DEG;
  const ch = [0, 3, 4, 5, 6, 7, 8];
  const P2 = fr.map((f) => norm11(f.p));
  for (const c of ch) { const src = P2.map((p) => p[c]); for (let i = 0; i < fr.length; i++) { let s = 0, n = 0; for (let d = -3; d <= 3; d++) { const q = src[i + d]; if (q !== undefined) { s += q; n++; } } P2[i][c] = s / n; } }
  const rho = NOISE_RHO, inn = Math.sqrt(1 - rho * rho); let prev: V[] | null = null;
  let J = P2.map((p) => { const nz: V[] = Array.from({ length: 14 }, (_, j) => [0, 1, 2].map((c) => (prev ? rho * prev[j][c] + inn * gauss() : gauss()))); prev = nz;
    return pose(p).map((x, j) => {
    let [X, Y, Z] = x; [X, Z] = [X * Math.cos(yaw) + Z * Math.sin(yaw), -X * Math.sin(yaw) + Z * Math.cos(yaw)];
    const cy = 1.0; [X, Y] = [X * Math.cos(roll) - (Y - cy) * Math.sin(roll), X * Math.sin(roll) + (Y - cy) * Math.cos(roll) + cy];
    return [X + noise * nz[j][0], Y + noise * nz[j][1], Z + zMul * noise * nz[j][2]]; }); });
  J = J.map((jj, i) => jj.map((x, j) => x.map((_, c) => { const a = [J[Math.max(0, i - 1)][j][c], x[c], J[Math.min(J.length - 1, i + 1)][j][c]].sort((u, v) => u - v); return a[1]; })));
  if (cam.mirror) J = J.map(mirrorJ);
  return { J, tt: fr.map((f) => f.tt), pause: fr.map((f) => f.pause), p: P2 };
}
export const mirrorJ = (jj: V[]) => jj.map((_, j) => { const x = jj[j % 2 === 0 ? j + 1 : j - 1]; return [-x[0], x[1], x[2]]; });
// ---- features ----
const SEG: [number, number][] = [[0, 2], [1, 3], [2, 4], [3, 5], [6, 8], [7, 9], [8, 10], [9, 11]];
export const PART_SEGS: Record<string, number[]> = { arms: [0, 1, 2, 3], legs: [4, 5, 6, 7], torso: [8, 9] };
export function segs(J: V[]): number[] {
  const s = SEG.map(([a, b]) => [J[a], J[b]]).concat([[mid(J[6], J[7]), mid(J[0], J[1])], [J[1], J[0]]]);
  return s.flatMap(([a, b]) => unit([b[0] - a[0], b[1] - a[1]]));
}
export const cost1 = (a: number[], b: number[], w?: number[]) => { let s = 0, ws = 0; for (let g = 0; g < 10; g++) { const wg = w ? w[g] : 1; s += wg * Math.hypot(a[2 * g] - b[2 * g], a[2 * g + 1] - b[2 * g + 1]); ws += wg; } return s / ws; };
export const medPose = (F: number[][]) => { const m = Array.from({ length: 20 }, (_, c) => median(F.map((f) => f[c]))); for (let g = 0; g < 10; g++) { const u = unit([m[2 * g], m[2 * g + 1]]); m[2 * g] = u[0]; m[2 * g + 1] = u[1]; } return m; };
export const NEUTRAL = (() => { const v: number[] = []; for (let g = 0; g < 8; g++) v.push(0, -1); v.push(0, 1, 1, 0); return v; })(); // arms+legs straight down, torso up, shoulder line horizontal
const ang3 = (a: V, b: V, c: V) => Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(a, b)), unit(sub(c, b)))))) / DEG;
const ang2 = (u: V, v: V) => Math.acos(Math.max(-1, Math.min(1, dot(unit([u[0], u[1]]), unit([v[0], v[1]]))))) / DEG;
const sang2 = (u: V) => Math.atan2(u[0], u[1]) / DEG; // angle from vertical
export type TipF = { kneeL: number; kneeR: number; elbL: number; elbR: number; armL: number; armR: number; kneeSp: number; footSp: number; tilt: number; bob: number; rollL: number; rollR: number; medL: number; medR: number };
export function tipFeats(J: V[]): TipF {
  const mh = mid(J[6], J[7]), ms = mid(J[0], J[1]), ma = mid(J[10], J[11]), hipW = Math.abs(J[6][0] - J[7][0]) || 1e-6;
  const tdown = sub(mh, ms), torsoLen = Math.hypot(tdown[0], tdown[1]);
  const roll = (k: number) => {
    const H = J[6 + k], K = J[8 + k], An = J[10 + k], T = J[12 + k], u = unit(sub(An, H));
    const perp = (v: V) => sub(v, sc(u, dot(v, u)));
    const b = perp(sub(K, H)), f = perp(sub(T, An)), med = unit(perp(sub(J[6 + (1 - k)], H))), fwd = cross(u, med);
    const a = (v: V) => Math.atan2(dot(v, med), dot(v, fwd)) / DEG; let d = a(b) - a(f); if (d > 180) d -= 360; if (d < -180) d += 360;
    return d; // + = knee bends more toward the midline than the foot points
  };
  const medial = (k: number) => { const s = Math.sign(J[6 + k][0] - J[6 + (1 - k)][0]) || (k === 0 ? 1 : -1); return -s * (J[8 + k][0] - J[10 + k][0]) / hipW; }; // >0 = knee inside ankle on screen
  return {
    kneeL: ang3(J[6], J[8], J[10]), kneeR: ang3(J[7], J[9], J[11]), elbL: ang3(J[0], J[2], J[4]), elbR: ang3(J[1], J[3], J[5]),
    armL: ang2(tdown, sub(J[2], J[0])), armR: ang2(tdown, sub(J[3], J[1])),
    kneeSp: Math.abs(J[8][0] - J[9][0]) / hipW, footSp: Math.abs(J[10][0] - J[11][0]) / hipW,
    tilt: sang2(sub(ms, mh)) - sang2(sub(mh, ma)), bob: (mh[1] - Math.min(J[10][1], J[11][1])) / torsoLen,
    rollL: roll(0), rollR: roll(1), medL: medial(0), medR: medial(1),
  };
}
// ---- jitter, stillness, pauses ----
// jitter cost: median high-pass residual of the segment-direction track (no still frames needed), / sqrt(1.5)
export function jitterCost(F: number[][]) {
  const r: number[] = []; for (let t = 1; t < F.length - 1; t++) { const m = F[t - 1].map((x, c) => 0.5 * (x + F[t + 1][c])); r.push(cost1(F[t], m)); }
  return median(r) / Math.sqrt(1.5);
}
export let K_STILL = 2.5; export const setKStill = (k: number) => { K_STILL = k; };
export function stillMask(F: number[][], jit: number, mode: 'mean' | 'maxpart' | 'disp' = 'mean', K = K_STILL) {
  if (mode === 'disp') { // displacement over a ±0.5 s window: max over segments of max cost to the window median direction
    const H = 7, sp = F.map((_, t) => { const a = Math.max(0, t - H), b = Math.min(F.length - 1, t + H); let mx = 0;
      for (let g = 0; g < 10; g++) { let cx = 0, cy = 0; for (let i = a; i <= b; i++) { cx += F[i][2 * g]; cy += F[i][2 * g + 1]; } const u = unit([cx, cy]);
        for (let i = a; i <= b; i++) mx = Math.max(mx, Math.hypot(F[i][2 * g] - u[0], F[i][2 * g + 1] - u[1])); } return mx; });
    return { still: sp.map((v) => v <= K * jit), speed: sp };
  }
  const sp = F.map((f, t) => {
    if (t === 0) return 0;
    if (mode === 'mean') return cost1(f, F[t - 1]);
    return Math.max(...Object.values(PART_SEGS).map((gs) => { let s = 0; for (const g of gs) s += Math.hypot(f[2 * g] - F[t - 1][2 * g], f[2 * g + 1] - F[t - 1][2 * g + 1]); return s / gs.length; }));
  }); sp[0] = sp[1] ?? 0;
  const sm = sp.map((_, t) => { let s = 0, n = 0; for (let d = -2; d <= 2; d++) if (sp[t + d] !== undefined) { s += sp[t + d]; n++; } return s / n; });
  return { still: sm.map((v) => v <= K * jit), speed: sm };
}
export function pauseRuns(still: boolean[], minSec = 1.5) {
  const runs: [number, number][] = []; let s = -1;
  for (let i = 0; i <= still.length; i++) { if (i < still.length && still[i]) { if (s < 0) s = i; } else if (s >= 0) { if (i - s >= minSec * FPS) runs.push([s, i - 1]); s = -1; } }
  return runs;
}
export function cutIdx(n: number, runs: [number, number][]) { const keep: number[] = []; const cutSet = new Uint8Array(n); for (const [a, b] of runs) for (let i = a; i <= b; i++) cutSet[i] = 1; for (let i = 0; i < n; i++) if (!cutSet[i]) keep.push(i); return keep; }
// ---- sDTW (05 §3.4) ----
export let SKIPW = 1; export const setSkipW = (w: number) => { SKIPW = w; };
export function sdtw(Q: number[][], S: number[][], blocked: Uint8Array) {
  const N = Q.length, M = S.length, C = new Float64Array(N * M);
  for (let n = 0; n < N; n++) for (let m = 0; m < M; m++) C[n * M + m] = blocked[m] ? Infinity : cost1(Q[n], S[m]);
  const rowMin: number[] = []; for (let n = 0; n < N; n++) { let mn = Infinity; for (let m = 0; m < M; m++) mn = Math.min(mn, C[n * M + m]); rowMin.push(mn); }
  const lam = 0.1 * median(rowMin), D = new Float64Array(N * M).fill(Infinity), B = new Int8Array(N * M), St = new Int32Array(N * M), Cm = new Int32Array(N * M), Ns = new Int32Array(N * M);
  const c = (n: number, m: number) => (n < 0 || m < 0 ? Infinity : C[n * M + m]);
  for (let m = 0; m < M; m++) { D[m] = C[m]; St[m] = m; }
  for (let n = 1; n < N; n++) for (let m = 0; m < M; m++) {
    const cc = C[n * M + m]; if (!Number.isFinite(cc)) continue;
    const opts: [number, number, number, number][] = []; // value, code, prev n, prev m
    if (m >= 1) opts.push([D[(n - 1) * M + m - 1], 1, n - 1, m - 1]);
    if (SKIPW < 0) { // 'avg': a teacher row matched to k student frames is charged the mean of the k cells (weight 1 per teacher row)
      if (m >= 2) opts.push([D[(n - 1) * M + m - 2] + 0.5 * (c(n, m - 1) - cc) + lam, 2, n - 1, m - 2]);
      if (m >= 3) opts.push([D[(n - 1) * M + m - 3] + (c(n, m - 1) + c(n, m - 2) - 2 * cc) / 3 + 2 * lam, 3, n - 1, m - 3]);
    } else {
    if (m >= 2) opts.push([D[(n - 1) * M + m - 2] + SKIPW * c(n, m - 1) + lam, 2, n - 1, m - 2]);
    if (m >= 3) opts.push([D[(n - 1) * M + m - 3] + SKIPW * (c(n, m - 1) + c(n, m - 2)) + 2 * lam, 3, n - 1, m - 3]); }
    const tw = SKIPW < 0 ? 1 : SKIPW;
    if (n >= 2 && m >= 1) opts.push([D[(n - 2) * M + m - 1] + tw * c(n - 1, m) + lam, 4, n - 2, m - 1]);
    if (n >= 3 && m >= 1) opts.push([D[(n - 3) * M + m - 1] + tw * (c(n - 1, m) + c(n - 2, m)) + 2 * lam, 5, n - 3, m - 1]);
    let best = Infinity, bi = -1; for (let i = 0; i < opts.length; i++) if (opts[i][0] < best) { best = opts[i][0]; bi = i; }
    if (bi < 0 || !Number.isFinite(best)) continue;
    const [, code, pn, pm] = opts[bi], id = n * M + m, pid = pn * M + pm;
    D[id] = cc + best; B[id] = code; St[id] = St[pid]; Cm[id] = Cm[pid] + (code >= 4 ? 1 : 0); Ns[id] = Ns[pid] + 1;
  }
  const E = Array.from({ length: M }, (_, m) => D[(N - 1) * M + m] / N);
  const path = (mEnd: number) => { const pairs: [number, number][] = []; let n = N - 1, m = mEnd;
    while (n >= 0 && m >= 0) { pairs.push([m, n]); if (n === 0) break; const b = B[n * M + m];
      if (b === 1) { n--; m--; } else if (b === 2) { pairs.push([m - 1, n]); n--; m -= 2; } else if (b === 3) { pairs.push([m - 1, n], [m - 2, n]); n--; m -= 3; }
      else if (b === 4) { n -= 2; m--; } else if (b === 5) { n -= 3; m--; } else break; }
    return pairs.reverse(); };
  return { E, St, path, comp: (m: number) => Cm[(N - 1) * M + m] / Math.max(1, Ns[(N - 1) * M + m]), lam };
}
export type Try = { s: number; e: number; cost: number; span: number; pairs: [number, number][]; comp: number; tests: string };
export const tauT = (Q: number[][]) => 0.5 * mean(Q.map((q) => cost1(q, NEUTRAL)));
export let RM_MODE: 'spec' | 'path' = 'spec'; export const setRM = (m: 'spec' | 'path') => { RM_MODE = m; };
export function search(Q: number[][], S: number[][], o: { maxTries?: number } = {}) {
  const N = Q.length, M = S.length, blocked = new Uint8Array(M), tau = tauT(Q), tries: Try[] = [];
  let r = sdtw(Q, S, blocked); const accepted: [number, number][] = [];
  let first: Try | null = null, firstInfo = '';
  for (let k = 0; k < (o.maxTries ?? 6); k++) {
    let e = -1, best = Infinity; r.E.forEach((v, m) => { if (v < best) { best = v; e = m; } });
    if (e < 0) break;
    const s = r.St[(N - 1) * M + e], span = (e - s + 1) / N, pairs = r.path(e);
    // dip
    const outside = r.E.filter((v, m) => Number.isFinite(v) && (m < s - N || m > e + N) && !accepted.some(([a, b]) => m >= a && m <= b));
    const base = outside.length >= N ? median(outside) : NaN;
    const dipOk = Number.isFinite(base) ? best <= 0.6 * base : true;
    const ceilOk = best <= tau;
    const frozen = medPose(S.slice(s, e + 1));
    let nullC: number;
    if (RM_MODE === 'spec') nullC = mean(Q.map((q) => cost1(q, frozen)));
    else { const cnt = new Array(N).fill(0); for (const [, n] of pairs) cnt[n]++; nullC = 0; for (let n = 0; n < N; n++) nullC += Math.max(1, cnt[n]) * cost1(Q[n], frozen); nullC /= N; }
    const rmOk = best <= 0.7 * nullC;
    const info = `dip ${Number.isFinite(base) ? (best / base).toFixed(2) : 'n/a'}${dipOk ? '' : '✗'} ceil ${(best / tau).toFixed(2)}${ceilOk ? '' : '✗'} rm ${(best / nullC).toFixed(2)}${rmOk ? '' : '✗'}`;
    const ok = dipOk && ceilOk && rmOk && (k === 0 || best <= 1.5 * tries[0].cost);
    const t: Try = { s, e, cost: best, span, pairs, comp: r.comp(e), tests: info };
    if (k === 0) { first = t; firstInfo = info; }
    if (!ok) break;
    tries.push(t); accepted.push([s, e]);
    for (let m = s; m <= e; m++) blocked[m] = 1; r = sdtw(Q, S, blocked);
  }
  return { found: tries.length > 0, tries, first: first!, info: firstInfo, tau };
}
// phases: split teacher step at velocity minima, 0.5–2 s each
export function phases(Q: number[][], smoothW = 0) {
  const N = Q.length; let v = Q.map((q, n) => (n ? cost1(q, Q[n - 1]) : 0)); v[0] = v[1];
  if (smoothW) v = v.map((_, n) => { let s = 0, c = 0; for (let d = -smoothW; d <= smoothW; d++) if (v[n + d] !== undefined) { s += v[n + d]; c++; } return s / c; });
  let bounds: number[] = []; for (let n = 1; n < N - 1; n++) if (v[n] <= v[n - 1] && v[n] < v[n + 1]) bounds.push(n);
  const MIN = 8, MAX = 30;
  let changed = true;
  while (changed) { changed = false; const b = [0, ...bounds, N];
    for (let i = 0; i + 1 < b.length; i++) if (b[i + 1] - b[i] < MIN) { // drop the inner boundary with higher v
      const cand = [i, i + 1].filter((j) => j > 0 && j < b.length - 1); if (!cand.length) continue;
      const j = cand.sort((x, y) => v[b[y]] - v[b[x]])[0]; bounds = bounds.filter((x) => x !== b[j]); changed = true; break; } }
  const out: [number, number][] = []; const b = [0, ...bounds, N];
  const split = (a: number, z: number) => { if (z - a <= MAX) { out.push([a, z]); return; } let bi = -1, bv = Infinity; for (let n = a + MIN; n <= z - MIN; n++) if (v[n] < bv) { bv = v[n]; bi = n; } if (bi < 0) { out.push([a, z]); return; } split(a, bi); split(bi, z); };
  for (let i = 0; i + 1 < b.length; i++) split(b[i], b[i + 1]);
  return out;
}
