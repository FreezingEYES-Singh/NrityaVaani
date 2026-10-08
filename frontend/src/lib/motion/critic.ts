/**
 * A vision model as a frame-by-frame judge, and the part that turns its
 * judgement into joint angles.
 *
 * The idea is straightforward: show a model the video frame and renders of the
 * figure from several angles, ask whether they show the same pose, and act on
 * the answer. The hard half is not the looking — it is that a vision model can
 * say *"the fingers are too spread"* and cannot say *"rotate `Index1.L` by
 * −9° about x"*. Something has to translate one into the other, and that
 * translator is this file.
 *
 * Two design decisions carry the whole thing:
 *
 * **The model chooses from a closed vocabulary, never numbers.** Asking a
 * vision model for joint angles gets confident nonsense — they are poor at
 * absolute spatial magnitude. Asking it to pick a body part, a direction, and
 * one of three sizes is a classification problem, which they are good at. The
 * arithmetic then belongs to code that knows the rig.
 *
 * **Every correction is bounded and re-checkable.** A step is at most 18°, one
 * part moves at a time, and nothing compounds within a frame. A judge that is
 * wrong makes the pose slightly wrong; it cannot throw a limb across the room.
 *
 * What this is *not* is exact. A step size is a guess at how much "moderate"
 * means, and the model may be inconsistent between neighbouring frames — the
 * same frame asked twice can come back differently, so a take corrected this
 * way does not reproduce. That is inherent to the approach, not a bug in it,
 * and it is why the geometric passes (`polish`, `validate`, `collide`) run
 * first and are trusted more.
 */

import * as THREE from "three";
import type { Clip } from "./clip";
import { DIMS, PER_JOINT } from "./poseCodec";
import { JOINTS, JOINT_COUNT } from "./skeleton";

// ---------------------------------------------------------------------------
// The vocabulary the model is allowed to answer in
// ---------------------------------------------------------------------------

export const PARTS = [
  "leftHand",
  "rightHand",
  "leftArm",
  "rightArm",
  "torso",
  "head",
] as const;

export const ISSUES = [
  // hands
  "fingers_too_spread",
  "fingers_too_closed",
  "fingers_too_bent",
  "fingers_too_straight",
  // arms — described by where the hand should go, not by joint
  "too_high",
  "too_low",
  "too_forward",
  "too_back",
  "too_wide",
  "too_narrow",
  // torso and head
  "leaning_forward",
  "leaning_back",
  "turned_left",
  "turned_right",
] as const;

export const SEVERITIES = ["slight", "moderate", "large"] as const;

export type Part = (typeof PARTS)[number];
export type Issue = (typeof ISSUES)[number];
export type Severity = (typeof SEVERITIES)[number];

export interface Fix {
  part: Part;
  issue: Issue;
  severity: Severity;
}

export interface Critique {
  /** Does the figure show the same pose as the video frame. */
  matches: boolean;
  /** 0-1. Fixes below `MIN_CONFIDENCE` are ignored. */
  confidence: number;
  /** Free text, for the report a person reads. Never parsed. */
  notes: string;
  fixes: Fix[];
}

/**
 * The schema the model's reply is constrained to.
 *
 * Shared with the API route so there is exactly one definition — a schema that
 * drifts from the type above fails at runtime, in a way that looks like the
 * model misbehaving rather than like the bug it is.
 */
