/**
 * The /compare synthetic test suite (05-mvp.md §6 step 1). Test-only.
 * Ported from docs/video-compare/prototype/cases.ts; ids mapped to the real tip ids.
 */
import type { CompareResult, PoseTrack } from "../types.ts";
import { analyze } from "../analyze.ts";
import {
  A, BASE_P, EXTRA, HOLD, NOISE0, P, W, bump, render, squats, stampProg, stand, step, still, walk, wave,
  type Cam, type Fr, type Prog,
} from "./synth.ts";

export interface Exp {
  kind?: string;
  found?: boolean;
  reading?: string;
  tries?: number;
  /** At least one tip id starts with one of these. */
  tipsAny?: string[];
  /** No tips at all (when found). */
  noTips?: boolean;
  /** No tip id starts with any of these. */
  tipsNone?: string[];
  /** Timing text matches; null = no timing line. */
  timing?: RegExp | null;
  noStrength?: string;
  mirrored?: boolean;
}

export interface Case {
  name: string;
  group: "spec" | "adv";
  teacher: () => PoseTrack;
  student: () => PoseTrack;
  exp: Exp;
}

const cases: Case[] = [];
/** SEED=n re-runs the suite on other noise draws (robustness check). */
const SEED_OFFSET = Number(globalThis.process?.env?.SEED ?? 0);
const T_SEED = 101 + SEED_OFFSET * 1000;
function add(name: string, group: Case["group"], tFr: () => Fr[], sFr: () => Fr[], exp: Exp, o: { tCam?: Cam; sCam?: Cam } = {}, seed = 3) {
  cases.push({
    name,
    group,
    teacher: () => render(tFr(), { seed: T_SEED, ...o.tCam }),
    student: () => render(sFr(), { seed: seed + SEED_OFFSET * 1000, ...o.sCam }),
    exp,
  });
}

const pad = (x: Fr[], pre = 5, post = 3) => [...stand(pre), ...walk(3), ...x, ...stand(post)];
const tight = (x: Fr[]) => [...stand(0.3), ...x, ...stand(0.3)];
const beg = (p: number[]) => { p[0] *= 0.3; p[1] *= 0.6; p[2] *= 0.6; p[3] -= 12; p[4] -= 12; return p; };
const begW = (p: number[]) => { p[3] = 8 + 0.7 * (p[3] - 8); p[4] = 8 + 0.7 * (p[4] - 8); return p; };

const Aother: Prog = {
  dur: 6,
  f: (t) => {
    const p = stampProg(6, [[0, 0], [1, 0.75], [0, 1.5], [1, 2.25], [0, 3], [1, 3.75], [0, 4.5]]).f(t);
    p[0] = 1 - 0.4 * bump(t, 0.3, 1.2); p[3] += 50 * bump(t, 1.5, 3); p[4] += 50 * bump(t, 1.5, 3); p[5] += 50 * bump(t, 2, 2); p[6] += 50 * bump(t, 2, 2);
    return p;
  },
};
const W5 = () => step({ dur: 6, f: (t) => [0, 0, 0, 8 + 82 * bump(t, 0, 6), 8 + 82 * bump(t, 0, 6), 5, 5, 0, 0, 0] });
const noLeftRaise = (p: number[], t: number) => { if (t >= 3) { p[3] = A.f(0)[3]; p[5] = A.f(0)[5]; } return p; };
const noLeftRaiseW = (p: number[], t: number) => { if (t >= 3) { p[3] = 8; p[5] = 5; } return p; };
const rom70A = (p: number[], t: number) => { p[4] = 90 + 0.7 * 60 * bump(t, 0, 3); p[3] = 90 + 0.7 * 60 * bump(t, 3, 3); return p; };

