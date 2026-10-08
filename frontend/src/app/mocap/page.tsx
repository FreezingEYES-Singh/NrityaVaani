"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type HandLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { MocapApi } from "@/components/three/MocapFigure";
import { clipBytes, emptyClip, encodeClip } from "@/lib/motion/clip";
import { decollideClip } from "@/lib/motion/collide";
import {
  applyCritique,
  shiftFor,
  MIN_CONFIDENCE,
  type Critique,
} from "@/lib/motion/critic";
import {
  deleteClip,
  listClips,
  loadClip,
  saveClip,
  type ClipEntry,
} from "@/lib/motion/clipStore";
import { polishClip } from "@/lib/motion/polish";
import { validateClip } from "@/lib/motion/validate";
import { DIMS } from "@/lib/motion/poseCodec";
import type { Frame, Landmark, Report } from "@/components/three/retarget";
import {
  P,
  despikeTrack,
  enforceSkeleton,
  measureSkeleton,
  smoothTrack,
  stabiliseTrack,
} from "@/components/three/retarget";
import type { Sex } from "@/components/three/figureRig";
import {
  bakeBytes,
  bakeKey,
  decodeBake,
  deleteBake,
  encodeBake,
  loadBake,
  saveBake,
  type StoredSample,
} from "@/lib/mocap/bakeStore";

const MocapFigure = dynamic(() => import("@/components/three/MocapFigure"), {
  ssr: false,
  loading: () => null,
});

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
/**
 * The three pose models Google ships, cheapest first.
 *
 * `heavy` is the default here, which would be the wrong call for a live camera
 * and is the right one for this page: detection happens once, offline, during
 * the bake, and playback afterwards costs nothing either way. Paying twice the
 * time once to get the better landmarks is simply a better trade when nobody
 * is waiting on a frame.
 */
