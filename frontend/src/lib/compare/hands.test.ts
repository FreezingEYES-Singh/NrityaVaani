import { test } from "node:test";
import assert from "node:assert/strict";
import { handFeat, judgeHands } from "./hands.ts";
import type { CompareResult, HandFrame, PoseFrame, PoseTrack, Pt } from "./types.ts";

/** A flat hand pointing up (y down), palm 0.1 long; `bent` fingers fold 90° at both finger joints. */
function hand(bent: number[] = []): HandFrame {
  const P = (x: number, y: number, z = 0): Pt => ({ x, y, z, v: 1 });
  const pts: Pt[] = [P(0, 0)];
  // thumb: out to the side and folded across the palm, as in Pataka
  pts.push(P(-0.03, -0.02), P(-0.04, -0.045), P(-0.03, -0.065), P(-0.015, -0.075));
  const xs = [-0.025, -0.008, 0.008, 0.025];
  for (let f = 0; f < 4; f++) {
    const x = xs[f];
    const seg = 0.03;
    if (!bent.includes(f + 1)) pts.push(P(x, -0.1), P(x, -0.1 - seg), P(x, -0.1 - 2 * seg), P(x, -0.1 - 3 * seg));
    else pts.push(P(x, -0.1), P(x, -0.1 - seg), P(x, -0.1 - seg, -seg), P(x, -0.1, -seg));
  }
  return { img: pts, world: pts };
}

const body = (): Pt[] => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, v: 1 }));
function track(h: HandFrame, sec = 3): PoseTrack {
  const frames: PoseFrame[] = [];
  for (let i = 0; i < sec * 15; i++) frames.push({ t: i / 15, img: body(), world: null, ok: true, hands: { l: h, r: h } });
  return { frames, width: 640, height: 480, range: [0, sec], effectiveFps: 15, warnings: [] };
}
const found = (sec = 3): CompareResult => ({
  kind: "movement",
  found: true,
  reading: "full",
  coverage: 1,
  mirrored: false,
  tries: [{ start: 0, end: sec, cost: 0.1 }],
  pauses: [],
  timing: { ratio: 1, text: null },
  tips: [],
  strength: null,
  bands: { arms: { level: "close" }, legs: { level: "close" }, torso: { level: "close" }, timing: { level: "close" } },
  notChecked: [],
  warnings: [],
  map: [{ s: 0, t: 0 }, { s: sec, t: sec }],
  message: null,
});

test("the site's classifier names the synthetic shapes", () => {
  assert.equal(handFeat(hand()).mudra, "Pataka");
  assert.equal(handFeat(hand([3])).mudra, "Tripataka");
});

test("a straight ring finger where the teacher bends it is called out, with the mudra names", () => {
  const h = judgeHands(track(hand([3])), track(hand()), found());
  assert.ok(h.tip, "a tip");
  assert.equal(h.tip!.id, "hand:ring:bend");
  assert.match(h.tip!.title, /Bend your ring finger/);
  assert.match(h.tip!.detail, /Tripataka/);
  assert.match(h.tip!.detail, /Pataka/);
  assert.equal(h.band.level, "needs");
});

test("the same hand shape gives no tip and a close band", () => {
  const h = judgeHands(track(hand([3])), track(hand([3])), found());
  assert.equal(h.tip, null);
  assert.equal(h.band.level, "close");
});

test("no hands in the student's frames: not checked, with a reason", () => {
  const s = track(hand());
  for (const f of s.frames) f.hands = { l: null, r: null };
  const h = judgeHands(track(hand()), s, found());
  assert.equal(h.tip, null);
  assert.equal(h.band.level, "na");
  assert.ok(h.notChecked);
});