/* ---- 05 §6 step-1 list ---- */
for (const [tn, Tp, bg, other, frozenAt] of [["A", A, beg, () => step(Aother), 0], ["W", W, begW, W5, 1.5]] as [string, Prog, (p: number[]) => number[], () => Fr[], number][]) {
  const teach = () => step(Tp);
  add(`${tn} 0.6x padded`, "spec", teach, () => pad(step(Tp, { k: 0.6 })), { kind: "movement", found: true, noTips: true });
  add(`${tn} 1.8x padded`, "spec", teach, () => pad(step(Tp, { k: 1.8 })), { kind: "movement", found: true, noTips: true });
  add(`${tn} tight trim`, "spec", teach, () => tight(step(Tp)), { found: true, noTips: true });
  add(`${tn} 3 tries`, "spec", teach, () => pad(step(Tp, { reps: 3 }), 3, 2), { found: true, tries: 3 });
  add(`${tn} mirrored`, "spec", teach, () => pad(step(Tp)), { found: true }, { sCam: { mirror: true } });
  add(`${tn} standing 20s`, "spec", teach, () => stand(20), { found: false });
  add(`${tn} waving 15s`, "spec", teach, () => wave(15), { found: false });
  add(`${tn} stand+squats+stand`, "spec", teach, () => [...stand(15), ...squats(6), ...stand(5)], { found: false });
  add(`${tn} frozen in step posture`, "spec", teach, () => pad(still(8, Tp.f(frozenAt))), { found: false });
  add(`${tn} other adavu-like move`, "spec", teach, () => pad(other()), { found: false });
  add(`${tn} beginner tight`, "spec", teach, () => [...stand(0.5), ...step(Tp, { k: 1.3, jit: 0.25, mod: bg }), ...stand(0.5)], { found: true, tipsAny: [tn === "A" ? "knee-bend" : "arm-height", "range:arm", "range:knee"] });
  add(`${tn} beginner padded`, "spec", teach, () => pad(step(Tp, { k: 1.3, jit: 0.25, mod: bg })), { found: true, tipsAny: [tn === "A" ? "knee-bend" : "arm-height", "range:arm", "range:knee"] });
  // 05 §6 says "an arm 15° low"; 15° is exactly the arm-height tolerance, so the case uses 20°
  add(`${tn} 40% partial, arm -20`, "spec", teach, () => [...stand(5), ...step(Tp, { to: 0.4, mod: (p) => { p[3] -= 20; p[4] -= 20; return p; } }), ...stand(3)], { reading: "partial", tipsAny: ["arm-height", "range:arm"], timing: null });
  add(`${tn} 4 s pause mid-step`, "spec", teach, () => pad(step(Tp, { pauseAt: 0.5, pauseSec: 4 })), { found: true, tries: 1, noTips: true });
  add(`${tn} teacher talk inside step`, "spec", () => step(Tp, { pauseAt: 0.5, pauseSec: 5 }), () => pad(step(Tp)), { found: true, noTips: true });
  add(`${tn} 2.3x slower`, "spec", teach, () => pad(step(Tp, { k: 2.3 })), { found: true, timing: /More than 2× slower/ });
  add(`${tn} one arm never raised (phase)`, "spec", teach, () => pad(step(Tp, { mod: tn === "A" ? noLeftRaise : noLeftRaiseW })), { found: true, tipsAny: ["arm-height", "range:arm", "elbow", "range:elbow"], noStrength: "arms" });
  add(`${tn} 70% arm raise`, "spec", teach, () => pad(step(Tp, { mod: tn === "A" ? rom70A : begW })), { found: true, tipsAny: ["range:arm"] });
  add(`${tn} 5deg camera roll`, "spec", teach, () => pad(step(Tp)), { found: true, tipsNone: ["side-tilt"] }, { sCam: { roll: 5 } });
}
{
  const teach = () => step(P);
  add("P correct tight", "spec", teach, () => tight(step(P, { reps: 2 })), { kind: "posture", found: true, noTips: true });
  add("P correct padded", "spec", teach, () => pad(step(P, { reps: 2 })), { kind: "posture", found: true, noTips: true });
  add("P beginner (shallow, arms low)", "spec", teach, () => pad(step(P, { reps: 2, mod: beg })), { kind: "posture", found: true, tipsAny: ["knee-bend", "arm-height"] });
  add("P frozen aramandi (no stamps)", "spec", teach, () => pad(still(10, BASE_P)), { kind: "posture", found: true, tipsAny: ["part-still:legs"] });
  add("P correct deep knees", "spec", teach, () => pad(step(P, { reps: 2 })), { tipsNone: ["knee-rollin"] });
  add("P correct shallow knees", "spec", teach, () => pad(step(P, { reps: 2, mod: (p) => { p[0] = 0.3; return p; } })), { tipsNone: ["knee-rollin"] });
  add("P rolled-in knees (deep)", "spec", teach, () => pad(step(P, { reps: 2, mod: (p) => { p[8] = 70; return p; } })), { tipsAny: ["knee-rollin"], tipsNone: ["knee-bend", "range:knee"] });
  add("P rolled-in knees + shallow", "spec", teach, () => pad(step(P, { reps: 2, mod: (p) => { p[0] = 0.4; p[8] = 70; return p; } })), { tipsAny: ["knee-rollin"], tipsNone: ["knee-bend", "range:knee"] });
  add("P 5deg camera roll", "spec", teach, () => pad(step(P, { reps: 2 })), { found: true, tipsNone: ["side-tilt"] }, { sCam: { roll: 5 } });
}
add("HOLD 20s vs 5s teacher", "spec", () => step(HOLD), () => pad(still(20, BASE_P)), { kind: "hold", found: true, noTips: true });
add("HOLD child at 3m (noise x3) still", "spec", () => step(HOLD), () => pad(still(20, BASE_P)), { kind: "hold", found: true, noTips: true }, { sCam: { noise: NOISE0 * 3 } });
add("P-step child at 3m (x3) correct", "spec", () => step(P), () => pad(step(P, { reps: 2 })), { kind: "posture", found: true, noTips: true }, { sCam: { noise: NOISE0 * 3 } });

