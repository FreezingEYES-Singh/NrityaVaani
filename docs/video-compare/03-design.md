# Video compare feature: design (revision 3, after 3 red-team rounds)

> **Status:** DRAFT, not yet approved by the user.
> - This revision applies all 64 round-3 critic issues (5 critical, 24 high, 30 medium, 5 low). Where each one went is listed in `04-open-issues.md` → "Round 3: how each issue was resolved".
> - **Phase 1** is specified in detail in `05-mvp.md`. This file is the full roadmap.

# Guru Mirror (`/compare`): revised design (round 5)

A student practises one step next to a reference, and the feedback should be something a real teacher would agree with. When the app can't judge something, it says so plainly. No video frame leaves the device.

> This is the design only. No feature code has been written. You asked for the solution first, then your agreement and a plan, then code. §12 lists the decisions I need from you.

**Facts I checked in the repo and designed around**

- **`public/lessons/thattadavu.json` cues**
  - Aramandi: "Heels together, toes turned out… Torso straight; stay at the same height… Strike with the whole sole, flat… Always begin with the right foot".
  - Adavu 1 (50.9–85.9 s): "Strike right, then left… second twice as fast, the third twice again… up through the speeds, then come back down".
  - Adavu 2–4: 2, 3 and 4 strikes on each foot.
  - Adavu 5: "The same foot for all five… Two slow strikes, then three quick ones".
  - Adavu 6: "Two groups of three on one foot… A pause after each group".
  - Adavu 7: "Right on one, two, three. Left on four. Right on five, six, seven; eight is silent. Then begin with the left foot".
  - Adavu 8: "Alternate… The last three come quicker… eight is silent… Start right, then start left".
  - "Thattadavu" (intro) and "Practising" are talk steps, not danceable.
- **`public/lessons/namaskaram.json` steps**
  - Guru Vandana: anjali held, samapada, 19 s.
  - Samapada; Katakamukha (held mudra).
  - Aramandi: "Feet in a V shape, a bit of space between them", which differs from the Thattadavu heel rule.
  - Tapping: "Tap the right foot first and then lift. Right and left."
  - Shikhara + jump; Saluting around; Touching the ground (muzhumandi); Touching the eyes; Rising; The whole namaskaram.
- **Lesson audio** (`*-voice/*.mp3`) is spoken narration only. There is no sollukattu or beat track.
- **Overlap on the page:** the navbar is `fixed top-0 z-50`, `LiveChat` is `fixed bottom-4 right-4 z-[100]`, and the sonner `Toaster` sits bottom-right.
- **Auth:** the only always-present login is the Credentials "Demo Account", which returns user id `"1"` for everyone. Accounts therefore cannot separate data between people.
- **No `/terms` route exists.**
- **`/privacy` today promises** on-device inference, "No Recording or Surveillance", local storage, and "Zero Third-Party Tracking".

---

## 0. The short answer

### What changed in this revision

Round 3 showed two things:
- **The riskiest part of the old v1 was its headline part:** the Thattadavu strike/pattern layer. 4 of the 5 critical issues and about 10 high ones were there.
- **The user's main input, "upload any teacher video", got almost no feedback in v1:** a non-Thattadavu teacher file got one or two static checks.

So the build order is turned around:

