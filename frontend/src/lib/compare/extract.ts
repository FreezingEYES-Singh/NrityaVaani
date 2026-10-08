/**
 * Browser-only: video -> PoseTrack, on this device (05-mvp.md §3.1).
 *
 * - Models: PoseLandmarker "full", VIDEO mode with numPoses 1 (MediaPipe only
 *   smooths landmarks for a single pose), plus an IMAGE-mode pass with
 *   numPoses 3 about once a second that checks for other people.
 * - Hands: a HandLandmarker per side runs on a square cut from the full-size
 *   frame around each wrist (placed and sized from the pose), up to 15 times a
 *   second. In a full-body video the hands are too small to find in the whole
 *   frame. If the hand model can't load, the body is still tracked.
 * - Frames are drawn into our own canvas (<= 960 px on the long side), and the
 *   models get our own WebGL canvas, so a lost GPU context is noticed.
 * - Reading: muted playback with requestVideoFrameCallback, slowing to 0.5x
 *   and 0.25x when frames are being skipped; a seek loop when playback is
 *   refused or stalls. A sample whose frame never arrives is dropped, never
 *   labelled with the wrong time.
 * - Nothing leaves the device: the WASM runtime is served by this site and the
 *   model file is only downloaded.
 */
import { FilesetResolver, HandLandmarker, PoseLandmarker, type PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { ExtractError, type ExtractProgress, type HandFrame, type Hands, type PoseFrame, type PoseTrack, type Pt } from "./types";

export const WASM_BASE = "/mediapipe/wasm";
export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
export const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
/** Shown before the first use: the WASM runtime (11.5 MB), the pose model (9.4 MB) and the hand model (7.8 MB). */
export const MODEL_DOWNLOAD_MB = 29;

/** Side of the square the hand crops are drawn into. */
const HAND_PX = 256;
const HAND_EVERY_SEC = 1 / 15;

const MAX_SIDE = 960;
/** Below this many processed frames per video-second, playback slows down. */
const MIN_FPS = 10;
const SEEK_FPS = 15;
const IDENTITY_EVERY_SEC = 1;

type Delegate = "GPU" | "CPU";
interface Models {
  main: PoseLandmarker;
  identity: PoseLandmarker;
  /** One per side, so each keeps tracking its own hand. Null when the hand model isn't available. */
  handL: HandLandmarker | null;
  handR: HandLandmarker | null;
  delegate: Delegate;
  lost: boolean;
}

let filesetP: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
let modelBytesP: Promise<Uint8Array> | null = null;
let handBytesP: Promise<Uint8Array | null> | null = null;
let lastTs = 0;

function report(on: ((p: ExtractProgress) => void) | undefined, p: Partial<ExtractProgress> & Pick<ExtractProgress, "stage">) {
  on?.({ fraction: 0, etaSec: null, message: null, ...p });
}

async function downloadModel(
  onProgress?: (p: ExtractProgress) => void,
  url = POSE_MODEL_URL,
  message = "Downloading the pose model",
  expected = 9.4e6,
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || expected;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    report(onProgress, { stage: "loading-model", fraction: Math.min(1, got / total), message });
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Download the runtime and model (cached for the session). Safe to call early. */
export async function preloadModels(onProgress?: (p: ExtractProgress) => void): Promise<void> {
  try {
    filesetP ??= FilesetResolver.forVisionTasks(WASM_BASE);
    modelBytesP ??= downloadModel(onProgress);
    await Promise.all([filesetP, modelBytesP]);
    // the hand model is optional: without it the body is still compared
    handBytesP ??= downloadModel(onProgress, HAND_MODEL_URL, "Downloading the hand model", 7.8e6).catch(() => null);
    await handBytesP;
  } catch (e) {
    filesetP = null;
    modelBytesP = null;
    throw new ExtractError("model-failed", `The pose model couldn't be loaded (${(e as Error).message}). Check the connection and try again.`);
  }
}

async function createModels(delegate: Delegate): Promise<Models> {
  const fileset = await filesetP!;
  const bytes = await modelBytesP!;
  const mk = async (mode: "VIDEO" | "IMAGE", numPoses: number) => {
    const canvas = document.createElement("canvas");
    const lm = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: bytes, delegate },
      runningMode: mode,
      numPoses,
      canvas: delegate === "GPU" ? canvas : undefined,
    });
    return { lm, canvas };
  };
  const main = await mk("VIDEO", 1);
  const identity = await mk("IMAGE", 3);
  const canvases = [main.canvas, identity.canvas];
  const handBytes = await handBytesP;
  const mkHand = async (): Promise<HandLandmarker | null> => {
    if (!handBytes) return null;
    try {
      const canvas = document.createElement("canvas");
      const lm = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: handBytes, delegate },
        runningMode: "VIDEO",
        numHands: 2,
        canvas: delegate === "GPU" ? canvas : undefined,
      });
      canvases.push(canvas);
      return lm;
    } catch {
      return null;
    }
  };
  const handL = await mkHand();
  const handR = handL ? await mkHand() : null;
  const m: Models = { main: main.lm, identity: identity.lm, handL, handR, delegate, lost: false };
  for (const c of canvases) c.addEventListener("webglcontextlost", () => (m.lost = true));
  return m;
}

