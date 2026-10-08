# Video compare feature: design (revision 5, after 5 red-team rounds)

> **Status:** DRAFT, not yet approved by the user.
> - **Revision 3** applied all 64 round-3 critic issues.
> - **Revision 4** applies the 40 round-4 issues from four critic agents. One of them built a synthetic prototype of the Phase 1 alignment and ran 20+ cases.
> - Where every issue went is in `04-open-issues.md`.
> - **Revision 5** applies the round-5 check of Phase 1. One critic re-ran the prototype on the revised rules: 105 synthetic cases, now kept in `prototype/`.
> - **Phase 1** is specified in detail in `05-mvp.md`; this file is the full roadmap.

# Guru Mirror (`/compare`): revised design (round 6)

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

### What changed in revisions 3, 4 and 5

Round 3 showed two things:
- **The riskiest part of the old v1 was its headline part:** the Thattadavu strike/pattern layer.
- **The user's main input ("upload any teacher video") got almost no feedback.**

So the build order was turned around. Round 4 then **tested** the new Phase 1 alignment on synthetic stick figures, and found:
- **Thattadavu-like steps carry no timing signal in whole-body posture:** the body holds aramandi and only the feet move a little. Phase 1 therefore sorts each marked step into a **movement step** (lined up and compared part by part), a **posture step** (posture plus "did the moving part move") or a **hold**.
- The "was it found" test, pause handling, partial practice, per-part errors and the knee check all needed fixing. The fixes were validated in the same experiment.

Round 5 re-ran the prototype on the revised rules (105 cases):
- **What held:** the "real movement" test, phases, tries, the mirror choice and the knee roll-in check.
- **What it fixed:** the order (step kind before pauses), slow-beginner matching, noise-proof step kinds, the ceiling floor, partial practice, and checks that were sensitive to noise.
- **Current result:** 88/105 cases pass with the two validated fixes. The rest is Phase 1 build step 1 (`05-mvp.md` §6).

| Phase | What ships | Why in this order |
|---|---|---|
| **Phase 1: core path** (`05-mvp.md`) | Any teacher **video file**: mark one step, get its skeleton. The student uploads or records (phone camera) a take. Movement steps are found inside the take and lined up; posture steps and holds are compared as posture. ≤ 3 gated tips + a Timing line, Show me, synced playback (ghost if time allows). **Nothing about the student is stored.** | Answers the request for every dance. Fewest failure modes. No dependency, recordings or reviewer needed. |
| **Phase 2: Thattadavu footwork** | Pattern cards with a **generated practice track** and the 3D figure; a simple recorder; a strike-event layer (raw lanes) with count, silent-slot, start-foot (recorder), height-steadiness and knee-alignment checks; calibration including children. | Adds what Phase 1 can't see on footwork: the count and timing of stamps. |
| **Phase 3: wider inputs** | YouTube "practise beside" (desktop/tablet recording; watch-then-record on phones); studio references; teacher-file structure pass, step proposals, several ranges, `.nvref` packs; full audio; early/late; extra-people classes | Each needs Phase 1–2 underneath and carries its own legal or device risk. |
| **v2** | Namaskaram sequence steps (chunked chains), mudras at body distance, Hindi, worker, rig references | As before |

### The original request, mapped

| You asked | What we build | Why |
|---|---|---|
| Upload a video **or** paste a YouTube link, then process it | **Video file:** Phase 1, processed on your device.<br>**YouTube link:** Phase 3, "practise beside": the player is shown untouched, and your take plays beside it with your skeleton. AI comparison needs a file. | No web page can read pixels from YouTube's player. Downloading breaks YouTube's ToS and API policy III.E.1, gets bot-checked on Render, and breaks our privacy promise. Tab capture is desktop-Chrome-only and conflicts with III.I.14 and III.E.4. |
| Show the stick figure on the YouTube video | Drawn on **our own `<video>`** for files. For YouTube it is drawn on the **student's** video, beside the player. | YouTube forbids any overlay in front of its player. |
| Student adds their video beside it and gets what's wrong plus tips | Side by side, synced by the alignment. Up to 3 corrections, 1 strength and a Timing line, each tip with "Show me" and the joint marked by a ring and an arrow. A ghost of the teacher on your body, if time allows. | §4.7, §6 |
| "Not all movement is necessary, different lengths…" | **What gets judged** (§3):<br>(1) you mark the teacher's step;<br>(2) the step is **searched for inside your take**, so walking in, standing and extra tries are ignored;<br>(3) pauses inside the step are set aside;<br>(4) body parts can be switched off;<br>(5) a difference must last and repeat to become a tip.<br>**Lining up** (§4): time is stretched (DTW) so tempo, length and start point don't matter. Footwork (Phase 2) also lines up **strike sequences** against the phrase. | §3, §4 |

**Who gets what**

