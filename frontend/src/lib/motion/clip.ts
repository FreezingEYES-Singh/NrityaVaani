/**
 * The figure's performance, saved.
 *
 * A bake (`.nvbake`) holds *landmarks* — what the tracker saw in the video. A
 * clip (`.nvclip`) holds *what the figure did with them*: the finished pose of
 * all 51 joints, fingers to toes, for every frame. They stay separate files
 * because they age differently. Landmarks are expensive to produce and never
 * change; poses are cheap to rebuild and change every time the retargeting
 * does, so folding them together would mean either re-tracking a clip to pick
 * up a rig fix or carrying stale poses forever.
 *
 * **A clip is rotations only — no translation, no root motion.** Two reasons.
 * The figure is grounded every frame by measuring its lowest vertex and
 * dropping it onto the floor, so a stored height would be recomputed and
 * discarded on load anyway. And a purely rotational clip retargets: because the
 * rotations are deltas on the rest pose, the same file plays back correctly on
 * the male figure and the female one, whatever their proportions.
 *
 * What that costs is honest to state — a dancer travelling across the floor
 * plays back dancing in place. For teaching hasta mudras and adavus, where the
 * camera is fixed and the feet mostly stay put, that is the right trade. It
 * would not be for a piece that moves through space.
 */

import * as THREE from "three";
import { boneMap, rest } from "@/components/three/retarget";
import { DIMS, PER_JOINT } from "./poseCodec";
import { JOINTS, JOINT_COUNT, LAYOUT } from "./skeleton";

const MAGIC = "NVC1";

/**
 * `THREE.Quaternion.slerpFlat`, typed for the buffers it is actually used on.
 *
 * `@types/three` declares the three buffers as `number[]`, but the
 * implementation only ever indexes them — packed float arrays are what it
 * exists for, and what three's own `QuaternionKeyframeTrack` hands it. The
 * cast is the type declaration being narrower than the function, not a claim
 * about the values.
 */
const slerpFlat = THREE.Quaternion.slerpFlat as unknown as (
  dst: Float32Array,
  dstOffset: number,
  src0: Float32Array,
  srcOffset0: number,
  src1: Float32Array,
  srcOffset1: number,
  t: number,
) => void;

export interface ClipMeta {
  /** Joint layout this was written against. Refuses to load across a change. */
  layout: number;
  dims: number;
  count: number;
  /** Frames per second the source was sampled at. */
  fps: number;
  /** Seconds. */
  duration: number;
  /** Which figure it was captured from, for the record. */
  sex: string;
  /** What it was built from, for tracing a bad clip back to its source. */
  source: string;
  savedAt: number;
  /** Joint order, written out so a file can be read without this codebase. */
  joints: string[];
}

export interface Clip {
  meta: ClipMeta;
  /** Seconds from the start, one per frame. */
  times: Float32Array;
  /** `count` × `DIMS`, row-major: frame 0's joints, then frame 1's. */
  poses: Float32Array;
}

/** A fresh, correctly-shaped clip ready to be filled in. */
export function emptyClip(count: number, fps: number, source: string, sex: string): Clip {
  return {
    meta: {
      layout: LAYOUT,
      dims: DIMS,
      count,
      fps,
      duration: 0,
      sex,
      source,
      savedAt: Date.now(),
      joints: JOINTS.map((j) => j.key),
    },
    times: new Float32Array(count),
    poses: new Float32Array(count * DIMS),
  };
}

export function encodeClip(clip: Clip): Blob {
  const header = new TextEncoder().encode(JSON.stringify(clip.meta));
  const bodies: ArrayBufferView[] = [clip.times, clip.poses];
  const total = 8 + header.length + bodies.reduce((n, b) => n + b.byteLength, 0);

  // One buffer filled by hand, for the reason `bakeStore` gives: a typed
  // array's underlying buffer may be longer than the view, and handing the Blob
  // the view writes the whole buffer.
  const buffer = new ArrayBuffer(total);
  const out = new Uint8Array(buffer);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(buffer).setUint32(4, header.length, true);
  out.set(header, 8);

  let at = 8 + header.length;
  for (const b of bodies) {
    out.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), at);
    at += b.byteLength;
  }
  return new Blob([buffer], { type: "application/octet-stream" });
}