/** `?delegate=cpu` forces the CPU (headless smoke tests, and devices with a broken GPU driver). */
function forcedCpu(): boolean {
  try {
    return new URLSearchParams(location.search).get("delegate") === "cpu";
  } catch {
    return false;
  }
}

async function getModels(onProgress?: (p: ExtractProgress) => void): Promise<Models> {
  report(onProgress, { stage: "loading-model", message: "Loading the pose model" });
  await preloadModels(onProgress);
  try {
    if (forcedCpu()) return await createModels("CPU");
    return await createModels("GPU");
  } catch {
    try {
      return await createModels("CPU");
    } catch (e) {
      throw new ExtractError("model-failed", `The pose model couldn't start on this device (${(e as Error).message}).`);
    }
  }
}

function closeModels(m: Models | null) {
  try {
    m?.main.close();
    m?.identity.close();
    m?.handL?.close();
    m?.handR?.close();
  } catch {
    /* already gone */
  }
}

/**
 * Call synchronously inside a tap handler, before any await: iPhones in Low
 * Power Mode refuse play() that isn't started by a tap.
 */
export function primeVideo(video: HTMLVideoElement): void {
  video.muted = true;
  video.playsInline = true;
  const p = video.play();
  if (p) p.then(() => video.pause()).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* One job at a time                                                    */
/* ------------------------------------------------------------------ */

let queue: Promise<unknown> = Promise.resolve();
/** Runs extraction jobs one after another (both videos share the GPU and the models). */
export function runExclusive<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitEvent(el: HTMLVideoElement, name: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      el.removeEventListener(name, on);
      resolve(false);
    }, ms);
    const on = () => {
      clearTimeout(t);
      el.removeEventListener(name, on);
      resolve(true);
    };
    el.addEventListener(name, on);
  });
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/** Seek and wait for the new frame to be presented. Null when it doesn't arrive in time. */
async function seekFrame(video: VideoWithRvfc, t: number, ms = 2000): Promise<number | null> {
  const rvfc = video.requestVideoFrameCallback?.bind(video);
  const frame = rvfc
    ? new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        rvfc((_, meta) => {
          clearTimeout(timer);
          resolve(meta.mediaTime);
        });
      })
    : null;
  const seeked = waitEvent(video, "seeked", ms);
  video.currentTime = t;
  if (!(await seeked)) return null;
  if (!frame) {
    await sleep(30);
    return video.currentTime;
  }
  return frame;
}

function isBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  let max = 0;
  for (let i = 0; i < data.length; i += 4 * 97) max = Math.max(max, data[i], data[i + 1], data[i + 2]);
  return max < 8;
}

