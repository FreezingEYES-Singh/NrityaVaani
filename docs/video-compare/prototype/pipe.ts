// Full Phase-1 pipeline per 05-mvp.md §3.2–3.6 (revision 4), best-faith definitions where the spec is silent.
import * as L from './lib.ts';
const { render, segs, tipFeats, jitterCost, stillMask, pauseRuns, cutIdx, medPose, cost1, mean, median, pct, search, tauT, phases, mirrorJ, FPS, setSeed, still, stand, BASE_P, PART_SEGS } = L;
type TipF = L.TipF;
export const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');
// ---- calibration (what an implementer would do once on still footage, same noise model) ----
let CAL: { K: number; c: number; e: Record<string, number> } | null = null;
export function calib() {
  if (CAL) return CAL; const r: number[] = [], cs: number[] = [];
  for (let sd = 1; sd <= 4; sd++) { setSeed(sd * 31); for (const pp of [stand(15), still(15, BASE_P)]) { const tr = render(pp), F = tr.J.map(segs), J = jitterCost(F), cl = render(pp, { noise: 0 }).J.map(segs);
    r.push(...stillMask(F, J, 'disp', 1).speed.map((v) => v / J)); cs.push(mean(F.map((f, i) => cost1(f, cl[i]))) / J); } }
  CAL = { K: 1.1 * pct(r, 0.999), c: median(cs), e: {} };
  { setSeed(77); const pp = still(20, BASE_P), F = render(pp).J.map(segs), J = jitterCost(F); const e = partEnergy(F, F.map((_, i) => i), false, J); for (const p of Object.keys(e)) CAL.e[p] = e[p] / J; }
  return CAL;
}
export type Opts = { tCam?: L.Cam; sCam?: L.Cam; order?: 'literal' | 'fixed'; mT?: number; energy?: 'raw' | 'net'; skipW?: number; rm?: 'spec' | 'path'; seed?: number; forceKind?: string; phaseSmooth?: number };
const FEAT: { k: keyof TipF; part: string; tol: number; kind: 'two' | 'bendFine' | 'moreFine' | 'lessFine'; rom?: boolean }[] = [
  { k: 'kneeL', part: 'legs', tol: 15, kind: 'bendFine', rom: true }, { k: 'kneeR', part: 'legs', tol: 15, kind: 'bendFine', rom: true },
  { k: 'elbL', part: 'arms', tol: 20, kind: 'two', rom: true }, { k: 'elbR', part: 'arms', tol: 20, kind: 'two', rom: true },
  { k: 'armL', part: 'arms', tol: 15, kind: 'two', rom: true }, { k: 'armR', part: 'arms', tol: 15, kind: 'two', rom: true },
  { k: 'kneeSp', part: 'legs', tol: 0.25, kind: 'moreFine' }, { k: 'footSp', part: 'legs', tol: 0.25, kind: 'two' },
  { k: 'tilt', part: 'torso', tol: 8, kind: 'lessFine' },
];
const badDiff = (kind: string, s: number, t: number) => kind === 'bendFine' ? s - t : kind === 'moreFine' ? t - s : kind === 'lessFine' ? Math.abs(s) - Math.abs(t) : s - t;
type Tip = { id: string; part: string; sev: number; why: string };
function judge(pairs: [number, number][], TS: TipF[], TT: TipF[], tIdx: number[], ph: [number, number][], jS: number) {
  // pairs: [student frame (orig idx), teacher frame (orig idx)]; tIdx: teacher step frames (orig idx); ph: phases in teacher-cut index space -> mapped by position in tIdx
  const pos = new Map<number, number>(); tIdx.forEach((t, i) => pos.set(t, i)); const N = tIdx.length;
  const tips: Tip[] = []; const okHalf: Record<string, boolean> = { arms: true, legs: true, torso: true };
  const sFrames = [...new Set(pairs.map(([m]) => m))];
  for (const F of FEAT) {
    let fail = 0, worst = 0, why = '';
    for (const [a, b] of ph) {
      const d = pairs.filter(([, n]) => { const p = pos.get(n)!; return p >= a && p < b; }).map(([m, n]) => badDiff(F.kind, TS[m][F.k], TT[n][F.k]));
      if (d.length < 3) continue; const md = median(d);
      const bad = F.kind === 'two' ? Math.abs(md) > F.tol : md > F.tol;
      if (bad) { fail += (b - a) / N; worst = Math.max(worst, Math.abs(md) / F.tol); why = `phase ${(a / FPS).toFixed(1)}-${(b / FPS).toFixed(1)}s med ${md.toFixed(1)}`; }
      if (F.kind === 'two' && Math.abs(md) > F.tol / 2) okHalf[F.part] = false;
    }
    if (fail > 0) tips.push({ id: F.k, part: F.part, sev: worst * fail, why });
    if (F.rom) { const tr = pct(tIdx.map((n) => TT[n][F.k]), 0.9) - pct(tIdx.map((n) => TT[n][F.k]), 0.1);
      if (tr >= 2 * F.tol) { const sr = pct(sFrames.map((m) => TS[m][F.k]), 0.9) - pct(sFrames.map((m) => TS[m][F.k]), 0.1);
        if (sr < 0.7 * tr) tips.push({ id: 'rom:' + F.k, part: F.part, sev: 1 - sr / tr, why: `range ${sr.toFixed(0)} vs ${tr.toFixed(0)}` }); } }
  }
  // bobbing
  const bobS = sFrames.map((m) => TS[m].bob), bobT = tIdx.map((n) => TT[n].bob);
  const d2 = bobS.slice(2).map((x, i) => x - 2 * bobS[i + 1] + bobS[i]); const jb = 1.4826 * median(d2.map(Math.abs)) / Math.sqrt(6);
  const sprS = pct(bobS, 0.9) - pct(bobS, 0.1), sprT = pct(bobT, 0.9) - pct(bobT, 0.1);
  if (sprS > sprT + Math.max(0.03, 3 * jb)) tips.push({ id: 'bob', part: 'torso', sev: (sprS - sprT) / 0.03, why: `spread ${sprS.toFixed(3)} vs ${sprT.toFixed(3)}+max(.03,${(3 * jb).toFixed(3)})` });
  // knee roll-in (absolute)
  let rollClaim = false, rollJudged = true; const rinfo: string[] = [];
  for (const [k, kn, rl, md] of [[0, 'kneeL', 'rollL', 'medL'], [1, 'kneeR', 'rollR', 'medR']] as const) {
    const bent = sFrames.filter((m) => 180 - TS[m][kn] >= 20);
    if (bent.length < FPS) { rollJudged = false; rinfo.push(`${k ? 'R' : 'L'}: ${bent.length} bent fr`); continue; }
    const share = bent.filter((m) => TS[m][rl] >= 25).length / bent.length, medial = median(bent.map((m) => TS[m][md]));
    rinfo.push(`${k ? 'R' : 'L'}: inward≥25 ${(share * 100).toFixed(0)}% medial ${medial.toFixed(2)}`);
    if (share >= 0.4 && medial > 0) rollClaim = true;
  }
  if (rollClaim) tips.push({ id: 'rollIn', part: 'legs', sev: 99, why: rinfo.join('; ') });
  const depthBlocked = rollClaim || !rollJudged;
  const out = tips.filter((t) => !(depthBlocked && (t.id === 'kneeL' || t.id === 'kneeR' || t.id === 'rom:kneeL' || t.id === 'rom:kneeR')));
  const strength = Object.keys(okHalf).filter((p) => okHalf[p] && !out.some((t) => t.part === p) && FEAT.some((F) => F.part === p && F.kind === 'two'));
  return { tips: out, strength, roll: rinfo.join('; ') + (depthBlocked ? ' [depth tips blocked]' : ''), blockedDepth: tips.filter((t) => depthBlocked && t.id.includes('knee') && t.id !== 'kneeSp').map((t) => t.id) };
}
function partEnergy(F: number[][], idx: number[], net: boolean, jit: number) {
  const out: Record<string, number> = {};
  for (const [p, gs] of Object.entries(PART_SEGS)) { const v: number[] = [];
    for (let i = 1; i < idx.length; i++) { if (idx[i] !== idx[i - 1] + 1) continue; const a = F[idx[i]], b = F[idx[i - 1]]; let s = 0; for (const g of gs) s += Math.hypot(a[2 * g] - b[2 * g], a[2 * g + 1] - b[2 * g + 1]); v.push(s / gs.length); }
    let e = mean(v); if (net) e = Math.max(0, e - CAL!.e[p] * jit); out[p] = e; }
  return out;
}
export function analyze(tFr: L.Fr[], sFr: L.Fr[], o: Opts = {}) {
  const cal = calib(); if (o.seed) setSeed(o.seed);
  L.setSkipW(o.skipW ?? 1); L.setRM(o.rm ?? 'spec');
  const tTr = render(tFr, o.tCam), sTr = render(sFr, o.sCam);
  const FT = tTr.J.map(segs), FS = sTr.J.map(segs), TT = tTr.J.map(tipFeats), TS = sTr.J.map(tipFeats);
  const jT = jitterCost(FT), jS = jitterCost(FS);
  const stT = stillMask(FT, jT, 'disp', cal.K), stS = stillMask(FS, jS, 'disp', cal.K);
  const runsT = pauseRuns(stT.still), runsS = pauseRuns(stS.still);
  const order = o.order ?? 'literal';
  const stillFrac = mean(stT.still.map(Number));
  let keepT = cutIdx(FT.length, runsT);
  const res: any = { stillFrac, jT, jS, pausesT: runsT.length, pausesS: runsS.length, cutS: FS.length - cutIdx(FS.length, runsS).length };
  let kind: string;
  if (order === 'literal') { // 05 §3.2 as written: pauses cut "before anything else", then hold test on what is left
    const fr = keepT.length ? keepT.filter((i) => stT.still[i]).length / keepT.length : NaN;
    if (keepT.length < FPS) { kind = 'EMPTY(teacher step cut as pause)'; }
    else kind = fr >= 0.6 ? 'hold' : 'x';
  } else kind = stillFrac >= 0.6 ? 'hold' : 'x';
  if (kind === 'hold' && order === 'fixed') keepT = FT.map((_, i) => i);
  const Q = keepT.map((i) => FT[i]);
  const mT = Q.length ? mean(Q.map((q) => cost1(q, medPose(Q)))) / (cal.c * jT) : NaN; res.mT = mT;
  if (kind === 'x') kind = mT >= (o.mT ?? 3) ? 'movement' : 'posture';
  if (o.forceKind) kind = o.forceKind;
  res.kind = kind; if (kind.startsWith('EMPTY')) return res;
  const tau = tauT(Q); res.tau = tau;
  const cutStudent = order === 'literal' || kind === 'movement';
  const keepS = cutStudent ? cutIdx(FS.length, runsS) : FS.map((_, i) => i);
  const S = keepS.map((i) => FS[i]);
  if (S.length < FPS) { res.found = false; res.reading = 'none'; res.note = 'student take entirely cut as pauses'; return res; }
  if (kind === 'movement') {
    const FSm = sTr.J.map((j) => segs(mirrorJ(j))), TSm = sTr.J.map((j) => tipFeats(mirrorJ(j))), Sm = keepS.map((i) => FSm[i]);
    const rN = search(Q, S), rM = search(Q, Sm);
    if (!rN.first || !rM.first) { res.found = false; res.reading = 'none'; res.note = 'take too short after cutting pauses'; return res; }
    const vel = (F: number[][], i: number) => (i > 0 ? F[i].map((x, c) => x - F[i - 1][c]) : F[i].map(() => 0));
    const vcost = (r: any, SS: number[][]) => mean(r.first.pairs.map(([m, n]: [number, number]) => { const a = vel(SS, m), b = vel(Q, n); let s = 0; for (let g = 0; g < 10; g++) s += Math.hypot(a[2 * g] - b[2 * g], a[2 * g + 1] - b[2 * g + 1]); return s / 10; }));
    const vN = vcost(rN, S), vM = vcost(rM, Sm); const mir = vM < 0.9 * vN ? 'M' : vN < 0.9 * vM ? 'N' : 'tie';
    res.mirror = mir + ` (vN ${f2(vN * 100)} vM ${f2(vM * 100)})`;
    const useM = mir === 'M', r = useM ? rM : rN, SS = useM ? Sm : S, TSu = useM ? TSm : TS;
    res.found = r.found; res.tries = r.tries.length; res.cost = r.first.cost; res.tests = r.info; res.span = r.first.span; res.comp = r.first.comp;
    const squeezed = r.found && (r.first.span < 0.75 || r.first.comp > 0.5);
    let reading = r.found ? 'full' : 'none'; let pairsList: [number, number][][] = r.tries.map((t: L.Try) => t.pairs.map(([m, n]) => [keepS[m], keepT[n]] as [number, number]));
    if (!r.found || squeezed) {
      // student's moving part: the run between cut pauses containing the forward best match
      const mid = Math.round((r.first.s + r.first.e) / 2); let a = mid, b = mid;
      while (a > 0 && keepS[a - 1] === keepS[a] - 1) a--; while (b < keepS.length - 1 && keepS[b + 1] === keepS[b] + 1) b++;
      const Qs = SS.slice(a, b + 1);
      if (Qs.length >= FPS) {
        const rr = search(Qs, Q, { maxTries: 1 });
        if (!rr.first) { res.rev = 'impossible (moving part > 3x teacher)'; } else {
        const perFwd = r.first.cost * Q.length / Math.max(1, r.first.e - r.first.s + 1), perRev = rr.first.cost;
        res.rev = `${rr.found ? 'found' : 'no'} cov ${f2((rr.first.e - rr.first.s + 1) / Q.length)} ${rr.info} perFwd ${f2(perFwd)} perRev ${f2(perRev)}`;
        if (rr.found && (!r.found || perRev < perFwd)) { reading = 'partial'; res.coverage = (rr.first.e - rr.first.s + 1) / Q.length;
          pairsList = [rr.first.pairs.map(([m, n]) => [keepS[a + n], keepT[m]] as [number, number])]; }
      } }
    }
    res.reading = reading;
    if (reading === 'none') return res;
    const ph = phases(Q, o.phaseSmooth ?? 0); res.nPhases = ph.length;
    const js = pairsList.map((p) => judge(p, TSu, TT, keepT, ph, jS));
    const need = Math.ceil(js.length / 2); const ids = new Set(js.flatMap((j) => j.tips.map((t) => t.id)));
    let tips = [...ids].filter((id) => js.filter((j) => j.tips.some((t) => t.id === id)).length >= need).map((id) => js[0].tips.find((t) => t.id === id) ?? js.find((j) => j.tips.some((t) => t.id === id))!.tips.find((t) => t.id === id)!);
    if (mir === 'tie') { const other = judge(rM.first.pairs.map(([m, n]) => [keepS[m], keepT[n]] as [number, number]), TSm, TT, keepT, ph, jS); const oid = new Set(other.tips.map((t) => t.id)); res.tieDropped = tips.filter((t) => !oid.has(t.id)).map((t) => t.id); tips = tips.filter((t) => oid.has(t.id)); }
    res.tips = tips; res.strength = js[0].strength; res.roll = js[0].roll; res.blocked = js[0].blockedDepth;
    if (reading === 'full') { const sp = r.first.span; res.timing = sp > 2 ? 'more than 2x slower' : sp < 0.5 ? 'more than 2x faster' : sp > 1.25 ? `${Math.round((sp - 1) * 100)}% slower` : sp < 0.8 ? `${Math.round((1 - sp) * 100)}% faster` : 'ok'; }
    return res;
  }
  // posture step / hold
  const medQ = medPose(Q), c = S.map((s) => cost1(s, medQ)), thr = Math.max(tau, 0.6 * median(c)); res.thr = thr; res.medC = median(c);
  const ok = c.map((x) => x <= thr), runs: [number, number][] = []; let st = -1;
  for (let i = 0; i <= ok.length; i++) { if (i < ok.length && ok[i] && (st < 0 || keepS[i] === keepS[i - 1] + 1)) { if (st < 0) st = i; } else { if (st >= 0) runs.push([st, i - 1]); st = i < ok.length && ok[i] ? i : -1; } }
  let judged: number[] = [];
  if (kind === 'posture') { const tot = runs.reduce((a, [x, y]) => a + y - x + 1, 0); res.found = tot >= 0.5 * Q.length; res.inPosture = tot; if (res.found) judged = runs.flatMap(([x, y]) => Array.from({ length: y - x + 1 }, (_, i) => keepS[x + i])); }
  else { let best: [number, number] | null = null; for (const r of runs) if (!best || r[1] - r[0] > best[1] - best[0]) best = r; res.longest = best ? (best[1] - best[0] + 1) / FPS : 0;
    res.found = !!best && best[1] - best[0] + 1 >= FPS;
    if (res.found) { const [x, y] = best!; let bi = x, bv = Infinity; for (let i = x; i + 30 - 1 <= y; i++) { const v = mean(Array.from({ length: 30 }, (_, j) => stS.speed[keepS[i + j]])); if (v < bv) { bv = v; bi = i; } }
      judged = Array.from({ length: Math.min(30, y - x + 1) }, (_, j) => keepS[bi + j]); res.window = `${(judged[0] / FPS).toFixed(1)}-${(judged[judged.length - 1] / FPS).toFixed(1)}s`; } }
  if (!res.found) return res;
  // posture as distributions: pair every judged student frame with the teacher's median-feature frame -> single phase
  const tmed = {} as TipF; for (const F of Object.keys(TT[0]) as (keyof TipF)[]) (tmed as any)[F] = median(keepT.map((n) => TT[n][F]));
  const TT2 = [...TT, tmed], pairs = judged.map((m) => [m, TT.length] as [number, number]);
  const j = judge(pairs, TS, TT2, [...keepT, TT.length], [[0, keepT.length + 1]], jS);
  res.tips = j.tips.filter((t) => !t.id.startsWith('rom:')); res.strength = j.strength; res.roll = j.roll; res.blocked = j.blockedDepth;
  if (kind === 'posture') { const eT = partEnergy(FT, keepT, o.energy === 'net', jT), eS = partEnergy(FS, judged, o.energy === 'net', jS);
    res.energy = Object.keys(eT).map((p) => `${p} ${f2((eS[p] / eT[p]))}`).join(' ');
    for (const p of Object.keys(eT)) if (eS[p] < 0.3 * eT[p]) res.tips.push({ id: 'hardlyMoved:' + p, part: p, sev: 1, why: '' }); }
  return res;
}
export function show(name: string, r: any, expect: string) {
  const tips = r.tips ? r.tips.map((t: Tip) => t.id).join(',') : '';
  const bits = [name.padEnd(36), String(r.kind).padEnd(9), `mT ${f2(r.mT)}`, `still ${f2(r.stillFrac)}`,
    r.kind === 'movement' ? `${r.found ? 'FOUND' : 'no'}/${r.reading} tries ${r.tries} cost ${f2(r.cost)} span ${f2(r.span)} [${r.tests}] mir ${r.mirror}` : `${r.found ? 'FOUND' : 'no'} ${r.window ?? ''} inPost ${r.inPosture ?? ''} longest ${f2(r.longest)} thr ${f2(r.thr)} medC ${f2(r.medC)}`,
    r.coverage ? `cov ${f2(r.coverage)}` : '', r.rev ? `rev{${r.rev}}` : '', `tips[${tips}]`, r.strength?.length ? `str[${r.strength}]` : '', r.timing ? `timing:${r.timing}` : '',
    r.energy ? `E{${r.energy}}` : '', r.blocked?.length ? `blocked[${r.blocked}]` : '', r.tieDropped?.length ? `tieDrop[${r.tieDropped}]` : '', `cutS ${r.cutS}`, r.note ? 'NOTE ' + r.note : ''];
  console.log(bits.filter(Boolean).join(' | ') + '   <= expect: ' + expect);
  if (process.env.V) console.log('      roll:', r.roll, 'phases', r.nPhases, 'tau', f2(r.tau));
}
