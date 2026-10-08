/**
 * Feedback rules for /compare (05-mvp.md §3.6). Pure TS.
 *
 * Input: matched frame pairs (student grid index, teacher grid index) and the
 * tip features of both videos. Output: candidate tips per part with gates
 * applied, plus what could and couldn't be judged.
 */
import { LM, type Part, type PartSwitches } from "./types.ts";
import { ANGLE3D, type TipF, type TipKey } from "./features.ts";
import { mean, median, pct } from "./math.ts";
import { WORDS, type Wording } from "./tips.en.ts";

type Kind = "two" | "bendFine" | "moreFine" | "lessFine";

interface FeatDef {
  k: TipKey;
  part: Part;
  tol: number;
  kind: Kind;
  /** Range-of-movement check applies (movement steps). */
  rom: boolean;
  /** 2D feature, switched off by the view gate. */
  view: boolean;
}

export const FEATS: FeatDef[] = [
  { k: "kneeL", part: "legs", tol: 15, kind: "bendFine", rom: true, view: false },
  { k: "kneeR", part: "legs", tol: 15, kind: "bendFine", rom: true, view: false },
  { k: "elbL", part: "arms", tol: 20, kind: "two", rom: true, view: false },
  { k: "elbR", part: "arms", tol: 20, kind: "two", rom: true, view: false },
  { k: "armL", part: "arms", tol: 15, kind: "two", rom: true, view: true },
  { k: "armR", part: "arms", tol: 15, kind: "two", rom: true, view: true },
  { k: "kneeSp", part: "legs", tol: 0.25, kind: "moreFine", rom: false, view: true },
  { k: "footSp", part: "legs", tol: 0.25, kind: "two", rom: false, view: true },
  { k: "tilt", part: "torso", tol: 8, kind: "lessFine", rom: false, view: true },
];

/** Positive = worse, for one-sided features; signed for two-way ones. */
function badDiff(kind: Kind, s: number, t: number): number {
  if (kind === "bendFine") return s - t; // straighter than the teacher is bad
  if (kind === "moreFine") return t - s; // narrower than the teacher is bad
  if (kind === "lessFine") return Math.abs(s) - Math.abs(t); // leaning more is bad
  return s - t;
}

export interface RawTip {
  id: string;
  /** Feature id without the side, for comparing readings and tries. */
  group: string;
  part: Part;
  severity: number;
  words: Wording;
  /** Worst moment: [student grid idx, teacher grid idx] (teacher -1 = none). */
  at: [number, number];
  /** Internal joint side (0 = left, 1 = right) for the marker; -1 = both. */
  side: -1 | 0 | 1;
  marker: { joints: number[]; arrow: { dx: number; dy: number } | null };
  /** A knee-depth tip (blocked by the safety rules). */
  depth: boolean;
}

export interface JudgeInput {
  /** [student idx, teacher idx]; teacher idx -1 = the teacher's median (posture steps). */
  pairs: [number, number][];
  S: (TipF | null)[];
  T: (TipF | null)[];
  /** The teacher's median features (posture steps and holds). */
  tMedian: TipF | null;
  /** Phase index of each teacher idx (or 0 for -1). */
  phaseOf: (tIdx: number) => number;
  phaseShare: number[];
  /** Frames for the range-of-movement check (movement steps), else empty. */
  romS: number[];
  romT: number[];
  viewOk: boolean;
  biasS: Record<string, number>;
  biasT: Record<string, number>;
  skip: Set<TipKey>;
  parts: PartSwitches;
  /** The student's landmark jitter, torso lengths (bobbing threshold). */
  jitPos: number;
  /** The teacher's (0 when compared with the teacher's median pose). */
  jitPosT: number;
  /** Noise SD of each tip feature, per video (same local-fit definition as the jitter). */
  sdS: Record<TipKey, number>;
  sdT: Record<TipKey, number>;
  /** Hip height smoothed over ±3 frames, by grid index (bobbing). */
  bobS: number[];
  bobT: number[];
  /** Student frames not to score (pause transitions). */
  unscored: Set<number>;
}

