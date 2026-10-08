/**
 * Hand shapes along the match: fingers and mudras. Pure TS.
 *
 * Hands never decide where the step is (in a full-body video they are small and
 * often unreadable); they are judged afterwards, along the body's time map:
 * - how straight each finger is, with the site's own measure (0 bent .. 1 straight),
 *   from the 3D hand landmarks when there are some;
 * - which mudra each hand shows, named by the site's own classifier.
 *
 * A difference has to last: a finger is only called out when it differs in at
 * least MIN_SHARE of the paired frames, so a hand caught changing shape doesn't
 * count. Left and right are never named (a phone may have saved the video
 * mirrored); "Show me" marks the hand.
 */
import type { Band, CompareResult, HandFrame, Hands, PoseFrame, PoseTrack, Tip } from "./types.ts";
import { classifyMudra, getFingerExtensionScore, type Point } from "../mediapipe/classification.ts";
import { mapTime } from "./timemap.ts";

export const FINGERS = [
  { key: "thumb", name: "thumb", idx: [1, 2, 3, 4] },
  { key: "index", name: "index finger", idx: [5, 6, 7, 8] },
  { key: "middle", name: "middle finger", idx: [9, 10, 11, 12] },
  { key: "ring", name: "ring finger", idx: [13, 14, 15, 16] },
  { key: "little", name: "little finger", idx: [17, 18, 19, 20] },
] as const;

/** A finger differs when its straightness differs by more than this. */
export const FINGER_TOL = 0.2;
/** ...in at least this share of the paired frames. */
export const MIN_SHARE = 0.4;
/** Fewer paired frames than this (about half a second) aren't judged. */
const MIN_PAIRS = 8;
/** Hands seen in less than this share of the matched frames: not checked. */
const SEEN_MIN = 0.3;
const MUDRA_CONF = 0.55;
/** The classifier's distance limits assume a palm (wrist to middle knuckle) about this long. */
const PALM = 0.1;

type Side = "l" | "r";

export interface HandFeat {
  /** Straightness of thumb, index, middle, ring, little: 0 bent .. 1 straight. */
  ext: number[];
  /** The mudra the site's classifier names, when it is sure enough. */
  mudra: string | null;
}

export function handFeat(h: HandFrame): HandFeat {
  const raw = h.world ?? h.img;
  const pts: Point[] = raw.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const ext = FINGERS.map((f) => getFingerExtensionScore(pts, [...f.idx]));
  const o = pts[0];
  const palm = Math.hypot(pts[9].x - o.x, pts[9].y - o.y, pts[9].z - o.z) || 1e-6;
  const k = PALM / palm;
  const m = classifyMudra(pts.map((p) => ({ x: (p.x - o.x) * k, y: (p.y - o.y) * k, z: (p.z - o.z) * k })));
  return { ext, mudra: m.confidence >= MUDRA_CONF && m.name !== "No Mudra Detected" ? m.name : null };
}

/** Frame index nearest time t (frames sorted by t). */
function nearest(frames: PoseFrame[], t: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(frames[lo - 1].t - t) < Math.abs(frames[lo].t - t)) lo--;
  return lo;
}

