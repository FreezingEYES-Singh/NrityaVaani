# Video compare: Phase 1 (the core path), for approval

> **Status:** proposal, waiting for the user's OK. No feature code is written yet.
> - This is **Phase 1** of the roadmap in `03-design.md` (revision 5). It is the first thing to build.
> - It includes the round-3, round-4 and round-5 critic fixes that apply to it, listed in `04-open-issues.md`.
> - The round-4 and round-5 algorithm fixes were checked in a synthetic prototype, now kept in `docs/video-compare/prototype/` as the starting test suite.

---

## 1. The short answer

A new page, **`/compare`** ("Compare with teacher"), in three steps.

**1. Teacher video.**
- Upload a video file and mark the one step you want to practise (2–60 s):
  - a zoomed strip;
  - "Start here" / "End here" buttons at the playhead;
  - ±0.5 s nudges;
  - "Play selection".
- The app suggests the moving part around where you paused.
- The app finds the body in every frame **on your device** and draws the stick figure on the teacher video.

**2. Your video.**
- Two buttons:
  - **"Choose a video"**: any video from your phone or computer;
  - **"Record"** (phones only): opens the phone's own camera.
- Before the camera opens, the teacher step is saved for this session, so it isn't lost if the phone reloads the page.
- Extra bits at the start and end, pauses, doing the step several times, or a different speed are all fine.

**3. Result.**
- Both videos side by side with stick figures. One Play button starts both, lined up with each other.
- Up to **3 corrections** and **1 thing you did well**, plus a separate **Timing** line.
- A band for Arms, Legs, Torso and Timing, with a "Not checked" note where something couldn't be judged.
- Each tip has **"Show me"**: both videos pause at the worst moment, and the joint is marked with a ring and an arrow on you (and on the teacher).
- If time allows, a **"Ghost"** switch draws the teacher's stick figure over your body.

**YouTube** can't be done the way it was asked (§4), so it's not in Phase 1. Decision 2 offers either a watch-only YouTube player soon after Phase 1, or the full "practise beside" mode in Phase 3. Neither compares you with the YouTube video itself.

---

## 2. How it handles "not all movement is necessary, different lengths"

**The app first decides what kind of step the teacher marked** (from the teacher video alone):

| Step kind | Example | How you're compared |
|---|---|---|
| **Movement step**: the body moves clearly | Natta adavu arm sweeps, Namaskaram "Saluting around", most choreography | Your moves are **searched for and lined up** with the teacher's (stretching time), then compared part by part |
| **Posture step**: the posture stays and only small parts move | Thattadavu (aramandi + stamps), Tapping | Your **posture** while doing the step is compared. You're also told if a part that should move barely moved ("your feet hardly moved"). **The count and timing of stamps are not checked in Phase 1** (that is Phase 2). |
| **Hold**: mostly still | Samapada, an aramandi hold, Guru Vandana | Your steadiest 2 s **in the teacher's posture** are compared |

| Problem | What Phase 1 does |
|---|---|
| Teacher video is long, with talking and many steps | You mark one step, and the app suggests the moving part. Only that is processed. It warns if your selection is mostly still. |
| Your video is longer: walking in, standing, then walking out | For movement steps the teacher's step is **searched for inside your video**. For posture steps, only the frames where you're in the step's posture are used. Everything else is ignored. |
| Slower, faster, or uneven speed | Time is stretched to line up (movement steps). Speed is reported separately, never as a posture error. If you're more than 2× off, the result says "more than 2× slower" rather than giving a precise number. |
| Pauses (the teacher explains, you catch your breath) | In movement steps, still stretches of ≥ 1.5 s **that aren't part of the step's own poses** are cut before lining up, from both videos, together with the standing-up and sitting-down around them. They are shown as "pause (not judged)". A pose that is held as part of the step is never cut. |
| You did the step 3 times | Each try is found. A tip must show up in at least half of your tries. |
| You did only part of the step | "You practised about 50% of the step. Tips cover that part." There's no speed tip for a partial practice. |
| You did something else, or just stood there | "We couldn't find the teacher's step in your video." Standing still in the right posture doesn't count as doing a movement step. |
| The teacher's incidental movement | Switch body parts off (Arms, Legs, Torso, Head). |
| Mirroring | Tried both ways. Without strong evidence the normal way is used, and only tips both ways agree on are given. Tips point at the joint on screen, never "left/right". |
| Child vs adult; near vs far | Angles and ratios, so size and distance cancel out. Noise limits are measured per video, so a small, far-away child doesn't get false "bouncing" or "not still" readings. |
| Different camera angle; a tilted phone | View-dependent tips switch off when the angles differ by > 30°. Tilt cancels out because things are measured relative to your own body. |
| Saree hides the knees; someone walks past; you bend down or turn | Those frames or joints are not judged, and the result says why. The dancer is found again after a turn or bend. |