const POSE_MODELS = {
  lite: "pose_landmarker_lite",
  full: "pose_landmarker_full",
  heavy: "pose_landmarker_heavy",
} as const;
type Quality = keyof typeof POSE_MODELS;
const poseModelUrl = (q: Quality) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/${POSE_MODELS[q]}/float16/1/${POSE_MODELS[q]}.task`;
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/**
 * Frames between AI reviews.
 *
 * Every reviewed frame is one API call and one upload of the footage, so
 * reviewing all of them is neither cheap nor fast. At 24 fps this judges the
 * take about once a second, which is close to how often a dancer actually
 * changes what she is doing.
 */
const REVIEW_STRIDE = 24;

/** Longest edge of the video frame sent for review. See `videoFrame`. */
const REVIEW_IMAGE_MAX = 800;

/**
 * The half of a critique that has to happen on the rig.
 *
 * "The hand is too high" is not a rotation of any single joint — it is a change
 * of where the wrist ends up — so it cannot be expressed as a joint nudge the
 * way a finger curl can, and it needs a posed skeleton to work against.
 * `applyCritique` handles everything that *is* a joint angle; this handles the
 * rest, and the two are always called as a pair.
 */
function applyToRig(api: MocapApi, critique: Critique) {
  if (critique.matches || critique.confidence < MIN_CONFIDENCE) return;
  for (const fix of critique.fixes) {
    if (!fix.part.endsWith("Arm")) continue;
    const delta = shiftFor(fix.issue, fix.severity);
    if (!delta) continue;
    const side = fix.part.startsWith("left") ? "L" : "R";
    // The offsets are written for the left side; the right is its mirror, so
    // the sideways component flips.
    if (side === "R") delta.x = -delta.x;
    api.shiftHand(side, delta);
  }
}

const chip =
  "mono rounded-full border border-foreground/20 px-4 py-2 text-[11px] uppercase tracking-[0.16em] transition-colors hover:border-foreground/50 disabled:opacity-40 disabled:hover:border-foreground/20";

/** One captured video frame: what to pose the rig with, and what to draw. */
interface Sample {
  t: number;
  frame: Frame;
  /**
   * Screen-space hand landmarks, kept per side so playback can redraw the
   * overlay. Held apart rather than in one list because which hand a set of
   * points belongs to is information — it is what the crop established, and
   * flattening the two would throw it away again.
   */
  leftScreen: Landmark[] | null;
  rightScreen: Landmark[] | null;
  /** How each hand was found, so the crop can be shown to be earning its keep. */
  via: { L: "crop" | "full" | null; R: "crop" | "full" | null };
}

const toStored = (s: Sample): StoredSample => ({
  t: s.t,
  pose: s.frame.pose,
  poseScreen: s.frame.poseScreen,
  left: s.frame.left?.world ?? null,
  right: s.frame.right?.world ?? null,
  leftScreen: s.leftScreen,
  rightScreen: s.rightScreen,
});

const fromStored = (s: StoredSample): Sample => ({
  t: s.t,
  frame: {
    pose: s.pose,
    poseScreen: s.poseScreen,
    left: s.left ? { world: s.left, screen: s.leftScreen ?? undefined } : null,
    right: s.right ? { world: s.right, screen: s.rightScreen ?? undefined } : null,
  },
  leftScreen: s.leftScreen,
  rightScreen: s.rightScreen,
  // Not stored: how a hand was found is a fact about the bake run, not about
  // the pose, and is only reported live.
  via: { L: null, R: null },
});

interface Baked {
  fps: number;
  /** What produced it, carried so an export can say so. */
  quality: string;
  smoothing: number;
  despike: boolean;
  samples: Sample[];
  /** Aggregated over the whole take — the honest answer to "is it any good". */
  stats: {
    frames: number;
    withPose: number;
    withLeft: number;
    withRight: number;
    /** Hand detections that came from the magnified crop rather than the full frame. */
    viaCrop: number;
    viaFull: number;
    meanVisibility: number;
    worstResidual: number;
  };
}

/**
 * Which detected hand belongs to which side of the body.
 *
 * Not taken from MediaPipe's own handedness, which is defined for a mirrored
 * selfie view and is therefore backwards for ordinary third-person footage —
 * exactly what this page is for. Matching each hand's wrist to the nearer of
 * the two wrists the pose model already found needs no convention at all, and
 * is decided by the picture rather than by an assumption about the camera.
 *
 * Assignment is greedy on the closest pair first, so two hands detected near
 * each other — which is most of Bharatanatyam, where the hands live at the
 * sternum — cannot both claim the same side.
 */
function assignHands(hands: HandLandmarkerResult, pose: PoseLandmarkerResult) {
  const out: { L: number | null; R: number | null } = { L: null, R: null };
  const body = pose.landmarks?.[0];
  if (!body || !hands.landmarks?.length) return out;

  const wrists = { L: body[P.L_WRIST], R: body[P.R_WRIST] };
  const pairs: { side: "L" | "R"; index: number; d: number }[] = [];
  hands.landmarks.forEach((h, i) => {
    for (const side of ["L", "R"] as const) {
      const w = wrists[side];
      if (!w) continue;
      pairs.push({ side, index: i, d: Math.hypot(h[0].x - w.x, h[0].y - w.y) });
    }
  });
  pairs.sort((a, b) => a.d - b.d);

  const used = new Set<number>();
  for (const { side, index, d } of pairs) {
    if (out[side] !== null || used.has(index)) continue;
    // A hand further from either wrist than this is not that wrist's hand; it
    // is a false positive somewhere else in the frame, and letting it through
    // snaps the figure's arm across the body.
    if (d > 0.2) continue;
    out[side] = index;
    used.add(index);
  }
  return out;
}

/** The square of video around one hand, in pixels. */
interface Box {
  x: number;
  y: number;
  size: number;
}

/**
 * Where to look for a hand, from the forearm that carries it.
 *
 * The hand is not at the wrist — it continues past it, away from the elbow —
 * so the box is pushed along the forearm rather than centred on the joint. Its
 * size comes from the forearm's own length in this frame, which means it scales
 * with the dancer's distance from the camera without anything having to be
 * told how far away she is.
 */
function handBox(video: HTMLVideoElement, elbow: Landmark, wrist: Landmark): Box | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const ex = elbow.x * vw;
  const ey = elbow.y * vh;
  const wx = wrist.x * vw;
  const wy = wrist.y * vh;
  const dx = wx - ex;
  const dy = wy - ey;
  const forearm = Math.hypot(dx, dy);
  if (!Number.isFinite(forearm) || forearm < 1) return null;

  const cx = wx + dx * 0.35;
  const cy = wy + dy * 0.35;
  // Generous, because a spread Alapadma is much wider than a fist, and a
  // finger cropped off is worse than background left in.
  const half = Math.max(32, forearm * 0.95);
  return { x: Math.round(cx - half), y: Math.round(cy - half), size: Math.round(half * 2) };
}

/**
 * Draws that square into a fixed-size canvas, magnifying it.
 *
 * The hand occupies a few dozen pixels of an 848x478 frame; the detector sees
 * it at whatever resolution it is given. Blowing the crop up to 256 square
 * hands the same model far more to work with, which is the entire trick.
 *
 * A box overhanging the frame edge is left overhanging: `drawImage` clips the
 * source and shrinks the destination in the same proportion, so what lands on
 * the canvas stays geometrically true and the mapping back below stays valid.
 */
function drawCrop(video: HTMLVideoElement, canvas: HTMLCanvasElement, box: Box) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, box.x, box.y, box.size, box.size, 0, 0, canvas.width, canvas.height);
  return true;
}

/** Crop-local normalised landmarks back into full-frame normalised ones. */
function unCrop(landmarks: Landmark[], box: Box, vw: number, vh: number): Landmark[] {
  return landmarks.map((l) => ({
    x: (box.x + l.x * box.size) / vw,
    y: (box.y + l.y * box.size) / vh,
    z: l.z,
    visibility: l.visibility,
  }));
}

/** Seeks and waits for the frame to actually be there. */
function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    // A seek that lands on the frame already displayed fires no event, so the
    // wait is bounded rather than trusted.
    const done = () => {
      v.removeEventListener("seeked", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 400);
    v.addEventListener("seeked", done);
    v.currentTime = t;
  });
}

export default function MocapPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const handRef = useRef<HandLandmarker | null>(null);
  /** Runs on magnified crops, one hand at a time, in IMAGE mode. */
  const cropHandRef = useRef<HandLandmarker | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<MocapApi | null>(null);
  const stampRef = useRef(0);
  const bakedRef = useRef<Baked | null>(null);
  const abortRef = useRef(false);

  const [baked, setBaked] = useState<Baked | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [sex, setSex] = useState<Sex>("female");
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showBody, setShowBody] = useState(true);
  const [steady, setSteady] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const reviewing = useRef(false);

  /**
   * What the reviewer decided, by frame.
   *
   * Kept rather than applied on the spot, because a review and a save are
   * separate acts: the review looks at every twenty-fourth frame, the save
   * walks all of them, and a correction that lived only on the rig would be
   * overwritten by the next frame and gone before anyone pressed save.
   *
   * A ref rather than state — this is written inside a loop that already drives
   * its own progress display, and re-rendering the page on every frame would
   * make the run slower than the network call it is waiting for.
   */
  const corrections = useRef(new Map<number, Critique>());

  /**
   * One video frame as a PNG data URL.
   *
   * Drawn at the video's own pixel size rather than the element's, so what the
   * model sees is the footage rather than however wide the panel happens to be.
   */
  const videoFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v?.videoWidth) return null;
    // Downscaled to match what the vision model resizes to at its end, and
    // encoded as JPEG: a 848x478 PNG frame is 582 KB where the same frame at
    // 800 wide as JPEG is a fraction of that, for an image charged at a flat
    // rate regardless.
    const scale = Math.min(1, REVIEW_IMAGE_MAX / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  }, []);
  const [library, setLibrary] = useState<ClipEntry[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  // The playback loop, kept in a ref so starting a second tutorial can stop
  // the first without the two fighting over the figure.
  const playRef = useRef<number>(0);

  const refreshLibrary = useCallback(() => {
    listClips()
      .then(setLibrary)
      .catch(() => {
        // A browser with storage blocked has no library; that is not an error
        // worth interrupting the capture flow for.
      });
  }, []);

  useEffect(refreshLibrary, [refreshLibrary]);

  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(playRef.current);
    playRef.current = 0;
    setPlaying(null);
  }, []);

  const playClip = useCallback(
    async (entry: ClipEntry) => {
      stopPlayback();
      videoRef.current?.pause();
      let clip;
      try {
        clip = await loadClip(entry.id);
      } catch (err) {
        setSaved(err instanceof Error ? err.message : String(err));
        return;
      }
      if (!clip) return;

      setPlaying(entry.id);
      const started = performance.now();
      const dims = clip.meta.dims;
      const step = () => {
        // Driven from the wall clock rather than a frame counter, so a tutorial
        // plays at the speed it was danced whatever the display is doing.
        const t = ((performance.now() - started) / 1000) % (clip.meta.duration || 1);
        let i = Math.round(t * clip.meta.fps);
        if (i >= clip.meta.count) i = clip.meta.count - 1;
        apiRef.current?.show(new Float32Array(clip.poses.buffer, i * dims * 4, dims));
        playRef.current = requestAnimationFrame(step);
      };
      playRef.current = requestAnimationFrame(step);
    },
    [stopPlayback],
  );

  useEffect(() => () => cancelAnimationFrame(playRef.current), []);
  const [rate, setRate] = useState(10);
  const [quality, setQuality] = useState<Quality>("heavy");
  const [error, setError] = useState<string | null>(null);
  // Which quality is actually loaded. `ready` is derived from it rather than
  // stored, so switching model does not need a synchronous setState in the
  // effect that loads it — the page is not ready the instant `quality` differs.
  const [loaded, setLoaded] = useState<Quality | null>(null);
  const ready = loaded === quality;
  const [smoothing, setSmoothing] = useState(2);
  const [despike, setDespike] = useState(true);
  const [stabilise, setStabilise] = useState(true);
  const [rigid, setRigid] = useState(true);
  const [src, setSrc] = useState("/mocap-sample.mp4");
  const [file, setFile] = useState<File | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const key = bakeKey(src, file);

  const onReady = useCallback((api: MocapApi) => {
    apiRef.current = api;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM);
        const [pose, hand, cropHand] = await Promise.all([
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: poseModelUrl(quality), delegate: "GPU" },
            runningMode: "VIDEO",
            numPoses: 1,
          }),
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 2,
          }),
          // IMAGE mode, not VIDEO: this one is fed the left crop and then the
          // right crop of the same instant, and VIDEO mode would try to track
          // continuity between two pictures that are of different hands.
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
            runningMode: "IMAGE",
            numHands: 1,
          }),
        ]);
        if (cancelled) {
          pose.close();
          hand.close();
          cropHand.close();
          return;
        }
        poseRef.current = pose;
        handRef.current = hand;
        cropHandRef.current = cropHand;
        setError(null);
        setLoaded(quality);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      poseRef.current?.close();
      handRef.current?.close();
      cropHandRef.current?.close();
      poseRef.current = null;
      handRef.current = null;
      cropHandRef.current = null;
    };
  }, [quality]);

  /** Runs both models on whatever frame the video is currently showing. */
  const detectNow = useCallback((): Sample | null => {
    const video = videoRef.current;
    const pose = poseRef.current;
    const hand = handRef.current;
    const cropHand = cropHandRef.current;
    if (!video || !pose || !hand || video.readyState < 2) return null;

    // Monotonic, and unrelated to the video clock: MediaPipe rejects a
    // timestamp that does not advance, and baking seeks the video about.
    stampRef.current += 1;
    const t = stampRef.current * 40;

    const poseResult = pose.detectForVideo(video, t);
    const body = poseResult.landmarks?.[0] ?? null;

    let canvas = cropCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      cropCanvasRef.current = canvas;
    }

    const hands: { L: Landmark[] | null; R: Landmark[] | null } = { L: null, R: null };
    const screens: { L: Landmark[] | null; R: Landmark[] | null } = { L: null, R: null };
    const via: Sample["via"] = { L: null, R: null };

    // Each hand is looked for in its own magnified crop, positioned from the
    // forearm the pose model already found. This also disposes of the
    // left/right question entirely: the hand found in the crop taken around the
    // left wrist *is* the left hand. Nothing has to be matched afterwards, so
    // the two can no longer be swapped — which is the failure that used to put
    // the figure's arms across each other for a frame or two at a time.
    if (body && cropHand) {
      const sides = [
        { key: "L" as const, elbow: P.L_ELBOW, wrist: P.L_WRIST },
        { key: "R" as const, elbow: P.R_ELBOW, wrist: P.R_WRIST },
      ];
      for (const { key, elbow, wrist } of sides) {
        const e = body[elbow];
        const w = body[wrist];
        if (!e || !w) continue;
        if ((w.visibility ?? 1) < 0.3) continue;
        const box = handBox(video, e, w);
        if (!box || !drawCrop(video, canvas, box)) continue;
        const r = cropHand.detect(canvas);
        if (!r.landmarks?.length) continue;
        hands[key] = r.worldLandmarks[0];
        screens[key] = unCrop(r.landmarks[0], box, video.videoWidth, video.videoHeight);
        via[key] = "crop";
      }
    }

    // Full-frame pass, kept as a fallback for the frames the crop missed —
    // a hand held right at the edge, or a forearm the pose model lost.
    if (!hands.L || !hands.R) {
      const handResult = hand.detectForVideo(video, t + 1);
      const spare = assignHands(handResult, poseResult);
      for (const key of ["L", "R"] as const) {
        const i = spare[key];
        if (hands[key] || i === null) continue;
        hands[key] = handResult.worldLandmarks[i];
        screens[key] = handResult.landmarks[i];
        via[key] = "full";
      }
    }

    return {
      t: video.currentTime,
      frame: {
        pose: poseResult.worldLandmarks?.[0] ?? null,
        poseScreen: body,
        left: hands.L ? { world: hands.L, screen: screens.L ?? undefined } : null,
        right: hands.R ? { world: hands.R, screen: screens.R ?? undefined } : null,
      },
      leftScreen: screens.L,
      rightScreen: screens.R,
      via,
    };
  }, []);

  const drawOverlay = useCallback((s: Sample | null) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.width !== video.videoWidth && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!s) return;
    ctx.lineCap = "round";

    const body = s.frame.poseScreen;
    if (body) {
      ctx.strokeStyle = "#ff9933";
      ctx.lineWidth = 3;
      for (const c of PoseLandmarker.POSE_CONNECTIONS) {
        const a = body[c.start];
        const b = body[c.end];
        if (!a || !b) continue;
        // Faint where the model is unsure, so a limb it has lost does not read
        // as a limb it has found.
        ctx.globalAlpha = Math.min(a.visibility ?? 1, b.visibility ?? 1) < 0.5 ? 0.18 : 1;
        ctx.beginPath();
        ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
        ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const l of body) {
        ctx.beginPath();
        ctx.arc(l.x * canvas.width, l.y * canvas.height, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = (l.visibility ?? 1) < 0.5 ? "#ff5050" : "#ffe0a8";
        ctx.fill();
      }
    }

    ctx.strokeStyle = "#4fd8ff";
    ctx.lineWidth = 2;
    for (const h of [s.leftScreen, s.rightScreen]) {
      if (!h) continue;
      for (const c of HandLandmarker.HAND_CONNECTIONS) {
        const a = h[c.start];
        const b = h[c.end];
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
        ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
        ctx.stroke();
      }
      for (const l of h) {
        ctx.beginPath();
        ctx.arc(l.x * canvas.width, l.y * canvas.height, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = "#c8f4ff";
        ctx.fill();
      }
    }
  }, []);

  /**
   * Steps the whole clip, detecting once per sample, and keeps the result.
   *
   * Deliberately not driven by `requestAnimationFrame`, and deliberately not
   * done live during playback. Detection costs about 95 ms a frame here, so a
   * live pass drops roughly two frames in three and the figure jerks; and rAF
   * stops entirely when the window is not being painted, which would strand a
   * two-minute bake the moment someone switched tabs. Stepping by seek on a
   * plain async loop is slower than real time but complete, and what it
   * produces plays back perfectly smoothly afterwards.
   */
  const bake = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !ready || !v.duration) return;
    abortRef.current = false;
    v.pause();

    const fps = rate;
    const total = Math.max(1, Math.floor(v.duration * fps));
    const samples: Sample[] = [];
    let visSum = 0;
    let withPose = 0;
    let withLeft = 0;
    let withRight = 0;
    let viaCrop = 0;
    let viaFull = 0;
    let worstResidual = 0;

    setProgress({ done: 0, total });

    for (let i = 0; i < total; i++) {
      if (abortRef.current) break;
      await seek(v, i / fps);
      const s = detectNow();
      if (s) {
        samples.push(s);
        if (s.frame.pose) withPose++;
        if (s.frame.left) withLeft++;
        if (s.frame.right) withRight++;
        for (const k of ["L", "R"] as const) {
          if (s.via[k] === "crop") viaCrop++;
          else if (s.via[k] === "full") viaFull++;
        }
        const r = apiRef.current?.pose(s.frame, s.t);
        if (r) {
          visSum += r.visibility;
          worstResidual = Math.max(worstResidual, r.worst);
          if (i % 5 === 0) setReport(r);
        }
        drawOverlay(s);
      }
      setProgress({ done: i + 1, total });
      // Yields to the browser so the progress bar and the two panes actually
      // paint during the bake rather than after it.
      await new Promise((r) => setTimeout(r, 0));
    }

    // Smoothed after the fact, across the whole take, so the window can be
    // centred and cost no delay. Each channel is filtered on its own: a frame
    // where a hand was missed must not pull its neighbours toward a pose that
    // was never detected.
    // Despike first, then smooth. The order is not a preference: averaging a
    // spike does not remove it, it spreads it across the whole window, and a
    // filter that has already smeared one bad frame over five can no longer
    // tell which of the five was the bad one.
    if (samples.length > 2 && (despike || smoothing > 0)) {
      const channels = [
        {
          get: (x: Sample) => x.frame.pose,
          set: (x: Sample, v: Landmark[] | null) => (x.frame.pose = v),
        },
        {
          get: (x: Sample) => x.frame.left?.world ?? null,
          set: (x: Sample, v: Landmark[] | null) => {
            if (x.frame.left && v) x.frame.left = { world: v };
          },
        },
        {
          get: (x: Sample) => x.frame.right?.world ?? null,
          set: (x: Sample, v: Landmark[] | null) => {
            if (x.frame.right && v) x.frame.right = { world: v };
          },
        },
      ];
      // Each channel on its own: a frame where a hand was missed must not pull
      // its neighbours toward a pose that was never detected.
      // Thresholds are quoted per frame at 12 fps; at a higher sample rate the
      // same movement covers proportionally less ground between frames, so a
      // fixed number would call real motion "still" the faster you sampled.
      const perFrame = 12 / fps;

      // Anatomy first, then time. Each frame is put onto a body with fixed
      // proportions before any temporal filter runs, because a limb that keeps
      // changing length is not noise to be averaged away — it is a wrong
      // position, and smoothing a wrong position only makes it a confident one.
      if (rigid) {
        const poses = samples.map((x) => x.frame.pose);
        const vis = samples.map((x) => x.frame.poseScreen?.map((l) => l.visibility ?? 1) ?? null);
        const skeleton = measureSkeleton(despike ? despikeTrack(poses, 2, 3) : poses);
        const fixed = enforceSkeleton(poses, vis, skeleton, 12);
        samples.forEach((x, i) => (x.frame.pose = fixed[i]));
      }

      for (const ch of channels) {
        let track = samples.map(ch.get);
        if (despike) track = despikeTrack(track, 2, 3);
        if (stabilise) track = stabiliseTrack(track, 3, 0.004, 0.02, perFrame);
        if (smoothing > 0) track = smoothTrack(track, smoothing);
        samples.forEach((x, i) => ch.set(x, track[i]));
      }
    }

    const result: Baked = {
      fps,
      quality,
      smoothing,
      despike,
      samples,
      stats: {
        frames: samples.length,
        withPose,
        withLeft,
        withRight,
        viaCrop,
        viaFull,
        meanVisibility: samples.length ? visSum / samples.length : 0,
        worstResidual,
      },
    };
    bakedRef.current = result;
    corrections.current.clear();
    setBaked(result);
    setProgress(null);
    v.currentTime = 0;

    // Written even when the bake was stopped early: a partial take is still
    // worth more than starting again, and it is labelled with its own frame
    // count so nothing pretends to be complete.
    saveBake(key, {
      fps,
      quality,
      smoothing,
      despike,
      duration: v.duration,
      savedAt: Date.now(),
      stats: result.stats,
      samples: samples.map(toStored),
    })
      .then(() => setRestored(null))
      .catch((e) => setError(`Could not save the bake: ${e?.message ?? e}`));
  }, [ready, rate, smoothing, despike, stabilise, rigid, quality, key, detectNow, drawOverlay]);

  /**
   * Picks up a bake saved on a previous visit, for this exact video.
   *
   * Keyed on the video rather than the settings, so a take baked at 24 fps
   * still loads when the controls happen to read 10 — the settings that
   * produced it travel with it and are shown, rather than being used to reject
   * it. Re-baking is always one click away; silently discarding ten minutes of
   * work because a dropdown moved would not be.
   */
  useEffect(() => {
    let dropped = false;
    loadBake(key)
      .then((saved) => {
        if (dropped || !saved || !saved.samples.length) return;
        const result: Baked = {
          fps: saved.fps,
          quality: saved.quality,
          smoothing: saved.smoothing,
          despike: saved.despike,
          samples: saved.samples.map(fromStored),
          stats: { viaCrop: 0, viaFull: 0, ...saved.stats },
        };
        bakedRef.current = result;
        setBaked(result);
        setRestored(
          `${saved.stats.frames} frames, ${saved.quality} model, ${saved.fps} fps, ` +
            `saved ${new Date(saved.savedAt).toLocaleString()}`,
        );
      })
      .catch(() => {
        // A browser with storage blocked is not an error worth interrupting
        // for; it just means every take has to be baked afresh.
      });
    return () => {
      dropped = true;
    };
  }, [key]);

  /**
   * Playback: the video runs at its own speed and the figure is looked up.
   *
   * Nothing is detected here, so this keeps up with the video no matter how
   * slow the models are — which is the whole point of baking first.
   *
   * Driven from three sources, because no one of them is sufficient.
   * `requestAnimationFrame` is the only one fine-grained enough to look smooth,
   * but it stops dead whenever the page is not being painted — a background
   * tab, a window behind another — and it never fires for a seek on a paused
   * video. `timeupdate` keeps the figure moving in those cases at the four or
   * so ticks a second the media element offers, and `seeked` makes scrubbing
   * land exactly, which is how anyone actually inspects a single pose.
   */
  useEffect(() => {
    if (!baked) return;
    const v = videoRef.current;
    if (!v) return;

    let lastIndex = -1;
    let lastShown = -1;
    const show = () => {
      const i = Math.min(baked.samples.length - 1, Math.round(v.currentTime * baked.fps));
      if (i === lastIndex || i < 0) return;
      lastIndex = i;
      const s = baked.samples[i];
      // A jump of more than a frame or two is a seek, and blending across one
      // drags the pose from wherever the video used to be into this one.
      if (lastShown >= 0 && Math.abs(i - lastShown) > 2) apiRef.current?.resettle();
      lastShown = i;
      const r = apiRef.current?.pose(s.frame, s.t);
      if (r) setReport(r);
      drawOverlay(s);
    };

    let raf = 0;
    const tick = () => {
      show();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    v.addEventListener("timeupdate", show);
    v.addEventListener("seeked", show);
    show();

    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("timeupdate", show);
      v.removeEventListener("seeked", show);
    };
  }, [baked, drawOverlay]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    videoRef.current?.pause();
    setBaked(null);
    bakedRef.current = null;
    setReport(null);
    setRestored(null);
    setFile(f);
    setSrc(URL.createObjectURL(f));
  };

  const status = error
    ? `Model load failed: ${error}`
    : !ready
      ? `Loading ${quality} model…`
      : progress
        ? `Baking with ${quality}…`
        : review
          ? review
          : saved
            ? saved
          : restored
            ? `Restored from disk — ${restored}`
          : baked
            ? `Baked with ${quality} — scrub or press play`
          : `Ready — ${quality} model, bake the take`;

  const st = baked?.stats;
  const pct = (n: number) => (st?.frames ? `${Math.round((n / st.frames) * 100)}%` : "—");

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-5">
          <h1 className="text-3xl font-semibold tracking-tight">Motion capture</h1>
          <p className="mono mt-1 text-[11px] uppercase tracking-[0.16em] opacity-60">
            Video → landmarks → rig · {status}
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="relative overflow-hidden rounded-xl border border-foreground/10 bg-black">
            <video
              ref={videoRef}
              src={src}
              playsInline
              muted
              loop
              controls
              className="block h-auto w-full"
            />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
            <span className="mono absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white">
              Detected
            </span>
          </section>

          <section className="relative overflow-hidden rounded-xl border border-foreground/10 bg-black/40">
            <MocapFigure
              sex={sex}
              showSkeleton={showSkeleton}
              showBody={showBody}
              steady={steady}
              onReady={onReady}
              className="h-full min-h-[400px] w-full"
            />
            <span className="mono absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white">
              Retargeted · drag to orbit
            </span>
          </section>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {progress ? (
            <button onClick={() => (abortRef.current = true)} className={chip}>
              Stop bake
            </button>
          ) : (
            <button onClick={bake} disabled={!ready} className={chip}>
              {baked ? "Re-bake" : "Bake take"}
            </button>
          )}
          <label className="mono flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] opacity-70">
            Sample
            <select
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              disabled={!!progress}
              className="rounded border border-foreground/20 bg-transparent px-2 py-1"
            >
              {[5, 10, 15, 24].map((r) => (
                <option key={r} value={r}>
                  {r} fps
                </option>
              ))}
            </select>
          </label>
          <label className="mono flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] opacity-70">
            Model
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality)}
              disabled={!!progress}
              className="rounded border border-foreground/20 bg-transparent px-2 py-1"
            >
              {(["lite", "full", "heavy"] as const).map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>
          <label className="mono flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] opacity-70">
            Smooth
            <select
              value={smoothing}
              onChange={(e) => setSmoothing(Number(e.target.value))}
              disabled={!!progress}
              className="rounded border border-foreground/20 bg-transparent px-2 py-1"
            >
              {[0, 1, 2, 3].map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? "off" : `±${r}`}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setRigid(!rigid)}
            disabled={!!progress}
            className={chip}
          >
            Fixed limbs {rigid ? "on" : "off"}
          </button>
          <button
            onClick={() => setStabilise(!stabilise)}
            disabled={!!progress}
            className={chip}
          >
            Hold still {stabilise ? "on" : "off"}
          </button>
          <button
            onClick={() => setDespike(!despike)}
            disabled={!!progress}
            className={chip}
          >
            Despike {despike ? "on" : "off"}
          </button>
          <button onClick={() => setSex(sex === "female" ? "male" : "female")} className={chip}>
            {sex === "female" ? "Woman" : "Man"}
          </button>
          <button onClick={() => setShowSkeleton(!showSkeleton)} className={chip}>
            Bones {showSkeleton ? "on" : "off"}
          </button>
          <button onClick={() => setShowBody(!showBody)} className={chip}>
            Body {showBody ? "on" : "off"}
          </button>
          <button
            onClick={() => {
              setSteady(!steady);
              apiRef.current?.resettle();
            }}
            className={chip}
          >
            Steady {steady ? "on" : "off"}
          </button>
          {baked && (
            <button
              onClick={() => {
                const blob = encodeBake({
                  fps: baked.fps,
                  quality: baked.quality,
                  smoothing: baked.smoothing,
                  despike: baked.despike,
                  duration: videoRef.current?.duration ?? 0,
                  savedAt: Date.now(),
                  stats: baked.stats,
                  samples: baked.samples.map(toStored),
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${src.split("/").pop()?.replace(/\.[^.]+$/, "") || "take"}-${baked.fps}fps-${baked.quality}.nvbake`;
                a.click();
                // Revoked on the next tick: revoking immediately can cancel the
                // download in some browsers before it has read the blob.
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
              }}
              className={chip}
            >
              Export bake
            </button>
          )}
          {baked && (
            <button
              onClick={() => {
                const api = apiRef.current;
                if (!api) return;

                // The review's summary has had its moment; leaving it up would
                // hide the save's own result behind it, which reads as a save
                // that silently did nothing.
                setReview(null);

                const samples = baked.samples;
                const name = src.split("/").pop()?.replace(/\.[^.]+$/, "") || "take";
                const clip = emptyClip(samples.length, baked.fps, name, sex);

                // Deliberately captured *unsteadied* — no timestamp, which is
                // what tells the live filter to stand aside.
                //
                // The live filter is causal, so it pays for every degree of
                // steadiness with lag. Running it here and then polishing on
                // top would bake that lag into the file and gain nothing: the
                // offline pass sees the whole take at once and removes strictly
                // more jitter with no delay at all. Filtering twice is worse
                // than filtering once, in the direction nobody wants.
                api.resettle();

                // A reviewed frame speaks for the frames after it, up to the
                // next one reviewed. The dancer holds a shape for most of a
                // second, so a judgement made at one frame is about the whole
                // beat around it — and applying it to that beat is what keeps a
                // correction from arriving as a single-frame twitch.
                const judged = [...corrections.current.keys()].sort((a, b) => a - b);
                let corrected = 0;

                for (let i = 0; i < samples.length; i++) {
                  api.pose(samples[i].frame);

                  // The last review at or before this frame.
                  let governing: Critique | undefined;
                  for (const at of judged) {
                    if (at > i) break;
                    governing = corrections.current.get(at);
                  }
                  // Arm position first, on the rig: moving a hand is a change
                  // of where it ends up, not a rotation of any one joint.
                  if (governing) {
                    applyToRig(api, governing);
                    corrected++;
                  }

                  // A window straight into the clip's buffer — the pose is
                  // written where it belongs rather than copied there after.
                  api.snapshot(new Float32Array(clip.poses.buffer, i * DIMS * 4, DIMS));
                  clip.times[i] = samples[i].t;

                  // Then the joint-angle half, onto the pose just written.
                  if (governing) applyCritique(clip, i, governing);
                }
                clip.meta.duration = clip.times[samples.length - 1] ?? 0;

                // Which frames actually had a hand. Everywhere else the
                // fingers are sitting at rest because nothing was found, and
                // saying so is what lets the polish interpolate through the
                // gap instead of baking the rest pose into the take.
                const left = new Uint8Array(samples.length);
                const right = new Uint8Array(samples.length);
                for (let i = 0; i < samples.length; i++) {
                  left[i] = samples[i].frame.left ? 1 : 0;
                  right[i] = samples[i].frame.right ? 1 : 0;
                }

                const stats = polishClip(clip, { hands: { left, right } });
                // Plausibility last, so it judges the pose that actually ships.
                // Run before smoothing it would be checking poses the polish
                // was about to change anyway.
                const checks = validateClip(clip);
                // Last, and last for a reason: smoothing and clamping both move
                // joints, so a collision cleared before them can be pushed
                // straight back in. This is the pass whose result ships.
                const bodies = decollideClip(clip, (pose) => api.probe(pose));

                saveClip(clip, name)
                  .then(refreshLibrary)
                  .catch(() => setSaved("Saved to disk, but the library is unavailable."));

                const url = URL.createObjectURL(encodeClip(clip));
                const a = document.createElement("a");
                a.href = url;
                a.download = `${name}-${baked.fps}fps-${sex}.nvclip`;
                a.click();
                // Revoked late: revoking at once can cancel the download in
                // some browsers before they have read the blob.
                setTimeout(() => URL.revokeObjectURL(url), 10_000);

                // The loop left the figure on the last frame of the take.
                api.resettle();
                setSaved(
                  `Saved ${stats.frames} frames — jitter ${stats.jitterBefore}° → ` +
                    `${stats.jitterAfter}°, ${stats.outliers} outliers dropped, ` +
                    `${stats.filled} finger-frames filled, ` +
                    `${checks.clamped} out-of-range and ${checks.slowed} too-fast corrected, ` +
                    (corrected ? `${corrected} frames AI-corrected, ` : "") +
                    `${bodies.framesHit} frames un-clipped from the body` +
                    (bodies.framesUnresolved ? ` (${bodies.framesUnresolved} stubborn)` : "") +
                    `, ${(clipBytes(samples.length) / 1e6).toFixed(1)} MB`,
                );
              }}
              className={chip}
            >
              Save performance
            </button>
          )}
          <label className={`${chip} cursor-pointer`}>
            Import bake
            <input
              type="file"
              accept=".nvbake"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const saved = await decodeBake(f);
                  const result: Baked = {
                    fps: saved.fps,
                    quality: saved.quality,
                    smoothing: saved.smoothing,
                    despike: saved.despike,
                    samples: saved.samples.map(fromStored),
                    stats: { viaCrop: 0, viaFull: 0, ...saved.stats },
                  };
                  bakedRef.current = result;
                  corrections.current.clear();
                  setBaked(result);
                  setError(null);
                  setRestored(
                    `${f.name} — ${saved.stats.frames} frames, ${saved.quality} model, ${saved.fps} fps`,
                  );
                  // Kept, so the import survives the next reload too.
                  await saveBake(key, { ...saved, savedAt: Date.now() });
                } catch (err) {
                  setError(`Could not read that bake: ${err instanceof Error ? err.message : err}`);
                }
              }}
            />
          </label>
          {baked && (
            <button
              onClick={() => {
                deleteBake(key).catch(() => {});
                setBaked(null);
                bakedRef.current = null;
                corrections.current.clear();
                setReport(null);
                setRestored(null);
              }}
              disabled={!!progress}
              className={chip}
            >
              Discard bake
            </button>
          )}
          {baked && (
            <button
              onClick={async () => {
                const api = apiRef.current;
                const v = videoRef.current;
                if (!api || !v) return;

                // A second press stops the run rather than starting another.
                if (reviewing.current) {
                  reviewing.current = false;
                  return;
                }
                reviewing.current = true;
                v.pause();

                const samples = baked.samples;
                // Every reviewed frame is an API call and an upload, so this
                // walks the take rather than reading all of it. At stride 24 a
                // 24 fps clip is judged about once a second, which is roughly
                // as often as a dancer changes what she is doing.
                const stride = REVIEW_STRIDE;
                const total = Math.ceil(samples.length / stride);

                let judged = 0;
                let wrong = 0;
                let changed = 0;
                let failed = 0;
                const notes: string[] = [];

                for (let i = 0; i < samples.length && reviewing.current; i += stride) {
                  const sample = samples[i];

                  // The video has to actually be showing this frame before it
                  // can be read back, and seeking is asynchronous.
                  await new Promise<void>((done) => {
                    const onSeeked = () => {
                      v.removeEventListener("seeked", onSeeked);
                      done();
                    };
                    v.addEventListener("seeked", onSeeked);
                    v.currentTime = sample.t;
                  });

                  api.pose(sample.frame);
                  const frame = videoFrame();
                  if (!frame) continue;
                  const renders = api.capture();

                  let critique: Critique | null = null;
                  try {
                    const res = await fetch("/api/critique", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ frame, renders, label: `t=${sample.t.toFixed(2)}` }),
                    });
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error ?? res.statusText);
                    critique = json.critique as Critique;
                  } catch (err) {
                    failed++;
                    // One bad frame should not end a run that has already cost
                    // real money; three in a row means something structural.
                    if (failed >= 3) {
                      setReview(
                        `Stopped after ${failed} failures: ` +
                          (err instanceof Error ? err.message : String(err)),
                      );
                      reviewing.current = false;
                      break;
                    }
                    continue;
                  }

                  judged++;
                  if (critique.matches) {
                    setReview(`Reviewing ${judged}/${total} — ${wrong} to fix`);
                    continue;
                  }

                  wrong++;
                  if (critique.notes) notes.push(`${sample.t.toFixed(1)}s — ${critique.notes}`);

                  // Recorded against the frame it was made about, and
                  // replayed by the save. Applying it here would only paint the
                  // rig for a moment; the take is rebuilt from the landmarks
                  // every time it is written, so a correction has to survive
                  // until then to mean anything at all.
                  corrections.current.set(i, critique);
                  changed++;

                  // Shown as it goes, so a run is watchable rather than a
                  // progress counter. Discarded on the next frame, which is
                  // fine — the map above is what actually counts.
                  applyToRig(api, critique);
                  setReview(`Reviewing ${judged}/${total} — ${wrong} to fix`);
                }

                reviewing.current = false;
                setReview(
                  `Reviewed ${judged} of ${total} frames — ${wrong} did not match, ` +
                    `${changed} corrected, ${failed} failed. ` +
                    (notes.length ? `First note: ${notes[0]}` : "No notes."),
                );
              }}
              className={chip}
            >
              {review?.startsWith("Reviewing") ? "Stop review" : "AI review"}
            </button>
          )}
          <label className={`${chip} cursor-pointer`}>
            Load video
            <input type="file" accept="video/*" onChange={onFile} className="hidden" />
          </label>
        </div>

        {progress && (
          <div className="mt-4">
            <div className="h-1 w-full overflow-hidden rounded bg-foreground/10">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <p className="mono mt-2 text-[11px] uppercase tracking-[0.16em] opacity-60">
              {progress.done} / {progress.total} frames
            </p>
          </div>
        )}

        <div className="mono mt-6 grid gap-4 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
          <Panel title="This frame">
            {report ? (
              <>
                <Row k="Bones driven" v={String(report.solved)} />
                <Row
                  k="Landmark confidence"
                  v={`${Math.round(report.visibility * 100)}%`}
                  bad={report.visibility < 0.6}
                />
                <Row
                  k="Hands"
                  v={`${report.hands.left ? "L" : "–"} ${report.hands.right ? "R" : "–"}`}
                  bad={!report.hands.left || !report.hands.right}
                />
                <Row k="Worst bone" v={`${report.worst.toFixed(1)}°`} bad={report.worst > 5} />
              </>
            ) : (
              <p className="opacity-50">Nothing captured yet.</p>
            )}
          </Panel>

          <Panel title="Take coverage">
            {st ? (
              <>
                <Row k="Frames baked" v={String(st.frames)} />
                <Row k="Body found" v={pct(st.withPose)} bad={st.withPose < st.frames * 0.9} />
                <Row k="Left hand" v={pct(st.withLeft)} bad={st.withLeft < st.frames * 0.5} />
                <Row k="Right hand" v={pct(st.withRight)} bad={st.withRight < st.frames * 0.5} />
                <Row
                  k="Found by zoom"
                  v={
                    st.viaCrop + st.viaFull
                      ? `${Math.round((st.viaCrop / (st.viaCrop + st.viaFull)) * 100)}%`
                      : "—"
                  }
                  bad={st.viaCrop + st.viaFull > 0 && st.viaCrop < st.viaFull}
                />
              </>
            ) : (
              <p className="opacity-50">Bake the take to measure it.</p>
            )}
          </Panel>

          <Panel title="Take quality">
            {st ? (
              <>
                <Row
                  k="Mean confidence"
                  v={`${Math.round(st.meanVisibility * 100)}%`}
                  bad={st.meanVisibility < 0.7}
                />
                <Row
                  k="Worst retarget"
                  v={`${st.worstResidual.toFixed(1)}°`}
                  bad={st.worstResidual > 5}
                />
                <Row k="Sampled at" v={`${baked!.fps} fps`} />
                <Row k="On disk" v={`${(bakeBytes(st.frames) / 1e6).toFixed(1)} MB`} />
              </>
            ) : (
              <p className="opacity-50">Bake the take to measure it.</p>
            )}
          </Panel>

          <Panel title="Weak landmarks">
            {report ? (
              report.weak.length === 0 ? (
                <p className="opacity-50">All landmarks confident.</p>
              ) : (
                report.weak.map((w) => <Row key={w} k={w} v="weak" bad />)
              )
            ) : (
              <p className="opacity-50">—</p>
            )}
          </Panel>
        </div>

        {/*
          The library. Every saved performance lives here rather than only in
          the downloads folder, because a tutorial nobody can find again is not
          a tutorial — and because a clip plays back without its video, which
          is the whole point of having saved the figure rather than the frames.
        */}
        <section className="mt-8">
          <h2 className="mono text-[11px] uppercase tracking-[0.16em] opacity-60">
            Saved tutorials
          </h2>

          {library.length === 0 ? (
            <p className="mt-3 text-sm opacity-50">
              Nothing saved yet. Bake a take, then press Save performance.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {library.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-lg border border-foreground/10 bg-foreground/[0.03] p-3"
                >
                  <p className="truncate text-sm font-medium" title={entry.name}>
                    {entry.name}
                  </p>
                  <p className="mono mt-1 text-[10px] uppercase tracking-[0.12em] opacity-50">
                    {entry.meta.count} frames · {entry.meta.duration.toFixed(1)}s ·{" "}
                    {entry.meta.fps} fps · {entry.meta.sex} ·{" "}
                    {(entry.bytes / 1e6).toFixed(1)} MB
                  </p>
                  <p className="mono mt-0.5 text-[10px] uppercase tracking-[0.12em] opacity-35">
                    {new Date(entry.meta.savedAt).toLocaleString()}
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      onClick={() => (playing === entry.id ? stopPlayback() : playClip(entry))}
                      className={chip}
                    >
                      {playing === entry.id ? "Stop" : "Play"}
                    </button>
                    <button
                      onClick={() => {
                        if (playing === entry.id) stopPlayback();
                        deleteClip(entry.id).then(refreshLibrary).catch(() => {});
                      }}
                      className={chip}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-foreground/10 p-4">
      <h2 className="mb-3 text-[10px] uppercase tracking-[0.2em] opacity-60">{title}</h2>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ k, v, bad = false }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="opacity-70">{k}</span>
      <span className={bad ? "text-red-400" : "text-emerald-400"}>{v}</span>
    </div>
  );
}
