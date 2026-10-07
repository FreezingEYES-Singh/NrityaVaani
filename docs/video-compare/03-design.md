# Video compare feature: design (after 2 red-team rounds)

> Status: DRAFT, not yet approved by the user. Round-3 critic issues in 04-open-issues.md are NOT yet applied.

# Guru Mirror (`/compare`): revised design (round 4)

A student practises one step next to a reference. The feedback should be something a real teacher would agree with. When the app can't judge something, it says so plainly. No video frame leaves the device.

> This is the design only. Nothing in the repo has been created, edited or committed. You asked for the solution first, then your agreement and a plan, then code. §12 lists the decisions I need from you.

**Facts I checked in the repo and designed around**

- **`public/lessons/thattadavu.json` cues:**
  - Aramandi: "Heels together, toes turned out… Torso straight; stay at the same height… Strike with the whole sole, flat… Always begin with the right foot".
  - Adavu 1: "Strike right, then left… second twice as fast, the third twice again… up through the speeds, then come back down".
  - Adavu 2–4: 2, 3 and 4 strikes on each foot.
  - Adavu 5: "The same foot for all five… Two slow strikes, then three quick ones".
  - Adavu 6: "Two groups of three on one foot… A pause after each group".
  - Adavu 7: "Right on one, two, three. Left on four. Right on five, six, seven; eight is silent. Then begin with the left foot".
  - Adavu 8: "Alternate… The last three come quicker… eight is silent… Start right, then start left".
  - "Thattadavu" (intro) and "Practising" are talk steps, not danceable.
- **`public/lessons/namaskaram.json` steps:**
  - Guru Vandana: anjali held, samapada, 19 s.
  - Samapada.
  - Katakamukha: held mudra.
  - Aramandi: "Feet in a V shape, a bit of space between them", which differs from the Thattadavu heel rule.
  - Tapping: "Tap the right foot first and then lift. Right and left."
  - Shikhara + jump; Saluting around; Touching the ground (muzhumandi); Touching the eyes; Rising; The whole namaskaram.
- **Things that overlap a page today:** the navbar is `fixed top-0 z-50`, `LiveChat` is `fixed bottom-4 right-4 z-[100]`, and the sonner `Toaster` sits bottom-right.
- **No `/terms` route exists.**
- **`/privacy` today promises:** on-device inference, "No Recording or Surveillance", local storage, and "Zero Third-Party Tracking". The recorder and the YouTube feature both require rewording (§2.7, §8).

---

## 0. The short answer

| You asked | What we build | Why |
|---|---|---|
| Upload a video **or** paste a YouTube link, then process it | **Four kinds of reference, one data shape (§2.1):**<br>(1) **NrityaVaani pattern cards.** The Thattadavu footwork patterns, written from our own lesson cues. They need no video, so they work for every student, including YouTube-only students.<br>(2) **NrityaVaani studio references.** A consenting trained dancer is recorded once and the landmarks ship with the app. These add posture comparison.<br>(3) **A teacher video file** you have the rights to, processed on your device.<br>(4) **A YouTube link → "Practise beside YouTube".** The player is shown untouched, with loops. Your take plays beside it and is checked against the pattern card. | No web page can read pixels from YouTube's player. Downloading breaks YouTube's ToS and API policy III.E.1, Render's IP gets bot-checked, and it would break our privacy promise. Tab capture is desktop-Chrome-only and conflicts with policies III.I.14 and III.E.4. |
| Show the stick figure on the YouTube video | The stick figure is drawn on **our own `<video>`** for files and references. For YouTube it is drawn on the **student's** video, **beside** the player. | YouTube forbids any overlay in front of its player. |
| Student adds their video beside it and gets what's wrong plus tips | A **recorder** in one of two modes: full-screen teacher on a big screen, or "dance to the sound" on a phone. It is hands-free. You can also **upload** a take. You see both side by side and get up to 3 corrections, 1 strength and 1 focus, each with "Show me". | The recorder knows the camera, the mirroring and the timing, so they don't have to be guessed. |
| "Not all movement is necessary, different lengths…" | **What gets judged:** (1) your trim; (2) automatic talk, hold and absence handling on the teacher; (3) one step, with **other steps inside your take found and set aside**; (4) per-step kind and body-part modes; (5) the teacher's own consistency; (6) one-sided features.<br>**How it lines up:** footwork is aligned on the **strike sequence**. It is matched cyclically against the reference phrase, with a free start point, so tempo, rep count, where you started and take length don't matter. | §3, §4 |

**Who gets what, step by step**

| Content | P1 (wk 1–2) | P2 (wk 3–4) | P3 (wk 5–6) | v2 |
|---|---|---|---|---|
| Thattadavu Adavu 1–8, any student, no reference video (pattern card) | — | Pattern, count, silence, start foot, phrase correctness, speed ladder; reference-free aramandi habits | Same inside "Practise beside YouTube" | — |
| Thattadavu with a studio reference | — | Above, plus **posture comparison** (Tier A) and a safety-gated depth tip | Phase shape (Tier B), ghost, error timeline | — |
| Thattadavu with the teacher's own file | Upload, **skeleton on the whole prepared range**, Learn, your take side by side, no scores | Posture vs teacher, plus the pattern card **if you confirm it's the same version** | Teacher's own detected pattern; step proposal timeline | Several ranges, edited videos |
| Namaskaram | Skeleton + side by side | **Tapping:** pattern card. **Aramandi, Samapada, Guru Vandana:** posture only (holds), studio reference or teacher file required; anjali not checked | — | Saluting / Touching / Rising (Tier C); Katakamukha, Shikhara, anjali (close-up mudra path) |
| Other dances / steps | Skeleton + side by side | Posture (Tier A) vs a teacher file | — | Tier C chains |

"Thattadavu" (intro) and "Practising" can't be selected. `/live` and `/practice` remain the home of close-up mudra training.

---

## 1. How the design was attacked and rebuilt

| # | Proposal | What broke it | What survives |
|---|---|---|---|
| R1 | Server downloads YouTube | ToS / III.E.1, bot checks, 512 MB, privacy | Nothing on the server |
| R2 | Tab-capture the player | Desktop only, policy | YouTube = practise beside |
| R3 | Global DTW | Talk, partial takes, repeats | Step by step |
| R4 | Tempo ratio + frame DTW | Speed changes, rep counts | Event layer |
| R5 | One % score | Measurement error | Bands, ≤ 3 tips, abstain |
| R6 | Teacher = ground truth | Incidental motion | Modes, consistency, one-sided |
| R7 | Guessed thresholds | — | Per-template calibration (R31) |
| R8 | Long waits | — | Learn on raw video at once |
| R9 | Mixed model tiers | Different biases | One tier per project |
| R10 | One canonical cycle | Speeds inside a step | Template per speed section |
| R11 | Rescaled queries | Short queries match anywhere | Resample the student |
| R12 | Rig lessons as references | Rig ↔ MediaPipe bias | Studio references; rig in v2 |
| R13 | Whole-step distributions | Partial takes | Per section |
| R14 / R18 | Phase Viterbi | Can't advance fractionally | Removed |
| R15 | Absolute τ | Rejects beginners | Relative tests |
| R16 | Moving crop | Breaks tracking | Fixed crop per shot |
| R17 | Absolute alignment features | Constant offset | De-meaned features, relative confidence (now per unit, R27b) |
| R19 | sDTW skips cells free | Rewards skipping | Both skips charged (R27c) |
| R20 | ACF finds the cycle | Long phrases, aliasing | Strike strings |
| R21 | Mirror from cost | Indistinguishable on symmetric steps | Laterality from facts |
| R22 | Absolute speed labels | No shared beat | Relative ladder, asked |
| R23 | Posture gates on students | Drops beginners | Presence and motion only |
| R24 | Two-sided penalties, camera = gravity | — | One-sided, roll/pitch, clothing |
| R25 | Generic YouTube rules | Flags choreography | Step families |
| R26 | Big scope | — | Re-cut again (R38) |
| **R27** | Strikes from ankle height above a world-space floor | World landmarks are hip-centred. Hip bounce, rising aramandi and standing frames move both ankles, so no strikes are found | **Differential lift:** moving ankle minus planted ankle, so hip motion cancels (§4.1) |
| R27b | De-mean per take | Partial takes reintroduce the offset | De-mean per unit / matched span (§4.0) |
| R27c | λ-only student skip | DTW hops over the worst frames | Skipped student frames charged; every frame in the span scored (§4.7) |
| **R28** | Cut student strings into phrases by her own period | Rotated phrases give false count and start-foot tips; inconsistent students get nothing | **Cyclic alignment against the reference phrase** with a free start, plus **phrase correctness** (§4.2) |
| **R29** | Pose proposes, audio refines, fixed windows | Speaker bleed, mic DSP, music, bells, A/V offset; audio can't add or veto | **One audio policy:** clean-audio gate, low-band stamp detector, per-take offset; audio **proposes and vetoes** (§2.2, §4.1) |
| **R30** | Median-IOI pulse, raw IOI CV | Adavu 5–8 are uneven by design | **Residual IOIs** against reference slot durations (§4.2, §5.3) |
| **R31** | One 15° dead band, one recall gate | Misses arm lines; contradicts subtle-error recall | **Per-feature noise-derived dead bands** and a detection limit (§3 F5, §9) |
| **R32** | "Sit deeper" as tip #1 | Injury-prone without knee and heel alignment | **Safety gate:** knee-over-toe + heel-down (§5.2) |
| **R33** | The reference *is* the step | Banis differ | **Version check** and reference-relative wording (§4.2) |
| **R34** | Fresh landmarker per shot | Leaks WASM heaps and WebGL contexts | **Pool** + `setOptions` reset + session-wide timestamps (§2.4) |
| **R35** | Recorder take: in-memory, cue-less WebM, read by playback | Lost on tab kill, unseekable, dropped samples | **Remux, temp IndexedDB, same reader; live detection where fast** (§2.2) |
| **R36** | Dance along with a phone at 3 m | Can't see the teacher; 3–4 min wait per take | **Full-screen or sound mode, hands-free, short takes, live detection** |
| **R37** | Single person; identity only flagged | Mirrors, posters, class videos; latches onto a parent | **Classify extra people, tap-to-pick in P1, signature re-acquire** (§2.5) |
| **R38** | Everything in 6 weeks | Can't finish or calibrate | **v1 = Thattadavu path.** Calibration budgeted as clips × templates (§9, §12) |
| **R39** | Comparison only with a studio dancer | Single point of failure | **Pattern cards ship from cues regardless** |
| **R40** | Static holds = TALK | Samapada and anjali dropped | **STANDING_HOLD**; user marks override; hold steps use Tier A on the stillest window |

