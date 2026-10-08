/**
 * analyze(): teacher step + student take -> CompareResult (05-mvp.md §3.2–3.6). Pure TS.
 */
import {
  ALL_PARTS_ON,
  GRID_FPS,
  type Band,
  type CompareResult,
  type Part,
  type PartSwitches,
  type Pause,
  type PoseTrack,
  type StepKind,
  type Tip,
  type TimeMapPoint,
  type TryMatch,
} from "./types.ts";
import {
  type AFrame,
  type GFrame,
  type Jitter,
  type TakeGeom,
  type TipF,
  type TipKey,
  ANGLE3D,
  A_DIRS,
  STILL_K,
  TIP_KEYS,
  alignFrame,
  angleBias,
  cost,
  displacement,
  measureJitter,
  medianFrame,
  mirrorBody,
  runsOf,
  neutralFrame,
  resample,
  swapLandmark,
  takeGeom,
  tipFrame,
  toleranceCost,
} from "./features.ts";
import {
  HOLD_STILL_SHARE,
  MOTION_MOVEMENT,
  type Found,
  type PauseCut,
  costMatrix,
  cutPauses,
  heldIn,
  inPosture,
  motionOf,
  phases,
  runsBridged,
  search,
  steadiest,
  stillMask,
} from "./align.ts";
import { FEATS, judge, type JudgeOut, type RawTip } from "./feedback.ts";
import { MESSAGES, WORDS, timingText } from "./tips.en.ts";
import { clamp, mean, median, sgNoiseFactor, sgResidual } from "./math.ts";

const FIT_HALF = Math.round(GRID_FPS / 2);

/** Test hook: receives internal values while analysing (never used by the app). */
export const debug: { log?: (key: string, value: unknown) => void } = {};

interface Prepared {
  G: GFrame[];
  geom: TakeGeom;
  af: (AFrame | null)[];
  tf: (TipF | null)[];
  jit: Jitter;
  disp: number[];
  still: boolean[];
  /** Noise SD of each tip feature. */
  fsd: Record<TipKey, number>;
  /** Hip height smoothed over ±3 frames (bobbing is slower than noise). */
  bob: number[];
}

function featureNoise(tf: (TipF | null)[]): Record<TipKey, number> {
  const out = {} as Record<TipKey, number>;
  const k = sgNoiseFactor(FIT_HALF);
  for (const key of TIP_KEYS) {
    const series = tf.map((f) => (f && f.vis[key] >= 0.5 ? f.v[key] : NaN));
    const r = sgResidual(series, FIT_HALF).filter(Number.isFinite).map(Math.abs);
    out[key] = r.length ? 1.4826 * median(r) * k : 0;
  }
  return out;
}

function smoothBob(tf: (TipF | null)[]): number[] {
  return tf.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let d = -3; d <= 3; d++) {
      const f = tf[i + d];
      if (f && Number.isFinite(f.v.bob)) {
        s += f.v.bob;
        n++;
      }
    }
    return n >= 4 ? s / n : NaN;
  });
}

function prepare(track: PoseTrack, parts: PartSwitches, mirrored: boolean): Prepared {
  let G = resample(track);
  if (mirrored) G = G.map((f) => ({ t: f.t, body: f.body ? mirrorBody(f.body) : null }));
  const geom = takeGeom(G);
  const af = G.map((f) => (f.body ? alignFrame(f.body, geom, parts) : null)).map((a) =>
    a && a.w.reduce((s, x) => s + x, 0) >= 2 ? a : null,
  );
  const tf = G.map((f, i) => (f.body && af[i] ? tipFrame(f.body, geom) : null));
  const jit = measureJitter(G, af, geom);
  const disp = displacement(G, geom);
  const still = stillMask(disp, jit.pos, STILL_K);
  return { G, geom, af, tf, jit, disp, still, fsd: featureNoise(tf), bob: smoothBob(tf) };
}

const count = (a: unknown[]) => a.reduce<number>((n, x) => n + (x ? 1 : 0), 0);

/** §3.2.2: step kind decided on the uncut teacher step. */
export function teacherStepKind(
  teacher: PoseTrack,
  parts: PartSwitches = ALL_PARTS_ON,
): { kind: StepKind; motion: number; stillShare: number } {
  return kindOf(prepare(teacher, parts, false));
}

function kindOf(T: Prepared): { kind: StepKind; motion: number; stillShare: number } {
  const motion = motionOf(T.af, T.jit.cost);
  const valid = T.af.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  const stillShare = valid.length ? valid.filter((i) => T.still[i]).length / valid.length : 0;
  let kind: StepKind = "posture";
  if (stillShare >= HOLD_STILL_SHARE && motion < MOTION_MOVEMENT) kind = "hold";
  else if (motion >= MOTION_MOVEMENT) kind = "movement";
  return { kind, motion, stillShare };
}

function emptyBands(note: string): Record<Part | "timing", Band> {
  return {
    arms: { level: "na", note },
    legs: { level: "na", note },
    torso: { level: "na", note },
    timing: { level: "na", note },
  };
}

