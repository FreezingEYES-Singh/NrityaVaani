import type { Landmark } from "@/components/three/retarget";

/**
 * Keeps a baked take on the machine, so a clip is only ever tracked once.
 *
 * Baking a two-minute clip at 24 fps is several thousand detections and the
 * better part of ten minutes. Losing that to a page reload is the difference
 * between a tool someone uses and a demo they run once, so the result is
 * written to IndexedDB and picked back up the next time the same video is
 * opened.
 *
 * Two decisions worth stating, because the obvious alternatives do not work:
 *
 * **Typed arrays, not JSON.** A landmark serialises to something like
 * `{"x":0.4213,"y":-0.1187,"z":0.0034}` — near 40 bytes for 12 bytes of
 * number. A 24 fps bake of this clip holds about 385,000 of them, so JSON runs
 * to tens of megabytes and takes seconds to parse. Packed into `Float32Array`s
 * the same take is about 5 MB and loads at memcpy speed.
 *
 * **IndexedDB, not localStorage.** localStorage caps out around 5 MB, stores
 * strings only, and is synchronous — it would block the page on every save.
 */

const DB = "nrityavaani-mocap";
const STORE = "bakes";
const VERSION = 1;

/** Landmark counts, fixed by the models and therefore safe to bake into the layout. */
const POSE = 33;
const HAND = 21;

const HAS_POSE = 1;
const HAS_LEFT = 2;
const HAS_RIGHT = 4;
const HAS_LEFT_SCREEN = 8;
const HAS_RIGHT_SCREEN = 16;

/** One captured frame, as the page holds it in memory. */
export interface StoredSample {
  t: number;
  pose: Landmark[] | null;
  poseScreen: Landmark[] | null;
  left: Landmark[] | null;
  right: Landmark[] | null;
  leftScreen: Landmark[] | null;
  rightScreen: Landmark[] | null;
}

export interface StoredBake {
  /** What produced this, so a stale bake is never silently reused. */
  fps: number;
  quality: string;
  smoothing: number;
  despike: boolean;
  duration: number;
  savedAt: number;
  samples: StoredSample[];
  stats: {
    frames: number;
    withPose: number;
    withLeft: number;
    withRight: number;
    /** Optional: bakes written before crop accounting existed do not carry these. */
    viaCrop?: number;
    viaFull?: number;
    meanVisibility: number;
    worstResidual: number;
  };
}

/** The packed form actually written to disk. */
interface Packed {
  fps: number;
  quality: string;
  smoothing: number;
  despike: boolean;
  duration: number;
  savedAt: number;
  count: number;
  stats: StoredBake["stats"];
  flags: Uint8Array;
  times: Float32Array;
  /** x, y, z per landmark. */
  poseWorld: Float32Array;
  /** x, y, z, visibility per landmark. */
  poseScreen: Float32Array;
  leftWorld: Float32Array;
  rightWorld: Float32Array;
  leftScreen: Float32Array;
  rightScreen: Float32Array;
}

function writeXYZ(into: Float32Array, at: number, from: Landmark[] | null, n: number) {
  if (!from) return;
  for (let i = 0; i < n; i++) {
    const p = from[i];
    if (!p) continue;
    const o = at + i * 3;
    into[o] = p.x;
    into[o + 1] = p.y;
    into[o + 2] = p.z;
  }
}

function readXYZ(from: Float32Array, at: number, n: number): Landmark[] {
  const out: Landmark[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = at + i * 3;
    out[i] = { x: from[o], y: from[o + 1], z: from[o + 2] };
  }
  return out;
}

function pack(bake: StoredBake): Packed {
  const n = bake.samples.length;
  const p: Packed = {
    fps: bake.fps,
    quality: bake.quality,
    smoothing: bake.smoothing,
    despike: bake.despike,
    duration: bake.duration,
    savedAt: bake.savedAt,
    count: n,
    stats: bake.stats,
    flags: new Uint8Array(n),
    times: new Float32Array(n),
    poseWorld: new Float32Array(n * POSE * 3),
    poseScreen: new Float32Array(n * POSE * 4),
    leftWorld: new Float32Array(n * HAND * 3),
    rightWorld: new Float32Array(n * HAND * 3),
    leftScreen: new Float32Array(n * HAND * 3),
    rightScreen: new Float32Array(n * HAND * 3),
  };

  bake.samples.forEach((s, i) => {
    p.times[i] = s.t;
    let f = 0;
    if (s.pose) f |= HAS_POSE;
    if (s.left) f |= HAS_LEFT;
    if (s.right) f |= HAS_RIGHT;
    if (s.leftScreen) f |= HAS_LEFT_SCREEN;
    if (s.rightScreen) f |= HAS_RIGHT_SCREEN;
    p.flags[i] = f;

    writeXYZ(p.poseWorld, i * POSE * 3, s.pose, POSE);
    writeXYZ(p.leftWorld, i * HAND * 3, s.left, HAND);
    writeXYZ(p.rightWorld, i * HAND * 3, s.right, HAND);
    writeXYZ(p.leftScreen, i * HAND * 3, s.leftScreen, HAND);
    writeXYZ(p.rightScreen, i * HAND * 3, s.rightScreen, HAND);

    // The screen pose carries visibility, which is the one field the overlay
    // and every quality readout depend on, so it gets a fourth lane.
    if (s.poseScreen) {
      const at = i * POSE * 4;
      for (let j = 0; j < POSE; j++) {
        const l = s.poseScreen[j];
        if (!l) continue;
        const o = at + j * 4;
        p.poseScreen[o] = l.x;
        p.poseScreen[o + 1] = l.y;
        p.poseScreen[o + 2] = l.z;
        p.poseScreen[o + 3] = l.visibility ?? 1;
      }
    }
  });

  return p;
}