Remaining risks are in §13. They are accepted, not unhandled.

---

## 2. Inputs and extraction

### 2.1 References ("Choose your reference")

Every reference becomes one object:

```
Reference {style, steps[]}
step = {name, cues[], kind: footwork|cyclic|nonCyclic|hold, modes, pattern?, lanes?, onsets?}
```

Pattern cards and studio references set `kind` and `pattern` by authoring. For teacher files the user chooses them; P3 adds a proposal. **The state classifier never decides a reference step's structure.**

**(a) Pattern cards (P2; no video).**

- Person D writes them from the cues.
- Slot durations are then checked against foot contacts in `thattadavu.nvclip`. A one-off Node script decodes the clip, puts it on the rig and reads foot heights. They are checked again against the studio reference when one exists.
- Every card is labelled **"NrityaVaani version"**.

| Step | One full phrase (slot length in pulses, default 1; `_` = silent) | Start |
|---|---|---|
| Adavu 1 | R L | R |
| Adavu 2 | R R · L L | R |
| Adavu 3 | R R R · L L L | R |
| Adavu 4 | R R R R · L L L L | R |
| Adavu 5 | R² R² R R R _ · L² L² L L L _ (lengths from the clip) | R |
| Adavu 6 | R R R _ R R R _ · L L L _ L L L _ | R |
| Adavu 7 | R R R L R R R _ · L L L R L L L _ | R |
| Adavu 8 | R L R L R⅔ L⅔ R⅔ _ · L R L R L⅔ R⅔ L⅔ _ | R |
| Tapping (Namaskaram) | R L (tap events) | R |

Ladder metadata comes from the cues. Example, Adavu 1: speeds 1→2→3→2→1, ratio 2 between neighbouring speeds.

**(b) Studio references (P2, if the dancer is recorded).**

- **Recording:** front view at hip height, fitted clothes, full body, real side (she begins on the right), and the speeds the cues ask for.
- **Bake:** on a desktop with the **GPU delegate**, at both `full` and `heavy`.
- **What ships:**
  - raw lanes, kinds, cues, modes and templates;
  - **pre-computed stamp onset times**, so teacher audio is never decoded on a student's device;
  - a 540p MP4, published with the dancer's written consent.
- **Extra recording:** the Namaskaram mudra steps are also recorded as close-up hand clips for v2.

**(c) Teacher file (P1).**

- `<input type=file accept="video/*">`, played from an object URL in our own `<video>`. The file is never uploaded.
- **Rights attestation** checkbox. Codec check, with the HEVC message.
- **No cap on the source file.** A 50-minute class recording is fine. The cap is on what gets processed: **one range of ≤ 3 min in P1** (up to 3 ranges in v2), picked with a thumbnail scrubber.
- P0 tests a 4 GB file on iOS and Android.
- The creator helper text ("Download your own video from YouTube Studio") and the iOS "preparing your video" note stay.

**(d) YouTube link (P3).** See §8.

**(e) 3D rig lessons as references.** v2.

### 2.2 Student takes

#### Recorder (P1; the default where supported)

**Feature detection.** The recorder needs a secure context, `mediaDevices.getUserMedia`, `MediaRecorder`, and must not be running in an in-app browser (WhatsApp, Instagram, FB; checked by UA plus a feature test). If any of these fail, the default card becomes "Upload a take". For in-app browsers we show "Open in Chrome/Safari" with a copy-link button.

**Permissions.**
- **Camera first** (`video` only).
- **Microphone is a separate opt-in:** "Use the microphone to time your strikes".
  - Off by default on iOS until P0 confirms that teacher playback still works with the mic open.
  - Constraints: `{echoCancellation:false, noiseSuppression:false, autoGainControl:false}`. `track.getSettings()` is checked to see which were honoured.
  - The built-in mic `deviceId` is preferred. If a headset or Bluetooth input is selected, we show a warning.
- **Denied, busy, missing and unsupported** each get their own error row (§7).

**Setup screen (live framing check).** Full model, IMAGE mode, about 5 fps. It shows a ✓/✗ list:
- feet visible;
- one dancer (extra people classified as in §2.5);
- size in pixels;
- **effective frame rate and brightness**: "Too dark: your camera is recording at 12 fps; add front light";
- an **arms-out check pose** for natyarambhe or Natta steps, with fingertips inside the frame;
- **background motion while you stand still**, which means auto-framing, Center Stage or background effects are on. We give per-OS steps to turn them off.

**Mode.**
- **"Big screen (laptop/TV): dance along."** After the countdown the teacher fills the screen, mirrored per §4.8. Your own preview is hidden except for a small framing badge that turns red if your feet leave the frame.
- **"Phone: dance to the sound."** The teacher's audio plays after a spoken count-in. Copy: "Learn the step in Learn first, then record to the sound."
- **Early/late timing against the teacher** (§4.9) is claimed only for big-screen dance-along takes.

**Hands-free.**
- **Start:** the right-hand anchor, raised for 2 s and detected live, then a spoken 3-2-1.
- **Stop:** whichever comes first:
  - the chosen number of loops (default: 3 phrases for footwork, usually 15–45 s);
  - both hands overhead for 2 s;
  - 2 min.
- **Approach frames are trimmed automatically:** frames where the dancer's screen height grows steadily (walking to or from the camera) and frames where the ankles leave the frame.

**Loop.**
- Loop points are **snapped to whole phrases**. They are authored for pattern cards and studio references. For teacher files they come from the teacher's strike string once the step is baked; if that string isn't available, the seam is flagged.
- Looping is gapless: two `<video>` elements are pre-seeked to the loop start and alternate at the seam.
- Every clock sample logs `{teacherTime, loopIteration, performance.now(), captureTime}`.
- **Student strikes within 1 s after a seam are excluded** from the pattern statistics and from early/late.

**Laterality check.** Raw frames are assumed unmirrored, but this is **verified**: the image-side wrist raised during the anchor must agree. Track labels containing "OBS", "Virtual" or "Snap" trigger a warning. If they disagree, laterality is unknown and we say "Your camera may be mirrored".

**Live detection (P2).**
- **When:** if the device benchmark is ≤ 0.6 × the frame budget at the target fps (typically laptops with a GPU), pose runs **live during recording** in VIDEO mode with capture timestamps. Feedback is ready seconds after Stop.
- **Otherwise:** the take is baked after Stop, and the expected wait is shown **before** recording ("about 1 min for a 20 s take").

**After Stop.**
1. **Remux once with Mediabunny** (Conversion, no re-encode) into MP4 with the moov at the front, or WebM with cues and a duration. From here on, recorder takes are seekable files that use the same reader as uploads (§2.3).
2. **Write the remuxed take to IndexedDB** as a temp record.
   - Before recording, `navigator.storage.estimate()` is checked (a 2 min take is about 40 MB).
   - The record is deleted after a successful bake unless the student taps Keep. Hard expiry: 24 h.
   - After a reload: "Resume processing your last take". If the record is gone: "Your take was lost because the browser closed the tab."

A recording indicator is always visible. **"Delete all my takes and analyses"** is on `/compare` and `/privacy`.

#### Upload a take (P1)