export interface JudgeOut {
  tips: RawTip[];
  /** Per part: features that were judged / skipped (with a reason). */
  judged: Record<Part, TipKey[]>;
  skipped: Record<Part, string[]>;
  /** Parts where every two-way feature was within half its tolerance in every phase. */
  close: Set<Part>;
  /** Worst |median diff| / tol per part (for bands). */
  worst: Record<Part, number>;
  rollJudged: boolean;
}

const SIDE_JOINTS: Record<string, [number[], number[]]> = {
  knee: [[LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]],
  elb: [[LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]],
  arm: [[LM.L_SHOULDER, LM.L_ELBOW], [LM.R_SHOULDER, LM.R_ELBOW]],
};

/** Test hook for the bobbing check (never set by the app). */
let debugBob: ((v: Record<string, number>) => void) | undefined;
export function setDebugBob(f: typeof debugBob) {
  debugBob = f;
}

const VIS_MIN = 0.6;
/**
 * Range of movement: a tip when yours is below this share of the teacher's. 05-mvp.md said
 * 0.7, but its own example (a 70%-height raise gets a tip) needs a little room: 0.75.
 */
const ROM_RATIO = 0.75;
const VIS_SHARE = 0.7;

export function judge(inp: JudgeInput): JudgeOut {
  const { pairs, S, T, tMedian } = inp;
  const tAt = (n: number) => (n < 0 ? tMedian : T[n]);
  const scored = pairs.filter(([m, n]) => S[m] && tAt(n) && !inp.unscored.has(m));
  const tips: RawTip[] = [];
  const judged: Record<Part, TipKey[]> = { arms: [], legs: [], torso: [] };
  const skipped: Record<Part, string[]> = { arms: [], legs: [], torso: [] };
  const close = new Set<Part>(["arms", "legs", "torso"]);
  const worst: Record<Part, number> = { arms: 0, legs: 0, torso: 0 };
  const nPh = inp.phaseShare.length;
  const empty: JudgeOut = { tips: [], judged, skipped, close: new Set(), worst, rollJudged: false };
  // less than 1 s of usable pairs: nothing is judged
  if (new Set(scored.map(([m]) => m)).size < 15) {
    for (const F of FEATS) if (inp.parts[F.part]) skipped[F.part].push(F.k);
    return empty;
  }

  for (const F of FEATS) {
    if (!inp.parts[F.part]) {
      close.delete(F.part);
      continue;
    }
    if (inp.skip.has(F.k)) {
      skipped[F.part].push(F.k);
      close.delete(F.part);
      continue;
    }
    if (F.view && !inp.viewOk) {
      skipped[F.part].push(F.k);
      close.delete(F.part);
      continue;
    }
    const bS = ANGLE3D.includes(F.k) ? inp.biasS[F.k] ?? 0 : 0;
    const bT = ANGLE3D.includes(F.k) ? inp.biasT[F.k] ?? 0 : 0;
    const usable = scored.filter(([m, n]) => {
      const s = S[m]!;
      const t = tAt(n)!;
      return Number.isFinite(s.v[F.k]) && Number.isFinite(t.v[F.k]);
    });
    const seen = usable.filter(([m, n]) => S[m]!.vis[F.k] >= VIS_MIN && tAt(n)!.vis[F.k] >= VIS_MIN);
    if (!scored.length || seen.length < VIS_SHARE * scored.length || seen.length < 5) {
      skipped[F.part].push(F.k);
      close.delete(F.part);
      continue;
    }
    judged[F.part].push(F.k);
    // per-phase medians
    const byPhase: [number, number][][] = Array.from({ length: nPh }, () => []);
    for (const pr of seen) byPhase[inp.phaseOf(pr[1])]?.push(pr);
    let failShare = 0;
    let worstRatio = 0;
    let worstMed = 0;
    let worstPair: [number, number] = seen[0];
    let allHalf = true;
    // a phase fails only when its median is beyond the tolerance by 2 standard errors of noise
    // (noise is correlated over a few frames, so every 3 frames count as one sample)
    const sdT = inp.tMedian ? 0 : inp.sdT[F.k] ?? 0;
    const sd = Math.sqrt((inp.sdS[F.k] ?? 0) ** 2 + sdT ** 2);
    for (let p = 0; p < nPh; p++) {
      const prs = byPhase[p];
      if (prs.length < 3) continue;
      const d = prs.map(([m, n]) => badDiff(F.kind, S[m]!.v[F.k] - bS, tAt(n)!.v[F.k] - bT));
      const md = median(d);
      const margin = F.tol + (2 * 1.2533 * sd) / Math.sqrt(Math.max(1, prs.length / 3));
      const bad = F.kind === "two" ? Math.abs(md) > margin : md > margin;
      if (Math.abs(md) > F.tol / 2) allHalf = false;
      if (bad) {
        failShare += inp.phaseShare[p];
        const r = Math.abs(md) / F.tol;
        if (r > worstRatio) {
          worstRatio = r;
          worstMed = md;
          // the pair in this phase that is furthest off in the same direction
          let bi = 0;
          for (let i = 1; i < d.length; i++) if (Math.sign(md) * d[i] > Math.sign(md) * d[bi]) bi = i;
          worstPair = prs[bi];
        }
      }
    }
    worst[F.part] = Math.max(worst[F.part], worstRatio);
    if (F.kind === "two" && !allHalf) close.delete(F.part);
    if (F.kind !== "two" && worstRatio > 0) close.delete(F.part);
    if (failShare > 0) tips.push(makeTip(F, worstMed, worstRatio * failShare, worstPair));

    // range of movement (movement steps): only where the teacher's spread >= 2 x tol
    if (F.rom && inp.romS.length && inp.romT.length) {
      const tv = inp.romT.map((n) => T[n]?.v[F.k] ?? NaN);
      const sv = inp.romS.filter((m) => !inp.unscored.has(m)).map((m) => S[m]?.v[F.k] ?? NaN);
      // spreads with each video's noise taken out (p90 - p10 of noise alone is 2.56 SD)
      const denoise = (r: number, sdv: number) => Math.sqrt(Math.max(0, r * r - (2.56 * sdv) ** 2));
      const tr = denoise(pct(tv, 0.9) - pct(tv, 0.1), inp.sdT[F.k] ?? 0);
      const sr = denoise(pct(sv, 0.9) - pct(sv, 0.1), inp.sdS[F.k] ?? 0);
      if (tr >= 2 * F.tol && Number.isFinite(sr) && sr < ROM_RATIO * tr) {
        const ratio = Math.max(0, sr / tr);
        // worst moment: where the teacher is at the extreme of its range
        const hi = pct(tv, 0.9);
        let best = seen[0];
        let bd = Infinity;
        for (const pr of seen) {
          const dd = Math.abs((tAt(pr[1])!.v[F.k] ?? 0) - hi);
          if (dd < bd) {
            bd = dd;
            best = pr;
          }
        }
        tips.push(makeRangeTip(F, ratio, best));
        close.delete(F.part);
      }
    }
  }

  // bobbing: extra up-and-down of the hips that the teacher doesn't do. Measured on the
  // smoothed hip height, as the spread of (yours - the teacher's) along the matched pairs,
  // so following the teacher's own dips, or settling into the position, isn't bobbing.
  if (inp.parts.legs && inp.parts.torso) {
    const d: number[] = [];
    const tv: number[] = [];
    for (const [m, n] of scored) {
      const t = tAt(n)!;
      if (S[m]!.vis.bob < VIS_MIN || t.vis.bob < VIS_MIN) continue;
      const bt = n < 0 ? t.v.bob : inp.bobT[n];
      const bs = inp.bobS[m];
      if (!Number.isFinite(bs) || !Number.isFinite(bt)) continue;
      d.push(bs - bt);
    }
    const tFrames = inp.romT.length ? inp.romT : T.map((_, i) => i);
    for (const n of tFrames) if (T[n] && T[n]!.vis.bob >= VIS_MIN && Number.isFinite(inp.bobT[n])) tv.push(inp.bobT[n]);
    if (d.length >= Math.max(15, VIS_SHARE * scored.length) && tv.length >= 5) {
      const sprD = pct(d, 0.9) - pct(d, 0.1);
      const sprT = pct(tv, 0.9) - pct(tv, 0.1);
      // the paired difference carries both videos' noise
      const allow = Math.max(0.03, 3 * Math.hypot(inp.jitPos, inp.tMedian ? 0 : inp.jitPosT));
      const thr = 0.5 * sprT + allow;
      debugBob?.({ sprD, sprT, thr, n: d.length });
      if (sprD > thr) {
        tips.push({
          id: "bobbing",
          group: "bobbing",
          part: "torso",
          severity: (sprD - 0.5 * sprT) / allow,
          words: WORDS.bobbing(),
          at: scored[0],
          side: -1,
          marker: { joints: [LM.L_HIP, LM.R_HIP], arrow: null },
          depth: false,
        });
        close.delete("torso");
      }
    }
  }

  // knee roll-in (absolute, never vs the teacher)
  let rollClaim = false;
  let rollJudged = inp.parts.legs;
  let rollSide: 0 | 1 = 0;
  let rollAt = scored[0];
  if (inp.parts.legs) {
    for (const k of [0, 1] as const) {
      const kn = k ? "kneeR" : "kneeL";
      const bent = scored.filter(([m]) => {
        const s = S[m]!;
        return s.vis[kn] >= VIS_MIN && 180 - (s.v[kn] - (inp.biasS[kn] ?? 0)) >= 20 && Number.isFinite(k ? s.rollR : s.rollL);
      });
      if (bent.length < 15) {
        rollJudged = false;
        continue;
      }
      const roll = bent.map(([m]) => (k ? S[m]!.rollR : S[m]!.rollL));
      const share = roll.filter((r) => r >= 25).length / bent.length;
      const medial = median(bent.map(([m]) => (k ? S[m]!.medR : S[m]!.medL)));
      if (share >= 0.4 && medial > 0) {
        rollClaim = true;
        rollSide = k;
        let bi = 0;
        for (let i = 1; i < roll.length; i++) if (roll[i] > roll[bi]) bi = i;
        rollAt = bent[bi];
      }
    }
  }
  if (rollClaim && rollAt) {
    const j = SIDE_JOINTS.knee[rollSide];
    tips.push({
      id: "knee-rollin",
      group: "knee-rollin",
      part: "legs",
      severity: 100,
      words: WORDS.rollIn(),
      at: rollAt,
      side: rollSide,
      marker: { joints: j, arrow: null },
      depth: false,
    });
    close.delete("legs");
  }
  let out = tips;
  if (rollClaim || !rollJudged) out = tips.filter((t) => !t.depth);
  // the safe tip when knees can't be judged: legs nearly straight while the teacher's are bent
  if (!rollClaim && !rollJudged && inp.parts.legs) {
    const sK = scored
      .filter(([m]) => S[m]!.vis.kneeL >= VIS_MIN && S[m]!.vis.kneeR >= VIS_MIN)
      .map(([m]) => Math.min(S[m]!.v.kneeL - (inp.biasS.kneeL ?? 0), S[m]!.v.kneeR - (inp.biasS.kneeR ?? 0)));
    const tK = scored
      .filter(([, n]) => tAt(n)!.vis.kneeL >= VIS_MIN && tAt(n)!.vis.kneeR >= VIS_MIN)
      .map(([, n]) => Math.max(tAt(n)!.v.kneeL - (inp.biasT.kneeL ?? 0), tAt(n)!.v.kneeR - (inp.biasT.kneeR ?? 0)));
    if (sK.length >= VIS_SHARE * scored.length && tK.length && median(sK) > 165 && median(tK) < 150) {
      out = [
        ...out,
        {
          id: "knee-bend-safe",
          group: "knee-bend",
          part: "legs",
          severity: (median(sK) - median(tK)) / 15,
          words: WORDS.kneeSafe(),
          at: scored[0],
          side: -1,
          marker: { joints: [LM.L_KNEE, LM.R_KNEE], arrow: { dx: 0, dy: 1 } },
          depth: false,
        },
      ];
      close.delete("legs");
    }
  }
  return { tips: out, judged, skipped, close, worst, rollJudged };
}