/* ---- adversarial ---- */
for (const tn of [2, 3, 4]) add(`A teacher noise x${tn} (far/small teacher)`, "adv", () => step(A), () => pad(step(A, { k: 1.3, jit: 0.25, mod: beg })), { kind: "movement", found: true, tipsAny: ["knee-bend", "range:knee"] }, { tCam: { noise: NOISE0 * tn } });
for (const tn of [3, 4]) add(`W teacher noise x${tn}`, "adv", () => step(W), () => pad(step(W)), { kind: "movement", found: true, noTips: true }, { tCam: { noise: NOISE0 * tn } });
for (const [tn, Tp, bg] of [["A", A, beg], ["W", W, begW]] as [string, Prog, (p: number[]) => number[]][])
  for (const k of [2, 3])
    for (const nm of [1, 2]) {
      add(`${tn} correct ${k}x slower, stu noise x${nm}`, "adv", () => step(Tp), () => pad(step(Tp, { k })), { found: true, noTips: true, timing: /slower/ }, { sCam: { noise: NOISE0 * nm } });
      add(`${tn} beginner ${k}x slower, stu noise x${nm}`, "adv", () => step(Tp), () => pad(step(Tp, { k, jit: 0.15, mod: bg })), { found: true }, { sCam: { noise: NOISE0 * nm } });
    }