function baseResult(kind: StepKind, message: string | null, warnings: string[]): CompareResult {
  return {
    kind,
    found: false,
    reading: "none",
    coverage: 0,
    mirrored: false,
    tries: [],
    pauses: [],
    timing: { ratio: null, text: null },
    tips: [],
    strength: null,
    bands: emptyBands("Not judged"),
    notChecked: [],
    warnings,
    map: [],
    message,
  };
}

/** Componentwise median of tip features (posture steps compare distributions). */
function medianTip(fs: TipF[]): TipF | null {
  if (!fs.length) return null;
  const v = {} as Record<TipKey, number>;
  const vis = {} as Record<TipKey, number>;
  for (const k of TIP_KEYS) {
    v[k] = median(fs.map((f) => f.v[k]));
    vis[k] = median(fs.map((f) => f.vis[k]));
  }
  return {
    v,
    vis,
    rollL: median(fs.map((f) => f.rollL)),
    rollR: median(fs.map((f) => f.rollR)),
    medL: median(fs.map((f) => f.medL)),
    medR: median(fs.map((f) => f.medR)),
    yaw: median(fs.map((f) => f.yaw)),
  };
}

/** The teacher frame closest to its median pose (a real pose, for the 3D bias estimate). */
function medoid(T: Prepared): number {
  const m = medianFrame(T.af.filter((a): a is AFrame => !!a));
  let bi = -1;
  let bc = Infinity;
  T.af.forEach((a, i) => {
    if (!a || !m || !T.G[i].body?.p3) return;
    const c = cost(a, m);
    if (c < bc) {
      bc = c;
      bi = i;
    }
  });
  return bi;
}

interface Bias {
  s: Record<string, number>;
  t: Record<string, number>;
  skip: Set<TipKey>;
}
function biases(T: Prepared, S: Prepared): Bias {
  const i = medoid(T);
  const ref = i >= 0 ? T.G[i].body!.p3! : null;
  const s = ref ? angleBias(ref, S.jit.world, 11) : {};
  const t = ref ? angleBias(ref, T.jit.world, 12) : {};
  const skip = new Set<TipKey>();
  for (const k of ANGLE3D) {
    const tol = FEATS.find((f) => f.k === k)!.tol;
    if (Math.max(Math.abs(s[k] ?? 0), Math.abs(t[k] ?? 0)) > tol / 2) skip.add(k);
  }
  return { s, t, skip };
}

function viewOk(S: (TipF | null)[], sIdx: number[], T: (TipF | null)[], tIdx: number[]): boolean {
  const ys = median(sIdx.map((m) => S[m]?.yaw ?? NaN));
  const yt = median(tIdx.map((n) => T[n]?.yaw ?? NaN));
  if (!Number.isFinite(ys) || !Number.isFinite(yt)) return true;
  let d = Math.abs(ys - yt) % 360;
  if (d > 180) d = 360 - d;
  return d <= 30;
}

/* ------------------------------------------------------------------ */

export function analyze(
  teacher: PoseTrack,
  student: PoseTrack,
  parts: PartSwitches = ALL_PARTS_ON,
): CompareResult {
  const warnings = [...new Set([...teacher.warnings, ...student.warnings])];
  const T = prepare(teacher, parts, false);
  const S = prepare(student, parts, false);
  if (count(T.af) < GRID_FPS) return baseResult("posture", MESSAGES.teacherEmpty, warnings);
  const k = kindOf(T);
  debug.log?.("kind", { ...k, jitT: T.jit, jitS: S.jit });
  if (count(S.af) < GRID_FPS) return baseResult(k.kind, MESSAGES.tooShort, warnings);
  if (k.kind === "movement" && k.stillShare > 0.4) warnings.push(MESSAGES.mostlyStill);
  const SM = prepare(student, parts, true);
  const tol = toleranceCost(parts);
  return k.kind === "movement"
    ? movement(T, S, SM, parts, tol, warnings)
    : postureOrHold(k.kind, T, S, SM, parts, tol, warnings);
}

/* ------------------------------------------------------------------ */
/* Movement steps                                                       */
/* ------------------------------------------------------------------ */

interface Orient {
  P: Prepared;
  cut: PauseCut;
  Sx: (AFrame | null)[];
  res: ReturnType<typeof search>;
}

