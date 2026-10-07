# Video compare: the MVP design (for approval)

> Status: **proposal, waiting for the user's OK.** No feature code is written yet.
> This replaces the 7-week plan in `03-design.md` with a first version that can actually ship.
> `03-design.md` and `04-open-issues.md` stay as background and as the source for later phases.

---

## 1. The short answer

A new page, **`/compare`** ("Compare with teacher"), in three steps:

1. **Teacher video.** Upload a video file, then drag two handles to mark the one step you want to practise (2–60 s).
   The app finds the body in every frame **on your device** and draws the stick figure on the teacher video.
2. **Your video.** Upload your practice video, or on a phone tap "Record" (this opens the phone's own camera).
   Any length up to 3 minutes. Extra bits at the start and end, pauses, doing the step several times, or a different speed are all fine.
3. **Result.** Both videos side by side with stick figures, played in sync (the app lines up your moves with the teacher's).
   You get up to **3 corrections**, **1 thing you did well**, and a band for Arms, Legs, Torso and Timing.
   Each tip has a **"Show me"** button. It pauses both videos at the worst moment and colours the joint red on you and green on the teacher.
   A **"Ghost"** switch draws the teacher's stick figure on top of your body, so you can see the difference directly.

**YouTube** can't be done the way you described (see §4). In the MVP a YouTube link is not offered. In phase 2 it becomes "practise beside": the YouTube video plays untouched next to your video with your stick figure, but there are no AI tips from it. **That's decision 1.**

---

## 2. How it handles "not all movement is necessary, different lengths"

| Problem | What the MVP does |
|---|---|
| Teacher video is long, has talking, has many steps | You **mark one step** with two handles. Only that part is processed. This is fast and never wrong, unlike auto-detection. |
| Your video is longer: walking to your spot, standing, then dancing, then walking to the phone | The app **searches for the teacher's step inside your video** (subsequence DTW, §3.3). Anything before and after the match is ignored. |
| You dance slower, faster, or speed up and slow down | DTW **stretches time** so the same moves line up. Your overall speed becomes its own Timing tip, not a posture error. |
| You did the step 3 times | After finding the best match, it searches again for more. Tips must show up in **at least half of your tries**, so a one-off slip doesn't count. |
| You did only part of the step | If the whole step isn't found, it searches the other way (your moves inside the teacher's step) and says "You practised about 50% of the step. Tips cover that part." |
| You did something else, or just stood there | The match has to be **clearly better than the rest of your video** (a relative test, so beginners aren't rejected). If not: "We couldn't find the teacher's step in your video", and no wrong tips. |
| The teacher moves things that don't matter (looks at the class, fixes their saree) | You can **switch body parts off** (Arms, Legs, Torso, Head). A tip also needs the difference for **at least 40% of the step**, not one moment. |
| You mirror the teacher (or the phone mirrors your video) | Alignment is tried both normal and mirrored, and the better one is used. Tips point at the **joint on screen** (it turns red), so "left/right" confusion doesn't matter. |
| Child vs adult, near vs far from the camera | Everything is angles and ratios (e.g. foot spread ÷ hip width), so body size and distance cancel out. |
| Different camera angle | The body's turn is measured from 3D landmarks. If yours differs from the teacher's by more than 30°, the angle tips that depend on the view are switched off and you're told to film from the same angle. |
| Saree or dark clothes hide the knees, or the body leaves the frame | Every tip checks that its joints were clearly seen. If not: "Couldn't see your knees clearly, so legs were not checked." |

---

## 3. How it works (technical)

### 3.1 Extraction (on the device, nothing uploaded)
- MediaPipe **PoseLandmarker** (`@mediapipe/tasks-vision` 0.10.34, already installed): the "full" model, GPU with automatic CPU fallback, VIDEO mode.
- **Frame reading:** the video plays muted, and `requestVideoFrameCallback` gives each frame with its exact time.
  The app runs the model on as many frames as the device can handle.
  If fewer than 10 frames per second are processed, playback slows to 0.5× (then 0.25×).
  Where `requestVideoFrameCallback` is missing, it falls back to a seek loop (the old `/mocap` bake loop, commit `287aba3`).
- **Which person:** `numPoses: 2`. It starts with the biggest body, then follows whichever body is closest to the last position. If two similar-size people are present for a while, it shows a warning.
- **No heavy cleaning.** Only MediaPipe's built-in smoothing and a 3-frame median per feature. The mocap clean-up filters (`despikeTrack`/`stabiliseTrack`) erase quick foot lifts (round-3 critical issue 1), so they are not used.
- Both tracks are resampled to one shared timeline at 15 fps for alignment.

### 3.2 Features
- **For alignment:** the 2D direction of 10 body segments (upper arms, forearms, thighs, shins, torso, shoulder line) as unit vectors. Each segment is weighted by how clearly it was seen and by the body-part switches. A mirrored version swaps left and right and flips x.
- **For tips (per frame):**

| Feature | Measured from | Tolerance |
|---|---|---|
| Knee bend L/R | 3D angle hip-knee-ankle | 15° |
| Elbow bend L/R | 3D angle shoulder-elbow-wrist | 20° |
| Arm height L/R | 2D angle of upper arm from the torso | 15° |
| Knee spread (turn-out) | knee distance ÷ hip width | 0.25 |
| Foot spread | ankle distance ÷ hip width | 0.25 |
| Torso lean | 2D torso vs vertical | 8° |
| Bobbing (stay at the same height) | movement of the hips relative to the planted foot, ÷ torso length | 1.5× the teacher's + small margin |
| Speed | your matched duration ÷ the teacher's | outside 0.8–1.25 |

Tolerances start as fixed numbers, sit above MediaPipe's normal jitter, and are tuned with the tests in §6. Tips are labelled "beta".

### 3.3 Alignment: subsequence DTW
- **Query** = the teacher's marked step. **Search space** = your whole video.
  DTW with a free start and end in your video, plus a small extra cost for each "time-stretch" step so the path can't freeze on one frame.
  Cost = weighted distance between segment directions.
  At 15 fps the grid is about 900 × 2700 cells, which takes well under 0.1 s in JavaScript.
- **Was it found?** Take the best match cost and compare it with the typical cost across your whole video.
  It must be at least 40% lower (a clear dip), and the matched span must be 0.4×–2.5× the teacher's length.
  The test is relative, so a beginner's rough attempt is still found, but standing still or a different step is not.
- **More tries:** block the found span and search again, up to 6 times. Each extra try must pass the same test and cost no more than 1.5× the best one.
- **Partial practice:** if nothing is found, search for your moving part inside the teacher's step and report the coverage.
- **Mirror:** run both normal and mirrored, and keep the lower cost. If the two are within 10% (a symmetric step), no left/right claim is made.
- **Sync playback** uses the matched path. Your video drives the clock, and the teacher video's speed is nudged to follow (it jumps if it drifts by more than 0.25 s).

### 3.4 Feedback rules
- For each feature, over every matched frame pair: difference = you − teacher.
- **A correction fires only if all of these hold:**
  - the median difference is beyond the tolerance;
  - the same direction holds for at least 40% of frames;
  - the joints were clearly seen (visibility ≥ 0.6) in at least 70% of frames;
  - it shows up in at least half of your tries (when you did more than one);
  - the view-angle gate passed (for the 2D features).
- **Ranking:** severity = (|median difference| ÷ tolerance) × fraction of time. Show the top 3, and only one tip per body part.
- **Strength:** the clearly-seen body part closest to the teacher (under half the tolerance).
- **Bands** per Arms / Legs / Torso / Timing: **Close match**, **Getting there**, or **Needs work**. There is **no single % score**: measurement error makes a precise number misleading.
- **Example wording:**
  - "Bend your knees more. Sit lower into aramandi, keeping your knees pointing out over your toes. Don't force it."
  - "Raise this arm (shown in red) to the teacher's height."
  - "Keep your back upright; you're leaning sideways."
  - "Stay at the same height: your hips bounce on each stamp."
  - "You're about 30% slower than the teacher. Practising slowly is fine; speed up when you're comfortable."

### 3.5 Privacy and storage
- **No video or frame ever leaves the device**, which matches today's `/privacy` promise.
- **Student videos and results are not saved at all**: they live in memory and are gone when you leave the page. This fixes round-3 critical issue 4 (every demo login shares user id "1", so "per-user" storage of children's videos was meaningless).
- The **teacher's stick-figure data** can optionally be saved on this device ("Save this teacher step") so it isn't processed again. A "Delete saved steps" button removes it. It holds landmarks only, not video.

### 3.6 Files (new unless noted)
| File | What |
|---|---|
| `src/app/compare/page.tsx` | The page (client component) |
| `src/components/compare/VideoPanel.tsx` | `<video>` + stick-figure canvas + ghost + red/green joint highlight |
| `src/components/compare/TrimBar.tsx` | The two-handle step marker |
| `src/components/compare/Results.tsx` | Bands, tips, "Show me" |
| `src/lib/compare/extract.ts` | Model loading, frame reading, person tracking |
| `src/lib/compare/features.ts` | Segment vectors, angles, ratios, mirror |
| `src/lib/compare/align.ts` | Subsequence DTW, tries, partial, mirror (pure TS) |
| `src/lib/compare/feedback.ts` | Gates, ranking, bands, wording (pure TS) |
| `src/lib/compare/*.test.ts` | Tests run with Node 22's `--experimental-strip-types`, no new dependency |
| `Navbar.tsx` (edit) | Add a "Compare" link |
| `privacy/page.tsx` (edit) | One line saying compare videos are processed on the device and never saved |

No new npm dependencies and no backend changes.

---

## 4. YouTube: why the literal request can't be built (checked in `01-research-brief.md`)

- **Drawing on the YouTube player is forbidden** by YouTube's embed rules, even with a transparent layer.
- **A web page can't read the pixels** of a YouTube embed (browser security), so there's nothing to run the pose model on.
- **Downloading on our server (yt-dlp)** breaks YouTube's Terms. It's also blocked on Render's servers ("confirm you're not a bot"), and it would break the "nothing leaves your device" promise.
- **Screen-capturing the tab** works only on desktop Chrome/Edge (not on phones), asks permission every time, and conflicts with YouTube's developer policy (III.I.14: no accessing video content by any means other than the API).
- **The honest route:** if it's the teacher's own YouTube video, they can download the file from YouTube Studio and upload it. The page will say so.

---

## 5. How this design was attacked and fixed

Each row is an attack on the previous version and the fix now in the design.

> **How this was done:** one session reviewed its own design in a single pass. No separate critic or judge agents were run on this MVP, and the round-3 revision of `03-design.md` was never finished. The round-3 critical issues are handled by dropping the features they were about (A10, A15, A17), not by fixing the large design. The 24 high issues were not checked one by one against this MVP. Thresholds are first guesses, and nothing has been run or benchmarked yet.

| # | Proposal | Attack | Fix |
|---|---|---|---|
| A1 | Compare the two videos frame by frame | Different lengths, start times and speeds | DTW stretches time |
| A2 | Plain DTW over both whole videos | Walking in, standing and extra tries get forced into the match | **Subsequence** DTW: the teacher step is searched for inside your video |
| A3 | Accept a match if its cost is under a fixed number | Beginners get rejected, and they need tips most | **Relative** test: the match must be a clear dip compared to the rest of your video |
| A4 | Use the single best match | One lucky or unlucky try decides everything | Find up to 6 tries, and a tip must appear in at least half |
| A5 | Teacher step longer than what you did | Whole-step search fails | Reverse search, with "you practised about X%" |
| A6 | Use raw joint positions | Body size, distance and camera position differ | Segment directions, angles and ratios |
| A7 | Pure 2D angles | A different camera angle looks like a wrong pose | 3D angles for knees and elbows; a view-angle gate for the 2D ones |
| A8 | Say "your left arm" | Phones mirror selfie video; students mirror teachers | Try both and keep the better; point at the joint in colour instead of naming a side |
| A9 | A tip whenever a difference is seen | Jitter, hidden knees, teacher fidgeting | Tolerance + 40% of time + visibility + body-part switches |
| A10 | Re-use the mocap clean-up filters | They erase quick foot lifts (round-3 critical 1) | Not used: only MediaPipe smoothing + a 3-frame median |
| A11 | One "87%" score | Measurement error makes it fake-precise | Bands per body part |
| A12 | "Sit deeper" as a tip | Injury risk if knees cave in | The wording always includes "knees over toes, don't force it" |
| A13 | Seek frame by frame for extraction | Slow on phones (each seek decodes from a keyframe) | Play + `requestVideoFrameCallback`, slowing to 0.5× if needed; seek only as a fallback |
| A14 | Background people or a mirror in the room | The model jumps to the wrong person | `numPoses: 2`, follow the same body, warn if unsure |
| A15 | Save the students' videos for history | Children's videos, and a shared demo user id (round-3 critical 4) | Save nothing about the student |
| A16 | An in-page recorder with dance-along | iOS autoplay blocks, recorder formats, lots of engineering (round-3 high issues) | MVP uses the phone's own camera via file input; the in-page recorder moves to phase 2 |
| A17 | **DTW can't see a wrong number of stamps** (an extra stamp just looks like slower dancing) | The most common footwork mistake gets no tip | **Not solved in the MVP; stated honestly.** Phase 2 adds a stamp-count check (count foot strikes in the matched span vs the teacher's, using foot-vs-foot height so body bounce cancels, with no clean-up filter). Round-3 criticals 2, 3 and 5 came from the pattern-card / version-check machinery, which the MVP doesn't have. |

**Known MVP limits (accepted):**
- No AI tips from YouTube links.
- No stamp-count tip (A17).
- No mudra or hand-shape tips at full-body distance (`/live` and `/practice` already do mudras up close).
- Leg tips are often withheld under a saree.
- Tolerances are first guesses until real clips are tested.

---

## 6. Plan (after approval)

**Phase 1: the MVP above.** Build order, checking each step before the next:
1. `features.ts`, `align.ts`, `feedback.ts` with Node tests on synthetic stick figures:
   - time-stretched copy → found, no tips;
   - padded with standing → still found;
   - 3 tries → 3 found;
   - mirrored → found, no side claim;
   - knee changed by 25° → knee tip;
   - standing only → "not found";
   - half the step → about 50% coverage.
2. `extract.ts` and `VideoPanel` (skeleton on an uploaded video), checked in headless Chromium.
3. The `/compare` page: trim, progress, results, "Show me", ghost, sync play, navbar link, privacy line.
4. **End-to-end:** record the 3D dancer from `/learn` as a test video, then compare it against a slowed and shifted copy of itself. Expect: found, few or no tips. Plus `tsc`, `eslint` and `next build`.

**Phase 2 (each one optional, your call later):**
- YouTube "practise beside" (per decision 1)
- An in-page recorder that plays the teacher while you dance
- Auto-suggest steps on long teacher videos (`lib/lesson/segment.ts`)
- The stamp-count tip
- Tap to pick the person
- Saving scores to the dashboard
- Hindi tips
