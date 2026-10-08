# Video compare feature: codebase reuse map

# NrityaVaani: map of existing code a reference-vs-student comparison feature can reuse

I read the repo at HEAD `1494ea6` and the deleted code at `287aba3` (both under /home/user/NrityaVaani) and changed nothing. Paths below are relative to `frontend/src` unless marked otherwise.

---

## 0. Summary

| Piece | Path | Status today | Verdict |
|---|---|---|---|
| Landmark types, `P`/`H` indices | `components/three/retarget.ts` | Live | Use as-is. This is the shared data model. |
| Track cleaning (`despikeTrack`, `stabiliseTrack`, `smoothTrack`, `measureSkeleton`, `enforceSkeleton`) | same | Live, but its only caller was the deleted mocap page | Use as-is on world-landmark tracks. Re-tune before using on screen coordinates. |
| `retarget(mesh, frame)` plus `MocapFigure` (`pose`, `snapshot`, `show`) | `retarget.ts`, `components/three/MocapFigure.tsx` | Live. The lesson player uses only `show()`. | Use it to drive a 3D figure from landmarks and to turn landmarks into rig rotations. |
| `encodePose`, `poseError`, `JOINTS`, `groupOf`, `PoseSmoother` | `lib/motion/poseCodec.ts`, `skeleton.ts`, `smooth.ts` | Live | Use for per-joint angle error in degrees that does not depend on body size. |
| `decodeClip`, `samplePose`, the published lessons | `lib/motion/clip.ts`, `lib/lesson/manifest.ts`, `public/lessons/*` | Live | Use. The two existing lessons are ready-made references that already have steps and cues. |
| `segmentTrack` | `lib/lesson/segment.ts` | Unused, no dependencies | Adapt: scale its threshold by fps, and pass upper-body joints for mudra-only videos. |
| Authoring `Lesson` type and its IndexedDB store | `lib/lesson/lesson.ts` | Unused | Optional: storage for references users make themselves. |
| Key-point prompt | `lib/lesson/keypoints.ts` | Unused; it is an LLM prompt | Don't use, except its writing-style rules. |
| Mudra classifiers | `lib/mediapipe/classification.ts` | Live (`/live`, `/practice`, `/upload`) | Adapt. Its distance thresholds depend on how big the hand is in the frame. |
| Mudra tip text | `lib/constants/mudras.ts` | Live | Use. All 28 mudras have `instructions` and `commonMistakes`. |
| `CameraFeed` | `components/live/CameraFeed.tsx` | Live | Copy the pattern only (webcam, hands only). |
| Upload page | `app/upload/page.tsx` | Live | Copy the pattern only. The `/upload` route is already taken by the image mudra reader. |
| `LessonPlayer` | `components/learn/LessonPlayer.tsx` | Live | Copy or extract its single clock, step list, cue card and scrubber markers. |
| `GuruAudioEngine` and personas | `lib/voice/*` | Live | Use for spoken tips, with the caveats in section 7. |
| Backend | `backend/main.py`, `backend/core/*` | Live, Render free tier | Speech only. Don't process video there. |
| `StatsService` | `lib/services/StatsService.ts` | Live | Adapt: it needs a session "kind" or a separate key. |
| Deleted bake pipeline | `git show 287aba3:frontend/src/app/mocap/page.tsx` | Deleted | Restore the core functions into a library module. |
| Deleted bake storage | `git show 287aba3:frontend/src/lib/mocap/bakeStore.ts` | Deleted | Restore almost verbatim. |
| Deleted `polish`, `validate`, `collide`, `clipStore` | `287aba3:frontend/src/lib/motion/*` | Deleted | Probably not needed; `polishClip` only if comparing in rotation space. |
| Deleted `critic.ts` and `/api/critique` | `287aba3` | Deleted | Don't restore: the route uploaded frames. Its PARTS/ISSUES/SEVERITIES word list is a good tip taxonomy. |

---

## 1. Shared data model: `components/three/retarget.ts` (1133 lines)