function movement(
  T: Prepared,
  S: Prepared,
  SM: Prepared,
  parts: PartSwitches,
  tol: number,
  warnings: string[],
): CompareResult {
  const TR = GRID_FPS; // ±1 s around a teacher pause run
  const tauPT = tol + 2 * T.jit.cost;
  const allT = T.af.map((_, i) => i);
  // a teacher still run is part of the step if it touches the edge of the selection,
  // or if the same pose is held elsewhere in the step
  const cutT = cutPauses(T.af, T.still, (pose, [a, b]) => {
    if (a === 0 || b >= T.af.length - 1) return true;
    const outside = allT.filter((i) => i < a - TR || i > b + TR);
    return heldIn(pose, T.af, T.still, outside, tauPT, GRID_FPS);
  });
  const keepT = cutT.keep;
  const Q = keepT.map((i) => T.af[i]);
  const N = Q.length;
  const teacherRef = Q.filter((q): q is AFrame => !!q);
  const qNeutral = (n: number) => cutT.neutral.has(keepT[n]);
  const tauP = tol + 2 * S.jit.cost;
  const neutral = neutralFrame(T.geom);
  const tau = Math.max(0.5 * mean(teacherRef.map((q) => cost(q, neutral))), tauP);

  // Student still runs (>= 1.5 s):
  // - far from every teacher frame: a pause, cut;
  // - a pose the teacher holds (>= 1 s) in the step: part of the step, kept;
  // - a pose the teacher only passes through: kept for a first match; if that match
  //   has to stretch the run >= 2.5x against the teacher (and >= 1.8x your own pace over the rest
  //   of the match), it was an inserted pause, so cut it and match again.
  const near = (pose: AFrame) => teacherRef.some((q) => cost(pose, q) <= tauP);
  const held = (pose: AFrame) => heldIn(pose, T.af, T.still, keepT, tauP, GRID_FPS);
  const orient = (P: Prepared): Orient => {
    const run = (cut: PauseCut): Orient => {
      const Sx = cut.keep.map((i) => P.af[i]);
      const cm = costMatrix(Q, Sx, qNeutral, (m) => cut.neutral.has(cut.keep[m]));
      return { P, cut, Sx, res: search(Q, Sx, cm, tau, { scored: (m) => !!Sx[m] && !cut.neutral.has(cut.keep[m]) }) };
    };
    const first = run(cutPauses(P.af, P.still, (pose) => near(pose)));
    const best = first.res.tries[0] ?? first.res.first;
    if (!best) return first;
    const stretched = new Set<number>();
    const cutStarts = new Set(first.cut.runs.map(([a]) => a));
    for (const [a, b] of runsOf(P.still)) {
      if (b - a + 1 < Math.round(1.5 * GRID_FPS) || cutStarts.has(a)) continue;
      const pose = medianFrame(P.af.slice(a, b + 1).filter((f): f is AFrame => !!f));
      if (!pose || held(pose)) continue;
      const inRun = (m: number) => first.cut.keep[m] >= a && first.cut.keep[m] <= b;
      const rows = best.pairs.filter(([m]) => inRun(m)).map(([, n]) => n);
      if (!rows.length) continue;
      const span = Math.max(...rows) - Math.min(...rows) + 1;
      // your own pace over the rest of the match, so a take that is slow all through isn't "paused"
      const rest = best.pairs.filter(([m]) => !inRun(m));
      const pace = rest.length ? new Set(rest.map(([m]) => m)).size / Math.max(1, new Set(rest.map(([, n]) => n)).size) : 1;
      debug.log?.("stretch", { run: [a, b], len: b - a + 1, span, pace: +pace.toFixed(2) });
      // >= 2.5x as stretched as 1x, and >= 1.8x your own pace elsewhere
      const len = b - a + 1;
      if (len >= 2.5 * span && len >= 1.8 * pace * span) stretched.add(a);
    }
    if (!stretched.size) return first;
    return run(cutPauses(P.af, P.still, (pose, [a]) => near(pose) && !stretched.has(a)));
  };
  const oN = orient(S);
  const oM = orient(SM);
  const pauses: Pause[] = [
    ...cutT.runs.map(([a, b]) => ({ who: "teacher" as const, start: T.G[a].t, end: T.G[b].t })),
    ...oN.cut.runs.map(([a, b]) => ({ who: "student" as const, start: S.G[a].t, end: S.G[b].t })),
  ];

  // mirror: decided on segment velocities, the student's scaled by the matched speed
  const vcost = (o: Orient): number => {
    const f = o.res.tries[0] ?? o.res.first;
    if (!f) return Infinity;
    const vals: number[] = [];
    for (const [m, n] of f.pairs) {
      if (m < 1 || n < 1) continue;
      if (o.cut.keep[m] !== o.cut.keep[m - 1] + 1 || keepT[n] !== keepT[n - 1] + 1) continue;
      const a = o.Sx[m];
      const ap = o.Sx[m - 1];
      const b = Q[n];
      const bp = Q[n - 1];
      if (!a || !ap || !b || !bp) continue;
      let s = 0;
      let W = 0;
      for (let g = 0; g < A_DIRS; g++) {
        const w = Math.min(a.w[g], b.w[g]);
        if (w <= 0) continue;
        const dx = (a.f[2 * g] - ap.f[2 * g]) * f.span - (b.f[2 * g] - bp.f[2 * g]);
        const dy = (a.f[2 * g + 1] - ap.f[2 * g + 1]) * f.span - (b.f[2 * g + 1] - bp.f[2 * g + 1]);
        s += w * Math.hypot(dx, dy);
        W += w;
      }
      if (W > 0) vals.push(s / W);
    }
    return vals.length ? mean(vals) : Infinity;
  };
  const vN = vcost(oN);
  const vM = vcost(oM);
  const dbg = (x: Orient) => ({
    cutRuns: x.cut.runs,
    tries: x.res.tries.map((t) => ({ s: t.s, e: t.e, cost: +t.cost.toFixed(3), span: +t.span.toFixed(2), comp: +t.compression.toFixed(2) })),
    first: x.res.first && { s: x.res.first.s, e: x.res.first.e, cost: +x.res.first.cost.toFixed(3), span: +x.res.first.span.toFixed(2), ceil: x.res.first.ceilOk, move: x.res.first.moveOk, nullCost: +x.res.first.nullCost.toFixed(3), ratio: +(x.res.first.cost / x.res.first.nullCost).toFixed(2), centred: +x.res.first.centred.toFixed(2) },
  });
  debug.log?.("movement", { tau: +tau.toFixed(3), tauP: +tauP.toFixed(3), cutT: cutT.runs, N, vN: +vN.toFixed(4), vM: +vM.toFixed(4), N_: dbg(oN), M_: dbg(oM) });
  // mirror, in order: how well the movement follows the teacher's with constant pose errors
  // taken out (a clear 30% win); then a clearly lower matching cost (10%); then the velocities
  // (10%); otherwise a tie (the normal way, keeping only tips both readings agree on)
  const bN = oN.res.tries[0] ?? oN.res.first;
  const bM = oM.res.tries[0] ?? oM.res.first;
  const cN = bN?.cost ?? Infinity;
  const cM = bM?.cost ?? Infinity;
  const zN = bN?.centred ?? Infinity;
  const zM = bM?.centred ?? Infinity;
  let choice: "N" | "M" | "tie" =
    zN < 0.7 * zM
      ? "N"
      : zM < 0.7 * zN
        ? "M"
        : cN < 0.9 * cM
          ? "N"
          : cM < 0.9 * cN
            ? "M"
            : vM < 0.9 * vN
              ? "M"
              : vN < 0.9 * vM
                ? "N"
                : "tie";
  // a reading that finds the step beats one that doesn't, unless the velocities clearly disagree
  if (choice === "tie" && !oN.res.tries.length && oM.res.tries.length) choice = "M";
  if (choice === "M" && !oM.res.tries.length && oN.res.tries.length && !(vM < 0.75 * vN)) choice = "N";
  const o = choice === "M" ? oM : oN;
  const other = choice === "M" ? oN : oM;
  const r = o.res;

  // full or partial reading
  let reading: CompareResult["reading"] = r.tries.length ? "full" : "none";
  let coverage = r.tries.length ? 1 : 0;
  // pairs in grid indices: [student grid, teacher grid]
  // teacher frames in the transition around a cut teacher pause are never scored
  const tScored = (pairs: [number, number][]) => pairs.filter(([, n]) => !cutT.neutral.has(n));
  let tryPairs: [number, number][][] = r.tries.map((t) => tScored(t.pairs.map(([m, n]) => [o.cut.keep[m], keepT[n]] as [number, number])));
  let romT: number[] = keepT.filter((n) => !cutT.neutral.has(n));
  const squeezed = r.tries.length > 0 && (r.tries[0].span < 0.75 || r.tries[0].compression > 0.5);
  if ((!r.tries.length || squeezed) && r.first) {
    const part = partialSearch(o, Q, keepT, r.first, tauP, teacherRef, S.jit.cost + tol, r.tries.length > 0);
    debug.log?.("partial", part && { coverage: part.coverage, perFrame: part.perFrame });
    if (part) {
      const perFwd = r.tries.length ? (r.first.cost * N) / Math.max(1, r.first.e - r.first.s + 1) : Infinity;
      if (part.coverage < 0.9 && part.perFrame < perFwd) {
        reading = "partial";
        coverage = part.coverage;
        tryPairs = [tScored(part.pairs)];
        romT = part.tSpan.filter((n) => !cutT.neutral.has(n));
      }
    }
  }
  if (reading === "none") {
    const res = baseResult("movement", MESSAGES.notFoundMovement, warnings);
    res.pauses = pauses;
    res.mirrored = choice === "M";
    return res;
  }

  // judge every try
  const Qph = phases(Q);
  const phaseByGrid = new Map<number, number>();
  Qph.forEach(([a, b], p) => {
    for (let n = a; n < b; n++) phaseByGrid.set(keepT[n], p);
  });
  const phaseShare = Qph.map(([a, b]) => (b - a) / N);
  debug.log?.("phases", Qph);
  const bias = biases(T, o.P);
  const unscored = o.cut.neutral;
  const judgeTry = (P: Prepared, pairs: [number, number][], romS: number[], romTT: number[]) =>
    judge({
      pairs,
      S: P.tf,
      T: T.tf,
      tMedian: null,
      phaseOf: (n) => phaseByGrid.get(n) ?? 0,
      phaseShare,
      romS,
      romT: romTT,
      viewOk: viewOk(P.tf, pairs.map(([m]) => m), T.tf, pairs.map(([, n]) => n)),
      biasS: bias.s,
      biasT: bias.t,
      skip: bias.skip,
      parts,
      jitPos: P.jit.pos,
      jitPosT: T.jit.pos,
      sdS: P.fsd,
      sdT: T.fsd,
      bobS: P.bob,
      bobT: T.bob,
      unscored: P === o.P ? unscored : other.cut.neutral,
    });
  // pairs scored on both sides (no transition frame on either)
  const both = (pairs: [number, number][], neutralS: Set<number>) => pairs.filter(([m]) => !neutralS.has(m));
  const outs = tryPairs.map((pairs) => {
    const sp = both(pairs, o.cut.neutral);
    const romS = [...new Set(sp.map(([m]) => m))];
    const romTT = reading === "partial" ? romT : [...new Set(sp.map(([, n]) => n))];
    return judgeTry(o.P, pairs, romS, romTT);
  });
  let raw = combineTries(outs);
  debug.log?.("raw", { raw: raw.map((t) => `${t.id}:${t.severity.toFixed(2)}`), skipped: outs[0]?.skipped, rollJudged: outs[0]?.rollJudged, bias: bias.s });
  if (choice === "tie" && other.res.first) {
    const f = other.res.tries[0] ?? other.res.first;
    const pairs = tScored(f.pairs.map(([m, n]) => [other.cut.keep[m], keepT[n]] as [number, number]));
    const sp = both(pairs, other.cut.neutral);
    const oj = judgeTry(other.P, pairs, [...new Set(sp.map(([m]) => m))], [...new Set(sp.map(([, n]) => n))]);
    const groups = new Set(oj.tips.map((t) => t.group));
    raw = raw.filter((t) => groups.has(t.group));
  }

  const mirrored = choice === "M";
  const tips = finalTips(raw, o.P, T, mirrored);
  const tries: TryMatch[] =
    reading === "full"
      ? r.tries.map((t) => ({ start: o.P.G[o.cut.keep[t.s]].t, end: o.P.G[o.cut.keep[t.e]].t, cost: t.cost }))
      : [
          {
            start: o.P.G[Math.min(...tryPairs[0].map(([m]) => m))].t,
            end: o.P.G[Math.max(...tryPairs[0].map(([m]) => m))].t,
            cost: NaN,
          },
        ];
  let timing: CompareResult["timing"] = { ratio: null, text: null };
  if (reading === "full") {
    // speed: your matched frames / the teacher's, pauses and their transitions left out on both sides
    const sp = both(tryPairs[0], o.cut.neutral);
    const ratio = new Set(sp.map(([m]) => m)).size / Math.max(1, new Set(sp.map(([, n]) => n)).size);
    timing = { ratio, text: timingText(ratio) };
  }
  const notChecked: string[] = [];
  if (reading === "partial") notChecked.push(MESSAGES.partial(coverage));
  const bands = makeBands(outs, tips, parts, reading === "full" ? timing.ratio : null, notChecked, "movement");
  if (outs.some((j) => j.skipped.arms.includes("armL") || j.skipped.legs.includes("footSp")) && !viewOk(o.P.tf, tryPairs[0].map(([m]) => m), T.tf, tryPairs[0].map(([, n]) => n)))
    warnings.push(MESSAGES.view);
  return {
    kind: "movement",
    found: true,
    reading,
    coverage,
    mirrored,
    tries,
    pauses,
    timing,
    tips,
    strength: strengthOf(outs, tips, parts),
    bands,
    notChecked,
    warnings,
    map: timeMap(tryPairs[0], o.P.G, T.G),
    message: reading === "partial" ? MESSAGES.partial(coverage) : null,
  };
}

