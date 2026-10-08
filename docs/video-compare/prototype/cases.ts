import * as L from './lib.ts'; import { analyze, show } from './pipe.ts'; import type { Opts } from './pipe.ts';
const { step, stand, still, walk, wave, squats, P, A, W, HOLD, BASE_P, EXTRA, bump, stampProg, FPS } = L;
const ORDER = (process.env.ORDER ?? 'literal') as 'literal' | 'fixed';
const base: Opts = { order: ORDER, energy: (process.env.ENERGY ?? 'raw') as any, skipW: Number(process.env.SKIPW ?? 1), rm: (process.env.RM ?? 'spec') as any, phaseSmooth: Number(process.env.PHS ?? 0) };
const pad = (x: L.Fr[], pre = 5, post = 3) => [...stand(pre), ...walk(3), ...x, ...stand(post)];
const tight = (x: L.Fr[]) => [...stand(0.3), ...x, ...stand(0.3)];
const beg = (p: number[]) => { p[0] *= 0.3; p[1] *= 0.6; p[2] *= 0.6; p[3] -= 12; p[4] -= 12; return p; };
const begW = (p: number[]) => { p[3] = 8 + 0.7 * (p[3] - 8); p[4] = 8 + 0.7 * (p[4] - 8); return p; };
type Exp = { kind?: string; found?: boolean; reading?: string; tries?: number; tipsAny?: string[]; noTips?: boolean; tipsNone?: string[]; timing?: RegExp; noStrength?: string };
let pass = 0, fail = 0; const fails: string[] = [];
function T(name: string, tFr: L.Fr[], sFr: L.Fr[], exp: Exp, o: Opts = {}, seed = 3) {
  const r = analyze(tFr, sFr, { ...base, seed, ...o });
  const tips: string[] = (r.tips ?? []).map((t: any) => t.id); const bad: string[] = [];
  if (exp.kind && r.kind !== exp.kind) bad.push(`kind=${r.kind}`);
  if (exp.found !== undefined && !!r.found !== exp.found) bad.push(`found=${!!r.found}`);
  if (exp.reading && r.reading !== exp.reading) bad.push(`reading=${r.reading}`);
  if (exp.tries !== undefined && r.tries !== exp.tries) bad.push(`tries=${r.tries}`);
  if (exp.noTips && r.found && tips.length) bad.push(`tips=${tips}`);
  if (exp.tipsAny && !exp.tipsAny.some((t) => tips.some((x) => x.startsWith(t)))) bad.push(`missing ${exp.tipsAny}`);
  if (exp.tipsNone && exp.tipsNone.some((t) => tips.some((x) => x.startsWith(t)))) bad.push(`unwanted ${tips}`);
  if (exp.timing && !exp.timing.test(r.timing ?? '')) bad.push(`timing=${r.timing}`);
  if (exp.noStrength && (r.strength ?? []).includes(exp.noStrength)) bad.push(`strength ${exp.noStrength}`);
  show((bad.length ? 'FAIL ' : 'ok   ') + name, r, JSON.stringify(exp, (k, v) => (v instanceof RegExp ? v.source : v)) + (bad.length ? '  !! ' + bad.join('; ') : ''));
  if (bad.length) { fail++; fails.push(name + ': ' + bad.join('; ')); } else pass++;
  return r;
}
const sel = (process.env.SEL ?? 'spec,adv').split(',');
// ---- extra programs ----
const Aother: L.Prog = { dur: 6, f: (t) => { const p = stampProg(6, [[0, 0], [1, 0.75], [0, 1.5], [1, 2.25], [0, 3], [1, 3.75], [0, 4.5]]).f(t);
  p[0] = 1 - 0.4 * bump(t, 0.3, 1.2); p[3] += 50 * bump(t, 1.5, 3); p[4] += 50 * bump(t, 1.5, 3); p[5] += 50 * bump(t, 2, 2); p[6] += 50 * bump(t, 2, 2); return p; } };