**Exports**
```ts
export const P = { NOSE:0, L_EAR:7, R_EAR:8, L_SHOULDER:11, R_SHOULDER:12, L_ELBOW:13, R_ELBOW:14,
  L_WRIST:15, R_WRIST:16, L_HIP:23, R_HIP:24, L_KNEE:25, R_KNEE:26, L_ANKLE:27, R_ANKLE:28,
  L_HEEL:29, R_HEEL:30, L_FOOT:31, R_FOOT:32 } as const;   // pose points 1-6, 9-10, 17-22 are not named
export const H = { WRIST:0, THUMB_CMC:1 … PINKY_TIP:20 } as const;
export interface Landmark { x: number; y: number; z: number; visibility?: number }
export interface HandFrame { world: Landmark[]; screen?: Landmark[] }   // world: metres, origin at hand centre
export interface Frame { pose: Landmark[]|null; poseScreen: Landmark[]|null; left: HandFrame|null; right: HandFrame|null }
export interface Residual { bone: string; error: number /*deg*/ }
export interface Report { solved; driven: Set<string>; missing: string[]; residuals: Residual[]; worst; visibility; weak: string[]; hands:{left,right}; contact: boolean }
export type Skeleton = Record<string, number>;
export function despikeTrack(track: (Landmark[]|null)[], radius=2, k=3, floor=0.02): (Landmark[]|null)[]
export function smoothTrack(track, radius: number)                       // no default value
export function stabiliseTrack(track, radius=3, noise=0.004, motion=0.02, perFrameScale=1)
export function measureSkeleton(track): Skeleton
export function enforceSkeleton(track, confidence: (number[]|null)[], skeleton: Skeleton, iterations=12)
export function boneMap(mesh: THREE.SkinnedMesh): Map<string, THREE.Bone>
export function rest(mesh): Map<THREE.Bone, THREE.Quaternion>
export function retarget(mesh: THREE.SkinnedMesh, frame: Frame): Report
```

**What the track functions do**
- **`despikeTrack`**: a Hampel filter that removes single-frame tracker spikes. It works per landmark: median of the neighbours, and median absolute deviation measured as a 3D distance. A spike is replaced by the median point. `floor` is in track units: metres for world landmarks.
- **`stabiliseTrack`**: holds a joint still when its median per-frame step is below `noise`, leaves it alone above `motion`, and crossfades between the two with a smoothstep. The thresholds are in metres per frame; `perFrameScale` adjusts them for sample rate. The deleted page passed `12/fps`, so the defaults were tuned at 12 fps.
- **`smoothTrack`**: a centred triangular window, so it adds no lag.
  - A `null` frame stays `null` rather than being interpolated, so any comparison needs its own gap handling.
  - Visibility is carried through unsmoothed.
- **`measureSkeleton` / `enforceSkeleton`**: take the median bone length over the whole take, average mirrored pairs, then run a Gauss-Seidel distance-constraint relaxation. Joints with low confidence absorb the correction, and each frame is re-centred on the hips. They only cover the pose's 14 segments (shoulders, hips, sides, upper arms, forearms, thighs, shins, feet), not the head or hands.

**Limits**
- The module imports `three` and `figureConstraints.boneKey`. The track functions only use `THREE.MathUtils.clamp`, but importing them still pulls in three.
- All thresholds assume world landmarks: metres, origin between the hips.

**How it plugs in**
- `Frame` and `Landmark` are the right shapes for a baked reference or student track. Use the same type for both videos.
- World landmarks already remove camera distance and position. The hip-centred origin also means a dancer walking across the stage shows no translation.
- To compare two dancers, compare bone direction vectors rather than raw points. That removes body-proportion differences. The `BODY` list inside `retarget.ts` already names the from/to landmark pairs per bone, but it is not exported.
- The residual block at the end of `retarget()` shows the angle-between-directions maths a comparison would need.

**What `retarget()` adds**
- It aims bones parent-first, gives the pelvis an absolute orientation, aims the neck between the ears, and orients each palm from the plane of the wrist and index/pinky knuckles.
- `closeContact` closes two-handed mudras when the image shows the wrists touching, within 0.1 shoulder-widths. This needs `frame.left.screen` and `frame.right.screen`.
- It never clamps to joint limits, by design.

---

## 2. Comparing on the 3D rig: `MocapFigure` plus `lib/motion/*`

### `components/three/MocapFigure.tsx` (1106 lines; default export, client only)

Props: `{ sex?: "female"|"male" = "female", showSkeleton?=true, showBody?=true, steady?=true, showOverlayControls?=true, onReady?: (api: MocapApi) => void, className? }`

```ts
interface MocapApi {
  pose(frame: Frame, t?: number): Report;   // retarget + One Euro filter (only when steady && t given) + ground + overlay
  resettle(): void;                          // clear the filter history; call after a seek
  clear(): void;
  snapshot(out?: Float32Array): Float32Array | null;  // encodePose(mesh) → 204 floats
  show(pose: ArrayLike<number>): void;       // play a stored pose vector; this is what LessonPlayer uses
  probe(pose): Violation[];                  // collision check against the real mesh
  capture(yaws?: number[] = [0,60,-60]): string[];   // JPEG data URLs; built for the vision model, avoid
  fitToScreen(): void;
  focusPreset(p: "full"|"face"|"mudras"|"feet"): void;
  shiftHand(side: "L"|"R", delta: THREE.Vector3): void;
}
```

