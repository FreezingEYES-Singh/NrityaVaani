/**
 * Saved performances, kept in the browser so a take survives the tab closing.
 *
 * The same reasoning as `bakeStore`, one level further along. A bake is worth
 * keeping because tracking a clip is expensive; a *performance* is worth
 * keeping because it is the thing being made — the tutorial. Someone tracks a
 * dancer once and then wants that take to be there tomorrow, and next week,
 * without the video, without re-baking, and without a server.
 *
 * IndexedDB rather than localStorage, for the same three reasons as the bakes:
 * localStorage caps out near 5 MB where one take is about 2, stores strings
 * only, and is synchronous. And typed arrays rather than JSON — a clip is
 * 520,000 floats, which as JSON runs to tens of megabytes and takes seconds to
 * parse where the packed form loads at memcpy speed.
 *
 * A separate database from the bakes on purpose. They have different
 * lifetimes: a bake can be thrown away the moment a performance is saved from
 * it, and a performance has to outlive every bake it came from.
 */

import type { Clip, ClipMeta } from "./clip";
import { DIMS } from "./poseCodec";
import { LAYOUT } from "./skeleton";

const DB = "nrityavaani-clips";
const STORE = "clips";
const VERSION = 1;

/** What the library list shows, without loading the poses themselves. */
export interface ClipEntry {
  id: string;
  /** What the person called it. Editable; the id is what actually identifies it. */
  name: string;
  meta: ClipMeta;
  bytes: number;
}

interface Stored {
  id: string;
  name: string;
  meta: ClipMeta;
  times: Float32Array;
  poses: Float32Array;
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

/**
 * A new id.
 *
 * `crypto.randomUUID` is not assumed: it needs a secure context, and this page
 * is opened over plain http on a LAN often enough that a hard failure there
 * would be a real one. The fallback does not need to be cryptographic — it
 * needs to not collide between two takes saved in the same session.
 */
function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveClip(clip: Clip, name: string): Promise<string> {
  const id = newId();
  const record: Stored = { id, name, meta: clip.meta, times: clip.times, poses: clip.poses };
  await tx("readwrite", (s) => s.put(record));
  return id;
}

/** Everything in the library, newest first, without the pose data. */
export async function listClips(): Promise<ClipEntry[]> {
  const all = (await tx("readonly", (s) => s.getAll())) as Stored[];
  return all
    .filter((r) => r?.meta)
    .map((r) => ({
      id: r.id,
      name: r.name,
      meta: r.meta,
      bytes: r.times.byteLength + r.poses.byteLength,
    }))
    .sort((a, b) => b.meta.savedAt - a.meta.savedAt);
}

export async function loadClip(id: string): Promise<Clip | null> {
  const r = (await tx("readonly", (s) => s.get(id))) as Stored | undefined;
  if (!r?.meta) return null;

  // Checked on the way out as well as on the way in. A clip saved before a
  // joint-list change decodes into a body where the elbow's numbers land on a
  // knuckle, and nothing about the result looks wrong enough to catch by eye.
  if (r.meta.layout !== LAYOUT || r.meta.dims !== DIMS) {
    throw new Error(
      `"${r.name}" was saved against joint layout ${r.meta.layout} (${r.meta.dims} numbers per ` +
        `frame); this build expects ${LAYOUT} (${DIMS}). It needs saving again from its bake.`,
    );
  }

  return { meta: r.meta, times: r.times, poses: r.poses };
}

export async function renameClip(id: string, name: string) {
  const r = (await tx("readonly", (s) => s.get(id))) as Stored | undefined;
  if (!r) return;
  await tx("readwrite", (s) => s.put({ ...r, name }));
}

export async function deleteClip(id: string) {
  await tx("readwrite", (s) => s.delete(id));
}