function sideOf(k: TipKey): 0 | 1 {
  return k.endsWith("R") ? 1 : 0;
}

function makeTip(F: FeatDef, md: number, severity: number, at: [number, number]): RawTip {
  const side = sideOf(F.k);
  const base = { part: F.part, severity, at, side: side as 0 | 1, depth: false };
  switch (F.k) {
    case "kneeL":
    case "kneeR":
      return {
        ...base,
        id: "knee-bend",
        group: "knee-bend",
        words: WORDS.kneeDepth(md),
        marker: { joints: SIDE_JOINTS.knee[side], arrow: { dx: 0, dy: 1 } },
        depth: true,
      };
    case "elbL":
    case "elbR":
      return {
        ...base,
        id: md > 0 ? "elbow:bend" : "elbow:stretch",
        group: md > 0 ? "elbow:bend" : "elbow:stretch",
        words: md > 0 ? WORDS.elbowStraighter(md) : WORDS.elbowBent(md),
        marker: { joints: SIDE_JOINTS.elb[side], arrow: null },
      };
    case "armL":
    case "armR":
      return {
        ...base,
        id: md < 0 ? "arm-height:low" : "arm-height:high",
        group: md < 0 ? "arm-height:low" : "arm-height:high",
        words: md < 0 ? WORDS.armLow(md) : WORDS.armHigh(md),
        marker: { joints: SIDE_JOINTS.arm[side], arrow: { dx: 0, dy: md < 0 ? -1 : 1 } },
      };
    case "kneeSp":
      return {
        ...base,
        side: -1,
        id: "knee-spread",
        group: "knee-spread",
        words: WORDS.kneeSpread(),
        marker: { joints: [LM.L_KNEE, LM.R_KNEE], arrow: null },
      };
    case "footSp":
      return {
        ...base,
        side: -1,
        id: md < 0 ? "foot-spread:narrow" : "foot-spread:wide",
        group: md < 0 ? "foot-spread:narrow" : "foot-spread:wide",
        words: md < 0 ? WORDS.feetNarrow() : WORDS.feetWide(),
        marker: { joints: [LM.L_ANKLE, LM.R_ANKLE], arrow: null },
      };
    default:
      return {
        ...base,
        side: -1,
        id: "side-tilt",
        group: "side-tilt",
        words: WORDS.tilt(md),
        marker: { joints: [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP], arrow: null },
      };
  }
}

