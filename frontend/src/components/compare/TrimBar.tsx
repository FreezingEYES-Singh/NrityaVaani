"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Play, Plus, Square } from "lucide-react";

/**
 * Marking the one step to practise (05-mvp.md §1 step 1, F15): a strip zoomed
 * around the selection, "Start here" / "End here" at the playhead, ±0.5 s
 * nudges and "Play selection". The handles are real sliders, so they work with
 * a keyboard and a screen reader, and on a 50-minute file on a phone.
 */

export const MIN_STEP = 2;
export const MAX_STEP = 60;

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

interface Props {
  video: HTMLVideoElement | null;
  /** The same element, for seeking and playing (props themselves stay read-only). */
  getVideo: () => HTMLVideoElement | null;
  duration: number;
  range: [number, number];
  onChange: (r: [number, number]) => void;
  disabled?: boolean;
}

export default function TrimBar({ video, getVideo, duration, range, onChange, disabled }: Props) {
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    if (!video) return;
    const tick = () => {
      setNow(video.currentTime);
      if (stopAt.current !== null && video.currentTime >= stopAt.current) {
        getVideo()?.pause();
        stopAt.current = null;
      }
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    video.addEventListener("timeupdate", tick);
    video.addEventListener("seeked", tick);
    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    return () => {
      video.removeEventListener("timeupdate", tick);
      video.removeEventListener("seeked", tick);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
    };
  }, [video, getVideo]);

  const [a, b] = range;
  const clampRange = (x: number, y: number): [number, number] => {
    x = Math.max(0, Math.min(x, duration));
    y = Math.max(0, Math.min(y, duration));
    if (y - x < MIN_STEP) y = Math.min(duration, x + MIN_STEP);
    if (y - x < MIN_STEP) x = Math.max(0, y - MIN_STEP);
    if (y - x > MAX_STEP) y = x + MAX_STEP;
    return [x, y];
  };
  // the zoomed strip: the selection plus a margin, at least 20 s wide
  const pad = Math.max(5, (20 - (b - a)) / 2);
  const z0 = Math.max(0, a - pad);
  const z1 = Math.min(duration, b + pad);
  const pos = (t: number) => `${((t - z0) / Math.max(1e-6, z1 - z0)) * 100}%`;

  const playSelection = () => {
    const el = getVideo();
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    el.currentTime = a;
    stopAt.current = b;
    void el.play().catch(() => undefined);
  };

  const btn =
    "mono inline-flex items-center gap-1.5 rounded-full border border-card-border px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-foreground/75 hover:border-primary hover:text-primary disabled:opacity-40";

  return (
    <div className="space-y-3" aria-label="Mark the step">
      <div className="relative h-10 rounded-lg border border-card-border bg-card" aria-hidden>
        <div className="absolute inset-y-0 rounded-md bg-primary/25" style={{ left: pos(a), width: `calc(${pos(b)} - ${pos(a)})` }} />
        {now >= z0 && now <= z1 && <div className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: pos(now) }} />}
        <span className="mono absolute bottom-1 left-2 text-[9px] text-foreground/45">{fmt(z0)}</span>
        <span className="mono absolute bottom-1 right-2 text-[9px] text-foreground/45">{fmt(z1)}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="mono block text-[10px] uppercase tracking-[0.14em] text-foreground/55">
          Start {fmt(a)}
          <input
            type="range"
            className="mt-1 w-full accent-[var(--primary)]"
            min={0}
            max={duration}
            step={0.1}
            value={a}
            disabled={disabled}
            aria-valuetext={fmt(a)}
            onChange={(e) => onChange(clampRange(Number(e.target.value), b))}
          />
        </label>
        <label className="mono block text-[10px] uppercase tracking-[0.14em] text-foreground/55">
          End {fmt(b)}
          <input
            type="range"
            className="mt-1 w-full accent-[var(--primary)]"
            min={0}
            max={duration}
            step={0.1}
            value={b}
            disabled={disabled}
            aria-valuetext={fmt(b)}
            onChange={(e) => onChange(clampRange(a, Number(e.target.value)))}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={disabled} onClick={() => onChange(clampRange(now, Math.max(b, now + MIN_STEP)))}>
          Start here
        </button>
        <button type="button" className={btn} disabled={disabled} onClick={() => onChange(clampRange(Math.min(a, now - MIN_STEP), now))}>
          End here
        </button>
        <button type="button" className={btn} disabled={disabled} aria-label="Start 0.5 s earlier" onClick={() => onChange(clampRange(a - 0.5, b))}>
          <Minus size={12} /> start
        </button>
        <button type="button" className={btn} disabled={disabled} aria-label="Start 0.5 s later" onClick={() => onChange(clampRange(a + 0.5, b))}>
          <Plus size={12} /> start
        </button>
        <button type="button" className={btn} disabled={disabled} aria-label="End 0.5 s earlier" onClick={() => onChange(clampRange(a, b - 0.5))}>
          <Minus size={12} /> end
        </button>
        <button type="button" className={btn} disabled={disabled} aria-label="End 0.5 s later" onClick={() => onChange(clampRange(a, b + 0.5))}>
          <Plus size={12} /> end
        </button>
        <button type="button" className={btn} disabled={disabled} onClick={playSelection}>
          {playing ? <Square size={12} /> : <Play size={12} />} {playing ? "Stop" : "Play selection"}
        </button>
      </div>
      <p className="mono text-[10px] text-foreground/45">
        Selected {fmt(a)}–{fmt(b)} ({(b - a).toFixed(1)} s). One step, {MIN_STEP}–{MAX_STEP} s.
      </p>
    </div>
  );
}