function unpack(p: Packed): StoredBake {
  const samples: StoredSample[] = new Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const f = p.flags[i];

    let poseScreen: Landmark[] | null = null;
    if (f & HAS_POSE) {
      const at = i * POSE * 4;
      poseScreen = new Array(POSE);
      for (let j = 0; j < POSE; j++) {
        const o = at + j * 4;
        poseScreen[j] = {
          x: p.poseScreen[o],
          y: p.poseScreen[o + 1],
          z: p.poseScreen[o + 2],
          visibility: p.poseScreen[o + 3],
        };
      }
    }

    samples[i] = {
      t: p.times[i],
      pose: f & HAS_POSE ? readXYZ(p.poseWorld, i * POSE * 3, POSE) : null,
      poseScreen,
      left: f & HAS_LEFT ? readXYZ(p.leftWorld, i * HAND * 3, HAND) : null,
      right: f & HAS_RIGHT ? readXYZ(p.rightWorld, i * HAND * 3, HAND) : null,
      leftScreen: f & HAS_LEFT_SCREEN ? readXYZ(p.leftScreen, i * HAND * 3, HAND) : null,
      rightScreen: f & HAS_RIGHT_SCREEN ? readXYZ(p.rightScreen, i * HAND * 3, HAND) : null,
    };
  }

  return {
    fps: p.fps,
    quality: p.quality,
    smoothing: p.smoothing,
    despike: p.despike,
    duration: p.duration,
    savedAt: p.savedAt,
    stats: p.stats,
    samples,
  };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

/**
 * A stable name for a video.
 *
 * A picked file has no URL worth keying on — the blob URL is different every
 * time it is opened — so its identity comes from the things about the file
 * that do not change.
 */
export function bakeKey(src: string, file: File | null) {
  if (file) return `file:${file.name}:${file.size}:${file.lastModified}`;
  return `src:${src}`;
}

export async function saveBake(key: string, bake: StoredBake) {
  await tx("readwrite", (s) => s.put(pack(bake), key));
}

export async function loadBake(key: string): Promise<StoredBake | null> {
  const packed = (await tx("readonly", (s) => s.get(key))) as Packed | undefined;
  if (!packed || typeof packed.count !== "number") return null;
  return unpack(packed);
}

export async function deleteBake(key: string) {
  await tx("readwrite", (s) => s.delete(key));
}

// ---------------------------------------------------------------------------
// Bakes as files
//
// IndexedDB is invisible and, worse, private to one browser profile on one
// machine — a take baked in Chrome is not there in Firefox, and cannot be sent
// to anyone. These two turn a bake into an ordinary file: something to keep
// next to the footage, hand to a teammate, or check into a dataset.

const MAGIC = "NVB1";

/** Field order in the file. Changing it changes the format. */
const LANES = [
  ["poseWorld", POSE * 3],
  ["poseScreen", POSE * 4],
  ["leftWorld", HAND * 3],
  ["rightWorld", HAND * 3],
  ["leftScreen", HAND * 3],
  ["rightScreen", HAND * 3],
] as const;

export function encodeBake(bake: StoredBake): Blob {
  const p = pack(bake);
  const header = new TextEncoder().encode(
    JSON.stringify({
      fps: p.fps,
      quality: p.quality,
      smoothing: p.smoothing,
      despike: p.despike,
      duration: p.duration,
      savedAt: p.savedAt,
      count: p.count,
      stats: p.stats,
    }),
  );
  const lanes = LANES.map(([name]) => p[name] as Float32Array);
  const bodies: ArrayBufferView[] = [p.flags, p.times, ...lanes];
  const total = 8 + header.length + bodies.reduce((n, b) => n + b.byteLength, 0);

  // One buffer, filled by hand. Handing the Blob a list of typed arrays would
  // do the same thing, but a view's own buffer may be longer than the view —
  // `TextEncoder` makes no promise there — and the whole buffer is what gets
  // written, silently padding the file with whatever else was in it.
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

export async function decodeBake(file: Blob): Promise<StoredBake> {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== MAGIC) {
    throw new Error("Not a NrityaVaani bake file");
  }
  const headerLen = view.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen)));
  const n: number = meta.count;

  let at = 8 + headerLen;
  const flags = new Uint8Array(buf.slice(at, at + n));
  at += n;

  // Every lane is copied out with `slice` rather than viewed in place: a
  // Float32Array view needs a four-byte-aligned offset, and the header is an
  // arbitrary length, so a view would throw on most files.
  const take = (len: number) => {
    const a = new Float32Array(buf.slice(at, at + len * 4));
    at += len * 4;
    return a;
  };

  const times = take(n);
  const lanes: Record<string, Float32Array> = {};
  for (const [name, width] of LANES) lanes[name] = take(n * width);

  return unpack({
    ...meta,
    flags,
    times,
    poseWorld: lanes.poseWorld,
    poseScreen: lanes.poseScreen,
    leftWorld: lanes.leftWorld,
    rightWorld: lanes.rightWorld,
    leftScreen: lanes.leftScreen,
    rightScreen: lanes.rightScreen,
  } as Packed);
}

/** Rough size on disk, for telling someone what they are storing. */
export function bakeBytes(count: number) {
  return count * (1 + 4 + POSE * 3 * 4 + POSE * 4 * 4 + HAND * 3 * 4 * 4);
}
