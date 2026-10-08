/**
 * Pulling limbs back out of the body.
 *
 * The last of the three plausibility failures, and the only one that cannot be
 * answered from joint angles alone. Range and speed are properties of a single
 * joint; whether a hand is *inside the ribs* depends on how wide the ribs are,
 * which is a fact about the mesh and not about the skeleton. Two takes with
 * identical joint angles collide differently on the male and female figures,
 * because their torsos are measurably different depths.
 *
 * So this is the one pass that has to pose the actual body and look. That makes
 * it the slowest thing in the pipeline by a wide margin — every frame is posed
 * several times over — and it is only affordable because nothing here runs
 * while anyone is watching.
 *
 * **The repair walks the offending arm back toward rest**, which is the same
 * move `applyPoseSafely` already makes for authored mudra poses, kept identical
 * on purpose: two different answers to "how do we get a hand out of a chest"
 * would eventually disagree about a pose that is legal in one path and not the
 * other. The walk is a binary search for the *most* of the captured pose that
 * still clears the body, so a frame that was barely touching is barely changed.
 *
 * Two limits worth knowing before trusting the number it reports. It tests the
 * arms and hands against the **torso only** — an arm crossing the other arm, or
 * a shin through a thigh, is not checked, because the probe set in
 * `figureConstraints` was built for hands against a chest. And the torso is
 * modelled as a stack of elliptical capsules, which is a good approximation of
 * a ribcage and a poor one of a shoulder.
 */

import * as THREE from "three";
import type { Violation } from "@/components/three/figureConstraints";
import type { Clip } from "./clip";
import { DIMS, PER_JOINT } from "./poseCodec";
import { JOINTS } from "./skeleton";

/**
 * Poses the rig from one vector and reports what ended up inside the body.
 *
 * Passed in rather than imported so this file never touches a mesh, a loader
 * or a scene: the figure lives inside a React component that owns its own
 * WebGL context, and reaching into it from here would mean either duplicating
 * the rig or exporting it.
 */
export type Probe = (pose: ArrayLike<number>) => Violation[];

export interface CollideOptions {
  /**
   * Binary-search steps. Each one halves the remaining interval, so six gets
   * within about 1.5% of the most of the pose that clears — far below what
   * anyone can see, and the difference between a pass that takes seconds and
   * one that takes minutes.
   */
  steps?: number;
  /**
   * How far back the search may walk before giving up, 0-1.
   *
   * A floor rather than zero because a frame that still collides with the arm
   * most of the way to rest is not a pose problem — it is a tracking failure,
   * and flattening the arm completely makes the take look worse than leaving
   * the small overlap in.
   */
  floor?: number;
}

const DEFAULTS: Required<CollideOptions> = { steps: 6, floor: 0.35 };

export interface CollideStats {
  frames: number;
  /** Frames that had at least one probe inside the body. */
  framesHit: number;
  /** Frames still colliding after the walk-back hit its floor. */
  framesUnresolved: number;
  /** Deepest penetration before and after, as a fraction of the local radius. */
  worstBefore: number;
  worstAfter: number;
  /** Least of a pose that had to be kept, 0-1. 1 means nothing was moved. */
  hardestPullback: number;
  /** Which probes hit, worst first. */
  offenders: { probe: string; side: string; count: number }[];
}

const _q = new THREE.Quaternion();
const _rest = new THREE.Quaternion(); // identity: rest, since poses are rest-relative

/**
 * The joints a given side's walk-back is allowed to move.
 *
 * The arm and its fingers, and nothing else. Deliberately not the spine —
 * `figureConstraints` makes the same call and says why: a hand through the ribs
 * is no reason to un-bow the head.
 */
function sideJoints(side: "L" | "R"): number[] {
  const out: number[] = [];
  JOINTS.forEach((j, i) => {
    if (j.side === side && (j.group === "arm" || j.group === "hand")) out.push(i);
  });
  return out;
}

const SIDE_JOINTS = { L: sideJoints("L"), R: sideJoints("R") };

/**
 * Writes `amount` of `from`'s pose for one side into `into`.
 *
 * Because every rotation here is already a delta on the rest pose, easing
 * toward rest is just easing toward identity — no rest pose has to be known,
 * and the same scratch works for either figure.
 */
function blendSide(
  into: Float32Array,
  from: Float32Array,
  fromOffset: number,
  side: "L" | "R",
  amount: number,
) {
  for (const j of SIDE_JOINTS[side]) {
    const src = fromOffset + j * PER_JOINT;
    _q.set(from[src], from[src + 1], from[src + 2], from[src + 3]);
    if (_q.lengthSq() < 1e-12) _q.identity();
    else _q.normalize();

    _rest.identity();
    _rest.slerp(_q, amount);

    const dst = j * PER_JOINT;
    into[dst] = _rest.x;
    into[dst + 1] = _rest.y;
    into[dst + 2] = _rest.z;
    into[dst + 3] = _rest.w;
  }
}

/**
 * Clears self-intersection across a whole clip, in place.
 *
 * Runs last in the pipeline on purpose. Smoothing and limit-clamping both move
 * joints, so a collision resolved before them can be reintroduced by them; a
 * collision resolved after them is the one that ships.
 */
export function decollideClip(
  clip: Clip,
  probe: Probe,
  opts: CollideOptions = {},
): CollideStats {
  const { steps, floor } = { ...DEFAULTS, ...opts };
  const n = clip.meta.count;
  const p = clip.poses;

  const scratch = new Float32Array(DIMS);
  const original = new Float32Array(DIMS);

  let framesHit = 0;
  let framesUnresolved = 0;
  let worstBefore = 0;
  let worstAfter = 0;
  let hardestPullback = 1;
  const counts = new Map<string, number>();

  for (let f = 0; f < n; f++) {
    const at = f * DIMS;
    original.set(p.subarray(at, at + DIMS));
    scratch.set(original);

    const hits = probe(scratch);
    if (hits.length === 0) continue;

    framesHit++;
    for (const h of hits) {
      worstBefore = Math.max(worstBefore, h.depth);
      const k = `${h.probe}.${h.side}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    // Each side is searched on its own: these probes only ever test a limb
    // against the torso, never against the other limb, so backing off the left
    // arm cannot change what the right one is touching.
    for (const side of ["L", "R"] as const) {
      if (!hits.some((h) => h.side === side)) continue;

      let keep = floor;
      let drop = 1; // known to collide

      for (let s = 0; s < steps; s++) {
        const mid = (keep + drop) / 2;
        blendSide(scratch, original, at, side, mid);
        if (probe(scratch).some((h) => h.side === side)) drop = mid;
        else keep = mid;
      }

      blendSide(scratch, original, at, side, keep);
      hardestPullback = Math.min(hardestPullback, keep);
    }

    const left = probe(scratch);
    if (left.length) {
      framesUnresolved++;
      for (const h of left) worstAfter = Math.max(worstAfter, h.depth);
    }

    p.set(scratch, at);
  }

  const offenders = [...counts.entries()]
    .map(([k, count]) => {
      const [probeName, side] = k.split(".");
      return { probe: probeName, side, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    frames: n,
    framesHit,
    framesUnresolved,
    worstBefore: +worstBefore.toFixed(3),
    worstAfter: +worstAfter.toFixed(3),
    hardestPullback: +hardestPullback.toFixed(2),
    offenders,
  };
}