How it behaves:
- It must be loaded with `next/dynamic` and `{ ssr:false }`, as LessonPlayer does.
- Each instance creates its own `WebGLRenderer` (`preserveDrawingBuffer:true`), always adds the `DanceStudioRoom` scene, and loads `public/models/figures.glb` (697 KB, cached by `loadFigures()`).
- Each frame it grounds the figure by its lowest foot. After 0.25 s with no new pose, the chest "breathes" slightly.
- The bone overlay only has two colours: driven `#ff9933` and idle `#3a3a3a` (`userData.update(driven: Set<string>)`). Colouring bones by error would need a small change.
- One mesh per instance. Showing a reference "ghost" next to the student means two instances, which is two WebGL contexts on top of MediaPipe's GPU context. That is heavy on phones.

### `lib/motion/poseCodec.ts`
- `PER_JOINT = 4` and `DIMS = 204`.
- `encodePose(mesh, out?)` stores each joint as a quaternion relative to its rest pose.
- `decodePose(v, mesh, { amount=1 })`.
- **`poseError(a, b): number[]`** returns the angle in degrees per joint (51 values). It uses `|dot|`, so q and −q count as the same rotation.

### `lib/motion/skeleton.ts`
- `JOINTS` is 51 joints: spine 5 (Pelvis, Belly, Chest, Neck, Head), arms 8 (Collar, UpperArm, Forearm, Palm × L/R), fingers 30, legs 8 (Hip, Shin, Foot, Toes × L/R).
- Each `Joint` is `{ key, stem, side, group: "spine"|"arm"|"hand"|"leg", dof, limit }`.
- Also exports `INDEX`, `JOINT_COUNT`, `LAYOUT = 1`, and `groupOf(group): number[]`.

### `lib/motion/smooth.ts`
- `class PoseSmoother` is a One Euro filter on joint rotations. Options: `minCutoff 1.2`, `beta 0.06`, `dCutoff 1`. Methods: `set`, `reset`, `feed(t, count, read, write)`.
- It is causal (only looks backwards), so it suits live display. An offline comparison should not use it.

### `lib/motion/clip.ts` (`.nvclip` format)
- File layout: `"NVC1"` + u32 header length + JSON `ClipMeta {layout, dims, count, fps, duration, sex, source, savedAt, joints[]}` + `times: f32[count]` + `poses: f32[count*204]`.
- Exports: `emptyClip`, `encodeClip`, `decodeClip(blob)` (rejects files with a different joint layout), `samplePose(clip, t, out)` (slerps between frames), `toAnimationClip`, `clipBytes`.
- A clip stores rotations only, with no root motion.

### How the rig path plugs in
The pipeline: bake landmarks → for each frame, `retarget(mesh, frame)` → `encodePose(mesh)` → `poseError(ref, student)` → aggregate with `groupOf('arm'|'hand'|'leg'|'spine')` and by side.

This is independent of body size and camera distance.

Its biggest advantage: it is the same representation as the published lessons. **`public/lessons/namaskaram.*` and `thattadavu.*` (15 fps; thattadavu is 341.65 s with 11 steps, each with `cues[]`, plus 30 spoken lines with Hindi text) can be references without processing any reference video.** Load them the way LessonPlayer does: `loadManifest` → fetch → `decodeClip` → `samplePose`.

Caveats:
- **Rig access.** Today the rig is only reachable through a mounted `MocapFigure`'s `onReady`. A headless solver needs a small new helper: `loadFigures()` → `makeFigure(source, sex).mesh` → `retarget` → `encodePose`. None of these need a renderer.
- **Missing hands.** Frames with no hand detected leave the 15 finger joints at rest. That shows up as a large false error, so mask those frames, as the deleted `polish.ts` did with its `hands` flags.
- **Camera angle.** The Pelvis orientation is absolute, so a student filmed from a different angle differs by pelvis yaw. Exclude Pelvis, or compare relative to it.
- **Figure choice.** A lesson ships one take per figure (`clips.female` / `clips.male`), because rotations from one body don't land the same on the other. Solve the student on the same figure as the clip being compared (`clipFor(manifest, sex)`).

---

## 3. Splitting a video into steps: `lib/lesson/segment.ts`, `lesson.ts`, `keypoints.ts`, `manifest.ts`

### `segment.ts` (198 lines, no dependencies, unused)
```ts
interface TrackPoint {x,y,z,visibility?}; type Track = (TrackPoint[]|null)[];
interface SegmentOptions { fps: number; still?: number /*0.008 m/frame*/; minPause?: number /*0.35 s*/; minStep?: number /*0.6 s*/; joints?: number[] /*[23,24,25,26,27,28,31,32]*/ }
interface Segment { index, startFrame, endFrame /*exclusive*/, startTime, endTime, duration, coverage, peakSpeed }
function segmentTrack(track: Track, opts: SegmentOptions): Segment[]
function stepName(index: number): string   // "Step N"
```