- **Camera question:** back / front / laptop / not sure, preselected "not sure". QuickTime lens metadata can pre-answer it.
- **Quality warning:** bitrate under 2 Mbps or height under 600 px.
- The recording guide asks for the anchor at the start.
- **Resume:** checkpoints are keyed by the file hash, so picking the file again resumes the bake. The copy says plainly that resuming needs the file picked again.

#### Recording guide

- **Setup:** hip height, 2.5–3 m away, whole body including feet, front light.
- **People:** only you dancing. Mirror walls and posters are fine; we ignore them.
- **Clothing and floor:** fitted clothes or pleats tucked; **a hard floor so strikes are audible**.
- **Camera effects:** auto-framing, Center Stage and background effects off.
- **Orientation:**
  - **landscape** for natyarambhe, Natta and other arm-wide steps;
  - **portrait** allowed for Thattadavu (hands on waist) and for mudra close-ups;
  - preflight explains this if the arms clip.

#### Audio policy (the single place where audio rules live)

Audio is used only when it is clean. **With audio off, everything still runs from pose.** Only 3rd-speed rhythm, evenness at 2nd speed, and confirmation of silent counts abstain.

| Check | Mechanism | If it fails |
|---|---|---|
| Teacher sound in the room | Cross-correlate the recording with the known teacher audio (the latency search covers 0–400 ms) | Audio off: "Use headphones for rhythm feedback". No onsets are dropped by time window. |
| Music or ankle bells | Low spectral flatness over > 50% of frames, an onset train periodic far above the pose strike rate, or > 30% of onsets with no pose landing | Audio off: "Music was playing: rhythm judged from your feet only" |
| Stamp vs other sound | Onset envelope on a **40–300 Hz band** with a broadband-transient check, which ignores bell jingle and most cymbals | — |
| Clock offset | Per-take pose→audio offset from cross-correlating the landing train with the stamp envelope over ±250 ms. Pairing within ±40 ms of that offset. Peak / second peak must be ≥ 1.5. | Refinement off for this take |
| Following an external clock | After offset removal, > 30% of refined strikes move > 40 ms in the same direction | Refinement discarded |
| YouTube mode | Takes are recorded **video-only** | — |

### 2.3 Reader and bake

**Reader (P1).**
- **Primary:** Mediabunny decodes sequentially over the range via WebCodecs. CanvasSink applies the rotation, so frames are upright, at ≤ 960 px on the long side for pose.
- **Fallback** when `VideoDecoder` or the codec is missing (Firefox Android, some HEVC): the seek loop on the seekable or remuxed file. It waits for `seeked` + rVFC and stores `metadata.mediaTime`. A 400 ms timeout marks the sample `INTERP`.
- Playback-driven reading is gone.

**Effective frame rate.**
- The source frame interval is measured per shot, from distinct packet timestamps or mediaTimes.
- **Bake fps = min(target, effective).** Targets that resolve to an already-processed frame (same timestamp or same frame hash) are skipped, so VIDEO-mode timestamps never repeat.
- The effective interval feeds the rhythm noise floor (§5.3) and the fps gate (§4.1).

**Passes.**
- **P1, teacher:** the whole prepared range (≤ 3 min) is baked in detail at **15 fps**, `full` model. **The skeleton exists over the whole range.** The timeline shows coverage.
- **P2:** a step tagged footwork is re-baked at 24 fps if the source allows.
- **P3, structure pass:** lite, 4 fps, for the state timeline and step proposals.
  - Spans outside detailed bakes show a **"preview skeleton"** (interpolated, labelled) and a "Process the whole range in detail" button with an ETA.
  - The footwork tag comes from the **audio stamp rate** or a "This step has footwork" toggle, defaulting to on when leg energy is high. It is never taken from 4 fps lift counts.
- **Student take:** same tier as the reference, at min(target fps, effective fps), ≤ 2 min.

**After detection.**
- Uniform-grid resampling after cleaning (unchanged).
- The bake yields after every frame. Learn plays the raw video during a bake, and pauses itself if the decoders contend.
- Wake Lock, a checkpoint every 150 samples, and a pause when the tab is hidden.

**Worker.** The shim is tested in P0. The worker itself is v2 unless P0 shows the main thread can't cope.

### 2.4 Models, pool, delegate, tier, timestamps

**Pool.**
- At most **3 live instances**, one per (model, runningMode, numPoses):
  - `full/VIDEO/1` for bakes and live detection;
  - `full/IMAGE/3` for preflight, framing, the identity check, re-acquire and the picker;
  - `lite/VIDEO/2` for the P3 structure pass only.
- A `?debug=1` assertion enforces the cap.
- **Reset** between videos, passes, shots and crop changes with `setOptions(...)`, which rebuilds the graph inside the same WASM module.
- **Timestamps** come from one session-wide monotonic clock: `ts = sessionBase + frameMs`. `sessionBase` jumps 10⁷ ms past the last stamp on every reset, so timestamps never have to restart.
- **P0 checks:**
  - that `setOptions` resets tracking and smoothing;
  - a soak test: 30 resets × 3 bakes on an iPhone, memory must stay flat.

**Delegate.**
- Create on GPU, then run a 64 KB known-good image.
- On failure, use CPU at 10 fps. The pattern tips are then subject to the fps gate in §4.1.
- `webglcontextlost` → recreate from the last checkpoint, within the cap.
- A device failure is never reported as "no dancer".

**Tier.**
- `full` by default.
- `heavy` only on desktop, offered when `full` runs at < 25 ms per frame.
- `heavy` is never fetched on a mobile UA or under `saveData`.
- The tier is fixed per project.

**Downloads.**
- The usual flow is the WASM (11.5 MB) plus `full` (9.4 MB).
- `lite` is fetched only for the P3 structure pass.
- On cellular, the size is shown before the first prefetch.

### 2.5 Preflight, people, identity, cuts

**Preflight.** It runs live in the recorder. For uploads it uses 8 frames sampled across the **whole** range.

- **Active area.** Only **edge-contiguous bands that are near-uniform in colour** (low per-row or per-column variance) **and unchanged across the whole range** are cropped; that covers letterbox and pillarbox. Textured static content is never cropped. Test: a tripod clip with a still start and arms opened later gives the full frame.
- **Size in source pixels:** ≥ 240 px OK; 160–240 px legs only, low confidence; < 160 px not usable.
- **Other checks:**
  - ankles visible in ≥ 70% of frames;
  - orientation;
  - the anchor;
  - view ratio within ±35% of the reference;
  - effective fps and brightness;
  - the clothing question.
- **Geometric in-frame gate.** A landmark outside [0.02, 0.98] of the upright frame is **not judged, whatever its visibility**. The reason shown is "out of frame".

**Extra people (P1).** Every extra detection, from `full/IMAGE/3` on the preflight frames and at 1 Hz during the bake, is classified:

| Class | Rule | Action |
|---|---|---|
| Static (poster, photo) | Centroid and pose variance ≈ 0 across samples | Ignored |
| Reflection (mirror wall) | Motion correlates ≥ 0.8 with the dancer's after a left/right flip | Ignored |
| Blur-fill copy | Same centroid, 1.3–3× the scale, low sharpness | Ignored; automatic crop to the sharp pillar |
| Split-screen | A static vertical seam divides the active area | Each pane is a source: "Which view?" |
| Moving person | Otherwise | **Tap-to-pick**, for teacher files and student uploads alike. The default is the largest, nearest-centre, sharpest person with ankles in frame (in class videos, the teacher in front). A **fixed crop** around them for each shot. |

Only moving people count towards the identity overlap test.

**Identity signature.**
- Built from the anchor or the picked person's first still 2 s.
- It holds a 3D world bone-length vector (`measureSkeleton` over those frames) and an HSV histogram of the torso box.
- The skeleton median used for identity always comes from the signature, never from the take.

**Identity tests (rotation-invariant).**
- **`SUSPECT_ID`** when any of these holds:
  - world bone lengths deviate > 15% from the signature for ≥ 3 samples;
  - the torso histogram distance (Bhattacharyya) is > 0.5;
  - a moving person overlaps the dancer's box by > 30%.
- Changes in screen width or length alone (turns, bows, kneeling) **never** set `SUSPECT_ID`. Low visibility there sets **`POSE_HARD`**, shown as "pose hard to see".

**Re-acquire.**
1. When `SUSPECT_ID` lasts ≥ 3 samples, run `full/IMAGE/3` on that frame and pick the candidate nearest the signature.
2. If that candidate is a different detection from the one being tracked, continue with a fixed crop around it. The crop change counts as a reset.
3. If she isn't found for > 2 s, mark a "lost you" gap and retry every second.

Group stage videos get a "trim to a solo section" warning.

**Cuts.**
- A cut is a thumbnail difference > 0.25 **and** (a bbox jump > 30% **or** a scale change > 30%). It resets the tracker and drops ±1 sample.
- **Reframing in the middle of a take** (auto-framing) is background motion outside the person mask while the dancer's world pose stays steady. It is treated as a cut.
- A median shot under 4 s → posture only.
- `CLOSEUP` and `HANDS_CLOSEUP` are as before.