export const CRITIQUE_SCHEMA = {
  type: "object",
  properties: {
    matches: { type: "boolean" },
    confidence: { type: "number" },
    notes: { type: "string" },
    fixes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          part: { type: "string", enum: [...PARTS] },
          issue: { type: "string", enum: [...ISSUES] },
          severity: { type: "string", enum: [...SEVERITIES] },
        },
        required: ["part", "issue", "severity"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches", "confidence", "notes", "fixes"],
  additionalProperties: false,
} as const;

/** Below this the model is guessing, and a guessed correction is worse than none. */
export const MIN_CONFIDENCE = 0.6;

/** Degrees per step. The ceiling is deliberately low; see the file comment. */
const STEP: Record<Severity, number> = { slight: 4, moderate: 9, large: 18 };

/** Metres the hand is moved, per step, for the positional issues. */
const SHIFT: Record<Severity, number> = { slight: 0.02, moderate: 0.05, large: 0.1 };

// ---------------------------------------------------------------------------
// Applying a critique
// ---------------------------------------------------------------------------

const _q = new THREE.Quaternion();
// `applyPose` composes with successive rotateY, rotateX, rotateZ — Euler order
// "YXZ". Decomposing any other way gives three angles that recompose correctly
// and individually mean nothing, so a per-axis nudge lands on the wrong axis.
const _e = new THREE.Euler(0, 0, 0, "YXZ");

function read(p: Float32Array, at: number, j: number, into: THREE.Quaternion) {
  const o = at + j * PER_JOINT;
  return into.set(p[o], p[o + 1], p[o + 2], p[o + 3]).normalize();
}

function write(p: Float32Array, at: number, j: number, q: THREE.Quaternion) {
  const o = at + j * PER_JOINT;
  p[o] = q.x;
  p[o + 1] = q.y;
  p[o + 2] = q.z;
  p[o + 3] = q.w;
}

/**
 * Adds `degrees` to one axis of one joint.
 *
 * The mirror matters and is easy to miss: `applyPose` negates y and z for a
 * right-side bone *after* clamping, so the limit table and every authored angle
 * are written in one side-neutral convention. A nudge applied without the
 * mirror bends the right hand the opposite way from the left.
 */
function nudge(p: Float32Array, at: number, j: number, axis: "x" | "y" | "z", degrees: number) {
  read(p, at, j, _q);
  _e.setFromQuaternion(_q, "YXZ");
  const sign = axis === "x" || JOINTS[j].side !== "R" ? 1 : -1;
  _e[axis] += THREE.MathUtils.degToRad(degrees * sign);
  write(p, at, j, _q.setFromEuler(_e));
}

const indicesWhere = (test: (j: (typeof JOINTS)[number]) => boolean) => {
  const out: number[] = [];
  JOINTS.forEach((joint, i) => {
    if (test(joint)) out.push(i);
  });
  return out;
};

/** The three bones of each finger on one side, and just the knuckles. */
const FINGERS = {
  L: indicesWhere((j) => j.group === "hand" && j.side === "L"),
  R: indicesWhere((j) => j.group === "hand" && j.side === "R"),
};
const KNUCKLES = {
  L: indicesWhere((j) => j.group === "hand" && j.side === "L" && j.stem.endsWith("1")),
  R: indicesWhere((j) => j.group === "hand" && j.side === "R" && j.stem.endsWith("1")),
};

const PELVIS = JOINTS.findIndex((j) => j.key === "Pelvis");
const NECK = JOINTS.findIndex((j) => j.key === "Neck");

export interface ApplyResult {
  applied: number;
  skipped: number;
  /** Fixes naming a part this cannot move yet. */
  unsupported: Fix[];
}

/**
 * Applies one frame's critique to the clip, in place.
 *
 * Arm *position* issues are deliberately absent from what this touches
 * directly. Moving a hand up is not a rotation of any one joint — it is a
 * change of where the wrist ends up, which needs the two-bone solve and
 * therefore the live rig. Those are reported as unsupported here and handled by
 * the caller, which has the mesh; everything expressible as a joint angle is
 * done here, where it can be tested without a browser.
 */
export function applyCritique(
  clip: Clip,
  frame: number,
  critique: Critique,
): ApplyResult {
  const out: ApplyResult = { applied: 0, skipped: 0, unsupported: [] };
  if (critique.matches) return out;
  if (critique.confidence < MIN_CONFIDENCE) {
    out.skipped = critique.fixes.length;
    return out;
  }

  const at = frame * DIMS;
  const p = clip.poses;

  for (const fix of critique.fixes) {
    const step = STEP[fix.severity];
    const side = fix.part.startsWith("left") ? "L" : "R";

    switch (fix.issue) {
      // --- fingers ---------------------------------------------------------
      //
      // Flex is the x axis on this rig — `figureRig` straightens fingers by
      // writing x and nothing else, which is the only axis whose meaning here
      // is established rather than assumed.
      case "fingers_too_bent":
        for (const j of FINGERS[side]) nudge(p, at, j, "x", -step);
        out.applied++;
        break;
      case "fingers_too_straight":
        for (const j of FINGERS[side]) nudge(p, at, j, "x", step);
        out.applied++;
        break;

      // Spread happens at the knuckle and nowhere else; the joints past it
      // only curl. Which of y and z abducts is a fact about the export rather
      // than about anatomy, so the caller calibrates it and passes it in.
      case "fingers_too_spread":
      case "fingers_too_closed": {
        const dir = fix.issue === "fingers_too_spread" ? -1 : 1;
        for (const j of KNUCKLES[side]) nudge(p, at, j, SPREAD_AXIS, dir * step);
        out.applied++;
        break;
      }

      // --- torso and head --------------------------------------------------
      case "leaning_forward":
      case "leaning_back": {
        const joint = fix.part === "head" ? NECK : PELVIS;
        if (joint < 0) break;
        nudge(p, at, joint, "x", fix.issue === "leaning_forward" ? -step : step);
        out.applied++;
        break;
      }
      case "turned_left":
      case "turned_right": {
        const joint = fix.part === "head" ? NECK : PELVIS;
        if (joint < 0) break;
        nudge(p, at, joint, "y", fix.issue === "turned_left" ? -step : step);
        out.applied++;
        break;
      }

      // --- arm position: needs the rig, not the numbers --------------------
      default:
        out.unsupported.push(fix);
        break;
    }
  }

  return out;
}

/**
 * Which knuckle axis spreads the fingers.
 *
 * Not a constant because it is not knowable from anatomy: `figureConstraints`
 * says outright that this rig's bone axes do not line up with the sagittal and
 * coronal planes, so "abduction is z" is a guess. The caller measures it once
 * against the real mesh — rotate a knuckle each way, see which widens the
 * fingertips — and sets it here before any critique is applied.
 */
export let SPREAD_AXIS: "y" | "z" = "z";

export function setSpreadAxis(axis: "y" | "z") {
  SPREAD_AXIS = axis;
}

/** World-space direction a hand should move, for the issues this file defers. */
export function shiftFor(issue: Issue, severity: Severity): THREE.Vector3 | null {
  const d = SHIFT[severity];
  switch (issue) {
    case "too_high":
      return new THREE.Vector3(0, -d, 0);
    case "too_low":
      return new THREE.Vector3(0, d, 0);
    // +z is toward the viewer, matching `v3` in `retarget`.
    case "too_forward":
      return new THREE.Vector3(0, 0, -d);
    case "too_back":
      return new THREE.Vector3(0, 0, d);
    // Left and right are mirror images of each other across the body.
    case "too_wide":
    case "too_narrow":
      return new THREE.Vector3(issue === "too_wide" ? -d : d, 0, 0);
    default:
      return null;
  }
}

/** Joint count, re-exported so callers need not import two modules to size a buffer. */
export const CRITIC_JOINTS = JOINT_COUNT;

// ---------------------------------------------------------------------------
// Reading a reply back
// ---------------------------------------------------------------------------

/** An example reply, shown to the model. Some JSON modes need one to comply. */
export const CRITIQUE_EXAMPLE = JSON.stringify(
  {
    matches: false,
    confidence: 0.8,
    notes: "Her left hand is higher than the figure's and the fingers are further apart.",
    fixes: [
      { part: "leftArm", issue: "too_low", severity: "moderate" },
      { part: "leftHand", issue: "fingers_too_closed", severity: "slight" },
    ],
  },
  null,
  0,
);

const isPart = (v: unknown): v is Part => PARTS.includes(v as Part);
const isIssue = (v: unknown): v is Issue => ISSUES.includes(v as Issue);
const isSeverity = (v: unknown): v is Severity => SEVERITIES.includes(v as Severity);

/**
 * Turns whatever came back into a `Critique`, or `null`.
 *
 * Needed because not every provider enforces a schema. DeepSeek's JSON mode
 * guarantees the reply *parses* — it does not guarantee the fields are the ones
 * asked for, and it may return empty content outright. An unchecked cast here
 * would put `undefined` where a part name belongs and quietly apply nothing,
 * which looks exactly like a model that thought the pose was fine.
 *
 * Unknown fixes are dropped rather than the whole reply: a model that invents
 * one bad enum among three good ones has still said something worth acting on.
 */
export function parseCritique(raw: unknown): Critique | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const fixes: Fix[] = [];
  if (Array.isArray(o.fixes)) {
    for (const entry of o.fixes) {
      if (!entry || typeof entry !== "object") continue;
      const f = entry as Record<string, unknown>;
      if (isPart(f.part) && isIssue(f.issue) && isSeverity(f.severity)) {
        fixes.push({ part: f.part, issue: f.issue, severity: f.severity });
      }
    }
  }

  const confidence = typeof o.confidence === "number" ? o.confidence : 0;
  return {
    // A reply with no usable fixes is a match, whatever it claimed: there is
    // nothing to act on either way, and calling it a mismatch would inflate
    // the "did not match" count with frames nobody can do anything about.
    matches: o.matches === true || fixes.length === 0,
    confidence: Math.max(0, Math.min(1, confidence)),
    notes: typeof o.notes === "string" ? o.notes : "",
    fixes,
  };
}