How it works:
- It measures the mean frame-to-frame movement of the chosen joints and treats stillness, or missing frames, as pauses.
- Pauses at the very start and end are trimmed; interior pauses at least `minPause` long become cuts.
- A cut is only kept if it leaves at least `minStep` on both sides.
- It returns one segment if there are no pauses, and `[]` if there is no motion at all.

Limits:
- **fps.** `still` is in metres per frame and is not scaled by fps (unlike `stabiliseTrack`). The fallback fps of 10 suggests it was tuned at 10 fps, so scale it with something like `0.008 * 10 / fps`.
- **Mudra-only videos.** It only looks at the lower body by default. A seated, hands-only video reads as "always still" and returns `[]`. Pass wrist and hand indices through `joints`.
- **Hips.** World landmarks are centred on the hips, so the hip points barely move. Jumps and travel only register through leg bending.
- **Missing tests.** The header says it is tested by `tools/lesson/segment.mjs`, but that file does not exist in this repo. The studio moved to its own app (`app/lesson/page.tsx` just redirects).

How it plugs in: run it on the reference track to propose steps, then align the student to those steps.

### `lesson.ts` (unused)
- `LessonStep {id, index, name, startFrame, endFrame, startTime, endTime, duration, coverage, peakSpeed, transcript?, keyPoints: string[], focus?}`
- `Lesson {id, name, source, fps, steps, createdAt, savedAt}`
- Functions: `newId()`, `emptyLesson(name, source, fps)`, `encodeLesson`/`decodeLesson` (`"NVL1"` + JSON), `normaliseLesson`
- IndexedDB `nrityavaani-lessons/lessons`: `saveLesson`, `listLessons`, `loadLesson`, `deleteLesson`

It could hold references the user creates (a YouTube or uploaded video cut into steps). **There are two different `LessonStep` types**, one here and one in `manifest.ts`.

### `keypoints.ts` (unused)
An LLM vision prompt (`buildKeypointSystem`, `keypointUserText`, `KEYPOINT_SCHEMA`, `parseKeypoints`). The route that called it is gone. Only its style rules are worth keeping for rule-based tips:
- three points, most important first;
- name the body part ("hand, arm, knee, foot, gaze");
- write in plain language for the student.

### `manifest.ts` (published lessons, live)
- `LessonStep {start, end, name, gloss, cues[]}`
- `Language = "en"|"hi"|"hing"|"ta"|"te"|"ml"|"sa"|"kn"|"bn"`, plus `SUPPORTED_LANGUAGES`
- `SpokenLine {start, end, text, textHi?, textHing?, textTa?, textTe?, textMl?, textSa?, textKn?, textBn?}`
- `LessonManifest {slug, title, subtitle, dance?, part?, clip, clips?, duration, fps, sex, steps, lines, voice?}`
- Helpers: `lineText`, `clipFor`, `readingFor`, `danceOf`, `byPart`, `partCount`, `loadManifest(slug, signal)`, `loadVoice`, `stepAt(steps, t)`, `lineAt(lines, t)`, `linesIn(lines, step)`

`lib/lesson/store.ts` is server-only (`node:fs`), and `/api/lessons/import` writes into `public/lessons`. That only works locally; Netlify's function filesystem is not durable. **Anything users create must be stored in the browser (IndexedDB).**

---

## 4. Mudra classifiers: `lib/mediapipe/classification.ts` (624 lines)

```ts
interface Point {x,y,z}; interface MudraScore {name; confidence /*0-1*/; feedback}
calculateDistance(p1, p2): number
getFingerExtensionScore(landmarks, [mcp,pip,dip,tip]): number   // straight-line / path length; does not depend on scale
classifyMudra(landmarks: Point[], _handedness?): MudraScore     // "No Mudra Detected" when the best score is ≤ 0.5
getSpecificMudraScore(landmarks, targetSlug, handedness): MudraScore   // 18 lowercase slugs, otherwise confidence 0
classifySamyuktaMudra(hand1, hand2): MudraScore | null
```

Coverage:
- Single-hand: 18 mudras — Pataka, Tripataka, Ardhapataka, Kartarimukha, Mayura, Arala, Shukatunda, Mushti, Shikhara, Suchi, Chandrakala, Padmakosha, Ardhachandra, Sarpashirsha, Simhamukha, Mukula, Trishula, Alapadma.
- Two-hand: 8 — Anjali, Kapota, Karkata, Swastika, Shivalinga, Pushpaputa, Matsya, Garuda.
- `mudras.ts` lists 28 (18 single-hand, 10 two-hand), so 2 two-hand mudras are unsupported.
- `types.ts` defines `MudraReading`, `HandReading` (with `handedness`, `isTarget?`), `FrameLandmarks` and `FrameHandler`.