**Shot view and facing (teacher files).**
- Each shot is classed by its pre-correction yaw and shoulder/torso ratio. Templates and Tier A use **only shots within 25° of the student's view**, shown as "front-camera reps used: 4 of 7". Otherwise the nearest view is used with depth features off.
- **Facing** is tracked per shot and section from nose, eye and ear visibility. Each change to back view is confirmed once ("Your teacher turned away here: same side as before?"), and that section's image→anatomy mapping is flipped (§4.8).

### 2.6 Cleaning and camera correction

Per shot, in this order:

1. **L/R swap repair** (`SWAP`).
2. `measureSkeleton` → `enforceSkeleton`, keeping the raw residual.
3. `despikeTrack` → `stabiliseTrack(…, 12/fps)` → `smoothTrack(1)`.
4. Screen landmarks are cleaned too.
5. Gaps of ≤ 3 samples are interpolated (`INTERP`).
6. `GLITCH` = residual > 25%.
7. Resample onto the uniform grid.
8. **Gravity frame:**
   - roll from the mid-ankle → mid-shoulder axis on upright still frames, with the heel line as a backup;
   - approximate pitch;
   - one yaw per shot;
   - tilt chips and gates as before.
9. **Leg reliability score** (jitter, bone residual, knee outside the hip–ankle cone). A low score, or the clothing answer "saree/skirt", turns off turnout, knee angle, heel gap and knee-over-toe. It keeps planted hipDrop with its dead band +0.03.

The pure track functions move to a three.js-free `lib/motion/track.ts`, re-exported from `retarget.ts`.

### 2.7 Storage, privacy and deletion

**IndexedDB `nrityavaani-compare`.**
- Stores: `bakes`, `projects`, `takes`, `checkpoints`.
- **Every key is prefixed with the user scope:** the signed-in user id, or `guest`.

**NVB2 bake.**
- `"NVB2"` + u32 header length + JSON header + raw lanes.
- **Header:** `{v, key, configHash, tier, delegate, fps, effectiveFps, ranges, activeArea, upright, rotation, shots[{t0,t1,roll,pitch,yaw,crop?,facing}], clothing, laterality, signature}`.
- **Lanes:**
  - `flags u16`;
  - `times f32`;
  - `poseWorld f32[n·33·4]`;
  - `presence`;
  - `poseScreen f32[n·33·2]`;
  - `stampOnsets f32[]`.
- Cleaning, features and alignment are recomputed on load, so changing them never needs a re-bake.

**Bake key.** `sha256(size ‖ first 4 MB ‖ last 4 MB)` + ranges + `configHash`. FNV fallback, and a fuzzy match for iOS transcodes.

**Retention.**
- Kept takes expire after **7 days** unless kept again. Temp takes expire after 24 h.
- "Shared computer? Don't keep takes" sits next to Keep.
- **Delete all my takes and analyses** is on `/compare` and `/privacy`.
- `navigator.storage.persist()` is requested after the first bake. Copy: "Safari may clear it after 7 days unused."

**StatsService.** Gets `kind: "mudra" | "compare"`, and `/dashboard` filters on it.

**`/privacy` rewrite (P1, shipped with the recorder).**
- "No Recording or Surveillance" becomes: "Takes are recorded on your device only. They stay in memory, and briefly in your browser storage while processing, until you leave. They are saved only if you tap Keep, and kept takes expire after 7 days. The microphone is optional and used only to time your strikes."
- The delete control is described.
- The YouTube and edge-tts sections are added in P3.

---

## 3. "Not all movement is necessary": what gets judged

### F1. Human trim

Teacher: one range in P1, up to 3 in v2. Student: in/out handles plus automatic approach trimming.

### F2. Automatic states (teacher timeline in P3)

States are computed in 1 s windows with a 0.5 s hop. E_group is the 90th percentile of speed ÷ torso length per second over that group's joints.

Precedence: `CUT > NOT_VISIBLE > SUSPECT_ID > DANCE / HOLD / STANDING_HOLD / ARM_DEMO > TALK`.

| State | Rule |
|---|---|
| `NOT_VISIBLE` | LOST, no pose, CLOSEUP, or dancer < 160 px |
| `ARAMANDI` | Planted hipDrop ≥ 0.08 and knee spread ≥ 1.3 × hip width |
| `HOLD` | ARAMANDI and E_legs below the take's 30th percentile |
| **`STANDING_HOLD`** | Upright, E_legs < 0.1, E_arms < 0.2, for ≥ 2 s, **and** the arms are posed: wrists joined within 0.15 torso, both wrists above mid-torso, or hands on the waist |
| `ARM_DEMO` | Upright and E_arms ≥ 0.3 |
| `DANCE` | E_legs above the take's 50th percentile of non-still windows, or ARAMANDI ≥ 50% of the window |
| `TALK` | Upright, E_legs < 0.1, E_arms < 0.2 for ≥ 2 s, and not STANDING_HOLD |

- **Inside a user-marked or authored step, TALK never removes frames.**
- **Marking vs full-out:** reps are clustered (2-means) on ARAMANDI fraction, median hipDrop and lift amplitude. Only the deeper cluster builds templates.
- **Student takes: presence and motion only.** Drop `NOT_VISIBLE`, `SUSPECT_ID`, walking, the anchor, and approach frames. Posture never removes student frames. "Stayed standing" during an aramandi step is a finding.

### F3. One step

- **Teacher file:** step in/out marks in P2; the state-coloured timeline, proposals and "check the step" preview arrive in P3 (rules unchanged from round 3).
- **Pattern cards and studio references:** the student picks a named step.

### F3b. Steps inside the student take (P2)

The event layer (§4.1) runs over **the whole take** before any scoring.

1. **Split into runs** where the pattern changes:
   - the cyclic-alignment cost (§4.2) of each candidate reference step over sliding 2-phrase windows;
   - IOI change points (§4.3).
2. **Label** each run with the best-matching pattern card, when one fits.
3. **Judge only the declared step.** Runs matching the declared step are judged. Others show as "other step: not judged".
4. **Ambiguous or no match:** the runs are shown on the timeline and the app asks which run is the declared step. If nothing matches, it says so and skips pattern tips.

Test: Adavu 1–4 danced back to back, declared Adavu 3 → only the Adavu 3 run is scored, with no count tip.

### F4. Step kind and body-part modes

`kind` is authored or chosen (§2.1).

| Mode | Rule |
|---|---|
| Arms `waist` | Wrists within 0.35 torso of the hips, low motion, in ≥ 70% of frames |
| Arms `natyarambhe` | Wrists within ±0.25 torso of shoulder height and extension ≥ 0.7 arm length, in ≥ 60% |
| Arms `free` | Otherwise |
| Legs `aramandi` | hipDrop ≥ 0.1 in ≥ 70% |
| Legs `standing` / `mixed` | Otherwise |
| `footwork` | kind = footwork |

### F5. Tolerances from measured noise and teacher consistency

- `tol_f = dead_f + 1.5·MAD_f`, capped at 3·dead_f + 15°-equivalent.
- `dead_f = max(prior_f, 2 × measured test-retest SD_f)`.
- A feature is **free** (never scored) if the teacher's σ > 3 × dead_f.
- With fewer than 2 teacher reps in a section, the dead band alone is used.

| Feature | Prior dead band (replaced by measurement in P0–P2) |
|---|---|
| Upper-arm frontal elevation, elbow height vs the shoulder line | 6° |
| Wrist height | 0.06 torso |
| Elbow angle (frontal) | 10° |
| Lateral tilt, hip level, shoulder level | 4° |
| Knee-over-toe angle | 12° |
| Knee angle, depth-dependent terms | 15° |
| hipDrop | 0.04 |
| Knee spread | 0.2 hip widths |
| Heel gap | 0.25 hip widths |

### F6. One-sided features

| Kind | Features | Behaviour |
|---|---|---|
| **More is fine** | hipDrop (up to the reference + 0.12), knee spread, torso uprightness | Penalised only in the bad direction. **Never praised.** |
| **Less is fine** | Heel gap, lateral tilt, hip-level error, foot-lift height | Penalised only in the bad direction |
| **Two-sided** | Elbow angle, wrist height, limb directions at a phase | Penalised either way |

---

## 4. Alignment: events first, then posture

### 4.0 Alignment features (Tier B/C)

- **De-meaned per unit, not per take.** Each teacher unit and each candidate student window is centred on its own mean, computed with prefix sums inside the DP. Footwork phrases are centred over the matched phrase. Scale is a fixed per-feature value (dead_f, or 0.1 for unit-vector components).
- **Velocity after time normalisation.** It is computed on the resampled student grid (× the ratio), and per phase in Tier B. Unit test: a 2× student costs the same as a 1× student.
- **Per-cell distance:** d = Σ w·|Δ|² / Σ w, with w = min(visibility, teacher and student).
- **Masked frames** (`NOT_VISIBLE`, `SUSPECT_ID`, `GLITCH`, out of frame) get the **neutral cost**: the median of row minima of C over unmasked frames. Masked cells are **excluded from normalisation** (divide by the number of unmasked matched query frames). The same mask positions apply to the null.
- **Confidence is relative.** Tier B's null is the cost against the template at non-matching phases (circular shifts of ¼, ½ and ¾ phrase). Tier C's null is the median of the matching function outside ±1 length of the chosen match. **Aligned** means cost ≤ 0.7 × null. **Step identity** means best ≤ 0.8 × second best.

