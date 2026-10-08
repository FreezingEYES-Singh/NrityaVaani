# Phase 1 alignment prototype (synthetic test suite)

This is throwaway research code from the design review, **not feature code**. Critic agents wrote it in rounds 4 and 5 to test the Phase 1 rules in `../05-mvp.md` §3.2–3.6 before anything was built.

## Files

| File | What it does |
|---|---|
| `lib.ts` | Synthetic 2D+3D stick-figure model, noise model, sDTW |
| `pipe.ts` | The Phase 1 pipeline (step kind, pauses, sDTW, found tests, tries, partial, posture/hold, phases, tips) |
| `cases.ts` | 105 cases on three synthetic steps at several noise levels: A (no cycle), W (arms only), P (Thattadavu-like) |

## Run

```bash
cd docs/video-compare/prototype
ORDER=fixed SKIPW=-1 node --experimental-strip-types cases.ts     # round-5 fixes G1 + G2 → PASS 88 FAIL 17
ORDER=literal SKIPW=1 node --experimental-strip-types cases.ts    # revision-4 spec as written
```

Other switches: `RHO=0.85` (correlated noise, roughly like MediaPipe smoothing), `SEL=spec` or `SEL=adv` (a subset of cases), `V=1` (verbose).

## Saved results

- `results-with-round5-fixes.txt`: 88/105 pass. It was re-run from this folder and the output was identical.
- `results-spec-as-written.txt`: the revision-4 rules as written.

## Next use

**Phase 1 build step 1** (`../05-mvp.md` §6):
1. Port the logic to typed modules in `frontend/src/lib/compare/`.
2. Implement the round-5 fixes G3–G8.
3. Drive this suite to all passing, or write down each case that is accepted as a known limit.

This suite uses synthetic data only. Real-video checks come in build steps 2–4.