const HS: Prog = { dur: 6, f: (t) => { const p = BASE_P.slice(); if (t >= 3) { p[3] += 60 * bump(t, 3, 3); p[4] += 60 * bump(t, 3, 3); p[5] += 40 * bump(t, 3.5, 2); p[6] += 40 * bump(t, 3.5, 2); } return p; } };
add("hold3+sweep3: correct", "adv", () => step(HS), () => pad(step(HS)), { found: true, noTips: true });
add("hold3+sweep3: arms low in hold only", "adv", () => step(HS), () => pad(step(HS, { mod: (p, t) => { if (t < 3) { p[3] -= 30; p[4] -= 30; } return p; } })), { found: true, tipsAny: ["arm-height"] });
add("hold3+sweep3: skips the hold", "adv", () => step(HS), () => pad(step(HS, { from: 0.5 })), { found: true });
const HS2: Prog = { dur: 7, f: (t) => HS.f(Math.max(0, t - 1)) };
add("hold4+sweep3: correct", "adv", () => step(HS2), () => pad(step(HS2)), { found: true, noTips: true });
add("P: student stamps R R L (wrong count)", "adv", () => step(P), () => pad(step(EXTRA)), { kind: "posture", found: true, noTips: true });
add("P: student stamps half as often", "adv", () => step(P), () => pad(step(stampProg(6, [[1, 0]], undefined, 1.5))), { kind: "posture", found: true });
add("P slow beginner 2 s/stamp", "adv", () => step(P), () => pad(step(stampProg(8, [[1, 0], [0, 2]], undefined, 4), { mod: beg })), { kind: "posture", found: true, tipsAny: ["knee-bend", "arm-height"] });
const otherDance = () => [...step(Aother), ...wave(5), ...squats(4), ...step(W), ...walk(4), ...step(EXTRA)];
add("A: 30s other dancing + beginner A once", "adv", () => step(A), () => [...otherDance(), ...step(A, { k: 1.3, jit: 0.25, mod: beg }), ...stand(2)], { found: true, tipsAny: ["knee-bend", "range:knee"] });
add("A: 30s other dancing, no A", "adv", () => step(A), () => [...otherDance(), ...stand(2)], { found: false });
for (const nm of [2, 3]) {
  add(`A correct 1.0 stu noise x${nm}`, "adv", () => step(A), () => pad(step(A)), { found: true, noTips: true }, { sCam: { noise: NOISE0 * nm } });
  add(`A beginner stu noise x${nm}`, "adv", () => step(A), () => pad(step(A, { k: 1.3, jit: 0.25, mod: beg })), { found: true, tipsAny: ["knee-bend", "range:knee"] }, { sCam: { noise: NOISE0 * nm } });
  add(`W 1.8x stu noise x${nm}`, "adv", () => step(W), () => pad(step(W, { k: 1.8 })), { found: true, noTips: true }, { sCam: { noise: NOISE0 * nm } });
  add(`W beginner stu noise x${nm}`, "adv", () => step(W), () => pad(step(W, { k: 1.3, jit: 0.25, mod: begW })), { found: true, tipsAny: ["arm-height", "range:arm"] }, { sCam: { noise: NOISE0 * nm } });
  add(`P frozen stu noise x${nm}`, "adv", () => step(P), () => pad(still(10, BASE_P)), { kind: "posture", found: true, tipsAny: ["part-still:legs"] }, { sCam: { noise: NOISE0 * nm } });
  add(`P correct, deep knees, stu noise x${nm}`, "adv", () => step(P), () => pad(step(P, { reps: 2 })), { found: true, noTips: true }, { sCam: { noise: NOISE0 * nm } });
  add(`P shallow knees stu noise x${nm}`, "adv", () => step(P), () => pad(step(P, { reps: 2, mod: (p) => { p[0] = 0.3; return p; } })), { tipsNone: ["knee-rollin"] }, { sCam: { noise: NOISE0 * nm } });
}
add("P: teacher far (x3), student close: correct", "adv", () => step(P), () => pad(step(P, { reps: 2 })), { found: true, noTips: true }, { tCam: { noise: NOISE0 * 3 } });
for (const y of [20, 35]) {
  add(`A yaw ${y}`, "adv", () => step(A), () => pad(step(A)), { found: true, tipsNone: ["side-tilt", "knee-rollin"] }, { sCam: { yaw: y } });
  add(`W yaw ${y}`, "adv", () => step(W), () => pad(step(W)), { found: true }, { sCam: { yaw: y } });
}
for (const rl of [10, 15]) {
  add(`A roll ${rl}`, "adv", () => step(A), () => pad(step(A)), { found: true, tipsNone: ["side-tilt"] }, { sCam: { roll: rl } });
  add(`W roll ${rl}`, "adv", () => step(W), () => pad(step(W)), { found: true }, { sCam: { roll: rl } });
}
const SAMA = [0, 0, 0, 10, 10, 8, 8, 0, 0, 0];
add("Samapada hold 20s vs 5s teacher", "adv", () => step({ dur: 5, f: () => SAMA.slice() }), () => pad(still(20, SAMA)), { kind: "hold", found: true });
add("Samapada: student in aramandi instead", "adv", () => step({ dur: 5, f: () => SAMA.slice() }), () => pad(still(20, BASE_P)), { kind: "hold" });