**Main limitation:**
- **Absolute thresholds.** There are 26 absolute distance thresholds, such as `distThumbIndex < 0.12`, `distThumbRing < 0.05`, `distIdxMid > 0.08` and `distWrists < 0.1`. They are in image-normalised units, tuned for a close-up webcam hand.
- **Full-body video.** In full-body video the hand is a few percent of the frame, so every "touching" test passes and every "spread" test fails.
- **Non-square frames.** Normalised x/y on a non-square frame are also distorted (x is divided by width, y by height).
- **World landmarks don't fit either.** Hand world landmarks are in metres and don't match the thresholds.

Fix: feed it the landmarks from the 256×256 hand crop (section 10, before `unCrop`), or divide distances by palm size (wrist to middle knuckle).

Other notes:
- Handedness is ignored.
- There is no smoothing over time.
- The `feedback` strings are short per-mudra tips; some depend on which finger is wrong (for example "Keep index and pinky straight.").

How it plugs in: for each step, classify the reference and student hands on held frames and take the most common result. Compare names, then add tip text from `getSpecificMudraScore(...).feedback` and from `mudras.ts`.

**`lib/constants/mudras.ts`**: 28 entries `{id, slug, name, category, meaning, difficulty, meaningLong, significance, instructions, commonMistakes, image}`. All 28 have `instructions` and `commonMistakes`, which can be used directly as tip text.

The Python `backend/core/classification.py` is an older subset covering 8 mudras. Ignore it.

---

## 5. Capture and UI patterns

### `components/live/CameraFeed.tsx`
- Props: `{ isActive, onUpdate: FrameHandler, targetMudra?, showLandmarks?=true, showSkeleton?=true }`.
- **Hands only:** HandLandmarker (VIDEO mode, `numHands: 2`, GPU), WASM pinned at `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm`, model from `storage.googleapis.com/.../hand_landmarker/float16/1/hand_landmarker.task`.
- Webcam at 1280×720, front-facing. A `requestAnimationFrame` loop calls `detectForVideo(video, performance.now())`.
- The video and canvas are both `object-cover` and both mirrored with CSS `scaleX(-1)`.
- It stops on `visibilitychange`.
- Not reusable for files (it only uses `getUserMedia`, and has no pose model or `MediaRecorder`). It is the template if the student records with a webcam instead of uploading.

`components/live/HandOverlay.tsx` (a canvas hand overlay with lerp smoothing) is **not imported anywhere**. `JointsGrid` and `PredictionPanel` are used by `/live`.

### `app/upload/page.tsx`
- Reads a mudra from a still photo with HandLandmarker in IMAGE mode, `MAX_BYTES` 10 MB.
- Reusable patterns:
  - model state `"loading"|"ready"|"failed"`, with the failure shown on the page;
  - revoking the object URL in an effect;
  - a dashed dropzone button;
  - copy that says plainly "the file is not uploaded".

### `components/learn/LessonPlayer.tsx` (1006 lines)
- One wall clock drives everything: `tick()` → `applyTime(t)` updates the figure via `api.show(samplePose(...))`, plus the scrubber, clock text, step (`stepAt`) and caption (`lineAt`), with fast-changing values written straight to the DOM.
- Controls: speed `[0.5, 1]`, "Loop step" and "Restart step", step boundary ticks on the scrubber at `(s.start/duration)*100%`, and keyboard Space and arrow keys.
- The aside has an `<ol>` of step buttons (`clock(start)` + name), a card for the current step (`gloss`, `cues[]` as bullet points, and "in her words" from `linesIn`), and language and persona menus.
- Class constants `chip`, `chipOn`, `chipOff`.
- None of this is split into separate components; it is all inline JSX. To reuse it, extract the pieces or copy the pattern.

---

## 6. Voice for spoken tips: `lib/voice/*`

- `GuruAudioEngine(personaId="hi_meera", lang="en", {volume, muted, rate, onSpeakingChange, onLoadingChange})`.
- Methods: `setPersona`, `setLanguage`, `setVolume`, `setMuted`, `setRate`, `stop()`, `async syncLine(lineStart, lineDuration, text, currentPlaybackTime)`, `preloadLanguage(lines: SpokenLine[])`.
- It POSTs `{text, persona, lang, speed}` to `${API_BASE}/api/tts/speak`. `API_BASE` is `NEXT_PUBLIC_BACKEND_URL`, or the onrender URL on `*.netlify.app`, or `""` (which goes through the Next rewrite).
- Audio is cached in memory under `persona:lang:text`. If the response isn't audio or the request fails, it falls back to Web Speech.

