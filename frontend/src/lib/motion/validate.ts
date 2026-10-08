/**
 * The plausibility pass: is this a body a person could actually be in?
 *
 * Smoothing answers "is this steady", which is a different question from "is
 * this possible". A perfectly steady take can still have a wrist rotated
 * through 180 degrees for two seconds, because `retarget` deliberately does not
 * clamp to joint limits — it aims each bone at the direction the landmarks
 * imply and accepts the result, which is right for trusting the capture and
 * wrong for trusting the *rig*. Nothing downstream ever checked, so an
 * impossible pose travelled all the way to the screen looking confident.
 *
 * Two checks here, both geometric rather than learned, because both have exact
 * answers that a model could only approximate:
 *
 *   - **Range.** Every joint has an anatomical limit, already written down in
 *     `figureConstraints` and already used by the mudra poser. This applies the
 *     same table to captured motion, which had been bypassing it entirely.
 *   - **Speed.** A finger cannot travel 90 degrees in a twenty-fourth of a
 *     second. A frame that says it did is a tracking failure, whatever its
 *     confidence score said.
 *
 * What is deliberately *not* here is self-intersection — a hand passing through
 * the ribs. That one is genuinely harder: it needs the posed mesh rather than
 * the joint angles, since whether two limbs touch depends on how thick they
 * are. `figureConstraints.findViolations` already does it for a single static
 * pose, and extending it across a take is the natural next piece of work.
 */

import * as THREE from "three";
import type { Clip } from "./clip";
import { DIMS, PER_JOINT } from "./poseCodec";
import { JOINTS, JOINT_COUNT, type Group } from "./skeleton";

/**
 * How far a joint may rotate between two frames, in degrees, by body part.
 *
 * Generous on purpose. These are not meant to describe comfortable movement —
 * they are meant to sit above anything a person can do and below anything only
 * a glitch does, so that a real strike passes untouched and a teleport does
 * not. At 24 fps, 45 degrees a frame is already a limb crossing a quarter turn
 * in a tenth of a second.
 *
 * Fingers get a lower ceiling than arms, which sounds backwards until you
 * remember what drives them: a finger's rotation is solved from two landmarks a
 * couple of centimetres apart, so it is the noisiest joint on the body and the
 * one where a large jump is most likely to be nonsense rather than motion.
 */
const SPEED: Record<Group, number> = {
  spine: 25,
  arm: 45,
  hand: 35,
  leg: 40,
};

export interface ValidateOptions {
  /** Clamp joints to their anatomical range. */
  limits?: boolean;
  /** Clamp per-frame rotation to the table above. */
  speed?: boolean;
  /** Scale every speed ceiling, for a take that is genuinely faster than most. */
  speedScale?: number;
}

export interface ValidateStats {
  frames: number;
  /** Joint-frames pulled back inside their anatomical range. */
  clamped: number;
  /** Joint-frames that moved impossibly fast and were slowed. */
  slowed: number;
  /** Worst single range violation seen, in degrees past the limit. */
  worstOver: number;
  /** Worst single-frame rotation seen before slowing, in degrees. */
  worstStep: number;
  /** The joints most often out of range, worst first. */
  offenders: { joint: string; count: number }[];
}

const _q = new THREE.Quaternion();
// `applyPose` composes its angles with successive intrinsic rotateY, rotateX,
// then rotateZ, which is Euler order "YXZ" — not the "XYZ" three defaults to.
// Decomposing in the wrong order gives three angles that recompose to the
// right rotation but individually mean nothing, so every per-axis limit is
// then applied to a number it was never written about.
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _prev = new THREE.Quaternion();

function get(p: Float32Array, f: number, j: number, into: THREE.Quaternion) {
  const at = f * DIMS + j * PER_JOINT;
  return into.set(p[at], p[at + 1], p[at + 2], p[at + 3]);
}

function put(p: Float32Array, f: number, j: number, q: THREE.Quaternion) {
  const at = f * DIMS + j * PER_JOINT;
  p[at] = q.x;
  p[at + 1] = q.y;
  p[at + 2] = q.z;
  p[at + 3] = q.w;
}