/**
 * Reverse search (§3.4 partial practice): the query is the student's frames
 * near some teacher frame (within tauP) around the forward best candidate.
 */
function partialSearch(
  o: Orient,
  Q: (AFrame | null)[],
  keepT: number[],
  first: Found,
  tauP: number,
  teacherRef: AFrame[],
  floor: number,
  forwardFound: boolean,
): { pairs: [number, number][]; coverage: number; perFrame: number; tSpan: number[] } | null {
  const keep = o.cut.keep;
  // the run of kept frames (no cut pause inside) containing the forward match
  let a = first.s;
  let b = first.e;
  while (a > 0 && keep[a - 1] === keep[a] - 1) a--;
  while (b < keep.length - 1 && keep[b + 1] === keep[b] + 1) b++;
  const near: boolean[] = [];
  const masked: boolean[] = [];
  for (let i = a; i <= b; i++) {
    const s = o.Sx[i];
    masked.push(!s);
    if (!s) {
      near.push(false);
      continue;
    }
    let mn = Infinity;
    for (const q of teacherRef) {
      const c = cost(s, q);
      if (c < mn) mn = c;
    }
    near.push(mn <= tauP);
  }
  const runs = runsBridged(near, masked, Math.round(GRID_FPS / 2));
  debug.log?.("partial-query", { region: [a, b], nearCount: near.filter(Boolean).length, runs });
  if (!runs.length) return null;
  // the block overlapping the forward match the most, else the longest
  let best = runs[0];
  let bestScore = -1;
  for (const [x, y] of runs) {
    const ov = Math.max(0, Math.min(y + a, first.e) - Math.max(x + a, first.s) + 1);
    const score = ov * 1000 + (y - x);
    if (score > bestScore) {
      bestScore = score;
      best = [x, y];
    }
  }
  const qs = best[0] + a;
  const qe = best[1] + a;
  const Qs = o.Sx.slice(qs, qe + 1);
  if (Qs.length < GRID_FPS || Qs.length > 3 * Q.length) return null;
  const cm = costMatrix(Qs, Q);
  const neutralCost = 0.5 * mean(Qs.filter((x): x is AFrame => !!x).map((x) => cost(x, neutralFrame(o.P.geom))));
  // When the forward search already found the step (only squeezed), the reverse search just
  // measures how much of it was practised: a constant pose error (an arm held low) raises both
  // costs of the movement test, so it allows 0.8. When nothing was found, it must pass the
  // strict 0.7: any dancing matches *some* part of the teacher's step moderately well.
  const rr = search(Qs, Q, cm, Math.max(neutralCost, floor), { maxTries: 1, moveK: forwardFound ? 0.8 : 0.7, centredK: 1.0 });
  debug.log?.("partial-search", { q: [qs, qe], tau: Math.max(neutralCost, floor), first: rr.first && { cost: rr.first.cost, span: rr.first.span, ceil: rr.first.ceilOk, move: rr.first.moveOk, ratio: rr.first.cost / rr.first.nullCost, centred: rr.first.centred, s: rr.first.s, e: rr.first.e } });
  if (!rr.tries.length) return null;
  const t0 = rr.tries[0];
  const pairs = t0.pairs.map(([m, n]) => [keep[qs + n], keepT[m]] as [number, number]);
  const tSpan: number[] = [];
  for (let m = t0.s; m <= t0.e; m++) tSpan.push(keepT[m]);
  return { pairs, coverage: (t0.e - t0.s + 1) / Q.length, perFrame: t0.cost, tSpan };
}