`guruPersonas.ts`: `GuruPersona`, `GURU_PERSONAS` (15), `getPersona`, `getDefaultPersonaForSex`, `getBestPersonaForLanguage(lang, sex)`, `getVoiceModelsForLanguage(lang)`.

Caveats for tips:
- **No `speak(text)` method.** Call `syncLine` with a unique key per tip (use the tip index as `lineStart`). Pass a generous `lineDuration`, because the engine speeds audio up to 1.25× to fit the slot when the slot is over 1 s.
- **No translation.** `lang` only picks the voice. Hindi or Tamil tips need pre-written translations, for example `SpokenLine`-style objects with `textHi` and so on.
- **Cold starts.** `fetch` has no timeout, so a Render cold start (about 30 s or more) delays the first tip. Preload the tips once the results are computed.
- `/live` and `/practice` use their own `window.speechSynthesis` helper, not this engine.

---

## 7. Backend: `backend/main.py` and `backend/core/*`

- **Endpoints:** `GET /` (status), `POST /predict` (the 8-mudra Python classifier), `GET /api/tts/personas`, `GET /api/tts/languages`, `POST /api/tts/speak` (MP3 via `edge-tts`; returns a JSON fallback if synthesis fails).
- **Dependencies:** only fastapi, uvicorn, pydantic, requests and edge-tts. No numpy, opencv or mediapipe.
- **Audio cache:** written to disk under `backend/cache/audio` (or tmp). On Render this is lost on restart or redeploy.
- **CORS:** `*`.
- **Next rewrites** (`frontend/next.config.ts`): `/api/tts/*` → backend, `/api/py/*` → backend root, `/predict` → backend.
- **Render free tier** (`render.yaml`, Frankfurt): 512 MB RAM, sleeps when idle, cold start around 30 s.

What this means for the feature:
- Any server-side video work (downloading a YouTube video, running Python MediaPipe) would break the promise that no frame leaves the device.
- A heavy pose model plus video decoding would not fit reliably in 512 MB.
- YouTube often blocks downloads from datacenter IPs, and downloading is against its terms.

**The backend's only role here is voicing tip text.** That text goes to Microsoft's online TTS through edge-tts, and the privacy page does not mention it.

---

## 8. Progress storage: `lib/services/StatsService.ts`

- `PracticeSession {id, mudraId, mudraName, accuracy /*0-100 int*/, duration /*s*/, timestamp, energyLevel?}`
- `UserStats {totalPracticeTime, totalSessions, averageAccuracy, longestStreak, masteredMudras: string[]}`
- Static methods `saveSession`, `getSessions`, `getStats`, `clearAll`; stored in localStorage under `nv_sessions` / `nv_user_stats`.
- `masteredMudras` gains the `mudraId` whenever accuracy is 90 or more.

**Problem for this feature:**
- `/dashboard` links each session to `/practice/${mudraId}` and `/library/${mudraId}`, and shows mastery as `x/28`.
- A comparison session saved under an ID that is not a mudra would create broken links and inflate the mastery count.

Fix: add a `kind?: "mudra" | "compare"` field and filter on it, or use a separate key. Keep only summaries in localStorage; bakes belong in IndexedDB.

---

## 9. The deleted bake pipeline (`git show 287aba3:frontend/src/app/mocap/page.tsx`, 1529 lines)

**Models**
- Pose model URL: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/${name}/float16/1/${name}.task`, with `name` one of `pose_landmarker_lite|full|heavy`. Heavy was the default.
- Three landmarkers, re-created when the quality changes:
  - PoseLandmarker, VIDEO mode, `numPoses: 1`;
  - HandLandmarker, VIDEO mode, `numHands: 2`, used as the full-frame fallback;
  - HandLandmarker, IMAGE mode, `numHands: 1`, for the crops.
- `@mediapipe/tasks-vision` 0.10.34 also ships `HolisticLandmarker`; it has not been tried in this repo.

**Functions worth restoring into a library**
- **`assignHands(handResult, poseResult)`**: matches hands to sides by greedily pairing each detected hand with the nearest pose wrist, with a 0.2 normalised cutoff. This deliberately ignores MediaPipe's handedness, which assumes a mirrored selfie view.
- **`handBox(video, elbow, wrist)`**: centre = wrist + 0.35 × (wrist − elbow); half-size = max(32, 0.95 × forearm length in pixels). The box scales with distance from the camera.
- **`drawCrop(video, canvas256, box)` / `unCrop(landmarks, box, vw, vh)`**: draw the magnified crop, then map crop landmarks back to the full frame.
- **`seek(video, t)`**: waits for `seeked`, with a 400 ms fallback timer.
- **`detectNow()` → `Sample {t, frame: Frame, leftScreen, rightScreen, via:{L,R: "crop"|"full"|null}}`**:
  - uses a strictly increasing timestamp (`stamp*40`) for VIDEO mode;
  - runs the crop pass for each side, skipped when wrist visibility is below 0.3;
  - falls back to the full-frame pass with `assignHands`.
- **`drawOverlay(sample)`**: the existing "stick figure on the video" renderer.
  - Pose: `PoseLandmarker.POSE_CONNECTIONS` in `#ff9933`, width 3, alpha 0.18 where visibility is below 0.5; joints `#ffe0a8`, or `#ff5050` when weak.
  - Hands: `HandLandmarker.HAND_CONNECTIONS` in `#4fd8ff`.
  - Alignment works because the markup is `<video class="block h-auto w-full">` with `<canvas class="absolute inset-0 h-full w-full">` and the canvas sized to `videoWidth`/`videoHeight`, so there is no letterboxing.
