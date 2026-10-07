# Handoff: session notes for the next Claude session

**Branch:** `claude/blissful-lovelace-305wig`. All work is pushed to it; `main` is untouched, and no PR is open yet.
**Last updated:** 2026-10-07

Read this file first. It covers what was done, how to confirm it, what is still open, and where the new "video compare" feature design stands.

---

## 1. Confirm the current state (copy-paste)

```bash
cd NrityaVaani
git checkout claude/blissful-lovelace-305wig && git pull
git log --oneline -6        # expect the 4 commits listed in §2 on top of cc0b378

# Frontend checks (all should pass)
cd frontend
npm ci
npx tsc --noEmit -p .       # expect: no output, exit 0
npx eslint .                # expect: 0 errors, 3 warnings (react-hooks/set-state-in-effect, intentional)
npm run build               # expect: success, 22 static pages, no /mocap, no /api/critique

# If build/tsc fails with "Cannot find module ... mocap/page.js": a stale generated
# file from an old `next dev` run. Run `npm run dev` once (it regenerates
# .next/dev/types) or delete the .next folder, then build again.

# Run locally
cd .. && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
uvicorn main:app --port 8000 &                 # backend: curl localhost:8000/ -> status online
cd frontend && BACKEND_URL=http://127.0.0.1:8000 NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000 npm run dev
# open http://localhost:3000 ; /mocap should be 404 ; /learn/bharatanatyam/namaskaram plays the 3D dancer
```

---

## 2. What this session did (commits on the branch)

| Commit | What |
|---|---|
| `84698ce` | Added `frontend/AGENTS.md` + `frontend/CLAUDE.md`. Next.js 16 `next dev` auto-generates them, so they are committed to keep the tree clean. |
| `287aba3` | Renamed `src/middleware.ts` to `src/proxy.ts` (Next 16 deprecation; the `/checkout` login redirect still works). Fixed 10 lint warnings. Fixed the mocap 404 and layout (both now moot after the next commit). |
| `1494ea6` | **Removed the `/mocap` page entirely**, plus the code only it used: `api/critique` (the AI review route), `lib/mocap/bakeStore.ts`, and `lib/motion/{clipStore,collide,polish,validate,critic}.ts`. Also removed `calibrateSpread` from MocapFigure, uninstalled `openai` + `@anthropic-ai/sdk`, and removed the footer link and README mentions. `MocapFigure.tsx` is KEPT: it renders the 3D dancer in the `/learn` lesson player. |
| (this commit) | `HANDOFF.md` + `docs/video-compare/*` (feature design research, see §4). |

Verified after each commit: tsc, eslint, `next build`, all 17 routes load with no console errors in headless Chromium, and the lesson player still plays and responds to its camera presets.

---

## 3. Known open items (not done, user not yet asked unless noted)