function toPts(lms: { x: number; y: number; z: number; visibility?: number }[], ar: number, image: boolean): Pt[] {
  return lms.map((p) =>
    image
      ? { x: p.x * ar, y: p.y, z: p.z * ar, v: p.visibility ?? 0 }
      : { x: p.x, y: p.y, z: p.z, v: p.visibility ?? 0 },
  );
}

function boxOf(pts: Pt[]): { h: number; feet: number; hipX: number; hipY: number } {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.v < 0.3) continue;
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  return { h: y1 - y0, feet: y1, hipX: (pts[23].x + pts[24].x) / 2, hipY: (pts[23].y + pts[24].y) / 2 };
}

/**
 * Where to look for one hand, in video pixels: a square ahead of the wrist, along
 * the pose's hand direction (wrist -> index/pinky), sized from the forearm and the
 * torso (a foreshortened forearm alone would make it too small).
 */
function handBox(img: Pt[], side: "l" | "r", H: number): { x: number; y: number; size: number; handLen: number } | null {
  const [EL, WR, PI, IN] = side === "l" ? [13, 15, 17, 19] : [14, 16, 18, 20];
  const wr = img[WR];
  const el = img[EL];
  if (wr.v < 0.3) return null;
  const px = (p: Pt) => [p.x * H, p.y * H] as const;
  const [wx, wy] = px(wr);
  const [ex, ey] = px(el);
  const sh = [((img[11].x + img[12].x) / 2) * H, ((img[11].y + img[12].y) / 2) * H];
  const hp = [((img[23].x + img[24].x) / 2) * H, ((img[23].y + img[24].y) / 2) * H];
  const forearm = Math.hypot(wx - ex, wy - ey);
  const torso = Math.hypot(sh[0] - hp[0], sh[1] - hp[1]);
  const handLen = Math.max(0.73 * forearm, 0.38 * torso, 12);
  let dx = wx - ex;
  let dy = wy - ey;
  if (img[PI].v > 0.3 && img[IN].v > 0.3) {
    dx = ((img[PI].x + img[IN].x) / 2) * H - wx;
    dy = ((img[PI].y + img[IN].y) / 2) * H - wy;
  }
  const d = Math.hypot(dx, dy) || 1;
  const size = 2 * handLen;
  const cx = wx + (dx / d) * 0.5 * handLen;
  const cy = wy + (dy / d) * 0.5 * handLen;
  return { x: cx - size / 2, y: cy - size / 2, size, handLen };
}

export interface ExtractOptions {
  onProgress?: (p: ExtractProgress) => void;
  signal?: AbortSignal;
  /** Called when playback stalls and a tap is needed to continue at full speed (the seek loop keeps going). */
  onNeedTap?: () => void;
}

/**
 * Find the dancer in every frame of `range` (seconds) of a <video> showing a
 * local file. Resolves with the track; rejects with an ExtractError.
 */
export function extractPose(video: HTMLVideoElement, range: [number, number], opts: ExtractOptions = {}): Promise<PoseTrack> {
  return runExclusive(() => extractNow(video as VideoWithRvfc, range, opts));
}