/** A tip must show up in at least half of the tries; the worst instance is kept. */
function combineTries(outs: JudgeOut[]): RawTip[] {
  const need = Math.ceil(outs.length / 2);
  const byId = new Map<string, RawTip[]>();
  for (const j of outs) {
    const seen = new Set<string>();
    for (const t of j.tips) {
      if (seen.has(t.id)) {
        const list = byId.get(t.id)!;
        const last = list[list.length - 1];
        if (t.severity > last.severity) list[list.length - 1] = t;
        continue;
      }
      seen.add(t.id);
      if (!byId.has(t.id)) byId.set(t.id, []);
      byId.get(t.id)!.push(t);
    }
  }
  const out: RawTip[] = [];
  for (const list of byId.values()) {
    if (list.length < need) continue;
    out.push(list.reduce((a, b) => (b.severity > a.severity ? b : a)));
  }
  return out;
}

/** Top 3, one per part, ordered by severity, as public Tips. */
/**
 * Within a part, safety and depth come first: roll-in, then a knee-depth tip
 * (its wording already says "knees out over your toes"), then the rest by severity.
 */
const rank = (t: RawTip) =>
  t.id === "knee-rollin"
    ? 3
    : t.id === "knee-bend" || t.id === "knee-bend-safe" || t.id === "range:knee"
      ? 2
      : t.id === "range:arm" || t.id === "range:elbow"
        ? 1 // "your arms reach two thirds of the teacher's height" explains a low arm best
        : 0;

