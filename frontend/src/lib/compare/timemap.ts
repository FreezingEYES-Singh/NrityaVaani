/** Student time -> teacher time along a result's smoothed map. Pure TS. */
import type { TimeMapPoint } from "./types.ts";

/** Straight-line beyond the map's ends. */
export function mapTime(map: TimeMapPoint[], s: number): number {
  if (!map.length) return s;
  if (map.length === 1) return map[0].t + (s - map[0].s);
  let i = 0;
  while (i < map.length - 2 && s > map[i + 1].s) i++;
  const a = map[i];
  const b = map[i + 1];
  const k = (b.t - a.t) / Math.max(1e-6, b.s - a.s);
  return a.t + (s - a.s) * k;
}

/** The map's slope at s: teacher seconds per student second. */
export function slopeAt(map: TimeMapPoint[], s: number): number {
  if (map.length < 2) return 1;
  let i = 0;
  while (i < map.length - 2 && s > map[i + 1].s) i++;
  return (map[i + 1].t - map[i].t) / Math.max(1e-6, map[i + 1].s - map[i].s);
}