const W5 = step({ dur: 6, f: (t) => [0, 0, 0, 8 + 82 * bump(t, 0, 6), 8 + 82 * bump(t, 0, 6), 5, 5, 0, 0, 0] });
const noLeftRaise = (p: number[], t: number) => { if (t >= 3) { p[3] = A.f(0)[3]; p[5] = A.f(0)[5]; } return p; };
const noLeftRaiseW = (p: number[], t: number) => { if (t >= 3) { p[3] = 8; p[5] = 5; } return p; };
const rom70A = (p: number[], t: number) => { p[4] = 90 + 0.7 * 60 * bump(t, 0, 3); p[3] = 90 + 0.7 * 60 * bump(t, 3, 3); return p; };
if (sel.includes('spec')) {
  console.log(`===== 05 §6 step 1 list (order=${ORDER}) =====`);
  for (const [tn, Tp, bg, other, frozenAt] of [['A', A, beg, step(Aother), 0], ['W', W, begW, W5, 1.5]] as [string, L.Prog, any, L.Fr[], number][]) {
    const teach = step(Tp);
    T(`${tn} 0.6x padded`, teach, pad(step(Tp, { k: 0.6 })), { kind: 'movement', found: true, noTips: true });
    T(`${tn} 1.8x padded`, teach, pad(step(Tp, { k: 1.8 })), { kind: 'movement', found: true, noTips: true });
    T(`${tn} tight trim`, teach, tight(step(Tp)), { found: true, noTips: true });
    T(`${tn} 3 tries`, teach, pad(step(Tp, { reps: 3 }), 3, 2), { found: true, tries: 3 });
    T(`${tn} mirrored`, teach, pad(step(Tp)), { found: true }, { sCam: { mirror: true } });
    T(`${tn} standing 20s`, teach, stand(20), { found: false });
    T(`${tn} waving 15s`, teach, wave(15), { found: false });
    T(`${tn} stand+squats+stand`, teach, [...stand(15), ...squats(6), ...stand(5)], { found: false });
    T(`${tn} frozen in step posture`, teach, pad(still(8, Tp.f(frozenAt))), { found: false });
    T(`${tn} other adavu-like move`, teach, pad(other), { found: false });
    T(`${tn} beginner tight`, teach, [...stand(0.5), ...step(Tp, { k: 1.3, jit: 0.25, mod: bg }), ...stand(0.5)], { found: true, tipsAny: [tn === 'A' ? 'knee' : 'arm', 'rom:arm'] });
    T(`${tn} beginner padded`, teach, pad(step(Tp, { k: 1.3, jit: 0.25, mod: bg })), { found: true, tipsAny: [tn === 'A' ? 'knee' : 'arm', 'rom:arm'] });
    T(`${tn} 40% partial, arm -15`, teach, [...stand(5), ...step(Tp, { to: 0.4, mod: (p) => { p[3] -= 15; p[4] -= 15; return p; } }), ...stand(3)], { reading: 'partial', tipsAny: ['arm'], timing: /^$/ });
    T(`${tn} 4 s pause mid-step`, teach, pad(step(Tp, { pauseAt: 0.5, pauseSec: 4 })), { found: true, tries: 1, noTips: true });
    T(`${tn} teacher talk inside step`, step(Tp, { pauseAt: 0.5, pauseSec: 5 }), pad(step(Tp)), { found: true, noTips: true });
    T(`${tn} 2.3x slower`, teach, pad(step(Tp, { k: 2.3 })), { found: true, timing: /more than 2x/ });
    T(`${tn} one arm never raised (phase)`, teach, pad(step(Tp, { mod: tn === 'A' ? noLeftRaise : noLeftRaiseW })), { found: true, tipsAny: ['arm', 'rom:arm', 'elb'], noStrength: 'arms' });
    T(`${tn} 70% arm raise`, teach, pad(step(Tp, { mod: tn === 'A' ? rom70A : begW })), { found: true, tipsAny: ['rom:arm'] });
    T(`${tn} 5deg camera roll`, teach, pad(step(Tp)), { found: true, tipsNone: ['tilt'] }, { sCam: { roll: 5 } });
  }
  console.log('--- step P (Thattadavu-like) ---');
  { const teach = step(P);
    T('P correct tight', teach, tight(step(P, { reps: 2 })), { kind: 'posture', found: true, noTips: true });
    T('P correct padded', teach, pad(step(P, { reps: 2 })), { kind: 'posture', found: true, noTips: true });
    T('P beginner (shallow, arms low)', teach, pad(step(P, { reps: 2, mod: beg })), { kind: 'posture', found: true, tipsAny: ['knee', 'arm'] });
    T('P frozen aramandi (no stamps)', teach, pad(still(10, BASE_P)), { kind: 'posture', found: true, tipsAny: ['hardlyMoved:legs'] });
    T('P correct deep knees', teach, pad(step(P, { reps: 2 })), { tipsNone: ['rollIn'] });
    T('P correct shallow knees', teach, pad(step(P, { reps: 2, mod: (p) => { p[0] = 0.3; return p; } })), { tipsNone: ['rollIn'] });
    T('P rolled-in knees (deep)', teach, pad(step(P, { reps: 2, mod: (p) => { p[8] = 70; return p; } })), { tipsAny: ['rollIn'], tipsNone: ['kneeL', 'kneeR'] });
    T('P rolled-in knees + shallow', teach, pad(step(P, { reps: 2, mod: (p) => { p[0] = 0.4; p[8] = 70; return p; } })), { tipsAny: ['rollIn'], tipsNone: ['kneeL', 'kneeR'] });
    T('P 5deg camera roll', teach, pad(step(P, { reps: 2 })), { found: true, tipsNone: ['tilt'] }, { sCam: { roll: 5 } });
  }
  console.log('--- holds ---');
  T('HOLD 20s vs 5s teacher', step(HOLD), pad(still(20, BASE_P)), { kind: 'hold', found: true, noTips: true });
  T('HOLD child at 3m (noise x3) still', step(HOLD), pad(still(20, BASE_P)), { kind: 'hold', found: true, noTips: true }, { sCam: { noise: L.NOISE0 * 3 } });
  T('P-step child at 3m (x3) correct', step(P), pad(step(P, { reps: 2 })), { kind: 'posture', found: true, noTips: true }, { sCam: { noise: L.NOISE0 * 3 } });
}
if (sel.includes('adv')) {
  console.log(`===== adversarial (order=${ORDER}) =====`);
  // a. m_T near 3: scale A's motion; check flips across seeds and teacher noise
  const scaled = (s: number): L.Prog => ({ dur: 6, f: (t) => { const a = A.f(t), b = BASE_P; return a.map((x, i) => (i === 7 || i === 0 || (i >= 3 && i <= 6) ? b[i] + s * (x - b[i]) : x)); } });
  for (const s of [0.2, 0.25, 0.3]) for (const tn of [1, 2]) { const ks: string[] = []; for (let sd = 1; sd <= 6; sd++) { const r = analyze(step(scaled(s)), pad(step(scaled(s))), { ...base, seed: sd * 101, tCam: { noise: L.NOISE0 * tn } }); ks.push(`${r.kind[0]}${r.mT.toFixed(1)}${r.kind === 'movement' ? (r.found ? '+' : '-') : r.found ? '+' : '-'}`); }
    console.log(`A x${s} amplitude, teacher noise x${tn}: ${ks.join(' ')}`); }
  for (const tn of [2, 3, 4]) T(`A teacher noise x${tn} (far/small teacher)`, step(A), pad(step(A, { k: 1.3, jit: 0.25, mod: beg })), { kind: 'movement', found: true, tipsAny: ['knee'] }, { tCam: { noise: L.NOISE0 * tn } });
  for (const tn of [3, 4]) T(`W teacher noise x${tn}`, step(W), pad(step(W)), { kind: 'movement', found: true, noTips: true }, { tCam: { noise: L.NOISE0 * tn } });
  // b. slow takes
  for (const [tn, Tp, bg] of [['A', A, beg], ['W', W, begW]] as [string, L.Prog, any][]) for (const k of [2, 3]) for (const nm of [1, 2]) {
    T(`${tn} correct ${k}x slower, stu noise x${nm}`, step(Tp), pad(step(Tp, { k })), { found: true, noTips: true, timing: /slower/ }, { sCam: { noise: L.NOISE0 * nm } });
    T(`${tn} beginner ${k}x slower, stu noise x${nm}`, step(Tp), pad(step(Tp, { k, jit: 0.15, mod: bg })), { found: true }, { sCam: { noise: L.NOISE0 * nm } });
  }
  // c. teacher step = 3 s hold then 3 s sweep
  const HS: L.Prog = { dur: 6, f: (t) => { const p = BASE_P.slice(); if (t >= 3) { p[3] += 60 * bump(t, 3, 3); p[4] += 60 * bump(t, 3, 3); p[5] += 40 * bump(t, 3.5, 2); p[6] += 40 * bump(t, 3.5, 2); } return p; } };
  T('hold3+sweep3: correct', step(HS), pad(step(HS)), { found: true, noTips: true });
  T('hold3+sweep3: arms low in hold only', step(HS), pad(step(HS, { mod: (p, t) => { if (t < 3) { p[3] -= 30; p[4] -= 30; } return p; } })), { found: true, tipsAny: ['arm'] });
  T('hold3+sweep3: skips the hold', step(HS), pad(step(HS, { from: 0.5 })), { found: true });
  const HS2: L.Prog = { dur: 7, f: (t) => HS.f(Math.max(0, t - 1)) }; // 4 s hold + 3 s sweep -> hold kind?
  T('hold4+sweep3: correct', step(HS2), pad(step(HS2)), { found: true, noTips: true });
  // d. posture step: wrong stamp count
  T('P: student stamps R R L (wrong count)', step(P), pad(step(EXTRA)), { kind: 'posture', found: true, noTips: true });
  T('P: student stamps half as often', step(P), pad(step(stampProg(6, [[1, 0]], undefined, 1.5))), { kind: 'posture', found: true });
  T('P slow beginner 2 s/stamp', step(P), pad(step(stampProg(8, [[1, 0], [0, 2]], undefined, 4), { mod: beg })), { kind: 'posture', found: true, tipsAny: ['knee', 'arm'] });
  // e. take mostly other movement
  const other = [...step(Aother), ...wave(5), ...squats(4), ...step(W), ...walk(4), ...step(EXTRA)];
  T('A: 30s other dancing + beginner A once', step(A), [...other, ...step(A, { k: 1.3, jit: 0.25, mod: beg }), ...stand(2)], { found: true, tipsAny: ['knee'] });
  T('A: 30s other dancing, no A', step(A), [...other, ...stand(2)], { found: false });
  // f. small child: noise x2 / x3 on student
  for (const nm of [2, 3]) {
    T(`A correct 1.0 stu noise x${nm}`, step(A), pad(step(A)), { found: true, noTips: true }, { sCam: { noise: L.NOISE0 * nm } });
    T(`A beginner stu noise x${nm}`, step(A), pad(step(A, { k: 1.3, jit: 0.25, mod: beg })), { found: true, tipsAny: ['knee'] }, { sCam: { noise: L.NOISE0 * nm } });
    T(`W 1.8x stu noise x${nm}`, step(W), pad(step(W, { k: 1.8 })), { found: true, noTips: true }, { sCam: { noise: L.NOISE0 * nm } });
    T(`W beginner stu noise x${nm}`, step(W), pad(step(W, { k: 1.3, jit: 0.25, mod: begW })), { found: true, tipsAny: ['arm', 'rom:arm'] }, { sCam: { noise: L.NOISE0 * nm } });
    T(`P frozen stu noise x${nm}`, step(P), pad(still(10, BASE_P)), { kind: 'posture', found: true, tipsAny: ['hardlyMoved:legs'] }, { sCam: { noise: L.NOISE0 * nm } });
    T(`P correct, deep knees, stu noise x${nm}`, step(P), pad(step(P, { reps: 2 })), { found: true, noTips: true }, { sCam: { noise: L.NOISE0 * nm } });
    T(`P shallow knees stu noise x${nm}`, step(P), pad(step(P, { reps: 2, mod: (p) => { p[0] = 0.3; return p; } })), { tipsNone: ['rollIn'] }, { sCam: { noise: L.NOISE0 * nm } });
  }
  T('P: teacher far (x3), student close: correct', step(P), pad(step(P, { reps: 2 })), { found: true, noTips: true }, { tCam: { noise: L.NOISE0 * 3 } });
  // g. camera yaw / h. roll
  for (const y of [20, 35]) { T(`A yaw ${y}`, step(A), pad(step(A)), { found: true, tipsNone: ['tilt', 'rollIn'] }, { sCam: { yaw: y } }); T(`W yaw ${y}`, step(W), pad(step(W)), { found: true }, { sCam: { yaw: y } }); }
  for (const rl of [10, 15]) { T(`A roll ${rl}`, step(A), pad(step(A)), { found: true, tipsNone: ['tilt'] }, { sCam: { roll: rl } }); T(`W roll ${rl}`, step(W), pad(step(W)), { found: true }, { sCam: { roll: rl } }); }
  // i. near-neutral hold (samapada, arms down)
  const SAMA = [0, 0, 0, 10, 10, 8, 8, 0, 0, 0, 0];
  T('Samapada hold 20s vs 5s teacher', step({ dur: 5, f: () => SAMA.slice() }), pad(still(20, SAMA)), { kind: 'hold', found: true });
  T('Samapada: student in aramandi instead', step({ dur: 5, f: () => SAMA.slice() }), pad(still(20, BASE_P)), { kind: 'hold' });
}
console.log(`\nPASS ${pass} FAIL ${fail}`); for (const f of fails) console.log('  - ' + f);
