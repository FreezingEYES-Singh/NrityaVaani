# End-to-end checks for /compare

Phase 1 build step 4 (`../05-mvp.md` §6): the real page, in headless Chromium, on videos of the site's own 3D dancer (the `/learn` lesson player).

## Files

| File | What it does |
|---|---|
| `record-3d-dancer.mjs` | Records the lesson player with Playwright and prints the raw `.webm`, when the clip starts and the 3D canvas box. |
| `crop-3d-dancer.py` | Crops a recording to the 3D view (VP9 WebM, 25 fps). It finds the start itself, because Playwright's page video lags the page by about a second. |
| `make-test-videos.sh` | Rebuilds every test video below from a running site. |
| `run-compare-e2e.mjs` | Drives `/compare`: marks the whole teacher clip, prepares it, analyses the student video, presses Show me and Play both. Prints the result as JSON, and can save a screenshot and the tracks. |

## The test videos

The videos are **not** in the repository; `make-test-videos.sh <dir>` recreates them in a few minutes.

They are WebM because Playwright's Chromium can't play H.264. Real browsers play both, so MP4 from phones works in the app.

| Video | Made from | Use |
|---|---|---|
| `teacher-namaskaram.webm` | "The whole namaskaram", lesson 88.5–104.5 s (16 s) | Teacher, a **movement step** |
| `student-namaskaram-slow-padded.webm` | The same take: 3 s still, then 1.3× slower, then 2 s still | Student |
| `student-namaskaram-mirrored.webm` | The same take, flipped | Student |
| `student-namaskaram-vp8.webm` | The same take as VP8 (the MediaRecorder codec) | Student |
| `teacher-thattadavu.webm` | Thattadavu Adavu 1, lesson ~52–70 s (18 s) | As a teacher: a **posture step**. As a student against the namaskaram teacher: **not found** |

## Run

```bash
cd frontend && npm run build && npx next start -p 3200 &
docs/video-compare/e2e-assets/make-test-videos.sh /tmp/compare-e2e
node docs/video-compare/e2e-assets/run-compare-e2e.mjs \
  /tmp/compare-e2e/teacher-namaskaram.webm /tmp/compare-e2e/student-namaskaram-slow-padded.webm \
  http://localhost:3200 /tmp/result.png /tmp/tracks.json
```

- The page is opened with `?delegate=cpu&debug=1`:
  - `delegate=cpu` forces MediaPipe's CPU delegate (the spec's smoke-test setting);
  - `debug=1` exposes the tracks and the result as `window.__compare`.
- `tracks.json` can be re-analysed in Node: `analyze(tracks.teacher, tracks.student)` from `frontend/src/lib/compare/analyze.ts`.
- Each run takes about 2–3 minutes on 4 CPU cores with SwiftShader.

## Results (2026-10-08, this container, two runs in parallel)

| Teacher | Student | Expected | Got |
|---|---|---|---|
| namaskaram | slow-padded | Found, about 30% slower, few or no tips | See `../05-mvp.md` §6, step 4 |
| namaskaram | mirrored | Found, no left/right words | ″ |
| namaskaram | vp8 | Found, no tips | ″ |
| namaskaram | thattadavu | Not found | ″ |
| thattadavu | thattadavu | Posture step, found, no tips | ″ |

## Notes on this environment

- **Server builds:** stop the old `next-server` process before starting one on a new build. An old server keeps serving the old build's pages, whose chunks are gone, so they fail with 500 errors.
- **Recording:** pressing Play in the lesson player scrolls the page for a moment, so the recorder starts the lesson 2 s early and measures the canvas once the page has settled.
- **CPU contention:** two runs in parallel left one student track at ~6 processed frames per second, even at 0.25× playback. Extraction now falls back to reading frame by frame (15 per second) when 0.25× isn't enough.