1. **BUG: practice sessions are never saved** (`frontend/src/app/practice/[slug]/page.tsx`). `isCameraActive` is only ever set to `true` (there's no stop button), and the "Session start & stop persistence" effect saves a session only when the camera goes from active to inactive. So only mastery saves (score ≥92), and the `/practice` and `/dashboard` stats stay at 0. Fix: add a Stop camera button, and save on unmount or when the mudra changes (effect cleanup). Keep the >4 s / ≥1 sample rule, and don't double-save after mastery.
2. **Security:** `frontend/src/proxy.ts` and `src/app/api/auth/[...nextauth]/route.ts` fall back to the hardcoded `"fallback-secret-for-demo"` when `NEXTAUTH_SECRET` is unset. The user should set `NEXTAUTH_SECRET` in Netlify env vars.
3. **404 page:** unknown URLs (including old `/mocap` links) show Next's default 404 in light mode, with nearly invisible navbar links. Add `src/app/not-found.tsx` in the site style.
4. **Optional cleanup:** `MocapFigure.tsx` still has capture-only API methods (`pose`, `resettle`, `snapshot`, `probe`, `capture`, `shiftHand`), and `retarget.ts`/`clip.ts` have ~8 now-unused exports (`despikeTrack`, `smoothTrack`, `stabiliseTrack`, `measureSkeleton`, `enforceSkeleton`, `emptyClip`, `encodeClip`, `clipBytes`). **Do not trim yet**: the video-compare feature (§4) may reuse `pose()` and the track filters. Renaming `MocapFigure` to `LessonFigure` is also optional.
5. **Deploy:** the live site (https://nrityavaani-ai.netlify.app) deploys from `main`. Nothing here is live until the branch is merged.

---

## 4. NEW FEATURE in progress: "video compare" (design only, NO code written)

### The user's request (verbatim)
> now add a page or something so user can either upload video or give youtube link and it will process it and then when process it will show stick on the yt vidoe , then student can upload their video on side to it and then it will detect how student performed and will give him tips to correct or things wrong
> (a complecated part is that not all videos or movement will be necessary or same and diff video lenth and everything so find a solution and make it work which is best and for your solution first thing and counter it yourself and then re think and try to conunter again untill its perfect and tell me solution and then with my agreement and planning then touch code)

**The user explicitly wants: solution → their agreement → plan → only then code.** They have NOT approved anything yet.

### What was done
A multi-agent design run: 4 research agents → 4 competing designs → 3 judges (all picked **"Guru Mirror" `/compare`**) → synthesis → 3 red-team rounds (6 critic lenses each) with revisions. It was stopped before the final round-3 revision to save budget. Outputs are in `docs/video-compare/`:

| File | Contents |
|---|---|
| `01-research-brief.md` | Verified facts with sources: YouTube policy/tech, in-browser MediaPipe limits, alignment algorithms. |
| `02-codebase-reuse-map.md` | Which existing files/functions the feature can reuse. |
| `03-design.md` | The latest design (after 2 red-team rounds). §0 is the short answer, §12 the plan and decisions. **It's very large (P0 week + 6 weeks).** |
| `04-open-issues.md` | Round-3 critic issues NOT yet applied (**5 critical, 24 high**, 30 medium, 5 low), plus how the round 1–2 issues were resolved. |

### Key facts that constrain any design (from 01-research-brief.md)
- **The stick figure can't be drawn on top of the YouTube player.** YouTube API policy forbids overlays in front of the embedded player. Draw it beside the player, or on our own `<video>`.
- **A web page can't read pixels from the YouTube iframe** (it's cross-origin). Server-side download (yt-dlp) breaks the YouTube ToS, gets bot-blocked from Render IPs, and breaks the app's "no video leaves your device" promise. Tab capture (getDisplayMedia/Element Capture) is desktop-Chrome only and conflicts with the policies.
- So YouTube can only be "practise beside it": the player is shown untouched, and the student's take is analysed against a known pattern (e.g. Thattadavu adavu strike patterns from our lesson cues). Real posture comparison needs a reference **video file** (the teacher's own) or a NrityaVaani studio reference.
- Different lengths, tempo, partial takes and repeats: the design aligns footwork on **strike events** (cyclic matching against the reference phrase, with a free start point) rather than raw DTW on poses. It skips talk and holds automatically (`lib/lesson/segment.ts` already detects pauses), and the student trims or picks the step.

### Round-3 critical issues to fix first (details in 04-open-issues.md)
1. The cleaning chain (§2.6) erases short ankle lifts before strike detection, which makes the SNR gate meaningless.
2. and 3. A consistent count error (the most common mistake: dancing the neighbouring adavu's pattern, or stamping on the silent count) gets relabelled "other step / different version", so the count tip never fires.
4. "Per-user scope" for children's takes is meaningless: every demo login is user id "1".

### Recommended next step (for the next session)
1. Read `03-design.md` §0 and §12, and `04-open-issues.md` (critical + high only).
2. **Cut the design down to a small first version** a 4-student team can ship in ~2 weeks. Suggested MVP: `/compare` page; the teacher uploads a video file (no YouTube in v1) and trims one step; the student records or uploads a take; both are processed on-device with MediaPipe PoseLandmarker (recover the bake loop from `git show 287aba3:frontend/src/app/mocap/page.tsx`); skeletons are drawn on both videos side by side; the step is aligned with subsequence DTW on normalized joint angles (mirror auto-detected); 3 rule-based tips on knees/aramandi, arm height and timing, each with a confidence gate. YouTube "practise beside" and the pattern cards come later.
3. Fix the 5 critical issues in whatever survives the cut.
4. **Present the solution + decisions (03-design.md §12) to the user and wait for approval before writing code.**

### Prompt to start the next session
> Read HANDOFF.md and docs/video-compare/ on branch claude/blissful-lovelace-305wig. Continue the video-compare feature design: cut it to a small MVP, fix the round-3 critical issues, then show me the solution and decisions for approval. Do not write feature code until I agree.
