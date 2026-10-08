/**
 * Browser-only storage for /compare (05-mvp.md §3.7): teacher steps only,
 * landmarks only, never video and never the student's take.
 *
 * - A step is saved for the session automatically before the camera opens
 *   (so a phone that reloads the page doesn't lose it), and swept after 2 h.
 * - "Save this teacher step" keeps it until "Delete saved steps".
 * - The key is a fingerprint of the file and the marked range, so a fresh
 *   copy of the same file finds the saved step again.
 * - Landmarks are packed into one Float32Array (the "NVB2" layout: per frame
 *   t, ok, then 33 x (x, y, z, v) image and 33 x (x, y, z, v) world, NaN when absent).
 */
import { LANDMARK_COUNT, type PoseFrame, type PoseTrack, type Pt } from "./types";

const DB = "nrityavaani-compare";
const STORE = "teacherSteps";
const SESSION_KEY = "nv-compare-session-step";
const PER_FRAME = 2 + LANDMARK_COUNT * 8;

interface Stored {
  key: string;
  name: string;
  session: boolean;
  savedAt: number;
  range: [number, number];
  width: number;
  height: number;
  effectiveFps: number;
  warnings: string[];
  layout: "NVB2";
  data: Float32Array;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

function pack(track: PoseTrack): Float32Array {
  const out = new Float32Array(track.frames.length * PER_FRAME).fill(NaN);
  track.frames.forEach((f, i) => {
    const o = i * PER_FRAME;
    out[o] = f.t;
    out[o + 1] = f.ok ? 1 : 0;
    const put = (pts: Pt[] | null, at: number) => {
      if (!pts) return;
      for (let j = 0; j < LANDMARK_COUNT; j++) {
        const p = pts[j];
        out[at + 4 * j] = p.x;
        out[at + 4 * j + 1] = p.y;
        out[at + 4 * j + 2] = p.z;
        out[at + 4 * j + 3] = p.v;
      }
    };
    put(f.img, o + 2);
    put(f.world, o + 2 + LANDMARK_COUNT * 4);
  });
  return out;
}

function unpack(s: Stored): PoseTrack {
  const n = Math.floor(s.data.length / PER_FRAME);
  const frames: PoseFrame[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * PER_FRAME;
    const get = (at: number): Pt[] | null => {
      if (Number.isNaN(s.data[at])) return null;
      const pts: Pt[] = [];
      for (let j = 0; j < LANDMARK_COUNT; j++)
        pts.push({ x: s.data[at + 4 * j], y: s.data[at + 4 * j + 1], z: s.data[at + 4 * j + 2], v: s.data[at + 4 * j + 3] });
      return pts;
    };
    frames.push({ t: s.data[o], ok: s.data[o + 1] === 1, img: get(o + 2), world: get(o + 2 + LANDMARK_COUNT * 4) });
  }
  return { frames, width: s.width, height: s.height, range: s.range, effectiveFps: s.effectiveFps, warnings: s.warnings };
}

async function sha256(parts: (ArrayBuffer | string)[]): Promise<string> {
  const enc = new TextEncoder();
  const bufs = parts.map((p) => (typeof p === "string" ? enc.encode(p) : new Uint8Array(p)));
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const b of bufs) {
    all.set(b, o);
    o += b.length;
  }
  const h = await crypto.subtle.digest("SHA-256", all);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fingerprint: size, duration, dimensions, the first and last 1 MB, and the marked range. */
export async function fingerprint(
  file: File,
  range: [number, number],
  video?: { duration: number; videoWidth: number; videoHeight: number },
): Promise<string> {
  const MB = 1 << 20;
  const head = await file.slice(0, MB).arrayBuffer();
  const tail = await file.slice(Math.max(0, file.size - MB)).arrayBuffer();
  const meta = [file.size, video ? video.duration.toFixed(2) : "", video?.videoWidth ?? "", video?.videoHeight ?? "", range[0].toFixed(2), range[1].toFixed(2)].join("|");
  return sha256([meta, head, tail]);
}

export async function saveTeacherStep(key: string, track: PoseTrack, meta: { name: string; session: boolean }): Promise<void> {
  const rec: Stored = {
    key,
    name: meta.name,
    session: meta.session,
    savedAt: Date.now(),
    range: track.range,
    width: track.width,
    height: track.height,
    effectiveFps: track.effectiveFps,
    warnings: track.warnings,
    layout: "NVB2",
    data: pack(track),
  };
  await tx("readwrite", (s) => s.put(rec));
}

export async function loadTeacherStep(key: string): Promise<PoseTrack | null> {
  const rec = (await tx<Stored>("readonly", (s) => s.get(key))) as Stored | undefined;
  return rec && rec.layout === "NVB2" ? unpack(rec) : null;
}

/** Steps the user chose to keep (session copies are not listed). */
export async function listSavedSteps(): Promise<{ key: string; name: string; savedAt: number; range: [number, number] }[]> {
  const all = ((await tx<Stored[]>("readonly", (s) => s.getAll())) ?? []) as Stored[];
  return all.filter((r) => !r.session).map((r) => ({ key: r.key, name: r.name, savedAt: r.savedAt, range: r.range }));
}

/** "Delete saved steps": everything this feature stored, session copies included. */
export async function deleteSavedSteps(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
  forgetSessionStep();
}

/** Remove session copies older than maxAgeMs (2 h by default). */
export async function sweepSessionSteps(maxAgeMs = 2 * 3600 * 1000): Promise<void> {
  const all = ((await tx<Stored[]>("readonly", (s) => s.getAll())) ?? []) as Stored[];
  const old = all.filter((r) => r.session && Date.now() - r.savedAt > maxAgeMs);
  if (!old.length) return;
  await tx("readwrite", (s) => {
    for (const r of old) s.delete(r.key);
  });
}

export async function deleteTeacherStep(key: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(key));
}

/** sessionStorage pointer, so a reload (e.g. after the camera app) can restore the step. */
export function rememberSessionStep(key: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, key);
  } catch {
    /* private mode: the step just isn't restored */
  }
}

export function sessionStepKey(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function forgetSessionStep(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to forget */
  }
}