- **`bake()`**:
  - Loop: `total = floor(duration*fps)`; for each i, `await seek(i/fps)` → `detectNow()` → it also called `api.pose()` (not needed here) → update progress → `await setTimeout(0)`. `abortRef` stops it.
  - Defaults: 10 fps (options 5/10/15/24), heavy model, smoothing 2, despike, stabilise and rigid all on.
  - **Clean-up order:**
    1. Rigid step: `measureSkeleton(despikeTrack(poses,2,3))` → `enforceSkeleton(poses, visibility, skeleton, 12)`.
    2. Then for each channel (pose world, left-hand world, right-hand world): `despikeTrack(2,3)` → `stabiliseTrack(3, 0.004, 0.02, 12/fps)` → `smoothTrack(2)`.
    3. Then `saveBake`.
- **Playback sync**:
  - `requestAnimationFrame` plus the `timeupdate` and `seeked` events;
  - frame index = `round(currentTime*fps)`;
  - `resettle()` when the index jumps by more than 2.
- **Cost:** a code comment measured detection at about 95 ms per frame. A 3-minute video at 10 fps is 1800 frames, so roughly 3 minutes or more on a desktop GPU, and slower on phones.

**Problems found in that code**
1. **Hand screen landmarks are dropped.** The hand channel's setter replaces `frame.left` with `{ world: v }`, which discards `screen`. After a fresh bake with cleaning on, `closeContact` silently stops working. It only comes back when the bake is reloaded from IndexedDB, because `fromStored` restores `screen`.
2. **Screen landmarks are never cleaned.** Only world landmarks are despiked and smoothed. The screen landmarks are what the overlay draws and what mudra classification would use.
3. **Seeks can land on the wrong frame.** The 400 ms timeout in `seek()` can resolve before the new frame is decoded, so detection runs on the previous frame. `requestVideoFrameCallback` is more exact.
4. **Index-to-time can drift.** If `detectNow()` returns `null`, that sample is skipped, so `samples[i]` no longer corresponds to `i/fps` and the `round(currentTime*fps)` lookup drifts. Look samples up by their stored `t` instead.
5. **Background tabs stall the bake.** Hidden tabs throttle `setTimeout`, so a bake slows down badly when the user switches tabs.
6. **One landmarker per video.** VIDEO-mode landmarkers keep tracking state and need strictly increasing timestamps. Reference and student need **separate instances** (or IMAGE mode).

### `287aba3:frontend/src/lib/mocap/bakeStore.ts` (362 lines; restore almost as-is)
- `StoredSample {t, pose, poseScreen, left, right, leftScreen, rightScreen}`
- `StoredBake {fps, quality, smoothing, despike, duration, savedAt, samples, stats{frames, withPose, withLeft, withRight, viaCrop?, viaFull?, meanVisibility, worstResidual}}`
- `bakeKey(src, file)` returns `file:${name}:${size}:${lastModified}` or `src:${src}`. A YouTube key could be `yt:<id>`.
- `saveBake`, `loadBake`, `deleteBake` use IndexedDB `nrityavaani-mocap/bakes` with explicit keys. Data is packed into Float32Array lanes, not JSON.
- File format via `encodeBake`/`decodeBake`: `"NVB1"` + u32 header length + JSON header + `flags u8[n]` + `times f32[n]` + six lanes.
- `bakeBytes(n)` is 1937 bytes per frame, so 10 fps × 5 minutes ≈ 5.8 MB.
- There is no layout version beyond the magic string.

