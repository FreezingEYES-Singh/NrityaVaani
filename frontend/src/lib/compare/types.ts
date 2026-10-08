/**
 * Shared types for /compare (the "Compare with teacher" feature).
 *
 * This file is the contract between the pieces of the feature:
 *
 *   extract.ts   browser-only: video -> PoseTrack (MediaPipe, on device)
 *   analyze.ts   pure: (teacher PoseTrack, student PoseTrack) -> CompareResult
 *   habits.ts    pure: student PoseTrack alone -> SoloResult (YouTube mode)
 *   store.ts     browser-only: IndexedDB for teacher steps (never student video)
 *   components/compare/*  the UI
 *
 * The design these implement is docs/video-compare/05-mvp.md (Phase 1) and
 * docs/video-compare/03-design.md §8 (YouTube "practise beside").
 *
 * Pure modules (everything except extract/store/landmarker and the UI) must not
 * touch the DOM, must not import three.js, React or MediaPipe, and must use
 * relative imports with explicit `.ts` extensions so that Node can run their
 * tests directly (`node --experimental-strip-types --test`).
 */

/** The alignment grid. Both tracks are resampled to this before matching. */
export const GRID_FPS = 15;

/** MediaPipe pose landmark indices used by this feature (33-point BlazePose topology). */
export const LM = {
  NOSE: 0,
  L_EYE: 2,
  R_EYE: 5,
  L_EAR: 7,
  R_EAR: 8,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT: 31,
  R_FOOT: 32,
} as const;

export const LANDMARK_COUNT = 33;

/**
 * One landmark.
 *
 * - In `img`: x and y are in units of the frame HEIGHT (so x runs 0..aspect,
 *   y runs 0..1, y down). Using one unit for both axes keeps 2D angles true.
 *   z is MediaPipe's relative depth, also scaled by height; treat as unreliable.
 * - In `world`: metres, hip-centred, MediaPipe's world landmarks (y down).
 * - `v` is MediaPipe's visibility in 0..1.
 */
export interface Pt {
  x: number;
  y: number;
  z: number;
  v: number;
}

/**
 * One hand: the 21 MediaPipe hand landmarks (wrist 0, thumb 1-4, index 5-8,
 * middle 9-12, ring 13-16, pinky 17-20).
 */
export interface HandFrame {
  /** Image landmarks, in the same units as Pt (x and y in units of the frame height). */
  img: Pt[];
  /** Metres, centred on the hand (MediaPipe hand world landmarks), or null. */
  world: Pt[] | null;
}

/** The dancer's hands in one frame: `l` is found at the pose's left wrist (15), `r` at the right (16). */
export interface Hands {
  l: HandFrame | null;
  r: HandFrame | null;
}

/** One processed video frame. */
export interface PoseFrame {
  /** Media time in seconds (from requestVideoFrameCallback metadata.mediaTime, or the seek target). */
  t: number;
  /** 33 image landmarks (see Pt), or null when no dancer was found in this frame. */
  img: Pt[] | null;
  /** 33 world landmarks, or null. */
  world: Pt[] | null;
  /**
   * False when the frame must not be judged: the identity pass says the tracked
   * body is not the chosen dancer, the frame was blank, or the sample is doubtful.
   * A frame with `img === null` is always treated as masked.
   */
  ok: boolean;
  /** The hands, when the hand pass ran (tracks saved before it existed have none). */
  hands?: Hands;
}

/** The pose track of one video over one time range. Produced by extract.ts. */
export interface PoseTrack {
  frames: PoseFrame[];
  /** Video frame size in pixels (after rotation). */
  width: number;
  height: number;
  /** The processed range of the source video, seconds. */
  range: [number, number];
  /** Frames actually processed per second of video (for honest UI and tests). */
  effectiveFps: number;
  /** Warnings collected during extraction (e.g. second person present). Plain sentences. */
  warnings: string[];
}