---

## 3. How it works (technical)

### 3.1 Extraction (on the device; nothing uploaded)

**Models** (`@mediapipe/tasks-vision` 0.10.34, already installed; the `full` pose model):
- **Main pass:** VIDEO mode with `numPoses: 1`.
  - MediaPipe's **landmark smoothing only runs with `numPoses: 1`**: `pose_landmarker_graph.cc` enables it only for a single pose. With 2 there would be no smoothing at all.
  - With 1, it also runs the person detector only when tracking is lost, which is faster.
- **Identity pass:** IMAGE mode with `numPoses: 3`, about once a second (Phase 1 only uses it for checking people):
  - it finds other people for the warning;
  - it checks that the main pass is still on the chosen dancer, and masks frames where it isn't.

**Choosing and keeping the dancer.**
- **Start:** the biggest, most central body. Ankles must be in frame only when Legs is switched on.
- **Same dancer** means all of:
  - hip-centre continuity;
  - a box height within a tolerance that **grows with the time since she was last seen**;
  - facing (front / side / back) changing only through side. The facing rule applies only when ≥ 2 people are present.
- **Lost for > 1 s:** re-pick the biggest central body. Bends (muzhumandi) and turns (Saluting around) therefore don't lose her for good.
- **Warning** when a second person at **similar depth** (box height within 25%, feet at a similar height) is present for ≥ 20% of the time. People smaller and higher in the frame are behind her and are ignored.

**Frames.**
- Each frame is drawn into **our own canvas, ≤ 960 px** on the long side. This applies the video's rotation and stops 4K frames being uploaded to the GPU at full size.
- That canvas is what the model sees. We pass our own WebGL canvas, so a **lost GPU context** is caught and the model is recreated, instead of silently reading "no person".
- **Before processing**, the app checks:
  - the video has a width and a non-blank frame within 3 s; otherwise "Your phone saved this in a format this browser can't play";
  - the first real frame passes the GPU check (otherwise CPU);
  - the detected body is upright (otherwise retry with a rotation).

**Reading frames, and iPhone rules.**
- Every `play()` is **primed inside a tap**: "Prepare" and "Analyse my video" each call `play()` then `pause()` on their video element before any `await`.
  - iPhones in Low Power Mode, or hot, refuse `play()` without a tap (WebKit), so "Analyse my video" is its own tap.
- **Reading:**
  - the video plays muted, and `requestVideoFrameCallback` gives each frame and its `mediaTime`;
  - if fewer than 10 frames per video-second get processed, it slows to 0.5×, then 0.25×;
  - if `play()` is refused or the video pauses by itself, it switches to the **seek loop** and shows "Tap to continue".
- **Seek loop:** wait for `seeked` **and a newly presented frame**. If that doesn't arrive in time, the sample is dropped, never labelled with the wrong time.
- **Timestamps** always increase, and each new video starts 10 s past the last one.
- **One job at a time**, in a queue.
- The Wake Lock is re-requested whenever the tab becomes visible again. Processing pauses while the tab is hidden.

