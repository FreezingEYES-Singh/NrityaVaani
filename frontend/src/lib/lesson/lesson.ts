/**
 * A lesson: one take cut into steps, each step with teaching notes.
 *
 * This is the thing the studio produces — not motion (that is a clip) and not
 * landmarks (that is a bake), but the *structure* someone teaches from: named
 * steps with their time ranges and the three key points a student should watch
 * for. Steps point at frame ranges of a bake; playback walks those ranges, so a
 * lesson's motion lives in the bake/clip and this file holds only the map.
 *
 * Deliberately dependency-free for the same reason as `segment`: it must run
 * under Node in `tools/lesson/lesson.mjs` as well as in the browser.
 */

export interface LessonStep {
  /** Stable id, independent of the step's position. */
  id: string;
  /** 0-based order in the take. */
  index: number;
  /** What the step is called — "Step 1" until someone names it. */
  name: string;
  /** First frame of the step, inclusive, into the baked take. */
  startFrame: number;
  /** First frame after the step, exclusive. */
  endFrame: number;
  startTime: number;
  endTime: number;
  duration: number;
  /** 0-1 fraction of frames with a pose. */
  coverage: number;
  /** Peak lower-body speed in m/frame. */
  peakSpeed: number;
  /** What the teacher said during this step, once transcription exists. */
  transcript?: string;
  /** Three concrete things a student should get right. */
  keyPoints: string[];
  /** One line saying what the step is, for the list. */
  focus?: string;
}

export interface Lesson {
  id: string;
  /** The take's name, shown in the library. */
  name: string;
  /** The video it was cut from, for re-baking. */
  source: string;
  /** Frames per second the source was baked at. */
  fps: number;
  steps: LessonStep[];
  createdAt: number;
  savedAt: number;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * A new id.
 *
 * Not assumed to be cryptographic — it needs to not collide between two lessons
 * saved in one session. `crypto.randomUUID` needs a secure context, which a
 * page served over plain http on a LAN does not always have.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyLesson(name: string, source: string, fps: number): Lesson {
  return {
    id: newId(),
    name,
    source,
    fps,
    steps: [],
    createdAt: Date.now(),
    savedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Codec — a `.nvlesson` file
// ---------------------------------------------------------------------------

const MAGIC = "NVL1";

/** A lesson as a portable file. Steps only; the motion lives in a bake/clip. */
export function encodeLesson(lesson: Lesson): Blob {
  const json = new TextEncoder().encode(JSON.stringify(lesson));
  const out = new Uint8Array(4 + json.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  out.set(json, 4);
  return new Blob([out], { type: "application/json" });
}

export async function decodeLesson(file: Blob): Promise<Lesson> {
  const buf = await file.arrayBuffer();
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== MAGIC) {
    throw new Error("Not a NrityaVaani lesson file");
  }
  const lesson = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4))) as Lesson;
  return normaliseLesson(lesson);
}

/** Fills in whatever a hand-edited or older file left out, so the rest can trust it. */
export function normaliseLesson(lesson: Lesson): Lesson {
  const steps = (lesson.steps ?? []).map((s, i) => ({
    id: s.id ?? newId(),
    index: typeof s.index === "number" ? s.index : i,
    name: s.name ?? `Step ${i + 1}`,
    startFrame: s.startFrame ?? 0,
    endFrame: s.endFrame ?? s.startFrame ?? 0,
    startTime: s.startTime ?? 0,
    endTime: s.endTime ?? 0,
    duration: s.duration ?? 0,
    coverage: s.coverage ?? 0,
    peakSpeed: s.peakSpeed ?? 0,
    transcript: s.transcript,
    keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints.filter((k) => typeof k === "string") : [],
    focus: s.focus,
  }));
  return {
    id: lesson.id ?? newId(),
    name: lesson.name ?? "Untitled lesson",
    source: lesson.source ?? "",
    fps: lesson.fps ?? 10,
    steps,
    createdAt: lesson.createdAt ?? Date.now(),
    savedAt: lesson.savedAt ?? Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Store — IndexedDB, the same reasoning as `clipStore`
// ---------------------------------------------------------------------------

const DB = "nrityavaani-lessons";
const STORE = "lessons";
const VERSION = 1;

export interface LessonEntry {
  id: string;
  name: string;
  source: string;
  steps: number;
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
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

export async function saveLesson(lesson: Lesson): Promise<string> {
  await tx("readwrite", (s) => s.put(lesson));
  return lesson.id;
}

/** The library list, newest first, without the step details. */
export async function listLessons(): Promise<LessonEntry[]> {
  const all = (await tx("readonly", (s) => s.getAll())) as Lesson[];
  return all
    .filter((l) => l && Array.isArray(l.steps))
    .map((l) => ({ id: l.id, name: l.name, source: l.source, steps: l.steps.length, savedAt: l.savedAt }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadLesson(id: string): Promise<Lesson | null> {
  const l = (await tx("readonly", (s) => s.get(id))) as Lesson | undefined;
  return l ? normaliseLesson(l) : null;
}

export async function deleteLesson(id: string) {
  await tx("readwrite", (s) => s.delete(id));
}