/** Body-part switches the user controls. A part that is off is neither aligned on nor judged. */
export interface PartSwitches {
  arms: boolean;
  legs: boolean;
  torso: boolean;
  head: boolean;
  /** Hand shapes (fingers, mudras). Never used for aligning, only judged. */
  hands: boolean;
}

export const ALL_PARTS_ON: PartSwitches = { arms: true, legs: true, torso: true, head: true, hands: true };

/** Body parts judged from the pose. */
export type Part = "arms" | "legs" | "torso";
/** Everything a tip can be about. */
export type TipPart = Part | "hands";

export type StepKind = "movement" | "posture" | "hold";

export type BandLevel = "close" | "getting" | "needs" | "partly" | "na";

export interface Band {
  level: BandLevel;
  /** E.g. "Partly checked: side tilt only (forward lean needs a side view)". */
  note?: string;
}

/** Where to point on screen for "Show me". */
export interface JointMarker {
  /** Landmark indices to highlight (the limb is drawn thick, the end joint gets a ring). */
  joints: number[];
  /** The same joints on the teacher (they differ from `joints` when the student was compared mirrored). */
  teacherJoints?: number[];
  /**
   * Direction the student should move the end joint, in image units (x right,
   * y down), roughly unit length. Null when there's no meaningful direction.
   */
  arrow: { dx: number; dy: number } | null;
}

export interface Tip {
  /** Stable id, e.g. "arm-height:low", "knee-rollin", "bobbing", "range:arms", "hand:ring". */
  id: string;
  part: TipPart;
  /** Short imperative headline, e.g. "Raise your arms higher". */
  title: string;
  /** One or two sentences of evidence and how to fix it. Never uses left/right unless `sideKnown`. */
  detail: string;
  /** Higher = more important. Used for ordering only, never shown as a number. */
  severity: number;
  /** For "Show me": the worst moment, in seconds of each video (teacher null in solo mode). */
  at: { student: number; teacher: number | null };
  marker: JointMarker;
  /** All Phase 1 tips are beta until calibration. */
  beta: true;
}

export interface Strength {
  part: Part;
  text: string;
}

/** A found occurrence of the teacher's step inside the student's video. */
export interface TryMatch {
  /** Student time span, seconds. */
  start: number;
  end: number;
  /** Normalised matching cost (lower is better). */
  cost: number;
}

/** A cut pause or a masked transition, for the timeline. */
export interface Pause {
  who: "teacher" | "student";
  start: number;
  end: number;
}

/** Monotonic mapping from student time to teacher time, for synced playback and the ghost. */
export interface TimeMapPoint {
  s: number;
  t: number;
}

export interface CompareResult {
  kind: StepKind;
  /** Was the teacher's step (or posture) found in the student's video? */
  found: boolean;
  /** "full" = whole step matched; "partial" = only part of the step; "none" = not found. */
  reading: "full" | "partial" | "none";
  /** Share of the teacher's step covered, 0..1 (1 for a full reading). */
  coverage: number;
  /** True when the student was compared mirrored (left/right swapped). */
  mirrored: boolean;
  tries: TryMatch[];
  pauses: Pause[];
  /** The separate Timing line. ratio = student duration / teacher duration (>1 = slower). */
  timing: { ratio: number | null; text: string | null };
  /** Up to 3, ordered by severity, at most one per part. */
  tips: Tip[];
  strength: Strength | null;
  bands: Record<Part | "timing", Band> & { hands?: Band };
  /** Reasons things were not judged, as plain sentences ("Knees hidden in 70% of frames, so legs were partly checked."). */
  notChecked: string[];
  /** Plain-sentence warnings (different camera angle, second person, mostly-still selection...). */
  warnings: string[];
  /** For synced playback and the ghost. Empty when not found. */
  map: TimeMapPoint[];
  /** Human message when not found, e.g. "We couldn't find the teacher's step in your video." */
  message: string | null;
}

