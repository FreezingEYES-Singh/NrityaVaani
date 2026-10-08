/**
 * Browser-only: suggest the moving part of a teacher video around the
 * playhead (05-mvp.md §1 step 1, F10), from tiny greyscale frame differences.
 * Cheap enough to run before the pose model is even loaded.
 */

const W = 64;
const H = 36;
const STEP = 0.25; // seconds between samples
const REACH = 15; // seconds either side of the playhead

/** Mean absolute grey change between consecutive samples, per sample time. */
async function scan(video: HTMLVideoElement, from: number, to: number, signal?: AbortSignal): Promise<{ t: number; d: number }[]> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  let prev: Uint8ClampedArray | null = null;
  const out: { t: number; d: number }[] = [];
  for (let t = from; t <= to; t += STEP) {
    if (signal?.aborted) break;
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 1500);
      video.addEventListener(
        "seeked",
        () => {
          clearTimeout(timer);
          resolve(true);
        },
        { once: true },
      );
      video.currentTime = t;
    });
    if (!ok) continue;
    ctx.drawImage(video, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    if (prev) {
      let s = 0;
      for (let i = 0; i < px.length; i += 4) s += Math.abs(px[i] + px[i + 1] + px[i + 2] - prev[i] - prev[i + 1] - prev[i + 2]);
      out.push({ t, d: s / (W * H * 3) });
    }
    prev = px;
  }
  return out;
}

/**
 * The moving run (2–12 s) nearest the playhead, or null when the area is still.
 * Leaves the video paused at the playhead.
 */
export async function suggestMovingPart(video: HTMLVideoElement, at: number, signal?: AbortSignal): Promise<[number, number] | null> {
  const dur = video.duration;
  if (!Number.isFinite(dur) || dur <= 0) return null;
  video.pause();
  const from = Math.max(0, at - REACH);
  const to = Math.min(dur, at + REACH);
  const s = await scan(video, from, to, signal);
  video.currentTime = at;
  if (s.length < 8) return null;
  const sorted = s.map((x) => x.d).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)];
  const peak = sorted[Math.floor(sorted.length * 0.9)];
  if (peak - floor < 0.5) return null; // nothing moves
  const thr = floor + 0.25 * (peak - floor);
  // runs of motion, joined across gaps up to 0.75 s (a dancer's short holds)
  const runs: [number, number][] = [];
  let a = -1;
  let lastHit = -1;
  s.forEach((x, i) => {
    if (x.d >= thr) {
      if (a < 0) a = i;
      lastHit = i;
    } else if (a >= 0 && (i - lastHit) * STEP > 0.75) {
      runs.push([a, lastHit]);
      a = -1;
    }
  });
  if (a >= 0) runs.push([a, lastHit]);
  if (!runs.length) return null;
  const toSec = ([i, j]: [number, number]): [number, number] => [s[i].t - STEP, s[j].t];
  const dist = ([x, y]: [number, number]) => (at < x ? x - at : at > y ? at - y : 0);
  const best = runs.map(toSec).sort((p, q) => dist(p) - dist(q))[0];
  let [x, y] = best;
  if (y - x < 2) {
    const c = (x + y) / 2;
    x = c - 1;
    y = c + 1;
  }
  if (y - x > 12) {
    // keep the 12 s around the playhead
    const c = Math.min(Math.max(at, x + 6), y - 6);
    x = c - 6;
    y = c + 6;
  }
  return [Math.max(0, x), Math.min(dur, y)];
}

/** Share of the range that is still (for the "mostly still" warning before processing). */
export async function stillShare(video: HTMLVideoElement, range: [number, number], signal?: AbortSignal): Promise<number> {
  const s = await scan(video, range[0], range[1], signal);
  if (s.length < 4) return 0;
  const sorted = s.map((x) => x.d).sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.9)];
  return s.filter((x) => x.d < Math.max(0.5, 0.15 * peak)).length / s.length;
}