| Phase | What ships | Why in this order |
|---|---|---|
| **Phase 1: core path** (`05-mvp.md`) | Any teacher **video file**: mark one step, get its skeleton. The student uploads a take (or uses the phone's own camera). The step is found inside the take, lined up, and gets ≤ 3 gated posture and speed tips, with "Show me", a ghost and synced playback. **Nothing about the student is stored.** | Answers the request for every dance and every step. Fewest failure modes. No dependency, recordings or reviewer needed. |
| **Phase 2: Thattadavu footwork** | Pattern cards with a **generated practice track** and the 3D figure. A simple recorder. A strike-event layer (raw lanes). Count, silent-slot, start-foot (recorder only), height-steadiness and knee-alignment checks. Calibration including children. | Catches what Phase 1 can't see (wrong number of strikes). Built with all round-3 fixes. |
| **Phase 3: wider inputs** | YouTube "practise beside". Studio references. Teacher-file structure pass, step proposals, several ranges, `.nvref` teacher packs. Full audio policy. Early/late with latency calibration. Extra-people classes. | Each needs Phase 1–2 underneath and has its own legal or device risk. |
| **v2** | Namaskaram sequence steps (chunked chains), mudras at body distance, Hindi, worker, rig references | As before |

### The original request, mapped

| You asked | What we build | Why |
|---|---|---|
| Upload a video **or** paste a YouTube link, then process it | **Video file:** Phase 1, processed on your device.<br>**YouTube link:** Phase 3, "practise beside": the player is shown untouched, and your take plays beside it with your skeleton. AI comparison needs a file. | No web page can read pixels from YouTube's player. Downloading breaks YouTube's ToS and API policy III.E.1, gets bot-checked on Render, and breaks our privacy promise. Tab capture is desktop-Chrome-only and conflicts with III.I.14 and III.E.4. |
| Show the stick figure on the YouTube video | Drawn on **our own `<video>`** for files. For YouTube it is drawn on the **student's** video, beside the player. | YouTube forbids any overlay in front of its player. |
| Student adds their video beside it and gets what's wrong plus tips | Side by side, synced by the alignment. Up to 3 corrections and 1 strength, each with "Show me" and a red/green joint. A ghost of the teacher on your body. | §4.7, §6 |
| "Not all movement is necessary, different lengths…" | **What gets judged** (§3):<br>(1) you mark the teacher's step;<br>(2) the step is **searched for inside your take**, so walking in, standing and extra tries are ignored;<br>(3) pauses inside the step are set aside;<br>(4) body parts can be switched off;<br>(5) a difference must last and repeat to become a tip.<br>**Lining up** (§4): time is stretched (DTW) so tempo, length and start point don't matter. Footwork (Phase 2) also lines up **strike sequences** against the phrase. | §3, §4 |

**Who gets what**

| Content | Phase 1 | Phase 2 | Phase 3 | v2 |
|---|---|---|---|---|
| **Any step, teacher's own file** | Skeleton, step found in your take, posture + speed tips, ghost, Show me | Footwork checks too, if you confirm the step is a Thattadavu adavu | Step proposals; several ranges; teacher packs | Chunked chains for long sequences |
| **Thattadavu Adavu 1–8, no video** | — | Pattern card + practice track + 3D figure; count, silence, start foot (recorder), steadiness, knee alignment | Ladder tips; early/late; inside "practise beside YouTube" | — |
| **Studio reference** | — | — | Posture comparison without a teacher file | — |
| **Namaskaram** | As "any step" if you have a file | Tapping: pattern card | — | Sequence steps; mudras |

`/live` and `/practice` remain the home of close-up mudra training.

---

## 1. How the design was attacked and rebuilt

| # | Proposal | What broke it | What survives |
|---|---|---|---|
| R1 | Server downloads YouTube | ToS / III.E.1, bot checks, 512 MB, privacy | Nothing on the server |
| R2 | Tab-capture the player | Desktop only, policy | YouTube = practise beside |
| R3 | Global DTW | Talk, partial takes, repeats | Step by step; subsequence search |
| R4 | Tempo ratio + frame DTW | Speed changes, rep counts | Event layer for footwork |
| R5 | One % score | Measurement error | Bands, ≤ 3 tips, abstain |
| R6 | Teacher = ground truth | Incidental motion | Body-part switches, persistence, one-sided features |
| R7 | Guessed thresholds | — | Calibration (now Phase 2, with children) |
| R8 | Long waits | — | Only the marked step is processed |
| R9 | Mixed model tiers | Different biases | One tier per project |
| R10 | One canonical cycle | Speeds inside a step | Template per speed section |
| R11 | Rescaled queries | Short queries match anywhere | Resample the student; step ≥ 2 s |
| R12 | Rig lessons as references | Rig ↔ MediaPipe bias | Rig shown as "animation, not compared" |
| R13 | Whole-step distributions | Partial takes | Aligned frame pairs only |
| R14 / R18 | Phase Viterbi | Can't advance fractionally | Removed |
| R15 | Absolute τ | Rejects beginners | Relative tests |
| R16 | Moving crop | Breaks tracking | Fixed crop (now the union of boxes) |
| R17 | Absolute alignment features | Constant offset | Relative confidence; offset-invariant or iterated alignment (R53) |
| R19 | sDTW skips cells free | Rewards skipping | Both skips charged |
| R20 | ACF finds the cycle | Long phrases, aliasing | Strike strings |
| R21 | Mirror from cost | Indistinguishable on symmetric steps | Laterality from facts; no side words without them |
| R22 | Absolute speed labels | No shared beat | Relative ladder |
| R23 | Posture gates on students | Drops beginners | Presence and motion only |
| R24 | Two-sided penalties, camera = gravity | — | One-sided, roll-invariant features |
| R25 | Generic YouTube rules | Flags choreography | Step families |
| R26 / R38 | Big scope | Can't finish or calibrate | **Re-cut again: R41** |
| R27 | Strikes from ankle height above a floor | Hip motion | Differential lift |
| R27b / c | De-mean per take; λ-only skip | Offsets; hops over bad frames | Per-span handling; every frame scored |
| R28 | Cut by the student's own period | Rotated phrases | Cyclic alignment with a free start |
| R29 | Pose proposes, audio refines | Bleed, DSP, music | One audio policy |
| R30 | Median-IOI pulse | Uneven adavus | Residual IOIs |
| R31 | One dead band | Misses arm lines | Per-feature, noise-derived |
| R32 | "Sit deeper" first | Injury risk | Safety gate (now on knee alignment, R47) |
| R33 | The reference *is* the step | Banis differ | Version check (now authoritative, R43) |
| R34 | Fresh landmarker per shot | Leaks | Pool; timestamp jumps (R52) |
| R35 | In-memory recorder take | Lost on tab kill | Remux + encrypted temp record (R50) |
| R36 | Dance along with a phone at 3 m | Can't see the teacher | Practice track + full-screen teacher |
| R37 | Single person | Mirrors, posters, class videos | Classes (now both mirror geometries, depth-aware, R48) |
| R39 | Comparison only with a studio dancer | Single point of failure | Pattern cards; Phase 1 needs no dancer at all |
| R40 | Static holds = TALK | Holds dropped | STANDING_HOLD; holds judged in their target state (R46) |
| **R41** | Thattadavu event layer as v1 | ~25 subsystems for 3 people; non-Thattadavu files got almost nothing | **Phase 1 = general core path** (whole-step subsequence DTW on posture) for any file. The event layer moves to Phase 2 with fewer templates. |
| **R42** | Clean all lanes with the mocap filters | `despike`/`stabilise` erase 2-sample, 3 cm lifts; σ_j ≈ 0 makes the SNR gate pass when detection fails | **Events run on raw lanes** (MediaPipe's own filter only; despike only jumps > 0.25 m). σ_j measured on raw still frames. The mocap chain is used for the overlay only. |
| **R43** | Label runs by the best card; consistent deviation = "different version" | The most common error (a neighbour adavu's count, a stamp on the silent count) was silenced | **The declared step has a strong prior.** A single-pattern take is always judged against it. A whole-take match to another card in the same lesson asks "Which were you practising?" The version answer is authoritative. |
| **R44** | Phrase correctness = share of exact phrases | 0.95¹⁴ ≈ 0.49: correct dancers fail | **Per-strike edit rate vs the detector's measured rate**, ≥ 4 fully judged phrases, partial phrases excluded |
| **R45** | Free-start alignment decides start foot | A wrong start is a zero-cost rotation | **Start foot only against a clock** (recorder count-in); uploads say "not checked" unless strictly confirmed |
| **R46** | Hold = stillest 2 s | Picks the standing pause | Longest run in the target state, then the stillest 2 s in it |
| **R47** | Safety gate on knee-over-toe angle + heel-down | Not measurable from the front; heel-down uncalibrated | **Knee alignment** = knee lateral offset vs the foot line ÷ hip width; heel-down "Not checked" |
| **R48** | Reflection = x-flipped motion; overlap = suspect | Front mirrors; people behind | Both mirror geometries + opposite facing; overlap counts only at similar depth; SUSPECT_ID needs 2 track cues |
| **R49** | A cut whenever the background moves | Handheld follow-pans | Continuous motion ≠ cut; roll per 2 s window; "handheld" preflight result |
| **R50** | Per-user storage scope | Every demo login is id "1"; expiry never runs | **Student video is never kept.** Phase 2 crash-resume record encrypted with a tab-only key; sweep on every page |
| **R51** | Hands-free anchor start/stop | iOS blocks late `play()`; gestures collide with choreography; children raise the wrong hand | **Tap to record**, unlock audio inside the tap, spoken countdown; stop by duration, tap, or walking out of frame |
| **R52** | `setOptions` reset per cut | Rebuilds the whole graph (0.5–2 s each) | Timestamp jump for cuts; rebuild only for crop or mode changes |
| **R53** | Per-window de-meaning inside sDTW | Not DP-decomposable | Relative dip test (Phase 1); offset-invariant features or iterate-and-refine (Tier C chains) |
| **R54** | Pattern cards with nothing to play | No sound, no clock, no reference pane | **Generated practice track** (Web Audio clicks above 2 kHz, selectable tempo and ladder) + the 3D clip span mapped to slots |
| **R55** | Ladder pairing by absolute pulse; BIC staircase | A rushing 1st speed looked like a ladder | Piecewise-linear sections; change point only for a ≥ √2 jump; pairing by neighbour ratios; with a clock, name the section that is off |
| **R56** | Questions before the first take | About 12 prompts, mostly "Not sure" | Ask after the take, only to unlock a withheld tip, ≤ 2 per take |

Remaining risks are in §13. They are accepted, not unhandled.

---

## 2. Inputs and extraction

### 2.1 References

Every reference becomes one object:

```
Reference {style, steps[]}
step = {name, cues[], kind: general|footwork|hold, modes, pattern?, practiceTrack?, clipSpan?, lanes?}
```

**`kind` is never chosen by a student** (round 3: a wrong "cyclic" choice switched off the whole event layer):
- `general` by default;
- `footwork` only when the step is a pattern card, or the student confirms the teacher's step is a named Thattadavu adavu;
- `hold` when ≥ 60% of the marked step is still (automatic).

**(a) Teacher file (Phase 1).**
- `<input type=file accept="video/*">`, played from an object URL in our own `<video>`. Never uploaded.
- **Rights line:** "Use videos you made or have permission to use."
- Codec check, with the HEVC message.
- **The step is the unit.** The picker asks "Mark just the step you'll practise (usually 10–40 s)". It defaults to 30 s around the playhead and shows the ETA live.
  - Phase 1 cap: 2–60 s.
  - Only the marked step is processed, so a 50-minute class file is fine.
- **Phase 3:** 2–3 ranges with a combined cap of 3 min, for demonstrations spread across a class (for example 1st speed at 4:10 and 2nd/3rd at 10:50). Until then this is a known gap (§13).
- **Phase 3, `.nvref` teacher packs:** a teacher or team member prepares a step once on desktop and exports the lanes plus the step JSON (a few MB). Students import it instead of each one trimming and processing the same file.
- The creator helper text: "Your own YouTube video? Download it from YouTube Studio → Content → Download."

**(b) Pattern cards (Phase 2; no video).**

| Step | One full phrase (slot length in pulses; `_` = silent) | Start |
|---|---|---|
| Adavu 1 | R L | R |
| Adavu 2 | R R · L L | R |
| Adavu 3 | R R R · L L L | R |
| Adavu 4 | R R R R · L L L L | R |
| Adavu 5 | R² R² R R R _ · L² L² L L L _ (lengths measured from the clip) | R |
| Adavu 6 | R R R _ R R R _ · L L L _ L L L _ | R |
| Adavu 7 | R R R L R R R _ · L L L R L L L _ | R |
| Adavu 8 | R L R L + 3 quick + rest, per half-phrase (**slot lengths measured from the clip**) | R |
| Tapping (Namaskaram) | R L (tap events) | R |

- Written by person D from the cues.
- **Every card's slot lengths are measured** from foot contacts in `thattadavu.nvclip`: a Node script decodes the clip, puts it on the rig and reads foot heights.
- A unit test asserts that each half-phrase sums to the counts the cue states (Adavu 8: 8 counts with count 8 silent). The reviewer signs off each card.
- Labelled **"NrityaVaani version"**.
- **Ladder metadata:** Adavu 1 from its cue (1→2→3→2→1). Adavu 2–8 get ladder metadata from the "Practising" cue ("every adavu through the three speeds") **only after the reviewer confirms it**. Until then the student is asked "Are you doing the speeds?" after the take.
- **Practice track (R54).** Web Audio generates tattukazhi-style clicks from the slot table on the device, with silent slots left silent.
  - Tempo is selectable (slow / medium / normal), with the speed ladder where the card has one.
  - Clicks are **above 2 kHz** and the known click train is subtracted before stamp detection.
  - Loops are sample-accurate and phrase-aligned: no video seam.
  - It is the **clock** for loops, auto-stop and "Show me ▸ count 5 of phrase 2". It also avoids music rights.
- **Reference pane:** the 3D figure from `thattadavu.nvclip` over that adavu's span (e.g. Adavu 3 = 108.1–130.3 s), labelled **"animation, not compared"**.
  - Card slots map to clip times through the same foot-contact times the verification script reads.
  - The ghost is off for pattern cards.
  - The 3D figure runs in Learn and Feedback only, **never while the camera and pose model run**, so it doesn't compete for the GPU.

**(c) Studio references (Phase 3, if a dancer is recorded).**
- Front view at hip height, fitted clothes, full body, real side, the speeds the cues ask for. Baked on a desktop GPU.
- **Consent:** written; **a guardian's consent if the dancer is under 18**; a withdrawal clause.
- **Media outside git:** per-step clips of 5–40 s, hosted as GitHub Release assets or on an R2/B2 bucket with CORS, so they can be taken down. Only lanes and manifests go in the repo.
- **Audio:** original only (a team member reciting sollukattu, or the generated practice track). Never commercial recordings.

**(d) YouTube link (Phase 3).** See §8.

**(e) 3D rig lessons as compared references:** v2.

### 2.2 Student takes

#### Upload (Phase 1)

- `<input type=file accept="video/*">`. On phones the same input offers the **phone's own camera app**. This gives a recorder with no MediaRecorder engineering.
- Up to 3 min. In/out handles are optional; approach frames are found automatically (§3 F1).
- **Quality warning:** height under 480 px, or fewer than 10 frames per second processed.
- **Mirroring unknown** for uploads, so no side words are used (§4.8).

#### Recorder (Phase 2; the default where supported)

**Feature detection.** It needs:
- a secure context, `getUserMedia` and `MediaRecorder`;
- not an in-app browser (WhatsApp, Instagram, FB). Those get "Open in Chrome/Safari" plus a copy-link button.

If any check fails, the default becomes Upload.

**Start: tap to record (R51).** Everything is unlocked **inside the Record tap**:
1. Create and resume one `AudioContext`.
2. Decode the practice track or the teacher's audio into buffers.
3. Mute the teacher video elements and prime them with `play()` then `pause()`.

All sound (countdown beeps, practice track, teacher audio) then plays **through that one AudioContext**. That sound is never blocked later, and loops are gapless. A spoken "5-4-3-2-1" plays, then recording starts. If anything is still blocked, a big **"Tap to start sound"** button appears (its own error row).

**Stop:**
- a duration chosen from the loop unit (default about 30 s);
- or tap Stop;
- or **walking out of frame for 2 s** (a gesture that never appears in choreography), with a spoken "Stopping" and a 2 s grace period to step back in.

The raised-hand start anchor and the hands-overhead stop are **removed**: they collided with anjali and Shikhara, and with iOS autoplay rules.

**Permissions.**
- Camera first.
- **Microphone is an opt-in:** "Use the microphone to time your stamps". It is constrained with `{echoCancellation:false, noiseSuppression:false, autoGainControl:false}`, and `getSettings()` is checked to see which were honoured.

**Setup screen.** A live framing check at about 5 fps (IMAGE mode) with a ✓/✗ list:
- feet visible;
- one dancer;
- size in pixels;
- effective fps and brightness;
- background motion while standing still (auto-framing, Center Stage);
- **"Phone moving: prop it against something for footwork feedback"** (R49).

**Mode.**
- **Teacher file:** "Big screen: dance along". The teacher video fills the screen, with sound from the AudioContext and a small framing badge.
- **Pattern card:** the practice track plays. The screen shows a **2D pattern strip with a "next foot" cue**, not the 3D figure.
- **Phone at 3 m:** "Dance to the sound". The practice track is the sound for pattern cards. For teacher files, it's the teacher's audio.
- **Never** "use headphones": a cable doesn't reach 3 m, and Bluetooth may switch to a low-quality call mode.

**Loop unit per step** (round 3 found seams eating most strikes):
- **ladder steps:** the whole authored sequence (Adavu 1 = 1→2→3→2→1);
- **single-speed steps:** the smallest number of phrases lasting ≥ 8 s.

Practice-track loops are gapless on a phrase boundary, so nothing is excluded. Teacher-video loops (one element that seeks at the loop end) exclude strikes for min(1 s, ½ phrase) after the seam. Those strikes are kept in the alignment as **masked** (§4.2).

**Live pose during recording:** only for the framing badge. **Tips always come from the bake of the recorded file** after Stop, with the same reader and fps as calibration. Live-detected tips are v2 (round 3: the live path is load-dependent and uncalibrated).

**After Stop.**
1. Remux once with Mediabunny (no re-encode) into a seekable file.
2. **Crash-resume record (R50):**
   - the take is written to IndexedDB **encrypted with an AES key held in `sessionStorage`**;
   - a reload in the same tab can resume, but once the tab closes the record can't be read;
   - it is deleted after the bake, and by a **sweep that runs from the root layout on every page load**, not only on `/compare`.
3. **There is no "Keep".** Student videos are never kept. Only a text summary (bands, tips, date) can be saved (§2.7).

**Laterality.** Raw `getUserMedia` frames are unmirrored, since preview mirroring is CSS only, so recorder takes have known laterality. The exception: tracks whose label contains "OBS", "Virtual" or "Snap" get "laterality unknown".

#### Recording guide

- **Setup:** hip height, 2.5–3 m away, whole body including feet, front light, phone propped (not handheld).
- **People:** only you dancing. Other people and mirrors may confuse the tracker, and the app warns when it sees them.
- **Clothing and floor:** fitted clothes or pleats tucked; a hard floor if you use the microphone.
- **Distance by height:** "Stand where your feet and raised hands just fit", so children fill the frame.
- **Orientation:** landscape for arm-wide steps; portrait is OK for Thattadavu (hands on waist).

#### Audio policy (Phase 2 = minimal; Phase 3 = full)

With audio off, everything still runs from pose. Audio only **confirms or adds** strikes.

| Check | Phase | Mechanism | If it fails |
|---|---|---|---|
| Our own sound in the recording | 2 | The click train (above 2 kHz) is known and subtracted. For teacher audio, bleed is measured **only in the 40–300 Hz stamp band**, after the per-take latency search. | Audio off for confirmation only |
| Voice (sollukattu aloud) | 2 | Harmonicity/pitch detection. Onsets inside voiced segments are ignored. The take gets a "voice present" flag. | Voice-present takes aren't compared with voice-free takes for progress |
| Music or ankle bells | 3 | Spectral flatness, or periodic onsets far above the pose strike rate | "Music was playing: rhythm judged from your feet only" |
| Clock offset | 2 | Per-take pose→audio cross-correlation over ±250 ms, with peak/second peak ≥ 1.5 | Refinement off |
| YouTube mode | 3 | Takes are video-only | — |

### 2.3 Reader and bake

**Phase 1 reader: playback-driven.**
- The video plays muted, and `requestVideoFrameCallback` gives each frame its `mediaTime`. The model runs on as many frames as the device manages.
- If fewer than 10 frames per video-second are processed, playback drops to 0.5×, then 0.25×.
- Fallback: a seek loop (wait for `seeked`, then rVFC) where rVFC is missing.
- Irregular sampling is fine here: Phase 1 judges posture on a resampled 15 fps grid and makes no strike claims.

**Phase 2 reader: deterministic.** Footwork needs fixed sampling that matches calibration.
- Mediabunny decodes sequentially via WebCodecs. CanvasSink applies the rotation, at ≤ 960 px on the long side.
- Fallback: the seek loop.
- **Bake fps = min(24 target, effective source fps).** Targets that resolve to an already-processed frame are skipped, so VIDEO-mode timestamps never repeat.

**One job at a time.**
- A single-consumer queue owns the VIDEO-mode landmarker, with priority student take > teacher step > background jobs.
- Preempting means checkpoint, timestamp jump, run the other job, timestamp jump, then resume.
- The UI says "Teacher preparation paused while we check your take".
- Unit-tested with a fake landmarker.

**During a bake:**
- the raw video stays playable;
- Wake Lock is held;
- it pauses when the tab is hidden ("Keep this tab open");
- a checkpoint is written every 150 samples (Phase 2).

### 2.4 Models, pool, delegate, tier, timestamps

**Pool.** At most 2 live instances:
- `full / VIDEO / numPoses 2` for bakes;
- `full / IMAGE / 3` for preflight, the framing check and the picker (Phase 2+).

**Timestamps.**
- One session-wide monotonic clock: `ts = sessionBase + frameMs`.
- **Between videos and at cuts (R52):** `sessionBase` jumps 10 s past the last stamp. A gap of seconds makes the built-in One-Euro filter effectively reset, and VIDEO mode re-runs detection when tracking confidence drops. So no graph rebuild is needed.
- `setOptions` (which re-serialises the 9.4 MB model and recompiles GPU shaders, 0.5–2 s) is used **only for crop or mode changes**. Its latency is measured and included in the ETA.

**Delegate.**
- Create on GPU, then run a known-good test image.
- On failure, use CPU (and footwork gets the fps gate).
- `webglcontextlost` → recreate and resume.
- A device failure is never reported as "no dancer".

**Tier.** `full` everywhere. `heavy` is optional on desktop only (Phase 3), and is fixed per project.

**Downloads.** WASM (~11.5 MB, jsDelivr) plus `full` (~9.4 MB, Google). The size is shown on cellular. Self-hosting both on Netlify is an option that removes those two third parties (§12 decision).

### 2.5 Preflight, people, identity, cuts

**Phase 1 (simple and honest).**
- `numPoses: 2`. Start with the biggest, most central body with ankles in frame. Then follow the body with the nearest hip centre **and** a box height within 25% of the last frame's.
- **Warning** "Someone else is in the video; results may mix you up" when a second body is **at similar depth** (box height within 25% and feet at a similar image y) for ≥ 20% of frames. People who are smaller and higher in the image are behind the dancer: they are tracked past, not warned about.
- **Facing continuity:** never jump to a body facing the other way (nose/eye/ear visibility). This keeps a mirror reflection from taking over.
- Landmarks outside [0.02, 0.98] of the frame count as **out of frame**, whatever their visibility.

**Phase 3 (full classes).** Every extra detection (IMAGE/3 on preflight frames and at 1 Hz) is classified:

| Class | Rule | Action |
|---|---|---|
| Static (poster, photo) | Centroid and pose variance ≈ 0 | Ignored |
| **Side-mirror reflection** | Motion correlates ≥ 0.8 with the dancer's after an x-flip | Ignored |
| **Front-mirror reflection** (R48) | Motion correlates ≥ 0.8 **without** a flip, **opposite facing**, smaller scale | Ignored; never re-acquired |
| Blur-fill copy | Same centroid, 1.3–3× scale, low sharpness | Crop to the sharp pillar |
| **PiP inset / on-screen graphics** | A fixed rectangle with internal motion; or high-edge-density static/blinking text regions | "Use main view / Use inset"; landmarks under graphics = **occluded** |
| Split-screen | A static vertical seam | "Which view?" |
| Moving person | Otherwise | Tap to pick |

**Crop (Phase 3).** The **union of the picked person's boxes over the shot**, from a quick 1 Hz pre-scan. If they move outside it, the shot is split into crop segments, and each change counts as a reset. Inside a crop that contains others, `numPoses 2` is kept and the dancer is chosen by signature.

**Identity (Phase 3).**
- **Signature per facing** (front and back, each filled in the first time it is seen). Colour is **chromaticity only** (grey-world corrected), and bone **ratios** are taken only for limbs roughly parallel to the image plane (screen length agrees with world length).
- **`SUSPECT_ID` needs two independent track cues:** a landmark jump, a signature mismatch, or a raw bone residual. Co-presence alone never sets it, and appearance alone never switches the crop while the landmarks stay continuous.

**Cuts and camera motion (R49).**
- **Discrete reframing** (a step change, then stable) is a cut: timestamp jump, drop ±1 sample.
- **Continuous camera motion** (a smooth global motion, as in a handheld follow-pan) is **not** a cut. Roll is then estimated per 2 s window on upright frames, σ_j is widened, and preflight says "handheld".
- A median shot under 4 s → posture only, with that reason shown.

**Shot view and facing (teacher files).** Shots more than 30° of yaw from the student's view switch off 2D-only features. A change of facing is confirmed once (Phase 3), and that section's L/R mapping is flipped.

### 2.6 Cleaning and camera correction

| Lane use | Cleaning |
|---|---|
| **Overlay (drawing the skeleton)** | `despikeTrack` → `stabiliseTrack` → `smoothTrack(1)` (looks steady) |
| **Posture features (Phase 1+)** | MediaPipe's own filter + a 3-sample median per feature. **No** despike or stabilise. |
| **Strike events (Phase 2, R42)** | **Raw** ankle, heel and foot_index lanes (MediaPipe's own filter only). Despike only jumps > 0.25 m between samples, which are physically impossible. **σ_j is measured on raw still frames.** |

- Gaps of ≤ 3 samples are interpolated and flagged `INTERP` (never used as strike evidence).
- Resample onto the uniform grid.
- **Roll correction** (Phase 2 footwork): per 2 s window on upright frames, from the mid-ankle → mid-shoulder axis, with the heel line as a backup.
- **Phase 1 needs no roll correction:** its features are roll-invariant by construction (§5.1).
- **Leg reliability score** (jitter, bone residual, knee outside the hip–ankle cone). A low score turns off knee angle, knee spread and knee alignment.
- **Test:** 2-sample, 3 cm lifts injected into raw lanes at 24, 15 and 10 fps must survive the full load → clean → events path.

The pure track functions move to a three.js-free `lib/motion/track.ts`, re-exported from `retarget.ts`.

### 2.7 Storage, privacy and deletion (R50)

**The rule: video of a student is never kept.** With a shared demo login (user id "1") and no real accounts, per-user storage can't protect anyone, so nothing about the student's video is stored.

| Data | Phase | Where | Lifetime |
|---|---|---|---|
| Student video + its landmarks | 1 | Memory only | Gone when you leave the page |
| Student crash-resume record | 2 | IndexedDB, **AES-encrypted, key in `sessionStorage`** | Unreadable once the tab closes; deleted after the bake or by the sweep on the next page load |
| Teacher step landmarks ("Save this teacher step") | 1 | IndexedDB, opt-in | Until "Delete saved steps" (on `/compare` and `/privacy`) |
| Text summary (bands, tip ids, date, step name) | 2 | `localStorage` key `nv_compare_sessions`, **separate from `nv_sessions`** | Until deleted. Never mixed with mudra stats, so `/dashboard` and mastery counts stay right. |

**NVB2 format (teacher bakes, Phase 1+):**
- `"NVB2"` + u32 header length + JSON header + raw lanes.
- **Header:** `{v, key, configHash, tier, delegate, fps, effectiveFps, range, rotation, laterality}`.
- **Lanes:** `flags u16`, `times f32`, `poseWorld f32[n·33·4]`, `poseScreen f32[n·33·2]`.
- Cleaning and features are recomputed on load.

**`/privacy` changes (shipped with Phase 1):**
- "Videos you use in Compare are processed on this device. They are never uploaded, and your own videos are never saved. A teacher step's stick-figure data is saved only if you choose, and you can delete it."
- "Model files are downloaded from Google and jsDelivr when you first use a camera or video feature; no video or images are sent." (Removed if we self-host.)
- **Phase 2 adds:** "If processing is interrupted, your take is held in this browser in encrypted form until the tab closes."
- **Phase 3 adds:** YouTube and edge-tts disclosures (§8).

---

## 3. "Not all movement is necessary": what gets judged

### F1. Human trim and automatic edges

- **Teacher:** you mark one step (Phase 1). Several ranges come in Phase 3.
- **Student:**
  - optional in/out handles;
  - automatic: frames with no full body, frames where the dancer's screen height grows or shrinks steadily (walking to or from the camera), and frames where the ankles leave the frame are dropped from the edges;
  - **the step search (§4.7) ignores everything outside the match anyway.**

### F2. Pauses inside a step

**Phase 1 (general path):**
- **Teacher pause:** a run of ≥ 1.5 s where the whole body is still, **inside a step that is otherwise moving** (still < 60% of the step). It stays in the alignment but is excluded from scoring.
- **Student pause:** the same rule inside the matched span. Shown as "pause (not judged)", with a restore button.
- If ≥ 60% of the step is still, it is a **hold step**, and stillness is the point (F5).

**Phase 2 (footwork):** inside marked footwork spans, frames outside any **strike run** are excluded. A run ends when a gap exceeds 2 slot durations at the local tempo **and** the dancer is upright and still for ≥ 1.5 s. This handles the teacher saying "now twice as fast" between speeds, and a student catching her breath.

**States (Phase 3, teacher-file timeline).** States are computed in 1 s windows with a 0.5 s hop, with E_group the 90th percentile of speed ÷ torso length.

| State | Rule |
|---|---|
| `NOT_VISIBLE` | No pose, close-up, or dancer < 160 px |
| `ARAMANDI` | Planted hipDrop ≥ 0.08 and knee spread ≥ 1.3 × hip width |
| `HOLD` | ARAMANDI and E_legs below the take's 30th percentile |
| `STANDING_HOLD` | Upright, still, **and** the arms are posed (joined wrists, both above mid-torso, or hands on the waist) for ≥ 2 s |
| `ARM_DEMO` | Upright and E_arms ≥ 0.3 |
| `DANCE` | E_legs above the take's 50th percentile of non-still windows |
| `TALK` | Upright and still for ≥ 2 s, and not STANDING_HOLD |

Inside a marked step, TALK removes frames from **scoring** only for moving steps (F2 rules above), never for hold steps.

### F3. One step

- **Teacher file:** the marked step (Phase 1). The state-coloured timeline and step proposals come in Phase 3.
- **Pattern cards and studio references:** the student picks a named step.

### F3b. The declared step has a strong prior (Phase 2, R43)

Round 3 found that labelling runs by the best-matching card turned the most common error into "other step". New rules:

1. **A take with one pattern is always judged against the declared step.** It is never relabelled.
2. **Several patterns** are split only at a pause or an IOI change point (§4.3) **and** only when the take contains more than one stable pattern. Window costs are **normalised per aligned strike**, over **equal durations** (not equal phrase counts), so short cards don't win inside long ones.
3. **Neighbouring cards in the same lesson are likely errors, not other steps.** If the whole take matches another card and not the declared one, ask after the take: "You danced **2 strikes on each side** (like Adavu 2). Adavu 3 in this reference has 3. Which were you practising?"
   - **[Adavu 3]** → it is judged against Adavu 3: a count tip.
   - **[Adavu 2]** → re-judged as Adavu 2.
4. **"Different version"** only when the take matches **no** card in the lesson and the student has **not** confirmed the version. Even then it shows the detected strip and asks, and never silently skips.

**Tests:**
- Declared Adavu 3 danced R R · L L throughout → the count tip, or the prompt then the count tip.
- Adavu 7 missing the switch → a pattern tip, not "Adavu 6".
- Adavu 8 with a stamp on count 8 every phrase → the silence tip, not "Adavu 1".
- Adavu 1–4 danced back to back, declared Adavu 3 → split at the pauses; Adavu 3 judged; the others listed as "also danced".

### F4. Body-part modes and switches

- **Phase 1:** switches for Arms, Legs, Torso and Head, all on by default. A switch that is off removes that part from both alignment weights and tips.
- **Phase 2 footwork modes:**

| Mode | Rule |
|---|---|
| Arms `waist` | Wrists within 0.35 torso of the hips, low motion, in ≥ 70% of frames |
| Arms `natyarambhe` | Wrists within ±0.25 torso of shoulder height, extension ≥ 0.7 arm length, in ≥ 60% |
| Arms `free` | Otherwise |
| Legs `aramandi` | hipDrop ≥ 0.1 in ≥ 70% |

### F5. Hold steps (R46)

A hold step is judged on the right moment:
1. Find the frames whose state matches the step (ARAMANDI for an aramandi hold, posed arms for STANDING_HOLD; in Phase 1, the frames that best match the teacher's posture).
2. Take the **longest such run**, then the **stillest 2 s inside it**.

"Stayed standing" is given only when the target state never lasts ≥ 1 s. The chosen window is shown ("judged 0:06–0:08") with "pick another moment".

### F6. Tolerances

- **Phase 1:** fixed tolerances above MediaPipe's jitter (`05-mvp.md` §3.2). Tips are labelled **beta**.
- **Phase 2:**
  - `tol_f = dead_f + 1.5·MAD_f`, capped at `3·dead_f + 15°-equivalent`, with `dead_f = max(prior_f, 2 × measured test-retest SD_f)` **per stratum** (adult, child);
  - a feature is **free** (never scored) if the teacher's own σ > 3 × dead_f.

### F7. One-sided features

| Kind | Features | Behaviour |
|---|---|---|
| **More is fine** | Depth (up to the reference + 0.12), knee spread, torso uprightness | Penalised only in the bad direction. **Never praised.** |
| **Less is fine** | Lateral tilt, **height bobbing**, knee roll-in | Penalised only in the bad direction |
| **Two-sided** | Elbow angle, arm height, limb directions | Penalised either way |

---

## 4. Alignment

### 4.0 Principles

- **Confidence is always relative.** A match must be clearly better than the alternatives in the **same take** (Phase 1: the cost profile along the take; footwork: other phrase positions). This keeps beginners from being rejected and stops still standing from "matching".
- **Masked frames** (no person, out of frame, occluded, SUSPECT_ID) get a **neutral cost**: the median of row minima over unmasked frames. They are excluded from normalisation and from every scoring denominator.
- **Offsets (R53).** A constant posture offset (an arm held 15° low throughout) raises the cost everywhere, so the relative dip survives. The offset itself then becomes a tip. Per-window de-meaning **inside** the DP is not used: the window is an output of the path, so it can't be done in one pass. For the v2 chained sDTW, either:
  - align on offset-invariant features (velocities, or features high-passed over about 1 s), or
  - align, recompute the mean over the matched span, and re-run in a ±1 s band (2–3 iterations).

### 4.1 Strikes (Phase 2)

**Lift signal.**
- **Differential lift:** d(t) = y_L − y_R of the ankles, in the roll-corrected frame, from **raw lanes** (§2.6). Hip bounce, rising aramandi and standing cancel.
- The same quantity in upright screen pixels ÷ torso pixels. Per take, the version with the higher SNR is used.
- Baseline d0 and jitter σ_j come from **raw** frames where both ankle speeds are low.

**Detection.**
1. **Candidates:** peaks of |d − d0| above 3σ_j, plus confirmed stamp onsets.
2. **Speed sections** (§4.3).
3. **A first cyclic alignment** (§4.2) assigns candidates to slots.
4. **Thresholds per foot and per slot class:**
   - each foot gets its own SNR and threshold, because a beginner may stamp 8 cm right and 2 cm left;
   - slots shorter than 1 pulse (Adavu 5's quick three, Adavu 8's quicker three) get their own median lift.
   Then re-detect.
5. **Audio can add** a strike: a stamp inside a periodic stamp run, with an ankle vertical-velocity peak within ±1 sample.
6. **Audio can veto:** in a take where stamps confirm ≥ 70% of landings, a landing without a stamp is a placement, not a strike.

- **Strike time:** the moving ankle's velocity minimum, refined to sub-sample time. A paired stamp time replaces it.
- **Both feet airborne** = a `jump` event, not part of strike strings.

**Fair sampling (round 3: the gate used its own output).**
- **The fps gate uses the expected IOI** = slotDur × τ. τ comes from the long slots, or from the neighbouring section × the ladder ratio.
- It is applied **per slot class, to the shortest slot**, not to the section median.
- Count, silence and same/switch claims need **≥ 5 samples per shortest slot** at the effective fps, or stamp confirmation. Otherwise: "Too fast to count at this camera's frame rate: try 1st speed or a laptop."
- **No deletion edit is reported** at a reference position whose expected IOI is under 5 samples, or whose matched lifts in other phrases are near the threshold, unless stamps confirm that no onset happened.

**Strike confidence: per section and per foot.** Pattern tips need stamp agreement for that phrase, or **per-foot** SNR ≥ 4 with good leg reliability and the fps gate passed. Otherwise: "I couldn't count your strikes clearly: wear something that shows your ankles."

### 4.2 Patterns (Phase 2)

**Reference phrase P.** Slots `{foot R|L, strike|rest, duration in pulses}`, from a pattern card (Phase 2), a studio reference, or the teacher's own detected phrase (Phase 3).

**Cyclic alignment.** A DP over (student strike i, reference position j mod |P|), with a free start and end.

| Move | Cost |
|---|---|
| Match | 0 if the foot agrees under the mapping, otherwise 1 |
| Insertion (extra strike) | 1 |
| Deletion (missing strike) | 1 |
| **Rest slot** | **Skippable at zero cost** |
| **Masked position** (expected time inside a masked span or seam) | **Zero cost; excluded from all counts** |
| Timing term (added to each match) | 0.5 · \|log(IOI_i / (Σ slotDur between the two matched positions, **including rests and deleted slots**, · τ))\| |

- **A strike inside a rest slot's time window** is placed by timing as a **"strike on silent slot"** edit. It is no longer an extra strike somewhere.
- **"Rest collapsed":** an IOI across a rest under 0.6× expected, in ≥ 50% of phrases (Adavu 6 "pause after each group"). It has its own tip and calibration case.
- Rest-spanning IOIs are excluded from evenness.
- The DP runs under both image→foot mappings. Mapping-invariant errors are always reportable; side-specific ones only with known laterality (§4.8).

**Recurring edits.** An edit is reported only when the same edit recurs at the same reference position in ≥ 50% of **fully judged** phrases, and in ≥ 2 of them. **≥ 4 fully judged phrases** are needed before any pattern tip. A phrase touching a masked span or a seam, or the partial first or last phrase, is not fully judged.

**Phrase correctness → "Keep the count" (R44).**
- Based on the **per-strike edit rate**, not exact phrases.
- It fires only when a one-sided binomial test says the student's edit rate is **≥ 3× the detector's edit rate** measured on good takes for that card and fps tier, with ≥ 4 fully judged phrases.
- Only edits confirmed by stamps or high per-foot SNR count.
- It is its own calibrated template. Until it passes, it isn't shown.
- The per-phrase ✓/✗ strip is drawn only for phrases where every slot is confident; the rest are grey.
- The tip says "**count silently in your head**", never "aloud": a voice in the room interferes with the stamp detector.

**Version check (R43).**
- Before the first take against a card, the strip ("This version: R R R · L L L") is shown with the 3D figure and the practice track: "**Is this how you learn it?** Yes / My version differs / Not sure".
- **"Yes" is authoritative.** Consistent deviations are errors, worded relative to the reference: "This reference strikes four times on each side; you struck three every time." Every pattern tip carries a one-tap **"My version is different"**, which switches pattern tips off for that step.
- **"My version differs":** pattern tips off; shape and posture tips stay.
- **"Not sure":** see F3b(4).

**Start foot (R45): only against a clock.**
- **Recorder with a count-in:** position 1 is expected within about 1 pulse after the count-in. A wrong start foot means the first strike lands at the expected time but aligned to the **opposite half-phrase's** start. A late start (first strike at count 4) gives **no** tip.
- **Uploads:** "Start foot not checked", unless the first strike is stamp-confirmed **and** preceded by ≥ 1 s of confirmed stillness with both ankles visible and no lift above 2σ_j. For alternating patterns (Adavu 1, 8) on uploads it is always "not checked".
- On uploads, the tip is worded as a check: "Check: did you start with your right foot?"
- **Tests:** L-start at the count-in → tip; late start at count 4 → no tip; Adavu 1 upload with a soft first R → no tip.

**Templates (shape, Phase 3):** 12 samples per slot, rests included. Odd half-phrases are mirrored before averaging. Key postures sit at the landings.

### 4.3 Speed sections and ladders (R55)

**Sections.**
- **Piecewise-linear** fit (a level plus a slope per section) to log residual IOI.
- A change point only for a **jump of ≥ √2 within 2 strikes**. Adjacent sections with a ratio under √2 are merged, and their slope is reported as **rushing or dragging**.
- Labels are relative to the slowest section, snapped to {1, 2, 4}.

**Pairing.**
- Uses only the **sequence of ratios between neighbouring sections**, matched against the card's ladder metadata. **Never the absolute student-to-teacher pulse** for uploads.
- With a **clock** (practice track, teacher audio, or the YouTube clock in Phase 3), each section's pulse is compared with the reference pulse, and the tip names the section that is off: "1st speed was rushed: it ran ahead of the clicks."
- **Uploads with no clock** get neutral wording: "Your 2nd speed was only about 1.4× your 1st; the two should differ by 2×."

**Ladder tips are Phase 3.** Phase 2 judges each section on its own.

**Slow motion (teacher files, Phase 3):** > 30% duplicated consecutive source frames, or blur that doesn't match landmark speed. Flagged and previewed; never excluded just for being slow.

### 4.4 Templates per speed section (Phase 3)

- Footwork phrases are warped piecewise-linearly between strikes onto the per-slot grid, then averaged.
- A section needs ≥ 2 reps for a template.

### 4.5 Tier A: posture distributions (Phase 2, footwork)

- **Per section:** median, 10th/90th percentiles, spread and a per-phrase trend, on frames inside strike runs (F2).
- **Eligible features:** a within-reference 10–90 range ≤ 2 × dead_f.
- **Hold steps:** F5.

### 4.6 Tier B: event-anchored phase shape (Phase 3)

- Phrases are paired by the cyclic alignment and warped piecewise-linearly between matched strikes.
- **Confidence:** ≥ 70% of strikes matched, residual IOI CV ≤ 0.3 per section, and shape cost ≤ 0.7 × the phase-shift null.
- Suppressed at 4×.

### 4.7 The core path: whole-step subsequence DTW (Phase 1, R41)

This is the general method for **any** marked step. It is specified fully in `05-mvp.md` §3.3; in summary:

- **Features for alignment:** the 2D directions of 10 body segments (unit vectors), weighted by visibility and the body-part switches.
- **Query** = the teacher's step, resampled to 15 fps. **Search space** = the whole student take, also at 15 fps.
- **Recurrence:**
  ```
  D(n,m) = C(n,m) + min( D(n-1,m-1),
                         D(n-1,m-2) + 0.5·C(n,m-1) + λ,   // skipped student frame charged
                         D(n-2,m-1) + C(n-1,m)   + λ )    // skipped query cell charged
  λ = 0.1 · median row-min(C)
  ```
  The student start and end are free, and **every student frame in the matched span is scored**.
- **Found?** The best normalised cost must be **≤ 0.6 × the median** of the end-cost profile along the take, and the span must be 0.4–2.5× the teacher's length. The step must be ≥ 2 s.
- **More tries:** block the span and search again, up to 6 times. Each try must pass the same test and cost ≤ 1.5× the best.
- **Partial practice:** if nothing is found, the student's moving span is searched inside the teacher's step, and coverage is reported.
- **Mirror:** both normal and mirrored are run, and the lower is kept. Within 10% → no side claim.
- **Budget:** 900 × 2700 cells, well under 0.1 s on desktop. On a phone, the loop yields every 50k cells.
- **Its known blind spot:** a wrong **number** of repetitions inside a cycle (an extra stamp) warps away as tempo. That is why Phase 2 exists, and Phase 1 says so (§13).

**Chained Tier C (v2):** long non-cyclic sequences (the whole Namaskaram) are cut into 2–6 s units at stillness minima and matched as an ordered chain that may skip units, with R53 for offsets.

### 4.8 Laterality: no side words without facts

| Source | Laterality |
|---|---|
| **Recorder (Phase 2)** | Known: raw frames are unmirrored (virtual-camera labels → unknown) |
| **Upload, back camera** | Unknown unless metadata settles it; the camera answer alone isn't enough |
| **Upload, front camera** | **Mirroring unknown** (iOS "Mirror Front Camera", Samsung "Save as previewed", editing apps). Two agreeing independent signals are needed: QuickTime lens + a known device default, or the student's answer on a still of her first strike ("Which foot is this?") |
| **Teacher file** | Two signals: "Which foot should YOU start with?" (default Not sure, asked only after a take), plus the student's own first take. Mapped per facing section (Phase 3). |
| **Pattern card / studio reference** | Known |

- **Without known laterality:** no "left/right" in any tip. The joint is coloured red on the student's video instead (Phase 1 does this always).
- **Side tips on teacher files** are worded as a check: "You started on the other side from the teacher as shown. Check which foot your teacher wants you to begin with."

### 4.9 Playback mapping and early/late

| Case | Student t → reference t |
|---|---|
| Phase 1 | The DTW path (synced playback, ghost) |
| Recorder take | The logged clock per loop iteration |
| Footwork | Piecewise-linear between matched strikes |
| Low confidence | First moving frames lined up |

**Early/late (Phase 3, round 3: latency confound).**
- System latency is measured **separately**: a one-time "tap along to the flash and click" calibration, or a mic loopback of a click when the mic is on. Only that latency is subtracted.
- **Constant** early/late is reported only with high latency confidence **and** |lag| < ¼ of the shortest unambiguous period (so never at 3rd speed). Otherwise only within-take drift is reported: "you drifted later in the second half".

---

## 5. Scoring

### 5.1 Features

**Phase 1 (all roll- and scale-invariant):**

| Feature | Measured as |
|---|---|
| Knee bend L/R | 3D angle hip–knee–ankle (world landmarks) |
| Elbow bend L/R | 3D angle shoulder–elbow–wrist |
| Arm height L/R | 2D angle of the upper arm **from the torso axis** (camera roll cancels) |
| Knee spread, foot spread | Distance ÷ hip width |
| **Knee alignment** (R47) | Knee lateral offset relative to the foot line (ankle → foot_index lateral position) ÷ hip width, on planted frames. Knee inside the foot line = rolling in. Measurable from the front. |
| **Side tilt** | 2D torso axis **minus** the mid-hip → mid-ankle axis (camera roll cancels) |
| **Height bobbing** | Mid-hip screen y relative to the planted (lower) ankle ÷ torso length, spread over the matched span |
| Speed | Matched duration ÷ teacher duration |

**Phase 2 adds:** planted hipDrop, foot-lift height, the strike pattern, and **height steadiness phase-locked to strikes** (peak-to-trough of planted hipDrop per strike cycle). The cue is "stay at the same height".

**Torso core = side tilt + forward lean.** From the front, forward lean can't be seen. The Torso chip then reads "**Partly checked: side tilt only** (forward lean needs a side view)". A front-view proxy (shoulder→hip screen length shrinking relative to the take's upright frames, with the nose moving toward hip height) is beta.

**View check.** If the body's yaw (from the 3D shoulder line) differs from the teacher's by > 30°, the 2D features are off: "Film from the same angle as the teacher."

### 5.2 Penalties, safety gate, bands

**Penalty.** `p = clamp((e_bad − tol_f) / (3·dead_f), 0, 1)`, measured in the penalised direction only.

**Safety gate on depth (R47).**
- A "lower" tip is allowed only when **knee alignment** was judged and is within tolerance, and leg reliability is good.
- **Knees roll in:** the tip becomes "**Push your knees out over your toes before going lower**", and the depth tip is suppressed.
- **Knees not judgeable** (saree, low reliability): no depth tip.
- A depth tip never asks for more than half the remaining gap ("a little lower").
- **Heel-down is "Not checked"** until it is calibrated.

**Beginner depth (round 3: elite reference).**
- Once the student is past a minimum (hipDrop ≥ 0.08 with good knee alignment), the depth target is **her own best recent depth plus a small step**, not the reference's.
- While she is improving, depth alone can't push the Legs band below "Getting there".

**Bands** per Arms / Legs / Torso / Timing: **Close match**, **Getting there**, or **Needs work**.
- Set by the worst persistent feature.
- Never better than "Getting there" when a correction from that group is shown.
- "**Partly checked**: …" when core features weren't judged, with what wasn't checked.
- The UI shows **no numbers**.

**"Not checked" list.** Every chip lists what wasn't judged and why ("knees hidden", "forward lean needs a side view", "flat-sole strikes not checked yet"). A missing tip is never read as a pass.

### 5.3 Rhythm (Phase 2–3)

1. **Pattern first** (§4.2).
2. **Evenness** uses residual IOIs (IOI ÷ Σ slot durations · τ), excluding rest-spanning IOIs. All of these must hold:
   - 1st speed;
   - the reference's residual CV < 0.1;
   - the student's CV − the reference's CV > 2 × floor, where `floor = √(2·(Δt²/12 + σ²)) / mean IOI`;
   - pose-only evenness is off below 20 fps; 2nd speed needs stamps.
3. **Rushing/dragging:** the within-section slope (§4.3).
4. **Early/late:** §4.9.

---

## 6. Feedback

### 6.1 Candidates and ranking

**Phase 1:** `severity = (|median difference| ÷ tolerance) × share of time`.
- A tip needs:
  - ≥ 40% of judged frames beyond tolerance in the same direction;
  - visibility ≥ 0.6 on ≥ 70% of frames;
  - presence in ≥ half the tries.
- Top 3, one per body part, plus 1 strength (a clearly seen body part within half the tolerance). "More is fine" features are never praised.

**Phase 2+:** `severity = importance × p × persistence × confidence`.

| Group | Importance |
|---|---|
| Legs / aramandi (incl. knee alignment, steadiness) | 1.0 |
| Pattern / count / silent slot | 0.95 |
| Start foot | 0.9 (clocked takes only) |
| Torso | 0.8 |
| Arms | 0.7 (0.9 in natyarambhe) |
| Rhythm evenness | 0.5 |

- **Legs first:** if Legs is "Needs work", arm tips under 25° excess are suppressed.
- Left and right versions merge ("both knees").

**Session focus.**
- The focus stays until it improves by more than 2 × the retest spread, or passes tolerance.
- **It is dropped** when the student taps "**This tip is wrong**" (that template is then suppressed for the session), or after **3 takes with no change**. Then the next confirmed issue can surface.
- At most 3 corrections, 1 strength and 1 focus. When nothing qualifies, the reason is shown.

**Questions (R56).**
- Asked **after** the take, and only when the answer would unlock a tip that was actually withheld ("Answer one question to get a start-foot check").
- **At most 2 per take.** Answers are remembered per step.
- Feedback lists "**Not checked because…**" with a one-tap answer next to each item.

### 6.2 Wording

- The reference is called "**the teacher**" (Phase 1), "this demonstration", or "the NrityaVaani version". **Never "your Guru".**
- A standing line under the tips: "**If your teacher says otherwise, follow your teacher.**"
- Each tip: an imperative, an external-focus image, the term with a gloss, and relative evidence. The cue is quoted when one exists. "It looks like…" marks medium confidence.
- **No left/right words without known laterality** (§4.8).
- English in Phases 1–2; Hindi in v2.

### 6.3 Reference-free habits (Phase 3: YouTube mode and pattern-card-only students)

Labelled "**General posture habits: not compared with a teacher.**" They run on held aramandi frames only:
- aramandi present and **level across reps**;
- **knee alignment** (R47);
- **height steadiness**;
- torso side tilt;
- hands on waist (Thattadavu mode);
- L/R consistency between the two halves of a phrase.

**Removed:** "heels down" stays "Not checked" until calibrated, and "heels together" is opt-in only.

### 6.4 Example tips

**Phase 1:**
1. "**Bend your knees a little more.** Sit lower into aramandi, keeping your knees out over your toes; don't force it. ▸ Show me"
2. "**Raise this arm** (shown in red) to the teacher's height."
3. "**Stay at the same height.** Your hips bounce on each step; the teacher's stay level."
4. "**You're about 30% slower than the teacher.** Practising slowly is fine; speed up when you're comfortable."

**Phase 2:**
5. **Count (consistent error):** "**Three strikes on each side.** You struck twice on each side in every phrase; this reference strikes three times. *Cue: 'Right, right, right, then left, left, left.'* [My version is different]"
6. **Silence:** "**Count eight is silent in this version.** Your feet stamped on eight in 5 of 6 phrases."
7. **Knee alignment:** "**Push your knees out over your toes before going lower.**"
8. **Keep the count** (once calibrated): "**Keep the count.** Several strikes landed off the pattern; count silently in your head."

*Abstain:* "I couldn't count your strikes clearly: wear something that shows your ankles."

### 6.5 Gates (any one blocks a tip)

- Not found, or coverage < 60% (Phase 1: the tip is limited to the covered part, and the coverage is said).
- Within tolerance; a free feature; the good side of a one-sided feature.
- Persistence not met.
- View, clothing or out-of-frame gates.
- Strike confidence or the fps gate (pattern tips).
- **"My version is different"** chosen (pattern tips).
- Laterality unknown (side wording).
- The depth safety gate.
- The template hasn't passed calibration: hidden, or shown as **beta**. Beta tips are never voiced.

**"Show me"** pauses both videos at the worst moment, with the red joint on the student and green on the teacher.
**The ghost** draws the teacher's skeleton on the student, scaled by torso length and anchored at the mid-hip, labelled "approximate". It is off for pattern cards.

### 6.6 Voice (Phase 3)

- "Hear it" reads the focus tip via `GuruAudioEngine.syncLine` with a 6 s timeout, falling back to Web Speech.
- Beta tips are never voiced.
- Button note: "Tip text (not video) is sent to our voice service."

---

## 7. Student flow and UI (`/compare`)

**Phase 1 stepper: 1 Teacher → 2 You → 3 Result.**
1. **Teacher:** upload; mark the step (handles, live ETA); "Prepare". A progress bar shows the skeleton filling in, with "Keep this tab open". Optional "Save this teacher step".
2. **You:** upload or phone camera; optional handles; progress.
3. **Result:**
   - two panes (stacked on mobile), with the student clock as master;
   - the band chips with "Not checked" notes;
   - up to 3 tips + 1 strength, each with Show me;
   - the ghost switch and the body-part switches;
   - "Try another take". Changing a switch re-scores instantly, with no re-processing.

**Phase 2 adds** a Reference choice (pattern card / teacher file), Learn (3D figure + practice track at 0.5/0.75/1×), the recorder, and a Thattadavu "confirm the step" prompt for teacher files.

**Error and empty states**

| Situation | What the user sees |
|---|---|
| Model download failed | Retry |
| GPU failed | CPU mode note (slower) |
| HEVC / codec | "Your phone saved this in a format this browser can't read: Settings → Camera → Formats → Most Compatible, or try Chrome" |
| No person found | "Is your whole body in frame?" (only after the delegate test passed) |
| Similar-size second person | Warning (Phase 1); picker (Phase 3) |
| Small dancer | Pixel-size message |
| Tab hidden | Paused |
| Step not found | "We couldn't find the teacher's step in your video. Check it's the same step and your whole body is visible." Both skeletons stay viewable. |
| Partial | "You practised about X% of the step. Tips cover that part." |
| Different camera angle | "Film from the same angle as the teacher for arm and leg tips." |
| Saved steps evicted | "Prepare again" |
| **Phase 2:** camera denied / busy / missing, mic denied, in-app browser, too dark, camera effects on, **sound blocked ("Tap to start sound")**, take lost on reload, too fast for this frame rate, handheld | Per §2.2 |

---

## 8. YouTube "Practise beside" (Phase 3)

### Link parsing

- **Hosts:** youtube.com, www., m., music., youtube-nocookie.com, youtu.be.
- **Paths:** `/watch` (`v=` anywhere in the query), `/shorts/ID`, `/embed/ID`, `/live/ID`, `/v/ID`.
- `si=` is stripped. `t=` / `start=` prefills "Mark start".
- Unit tests cover each form.

### Facade and lookup

- **Facade:** a neutral placeholder. Nothing is fetched from YouTube before the click.
- **`GET /api/yt/meta?id=`:**
  - id regex and an Origin/Referer allow-list;
  - **the client IP is taken from the forwarded header** (uvicorn `--proxy-headers --forwarded-allow-ips='*'`, first `X-Forwarded-For` hop, or Netlify's `x-nf-client-connection-ip` on the rewrite path);
  - only a **per-minute burst limit** in memory, because the free instance sleeps;
  - daily bounds from the Data API quota and a 7-day client cache.
- The made-for-kids check never depends on lookup timing: no embed sets tracking (facade, nocookie, no autoplay).

### Player

- `www.youtube-nocookie.com/embed/ID?enablejsapi=1&origin=…&controls=1&playsinline=1&rel=0`. No autoplay.
- ≥ 480×270 on desktop, never below 200×200.
- **Shorts or portrait videos** (from the path or oEmbed size) get a 9:16 player (e.g. 304×540), and the student pane matches it.

### Nothing over the player

- On this page the navbar is `absolute`, `LiveChat` returns null, and the page never calls `toast()`.
- When any overlay opens (mobile menu, dialogs, selects), the player is paused and swapped for the facade.
- No CSS mirror, scale or filter on the iframe. **Mirror view isn't available for YouTube.**
- Playwright `elementsFromPoint` checks cover the idle, menu-open, dialog-open **and recording** states.

### Recording beside YouTube (round 3: the recorder modes broke the rules)

- **Layout:**
  - the player stays visible at its normal size with controls;
  - the badge, countdown, status and recording indicator sit **in a strip outside its bounds**, in every mode including phones;
  - **no YouTube fullscreen while recording**, and no sound-only mode.
- **Start:** the student taps **YouTube's own play button**. Recording starts on the PLAYING state, and approach frames are trimmed. `onAutoplayBlocked` → a large "Tap play on the video" prompt.
- **Stop:** wall-clock duration, tap, or walking out of frame, never player loops.
- **Ads and buffering:** while the player is not PLAYING for > 2 s, the app says aloud "Ad or buffering, recording paused" and marks the frames unsynced.
- **The take is video-only**, so YouTube's sound is never re-recorded.

### Review beside YouTube

- The YouTube player **plays independently**. It is re-synced only when the student plays or seeks her own pane, and only if drift > 1.5 s, and never more than once per 5 s.
- Each tip has "**Jump YouTube here**", which seeks once and waits for `onStateChange`.

### What the student gets

- Her skeleton on her own video.
- The pattern card checks (declared adavu, version confirmed).
- The reference-free habits (§6.3).
- Posture comparison **only** through a studio reference or her teacher's own file. **The app never invites uploading "this" video.**

| Family | Rules |
|---|---|
| Thattadavu family | Pattern card + habits |
| Natyarambhe arms | Wrist and elbow at the shoulder line + universal habits |
| Natta / Mettu / Kuditta / Other | Universal habits only |

### Errors and legal pages

- **Errors:**
  - 101/150/age-restricted: "This video can't be played here."
  - 100: "Video not found or private."
  - 153: a referrer problem. A comment in `next.config.ts` warns never to add `Referrer-Policy: no-referrer`.
- **New `/terms`:** YouTube ToS binding (with link); rights to uploads; a parent or guardian for under-13s.
- **`/privacy`:**
  - YouTube API Services, with the YouTube ToS and Google Privacy Policy links;
  - "YouTube is contacted only after you press play";
  - "YouTube videos you choose to play are third-party content";
  - edge-tts disclosed.

**Explicitly not built:** server download, tab capture, a canvas over the iframe, a skeleton derived from YouTube.

---

## 9. Calibration and tests

### Phase 1 tests (no recordings needed)

**Pure-TS unit tests**, run with `node --experimental-strip-types --test`, no new dependency. Synthetic stick-figure tracks:
- a time-stretched copy (0.6× and 1.8×) → found, no tips;
- padded with standing and walking → found;
- 3 tries → 3 found;
- mirrored → found, no side claim;
- knee changed by 25° → knee tip;
- arm held 15° low throughout (constant offset) in a **40% partial take** → found, partial, arm tip;
- standing only → "not found";
- half the step → about 50% coverage;
- a 4 s still pause in the middle → pause excluded, no knee tip;
- knees rolled in → knee-alignment tip, no depth tip;
- 5° camera roll → no side-tilt tip;
- masked 1 s gap → found, gap excluded from scoring.

**End-to-end smoke test:** record the 3D dancer from `/learn` (Playwright `recordVideo`) as a teacher file, then compare it against a slowed, shifted and padded copy. Expect: found, few or no tips. Plus `tsc`, `eslint` and `next build`.

### Phase 2 calibration

**Harness.**
- `scripts/bake-fixtures.mjs` drives Playwright with `channel: 'chrome'`.
- It **asserts `WEBGL_debug_renderer_info` is not SwiftShader or llvmpipe**, running headed with `--use-angle` on a team laptop.
- Or it calibrates on the CPU delegate, if P0 measures the GPU/CPU difference under ¼ dead band.
- **Detection `configHash` is frozen before calibration**, and re-bake hours are budgeted.
- **Recording starts after the extraction freeze**, so test-retest is measured on the shipped pipeline.

**Synthetic suite (raw lanes, R42):**
- 2-sample, 3 cm lifts at 24/15/10 fps → kept;
- standing start, ±3 cm hip bounce, rising aramandi → 100% of strikes;
- first strike dropped; start at count 4; mixed 2/3/4 counts;
- correct Adavu 5–8 with 15% jitter;
- **declared Adavu 3 danced R R · L L → count tip**;
- **Adavu 7 missing the switch → pattern tip**;
- **Adavu 8 stamp on 8 → silence tip**;
- **correct Adavu 7 at 95% detector recall → no "Keep the count"**;
- **correct Adavu 5 and 8 at 15 and 24 fps → no count tip**;
- **an asymmetric-strength correct take → no count tip**;
- **seam at every phrase; a 1.5 s walk-through in a 4-phrase take → no count tip**;
- **teacher talk gap inside the marked step; student rest mid-take → excluded**;
- **L-start at the count-in → tip; late start at count 4 → no tip**;
- **a 30% rush in 1st speed then a correct doubling → rushing, no under-doubled**;
- Adavu 6 with rests collapsed → "rest collapsed";
- Adavu 1–4 concatenated → split at pauses.

**Templates, Phase 2 v1:**
1. count error (incl. the declared-step prompt);
2. silent-slot strike;
3. start foot (recorder);
4. height steadiness;
5. knee alignment + depth.

"Keep the count" is added once its detector-rate baseline exists.

**Recordings.**
- Each template needs ≥ 20 error instances in split B plus ~20 in split A, plus good takes. That is about **200 deliberate-error step-takes + 40 good takes**.
- **Strata: adults AND children aged 6–10** (guardian consent, through the reviewer's dance-school network), including **naturally occurring beginner errors**, not only acted ones.
- Split by dancer and session.

**Labelling.** Pattern, count, silence and start foot are labelled by listening, blind. Posture is labelled by the reviewer, blind, with magnitude.

**Gate per template and per stratum (split B).**
- Recall ≥ 80% on errors above the detection limit (2 × test-retest SD).
- No wrong-direction tip below the limit.
- Wilson 95% lower bound on precision ≥ 0.75.
- No high-confidence false tip on good takes.
- Pattern templates are gated per fps tier (24 / 15 / 10).
- **Until the child stratum passes, tips on child-sized takes are beta.**

**Required real cases:**
- saree + carpet;
- music; salangai; voice (sollukattu aloud);
- 15 fps webcam; CPU at 10 fps;
- **camera behind the dancer with a mirror in front**; side mirror wall; poster;
- **class video with students behind the teacher**; **TV behind the student**; parent on the sofa;
- **handheld parent clip**;
- **captioned tutorial / PiP**;
- **pallu or printed-top turn**;
- **teacher crossing a wide stage with musicians**;
- Namaskaram bow and 180° turn;
- elbows 15–20° low;
- knees rolling in;
- a student deeper than the reference;
- **child, mirrored front-camera upload**;
- a front-then-back teacher;
- a different-bani version;
- portrait clipping of natyarambhe;
- an auto-framing webcam;
- test-retest.

---

## 10. Reuse map and new modules

**Reused**
- `retarget.ts`: types, `P`/`H`, the track functions (for the overlay only) via `lib/motion/track.ts`.
- `segment.ts`, scaled for fps (Phase 3 structure pass).
- `manifest.ts`: cues and steps feed the pattern cards.
- `MocapFigure` + `samplePose`: the "animation, not compared" reference pane (Phase 2).
- `lib/voice/*` (Phase 3).
- `classification.ts` + `mudras.ts` (v2).

**Restored from `287aba3`, with known bugs fixed**
- The seek loop → the Phase 1 fallback reader.
- `drawOverlay` → `SkeletonCanvas`.
- `bakeStore` → `lib/compare/store.ts` (NVB2, teacher steps only).

**New: `frontend/src/lib/compare/`**

| Module | Phase | Purpose |
|---|---|---|
| `extract.ts`, `queue.ts` | 1 | Reader (rVFC + seek fallback), landmarker, person following, the single-consumer queue |
| `features.ts` | 1 | Segment vectors, angles, ratios, knee alignment, bobbing, mirror |
| `align.ts` | 1 | Subsequence DTW, tries, partial, mirror (pure TS) |
| `feedback.ts`, `tips.en.ts` | 1 | Gates, ranking, bands, wording (pure TS) |
| `store.ts` | 1 | NVB2 teacher steps, delete |
| `reader.ts` | 2 | Mediabunny deterministic reader |
| `record/{recorder,unlock,loop,remux,tempStore}.ts` | 2 | Recorder, audio unlock, loops, remux, encrypted temp record |
| `practiceTrack.ts`, `cards.ts` | 2 | Web Audio clicks, the card table, clip-span mapping |
| `events.ts`, `patterns.ts`, `sections.ts` | 2 | Raw-lane strikes, cyclic DP with rests and masks, declared-step prior, version, sections |
| `audio.ts` | 2–3 | Stamp detector + voice exclusion (2); full policy (3) |
| `people.ts`, `identity.ts`, `shots.ts`, `graphics.ts` | 3 | Classes, signatures, cuts/motion, overlays |

**Elsewhere**
- `components/compare/*`; `app/compare/page.tsx`; Navbar link; `/privacy` lines (Phase 1).
- `lib/youtube/*`; `app/terms/page.tsx`; backend `GET /api/yt/meta` (Phase 3).
- **Dependencies:** none in Phase 1. `mediabunny` (runtime) in Phase 2. `playwright` (dev) for the harness.
- **Rule:** read `node_modules/next/dist/docs/` before writing code (`frontend/AGENTS.md`).

---

## 11. Limits, performance, privacy

**Caps**

| | Phase 1 | Phase 2 |
|---|---|---|
| Teacher step | 2–60 s | Same; 3 min in total over 2–3 ranges in Phase 3 |
| Student take | ≤ 3 min | Recorder default ~30 s; ≤ 2 min |
| Frame rate | ≥ 10 fps processed, resampled to 15 | min(24, source) for footwork; 10 on CPU with the fps gate |

**Estimated processing time** (re-measured once built)

| Job | Desktop | Mid-range phone |
|---|---|---|
| Teacher 30 s step | ~30 s (1×) | ~1–2 min (0.5×) |
| Student 60 s take | ~1 min | ~2–4 min |
| Pattern card | 0 s | 0 s |

**Privacy:** all vision runs on the device. Student video is never kept. The backend only ever sees a YouTube id (Phase 3) and tip text for voice (Phase 3).

---

## 12. Plan and the decisions I need from you

**Phases**

| Phase | Work | Size | Cut first if late |
|---|---|---|---|
| **1** | `/compare` page; teacher upload + step marker; rVFC reader + seek fallback; landmarker + queue + person following; features; subsequence DTW (tries, partial, mirror, relative test); pauses; gates, bands, tips; Show me, ghost, synced playback; NVB2 save/delete; privacy lines; Navbar; unit tests + e2e smoke | 13 subsystems; **~1.5–2 weeks** for a student team | Ghost; saving teacher steps |
| **2** | Mediabunny reader; recorder (tap start, unlock, loop units, remux, encrypted temp record, framing check); pattern cards + practice track + 3D pane; raw-lane events; cyclic DP with rests/masks; declared-step prior + prompt; authoritative version check; start foot (recorder); steadiness; knee alignment; minimal audio (stamps + voice exclusion); harness; calibration with adults + children | ~16 subsystems; ~4 weeks, with recording in weeks 2–3 | Start foot; the stamp detector |
| **3** | YouTube practise-beside; studio references; teacher-file states, proposals, several ranges, `.nvref`; full audio policy; ladder tips; early/late with latency calibration; extra-people classes + identity + graphics; Tier B + ghost on footwork; voice; heavy tier | ~4–5 weeks | Voice; proposals; Tier B |
| **v2** | Chained Tier C (Namaskaram sequences); mudras at body distance; Hindi; worker; rig references; live tips | — | — |

**Decisions for you**

1. **Build order:** Phase 1 (any teacher video file) first, then Thattadavu footwork, then YouTube. OK?
2. **YouTube:** (A) practise-beside in Phase 3: compliant, no AI tips from the YouTube video itself (recommended); or (B) desktop-Chrome tab capture: works on desktop only and goes against YouTube's developer policy (not recommended).
3. **Privacy:** student videos are never kept, and only teacher-step landmarks can be saved (opt-in). OK?
4. **Phase 2 needs people:** a dance teacher as reviewer, and recordings that include children (with guardian consent). Without them, Phase 2 tips stay "beta".
5. **Studio reference dancer** (Phase 3): optional. Pattern cards and teacher files work without one.
6. **Model files:** keep loading them from Google and jsDelivr (as `/live` does today, disclosed in `/privacy`), or self-host them on Netlify (~21 MB, removes the third parties)?
7. **Navbar:** add a "Compare" link?

---

## 13. Known weaknesses (accepted)

- **The literal "skeleton on the YouTube video" is not delivered.** A YouTube-only student gets pattern-card checks and habits (Phase 3).
- **Phase 1 can't see a wrong number of strikes or taps:** DTW treats an extra stamp as slower dancing. Phase 2 fixes this for Thattadavu only.
- **Phase 1 tolerances are first guesses** (beta) until Phase 2 calibration.
- **One step range per teacher file until Phase 3,** so demonstrations spread across a class need two separate steps.
- **Until `.nvref` (Phase 3), each student prepares the teacher step themselves,** and different trims can give slightly different tips.
- **MediaPipe's knee and depth limits plus costumes** mean leg feedback is often withheld.
- **Pattern cards encode one version.** Other banis get "My version is different" and no pattern tips.
- **Phone processing takes minutes:** about as long as the video at 0.5–1×.
- **Start foot is only checked on recorder takes.**
- **Forward lean can't be seen from the front.**
- **Side tips need facts,** so most uploads get side-free tips, pointed at with colour instead.
- **Full-body mudras, Namaskaram sequences and Hindi wait for v2.**
- **If the reviewer or recordings slip, fewer Phase 2 templates ship.** Phase 1 still works as a complete tool.