function finalTips(raw: RawTip[], P: Prepared, T: Prepared, mirrored: boolean): Tip[] {
  const perPart = new Map<Part, RawTip>();
  for (const t of raw) {
    const cur = perPart.get(t.part);
    if (!cur || rank(t) > rank(cur) || (rank(t) === rank(cur) && t.severity > cur.severity)) perPart.set(t.part, t);
  }
  return [...perPart.values()]
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 3)
    .map((t) => ({
      id: t.id,
      part: t.part,
      title: t.words.title,
      detail: t.words.detail,
      severity: t.severity,
      at: { student: P.G[t.at[0]]?.t ?? 0, teacher: t.at[1] >= 0 ? T.G[t.at[1]]?.t ?? null : null },
      marker: {
        joints: mirrored ? t.marker.joints.map(swapLandmark) : t.marker.joints,
        teacherJoints: t.marker.joints,
        arrow: t.marker.arrow,
      },
      beta: true as const,
    }));
}

function strengthOf(outs: JudgeOut[], tips: Tip[], parts: PartSwitches): CompareResult["strength"] {
  for (const p of ["arms", "legs"] as const) {
    if (!parts[p] || tips.some((t) => t.part === p)) continue;
    const ok = outs.every(
      (j) => j.close.has(p) && j.judged[p].some((k) => FEATS.find((f) => f.k === k)?.kind === "two"),
    );
    if (ok) return { part: p, text: WORDS.strength(p) };
  }
  return null;
}

const PART_NAMES: Record<string, string> = {
  kneeL: "knee bend",
  kneeR: "knee bend",
  elbL: "elbows",
  elbR: "elbows",
  armL: "arm height",
  armR: "arm height",
  kneeSp: "knee spread",
  footSp: "foot spread",
  tilt: "side tilt",
};