**Your video in two passes** (so a 3-min take isn't a 10-min wait):
1. **Quick scan** at about 5 samples per video-second, using faster playback when the device keeps up, to find where the step is.
2. **Full rate** only on the found parts ± 2 s.

If fast playback isn't possible, there is one pass, and the wait is shown first.

**Wait estimate:**
- the download size is always shown the first time (~21 MB);
- the ETA comes from the download plus a short speed test on the first real frames, not from guesses while dragging.

**Cleaning.**
- MediaPipe's own smoothing, plus a 3-frame median per feature.
- Each video's **jitter is measured on its own still frames**, and every stillness or bobbing threshold is relative to that jitter.
- The mocap clean-up filters are used only to draw a steady skeleton.
- Both tracks are resampled onto one 15 fps timeline.
- **Missing or doubtful frames** (no person, wrong person, out of frame, low visibility) are masked. They get a neutral cost in the alignment and are left out of every count.

### 3.2 Jitter, step kind, then pauses (in that order, R5-1)

**1. Jitter, defined once per video.** The residual of a robust 1 s local fit to each landmark track, as a position SD, in torso lengths. This works even when a video has no still frames. Every noise-relative threshold below uses it.

**2. Step kind, decided on the uncut teacher step:**
- **Motion** = the noise-corrected spread of the teacher's alignment features around their median, √(raw² − jitter²), in radians.
  - In the round-5 experiment this was stable from 1× to 4× noise: Thattadavu-like 0.02, irregular 0.18–0.19, arms-only 0.29–0.31.
  - The round-4 ratio m_T was a signal-to-noise ratio, so a small, noisy teacher could flip from "movement" to "posture".
- **Hold:** if ≥ 60% of the step is still (windowed displacement, see 3) **and** motion < 0.07.
- **Movement step:** motion ≥ 0.07 rad.
- **Posture step:** otherwise.
- The alignment features include **hip height ÷ torso length and segment-length ratios** (foreshortening), so up/down steps (squat dips, touching the ground, rising) count as movement. 2D directions alone can't see up/down motion.

**3. Pauses, only for movement steps.**
- **Stillness** = windowed displacement over ±0.5 s below 3 × jitter, not per-frame speed: at 15 fps, per-frame speed can't tell motion from jitter.
- A still run of ≥ 1.5 s is cut **only if its pose is far from every teacher frame** (cost to the nearest teacher frame > τ_P, §3.5). A pose held as part of the step is never cut.
- **The transitions into and out of a cut pause** (standing up, sitting back down) get a neutral cost for ±1 s and are left out of scoring.
- **Holds and posture steps are never pause-cut.** Round 5 showed that cutting first deleted whole holds, frozen poses and slow movement at child-level noise.
- Cuts keep an index map for playback, and are left out of speed.

### 3.3 Features

**For alignment (movement steps):**
- the 2D direction of 10 body segments (upper arms, forearms, thighs, shins, torso, shoulder line), **de-rolled by the take's median torso axis** (so a tilted phone doesn't add cost), weighted by visibility and the body-part switches;
- **hip height ÷ torso length and segment-length ratios**, for up/down movement;
- their velocities, which decide the mirror;
- a mirrored version swaps left and right and flips x.

**For tips:**

| Feature | Measured from | Tolerance | Kind |
|---|---|---|---|
| Knee bend L/R | 3D angle hip–knee–ankle | 15° | More bend is fine (never praised) |
| Elbow bend L/R | 3D angle shoulder–elbow–wrist | 20° | Both ways |
| Arm height L/R | 2D angle of the upper arm from the torso | 15° | Both ways |
| Knee spread | Knee distance ÷ hip width | 0.25 | More is fine |
| Foot spread | Ankle distance ÷ hip width | 0.25 | Both ways |
| Side tilt | 2D torso axis minus the hips→ankles axis | 8° | Less is fine |
| Bobbing | Hip height relative to the lower foot **along the body's own axis** ÷ torso length, spread over the span | Teacher's + max(0.03, 3 × that video's jitter) (jitter as defined in §3.2) | Less is fine |
| **Range of movement** per angle | Your 90th–10th percentile spread vs **the matched teacher span's** (only where the teacher's spread ≥ 2 × tolerance) | Yours < 0.7 × the teacher's | "Move bigger / raise higher" |
| **Part moving** (posture steps) | **Noise-subtracted** motion energy per body part vs the teacher's, **only for parts the teacher moves** (≥ 2× noise) | Yours < 0.3 × the teacher's | "Your feet hardly moved" |
| **Knee roll-in** (absolute, never vs the teacher) | On frames with ≥ 20° of knee bend: the 3D angle between the knee's bend direction and the foot's direction (ankle → toe), both projected onto the plane perpendicular to the hip–ankle line. Roll-in is claimed only if that angle points ≥ 25° inward on ≥ 40% of bent frames **and** the knee sits inside the ankle on screen. | — | Safety |
| Speed | Your matched duration ÷ the teacher's (pauses excluded) | outside 0.8–1.25 | The separate Timing line |