/** The hands read nearest time t, within maxDt (hands are read up to 15 times a second). */
function handsNear(frames: PoseFrame[], t: number, maxDt = 0.1): { hands: Hands; t: number } | null {
  if (!frames.length) return null;
  const i0 = nearest(frames, t);
  let best: { hands: Hands; t: number } | null = null;
  let bestD = maxDt;
  for (let i = Math.max(0, i0 - 4); i <= Math.min(frames.length - 1, i0 + 4); i++) {
    const f = frames[i];
    const d = Math.abs(f.t - t);
    if (f.hands && f.ok && d <= bestD) {
      best = { hands: f.hands, t: f.t };
      bestD = d;
    }
  }
  return best;
}

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The teacher's most typical hand on one side (for posture steps, which have no time map). */
function typicalHand(teacher: PoseTrack, side: Side): { f: HandFeat; t: number } | null {
  const all = teacher.frames.filter((f) => f.ok && f.hands?.[side]).map((f) => ({ f: handFeat(f.hands![side]!), t: f.t }));
  if (all.length < MIN_PAIRS) return null;
  const med = FINGERS.map((_, i) => median(all.map((a) => a.f.ext[i])));
  let best = all[0];
  let bestD = Infinity;
  for (const a of all) {
    const d = a.f.ext.reduce((s, x, i) => s + Math.abs(x - med[i]), 0);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

interface Pair {
  ts: number;
  tt: number;
  s: HandFeat;
  t: HandFeat;
}

export interface HandJudgement {
  tip: Tip | null;
  band: Band;
  notChecked: string | null;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Judge the hands of a found match. `r` is the body's result: its first try is the
 * stretch of the student's video the map follows.
 */
export function judgeHands(teacher: PoseTrack, student: PoseTrack, r: CompareResult): HandJudgement {
  const tracked = (tr: PoseTrack) => tr.frames.some((f) => f.hands);
  if (!tracked(teacher) || !tracked(student))
    return { tip: null, band: { level: "na", note: "Hands weren't tracked in these videos" }, notChecked: null };
  if (!r.found || !r.tries.length) return { tip: null, band: { level: "na", note: "Not judged" }, notChecked: null };

  const usesMap = r.map.length >= 2;
  const sides: [Side, Side][] = r.mirrored ? [["l", "r"], ["r", "l"]] : [["l", "l"], ["r", "r"]];
  const typical = usesMap ? null : { l: typicalHand(teacher, "l"), r: typicalHand(teacher, "r") };
  const spans = usesMap ? [r.tries[0]] : r.tries;
  const inSpan = (t: number) => spans.some((s) => t >= s.start - 1e-6 && t <= s.end + 1e-6);

  const pairs: Record<Side, Pair[]> = { l: [], r: [] };
  let total = 0;
  for (const f of student.frames) {
    if (!f.hands || !f.ok || !f.img || !inSpan(f.t)) continue;
    total++;
    const tt = usesMap ? mapTime(r.map, f.t) : null;
    const th = tt !== null ? handsNear(teacher.frames, tt) : null;
    for (const [ss, ts] of sides) {
      const sh = f.hands[ss];
      if (!sh) continue;
      if (th) {
        const h = th.hands[ts];
        if (h) pairs[ss].push({ ts: f.t, tt: th.t, s: handFeat(sh), t: handFeat(h) });
      } else if (typical?.[ts]) {
        pairs[ss].push({ ts: f.t, tt: typical[ts]!.t, s: handFeat(sh), t: typical[ts]!.f });
      }
    }
  }

  const seen = total ? Math.max(pairs.l.length, pairs.r.length) / total : 0;
  if (total < MIN_PAIRS || seen < SEEN_MIN) {
    return {
      tip: null,
      band: { level: "na", note: "Hands too small or hidden to read" },
      notChecked: "The hands were too small or hidden in most frames, so hand shapes weren't checked. Film closer to check mudras.",
    };
  }

  // the finger that differs most, on either hand
  let best: { side: Side; finger: number; share: number; sev: number; sign: number; worst: Pair } | null = null;
  let mudraMiss = 0;
  let mudraSeen = 0;
  for (const [ss] of sides) {
    const P = pairs[ss];
    for (const p of P) {
      if (!p.t.mudra) continue;
      mudraSeen++;
      if (p.s.mudra !== p.t.mudra && (p.s.mudra || p.s.ext.some((x, i) => Math.abs(x - p.t.ext[i]) > FINGER_TOL))) mudraMiss++;
    }
    if (P.length < MIN_PAIRS) continue;
    for (let i = 0; i < FINGERS.length; i++) {
      const d = P.map((p) => p.s.ext[i] - p.t.ext[i]);
      const off = d.map((x) => Math.abs(x) > FINGER_TOL);
      const n = off.filter(Boolean).length;
      const share = n / P.length;
      if (share < MIN_SHARE) continue;
      const sign = Math.sign(median(d.filter((_, k) => off[k])));
      // the worst moment: the largest difference of that sign
      let wk = -1;
      for (let k = 0; k < P.length; k++) if (off[k] && Math.sign(d[k]) === sign && (wk < 0 || Math.abs(d[k]) > Math.abs(d[wk]))) wk = k;
      const sev = share * median(d.filter((_, k) => off[k]).map(Math.abs));
      if (wk >= 0 && (!best || sev > best.sev)) best = { side: ss, finger: i, share, sev, sign, worst: P[wk] };
    }
  }
  const missShare = mudraSeen >= MIN_PAIRS ? mudraMiss / mudraSeen : 0;

  if (!best) {
    const note = seen < 0.6 ? `Hands read in ${Math.round(seen * 100)}% of the frames` : undefined;
    return { tip: null, band: { level: seen < 0.6 ? "partly" : missShare >= MIN_SHARE ? "getting" : "close", note }, notChecked: null };
  }

  const F = FINGERS[best.finger];
  const w = best.worst;
  const tm = w.t.mudra;
  const sm = w.s.mudra;
  const shapes = tm
    ? sm && sm !== tm
      ? `the teacher's hand shows ${tm} and yours looks like ${sm}`
      : `the teacher's hand shows ${tm}`
    : sm
      ? `your hand looks like ${sm}, a different shape from the teacher's`
      : "your hand shape differs from the teacher's";
  const how = best.sign > 0 ? "straighter" : "more bent";
  const teacherSide = sides.find(([s]) => s === best!.side)![1];
  const joints = (s: Side) => (s === "l" ? [13, 15] : [14, 16]);
  const tip: Tip = {
    id: `hand:${F.key}:${best.sign > 0 ? "bend" : "straighten"}`,
    part: "hands",
    title: best.sign > 0 ? `Bend your ${F.name} more` : `Straighten your ${F.name}`,
    detail: `Around ${fmt(w.ts)}, ${shapes}. Your ${F.name} is ${how} than the teacher's in ${Math.round(best.share * 100)}% of the step, on the hand Show me marks.`,
    severity: best.sev,
    at: { student: w.ts, teacher: w.tt },
    marker: { joints: joints(best.side), teacherJoints: joints(teacherSide), arrow: null },
    beta: true,
  };
  const level = best.share >= 0.6 || missShare >= 0.6 ? "needs" : "getting";
  return { tip, band: { level, note: seen < 0.6 ? `Hands read in ${Math.round(seen * 100)}% of the frames` : undefined }, notChecked: null };
}