function makeRangeTip(F: FeatDef, ratio: number, at: [number, number]): RawTip {
  const side = sideOf(F.k);
  const severity = (1 - ratio) * 2;
  if (F.k === "kneeL" || F.k === "kneeR")
    return {
      id: "range:knee",
      group: "range:knee",
      part: "legs",
      severity,
      words: WORDS.rangeKnee(ratio),
      at,
      side,
      marker: { joints: SIDE_JOINTS.knee[side], arrow: { dx: 0, dy: 1 } },
      depth: true,
    };
  if (F.k === "elbL" || F.k === "elbR")
    return {
      id: "range:elbow",
      group: "range:elbow",
      part: "arms",
      severity,
      words: WORDS.rangeElbow(ratio),
      at,
      side,
      marker: { joints: SIDE_JOINTS.elb[side], arrow: null },
      depth: false,
    };
  return {
    id: "range:arm",
    group: "range:arm",
    part: "arms",
    severity,
    words: WORDS.rangeArm(ratio),
    at,
    side,
    marker: { joints: [...SIDE_JOINTS.elb[side]], arrow: { dx: 0, dy: -1 } },
    depth: false,
  };
}

/** Mean of finite values, or 0 (for energy sums). */
export function meanOr0(a: number[]): number {
  const m = mean(a);
  return Number.isFinite(m) ? m : 0;
}