/** One step of a class-mode comparison: a stretch of the student's dancing and where the class shows it. */
export interface LessonStep {
  /** Seconds of the student's video. */
  student: [number, number];
  /** Seconds of the teacher's (class) video. */
  teacher: [number, number];
  /** The usual comparison of this stretch: tips, bands, timing and the time map. */
  result: CompareResult;
}

/** Class mode: the student's dance, found step by step in a long class video. */
export interface LessonResult {
  steps: LessonStep[];
  /** Stretches of the student's dancing found nowhere in the class video. */
  unmatched: [number, number][];
  /** Dancing in the class video (body or footwork, not gestures while talking) not found in the student's video. */
  missed: [number, number][];
  /** Human message when nothing was found. */
  message: string | null;
  warnings: string[];
}

/** Reference-free result for YouTube "practise beside" mode (never compared with the YouTube video). */
export interface SoloResult {
  tips: Tip[];
  notChecked: string[];
  warnings: string[];
  /** Always shown: "General posture habits: not compared with a teacher." */
  label: string;
}

/** Progress reported by extract.ts. */
export interface ExtractProgress {
  stage: "loading-model" | "checking" | "processing" | "done";
  /** 0..1 */
  fraction: number;
  /** Seconds left, when known. */
  etaSec: number | null;
  /** Plain sentence for the UI, e.g. "Slowed to 0.5× so every frame gets processed". */
  message: string | null;
}

/** Raised by extract.ts with a user-facing message. */
export type ExtractErrorCode =
  | "model-failed"
  | "codec"
  | "no-person"
  | "aborted"
  | "playback-blocked"
  | "too-short";

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  constructor(code: ExtractErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ExtractError";
  }
}

/* ------------------------------------------------------------------------
 * Module APIs (the signatures each module must export). Kept here as
 * documentation so the pieces can be built in parallel.
 *
 * analyze.ts (pure)
 *   export function analyze(teacher: PoseTrack, student: PoseTrack, parts: PartSwitches): CompareResult
 *   export function teacherStepKind(teacher: PoseTrack): { kind: StepKind; motion: number; stillShare: number }
 *
 * habits.ts (pure)
 *   export function analyzeSolo(student: PoseTrack, parts: PartSwitches): SoloResult
 *
 * extract.ts (browser)
 *   export function primeVideo(video: HTMLVideoElement): void
 *     // call synchronously inside a click handler, before any await (iPhone Low Power Mode)
 *   export async function extractPose(
 *     video: HTMLVideoElement,           // a <video> already showing the file (muted is set by extract)
 *     range: [number, number],           // seconds
 *     opts: { onProgress?: (p: ExtractProgress) => void; signal?: AbortSignal },
 *   ): Promise<PoseTrack>
 *   export async function preloadModels(onProgress?: (p: ExtractProgress) => void): Promise<void>
 *   export const MODEL_DOWNLOAD_MB: number // shown to the user before first use
 *
 * store.ts (browser, IndexedDB "nrityavaani-compare")
 *   export async function fingerprint(file: File, range: [number, number]): Promise<string>
 *   export async function saveTeacherStep(key: string, track: PoseTrack, meta: { name: string; session: boolean }): Promise<void>
 *   export async function loadTeacherStep(key: string): Promise<PoseTrack | null>
 *   export async function listSavedSteps(): Promise<{ key: string; name: string; savedAt: number; range: [number, number] }[]>
 *   export async function deleteSavedSteps(): Promise<void>        // "Delete saved steps"
 *   export async function sweepSessionSteps(maxAgeMs?: number): Promise<void> // session copies older than 2 h
 *   export function rememberSessionStep(key: string): void      // sessionStorage pointer for reload restore
 *   export function sessionStepKey(): string | null
 *
 * ../youtube/parse.ts (pure)
 *   export function parseYouTube(input: string): { id: string; start: number | null; shorts: boolean } | null
 * ---------------------------------------------------------------------- */