| Content | Phase 1 | Phase 2 | Phase 3 | v2 |
|---|---|---|---|---|
| **A movement step from a teacher file** (Natta arms, Saluting around, most choreography) | Found in your take, lined up, posture + range-of-movement + timing tips, Show me | — | Step proposals; several ranges; teacher packs | Chunked chains for long sequences |
| **A Thattadavu adavu from a teacher file** | **Posture only** (aramandi, knees, arms, steadiness) + "your feet hardly moved"; no stamp count or timing | + Footwork checks, if you confirm which adavu it is | Ladder tips; early/late | — |
| **Thattadavu Adavu 1–8, no video** | — | Pattern card + practice track + 3D figure; count, silence, start foot (recorder), steadiness, knee alignment | Inside "practise beside YouTube" | — |
| **A hold** (Samapada, aramandi, Guru Vandana) | Posture over your steadiest 2 s in that posture | — | — | Anjali and mudras |
| **A YouTube link** | — (or a watch-only player right after Phase 1, decision 2) | — | Practise beside: Thattadavu card checks + general habits. **Never compared with the YouTube teacher.** | — |
| **A studio reference** | — | — | Posture comparison without a teacher file | — |

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
| **R42** | Clean all lanes with the mocap filters | `despike`/`stabilise` erase 2-sample, 3 cm lifts; σ_j ≈ 0 makes the SNR gate pass when detection fails | **Events run on raw lanes** (the unsmoothed `numPoses 2` bake, R62; despike only jumps > 0.25 m). σ_j measured on raw still and motion frames. The mocap chain is used for the overlay only. |
| **R43** | Label runs by the best card; consistent deviation = "different version" | The most common error (a neighbour adavu's count, a stamp on the silent count) was silenced | **The declared step has a strong prior.** A single-pattern take is always judged against it. A whole-take match to another card in the same lesson asks "Which were you practising?" The version answer is authoritative. |
| **R44** | Phrase correctness = share of exact phrases | 0.95¹⁴ ≈ 0.49: correct dancers fail | **Per-strike edit rate vs the detector's measured rate**, ≥ 4 fully judged phrases, partial phrases excluded |
| **R45** | Free-start alignment decides start foot | A wrong start is a zero-cost rotation | **Start foot only against a clock** (recorder count-in); uploads say "not checked" unless strictly confirmed |
| **R46** | Hold = stillest 2 s | Picks the standing pause | Longest run in the target state, then the stillest 2 s in it |
| **R47** | Safety gate on knee-over-toe angle + heel-down | Not measurable from the front; heel-down uncalibrated | Heel-down "Not checked"; knee measure **superseded by R61** (absolute 3D roll-in) |
| **R48** | Reflection = x-flipped motion; overlap = suspect | Front mirrors; people behind | Both mirror geometries + opposite facing; overlap counts only at similar depth; SUSPECT_ID needs 2 track cues |
| **R49** | A cut whenever the background moves | Handheld follow-pans | Continuous motion ≠ cut; roll per 2 s window; "handheld" preflight result |
| **R50** | Per-user storage scope | Every demo login is id "1"; expiry never runs | **Student video is never kept.** Phase 2 crash-resume record encrypted with a tab-only key; sweep on every page |
| **R51** | Hands-free anchor start/stop | iOS blocks late `play()`; gestures collide with choreography; children raise the wrong hand | **Tap to record**, unlock audio inside the tap, spoken countdown; stop by duration, tap, or walking out of frame |
| **R52** | `setOptions` reset per cut | Rebuilds the whole graph (0.5–2 s each) | Timestamp jump for cuts; rebuild only for crop or mode changes |
| **R53** | Per-window de-meaning inside sDTW | Not DP-decomposable | Relative dip test (Phase 1); offset-invariant features or iterate-and-refine (Tier C chains) |
| **R54** | Pattern cards with nothing to play | No sound, no clock, no reference pane | **Generated practice track** (Web Audio clicks above 2 kHz, selectable tempo and ladder) + the 3D clip span mapped to slots |
| **R55** | Ladder pairing by absolute pulse; BIC staircase | A rushing 1st speed looked like a ladder | Piecewise-linear sections; change point only for a ≥ √2 jump; pairing by neighbour ratios; with a clock, name the section that is off |
| **R56** | Questions before the first take | About 12 prompts, mostly "Not sure" | Ask after the take, only to unlock a withheld tip, ≤ 2 per take |
| **R57** | Whole-body posture DTW for every step | **Tested:** Thattadavu-like steps cost ≈ their own frozen pose (m_T ≈ 1), so correct takes were rejected and a frozen aramandi was "found" | **Step kinds** from the teacher's motion ratio: movement / posture / hold. Posture steps get no timing claims (05 §3.2, §3.5). |
| **R58** | Found = best ≤ 0.6 × median of the profile | Tight and beginner takes were rejected; another adavu was accepted | Baseline outside the match + an absolute ceiling + a "real movement" test against your own frozen pose (validated) |
| **R59** | Pauses kept in the alignment, removed from scoring | The slope limit squeezed the step to avoid the pause, giving 2 half-tries | **Pauses cut before alignment**, with an index map (validated) |
| **R60** | Whole-step median per feature | An error in one phase (arms never raised) gave no tip, even a "strength" | **Per-phase medians + range of movement**; strengths must hold in every phase |
| **R61** | Knee alignment relative to the teacher | A shallow bend read as "rolling in" | **Absolute 3D roll-in** on bent frames + knee inside the ankle; never compared with the teacher |
| **R62** | `numPoses: 2` "with MediaPipe smoothing" | Smoothing only runs with `numPoses: 1`; the detector schedule changes | Phase 1: `numPoses 1` + a 1 Hz IMAGE identity pass. Phase 2 events: `numPoses 2` raw, by design, frozen in `configHash`; σ_j also measured in motion. |
| **R63** | `play()` after awaits; one file input for the camera | iPhone Low Power Mode blocks it; Android 14+ hides the camera option; low-RAM phones reload the tab | `play()` primed inside each tap; seek fallback; "Choose" + "Record" buttons; the teacher step saved for the session first |
| **R64** | A deletion when no strike is detected | A soft but real weight-transfer strike became a "stamp-confirmed" missing strike | **A deletion needs positive evidence of absence**; the audio veto never creates deletions; `INTERP` masks |
| **R65** | Split at IOI change points | Errors that appear only at 2nd speed were filed as "also danced Adavu 2" | Split only at pauses; never in practice-track takes; each speed section judged against the declared card |
| **R66** | Sections before alignment; τ from long slots | Adavu 5–8 fragment; τ circular on uploads | Align first, then sections on residuals; the practice-track clock gives τ for recorder takes; a threshold-free τ cross-check on uploads |
| **R67** | Recording beside YouTube on any device | At 3 m on a phone the player is ~2 cm tall; ads need a tap | Phones: watch, then record/upload. Desktop/tablet: player at full width. |
| **R68** | Crash-resume key in `sessionStorage` = tab-bound | Survives reload, tab duplication and session restore | Web Lock per take + a sweep rule + a 2 h cap |
| **R69** | Calibration ~200 takes | 22 template × stratum × fps cells | fps tiers by decimation, pooled card groups, ≥ 10 good takes per group per stratum, beta-binomial baseline; ~400 error takes |
| **R70** | YouTube compliance = per-video Made-for-Kids | Policy III.J (child-directed clients) never decided; DPDP treats under-18s as children | A decision for you (§12); III.J notification if child-directed; operator named |
| **R71** | Cut pauses before anything else | Deleted whole holds, frozen poses, and slow movement at child noise | Step kind first, on the uncut step; holds and posture steps never cut; cut only still runs matching no teacher frame, plus ±1 s transitions |
| **R72** | Charge every skipped cell in full | Slow beginners rejected | Slow steps charge the mean of the covered cells + λ (validated) |
| **R73** | Motion ratio m_T ≥ 3 | A signal-to-noise ratio; up/down steps invisible | Noise-corrected motion ≥ 0.07 rad; hip-height and segment-length features |
| **R74** | τ_T and a take-median posture threshold | τ_T ≈ 0 on near-neutral steps; results depend on the walk-in | τ_floor and τ_P from the tolerances + jitter; the dip test dropped (never decisive) |
| **R75** | Noise-sensitive checks | False bobbing, "part moving" blind, near-straight angles biased | One jitter definition; noise-subtracted energy; 3D angle bias removed or skipped |

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
- **The step is the unit.** The picker asks "Mark just the step you'll practise".
  - **Default selection:** the moving run around the playhead, found from cheap pixel-motion energy (no model needed), clipped to 2–12 s.
  - **Controls:** a zoomed strip of max(90 s, 3× the selection); "Start here" / "End here" at the playhead; ±0.5 s nudges; "Play selection". The handles are accessible sliders.
  - A warning appears when the processed selection is > 40% still.
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
| Adavu 8 | R L R L + 3 quick (+ rest?), per half-phrase: **to be settled by the reviewer** | R |
| Tapping (Namaskaram) | R L (tap events) | R |

- Written by person D from the cues.
- **Every card's slot lengths are measured** from foot contacts in `thattadavu.nvclip`: a Node script decodes the clip, puts it on the rig and reads foot heights.
- **Adavu 8 needs the reviewer first.** Round 4 measured a 6-count half-phrase in the clip (R L R L at 1.6 s, then R L R at 0.8 s), but the cue says "eight is silent". The reviewer settles which is right; then the cue, the card and the silence tip are made to agree.
- A unit test asserts that each half-phrase sums to the counts the settled version states. The reviewer signs off each card.
- **Slot classes:** every distinct slot duration in a card is its own class. For example, Adavu 5's quick strikes are a class even though the table writes them as 1 pulse.
- **The strip shows durations** (long and short slots drawn to scale), not just foot order.
- Labelled **"NrityaVaani version"**.
- **Ladder metadata:** Adavu 1 from its cue (1→2→3→2→1). Adavu 2–8 get ladder metadata from the "Practising" cue ("every adavu through the three speeds") **only after the reviewer confirms it**. Until then the student is asked "Are you doing the speeds?" after the take.
- **Practice track (R54).** Web Audio generates tattukazhi-style clicks from the slot table on the device, with silent slots left silent.
  - Tempo is selectable (slow / medium / normal), with the speed ladder where the card has one.
  - Clicks are **high-passed noise bursts above 2 kHz**, not tones, so they don't trigger the voice detector.
  - **Per-take self-test:** during the count-in the student stands still. If onsets locked to the clicks appear in the 40–300 Hz stamp band (from speaker distortion, or a vibrating surface), audio is switched off for that take. Waveform "subtraction" is not relied on.
  - **Count-in:** one bar of in-tempo clicks with a spoken "1", and the strip stays blank until count 1.
  - Loops are sample-accurate and phrase-aligned: no video seam.
  - It is the **clock** for loops, auto-stop and "Show me ▸ count 5 of phrase 2". It also avoids music rights.
- **Reference pane:** the 3D figure from `thattadavu.nvclip` over that adavu's span (e.g. Adavu 3 = 108.1–130.3 s), labelled **"animation, not compared"**.
  - Card slots map to clip times through the same foot-contact times the verification script reads.
  - The ghost is off for pattern cards.
  - The 3D figure runs in Learn and Feedback only, **never while the camera and pose model run**, so it doesn't compete for the GPU.

**(c) Studio references (Phase 3, if a dancer is recorded).**
- Front view at hip height, fitted clothes, full body, real side, the speeds the cues ask for. Baked on a desktop GPU.
- **Consent:** written; **a guardian's consent if the dancer is under 18**; a withdrawal clause.
- **Media and lanes outside git:** per-step clips of 5–40 s **and their landmark lanes**, hosted as GitHub Release assets or on an R2/B2 bucket with CORS. The repo is public, so this is the only way they can be taken down if consent is withdrawn. Only manifests (no body data) go in the repo.
- **Audio:** original only (a team member reciting sollukattu, or the generated practice track). Never commercial recordings.

**(d) YouTube link (Phase 3).** See §8.

**(e) 3D rig lessons as compared references:** v2.

### 2.2 Student takes

#### Upload or phone camera (Phase 1)

- **Two buttons:**
  - **"Choose a video"**: `<input type=file accept="video/*">`, no `capture`;
  - **"Record"**: `accept="video/*" capture="user"`, on touch devices only.
- Android 14+ Chrome no longer offers the camera from a plain video input (it shows the photo picker), so "Record" needs `capture`.
- **Before the camera opens,** the teacher step's landmarks are saved for the session. Low-RAM phones often discard the backgrounded tab, and iOS can kill it. After a reload the step is restored, and the student is asked to choose the teacher video again.
- **The camera app may keep its own copy** in the gallery (and back it up). The privacy line says so. NrityaVaani itself saves nothing.
- **While using the phone camera** the teacher can't be seen in the page. The guide says "Play the teacher on another screen or speaker."
- Up to 3 min, processed in two passes (quick scan to find the step, then full rate on the found parts; 05 §3.1).
- In/out handles are optional; approach frames are found automatically (§3 F1).
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

**Take length per card and tempo.** Pattern tips need ≥ 4 fully judged **half-phrases** (§4.2), with partial first and last half-phrases not counting. The auto-stop duration is computed from the card and the chosen tempo and said up front ("Adavu 7, slow: about 70 s"). If that would pass the 2-min cap, medium tempo is suggested.

Practice-track loops are gapless on a phrase boundary, so nothing is excluded. Teacher-video loops (one element that seeks at the loop end) exclude strikes for min(1 s, ½ phrase) after the seam. Those strikes are kept in the alignment as **masked** (§4.2).

**Live pose during recording:** only for the framing badge. **Tips always come from the bake of the recorded file** after Stop, with the same reader and fps as calibration. Live-detected tips are v2 (round 3: the live path is load-dependent and uncalibrated).

**After Stop.**
1. Remux once with Mediabunny (no re-encode) into a seekable file.
2. **Crash-resume record (R50, R68):**
   - The take is written to IndexedDB, **encrypted with an AES key held in `sessionStorage`**, with a plaintext header (id, creation time).
   - The tab that owns it holds a **Web Lock** (`navigator.locks`) named `nv-take-<id>`.
   - **Sweep** (from the root layout, on every page load): delete a record when its lock is not held **and** its id is not in this tab's `sessionStorage`, and delete any record older than **2 h**, whatever its state.
   - `sessionStorage` survives reloads, tab duplication and session restore, so the key alone isn't tab-bound. The lock plus the 2 h cap is what bounds it.
   - **Resume prompt:** no thumbnail or preview, only "Resume processing a take from HH:MM?" with a Delete button.
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

**Phase 1 reader: playback-driven** (details in `05-mvp.md` §3.1).
- **Frames into our own canvas.** Every frame is drawn into a ≤ 960 px canvas (this applies rotation and downscales 4K) and fed to the model. Pre-checks run first:
  - the video has a width and a non-blank frame within 3 s, otherwise the codec message;
  - the first real frame passes the GPU check;
  - the body is upright.
- **Reading:**
  - the video plays muted, and `requestVideoFrameCallback` gives each frame its `mediaTime`;
  - if fewer than 10 frames per video-second are processed, it slows to 0.5×, then 0.25×.
- **iPhone rules (R63).** `play()` is **primed inside each tap**: `play()` then `pause()` before any `await`, because Low Power Mode and thermal limits block untapped playback. The student's video starts from its own "Analyse my video" tap.
- **Fallback: the seek loop**, when `play()` is refused, the video pauses by itself, or rVFC is missing:
  - wait for `seeked` **and a newly presented frame**;
  - drop the sample on timeout, never labelling a stale frame with the target time (the old `/mocap` loop did that);
  - show "Tap to continue".
- **Two passes for the student take:**
  1. a quick scan at about 5 samples per video-second (faster playback when the device keeps up) to find the step;
  2. full rate on the found parts ± 2 s.
- Irregular sampling is fine: Phase 1 judges posture on a resampled 15 fps grid and makes no strike claims.

**Phase 2 reader: deterministic.** Footwork needs fixed sampling that matches calibration.
- Mediabunny decodes sequentially via WebCodecs. CanvasSink applies the rotation, at ≤ 960 px on the long side.
- Fallback: the seek loop.
- **Bake fps = min(24 target, effective source fps).** Targets that resolve to an already-processed frame are skipped.

**One job at a time.**
- A single-consumer queue owns the VIDEO-mode landmarker, with priority student take > teacher step > background jobs.
- Preempting means checkpoint, reset, run the other job, reset, then resume.
- The UI says "Teacher preparation paused while we check your take".
- Unit-tested with a fake landmarker.

**During a bake:**
- the raw video stays playable;
- Wake Lock is held **and re-requested on every `visibilitychange` to visible**;
- it pauses when the tab is hidden ("Keep this tab open");
- a checkpoint is written every 150 samples (Phase 2).

### 2.4 Models, pool, delegate, tier, timestamps

**Smoothing depends on `numPoses` (R62).** MediaPipe's landmark smoothing runs **only with `numPoses: 1`** in VIDEO mode (`pose_landmarker_graph.cc`). With more poses, the lanes are unfiltered, and the person detector runs on every frame until `numPoses` bodies are tracked.

**Instances per phase:**

| Use | Instance | Why |
|---|---|---|
| Phase 1 bakes | `full / VIDEO / numPoses 1` | Smoothed posture; detector only when tracking is lost |
| Phase 1 identity + people warning | `full / IMAGE / numPoses 3`, about 1 Hz | Finds other people; checks the VIDEO pass is on the chosen dancer |
| Phase 2 footwork bakes | `full / VIDEO / numPoses 2` | Deliberately **unsmoothed** raw lanes for strike events (R42); `numPoses` is frozen in `configHash` |
| Phase 2+ framing check, picker | `full / IMAGE / 3` | Shared with the identity pass |

**Timestamps and resets.**
- One session-wide monotonic clock: `ts = sessionBase + frameMs`. `sessionBase` jumps 10 s past the last stamp at every reset, so timestamps always increase.
- **Between videos:** one `setOptions` rebuild (about 1 s) gives a clean tracker. The tracking ROI carries over frame to frame, not by time. That's only twice per session.
- **At cuts inside a video:** a timestamp jump only. A seconds-long gap drives the One-Euro α to about 1 (where smoothing runs), and VIDEO mode re-detects when tracking confidence drops.
- `setOptions` (0.5–2 s: it re-serialises the model and recompiles shaders) is never used per cut. Its latency is included in the ETA.

**Delegate.**
- We pass **our own WebGL canvas** to `createFromOptions`, so `webglcontextlost` can be caught and the model recreated.
- GPU is checked on a known-good image **and on the first real video frame**.
- On failure, use CPU (and footwork gets the fps gate).
- A device failure is never reported as "no dancer".

**Tier.** `full` everywhere. `heavy` is optional on desktop only (Phase 3), and is fixed per project.

**Downloads.**
- WASM (~11.5 MB, jsDelivr) plus `full` (~9.4 MB, Google).
- The size is **always** shown the first time (Safari has no `navigator.connection`).
- Google serves the model with `max-age=3600`, so it is re-requested on most visits.
- Self-hosting both on Netlify removes those two third parties (§12 decision 6).

### 2.5 Preflight, people, identity, cuts

**Phase 1 (simple and honest; R62, round-4 identity fixes).**
- The VIDEO pass (`numPoses 1`) follows one body. The 1 Hz IMAGE pass (`numPoses 3`) decides who **the dancer** is.
- **Start:** the biggest, most central body. Ankles must be in frame only when Legs is switched on.
- **Same dancer** means all of:
  - hip-centre continuity;
  - a box height within a tolerance that **grows with the time since she was last seen** (bends and muzhumandi shrink her by 40–50%);
  - facing (front / side / back) changing only through side. The facing rule applies only when ≥ 2 people are present, which stops a front-mirror reflection taking over.
- **Lost for > 1 s:** re-pick the biggest central body.
- **The VIDEO pass on someone else:** those frames are masked, and the warning is shown.
- **Warning** "Someone else is in the video; results may mix you up" when a second body **at similar depth** (box height within 25%, feet at a similar image y) is present for ≥ 20% of samples. Smaller people higher in the frame are behind the dancer and are ignored.
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
| **Posture features (Phase 1+)** | MediaPipe's smoothing (`numPoses 1`) + a 3-sample median per feature. **No** despike or stabilise. Stillness, pause and bobbing thresholds are **relative to each video's jitter**, defined once as the residual of a robust 1 s local fit (it works without still frames), so small, far-away children don't trip them. |
| **Strike events (Phase 2, R42, R62)** | **Raw** ankle, heel and foot_index lanes from the unsmoothed `numPoses 2` bake. Despike only jumps > 0.25 m between samples, which are physically impossible. **σ_j = max(SD on raw still frames, MAD of the second difference of d on strike-run frames away from candidates)**, so noise during motion isn't underestimated. |

- Gaps of ≤ 3 samples are interpolated and flagged `INTERP`. **`INTERP`, low-visibility and despiked samples are never evidence:** they mask the slots they cover (§4.1).
- Resample onto the uniform grid.
- **Roll correction** (Phase 2 footwork): per 2 s window on upright frames, from the mid-ankle → mid-shoulder axis, with the heel line as a backup.
- **Phase 1 needs no roll correction:** its features are roll-invariant by construction (§5.1).
- **Leg reliability score** (jitter, bone residual, knee outside the hip–ankle cone). A low score turns off knee angle, knee spread and knee alignment.
- **Tests:**
  - 2-sample, 3 cm lifts injected into raw lanes at 24, 15 and 10 fps must survive the full load → clean → events path;
  - **a P0 measurement of raw ankle jitter vs 2nd-speed lift for a child at 3 m** decides whether child takes can reach the SNR gate at all.

The pure track functions move to a three.js-free `lib/motion/track.ts`, re-exported from `retarget.ts`.

### 2.7 Storage, privacy and deletion (R50, R68)

**The rule: NrityaVaani never keeps video of a student.** With a shared demo login (user id "1") and no real accounts, per-user storage can't protect anyone. **Accounts don't separate data on a shared device**, and `/privacy` says so.

| Data | Phase | Where | Lifetime |
|---|---|---|---|
| Student video + its landmarks | 1 | Memory only | Object URLs are revoked on unmount and on `pagehide`. A back/forward-cache restore (`pageshow` with `persisted`) resets to step 1. |
| The phone camera app's own copy | 1 | The phone's gallery (not ours) | The user's; `/privacy` says to delete it there if wanted |
| Teacher step landmarks, session copy | 1 | IndexedDB | Written before the camera opens; deleted at the end of the session or by the sweep after 2 h |
| Teacher step landmarks, "Save this teacher step" | 1 | IndexedDB, opt-in, keyed by a file fingerprint | Until "Delete saved steps" (on `/compare` and `/privacy`) |
| Student crash-resume record | 2 | IndexedDB, AES-encrypted, key in `sessionStorage`, Web Lock | Deleted after the bake, or by the sweep when the lock isn't held, and **always within 2 h** |
| Text summary (bands, tip ids, date, step name) | 2 | `localStorage` `nv_compare_sessions`, separate from `nv_sessions` | Until **"Delete practice summaries"** (on `/compare`, `/dashboard` and `/privacy`). Visible to anyone on the device; the UI says so. |

**NVB2 format (teacher bakes, Phase 1+):**
- `"NVB2"` + u32 header length + JSON header + raw lanes.
- **Header:** `{v, key, configHash, tier, delegate, numPoses, fps, effectiveFps, range, rotation, laterality}`.
- **Lanes:** `flags u16`, `times f32`, `poseWorld f32[n·33·4]`, `poseScreen f32[n·33·2]`.
- **Key = fingerprint:** size, duration, dimensions, hash of the first and last 1 MB, and the marked range. File name and modified time are not used, because phone pickers hand over fresh copies.
- Cleaning and features are recomputed on load.

**`/privacy`: the existing pillars are rewritten per phase, not just added to.**

| Pillar today | Phase 1 wording | Phase 2 change | Phase 3 change |
|---|---|---|---|
| "No Recording or Surveillance" | "Nothing is recorded unless you choose to, and recordings never leave your device." | "If processing is interrupted, your take is held in this browser, encrypted, for at most 2 hours." | — |
| "Nothing leaves your device" (headline) | Kept, plus: "Model files are downloaded from Google and jsDelivr when you use the camera or video features; no video or images are sent." | — | Reworded: "Your video never leaves your device. If you play a YouTube video, YouTube receives data as described in Google's privacy policy." |
| "Zero Third-Party Tracking" | Kept (models aren't tracking; self-hosting removes even the downloads) | — | "We don't track you. YouTube videos you choose to play are third-party content." |
| (new) | "NrityaVaani never saves your own videos. If you record with your phone's camera, the camera app may keep its own copy in your gallery." | "Practice summaries stay on this device until you delete them; anyone using this device can see them." | Voice: "Tip text (never video) is sent to Microsoft's text-to-speech service (edge-tts) when you tap Hear it." |
| (new) | "Accounts don't separate data on a shared device." | — | — |

## 3. "Not all movement is necessary": what gets judged

### F1. Human trim and automatic edges

- **Teacher:** you mark one step (Phase 1). Several ranges come in Phase 3.
- **Student:**
  - optional in/out handles;
  - automatic: frames with no full body, frames where the dancer's screen height grows or shrinks steadily (walking to or from the camera), and frames where the ankles leave the frame are dropped from the edges;
  - **the step search (§4.7) ignores everything outside the match anyway.**

### F2. Pauses inside a step

**Phase 1 (general path, R59):**
- **The step kind is decided first, on the uncut teacher step** (05 §3.2, R71). **Holds and posture steps are never pause-cut.**
- **For movement steps:**
  - a pause is a run of ≥ 1.5 s whose windowed displacement (±0.5 s) stays below 3 × that video's jitter, **and whose pose matches no teacher frame**. A pose held as part of the step is never cut.
  - Pauses are **cut out of both videos before alignment**, with an index map kept for playback. The ±1 s transitions around them get a neutral cost and are left out of scoring.
  - Round 4 showed that keeping a pause in the alignment makes the path squeeze the step to avoid it. Round 5 showed that cutting before the step kind is known deletes holds.
- Pauses are shown as "pause (not judged)", with a restore button, and are left out of speed.
- If ≥ 60% of the teacher's step is still, it is a **hold step**, and stillness is the point (F5).

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
2. **Several patterns** are split **only at pauses** (upright and still ≥ 1.5 s), never at speed changes (R65), **and** only when the take contains more than one stable pattern.
   - **A take recorded to the practice track is never split:** the student is following the declared card's clock.
   - **Each speed section is judged against the declared card:** "At 2nd speed you struck twice on each side."
   - Window costs are **normalised per aligned strike**, over **equal durations**, so short cards don't win inside long ones.
3. **Neighbouring cards in the same lesson are likely errors, not other steps.** If the whole take matches another card and not the declared one, **and the differing slots have positive evidence** (§4.1: a deletion needs evidence of absence), ask after the take: "It looks like you danced **2 strikes on each side** (like Adavu 2). Adavu 3 in this reference has 3. Which is right?"
   - **[I was doing Adavu 3]** → judged against Adavu 3: a count tip.
   - **[I was doing Adavu 2]** → re-judged as Adavu 2.
   - **[I did 3: you missed some]** → no count tip; logged as a detector miss, which suppresses that template for the session.
4. **"Different version"** only when the take matches **no** card in the lesson and the student has **not** confirmed the version. Even then it shows the detected strip and asks, and never silently skips.

**Tests:**
- Declared Adavu 3 danced R R · L L throughout → the count tip, or the prompt then the count tip.
- **Declared Adavu 3: correct at 1st speed, R R · L L at 2nd speed (no pause) → "At 2nd speed you struck twice on each side", not "also danced Adavu 2".**
- **A correct Adavu 4 with soft weight-transfer 4th strikes → no count tip, no prompt.**
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
1. Find the frames whose state matches the step (ARAMANDI for an aramandi hold, posed arms for STANDING_HOLD). In Phase 1: frames whose cost to the teacher's median pose is ≤ τ_P (from the tolerances and jitter), with no step search (05 §3.5). Round 4 showed that holds sent through the step search get judged by their duration.
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

- **Confidence (R58, R74).**
  - **Phase 1:** a ceiling with a tolerance-based floor, plus a "real movement" test against the student's own frozen pose (05 §3.4). A whole-take median is meaningless when a take is mostly dance or mostly padding. Round 5 found the "dip below the rest of the take" test never decided an outcome, so it was dropped.
  - **Footwork:** relative to other phrase positions.
  - Both keep beginners from being rejected and stop standing still from "matching".
- **Masked frames** (no person, out of frame, occluded, SUSPECT_ID) get a **neutral cost**: the median of row minima over unmasked frames. They are excluded from normalisation and from every scoring denominator.
- **Offsets (R53).** A constant posture offset (an arm held 15° low throughout) raises the cost everywhere, so the relative dip survives. The offset itself then becomes a tip. Per-window de-meaning **inside** the DP is not used: the window is an output of the path, so it can't be done in one pass. For the v2 chained sDTW, either:
  - align on offset-invariant features (velocities, or features high-passed over about 1 s), or
  - align, recompute the mean over the matched span, and re-run in a ±1 s band (2–3 iterations).

### 4.1 Strikes (Phase 2)

**Lift signal.**
- **Differential lift:** d(t) = y_L − y_R of the ankles, in the roll-corrected frame, from **raw lanes** (§2.6). Hip bounce, rising aramandi and standing cancel.
- The same quantity in upright screen pixels ÷ torso pixels. Per take, the version with the higher SNR is used.
- Baseline d0 and jitter σ_j come from **raw** frames where both ankle speeds are low.

**Detection (order fixed in round 4, R66).**
1. **Candidates:** peaks of |d − d0| above 3σ_j (σ_j per §2.6), plus confirmed stamp onsets.
2. **Tempo τ:**
   - **Recorder takes:** τ and the section boundaries come from the **practice-track clock** (or the teacher video's clock), which is known exactly.
   - **Uploads:** card-aware. IOIs are clustered at multiples of the card's slot ratios, and τ is cross-checked against a threshold-free estimate (the spectral peak of |d − d0|). **If the two disagree by about 2×, abstain**, because missed strikes would otherwise double τ and pass the fps gate.
3. **A first cyclic alignment** (§4.2) assigns candidates to slots.
4. **Sections are fitted on the residual IOIs** of that alignment (§4.3). On uploads, alignment and sections are iterated once.
5. **Thresholds per foot and per slot class:**
   - each foot gets its own SNR and threshold;
   - every distinct slot duration in the card is its own class with its own median lift.
   Then re-detect **from the raw signal**, not only from step 1's candidates (round 4: candidates below 3σ_j never reached the slot-class median).
6. **Audio can add** a strike: a stamp inside a periodic stamp run, with an ankle vertical-velocity peak within ±1 sample.
7. **Audio can veto, for silent slots only:** in a take where stamps confirm ≥ 70% of landings, a landing without a stamp **on a silent slot** is a placement, not a strike. **The veto never turns a landing on a strike slot into a deletion** (R64).

- **Strike time:** the moving ankle's velocity minimum, refined to sub-sample time. A paired stamp time replaces it.
- **Both feet airborne** = a `jump` event, not part of strike strings.

**A deletion needs positive evidence of absence (R64).** A missing strike at a slot is claimed only when, around the expected time:
- there is **no** ankle vertical-velocity peak;
- max|d − d0| < 1.5σ_j;
- no sample there is `INTERP`, low-visibility or despiked (those **mask** the slot instead).

A lift that is present but below the threshold becomes a "**strike firmly**" note, or the app abstains. It never becomes a missing strike.

**Fair sampling.**
- **The fps gate uses the expected IOI** = slotDur × τ, with τ from step 2. It is applied **per slot class, to the shortest slot**.
- Count, silence and same/switch claims need **≥ 5 samples per shortest slot** at the effective fps, or stamp confirmation. Otherwise: "Too fast to count at this camera's frame rate: try 1st speed or a laptop."
- **No deletion edit is reported** at a reference position whose expected IOI is under 5 samples.

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
- **"Rest stretched":** an IOI across a rest over 1.6× expected, in ≥ 50% of phrases. This is a timing note, not a pattern edit.
- Rest-spanning IOIs are excluded from evenness.
- The DP runs under both image→foot mappings. Mapping-invariant errors are always reportable; side-specific ones only with known laterality (§4.8).

**Recurring edits.**
- An edit is reported only when the same edit recurs at the same reference position in ≥ 50% of **fully judged half-phrases**, and in ≥ 2 of them.
- Every card's L-half mirrors its R-half (confirmed in the clip), so recurrence is counted over **mirrored half-phrases**. This halves the take length needed.
- **≥ 4 fully judged half-phrases** are needed before any pattern tip.
- A half-phrase touching a masked span, a seam, or the partial start or end of the take is not fully judged. **When pattern tips abstain for this reason, the reason is shown** ("2 phrases were hidden, so the count wasn't checked").

**Phrase correctness → "Keep the count" (R44).**
- Based on the **per-strike edit rate**, not exact phrases.
- It fires only when the student's edit rate is **≥ 3× the detector's edit rate** on good takes, using a **beta-binomial** baseline: take-to-take variation is real, so a pooled binomial overstates certainty. The baseline is pooled by card group (2-slot, 4–8-slot, 12–16-slot phrases) and fps tier, needs ≥ 4 fully judged half-phrases, and needs ≥ 10 good takes per group and stratum (§9).
- Only edits confirmed by stamps or high per-foot SNR count.
- It is its own calibrated template. Until it passes, it isn't shown.
- The per-phrase ✓/✗ strip is drawn only for phrases where every slot is confident; the rest are grey.
- The tip says "**count silently in your head**", never "aloud": a voice in the room interferes with the stamp detector.

**Version check (R43).**
- **In Learn**, the strip (with durations drawn to scale) is shown with the 3D figure and the practice track as information.
- **The question is asked after a take** (R56), and only when a consistent deviation was found: "**This reference does R R R · L L L. Is that how you learn it?** Yes / My version differs / Not sure". The answer is remembered.
- **"Yes" is authoritative.** Consistent deviations are errors, worded relative to the reference: "This reference strikes four times on each side; you struck three every time." Every pattern tip carries a one-tap **"My version is different"**, which switches pattern tips off for that step.
- **"My version differs":** pattern tips off; shape and posture tips stay.
- **"Not sure":** see F3b(4).

**Start foot (R45): only against a clock.**
- **Recorder with a count-in:** one bar of in-tempo clicks with a spoken "1", and the strip stays blank until count 1. Position 1 is expected within a window of **min(½ pulse, ¼ half-phrase)**, after a nominal output latency (Bluetooth outputs are treated as unknown, so "not checked").
  - A wrong start foot means the first strike lands inside that window but aligned to the **opposite half-phrase's** start.
  - Anything later is "late entry", with no start-foot claim. Round 4: a 1-pulse window equals Adavu 1's whole half-phrase. A late start (first strike at count 4) gives **no** tip.
- **Uploads:** "Start foot not checked", unless the first strike is stamp-confirmed **and** preceded by ≥ 1 s of confirmed stillness with both ankles visible and no lift above 2σ_j. For alternating patterns (Adavu 1, 8) on uploads it is always "not checked".
- On uploads, the tip is worded as a check: "Check: did you start with your right foot?"
- **Tests:** L-start at the count-in → tip; late start at count 4 → no tip; **Adavu 1 entry on count 2 → no tip**; Adavu 1 upload with a soft first R → no tip.

**Templates (shape, Phase 3):** 12 samples per slot, rests included. Odd half-phrases are mirrored before averaging. Key postures sit at the landings.

### 4.3 Speed sections and ladders (R55)

**Sections.**
- **Fitted after the first alignment**, on residual IOIs (IOI ÷ Σ slot durations · τ), so Adavu 5–8's built-in long/short slots don't create a change point every phrase (R66). **Recorder takes take their boundaries from the practice-track clock.**
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

### 4.7 The core path (Phase 1, R41, R57–R61, R71–R75)

The general method for **any** marked step. It is specified fully in `05-mvp.md` §3.2–3.6; in summary:

1. **Jitter** is defined once per video (the residual of a 1 s robust fit).
2. **Step kind** on the uncut teacher step:
   - **hold** if ≥ 60% still and low motion;
   - **movement** if noise-corrected motion is ≥ 0.07 rad;
   - otherwise **posture**.
   Features include hip height and segment-length ratios, so up/down steps count as movement.
3. **Pauses**, for movement steps only: still runs that match no teacher frame are cut from both videos, with their ±1 s transitions left unscored.
4. **Movement steps:** subsequence DTW on de-rolled segment directions plus height and length ratios.
   - Steps (1,1), (1,2), (2,1), (1,3), (3,1). Faster steps charge the skipped teacher cells; slower steps charge the mean of the covered cells + λ.
   - **Found** = a ceiling with a tolerance-based floor **and** the "real movement" test against the student's own frozen pose.
   - **Tries:** up to 6, scanning past failing candidates.
   - **Partial:** a reverse search with the student's near-teacher frames as the query.
   - **Mirror:** decided on speed-normalised velocities.
5. **Posture steps and holds:** frames within τ_P of the teacher's median pose, judged as distributions, plus a noise-subtracted "part moving" check. No timing claims.
6. **Feedback per phase**, plus range of movement against the matched span. 3D angle noise bias is removed, or the feature is skipped.

**Evidence:**
- **Round 4 experiment:** the original rules failed; the baseline, real-movement and pause-first fixes worked on non-periodic and arm-only steps; Thattadavu-like steps carry no timing signal.
- **Round 5 experiment** (105 cases): with R71 + R72, 88 pass. The remaining failures are at 3–4× noise and 15° roll, which R73–R75 target. The suite is in `docs/video-compare/prototype/` and is build step 1's test bed.

**Known blind spot:** the stamp count and timing on footwork-in-place steps. Phase 2 exists for that.

**Chained Tier C (v2):** long non-cyclic sequences (the whole Namaskaram) are cut into 2–6 s units at stillness minima and matched as an ordered chain that may skip units, with R53 for offsets.

### 4.8 Laterality: no side words without facts

| Source | Laterality |
|---|---|
| **Recorder (Phase 2)** | Known: raw frames are unmirrored (virtual-camera labels → unknown) |
| **Upload, back camera** | Unknown unless metadata settles it; the camera answer alone isn't enough |
| **Upload, front camera** | **Mirroring unknown** (iOS "Mirror Front Camera", Samsung "Save as previewed", editing apps). Two agreeing independent signals are needed: QuickTime lens + a known device default, or the student's answer on a still of her first strike ("Which foot is this?") |
| **Teacher file** | Two signals: "Which foot should YOU start with?" (default Not sure, asked only after a take), plus the student's own first take. Mapped per facing section (Phase 3). |
| **Pattern card / studio reference** | Known |

- **Without known laterality:** no "left/right" in any tip. The joint is marked on the student's video with a ring and an arrow instead (Phase 1 does this always).
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
| **Knee roll-in** (R47, R61) | **Absolute, never compared with the teacher.** On frames with ≥ 20° of knee bend: the 3D angle between the knee's bend direction and the foot direction (ankle → foot_index), both projected onto the plane across the hip–ankle line. Claimed only if it points ≥ 25° inward on ≥ 40% of bent frames **and** the knee sits inside the ankle on screen. Round 4 showed that a teacher-relative lateral offset reads a shallow bend as rolling in. |
| **Side tilt** | 2D torso axis **minus** the mid-hip → mid-ankle axis (camera roll cancels) |
| **Height bobbing** | Mid-hip screen y relative to the planted (lower) ankle ÷ torso length, spread over the matched span; threshold = teacher's + max(0.03, 3 × that video's jitter) |
| **Range of movement** | Per angle, the student's 90th–10th percentile spread vs the teacher's (where the teacher's ≥ 2 × tolerance); < 0.7× → "move bigger" |
| **Part moving** (posture steps) | Motion energy per body part vs the teacher's; < 0.3× → "your feet hardly moved" |
| Speed (movement steps only; never for partial readings) | Matched duration ÷ teacher duration, pauses excluded; shown as a ratio between 0.5× and 2×, otherwise "more than 2× slower/faster" |

**Phase 2 adds:**
- planted hipDrop, foot-lift height and the strike pattern;
- **height steadiness phase-locked to strikes** (cue: "stay at the same height"). Hip height relative to the **stance ankle** is averaged by strike phase over all frames, not just planted ones. Its amplitude is compared with a **phase-shuffled null**, so noise doesn't grow with the number of samples per cycle. There is an absolute prior for pattern cards.
- **Knee roll-in for footwork:** as Phase 1, plus "knee spread ÷ toe spread falls as she sinks". It is calibrated on a sweep of depth × turnout (30° and 60°).

**Torso core = side tilt + forward lean.** From the front, forward lean can't be seen. The Torso chip then reads "**Partly checked: side tilt only** (forward lean needs a side view)". A front-view proxy (shoulder→hip screen length shrinking relative to the take's upright frames, with the nose moving toward hip height) is beta.

**View check.** If the body's yaw (from the 3D shoulder line) differs from the teacher's by > 30°, the 2D features are off: "Film from the same angle as the teacher."

### 5.2 Penalties, safety gate, bands

**Penalty.** `p = clamp((e_bad − tol_f) / (3·dead_f), 0, 1)`, measured in the penalised direction only.

**Safety gate on depth (R47).**
- A "lower" tip is allowed only when **knee roll-in** was judged (≥ 1 s of bent, clearly seen frames) and not claimed, and leg reliability is good.
- **Knees roll in:** the tip becomes "**Push your knees out over your toes before going lower**", and the depth tip is suppressed.
- **Knees not judgeable** (saree, low reliability): no "lower" tip. **Exception:** if the student's legs are nearly straight (knee > 165°) while the reference's are bent (< 150°), the safe "Bend your knees a little, keeping them over your toes" is given (R75 / round 5).
- A depth tip never asks for more than half the remaining gap ("a little lower").
- **Heel-down is "Not checked"** until it is calibrated.

**Beginner depth (round 3: elite reference). Phase 2+ only:** it needs stored history, and Phase 1 stores nothing.
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

**Phase 1 (R60):** the teacher's step is split into **phases** at its velocity minima (0.5–2 s each); posture steps and holds are one phase.
- A tip needs:
  - in at least one phase, the median difference is beyond tolerance (or range of movement / part moving fails);
  - visibility ≥ 0.6 on ≥ 70% of those frames;
  - presence in ≥ half the tries.
- `severity = (|median difference| ÷ tolerance) × the share of the step's time in failing phases`.
- **Output:**
  - top 3, one per body part;
  - **Timing is a separate line**, never one of the 3;
  - 1 strength: a clearly seen body part within half the tolerance **in every phase**. "More is fine" features are never praised.
- Round 4: a whole-step median hid errors that live in one third of the step (arms never raised at the top of a sweep), and even turned them into a "strength".

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
1. "**Raise your arms higher.** At the top of the sweep they reach about two thirds of the teacher's height. ▸ Show me" (range of movement)
2. "**Bend your knees a little more.** Sit lower into aramandi, keeping your knees out over your toes; don't force it."
3. "**Your feet hardly moved; this step has footwork.** Practise it with the stamps." (posture step)
4. "**Stay at the same height.** Your hips bounce while the teacher's stay level."
5. *Timing line:* "About 30% slower than the teacher. Practising slowly is fine; speed up when you're comfortable."

**Phase 2:**
6. **Count (consistent error):** "**Three strikes on each side.** You struck twice on each side in every phrase; this reference strikes three times. *Cue: 'Right, right, right, then left, left, left.'* [My version is different]"
7. **Silence (Adavu 7):** "**Count eight is silent in this version.** Your feet stamped on eight in 5 of 6 half-phrases."
8. **Knee roll-in:** "**Push your knees out over your toes before going lower.**"
9. **Strike firmly:** "**Strike the 4th step firmly.** The app could barely see it land." (a lift below the threshold; never "missing")
10. **Keep the count** (once calibrated): "**Keep the count.** Several strikes landed off the pattern; count silently in your head."

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

**"Show me"** pauses both videos at the worst moment, with the joint marked by a thick limb, a ring and a direction arrow on both. It doesn't rely on colour; unsure joints are drawn faded, never red.
**The ghost** draws the teacher's skeleton on the student, scaled by torso length and anchored at the mid-hip, labelled "approximate". It is off for pattern cards.

### 6.6 Voice (Phase 3)

- "Hear it" reads the focus tip via `GuruAudioEngine.syncLine` with a 6 s timeout, falling back to Web Speech.
- Beta tips are never voiced.
- Button note: "Tip text (not video) is sent to our voice service."

---

## 7. Student flow and UI (`/compare`)

**Phase 1 stepper: 1 Teacher → 2 You → 3 Result.**
1. **Teacher:**
   - upload;
   - mark the step: a suggested moving run, a zoomed strip, Start/End-here, nudges, "Play selection";
   - "Prepare" (primes playback inside the tap). It shows the download size the first time, an ETA from a speed test, and a progress bar as the skeleton fills in, with "Keep this tab open";
   - the step kind is shown ("Movement step" / "Posture step: footwork timing not checked yet" / "Hold");
   - optional "Save this teacher step".
2. **You:**
   - "Choose a video" or "Record" (phone camera, touch devices; the teacher step is session-saved first);
   - optional handles;
   - "Analyse my video" (its own tap);
   - progress through the two passes.
3. **Result:**
   - two panes (stacked on mobile) with **one Play button** that starts both inside the tap;
   - the teacher is muted by default, with a "Sound: mine / teacher's" toggle;
   - band chips with "Not checked" notes;
   - up to 3 tips + 1 strength, each with Show me, plus the Timing line;
   - joints marked by **ring + arrow + thick limb**, not colour alone; unsure joints faded;
   - ghost (if time allows) and body-part switches;
   - "Try another take". Changing a switch re-scores instantly, with no re-processing.

**Page chrome:**
- `LiveChat` is hidden on `/compare` (it covers the stacked panes); status is shown inline, never as toasts.
- `page.tsx` is a server component (it sets the title) rendering a client component.
- On `pagehide` everything is cleared, and a back/forward-cache restore resets to step 1.

**Phase 2 adds** a Reference choice (pattern card / teacher file), Learn (3D figure + practice track at 0.5/0.75/1×), the recorder, and a Thattadavu "confirm the step" prompt for teacher files.

**Error and empty states**

| Situation | What the user sees |
|---|---|
| Model download failed | Retry |
| GPU failed | CPU mode note (slower) |
| HEVC / codec (width 0 or no frame within 3 s) | "Your phone saved this in a format this browser can't read: Settings → Camera → Formats → Most Compatible, or try Chrome" |
| Playback blocked (iPhone Low Power Mode) | Switches to the seek loop and shows "Tap to continue" |
| Lost GPU context | Recreated automatically; resumes |
| Page reloaded after using the camera | "Your teacher step was kept. Choose the teacher video again to continue." |
| Mostly-still selection | "Your selection is mostly still. Mark just the moving part?" |
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

## 8. YouTube "Practise beside" (Phase 3; a watch-only part can come right after Phase 1, decision 2)

### Before anything ships: child-directed status (R70)

- YouTube Developer Policies **III.J (child-directed API clients)** require, for a child-directed client:
  - COPPA/GDPR-K compliance;
  - **notifying Google**;
  - no write actions.
- India's DPDP Act treats **under-18s** as children and needs verifiable parental consent.
- Whether NrityaVaani is child-directed, and under which jurisdiction, is **decision 8** (§12).
- **If yes:**
  - file the III.J notification before shipping;
  - make no write calls (§8 makes none);
  - set the age wording in `/terms` to match the jurisdiction;
  - **name the operator** (the legal party running the site) in `/terms` and `/privacy`.

### Link parsing

- **Hosts:** youtube.com, www., m., music., youtube-nocookie.com, youtu.be.
- **Paths:** `/watch` (`v=` anywhere in the query), `/shorts/ID`, `/embed/ID`, `/live/ID`, `/v/ID`.
- `si=` is stripped. `t=` / `start=` prefills "Mark start".
- Unit tests cover each form.

### Facade and lookup

- **Facade:** a neutral placeholder. **The `iframe_api` script is injected only on the facade tap**, and the iframe loads at that tap.
- **`GET /api/yt/meta?id=`** (videos.list: embeddable, made-for-kids, duration, aspect):
  - served as a **Next route handler on Netlify**: no sleep, and the client IP comes from `x-nf-client-connection-ip`, **once a deploy check confirms Netlify overwrites that header**;
  - if it stays on Render, use the **rightmost** `X-Forwarded-For` hop (uvicorn's `'*'` trust returns the leftmost, which the client can forge);
  - id regex;
  - a **per-video-id cache**;
  - a per-IP burst limit;
  - a **global hourly cap below quota ÷ 24**, so forged traffic can't burn the day's Data API quota;
  - a 7-day client cache.
- **When the lookup fails:**
  - the player still loads with the same no-tracking settings (facade, nocookie, no autoplay), so made-for-kids compliance never depends on it;
  - the id is not stored;
  - a small "details unavailable" note is shown.
- **The Google Cloud project and its API key** need an owner (decision 9).

### Player

- `www.youtube-nocookie.com/embed/ID?enablejsapi=1&origin=…&controls=1&playsinline=1&rel=0&fs=0`, **without `allowfullscreen`**. No autoplay.
- `fullscreenchange` pauses any recording, as a backstop.
- **Desktop/tablet:** the player takes the **maximum page width** minus the status strip. **Phones:** ≥ 200×200 and full width, stacked.
- **Shorts or portrait videos** (from the path or the lookup's aspect):
  - a 9:16 player;
  - on phones it is stacked at ≥ 200 px wide, and the student pane is a **toggle outside the player**, never squeezed beside it (round 4: side by side gives 175 px, below the 200 px minimum).

### Nothing over the player

- On this page the navbar is `absolute`, `LiveChat` returns null, and the page never calls `toast()`.
- **The Navbar's mobile-menu state moves to a shared store** (today it is local `useState`), so `/compare` can pause the player and swap in the facade when the menu, a dialog or a select opens.
- All prompts ("Tap play on the video", "Tap to start sound", the countdown, the recording indicator) sit **in the strip outside the player**.
- No CSS mirror, scale or filter on the iframe. **Mirror view isn't available for YouTube.**
- Playwright `elementsFromPoint` checks cover the idle, menu-open, dialog-open, prompt and recording states.

### Recording beside YouTube: desktop and tablet only (R67)

- **Phones don't get an in-page YouTube recorder.** At 3 m the stacked player is about 2 cm tall, which is the R36 problem, and ads need a tap on a player 3 m away.
  - Phones get "**Watch here, then record or upload your take**" (the Phase 1 path, with no comparison to the YouTube video).
  - Or "play YouTube on a laptop or TV and record with this phone".
- **Desktop/tablet layout:**
  - the player at full width with controls;
  - the badge, countdown, status and recording indicator in a strip outside it;
  - no YouTube fullscreen;
  - no sound-only mode.
- **Audio unlock:** a tap inside the cross-origin iframe doesn't unlock our `AudioContext` on iOS, so it is unlocked on our own "**Get camera ready**" tap.
- **Start:**
  - the player is **cued 5 s before "Mark start"**;
  - the student taps **YouTube's own play button**;
  - recording starts on the PLAYING state, and approach frames are trimmed;
  - `onAutoplayBlocked` → "Tap play on the video" in the strip.
- **Stop:** wall-clock duration, tap, or walking out of frame.
- **Ads and buffering:** frames are unsynced when the player is not PLAYING for > 2 s, **or** `getCurrentTime()` has stalled for > 1 s while it reports PLAYING (the API exposes no ad state). The app says aloud "Ad or buffering, recording paused".
- **The take is video-only.**
- **Start foot is "not checked"** for YouTube takes: there is no count-in clock.

### Review beside YouTube

- The YouTube player **plays independently**. It is re-synced only when the student plays or seeks her own pane, only if drift > 1.5 s, and never more than once per 5 s.
- Each tip has "**Jump YouTube here**", which seeks once and waits for `onStateChange`.

### What the student gets

- Her skeleton on her own video.
- The pattern card checks (declared adavu, version confirmed).
- The reference-free habits (§6.3).
- Posture comparison **only** through a studio reference or her teacher's own file. **She is never compared with the YouTube teacher, and the app never invites uploading "this" video.**

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
- **New `/terms`:** YouTube ToS binding (with link); rights to uploads; the operator's name; the age and guardian wording for the chosen jurisdiction (decision 8).
- **`/privacy`** (per the §2.7 table):
  - YouTube API Services, with the YouTube ToS and Google Privacy Policy links;
  - "**YouTube is contacted when you tap the video**";
  - "**The video id you paste is sent to our server, which asks YouTube for its details**";
  - "YouTube videos you choose to play are third-party content";
  - **Microsoft** named for edge-tts.

**Explicitly not built:** server download, tab capture, a canvas over the iframe, a skeleton derived from YouTube.

## 9. Calibration and tests

### Phase 1 tests (no recordings needed)

- **Pure-TS unit tests**, run with `node --experimental-strip-types --test`; no new dependency.
- They start from the round-4 experiment's synthetic stick figures:
  - a step with no cycle;
  - an arms-only step;
  - a Thattadavu-like step.
- The full must-pass list is in `05-mvp.md` §6 step 1. It includes tight trims, beginners, 3 tries, mirrored, frozen-in-posture, another adavu, partial + offset, pauses, teacher talk, 2.3× slower, a one-phase arm error, range of movement, holds, knee roll-in vs depth, a small child standing still, and camera roll.
- **End-to-end smoke test:**
  - record the 3D dancer from `/learn` (Playwright `recordVideo`) as a teacher file and compare it with a slowed, shifted, padded copy;
  - headless Chromium with the **CPU delegate set explicitly**: it checks the plumbing, not calibration;
  - plus checks on a real iPhone (Low Power Mode, HEVC `.mov`, portrait, camera handoff) and an Android 14+ phone (the camera button).
- **Phase 1 tolerances** are first guesses, labelled beta. They are re-derived in Phase 2 from test-retest on the Phase 2 good takes, which also show arms, torso and spreads, so no extra recordings are needed. Until then, arm and torso tips stay beta.

### Phase 2 calibration

**Harness.**
- `scripts/bake-fixtures.mjs` drives Playwright with `channel: 'chrome'`.
- It **asserts `WEBGL_debug_renderer_info` is not SwiftShader or llvmpipe**, running headed with `--use-angle` on a team laptop. Or it calibrates on the CPU delegate, if P0 measures the GPU/CPU difference under ¼ dead band.
- The detection **`configHash` is frozen before calibration**, including `numPoses 2`.
- Re-bake hours are budgeted.
- **Recording starts after the extraction freeze.**

**Synthetic suite (raw lanes):**
- 2-sample, 3 cm lifts at 24/15/10 fps → kept;
- standing start, ±3 cm hip bounce, rising aramandi → 100% of strikes;
- first strike dropped; start at count 4; **Adavu 1 entry on count 2**; mixed 2/3/4 counts;
- correct Adavu 5–8 with 15% jitter;
- declared Adavu 3 danced R R · L L → count tip;
- **Adavu 3 correct at 1st speed, R R · L L at 2nd (no pause) → a 2nd-speed count tip, not "also danced"**;
- **a correct Adavu 4 with soft transfer strikes, mic on, 75% stamp share → no count tip, no prompt**;
- Adavu 7 missing the switch → pattern tip;
- Adavu 7 stamp on 8 → silence tip;
- correct Adavu 7 at 95% detector recall → no "Keep the count";
- correct Adavu 5 and 8 at 15 and 24 fps → no count tip, **and no section break every phrase**;
- an asymmetric-strength correct take → no count tip;
- **missed every other strike at 3rd speed (upload) → τ cross-check abstains**;
- seam at every phrase; a 1.5 s walk-through → no count tip, reason shown;
- teacher talk gap; student rest → excluded;
- L-start at the count-in → tip; late start → no tip;
- a 30% rush then a correct doubling → rushing, no under-doubled;
- Adavu 6 rests collapsed → "rest collapsed"; rests stretched → timing note;
- Adavu 1–4 concatenated with pauses → split at the pauses.

**Templates, Phase 2 v1:**
1. count error (incl. the declared-step prompt);
2. silent-slot strike;
3. start foot (recorder);
4. height steadiness;
5. knee roll-in + depth.

"Keep the count" is added once its beta-binomial baseline exists.

**Recording budget (R69).**
- **fps tiers come from decimating 24 fps takes**, plus a small real 15/10 fps set to check that decimation matches real cameras.
- **Count and silence are pooled by card structure:** 2-slot (Adavu 1), 4–8-slot (Adavu 2–4, 5, 6) and 12–16-slot (Adavu 7, 8) phrases. They are not gated per card.
- **Cells:**
  - pattern templates: 3 card groups × 2 strata;
  - posture templates: 2 templates × 2 strata.
- **Each cell needs:** ≥ 20 error instances in split B plus ~20 in split A, and **≥ 10 good takes per card group per stratum**.
- **About 400 deliberate-error step-takes + 60 good takes**, over 4 recording sessions in weeks 2–4.

**Strata.**
- **Adults** and **children aged 6–10** (guardian consent, through the reviewer's dance-school network), including **naturally occurring beginner errors**.
- **Which stratum a take is in:** asked once per device as an optional age band ("under 12 / 12+"). Without an answer, **all Phase 2 tips stay beta** until the child stratum passes. World landmarks are scale-normalised and every login is user id "1", so age can't be inferred.

**Labelling.**
- Pattern, count, silence and start foot are labelled **from frame-stepped video** (with audio as support), blind. Listening alone misses the soft strikes the detector also misses.
- Posture is labelled by the reviewer, blind, with magnitude.
- Splits are by dancer and session.

**Gate per template and per cell (split B).**
- Recall ≥ 80% on errors above the detection limit (2 × test-retest SD).
- No wrong-direction tip below the limit.
- Wilson 95% lower bound on precision ≥ 0.75.
- No high-confidence false tip on good takes.

**Data custody (R-legal).**
- **Raw calibration media** (children's included) live in a **private bucket** with a named access list, never in the public repo.
- **Raw video is deleted by a fixed date** after labelling and test-retest.
- **Child-derived landmark fixtures are never committed publicly.** CI pulls private fixtures using a secret; public tests use synthetic data only.
- **The consent form** states the purpose, storage, retention, who has access, and how to withdraw.
- **The data custodian is named** (decision 4).

**Required real cases:**
- saree + carpet; music; salangai; voice (sollukattu aloud); 15 fps webcam; CPU at 10 fps;
- camera behind the dancer with a mirror in front; side mirror wall; poster;
- class video with students behind the teacher; TV behind the student; parent on the sofa; handheld parent clip;
- captioned tutorial / PiP; pallu or printed-top turn; teacher crossing a wide stage with musicians;
- Namaskaram bow and 180° turn;
- elbows 15–20° low; knees rolling in; **a correct deep and a correct shallow aramandi at 30° and 60° turnout (no roll-in)**; a student deeper than the reference;
- child, mirrored front-camera upload;
- a front-then-back teacher; a different-bani version; portrait clipping of natyarambhe; an auto-framing webcam;
- test-retest.

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
| `extract.ts`, `queue.ts`, `identity.ts` | 1 | Frame canvas, reader (rVFC + seek fallback, tap priming, two-pass), VIDEO/1 + IMAGE/3 instances, dancer choice, job queue |
| `features.ts` | 1 | Segment vectors and velocities, angles, ratios, knee roll-in, bobbing, range of movement |
| `align.ts` | 1 | Pauses, step kind, subsequence DTW, found tests, tries, partial, mirror, posture/hold matching (pure TS) |
| `feedback.ts`, `tips.en.ts` | 1 | Phases, gates, ranking, bands, wording (pure TS) |
| `store.ts` | 1 | Session and saved teacher steps (NVB2, fingerprint key), delete |
| `reader.ts` | 2 | Mediabunny deterministic reader |
| `record/{recorder,unlock,loop,remux,tempStore}.ts` | 2 | Recorder, audio unlock, loops, remux, encrypted temp record |
| `practiceTrack.ts`, `cards.ts` | 2 | Web Audio clicks, the card table, clip-span mapping |
| `events.ts`, `patterns.ts`, `sections.ts` | 2 | Raw-lane strikes, cyclic DP with rests and masks, declared-step prior, version, sections |
| `audio.ts` | 2–3 | Stamp detector + voice exclusion (2); full policy (3) |
| `people.ts`, `identity.ts`, `shots.ts`, `graphics.ts` | 3 | Classes, signatures, cuts/motion, overlays |

**Elsewhere**
- `components/compare/*`; `app/compare/page.tsx` (server) + `CompareClient`; Navbar link; LiveChat hidden on `/compare`; `/privacy` pillar rewrite (Phase 1).
- `lib/youtube/*`; `app/terms/page.tsx`; a Next route handler `GET /api/yt/meta` on Netlify (or the Render backend with the rightmost-XFF fix); a shared Navbar menu store (Phase 3).
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
| First use: model download | ~21 MB | ~21 MB (always shown) |
| Teacher 10 s step | ~10–20 s | ~30–60 s |
| Student 60 s take (two passes) | ~30–60 s | ~1–3 min |
| Student 3 min take (two passes) | ~1–2 min | ~3–6 min (shown first) |
| Pattern card | 0 s | 0 s |

**Privacy:** all vision runs on the device. Student video is never kept. The backend only ever sees a YouTube id (Phase 3) and tip text for voice (Phase 3).

---

## 12. Plan and the decisions I need from you

**Phases.** Each later phase gets its own critic round before it is built.

| Phase | Work | Size | Cut first if late |
|---|---|---|---|
| **1** | `/compare` page (server + client); teacher upload + step marker (suggested run, zoomed strip, sliders); frame canvas + rVFC reader + tap priming + seek fallback + two-pass scan; VIDEO/1 + IMAGE/3 identity + job queue; session-save before the camera; features; pauses + step kinds; subsequence DTW (found tests, tries, partial, mirror); posture/hold matching; phases + range of movement; gates, bands, tips, Timing line; Show me, joint markers, synced playback; ghost if time allows; NVB2 save/delete; privacy pillars + back/forward-cache reset; Navbar + LiveChat; unit tests (starting from the 105-case prototype suite) + e2e smoke + 2 real phones | ~16 subsystems; **~2–2.5 weeks** for a student team | Ghost; saving teacher steps; two-pass scan (single pass + shown ETA) |
| **2** | Mediabunny reader; recorder (tap start, unlock, loop units, take length per card, remux, encrypted temp record with Web Lock, framing check); pattern cards (reviewer-settled) + practice track (noise bursts, self-test, in-tempo count-in) + 3D pane; raw-lane events (`numPoses 2`, motion σ_j, evidence-of-absence deletions); clock- or card-aware τ; cyclic DP with rests/masks over half-phrases; declared-step prior + 3-button prompt; version question after the take; start foot (recorder); steadiness vs a shuffled null; knee roll-in; minimal audio; Phase 1 tolerance re-derivation; harness; calibration (~400 error + 60 good takes, adults + children, private custody) | ~18 subsystems; ~5 weeks, recording in weeks 2–4 | Start foot; the stamp detector |
| **3** | YouTube practise-beside (III.J first; desktop/tablet recording, phones watch-then-record; Netlify meta route); studio references (media + lanes outside git); teacher-file states, proposals, several ranges, `.nvref`; full audio policy; ladder tips; early/late with latency calibration; extra-people classes + identity + graphics; Tier B + ghost on footwork; voice; heavy tier | ~5 weeks | Voice; proposals; Tier B |
| **v2** | Chained Tier C (Namaskaram sequences); mudras at body distance; Hindi; worker; rig references; live tips | — | — |

**Decisions for you**

1. **Build order:** Phase 1 (any teacher video file) first, then Thattadavu footwork, then YouTube. OK? **Note:** in Phase 1 a Thattadavu adavu gets posture checks only; its stamp count and timing come in Phase 2.
2. **YouTube**, choose one:
   - **(A-lite, then A) — recommended:** right after Phase 1, a **watch-only** YouTube player beside the student's own take ("watch here, then record or upload"), with link parsing, the facade, `/terms` and the `/privacy` text. The full practise-beside mode (desktop recording, pattern-card checks) follows in Phase 3. The student is never compared with the YouTube video.
   - **(A):** everything YouTube waits for Phase 3.
   - **(B):** desktop-Chrome tab capture. Desktop only, and it goes against YouTube's developer policy. Not recommended.
3. **Privacy:** NrityaVaani never keeps student videos; only teacher-step landmarks can be saved (opt-in). OK?
4. **Phase 2 needs people:**
   - a dance teacher as reviewer, who also settles the Adavu 8 count;
   - recordings that include children aged 6–10, with guardian consent;
   - **a named data custodian** for those recordings.
   Without them, Phase 2 tips stay "beta".
5. **Studio reference dancer** (Phase 3): optional.
6. **Model files:** load them from Google and jsDelivr (as `/live` does today, disclosed), or self-host them on Netlify (~21 MB, removes those third parties)?
7. **Navbar:** add a "Compare" link?
8. **Who is NrityaVaani for, legally?** Is it directed at children, and under which law (India's DPDP Act counts under-18s as children)? This decides YouTube's III.J notification, the age wording and the consent flow. It is needed before any YouTube embed ships, and also matters for Phase 2 recordings.
9. **Google Cloud project and API key** for the YouTube lookup: who owns it? (Only for YouTube.)

---

## 13. Known weaknesses (accepted)

- **The literal "skeleton on the YouTube video" is not delivered.** A YouTube-only student gets pattern-card checks and habits (Phase 3).
- **In Phase 1, Thattadavu-type steps (posture held, feet stamping) get posture checks only.** Round 4 tested this: whole-body posture carries no timing signal for them. Phase 2 adds the stamp count and timing for Thattadavu.
- **Recording beside YouTube is desktop/tablet only;** phones watch first, then record.
- **The phone camera app may keep its own copy** of a take in the gallery; NrityaVaani can't prevent that and says so.
- **Phase 1 tolerances are first guesses** (beta) until they are re-derived from Phase 2's good takes.
- **Without an age answer, Phase 2 tips stay beta** for everyone, because child takes can't be recognised automatically.
- **One step range per teacher file until Phase 3,** so demonstrations spread across a class need two separate steps.
- **Until `.nvref` (Phase 3), each student prepares the teacher step themselves,** and different trims can give slightly different tips.
- **MediaPipe's knee and depth limits plus costumes** mean leg feedback is often withheld.
- **Pattern cards encode one version.** Other banis get "My version is different" and no pattern tips.
- **Phone processing takes minutes,** although the two-pass scan keeps a 3-min take to about 3–6 min.
- **Start foot is only checked on recorder takes.**
- **Forward lean can't be seen from the front.**
- **Side tips need facts,** so most uploads get side-free tips; the joint is marked with a ring and an arrow instead.
- **Full-body mudras, Namaskaram sequences and Hindi wait for v2.**
- **If the reviewer or recordings slip, fewer Phase 2 templates ship.** Phase 1 still works as a complete tool.