export async function decodeClip(file: Blob): Promise<Clip> {
  const buf = await file.arrayBuffer();
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== MAGIC) {
    throw new Error("Not a NrityaVaani clip file");
  }
  const headerLen = new DataView(buf).getUint32(4, true);
  const meta: ClipMeta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen)));

  // Refused rather than adapted. A clip written against a different joint list
  // decodes into a body where the elbow's numbers land on a knuckle, and
  // nothing about the result looks wrong enough to catch by eye.
  if (meta.layout !== LAYOUT) {
    throw new Error(
      `Clip uses joint layout ${meta.layout}, this build expects ${LAYOUT}. Re-save it.`,
    );
  }
  if (meta.dims !== DIMS) {
    throw new Error(`Clip has ${meta.dims} numbers per frame, this build expects ${DIMS}.`);
  }

  const n = meta.count;
  let at = 8 + headerLen;
  // `slice`, not a view: a Float32Array view needs a four-byte-aligned offset
  // and the header is an arbitrary length, so a view throws on most files.
  const take = (len: number) => {
    const a = new Float32Array(buf.slice(at, at + len * 4));
    at += len * 4;
    return a;
  };

  return { meta, times: take(n), poses: take(n * DIMS) };
}

/**
 * The pose at `t` seconds, slerped between the two frames either side.
 *
 * A clip is stored at 15 fps because that is enough to carry the *shape* of a
 * performance — the file is 1.3 MB at that rate and four times the size at 60.
 * What it is not is enough to play back directly: picking the nearest frame on
 * a 60 Hz display holds each pose for four frames, which reads as stepping on
 * anything quick — a foot tap, the jump, hands travelling to the front. The
 * rate was chosen on the understanding that playback interpolates, so this is
 * the half that makes 15 fps the right number rather than a visible one.
 *
 * Slerp rather than a component-wise lerp because these are rotations:
 * lerping quaternions and renormalising takes a chord across the sphere, so a
 * joint sweeping a wide arc between two keys speeds up in the middle and drags
 * at the ends. `slerpFlat` also takes the short way round, which matters here —
 * `q` and `-q` are the same rotation, and Blender is free to hand back either.
 *
 * `out` is caller-owned scratch: this runs once per animation frame, and a
 * fresh 204-float array sixty times a second is pure garbage.
 */
export function samplePose(
  clip: Clip,
  t: number,
  out: Float32Array = new Float32Array(DIMS),
): Float32Array {
  const { count } = clip.meta;
  const x = Math.min(count - 1, Math.max(0, t * clip.meta.fps));
  const i = Math.floor(x);
  const j = Math.min(count - 1, i + 1);
  const f = x - i;
  const a = i * DIMS;

  if (i === j || f <= 0) {
    out.set(clip.poses.subarray(a, a + DIMS));
    return out;
  }

  const b = j * DIMS;
  for (let k = 0; k < DIMS; k += PER_JOINT) {
    slerpFlat(out, k, clip.poses, a + k, clip.poses, b + k, f);
    // A degenerate stored quaternion slerps to NaN, and NaN would go straight
    // through `decodePose`'s own guard — that tests length, and every
    // comparison against NaN is false — to take out the whole limb below the
    // joint. One test per joint catches it here instead.
    if (Number.isNaN(out[k + 3])) {
      out[k] = 0;
      out[k + 1] = 0;
      out[k + 2] = 0;
      out[k + 3] = 1;
    }
  }
  return out;
}

/**
 * The clip as something three can play.
 *
 * Built against a specific mesh, because this is where the rest-relative
 * rotations are turned back into the absolute local rotations a keyframe track
 * needs — and "absolute" is only meaningful once you know whose rest pose you
 * are talking about. Handing the same clip to the male figure and the female
 * one produces two different sets of tracks, which is exactly the point.
 *
 * Track names use each bone's real name from the export, suffix and all, since
 * that is what three resolves a binding against — the `boneKey` form these are
 * stored under would match nothing.
 */
export function toAnimationClip(clip: Clip, mesh: THREE.SkinnedMesh, name = "performance") {
  const bones = boneMap(mesh);
  const restQ = rest(mesh);
  const tracks: THREE.QuaternionKeyframeTrack[] = [];
  const n = clip.meta.count;

  const q = new THREE.Quaternion();
  const times = Array.from(clip.times);

  for (let j = 0; j < JOINT_COUNT; j++) {
    const bone = bones.get(JOINTS[j].key);
    if (!bone) continue;

    const r = restQ.get(bone);
    const values = new Float32Array(n * 4);

    for (let f = 0; f < n; f++) {
      const at = f * DIMS + j * PER_JOINT;
      q.set(clip.poses[at], clip.poses[at + 1], clip.poses[at + 2], clip.poses[at + 3]);
      if (q.lengthSq() < 1e-12) q.identity();
      else q.normalize();
      if (r) q.premultiply(r);

      const o = f * 4;
      values[o] = q.x; values[o + 1] = q.y; values[o + 2] = q.z; values[o + 3] = q.w;
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, Array.from(values)));
  }

  return new THREE.AnimationClip(name, clip.meta.duration || times[n - 1] || 0, tracks);
}

/** Rough size on disk, for telling someone what they are about to download. */
export function clipBytes(count: number) {
  return count * (4 + DIMS * 4);
}