const deg = (r: number) => THREE.MathUtils.radToDeg(r);
const rad = (d: number) => THREE.MathUtils.degToRad(d);

/**
 * Clamps one rotation into a joint's range, returning how far out it was.
 *
 * Done in Euler angles, which is not the mathematically pure choice — the
 * decomposition is order-dependent and the axes interact near the poles — but
 * it is the same decomposition `applyPose` clamps against, and a limit table
 * enforced two different ways is worse than an imperfect one enforced
 * consistently. The limits are per-axis numbers; there is no way to apply them
 * without picking an order.
 *
 * The mirror is the subtle half. `applyPose` clamps an angle *before* negating
 * y and z for a right-side bone, so the table is written in one side-neutral
 * convention and the right arm's actual rotation is its reflection. Checking a
 * measured right-side bone against the table directly compares a number to a
 * range describing its mirror image — which quietly reports a correctly-held
 * right arm as far out of range, and lets a genuinely broken one through.
 */
function clampToRange(q: THREE.Quaternion, j: number): number {
  const limit = JOINTS[j].limit;
  if (!limit.x && !limit.y && !limit.z) return 0;

  const mirror = JOINTS[j].side === "R" ? -1 : 1;
  _e.setFromQuaternion(q, "YXZ");
  let over = 0;

  for (const axis of ["x", "y", "z"] as const) {
    const range = limit[axis];
    if (!range) continue;
    // Into the table's convention, clamp, and back out again. `mirror` is ±1,
    // so the same multiply undoes itself.
    const sign = axis === "x" ? 1 : mirror;
    const have = deg(_e[axis]) * sign;
    const want = THREE.MathUtils.clamp(have, range[0], range[1]);
    if (want !== have) {
      over = Math.max(over, Math.abs(have - want));
      _e[axis] = rad(want * sign);
    }
  }

  if (over > 0) q.setFromEuler(_e);
  return over;
}

/**
 * Checks and repairs a clip in place.
 *
 * Range first, speed second, and not the other way round: pulling a joint back
 * inside its limits is itself a movement, and one that can be large when the
 * capture was badly wrong. Slowing first would leave that correction to appear
 * as a jump on the next pass.
 */
export function validateClip(clip: Clip, opts: ValidateOptions = {}): ValidateStats {
  const { limits = true, speed = true, speedScale = 1 } = opts;
  const n = clip.meta.count;
  const p = clip.poses;

  let clamped = 0;
  let slowed = 0;
  let worstOver = 0;
  let worstStep = 0;
  const counts = new Int32Array(JOINT_COUNT);

  if (limits) {
    for (let f = 0; f < n; f++) {
      for (let j = 0; j < JOINT_COUNT; j++) {
        get(p, f, j, _q).normalize();
        const over = clampToRange(_q, j);
        if (over > 0) {
          put(p, f, j, _q);
          clamped++;
          counts[j]++;
          if (over > worstOver) worstOver = over;
        }
      }
    }
  }

  if (speed) {
    for (let j = 0; j < JOINT_COUNT; j++) {
      const cap = SPEED[JOINTS[j].group] * speedScale;
      get(p, 0, j, _prev).normalize();

      for (let f = 1; f < n; f++) {
        get(p, f, j, _q).normalize();
        // Shortest path first: without this a rotation and its negation read as
        // most of a full turn apart, and every second frame looks like a
        // violation of a limit it never came near.
        if (_prev.dot(_q) < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);

        const step = deg(2 * Math.acos(Math.min(1, Math.abs(_prev.dot(_q)))));
        if (step > worstStep) worstStep = step;

        if (step > cap) {
          // Move as far toward the reported pose as the ceiling allows, rather
          // than refusing the frame. The direction the tracker saw is usually
          // right even when the distance is not.
          _q.copy(_prev).slerp(_q, cap / step);
          put(p, f, j, _q);
          slowed++;
        }
        _prev.copy(_q);
      }
    }
  }

  const offenders = Array.from(counts)
    .map((count, j) => ({ joint: JOINTS[j].key, count }))
    .filter((o) => o.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    frames: n,
    clamped,
    slowed,
    worstOver: +worstOver.toFixed(1),
    worstStep: +worstStep.toFixed(1),
    offenders,
  };
}