async function extractNow(video: VideoWithRvfc, range: [number, number], opts: ExtractOptions): Promise<PoseTrack> {
  const { onProgress, signal } = opts;
  const aborted = () => signal?.aborted;
  const abortErr = () => new ExtractError("aborted", "Stopped.");
  video.muted = true;
  video.playsInline = true;
  report(onProgress, { stage: "checking", message: "Checking the video" });
  if (video.readyState < 1) await waitEvent(video, "loadedmetadata", 3000);
  if (!video.videoWidth || !video.videoHeight)
    throw new ExtractError("codec", "Your phone saved this in a format this browser can't play. Try another video, or record again.");
  const [start, end0] = range;
  const end = Math.min(end0, Number.isFinite(video.duration) ? video.duration : end0);
  if (end - start < 1) throw new ExtractError("too-short", "The marked part is shorter than a second.");

  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const ar = w / h;

  // a real frame must arrive within 3 s
  const t0 = await seekFrame(video, start, 3000);
  ctx.drawImage(video, 0, 0, w, h);
  if (t0 === null || isBlank(ctx, w, h))
    throw new ExtractError("codec", "Your phone saved this in a format this browser can't play. Try another video, or record again.");

  let models: Models | null = await getModels(onProgress);
  if (aborted()) {
    closeModels(models);
    throw abortErr();
  }

  // GPU check on the first real frame: if the GPU sees nobody but the CPU does, use the CPU
  if (models.delegate === "GPU") {
    let gpuSees = false;
    try {
      gpuSees = models.identity.detect(canvas).landmarks.length > 0;
    } catch {
      gpuSees = false;
    }
    if (!gpuSees) {
      const cpu = await createModels("CPU");
      if (cpu.identity.detect(canvas).landmarks.length > 0) {
        closeModels(models);
        models = cpu;
      } else closeModels(cpu);
    }
  }

  // the hand crops are cut from the full-size frame
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const hcanvas = document.createElement("canvas");
  hcanvas.width = HAND_PX;
  hcanvas.height = HAND_PX;
  const hctx = hcanvas.getContext("2d")!;
  let lastHand = -Infinity;
  let handFrames = 0;
  let handFound = 0;

  const handAt = (img: Pt[], side: "l" | "r", ts: number): HandFrame | null => {
    const lmk = side === "l" ? models!.handL : models!.handR;
    const box = lmk ? handBox(img, side, vh) : null;
    if (!lmk || !box) return null;
    const { x: sx, y: sy, size, handLen } = box;
    const x0 = Math.max(0, sx);
    const y0 = Math.max(0, sy);
    const x1 = Math.min(vw, sx + size);
    const y1 = Math.min(vh, sy + size);
    if (x1 - x0 < 8 || y1 - y0 < 8) return null;
    const k = HAND_PX / size;
    hctx.fillStyle = "#000";
    hctx.fillRect(0, 0, HAND_PX, HAND_PX);
    hctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
    const res = lmk.detectForVideo(hcanvas, ts);
    // the hand whose wrist is nearest the pose's wrist, if it is near enough and hand-sized
    const wr = img[side === "l" ? 15 : 16];
    let best = -1;
    let bestD = Infinity;
    res.landmarks.forEach((h, i) => {
      const d = Math.hypot(sx + h[0].x * size - wr.x * vh, sy + h[0].y * size - wr.y * vh);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0 || bestD > 0.7 * handLen) return null;
    const h = res.landmarks[best];
    const palm = Math.hypot((h[9].x - h[0].x) * size, (h[9].y - h[0].y) * size);
    if (palm < 0.2 * handLen || palm > 1.2 * handLen) return null;
    const w = res.worldLandmarks[best];
    return {
      img: h.map((p) => ({ x: (sx + p.x * size) / vh, y: (sy + p.y * size) / vh, z: (p.z * size) / vh, v: 1 })),
      world: w ? w.map((p) => ({ x: p.x, y: p.y, z: p.z, v: 1 })) : null,
    };
  };

  const handsAt = (img: Pt[], t: number, ts: number): Hands | undefined => {
    if (!models!.handL || t - lastHand < HAND_EVERY_SEC - 1e-3) return undefined;
    lastHand = t;
    handFrames++;
    try {
      const hands = { l: handAt(img, "l", ts), r: handAt(img, "r", ts) };
      if (hands.l || hands.r) handFound++;
      return hands;
    } catch {
      return undefined; // the hand pass never fails a frame
    }
  };

  const frames: PoseFrame[] = [];
  const warnings: string[] = [];
  const base = lastTs + 10_000;
  let lastIdentity = -Infinity;
  let identityChecks = 0;
  let secondPerson = 0;
  const boxes: number[] = [];
  let sideways = 0;
  let detections = 0;
  const wall0 = performance.now();

  const detect = (t: number): void => {
    ctx.drawImage(video, 0, 0, w, h);
    if (models!.lost) return; // recreated below, this sample is dropped
    const ts = Math.max(lastTs + 1, base + (t - start) * 1000);
    lastTs = ts;
    let res: PoseLandmarkerResult;
    try {
      res = models!.main.detectForVideo(canvas, ts);
    } catch {
      models!.lost = true;
      return;
    }
    const lm = res.landmarks[0];
    if (!lm) {
      frames.push({ t, img: null, world: null, ok: false });
      return;
    }
    const img = toPts(lm, ar, true);
    const world = res.worldLandmarks[0] ? toPts(res.worldLandmarks[0], ar, false) : null;
    detections++;
    const sh = { x: (img[11].x + img[12].x) / 2, y: (img[11].y + img[12].y) / 2 };
    const hp = { x: (img[23].x + img[24].x) / 2, y: (img[23].y + img[24].y) / 2 };
    if (Math.abs(sh.x - hp.x) > Math.abs(sh.y - hp.y) * 1.7) sideways++;
    const box = boxOf(img);
    boxes.push(box.h);
    let ok = true;
    if (t - lastIdentity >= IDENTITY_EVERY_SEC) {
      lastIdentity = t;
      identityChecks++;
      try {
        const people = models!.identity.detect(canvas).landmarks.map((p) => boxOf(toPts(p, ar, true)));
        // someone at a similar depth: box height within 25%, feet at a similar height
        const others = people.filter((p) => Math.hypot(p.hipX - box.hipX, p.hipY - box.hipY) > 0.1);
        if (others.some((p) => Math.abs(p.h - box.h) <= 0.25 * box.h && Math.abs(p.feet - box.feet) <= 0.15 * box.h)) secondPerson++;
        // the tracked body jumped to someone much smaller (further back) while others are around
        const typical = boxes.length >= 5 ? boxes.slice(-60).sort((a, b) => a - b)[Math.floor(Math.min(60, boxes.length) / 2)] : box.h;
        if (others.length && box.h < 0.6 * typical) ok = false;
      } catch {
        /* the identity pass is a check, never a reason to fail */
      }
    }
    frames.push({ t, img, world, ok, hands: handsAt(img, t, ts) });
  };

  const progress = (t: number, message: string | null) => {
    const f = Math.min(1, Math.max(0, (t - start) / (end - start)));
    const el = (performance.now() - wall0) / 1000;
    report(onProgress, { stage: "processing", fraction: f, etaSec: f > 0.03 ? (el / f) * (1 - f) : null, message });
  };

  // wake lock while processing; processing pauses while the tab is hidden
  type WakeLockSentinelLike = { release: () => Promise<void> };
  let wake = null as WakeLockSentinelLike | null;
  const nav = navigator as Navigator & { wakeLock?: { request: (k: "screen") => Promise<WakeLockSentinelLike> } };
  const askWake = () => nav.wakeLock?.request("screen").then((s) => (wake = s)).catch(() => undefined);
  void askWake();
  const onVis = () => {
    if (!document.hidden) void askWake();
  };
  document.addEventListener("visibilitychange", onVis);

  const recreate = async () => {
    closeModels(models);
    models = await getModels(onProgress);
  };

  try {
    let from = start;
    const played = await readByPlayback(video, start, end, detect, progress, () => models!.lost, recreate, aborted);
    if (aborted()) throw abortErr();
    if (played !== true) {
      from = played.from;
      // a stalled or refused playback may need a tap; a device too slow even at 0.25x doesn't
      if (played.reason === "stalled") opts.onNeedTap?.();
      // seek loop from where playback stopped
      for (let t = from; t <= end + 1e-6; t += 1 / SEEK_FPS) {
        if (aborted()) throw abortErr();
        while (document.hidden) await sleep(250);
        if (models.lost) await recreate();
        const mt = await seekFrame(video, Math.min(t, end));
        if (mt === null) continue; // the frame never arrived: drop the sample
        detect(mt);
        progress(mt, played.reason === "slow" ? "Reading frame by frame so every frame gets processed" : "Reading frame by frame");
        await sleep(0);
      }
    }
  } finally {
    document.removeEventListener("visibilitychange", onVis);
    void wake?.release().catch(() => undefined);
    video.pause();
    video.playbackRate = 1;
    closeModels(models);
  }

  if (!detections) throw new ExtractError("no-person", "No dancer was found in this part of the video.");
  if (identityChecks >= 3 && secondPerson / identityChecks >= 0.2)
    warnings.push("Someone else is in the video for part of the time; the dancer nearest the camera was followed.");
  if (sideways / detections > 0.6) warnings.push("The dancer looks sideways: the video may be rotated. Results may be poor.");
  if (handFrames >= 15 && handFound / handFrames < 0.3)
    warnings.push("The hands were too small or hidden to read in most frames, so hand shapes can't be checked well. Film closer to see mudras.");
  const span = Math.max(1e-3, end - start);
  frames.sort((a, b) => a.t - b.t);
  report(onProgress, { stage: "done", fraction: 1 });
  return {
    frames,
    width: video.videoWidth,
    height: video.videoHeight,
    range: [start, end],
    effectiveFps: frames.length / span,
    warnings,
  };
}

type PlaybackEnd = true | { from: number; reason: "stalled" | "slow" };

/**
 * Muted playback with requestVideoFrameCallback. Resolves true when the range
 * was read to the end, or with the media time to continue from in the seek loop:
 * "stalled" when playback was refused or paused by the system, "slow" when even
 * 0.25x left fewer than MIN_FPS processed frames per video-second.
 */
async function readByPlayback(
  video: VideoWithRvfc,
  start: number,
  end: number,
  detect: (t: number) => void,
  progress: (t: number, msg: string | null) => void,
  isLost: () => boolean,
  recreate: () => Promise<void>,
  aborted: () => boolean | undefined,
): Promise<PlaybackEnd> {
  if (!video.requestVideoFrameCallback) return { from: start, reason: "stalled" };
  let rate = 1;
  video.playbackRate = rate;
  let last = start;
  let windowStart = start;
  let windowCount = 0;
  let pausedByUs = false;
  let message: string | null = null;
  return new Promise<PlaybackEnd>((resolve) => {
    let finished = false;
    const finish = (v: true | number, reason: "stalled" | "slow" = "stalled") => {
      if (finished) return;
      finished = true;
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onVis);
      pausedByUs = true;
      video.pause();
      resolve(v === true ? true : { from: v, reason });
    };
    const onEnded = () => finish(true);
    const onPause = () => {
      if (!pausedByUs && !finished) finish(last); // paused by the system: continue frame by frame
    };
    const onVis = () => {
      if (document.hidden) {
        pausedByUs = true;
        video.pause();
      } else {
        pausedByUs = false;
        video.play().catch(() => finish(last));
      }
    };
    const cb = async (_: number, meta: { mediaTime: number }) => {
      if (finished) return;
      if (aborted()) return finish(last);
      const t = meta.mediaTime;
      if (t >= end - 1e-3) return finish(true);
      if (isLost()) {
        pausedByUs = true;
        video.pause();
        await recreate();
        pausedByUs = false;
        video.play().catch(() => finish(last));
      } else if (t >= start - 1e-3 && t > last - 1e-6) {
        detect(t);
        last = t;
        windowCount++;
        if (t - windowStart >= 1) {
          const fps = windowCount / (t - windowStart);
          if (fps < MIN_FPS && rate > 0.25) {
            rate /= 2;
            video.playbackRate = rate;
            message = `Slowed to ${rate}× so every frame gets processed`;
          } else if (fps < MIN_FPS) {
            return finish(last, "slow"); // the seek loop samples every frame, however slow the device
          }
          windowStart = t;
          windowCount = 0;
        }
        progress(t, message);
      }
      video.requestVideoFrameCallback!(cb);
    };
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onVis);
    video.requestVideoFrameCallback!(cb);
    pausedByUs = false;
    video.play().catch(() => finish(last));
  });
}