function makeBands(
  outs: JudgeOut[],
  tips: Tip[],
  parts: PartSwitches,
  timingRatio: number | null,
  notChecked: string[],
  kind: StepKind,
): Record<Part | "timing", Band> {
  const bands = {} as Record<Part | "timing", Band>;
  for (const p of ["arms", "legs", "torso"] as const) {
    if (!parts[p]) {
      bands[p] = { level: "na", note: "Switched off" };
      continue;
    }
    const judgedAny = outs.some((j) => j.judged[p].length);
    const skipped = [...new Set(outs.flatMap((j) => j.skipped[p]).map((k) => PART_NAMES[k] ?? k))];
    if (!judgedAny) {
      bands[p] = { level: "na", note: "Not checked: not clearly seen" };
      notChecked.push(`${cap(p)} weren't checked: they weren't clearly seen, or the view was too different.`);
      continue;
    }
    const tip = tips.find((t) => t.part === p);
    const worst = Math.max(...outs.map((j) => j.worst[p]));
    // no tip and every phase within the tolerance: close; a tip of up to 2x the tolerance: getting there
    const within = outs.every((j) => j.maxRatio[p] <= 1);
    let level: Band["level"] = tip ? (worst >= 2 || tip.id === "knee-rollin" ? "needs" : "getting") : within ? "close" : "getting";
    if (tip && level === "close") level = "getting";
    let note: string | undefined;
    if (p === "torso") note = MESSAGES.torsoPartly;
    if (skipped.length) {
      note = `Partly checked: ${skipped.join(", ")} not judged`;
      notChecked.push(`${cap(p)}: ${skipped.join(", ")} not judged (not clearly seen, too noisy, or a different camera angle).`);
    }
    bands[p] = { level, note };
  }
  if (timingRatio === null) {
    bands.timing = {
      level: "na",
      note: kind === "movement" ? "Not checked for a partial practice" : "Not checked for posture steps and holds",
    };
  } else {
    const r = timingRatio;
    bands.timing = { level: r >= 0.8 && r <= 1.25 ? "close" : r >= 0.67 && r <= 1.5 ? "getting" : "needs" };
  }
  return bands;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Smoothed student -> teacher time map for synced playback and the ghost: knots
 * every 2 s at the median teacher time paired with the student frames near the
 * knot, smoothed, monotonic, and with the local speed clamped to 0.5–2x
 * (the alignment wobbles frame to frame; playback mustn't).
 */
function timeMap(pairs: [number, number][], SG: GFrame[], TG: GFrame[]): TimeMapPoint[] {
  if (!pairs.length) return [];
  const byS = new Map<number, number[]>();
  for (const [m, n] of pairs) {
    if (!byS.has(m)) byS.set(m, []);
    byS.get(m)!.push(TG[n].t);
  }
  const ms = [...byS.keys()].sort((a, b) => a - b);
  const KNOT = 2 * GRID_FPS;
  const near = (i: number) => {
    const vals: number[] = [];
    for (let j = Math.max(0, i - 7); j <= Math.min(ms.length - 1, i + 7); j++) vals.push(...byS.get(ms[j])!);
    return median(vals);
  };
  const idx: number[] = [];
  for (let i = 0; i < ms.length; i += KNOT) idx.push(i);
  if (idx[idx.length - 1] !== ms.length - 1) idx.push(ms.length - 1);
  let pts: TimeMapPoint[] = idx.map((i) => ({ s: SG[ms[i]].t, t: near(i) }));
  // the ends use the exact first and last pairs, so playback starts and stops on the step
  pts[0] = { s: SG[ms[0]].t, t: mean(byS.get(ms[0])!) };
  pts[pts.length - 1] = { s: SG[ms[ms.length - 1]].t, t: mean(byS.get(ms[ms.length - 1])!) };
  if (pts.length > 2)
    pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { s: p.s, t: (pts[i - 1].t + 2 * p.t + pts[i + 1].t) / 4 }));
  for (let i = 1; i < pts.length; i++) {
    const ds = pts[i].s - pts[i - 1].s;
    const dt = clamp(pts[i].t - pts[i - 1].t, 0.5 * ds, 2 * ds);
    pts[i] = { s: pts[i].s, t: pts[i - 1].t + dt };
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* Posture steps and holds (§3.5)                                       */
/* ------------------------------------------------------------------ */

/** Energy is measured over 1/3 s, where stamps show their full size but noise doesn't grow. */
const ENERGY_LAG = 5;
/** Mean lagged direction change of pure noise, per unit of jitter cost (measured on synthetic still takes). */
const NOISE_ENERGY_K = 1.62;
/** A part counts as moved by the teacher when its energy is at least this many times the noise. */
const MOVES_K = 1.5;

function partEnergy(P: Prepared, idx: number[]): Record<Part, number> {
  const set = new Set(idx);
  const out: Record<Part, number> = { arms: 0, legs: 0, torso: 0 };
  const segsOf: Record<Part, number[]> = { arms: [0, 1, 2, 3], legs: [4, 5, 6, 7], torso: [8, 9] };
  for (const p of ["arms", "legs", "torso"] as const) {
    const v: number[] = [];
    for (const i of idx) {
      const j = i - ENERGY_LAG;
      if (!set.has(j)) continue;
      const a = P.af[i];
      const b = P.af[j];
      if (!a || !b) continue;
      let s = 0;
      let W = 0;
      for (const g of segsOf[p]) {
        const w = Math.min(a.w[g], b.w[g]);
        if (w <= 0) continue;
        s += w * Math.hypot(a.f[2 * g] - b.f[2 * g], a.f[2 * g + 1] - b.f[2 * g + 1]);
        W += w;
      }
      if (W > 0) v.push(s / W);
    }
    out[p] = v.length ? mean(v) : NaN;
  }
  return out;
}

function postureOrHold(
  kind: StepKind,
  T: Prepared,
  S: Prepared,
  SM: Prepared,
  parts: PartSwitches,
  tol: number,
  warnings: string[],
): CompareResult {
  const tValid = T.af.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  const pose = medianFrame(tValid.map((i) => T.af[i]!))!;
  const tauP = tol + 2 * S.jit.cost;
  const find = (P: Prepared) => {
    const ok = inPosture(P.af, pose, tauP);
    const runs = runsBridged(ok, P.af.map((a) => !a), Math.round(GRID_FPS / 2)).map(
      ([a, b]) => [a, b] as [number, number],
    );
    const inCount = ok.filter(Boolean).length;
    return { ok, runs, inCount };
  };
  const fN = find(S);
  const fM = find(SM);
  const mirrored = fM.inCount > 1.1 * fN.inCount;
  const P = mirrored ? SM : S;
  const f = mirrored ? fM : fN;
  let judged: number[] = [];
  let found = false;
  if (kind === "posture") {
    const total = f.ok.filter(Boolean).length;
    found = total >= 0.5 * tValid.length;
    if (found) judged = f.ok.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  } else {
    let best: [number, number] | null = null;
    for (const r of f.runs) if (!best || r[1] - r[0] > best[1] - best[0]) best = r;
    found = !!best && best[1] - best[0] + 1 >= GRID_FPS;
    if (found && best) {
      const [a, b] = steadiest(P.disp, best[0], best[1], 2 * GRID_FPS);
      for (let i = a; i <= b; i++) if (f.ok[i]) judged.push(i);
    }
  }
  if (!found) {
    const res = baseResult(kind, MESSAGES.notFoundPosture, warnings);
    if (kind === "posture") res.notChecked.push(MESSAGES.footworkNotChecked);
    return res;
  }
  const tMed = medianTip(tValid.map((i) => T.tf[i]).filter((t): t is TipF => !!t));
  const bias = biases(T, P);
  const pairs = judged.map((m) => [m, -1] as [number, number]);
  const out = judge({
    pairs,
    S: P.tf,
    T: T.tf,
    tMedian: tMed,
    phaseOf: () => 0,
    phaseShare: [1],
    romS: [],
    romT: [],
    viewOk: viewOk(P.tf, judged, T.tf, tValid),
    biasS: bias.s,
    biasT: bias.t,
    skip: bias.skip,
    parts,
    jitPos: P.jit.pos,
    jitPosT: 0,
    sdS: P.fsd,
    sdT: T.fsd,
    bobS: P.bob,
    bobT: T.bob,
    unscored: new Set(),
  });
  // the teacher's "worst moment" is its medoid frame
  const tm = medoid(T);
  const raw = out.tips.map((t) => ({ ...t, at: [t.at[0], tm] as [number, number] }));
  if (kind === "posture") {
    // part moving: noise-subtracted energy, only for parts the teacher moves
    const eT = partEnergy(T, tValid);
    const eS = partEnergy(P, judged);
    const nT = NOISE_ENERGY_K * T.jit.cost;
    const nS = NOISE_ENERGY_K * P.jit.cost;
    debug.log?.("energy", { eT, eS, nT, nS });
    for (const p of ["legs", "arms", "torso"] as const) {
      if (!parts[p] || !Number.isFinite(eT[p]) || !Number.isFinite(eS[p])) continue;
      if (eT[p] < MOVES_K * nT) continue;
      // noise adds in quadrature
      const netT = Math.sqrt(eT[p] ** 2 - nT ** 2);
      const netS = Math.sqrt(Math.max(0, eS[p] ** 2 - nS ** 2));
      if (netS < 0.3 * netT) {
        raw.push({
          id: `part-still:${p}`,
          group: `part-still:${p}`,
          part: p,
          severity: 3 * (1 - netS / netT),
          words: WORDS.partStill(p),
          at: [judged[Math.floor(judged.length / 2)], tm],
          side: -1,
          marker: {
            joints: p === "legs" ? [27, 28] : p === "arms" ? [15, 16] : [11, 12],
            arrow: null,
          },
          depth: false,
        });
        out.close.delete(p);
      }
    }
  }
  const tips = finalTips(raw, P, T, mirrored);
  const notChecked: string[] = [];
  if (kind === "posture") notChecked.push(MESSAGES.footworkNotChecked);
  const bands = makeBands([out], tips, parts, null, notChecked, kind);
  const s0 = P.G[judged[0]].t;
  const t0 = T.G[tValid[0]].t;
  return {
    kind,
    found: true,
    reading: "full",
    coverage: 1,
    mirrored,
    tries: [{ start: s0, end: P.G[judged[judged.length - 1]].t, cost: NaN }],
    pauses: [],
    timing: { ratio: null, text: null },
    tips,
    strength: strengthOf([out], tips, parts),
    bands,
    notChecked,
    warnings,
    map: [
      { s: s0, t: t0 },
      { s: s0 + 600, t: t0 + 600 },
    ],
    message: null,
  };
}