/* ---- extra checks for the real pipeline ---- */
add("A correlated noise (rho 0.85), correct", "adv", () => step(A), () => pad(step(A)), { found: true, noTips: true }, { tCam: { rho: 0.85 }, sCam: { rho: 0.85 } });
add("A at 30 fps input, 1.3x slower", "adv", () => step(A), () => pad(step(A, { k: 1.3 })), { found: true, noTips: true }, { tCam: { fps: 25 }, sCam: { fps: 30, t0: 12.34 } });
add("A mirrored: no side words", "adv", () => step(A), () => pad(step(A)), { found: true, noTips: true }, { sCam: { mirror: true } });

export const CASES = cases;

export interface CaseOutcome {
  name: string;
  ok: boolean;
  bad: string[];
  result: CompareResult;
  ms: number;
}

export function check(c: Case): CaseOutcome {
  const t0 = performance.now();
  const r = analyze(c.teacher(), c.student());
  const ms = performance.now() - t0;
  const ids = r.tips.map((t) => t.id);
  const has = (pre: string[]) => ids.some((id) => pre.some((p) => id.startsWith(p)));
  const bad: string[] = [];
  const e = c.exp;
  if (e.kind && r.kind !== e.kind) bad.push(`kind=${r.kind}`);
  if (e.found !== undefined && r.found !== e.found) bad.push(`found=${r.found}`);
  if (e.reading && r.reading !== e.reading) bad.push(`reading=${r.reading}`);
  if (e.tries !== undefined && r.tries.length !== e.tries) bad.push(`tries=${r.tries.length}`);
  if (e.noTips && r.found && ids.length) bad.push(`tips=${ids}`);
  if (e.tipsAny && !has(e.tipsAny)) bad.push(`missing ${e.tipsAny} (got ${ids})`);
  if (e.tipsNone && has(e.tipsNone)) bad.push(`unwanted ${ids}`);
  if (e.timing === null && r.timing.text) bad.push(`timing=${r.timing.text}`);
  if (e.timing && !e.timing.test(r.timing.text ?? "")) bad.push(`timing=${r.timing.text}`);
  if (e.noStrength && r.strength?.part === e.noStrength) bad.push(`strength ${e.noStrength}`);
  if (e.mirrored !== undefined && r.mirrored !== e.mirrored) bad.push(`mirrored=${r.mirrored}`);
  for (const t of r.tips) if (/\b(left|right)\b/i.test(t.title + " " + t.detail)) bad.push(`side word in "${t.title}"`);
  return { name: c.name, ok: !bad.length, bad, result: r, ms };
}

/**
 * Cases accepted as known Phase 1 limits (written down in 05-mvp.md §6).
 * The test suite expects these to fail; if one starts passing, remove it here.
 */
export const KNOWN_LIMITS = new Set<string>([
  // W is arms-only and starts, swaps and ends standing with the arms down, so "did the first
  // 40% and then stood still" is the same movement as "never raised the second arm". The take
  // is read as the full step, with an arm tip for the part not done.
  "W 40% partial, arm -20",
]);
