# Video compare: Phase 1 (the core path), for approval

> **Status:** proposal, waiting for the user's OK. No feature code is written yet.
> - This is **Phase 1** of the roadmap in `03-design.md` (revision 3). It is the first thing to build.
> - It includes the round-3 fixes that apply to it; `04-open-issues.md` lists them.

---

## 1. The short answer

A new page, **`/compare`** ("Compare with teacher"), in three steps:

1. **Teacher video.** Upload a video file. Drag two handles to mark the one step you want to practise (2–60 s). It starts as 30 s around where you paused, and the time it will take is shown as you drag.
   The app finds the body in every frame **on your device** and draws the stick figure on the teacher video.
2. **Your video.** Upload your practice video, or on a phone tap "Record" (this opens the phone's own camera). Any length up to 3 minutes.
   Extra bits at the start and end, pauses, doing the step several times, or a different speed are all fine.
3. **Result.** Both videos side by side with stick figures, played in sync: the app lines up your moves with the teacher's.
   - Up to **3 corrections** and **1 thing you did well**.
   - A band for Arms, Legs, Torso and Timing, with a "Not checked" note where something couldn't be judged.
   - Each tip has **"Show me"**: both videos pause at the worst moment, with the joint red on you and green on the teacher.
   - A **"Ghost"** switch draws the teacher's stick figure on top of your body.

**YouTube** can't be done the way it was asked (§4). It is not in Phase 1. In Phase 3 it becomes "practise beside": the YouTube video plays untouched next to your video with your stick figure, but there are no AI tips from it.

---

## 2. How it handles "not all movement is necessary, different lengths"

| Problem | What Phase 1 does |
|---|---|
| Teacher video is long, has talking, has many steps | You **mark one step**. Only that part is processed. |
| Your video is longer: walking to your spot, standing, dancing, walking to the phone | The app **searches for the teacher's step inside your video**. Anything before and after the match is ignored. |
| You dance slower, faster, or speed up and slow down | Time is **stretched** (DTW) so the same moves line up. Your overall speed becomes its own Timing tip. |
| You did the step 3 times | Each try is found. A tip must show up in **at least half of your tries**. |
| You did only part of the step | "You practised about 50% of the step. Tips cover that part." |
| You did something else, or just stood there | The match must be **clearly better than the rest of your video** (a relative test, so beginners aren't rejected). Otherwise: "We couldn't find the teacher's step in your video", and no wrong tips. |
| The teacher stops to explain inside the step, or you stop to catch your breath | A still pause of ≥ 1.5 s inside a moving step is **left out of scoring** and shown as "pause (not judged)". |
| A hold step (Samapada, an aramandi hold) | The longest run where you're in the teacher's posture is used, then the steadiest 2 s in it, not the moment you stood waiting. |
| The teacher moves things that don't matter | **Switch body parts off** (Arms, Legs, Torso, Head). A difference must last **at least 40% of the step**. |
| You mirror the teacher (or the phone mirrors your video) | Tried both normal and mirrored. Tips point at the **joint on screen** in colour, never "left/right". |
| Child vs adult, near vs far | Everything is angles and ratios, so size and distance cancel out. |
| Different camera angle | If your body's turn differs from the teacher's by > 30°, the tips that depend on the view are switched off, and you're told why. |
| Phone held by hand, slightly tilted | The tilt-based features are measured relative to your own legs, so a tilted camera cancels out. |
| Saree hides the knees, body leaves the frame, someone walks past | Those frames or joints are **not judged**, and the result says what wasn't checked and why. |

**The one thing Phase 1 can't see:** a wrong **number** of stamps or taps inside a repeating step (an extra stamp looks like slower dancing). Phase 2 adds a strike-count check for Thattadavu.

---

## 3. How it works (technical)

### 3.1 Extraction (on the device, nothing uploaded)

- **Model:** MediaPipe **PoseLandmarker** (`@mediapipe/tasks-vision` 0.10.34, already installed), the `full` model. GPU, with an automatic CPU fallback checked on a known-good test image. VIDEO mode, `numPoses: 2`.
- **Frame reading:**
  - the video plays muted, and `requestVideoFrameCallback` gives each frame with its exact `mediaTime`;
  - the model runs on as many frames as the device can handle;
  - if fewer than 10 frames per video-second are processed, playback slows to 0.5×, then 0.25×;
  - fallback: a seek loop (the old `/mocap` loop, commit `287aba3`).
- **One job at a time:** a small queue runs the teacher step, then your take. Timestamps never go backwards: each new video starts 10 s past the last stamp, which also resets the model's smoothing without rebuilding it.
- **Which person:**
  - start with the biggest, most central body whose ankles are in frame;
  - then follow the body nearest the last position **with a similar size** (box height within 25%) and **the same facing** (so a mirror reflection never takes over);
  - warn when a second person **of similar size and foot height** is present for ≥ 20% of frames. Smaller people standing behind are ignored.
- **Out of frame:** landmarks outside the frame edges (2%) are not judged.
- **No heavy cleaning:** only MediaPipe's built-in smoothing and a 3-frame median per feature. The mocap clean-up filters (`despikeTrack`/`stabiliseTrack`) erase quick foot lifts, so they are used only to draw a steady skeleton.
- **Resampling:** both tracks go onto one 15 fps timeline.
- **Missing frames:** frames with no person or low visibility are **masked**. They get a neutral cost in the alignment and are left out of every scoring count.

### 3.2 Features

**For alignment:** the 2D direction of 10 body segments (upper arms, forearms, thighs, shins, torso, shoulder line) as unit vectors. Each segment is weighted by how clearly it was seen and by the body-part switches. A mirrored version swaps left and right and flips x.

**For tips (per frame):**

| Feature | Measured from | Tolerance | Kind |
|---|---|---|---|
| Knee bend L/R | 3D angle hip–knee–ankle | 15° | More bend is fine (never praised) |
| **Knee alignment** | Knee's sideways offset from the line of its foot (ankle → toe), ÷ hip width | 0.15 | Rolling in is bad |
| Elbow bend L/R | 3D angle shoulder–elbow–wrist | 20° | Both ways |
| Arm height L/R | 2D angle of the upper arm **from the torso** | 15° | Both ways |
| Knee spread (turn-out) | Knee distance ÷ hip width | 0.25 | More is fine |
| Foot spread | Ankle distance ÷ hip width | 0.25 | Both ways |
| **Side tilt** | 2D torso axis **minus** the hips→ankles axis (camera tilt cancels) | 8° | Less is fine |
| Bobbing ("stay at the same height") | Hip height relative to the lower foot ÷ torso length, spread over the step | 1.5× the teacher's + 0.03 | Less is fine |
| Speed | Your matched duration ÷ the teacher's | outside 0.8–1.25 | Informational |

- The tolerances start as fixed numbers above MediaPipe's normal jitter, and are tuned by the tests in §6. **All tips are labelled "beta"** until Phase 2 calibration (which includes children).
- **View check:** body turn from the 3D shoulder line. If it differs from the teacher's by > 30°, arm height, spreads and side tilt are off.
- **Forward lean can't be seen from the front,** so the Torso band reads "Partly checked: side tilt only".

### 3.3 Alignment: subsequence DTW

- **Query** = the teacher's marked step. **Search space** = your whole video.
- **Recurrence:** free start and end in your video; each time-stretch step pays its skipped cell plus a small penalty, so the path can't hop over bad frames or freeze on one frame:
  ```
  D(n,m) = C(n,m) + min( D(n-1,m-1),
                         D(n-1,m-2) + 0.5·C(n,m-1) + λ,
                         D(n-2,m-1) + C(n-1,m)   + λ ),   λ = 0.1 · median row-min(C)
  ```
- **Cost:** the weighted distance between segment directions. At 15 fps the grid is about 900 × 2700 cells, well under 0.1 s on desktop. On phones the loop yields to keep the page responsive.
- **Was it found?**
  - The best match cost must be **≤ 0.6× the typical cost** along your video (a clear dip).
  - The span must be 0.4–2.5× the teacher's length, and the teacher step ≥ 2 s.
  - The test is relative, so a rough beginner attempt is still found, but standing still or a different step is not. A constant offset (an arm held low throughout) raises every cost equally, so it is still found, and the offset becomes a tip.
- **More tries:** block the found span and search again, up to 6 times. Each try must pass the same test and cost ≤ 1.5× the best one.
- **Partial practice:** if nothing is found, search for your moving part inside the teacher's step and report the coverage.
- **Mirror:** run both normal and mirrored, and keep the lower cost. Within 10% (a symmetric step) → no side claim.
- **Every one of your frames in the matched span is scored,** each against its nearest teacher frame on the path.
- **Sync playback** uses the path. Your video drives the clock, and the teacher video's speed is nudged to follow (it jumps if it drifts by more than 0.25 s).

### 3.4 Feedback rules

For each feature, over every matched frame pair (excluding pauses and masked frames): difference = you − teacher.

**A correction fires only if all of these hold:**
- the median difference is beyond the tolerance, in the bad direction for one-sided features;
- the same direction holds for ≥ 40% of judged frames;
- the joints were clearly seen (visibility ≥ 0.6) in ≥ 70% of frames;
- it shows up in at least half of your tries (when there's more than one);
- the view-angle gate passed (for 2D features).

**Safety:**
- **knees rolling in** → "Push your knees out over your toes before going lower", and **no depth tip**;
- **knees not clearly seen** → no depth tip;
- a depth tip always says "a little lower… don't force it".

**Ranking and output:**
- Severity = (|median difference| ÷ tolerance) × share of time.
- Top 3, one per body part.
- **Strength:** the clearly seen body part closest to the teacher (under half the tolerance). "More is fine" features are never praised.
- **Bands** for Arms / Legs / Torso / Timing: **Close match** / **Getting there** / **Needs work**. There is no % score. A band is never better than "Getting there" when a tip from that part is shown, and "Partly checked: …" lists what wasn't judged.
- A standing line: "**If your teacher says otherwise, follow your teacher.**"

**Example wording:**
- "Bend your knees a little more. Sit lower into aramandi, keeping your knees out over your toes; don't force it."
- "Raise this arm (shown in red) to the teacher's height."
- "Keep your body upright; you're leaning to one side."
- "Stay at the same height: your hips bounce on each step; the teacher's stay level."
- "You're about 30% slower than the teacher. Practising slowly is fine; speed up when you're comfortable."

### 3.5 Privacy and storage

- **No video or frame ever leaves the device.**
- **Your videos and results are not saved at all.** They live in memory and are gone when you leave the page. This fixes round-3 critical issue 4: every demo login shares user id "1", so "per-user" storage of children's videos was meaningless.
- The **teacher step's stick-figure data** can optionally be saved on this device ("Save this teacher step"), so it isn't processed again. "Delete saved steps" is on `/compare` and `/privacy`. It holds landmarks only, never video.
- **`/privacy` gets two lines:**
  - "Videos you use in Compare are processed on this device. They are never uploaded, and your own videos are never saved."
  - "Model files are downloaded from Google and jsDelivr; no video or images are sent." (Removed if we self-host them; decision 6.)

### 3.6 Files

New unless noted:

| File | What |
|---|---|
| `src/app/compare/page.tsx` | The page (client component) |
| `src/components/compare/VideoPanel.tsx` | `<video>` + skeleton canvas + ghost + red/green joint highlight |
| `src/components/compare/TrimBar.tsx` | Two-handle step marker with a live ETA |
| `src/components/compare/Results.tsx` | Bands, "Not checked" notes, tips, "Show me", switches |
| `src/lib/compare/extract.ts`, `queue.ts` | Model, frame reading, person following, one job at a time |
| `src/lib/compare/features.ts` | Segment vectors, angles, ratios, knee alignment, bobbing, mirror |
| `src/lib/compare/align.ts` | Subsequence DTW, tries, partial, mirror (pure TS) |
| `src/lib/compare/feedback.ts`, `tips.en.ts` | Pauses, gates, ranking, bands, wording (pure TS) |
| `src/lib/compare/store.ts` | Saved teacher steps (NVB2) + delete |
| `src/lib/compare/*.test.ts` | Tests with Node 22's `--experimental-strip-types`; no new dependency |
| `Navbar.tsx` (edit) | "Compare" link |
| `privacy/page.tsx` (edit) | The two lines above + the delete button |

No new npm dependencies and no backend changes.

---

## 4. YouTube: why the literal request can't be built

Checked in `01-research-brief.md`:
- **Drawing on the YouTube player is forbidden** by YouTube's embed rules, even with a transparent layer.
- **A web page can't read the pixels** of a YouTube embed (browser security), so there's nothing to run the pose model on.
- **Downloading on our server (yt-dlp)** breaks YouTube's Terms, is blocked on Render's servers ("confirm you're not a bot"), and would break the "nothing leaves your device" promise.
- **Screen-capturing the tab** works only on desktop Chrome/Edge (not phones), asks permission every time, and conflicts with YouTube's developer policy III.I.14.
- **The honest route:** if it's the teacher's own YouTube video, they can download it from YouTube Studio and upload it. The page says so.

---

## 5. How this was attacked and fixed

> **How this was reviewed:** first, one session's own single-pass self-review (A1–A17). Then the round-3 critic issues that apply to Phase 1 were folded in (R1–R10 below). The round-4 critic check is recorded in `04-open-issues.md`.

| # | Proposal | Attack | Fix |
|---|---|---|---|
| A1 | Compare frame by frame | Different lengths, starts, speeds | DTW stretches time |
| A2 | Plain DTW over both whole videos | Walking in and extra tries get forced in | **Subsequence** DTW |
| A3 | Fixed "match found" cost | Rejects beginners | **Relative** dip test |
| A4 | Single best match | One lucky try decides | Up to 6 tries; tips need half |
| A5 | Teacher step longer than what you did | Search fails | Reverse search + coverage |
| A6 | Raw joint positions | Size and distance differ | Directions, angles, ratios |
| A7 | Pure 2D angles | Camera angle looks like a wrong pose | 3D knees/elbows; view gate for 2D |
| A8 | "Your left arm" | Mirroring | Try both; colour the joint |
| A9 | Tip on any difference | Jitter, hidden knees, fidgeting | Tolerance + 40% + visibility + switches |
| A10 | Mocap clean-up filters | Erase quick lifts | Not used for features |
| A11 | One % score | Fake precision | Bands |
| A13 | Seek frame by frame | Slow on phones | Playback + rVFC, slowing down if needed |
| A14 | Background people, mirrors | Wrong person | Size + facing continuity; similar-depth warning |
| A15 | Save students' videos | Children; shared demo id | Save nothing about the student |
| A16 | In-page recorder | iOS audio rules, formats | Phone camera via file input; recorder in Phase 2 |
| A17 | DTW can't see a wrong stamp count | Most common footwork error | Stated; Phase 2 strike layer |
| R1 | "Sit lower" gated only by wording | Knees rolling in is the injury risk | **Knee-alignment** feature; depth tip suppressed when knees roll in or can't be seen |
| R2 | Torso lean vs image vertical | Handheld tilt → false tips | Side tilt **relative to the legs** |
| R3 | Torso band "Close match" | Forward lean invisible from the front | "Partly checked: side tilt only" |
| R4 | Every frame in the span scored | A rest mid-take reads as "sit lower" | Pauses ≥ 1.5 s in moving steps excluded and shown |
| R5 | Hold = whole matched span | Picks the waiting moment | Longest run in the teacher's posture, then the steadiest 2 s |
| R6 | Two people: warn always | People behind the dancer | Warn only at similar depth |
| R7 | Follow the nearest body | Mirror reflection takes over | Also require similar size and the same facing |
| R8 | Reset the model per video | Rebuilds the whole graph | Timestamp jump; one job queue |
| R9 | Privacy: "nothing leaves the device" | Model downloads hit Google/jsDelivr | Disclosed (or self-host) |
| R10 | Thresholds calibrated on adults | Most students are children | All Phase 1 tips beta; Phase 2 calibrates per stratum |

**Known Phase 1 limits (accepted):**
- No AI tips from YouTube links.
- No stamp-count tip.
- No mudra tips at full-body distance.
- Leg tips are often withheld under a saree.
- Forward lean is not checked from the front.
- One step range per teacher file.
- Each student marks the teacher step themselves.
- Tolerances are first guesses.

---

## 6. Build order (after approval)

Each step is checked before the next.

1. `features.ts`, `align.ts`, `feedback.ts` with Node tests on synthetic stick figures:
   - a time-stretched copy (0.6×, 1.8×) → found, no tips;
   - padded with standing and walking → found;
   - 3 tries → 3 found;
   - mirrored → found, no side claim;
   - knee changed by 25° → knee tip;
   - an arm 15° low throughout in a 40% partial take → found, partial, arm tip;
   - standing only → not found;
   - half the step → ~50% coverage;
   - a 4 s pause mid-take → excluded, no knee tip;
   - knees rolled in → alignment tip, no depth tip;
   - 5° camera roll → no tilt tip;
   - a masked 1 s gap → found, gap not scored.
2. `extract.ts`, `queue.ts`, `VideoPanel`: skeleton on an uploaded video, checked in headless Chromium.
3. The `/compare` page: trim with ETA, progress, results, "Show me", ghost, switches, sync play, save/delete teacher step, Navbar link, privacy lines.
4. **End-to-end:**
   - record the 3D dancer from `/learn` as a teacher file;
   - compare it against a slowed, shifted and padded copy;
   - expect: found, few or no tips;
   - plus `tsc`, `eslint` and `next build`.