### 4.1 Strikes

**Lift signal (R27).**
- **Differential lift:** d(t) = y_L − y_R of the ankles in the gravity frame. Both ankles share the hip origin, so hip bounce, rising aramandi and standing frames cancel.
- The same quantity is computed in upright screen pixels ÷ torso pixels. **Per take, the version with the higher SNR is used.**
- **Baseline:** d0 = median of d over frames where both ankle speeds are low.
- **Jitter:** σ_j = SD of d on those frames.
- A lift of foot X is d − d0 above threshold in X's direction. The **planted foot** is the other one, or both when |d − d0| is below threshold. hipDrop uses this planted foot.

**Detection, iterative (no circularity).**
1. **Candidates:** peaks of |d − d0| above 3σ_j, plus clean stamp onsets (§2.2).
2. **Speed sections** from the combined onset train (§4.3).
3. **Per-section threshold:** max(3σ_j, 0.4 × the section's median lift). Re-detect.
4. **Audio can add.** A stamp inside a periodic stamp run, with any ankle vertical-velocity peak within ±1 sample, becomes a strike. The foot is the ankle with the larger vertical speed, otherwise `?`.
5. **Audio can veto.** In a take where stamps confirm ≥ 70% of pose landings, a landing with no stamp is a **placement**, not a strike. Placements never count as strikes on silent slots.

- The rule of ≥ 2 lifted samples applies only at 1st and 2nd speed.
- **Strike time:** the moving ankle's velocity minimum, refined to sub-sample time. A paired stamp time replaces it.
- **Being in a dance run for 0.5 s only down-weights** a first strike that no stamp confirms. It never drops it.
- **Both feet airborne** (the Namaskaram jump) is a `jump` event in screen space and is not part of strike strings.

**Fair sampling.**
- **fps gate:** count, silence and same/switch tips need a median IOI ≥ **5 samples** at the take's effective fps in that section, or stamp confirmation. Otherwise: "Too fast to count at this camera's frame rate: try 1st speed or a laptop."
- When the reference is a bake, its strikes are re-detected on its lanes **subsampled to the student's effective rate**, so both sides have the same sensitivity.

**Strike confidence per take.** Inputs: lift SNR (median lift / σ_j), the share of landings confirmed by stamps, and leg reliability. Pattern tips need either stamp agreement for that phrase, or SNR ≥ 4 with good leg reliability and the fps gate passed. Otherwise the app abstains: "I couldn't count your strikes clearly: wear something that shows your ankles or practise on a hard floor."

### 4.2 Patterns

**Reference phrase P.** Slots `{foot R|L, strike|rest, duration in pulses}`, taken from:
- a pattern card;
- a studio reference;
- in P3, the teacher's own strikes.

**Teacher's own phrase (P3).**
- Built from the **image-side** string {iL, iR, _}, which is always observed. It is the smallest exact repeat.
- If that repeat needs an L/R swap, the phrase is 2p and the half-phrase parity is recorded.
- Unit tests: Adavu 1 → 2, Adavu 3 → 6, Adavu 7 → 16 slots.
- The base pulse is the largest common subdivision fitting the IOIs (candidates p, p/2, p/3, minimising quantisation error), not the median. This keeps Adavu 8's quicker strikes.

**Cyclic alignment (R28).** A DP over (student strike i, reference position j mod |P|). Start and end are free, so no student period is needed.

| Move | Cost |
|---|---|
| Match | 0 if the foot agrees under the mapping, otherwise 1 |
| Insertion | 1 |
| Deletion | 1 |
| Timing term (added to each match) | 0.5 · \|log(IOI_i / (slotDur_j · τ))\| |

- τ is the local tempo from a first, foot-only pass (a running median of IOI ÷ slot duration).
- It is run under both image→foot mappings. Mapping-invariant errors are always reportable; side-specific ones only with known laterality (§4.8).
- The timing term breaks ties, so the answer to "which of three strikes was missed" is consistent.

**Errors.** An edit is reported only when the **same edit recurs at the same reference position** in ≥ 50% of aligned phrases and ≥ 2 phrases:
- missing or extra strike (count);
- strike on a silent slot (needs stamp confirmation or a veto-capable take);
- same/switch error.

**Phrase correctness.**
- The share of phrases that align exactly.
- If it is under 50% while detection is confident and no single edit recurs, the tip is: "**Keep the count.** 2 of 6 phrases had the right strikes; say the sollukattu aloud." Importance 0.95.
- A per-phrase ✓/✗ strip appears on the timeline.

**Version check (R33).**
- Before the first take against a card or studio reference, the app shows the strip ("This version: R R R · L L L") with a looping demo (3D figure or studio video) and asks: "**Is this how you learn it?** Yes / My version differs".
- A student take that is **self-consistent** (≥ 85% self-repeat) but differs from P in **every** phrase gets: "This looks like a different version of the step: pattern not judged." Side tips are skipped.
- Wording is always relative: "this reference strikes three times on each side".

**Start foot.** Taken from the first aligned student strike and its reference position. A tip is given only when that strike maps to position 1 of the phrase or half-phrase with the opposite foot, **and** laterality is known.

**Templates.**
- **12 samples per slot**, rests included, so detail per strike is constant across speeds and steps.
- Odd half-phrases are **mirrored** (L/R indices swapped, x negated) before averaging when parity is recorded.
- Key postures sit at the landings.

### 4.3 Speed sections and pairing

**Sections.**
- Fit two models to log residual IOI (IOI ÷ slot duration):
  - piecewise-constant (binary segmentation, ≥ 4 strikes per section);
  - linear trend.
  Choose by **BIC**.
- A ramp is a drift finding (rushing or dragging), never a section.
- Labels are relative to the take's slowest section, snapped to {1, 2, 4} with geometric bands. A ratio within 10% of a band edge is "uncertain".

**Pairing.**
- **≥ 2 student sections:** the monotonic assignment to teacher sections that minimises Σ|log(student pulse / teacher pulse)| + pattern edit cost.
  - If it differs from pairing by position, or the margin is weak, ask with a prefill: "You started at 2nd speed?"
- **Single section:** ask, prefilled.
- **"Not sure":** speed-invariant features only.

**Under-doubled.** When the card's ladder says ×2 and the student's ratio between neighbouring sections is < 1.6: "Make 2nd speed twice as fast."

**Slow motion (teacher files, P3).**
- Detected from the video: > 30% duplicated consecutive source frames, or motion blur that doesn't match landmark speed. Audio mismatch is supporting evidence; strike rate is only a hint.
- Flagged sections get a looping preview chip. A section is never excluded just for being slow.

### 4.4 Templates per speed section

- **Footwork:** phrases are warped piecewise-linearly between strikes onto the per-slot grid, then averaged.
- **Cyclic non-footwork (v2):** DBA.
- A section needs ≥ 2 reps for a template; with fewer it gets Tier A only.
- Non-cyclic units are 2–6 s, cut at **any stillness minimum ≥ 0.2 s**.

### 4.5 Tier A: posture quality, no alignment

- **Eligible features:** a within-template 10–90 percentile range ≤ 2 × dead_f.
- **Per paired section:** median, 10th/90th percentiles, spread, and a per-phrase trend.
- **Hold steps** skip alignment. They compare the held-posture distribution over the student's **stillest ≥ 2 s window**.
- Short takes and the "Posture: …" wording are as before.

### 4.6 Tier B: event-anchored phase shape (P3)

- Student and teacher phrases are paired by the cyclic alignment. Time is warped piecewise-linearly between matched strikes.
- **Confidence, all of:**
  - ≥ 70% of strikes matched;
  - **residual** IOI CV ≤ 0.3 per section;
  - shape cost ≤ 0.7 × the phase-shift null.
- Shape tips are suppressed at 4×.

### 4.7 Tier C: chunked subsequence DTW (v2, non-footwork)

```
D(n,m) = C(n,m) + min( D(n-1,m-1),
                       D(n-1,m-2) + 0.5·C(n,m-1) + λ,   // skipped student frame charged
                       D(n-2,m-1) + C(n-1,m)   + λ )    // skipped query cell charged
λ = 0.1 · median row-min(C)
```

- **Scoring and persistence** use **every student frame in the matched span**, each mapped to the nearest path query index.
- **Ratio candidates** {0.5, 1, 2} × event-rate ratio are compared on a coarse 5 fps pass. Only the winner is refined in a ±1 s band.
- **Null:** the matching function itself, so it costs nothing extra.
- **Budget:** 9 units × 2 min student is about 2 M cells, roughly 0.3 s on desktop and 1–1.5 s on a phone, in a loop that yields every 50k cells.
- **Chains, coverage and cyclic repeats:** as in round 3.
- **Unit tests:**
  - every 2nd frame dropped;
  - a missing hold costs more;
  - a 0.5 s gross arm error is scored on ≥ 90% of its frames;
  - a 1 s mask inside a 4 s unit still passes;
  - a 40% partial take with deep sits later in the reference aligns.

### 4.8 Laterality: no side claim without facts

**Student mapping.**
- **Recorder:** unmirrored, **verified by the anchor**.
- **Upload:** the anchor and the camera answer must agree.

**Reference → student mapping.**
- **Pattern cards and studio references:** known.
- **Teacher files:**
  - the question "Which foot should YOU start with?" is preselected to **Not sure**;
  - a side is accepted only when **two signals agree**: the answer, and the start foot of the student's own first take (if they disagree, ask once more showing both stills);
  - side findings for teacher files are phrased as a check: "You started on the other side from the teacher as shown. Check which foot your teacher wants you to begin with."
  - Mappings are stored **per facing section** (§2.5). A section whose facing is ambiguous, or whose converted string disagrees with the cue, gets no side tips.

**Mirror view, symmetric steps, and mirrored-cost logic on non-symmetric steps:** as in round 3.

### 4.9 Playback mapping and early/late

| Case | Student t → reference t |
|---|---|
| Recorder take | Logged clock **per loop iteration**, minus the lag for that iteration |
| Footwork | Piecewise-linear between strikes matched by the cyclic alignment |
| Tier C | DTW path |
| Low confidence | First dance frames lined up |

**Lag** is estimated per iteration and section by cross-correlating the strike trains over ±1 phrase. Strikes are paired **through the cyclic alignment** (foot + phrase position), never by nearest time.

**Early/late** is shown only for big-screen dance-along takes, excluding 1 s after each seam. Variation under 100 ms is ignored.

---

## 5. Scoring

### 5.1 Features (gravity frame, mid-hip origin, lengths ÷ take medians)

| Group | Features |
|---|---|
| Legs | **Planted hipDrop** (differential planted foot); foot-lift height; knee angle L/R; knee spread / hip width; heel gap; **knee-over-toe**: image-plane angle between the thigh/shin direction and the heel→foot_index direction (landmarks 29–32); **heel lift**: planted heel height vs foot_index; **flat landing** (beta): heel and toe velocity minima within 1 sample |
| Torso | Lateral tilt; hip level vs the heel line; shoulder level; forward lean (side-on views only) |
| Arms | Elbow angle; wrist height vs the shoulder line; lateral extension; upper-arm frontal direction |
| Rhythm | §4.2, §5.3 |

The view check is as before: depth features are off when the views differ by > 35% or yaw > 30°.

### 5.2 Penalties, safety gate, bands

**Penalty.** `p = clamp((e_bad − tol_f) / (3·dead_f), 0, 1)`, measured in the penalised direction only. Glitch exclusion uses tracking evidence only (unchanged). A persistent, confidently tracked large error is real.

**Safety gate on depth (R32).**
- A depth tip ("lower") is allowed only when knee-over-toe **and** heel-down are judged and within tolerance.
- **Knees roll in:** the leg tip becomes "**Open your knees over your toes before going lower**", and the depth tip is suppressed.
- **Knees or heels not judgeable** (saree, low reliability): no "sit deeper" tip.
- A depth tip never asks for more than **half the remaining gap** ("a little lower").

**Group band.**
- Computed from the **worst persistent feature penalty** (the maximum over features that meet persistence). The mean is kept only for internal ranking.
- **Never better than "Getting there"** when a correction from that group is shown.
- Shown only when the group's core features were judged:
  - **Legs:** depth + knee-over-toe;
  - **Arms:** per mode;
  - **Torso:** lateral tilt.
- Otherwise it reads "**Partly checked**: depth only", followed by what wasn't checked.

| Band | Worst persistent penalty |
|---|---|
| Excellent | < 0.10 |
| Good | < 0.25 |
| Getting there | < 0.50 |
| Needs work | otherwise |

Bands are provisional per template until the template passes §9. The UI shows no numbers.

**Not-checked notes.** Until the flat-landing and heel-lift templates pass calibration, the footwork chip shows "**Not checked: flat-sole strikes**" and quotes the cue. A missing tip is never read as a pass.

### 5.3 Rhythm

1. **Pattern first** (§4.2).
2. **Evenness** uses **residual** IOIs (IOI ÷ slot duration · τ). All of these must hold:
   - 1st speed;
   - the reference's residual CV < 0.1;
   - the student's CV − the reference's CV > 2 × floor, where `floor = √(2·(Δt²/12 + σ²)) / mean IOI` and Δt is 10 ms for stamp-refined strikes, otherwise the **effective** source interval;
   - pose-only evenness is off below 20 fps effective;
   - 2nd speed needs stamp refinement, and 3rd speed is stamp-only.
3. **Rushing/dragging:** the BIC trend model (§4.3), or residual drift > 15% for ≥ 4 strikes against her own section. Never against the reference's tempo.
4. **Early/late:** §4.9.

---

## 6. Feedback

### 6.1 Candidates and ranking

**Sources:**
- Tier A differences beyond tolerance, trends and mode violations;
- pattern errors, phrase correctness and start foot;
- Tier B/C phase differences;
- the "stayed standing" finding;
- reference-free habits (§6.3).

**Ranking:** `severity = importance × p × persistence × confidence`.

| Group | Importance |
|---|---|
| Legs / aramandi | 1.0 |
| Pattern / count / phrase correctness | 0.95 |
| Side / start foot | 0.9 (known laterality only) |
| Torso | 0.8 |
| Arms | 0.7 (0.9 in natyarambhe) |
| Rhythm evenness | 0.5 |
| Hands | 0.5 |

- ×1.3 at key postures.
- **Legs first:** if Legs is "Needs work", arm tips under 25° excess are suppressed.
- Left and right versions of a tip merge ("both knees").
- **Persistence:** cyclic steps ≥ 2 reps and ≥ 25% of frames; non-cyclic ≥ 25% of the unit and ≥ 1 s continuous; holds ≥ 25% of the hold.

**Strengths.**
- Only from features whose tolerance is ≤ 2 × measured noise, in groups with no gated sub-features.
- Worded exactly as measured.
- Never "deeper than the demonstration".

**Session focus (hysteresis).**
- The session's focus feature stays until its change exceeds 2 × the retest spread, or it passes tolerance.
- A new tip must beat the focus by more than the retest noise.
- After the first take, results open on the focus ("Depth: better / about the same"). Other corrections sit behind "**More tips**".
- At most 3 corrections, 1 strength and 1 focus. When nothing qualifies, an explicit reason is shown.

### 6.2 Wording

- The reference is called "**the reference**", "this demonstration", the teacher's name if given, or "the NrityaVaani version". **Never "your Guru".**
- A standing line under the tips: "**If your teacher says otherwise, follow your teacher.**"
- Each tip: an imperative, an external-focus image, the term with a gloss, and relative evidence. The cue is quoted when one exists. "It looks like…" marks medium confidence.
- About 30 templates keyed `feature:direction`. English in P2; Hindi in v2.

### 6.3 Reference-free habits (pattern-card-only students and YouTube mode)

Labelled "**General posture habits: not compared with a teacher.**" They run on held aramandi frames only:
- aramandi present (planted hipDrop ≥ 0.08) and **level across reps** (trend);
- knees over toes; heels down;
- torso steadiness (spread);
- hands on waist (Thattadavu mode);
- L/R consistency between the two halves of a phrase.

**Heels together is opt-in:** "Does your teacher keep the heels together?"

### 6.4 Example tips

1. **Legs (gated):** "**Sit a little lower in aramandi, keeping your knees over your toes.** Through Adavu 2 your hips stay about half as low as in the reference. ▸ You 0:14 · Reference 0:58"
2. **Safety:** "**Open your knees over your toes before going lower.** Your knees point forward while your feet turn out."
3. **Pattern:** "**Three strikes on each side.** In 5 of 6 phrases you struck twice on each side; this reference strikes three times. *Cue: 'Right, right, right — then left, left, left.'*"
4. **Count:** "**Keep the count.** 2 of 6 phrases had the right strikes; say the sollukattu aloud."
5. **Silence:** "**Count eight is silent in this version.** Your feet stamped on eight in every phrase."
6. **Ladder:** "**Make 2nd speed twice as fast.** You went about 1.4× faster."

- *Abstain:* "I couldn't count your strikes clearly: wear something that shows your ankles or practise on a hard floor."

### 6.5 Gates (any one blocks a tip)

- Coverage < 60%.
- Within tolerance, a free feature, or the good side of a one-sided feature.
- Persistence not met.
- View, clothing, tilt or **out-of-frame** gates.
- Tier B/C confidence failed (blocks phase tips).
- **Strike confidence or the fps gate** failed (blocks pattern tips).
- **Version mismatch** (blocks pattern and side tips).
- Laterality unknown (blocks side wording).
- **Depth safety gate.**
- 4× speed (blocks shape tips).
- The template has not passed its calibration gate: the tip is hidden, or shown labelled beta.

**"Show me", ghost and red joints:** gated as in round 3. The ghost is labelled "approximate".

**"This tip is wrong"** is stored locally.

**Take-to-take arrow:** only on the focus feature, when the change is > 2 × the retest spread.

### 6.6 Voice

- "Hear it" reads the focus tip via `GuruAudioEngine.syncLine` with a 6 s timeout, falling back to Web Speech.
- **Beta tips are never voiced.** Hedges are kept in the spoken text.
- Button note: "Tip text (not video) is sent to our voice service."

---

## 7. Student flow and UI (`/compare`)

**Stepper:** **1 Reference → 2 Step → 3 Learn → 4 Your take → 5 Feedback.** State lives in `?project=…&step=…`. The page uses the house shell and is added to `NAV` and to the `SiteBackdrop` hide list.

1. **Reference:** cards for Pattern cards / Studio references / Upload file / YouTube. For files: range → "Prepare", with an honest ETA, a resume banner, and Learn available at once.
2. **Step:** a named step, or in/out marks; the version check; the teacher-file questions (start foot, clothing, facing).
3. **Learn:** loop at 0.5/0.75/1×, mirror view, skeleton toggle, mode card.
4. **Your take:** recorder (mode choice, framing check, hands-free) or upload; "Which speed?" when needed. The wait is shown before recording.
5. **Feedback:**
   - dual pane (stacked on mobile), with the student clock as master;
   - the Guru pane shows the reference skeleton or video per the 0.9–1.1 rate rule;
   - the error timeline has a per-phrase ✓/✗ strip, step-run lanes ("other step: not judged") and coverage;
   - band chips, focus card, More tips, Record another take, Save.

**Error and empty states**

| Situation | What the user sees |
|---|---|
| Model download failed | Retry |
| GPU failed | CPU mode note |
| HEVC | Settings / H.264 message |
| No person | "Is your whole body in frame?" (only after the delegate test passed) |
| Several moving people | Picker |
| Small dancer | Pixel-size message |
| Tab hidden | Paused |
| Storage evicted | "Prepare again" |
| Storage full | "Clear old analyses" |
| Nothing matched | Tier A + "Did you dance this step?" |
| Many cuts | Posture only |
| **Camera denied** | Per-browser steps to re-enable |
| **Camera busy** | "Close Zoom/Teams" |
| **No camera** | "Upload a take" |
| **Mic denied** | Continue without audio |
| **In-app browser** | "Open in Chrome/Safari" + copy link |
| **MediaRecorder unsupported / insecure context** | Upload |
| **Too dark / low fps** | Light advice |
| **Camera effects on** | Per-OS steps |
| **Take lost on reload** | Plain message |
| **Version differs** | Pattern not judged |
| **Too fast for this frame rate** | Message |

---

## 8. YouTube "Practise beside" (P3)

### Link parsing

The link is parsed with `URL`:
- **Hosts:** youtube.com, www., m., music., youtube-nocookie.com, youtu.be.
- **Paths:** `/watch` (with `v=` anywhere in the query), `/shorts/ID`, `/embed/ID`, `/live/ID`, `/v/ID`.
- `si=` is stripped.
- `t=` / `start=` (`95`, `1m35s`, `1h2m3s`) prefills "Mark start".
- Unit tests cover each form.

### Facade and lookup

- **Facade:** a neutral placeholder. Nothing is fetched from `i.ytimg.com` before the click.
- **Lookup:** `GET /api/yt/meta?id=`, hardened:
  - id regex;
  - Origin/Referer allow-list (Netlify domain, localhost);
  - per-IP rate limit (30/min, 500/day);
  - in-memory LRU cache for 24 h, plus the client cache for 7 days.
- **Timing:**
  - the warm-up ping is sent only **after a link is pasted**;
  - if the lookup hasn't returned within 3 s, the player loads on click and the lookup is retried in the background and logged when done.
- **Tracking:** no embed ever sets tracking (facade, nocookie, no autoplay), so Made-for-Kids compliance doesn't depend on the lookup's timing.

### Player

`www.youtube-nocookie.com/embed/ID?enablejsapi=1&origin=…&controls=1&playsinline=1&rel=0`. No autoplay. ≥ 480×270 on desktop, never below 200×200.

### Nothing over the player

- The navbar is `absolute` on this page, `LiveChat` returns null, and the page never calls `toast()`.
- **When any overlay opens while the player is mounted** (mobile nav menu, dialogs, selects), the player is paused and swapped for the facade until the overlay closes.
- Playwright `elementsFromPoint` checks run in the idle, menu-open and dialog-open states.
- No CSS mirror, scale or filter on the iframe.

### What the student gets

1. **Step marks:** "Mark start/end" from `getCurrentTime()`, saved in `nv_yt_marks`.
2. **Loop and slow motion:**
   - `seekTo(start, true)` at end − 0.15 s, then wait for `onStateChange` before trusting the time;
   - rates only from `getAvailablePlaybackRates()`;
   - an ad or a stall shows "**An ad or buffering interrupted the loop. Press play to continue**", with a hint to mark steps away from ad breaks.
3. **Declare the step.** A Thattadavu adavu (pattern card + version check) or a step family.
4. **Take flow:**
   - **Record:** the recorder in YouTube mode. **The player is the clock:** `getCurrentTime()` and state are logged per frame, and frames are unsynced when the player isn't PLAYING or time stalls for 500 ms. The take is **video-only**, so YouTube's sound is never re-recorded.
   - **Or upload** a take.
   - **Then:** bake. Her take plays with its skeleton in a "You" pane **beside** the untouched player. The player follows coarsely, via `seekTo` at logged or marked times at phrase boundaries, and is never scored against.
5. **Outputs:**
   - her skeleton on her own video;
   - pattern, count, phrase correctness and start foot against the pattern card (declared adavu, version confirmed);
   - reference-free habits (§6.3);
   - posture comparison only through a studio reference of the same step ("Compare with the NrityaVaani version"). **The app never invites uploading "this" video.**

| Family | Rules |
|---|---|
| Thattadavu family | Pattern card + habits; the heel rule is opt-in |
| Natyarambhe arms | Wrist and elbow at the shoulder line + universal habits |
| Natta / Mettu / Kuditta / Other | Universal habits only |

### Errors and legal pages

- **Errors:**
  - 101/150/age-restricted: "This video can't be played here."
  - 100: "Video not found or private."
  - 153: a referrer problem. A comment in `next.config.ts` warns never to add `Referrer-Policy: no-referrer`.
- **New `/terms`:** YouTube ToS binding (with link); rights to uploads; a parent or guardian for under-13s (or the local age of majority) when using YouTube and recording.
- **`/privacy`:**
  - YouTube API Services, with the YouTube ToS and Google Privacy Policy links;
  - "YouTube is contacted only after you press play";
  - "We don't track you; YouTube videos you choose to play are third-party content";
  - edge-tts disclosed.

**Explicitly not built:** server download, tab capture, a canvas over the iframe, a skeleton derived from YouTube, bakes keyed by `youtubeId`.

---

## 9. Calibration and tests

### Harness (P0)

- `scripts/bake-fixtures.mjs` drives Playwright with **`channel: 'chrome'`** (branded Chrome, so H.264/AAC decode). Alternatively, an ffmpeg pre-step transcodes fixtures to VP9/Opus WebM and the transcode is recorded in the header.
- **Delegate check:** P0 bakes 3 clips on GPU and on CPU. If any feature differs by more than ¼ dead band, the calibration fixtures are baked on the GPU through the dev-only "Export bake" button.
- **Tests:** `node --test --import tsx`. Raw lanes let every downstream change re-run in seconds.

### Synthetic suite

All built from real bakes:
- time warps; 1→2→4→2→1; a 0.35 s cycle; 2/8/16 s phrases;
- **standing start + ±3 cm hip bounce + aramandi rising 0.05** → 100% of strikes kept;
- **first strike dropped**, **start at count 4**, **mixed 2/3/4 counts** → no false count or start-foot tip; phrase-correctness tip only for the mixed case;
- **correct Adavu 5–8 with 15% jitter** → Tier B passes, no rhythm tip;
- **3rd-speed Adavu 1 with 2 cm lifts + audio** → ≥ 90% of strikes, a 3rd-speed section found;
- **Adavu 1–4 concatenated, declared Adavu 3** → only that run scored;
- period tests (2/6/16);
- template lift amplitude preserved;
- a 2× student = 1× cost;
- the sDTW skip tests;
- 1 s mask inside a 4 s unit;
- a 40% partial take;
- 7° camera roll; uneven sampling;
- a **15 fps source** for a 24 fps target (no duplicate stamps);
- tripod active area;
- a mirrored back-camera take on a symmetric step.

### Real calibration (budget = clips × templates)

**v1 templates:**
1. aramandi depth (with the safety gate)
2. aramandi rises (trend)
3. knee-over-toe
4. count error
5. silent-slot strike
6. start foot

- **Instances:** each needs ≥ 20 error instances in split B plus about 20 in split A. That is **6 × 40 = 240 deliberate-error step-takes** of 20–30 s, plus **40 good takes**.
- **Recording:** 4 people across 3 sessions in weeks 1–3, owned by person D, about 6 h of recording in total.
- **Labelling:**
  - pattern, count, silence and start foot are labelled **by listening**, blind, by any team member;
  - posture is labelled by the reviewer, blind, including **magnitude** (subtle / clear).
- **Split** by dancer and session.

### Gate per template, on split B

- **Detection limit** = 2 × test-retest SD for that feature.
- Recall ≥ 80% on errors **above the limit**.
- Errors below the limit must produce **no wrong-direction tip**; they are listed as a blind spot.
- Wilson 95% lower bound on precision ≥ 0.75 over ≥ 20 instances (that is, ≥ 19/20).
- No high-confidence false tip on good takes, and ≤ 1 correction per good take.
- Pattern templates are gated **per effective-fps tier** (24 / 15 / 10).
- **Beta:** recall passes but there are too few instances.

### Required real cases

- saree + carpet, correct pattern → no tip;
- music playing; salangai; speaker bleed;
- 15 fps webcam; CPU at 10 fps;
- mirror wall; poster; parent on the sofa;
- Namaskaram bow and a 180° turn → no `SUSPECT_ID`;
- elbows 15–20° low → arm tip;
- knees rolling in → safety tip, no depth tip;
- a student deeper than the reference → no correction, no praise;
- **naive testers answering the start-foot question unaided**;
- a front-then-back teacher;
- a different-bani version → "different version";
- portrait clipping of natyarambhe;
- an auto-framing webcam;
- test-retest.

---

## 10. Reuse map and new modules

**Reused**
- `retarget.ts`: types, `P`/`H`, track functions via `lib/motion/track.ts`, `BODY` exported.
- `segment.ts`, scaled for fps.
- `manifest.ts`: cues and steps feed the pattern cards.
- `lib/voice/*`, `editorial.tsx`.
- `classification.ts` + `mudras.ts` in v2. Distances will be normalised by palm size (wrist → middle MCP), crops taken from the **full-resolution source**, Katakamukha listed as unsupported until a rule exists, and a mudra tip given only when the expected mudra is supported and the reference's own frames classify ≥ 0.7.

**Restored from `287aba3`, with its known bugs fixed**
- `bakeStore` → `lib/compare/store.ts` (NVB2, raw lanes, user scope).
- The seek loop → the fallback reader.
- `drawOverlay` → `SkeletonCanvas.tsx`.
- Hand crops in v2.

**New: `frontend/src/lib/compare/`**

| Module | Purpose |
|---|---|
| `extract/{reader,pool,preflight,people,identity,shots,clean,camera}.ts` | Reading, landmarker pool, preflight, extra-people classes, signature + re-acquire, cuts/view/facing, cleaning, gravity correction |
| `record/{recorder,loop,remux,tempStore}.ts` | Recorder, gapless loop, Mediabunny remux, temp takes |
| `audio.ts` | Clean-audio gates, stamp detector, offset |
| `events.ts` | Differential lift, iterative strikes, sections (BIC), fps gate, strike confidence |
| `patterns.ts`, `cards.ts` | Cyclic alignment, phrase correctness, version check, step runs; the pattern card table |
| `features.ts`, `structure.ts`, `templates.ts` | Features, states, templates |
| `align.ts` | Tier B (P3), Tier C (v2) |
| `rules.ts`, `score.ts`, `tips.ts`, `tips.en.ts` | Habits, penalties, gates, bands, tips |

**Elsewhere**
- `lib/youtube/{parse,player,loop,meta}.ts`
- `components/compare/*`
- `app/compare/page.tsx`, `app/terms/page.tsx`
- `public/references/*`, `scripts/*`
- **Backend:** only the hardened `GET /api/yt/meta`.
- **Dependencies:** `mediabunny` (runtime, P1); `tsx` and `playwright` (dev).
- **Rule:** read `node_modules/next/dist/docs/` before writing code.

---

## 11. Limits, performance, privacy

**Caps**
- Teacher source: unlimited. Processed range ≤ 3 min. Step 4–90 s.
- Student take ≤ 2 min; the default auto-stop is about 15–45 s.
- Frame rate: min(15 or 24, effective); 10 on CPU.

**Estimated processing time** (re-measured in P0)

| Job | Desktop | Mid-range phone |
|---|---|---|
| Teacher 3 min at 15 fps | ~1.5–3 min | ~6–9 min (shown up front; Learn works meanwhile) |
| Student 30 s take | **live** (≈ 0 s after Stop) | ~1–2 min |
| Pattern card / studio reference | 0 s | 0 s |

**P0 budget.** If a 30 s take takes > 2 min on the reference phone, phones use 15 fps for footwork with the fps gate.

**Privacy.**
- All vision runs on the device.
- Temp takes last ≤ 24 h; kept takes expire after 7 days; delete-all is available; storage is user-scoped.
- The backend sees only a YouTube id and tip text.
- The studio dancer gives written consent.

---

## 12. Plan and the decisions I need from you

**Phases: P0 (1 week) + 6 weeks, 4 students**

| Phase | Work | Cut first if late |
|---|---|---|
| **P0** (5 days) | Mediabunny decode and remux on laptop, Android and iPhone; seek-loop fallback; `setOptions` reset + soak test; GPU/CPU self-test; HEVC; a 4 GB file; MediaRecorder formats; **iOS playback with the mic open** (speaker, wired, AirPods); mic DSP flags; `tsx` test; Playwright with Chrome channel + GPU/CPU delta; **reviewer confirmed; studio recording booked** | — |
| **P1** (wk 1–2) | `/compare` shell; **privacy rewrite + delete-all + user scope**; reader; pool; teacher file (one range, detailed bake, skeleton, Learn); recorder (camera first, framing check, two modes, hands-free, phrase-snapped gapless loop, remux, temp store); upload a take; preflight; extra-people classes, picker, signature + re-acquire; cleaning + camera correction; side by side; NVB2. **D:** pattern cards + clip verification; calibration recording starts. **No scores.** | Split-screen handling |
| **P2** (wk 3–4) | Event layer (differential lift, audio policy, iterative strikes, cyclic alignment, phrase correctness, version check, sections + pairing, fps gate, step runs); Tier A + safety gate + bands; laterality; en tips; per-template gates and beta; **live detection** in the recorder; studio references (if recorded); teacher-file step marks | Live detection (falls back to post-bake) |
| **P3** (wk 5–6) | YouTube practise-beside (take flow, hardened meta, overlay rule, `/terms`, privacy additions); Tier B + ghost + error timeline; teacher-file structure pass, STANDING_HOLD, proposals, slow-motion flag; session focus; voice; StatsService `kind` | Voice, proposals, ghost |
| **v2** | Tier C and the Namaskaram sequence steps; `.nvref`; several ranges; mixed-view templates beyond the 25° filter; mudras; Hindi; worker; rig references | — |

**Team split**

| Person | Owns |
|---|---|
| A | Extraction, pool, recorder, storage |
| B | Events, patterns, scoring (pure TS + tests) |
| C | UI, players, YouTube page |
| D | Pattern cards, studio and calibration recordings (weeks 1–3), labelling, legal pages, tip text |

**Decisions for you**

1. **YouTube:** practise-beside + pattern cards + habits, with no tab capture. OK?
2. **Studio references:** can the team get a consenting trained dancer? If not, pattern cards still ship. Posture comparison then needs a teacher file.
3. **A reviewer** for posture labels. Without one, only the pattern, count, silence and start-foot templates can ship, since those are labelled by listening.
4. **v1 = the Thattadavu path**; Namaskaram sequence steps and mudras move to v2.
5. **Mediabunny** as a runtime dependency from P1; `tsx` and `playwright` as dev dependencies.
6. **The recorder as the default,** with the microphone opt-in (off on iOS by default).
7. **P0 week + 6 weeks**, with the cut list above.
8. **Per-template gates with "beta" tips** allowed.

---

## 13. Known weaknesses (accepted)

- The literal "skeleton on the YouTube video" is not delivered. A YouTube-only student gets pattern-card checks and habits, and posture comparison only through a studio reference.
- MediaPipe's knee and depth limits, plus costumes, mean leg feedback is often withheld. The depth tip is withheld whenever alignment can't be seen.
- Pattern cards encode one version. Students of other banis get "different version" and no pattern tips.
- Phone processing for teacher files takes minutes. Live detection removes the student wait only on fast devices.
- Audio rhythm needs a clean recording, which many home takes won't have.
- Side tips need facts, so many uploads get side-free tips only.
- Full-body mudras, Namaskaram sequences and Hindi wait for v2.
- If the recordings or the reviewer slip, fewer templates ship. P1 still ships as a working practice tool: skeleton, Learn and side by side.