- **Why the knee check is absolute:** the round-4 experiment showed that comparing the knee's sideways offset with the teacher's reads a shallow bend as "rolling in". The knee moves outward as it bends, so the old feature mixed depth with alignment.
- **Noise bias on 3D angles:** depth noise makes near-straight joints read bent (an elbow at 175° read 164° at 3× noise). Each video's bias is estimated by applying its measured jitter to the teacher's pose (20 random draws). The bias is subtracted, and a feature whose bias exceeds half its tolerance is skipped ("not checked").
- **View check:** body turn from the 3D shoulder line. If it differs from the teacher's by > 30°, arm height, spreads and side tilt are off.
- **Forward lean** can't be seen from the front, so the Torso band reads "Partly checked: side tilt only".
- All tips are labelled **"beta"** until calibration (03 §9).

### 3.4 Movement steps: finding and lining up (subsequence DTW)

- **Query** = the teacher step (pauses cut per §3.2). **Search space** = your video (pauses cut per §3.2). Both are at 15 fps.
- **Recurrence:** free start and end in your video. Steps (1,1), (1,2), (2,1), (1,3) and (3,1).
  - A (2,1) or (3,1) step (you're faster) charges each skipped teacher cell.
  - A (1,2) or (1,3) step (you're slower) charges **the mean of your cells it covers**, plus λ = 0.1 × median row-min(C) for each extra cell.
  - Round 5: charging every slow cell in full made slow beginners fail. The averaged charge found beginners at 1×, 1.5×, 2× and 3× with correct spans, and still rejected every negative.
- **Normalised cost** = D ÷ (teacher frames).
- **Was it found?** Both must hold:
  1. **Ceiling:** best ≤ τ_T = max(0.5 × the step's cost against a neutral standing pose, **τ_floor**). τ_floor = the cost of a pose that is off by each feature's tolerance, plus 2 × your video's jitter cost. Without the floor, a near-neutral step (Samapada with arms down) had τ_T ≈ 0.06 and rejected good takes.
  2. **Real movement:** best ≤ 0.7 × the cost of the teacher's step against **your own frozen median pose** over the matched span. In round 5 this rejected every negative case (standing, waving, squats, other moves, a frozen pose).
  - The round-4 "dip below the costs outside the match" test is **dropped**: in 80 movement cases in round 5 it never decided an outcome.
- **More tries:** candidates are scanned in order of cost; **a failing candidate doesn't stop the scan**. Accept up to 6 non-overlapping tries, each passing both tests and costing ≤ 1.5× the best.
- **Partial practice:**
  - the reverse search runs when nothing is found **or the match is squeezed** (span < 0.75, or more than half the path steps are compressions);
  - its query is **your frames that are within τ_P of some teacher frame** (§3.5), so getting into and out of the pose doesn't count as part of the step;
  - the reading with the lower cost per student frame wins;
  - a partial reading reports coverage, **compares range of movement against the matched teacher span only**, and gives no speed tip.
- **Mirror:**
  - decided on segment **velocities**, after resampling the student by the matched speed (round 5: a take more than 2× faster picked the wrong mirror on raw velocities);
  - a clear win (> 10%) picks that way;
  - otherwise the **normal** way is used, and only tips that both readings agree on are kept.
- **Every frame of yours in the matched span is scored**, against its teacher frame on the path.
- **Speed** on the Timing line: the ratio when it is between 0.5× and 2×, otherwise "**more than 2× slower / faster**". The same wording is used in 03.
- **Synced playback:**
  - a smoothed speed map: straight pieces of ≥ 1 s, clamped to 0.5–2×, updated at most twice a second;
  - one Play button starts both videos inside the tap;
  - the teacher is muted by default, with a "Sound: mine / teacher's" toggle (iPhones won't play two videos with sound).

### 3.5 Posture steps and holds

- **τ_P** = τ_floor (§3.4): the cost of a pose off by each feature's tolerance, plus 2 × your video's jitter cost. It doesn't depend on what else is in your video (round 5: the old "0.6 × your video's median" term made the same take found or not depending on a walk-in).
- **Posture step:** your frames whose cost to the teacher's median pose is ≤ τ_P, in runs totalling ≥ 0.5 × the teacher's length.
- **Hold:** the longest such run (≥ 1 s), then the steadiest 2 s inside it.
- If no such frames exist: "We couldn't find you in the teacher's posture."
- **Judged:** posture as distributions (median and 10th/90th percentiles of each feature over the found frames vs the teacher's), plus the "part moving" check.
- **Not done:** the speed tip, tries, or path playback. Playback lines up the starts.
- The result shows: "Footwork count and timing aren't checked yet."

### 3.6 Feedback rules

- **Phases:** the teacher's step is split into phases at its velocity minima (0.5–2 s each). Posture and hold steps count as one phase.
- For each feature and phase, over the matched frame pairs (pauses and masked frames excluded): difference = you − teacher.

**A correction fires only if all of these hold:**
- in at least one phase, the median difference is beyond the tolerance (in the bad direction for one-sided features); **or** the range-of-movement or part-moving check fails;
- the joints were clearly seen (visibility ≥ 0.6) in ≥ 70% of those frames;
- it shows up in at least half of your tries;
- the view gate passed (2D features).

**Safety:**
- **knees rolling in** → "Push your knees out over your toes before going lower", and no depth tip;
- **knee alignment not judgeable** (fewer than 1 s of bent, clearly seen frames) → no "lower" tip. **But** if your legs are nearly straight (knee > 165°) while the teacher's are bent (< 150°), the safe tip "**Bend your knees a little, keeping them over your toes**" is given. Round 5: otherwise the most common beginner correction was blocked exactly when it was needed.
- a depth tip always says "a little lower… don't force it".

**Ranking and output:**
- Severity = (|median difference| ÷ tolerance) × the share of the step's time in failing phases.
- Top 3, one per body part. **Timing is a separate line**, never one of the 3.
- **Strength:** a clearly seen body part within half the tolerance **in every phase**. "More is fine" features are never praised.
- **Bands** for Arms / Legs / Torso / Timing: Close match / Getting there / Needs work. There is no % score. A band is never better than "Getting there" when a tip from that part is shown. "Partly checked: …" lists what wasn't judged.
- A standing line: "**If your teacher says otherwise, follow your teacher.**"

**Example wording:**
- "Raise your arms higher: at the top of the sweep they reach about two thirds of the teacher's height." (range of movement)
- "Bend your knees a little more. Sit lower into aramandi, keeping your knees out over your toes; don't force it."
- "Your feet hardly moved; this step has footwork. Practise it with the stamps." (posture step)
- "Stay at the same height: your hips bounce while the teacher's stay level."
- Timing: "About 30% slower than the teacher. Practising slowly is fine; speed up when you're comfortable."

**Marking joints:** a thick highlighted limb, a ring and a direction arrow, so it doesn't rely on colour. Joints the model isn't sure about are drawn faded, never red.

### 3.7 Privacy and storage

- **No video or frame ever leaves the device.**
- **Your videos and results are not saved by NrityaVaani.** They live in memory only.
  - Object URLs are released when you leave `/compare` (also on in-app navigation).
  - On `pagehide` everything is cleared.
  - If the browser restores the page from its back/forward cache, it starts again at step 1. So the next person on a shared phone can't press Back and see your take.
- **Teacher step data:**
  - saved for the session automatically before the camera opens (so a reload doesn't lose it), then deleted;
  - kept longer only if you tap "Save this teacher step";
  - the saved key is a fingerprint (size, duration, dimensions, hash of the first and last 1 MB, the marked range), so it is found again even if the phone hands over a fresh copy of the file;
  - "Delete saved steps" is on `/compare` and `/privacy`;
  - landmarks only, never video.
- **`/privacy` changes:**
  - "Videos you use in Compare are processed on this device and never uploaded. NrityaVaani never saves your own videos. If you record with your phone's camera, the camera app may keep its own copy in your gallery; delete it there if you want."
  - "Model files are downloaded from Google and jsDelivr when you use the camera or video features; no video or images are sent." (Removed if we self-host; decision 6.)
  - The "No Recording or Surveillance" pillar is reworded so it stays true next to a "Record" button: "Nothing is recorded unless you choose to, and recordings never leave your device."

### 3.8 Files

New unless noted:

| File | What |
|---|---|
| `src/app/compare/page.tsx` | Server component (sets the page title) rendering `CompareClient` |
| `src/components/compare/CompareClient.tsx` | The 3-step flow; inline status (no toasts) |
| `src/components/compare/VideoPanel.tsx` | `<video>` + skeleton canvas + joint marker + ghost |
| `src/components/compare/TrimBar.tsx` | Zoomed strip, Start/End-here, nudges, play selection; handles are accessible sliders |
| `src/components/compare/Results.tsx` | Bands, Timing line, "Not checked" notes, tips, Show me, switches |
| `src/lib/compare/extract.ts`, `queue.ts`, `identity.ts` | Models, frame canvas, reader, two-pass scan, dancer choice, job queue |
| `src/lib/compare/features.ts` | Segment vectors and velocities, angles, ratios, knee roll-in, bobbing, range of movement |
| `src/lib/compare/align.ts` | Pauses, step kind, subsequence DTW, found tests, tries, partial, mirror, posture/hold matching (pure TS) |
| `src/lib/compare/feedback.ts`, `tips.en.ts` | Phases, gates, ranking, bands, wording (pure TS) |
| `src/lib/compare/store.ts` | Session and saved teacher steps (NVB2) + delete |
| `src/lib/compare/*.test.ts` | Node 22 `--experimental-strip-types` tests; no new dependency |
| `Navbar.tsx` (edit) | "Compare" link |
| `LiveChat.tsx` (edit) | Hidden on `/compare` (it covers the stacked phone panes) |
| `privacy/page.tsx` (edit) | The lines above + the delete button |

No new npm dependencies and no backend changes.

---

## 4. YouTube: why the literal request can't be built

Checked in `01-research-brief.md`:
- **Drawing on the YouTube player is forbidden** by YouTube's embed rules.
- **A web page can't read the pixels** of a YouTube embed (browser security).
- **Downloading on our server (yt-dlp)** breaks YouTube's Terms, is blocked on Render's servers, and breaks the "nothing leaves your device" promise.
- **Screen-capturing the tab** is desktop Chrome/Edge only and conflicts with YouTube's developer policy III.I.14.
- **The honest route:** a teacher's own YouTube video can be downloaded from YouTube Studio and uploaded here. The page says so.

---

## 5. How this was attacked and fixed

> **How this was reviewed:**
> 1. A single-pass self-review (A1–A17).
> 2. The round-3 critic issues that apply to Phase 1 (R1–R10).
> 3. Round 4: four critic agents, one of which built a synthetic prototype of §3.4 and ran 20+ cases (F1–F18).
> 4. Round 5: one critic re-ran the prototype on the revised rules (105 cases; G1–G8).
>
> The full round-4 issue list is in `04-open-issues.md`.

| # | Proposal | Attack | Fix |
|---|---|---|---|
| A1–A4 | Frame by frame; plain DTW; fixed cost; best match only | Lengths, padding, beginners, luck | Subsequence DTW, relative + absolute found tests, tries |
| A5–A9 | Partial; raw positions; 2D angles; "left arm"; tip on any difference | Coverage, size, view, mirroring, noise | Reverse search, ratios, view gate, joint markers, gates |
| A10–A17 | Mocap filters; % score; seek-only; save videos; in-page recorder; DTW counts | Lifts erased, fake precision, slow phones, children, iOS, stamp counts | See the earlier rows; stamp count → Phase 2 |
| R1–R10 | Round-3 fixes | Safety gate, tilt, forward lean, pauses, holds, people, privacy, children | Kept, and refined below |
| F1 | Whole-body posture DTW for every step | **Thattadavu-like steps have no timing signal** (m_T ≈ 1): correct takes rejected, a frozen aramandi "found" | **Step kinds**: posture steps are judged as posture plus "part moving"; no timing claims |
| F2 | Baseline = median of the whole cost profile | Rejects tight and beginner takes; accepts another adavu | Baseline outside the match + absolute ceiling + "real movement" test (validated) |
| F3 | Pauses removed after alignment | A 4 s pause split one try into two squeezed halves | **Cut before alignment** (validated: 1 try, error 0) |
| F4 | Reverse search only if nothing is found | 50% takes "found" squeezed, with a false speed tip | Also when squeezed; better reading wins; no speed tip when partial |
| F5 | Steps of ½–2× only | Span limits never apply; half-speed misaligned | (1,3)/(3,1) steps; "more than 2×" wording |
| F6 | Median over the whole step | Arms never raised in one third of the step: no tip, even a "strength" | **Per-phase medians + range of movement**; strengths must pass in every phase |
| F7 | Knee offset compared with the teacher | A shallow bend reads as rolling in | **Absolute 3D roll-in** + knee inside the ankle |
| F8 | Mirror from cost, tie → no side words | Beginner ties picked the wrong mirror plus a half-phrase shift (6/6 seeds) | Mirror from velocities; tie → normal way; only agreed tips |
| F9 | Holds through the step search | Judged by duration | Holds bypass the search |
| F10 | Default 30 s around the playhead | Mostly talk around a 6 s step | Suggest the moving run (2–12 s); warn if > 40% still |
| F11 | `numPoses: 2` "with MediaPipe smoothing" | **No smoothing with 2 poses**; detector behaviour changes | `numPoses: 1` (smoothed) + a 1 Hz IMAGE identity pass; jitter-relative thresholds |
| F12 | `play()` after downloads | iPhone Low Power Mode blocks it, so progress sits at 0% | Prime inside each tap; separate "Analyse" tap; seek fallback; "Tap to continue" |
| F13 | Phone camera via the file input | Android 14+ hides the camera option; low-RAM phones reload the tab | Two buttons (Record = `capture="user"`); teacher step saved for the session first |
| F14 | Follow the body if size within 25% and same facing | A bend or turn loses her forever | Gap-growing tolerance, facing through side, re-pick after 1 s |
| F15 | Drag two handles | Unusable on a 50-min file on a phone | Zoomed strip, Start/End-here, nudges, sliders |
| F16 | GPU checked on a still image | HEVC, rotation, 4K and a lost context read as "no person" | Own ≤ 960 px canvas, pre-checks, our own GL context |
| F17 | Sync by `playbackRate` of the teacher | iOS pauses one video; rates warble | One Play tap, teacher muted, smoothed rate map |
| F18 | "Gone when you leave"; red = error | Back/forward cache restores it; red already means "unsure", and colour-blind users can't tell | `pagehide`/`pageshow` reset; ring + arrow markers; LiveChat hidden |

| G1 | Cut pauses before anything else | Deleted whole holds, frozen poses, and slow movement at child noise | Decide the step kind on the uncut step. Never cut holds or posture steps. Cut only still runs that match no teacher frame, plus their transitions. |
| G2 | Charge every skipped cell in full | Slow beginners (2–3×) were rejected | Slow steps charge the mean of the covered cells + λ (validated) |
| G3 | m_T = cost ÷ jitter, threshold 3 | A signal-to-noise ratio: a noisy teacher flips the kind; up/down steps are invisible | Noise-corrected motion (threshold 0.07 rad, stable across 1–4× noise); hip height and segment-length features |
| G4 | τ_T only; "0.6 × take median" for posture | τ_T ≈ 0 on near-neutral steps; results depend on the walk-in | τ_floor from the tolerances + jitter; τ_P doesn't depend on the rest of the take |
| G5 | Per-frame stillness; cut only the still part | Jitter reads as motion; standing up to pause gave false tips | Windowed displacement; transitions ±1 s neutral and unscored |
| G6 | Reverse search on "the moving part" | Getting into and out of the pose broke partial matches; range compared with the whole step | Query = your frames near some teacher frame; range vs the matched span |
| G7 | Raw energy, second-difference jitter, raw 3D angles | Frozen students not caught at noise; false bobbing; elbows read bent at noise | Noise-subtracted energy on parts the teacher moves; one jitter definition; 3D angle bias estimated and removed or skipped |
| G8 | No depth tip when knees can't be judged | Blocks the most common correction | The safe "bend a little, knees over toes" when your legs are straight and the teacher's are bent |

**Known Phase 1 limits (accepted):**
- No AI tips from YouTube links.
- Thattadavu-type steps get posture checks only (no stamp count or timing).
- No mudra tips at full-body distance.
- Leg tips are often withheld under a saree.
- Forward lean is not checked from the front.
- One step range per teacher file.
- Each student marks the teacher step themselves.
- Tolerances are first guesses (beta).

---

## 6. Build order (after approval)

Each step is checked before the next.

**1. Pure logic with Node tests** (`features.ts`, `align.ts`, `feedback.ts`).
- **Start from `docs/video-compare/prototype/`**: the round-5 synthetic suite of 105 cases on three synthetic steps (A: no cycle, W: arms only, P: Thattadavu-like) at several noise levels.
  - Run it with `ORDER=fixed SKIPW=-1 node --experimental-strip-types cases.ts`.
  - With round-5 fixes G1 and G2 it passes **88/105** (`results-with-round5-fixes.txt`).
  - The 17 failures are mostly 3–4× noise (child-distance) and 15° roll, which G3–G8 target.
- Port the logic into `src/lib/compare/` as typed modules, implement G3–G8, and drive the suite to all passing. Any case that is accepted as a known limit instead is written down in this file.
- The suite must also cover:
- 0.6× and 1.8× stretched copies, padded → found, no tips;
- **a tight trim** → found;
- 3 tries → 3 found;
- mirrored → found, normal way unless clear;
- standing, waving, squats → not found;
- **frozen in the right posture on a movement step** → not found;
- another adavu-like move → not found;
- a beginner (tight and padded) → found, knee tip;
- 40% partial with an arm 15° low → partial, arm tip, no speed tip;
- a 4 s pause → cut, 1 try;
- teacher talk inside the step → cut, found;
- 2.3× slower → aligned, "more than 2× slower";
- **arms never raised in one phase** → arm tip, not a strength;
- a 70%-height arm raise → range-of-movement tip;
- **step-P** → posture step, posture tips, "feet hardly moved" when frozen;
- a 20 s hold vs a 5 s teacher hold → found;
- correct deep and shallow knees → no roll-in claim;
- rolled-in knees → roll-in tip, no depth tip;
- a small child at 3 m standing still → no bobbing or pause errors;
- 5° camera roll → no tilt tip.

**2. Extraction:** `extract.ts`, `identity.ts`, `queue.ts`, `VideoPanel`. Skeleton on uploaded videos in headless Chromium (CPU delegate set explicitly; it is a smoke test, not a calibration). Then an iPhone and an Android 14+ phone: Low Power Mode, an HEVC `.mov`, a portrait video, the camera handoff.

**3. The `/compare` page:** trim, progress, results, Show me, switches, sync play, save/delete, Navbar, LiveChat hide, privacy lines, back/forward-cache reset.

**4. End-to-end:**
- record the 3D dancer from `/learn` as a teacher file and compare it with a slowed, shifted, padded copy;
- expect: found, few or no tips;
- plus `tsc`, `eslint` and `next build`.