### Other deleted modules (`287aba3:frontend/src/lib/motion/*`)
- **`polish.ts`** — `polishClip(clip, {hands:{left,right}: Uint8Array, outlierWindow:3, outlierThreshold:20, sigmaT:3, sigmaA:9, passes:3})`: smooths rotations offline and interpolates across frames with no hand. Only relevant for comparison in rotation space.
- **`validate.ts`** — `validateClip`: clamps joint limits and speed.
- **`collide.ts`** — `decollideClip(clip, probe)`: needs `MocapFigure.probe`.
- **`clipStore.ts`** — stores clips in IndexedDB.
- **`critic.ts`** and **`api/critique/route.ts`** — the LLM review, which uploaded frames. Don't restore them, but keep the closed vocabulary as a tip taxonomy that maps onto geometric rules:
  - `PARTS = [leftHand, rightHand, leftArm, rightArm, torso, head]`
  - `ISSUES = [fingers_too_spread, fingers_too_closed, fingers_too_bent, fingers_too_straight, too_high, too_low, too_forward, too_back, too_wide, too_narrow, leaning_forward, leaning_back, turned_left, turned_right]`
  - `SEVERITIES = [slight, moderate, large]`

---

## 10. UI conventions

**Stack**
- Tailwind v4 via `@import "tailwindcss"` and `@theme` in `app/globals.css`. `tailwind.config.ts` is a legacy v3 file.
- Theme tokens: `--background`, `--foreground`, `--primary` (saffron `#FF9933` dark / `#c2410c` light), `--card`, `--card-border`, and the accents `gold`, `violet`, `pink`, `cyan`. Dark mode uses the `.dark` class (next-themes).
- Fonts: `.serif` (Newsreader) for prose, `.mono` (JetBrains Mono) for labels and data, Outfit for headings.

**`components/ui/editorial.tsx`**
- `Eyebrow({tone:"muted"|"primary"})`, `Mark`, `Headline({as:"h1"|"h2"|"h3"})`, `Prose`, `Figure({value, unit?, caption})`, `FigureRow`, `FactStrip({items})`, `Rule`, `Pill({href, variant:"solid"|"ghost"})`, `Section({id?, ruled?})`.
- Rules written in the file: labels are monospace, prose is serif, numbers carry units, no cards unless the content really is a card.

**Page shell and layout**
- Pages use `min-h-screen px-6 pt-32 pb-24` with `max-w-6xl mx-auto`.
- Media panels: `rounded-2xl border border-card-border bg-card`.
- Toasts: `sonner` `<Toaster>` is already mounted in the layout.
- `recharts` is installed but not used.

**Wiring a new page**
- Add it to `NAV` in `components/layout/Navbar.tsx` (Learn, Practice, Live, Library, Research, Dashboard, About).
- If the page has its own video or 3D stage, add its route to the hide list in `components/layout/SiteBackdrop.tsx`.

**Next.js 16.3.5:** `frontend/AGENTS.md` requires reading `node_modules/next/dist/docs/` before writing code. Middleware is now `src/proxy.ts`, which only guards `/checkout`.

---

## 11. Privacy promises (`app/privacy/page.tsx`)

The page makes four promises:
1. "100% On-Device Inference … No video feed or individual image frame is ever uploaded or streamed to an external server."
2. "No Recording or Surveillance".
3. "Local Storage for Practice Data (localStorage and IndexedDB)".
4. "Zero Third-Party Tracking".

What this means for the feature:
- Both videos must be processed in the browser.
- **The browser cannot read pixels from a YouTube embed.** It is a cross-origin iframe with no access to its `<video>`, and MediaPipe needs an `HTMLVideoElement`, canvas or `VideoFrame`.

On-device routes for a YouTube reference:
- the user supplies the file themselves;
- `getDisplayMedia` tab capture, which runs in real time at 1×, needs a permission prompt, and does not work in mobile browsers;
- the YouTube IFrame Player API (`getCurrentTime`, `seekTo`), only for keeping a YouTube player in sync with an overlay drawn from a bake made some other way.

An overlay on the iframe also has to account for letterboxing of non-16:9 videos.

---

## 12. What does not exist yet

- **Time alignment.** There is no DTW or time-warping anywhere. `segment.ts` cuts a video into steps but does not align two videos.
- **A comparison metric on landmarks.** None exists (only `poseError` on rotations, and `retarget`'s residuals).
- **PoseLandmarker in live code.** It only existed in the deleted page.
- **A headless rig solver.** `retarget` → `encodePose` without a mounted `MocapFigure` would need a new helper.
- **Mirror handling.** A student copying a teacher who faces them often does the mirror image, and phone front cameras may save mirrored video. The code needs a left/right swap map for `P` and the hands. `assignHands` only solves which detected hand belongs to which side.
- **Translated tip text and a `speak(text)` voice method.**
- **Tests.** There is no test runner, and the referenced `tools/lesson/*.mjs` tests are not in this repo.
- **Recording.** There is no `MediaRecorder` anywhere.
