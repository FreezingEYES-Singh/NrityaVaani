"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Crosshair, Expand, Info, Minus, Play, Plus, Square } from "lucide-react";

/**
 * Marking the part to compare (05-mvp.md §1 step 1, F15): one timeline with a
 * handle for each end, "Start here" / "End here" at the playhead, ±0.5 s
 * nudges, "Play selection" and "Whole video". The handles are real sliders, so
 * they work with a keyboard and a screen reader, and on a 50-minute file on a phone.
 *
 * There's no upper limit: the person decides how long. Past LONG_STEP the note
 * says it will take longer and needs more memory.
 *
 * A video up to VIEW_ALL long is shown whole; a longer one is shown as a
 * window around the selection, which follows it when it nears an edge.
 */

export const MIN_STEP = 2;
/** Longer than this gets the "takes longer" note. */
export const LONG_STEP = 60;

const VIEW_ALL = 180;
const VIEW_MIN = 120;
/** The step length "Set to playhead" falls back to when the other end is in the way. */
const DEFAULT_STEP = 8;

const fmtLen = (t: number) => {
  if (t < 60) return `${t.toFixed(1)} s`;
  const s = Math.round(t);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};

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

function viewAround(duration: number, a: number, b: number): [number, number] {
  if (duration <= VIEW_ALL) return [0, duration];
  const width = Math.min(duration, Math.max(VIEW_MIN, 2 * (b - a) + 20));
  const mid = (a + b) / 2;
  const v0 = Math.max(0, Math.min(duration - width, mid - width / 2));
  return [v0, v0 + width];
}

export default function TrimBar({ video, getVideo, duration, range, onChange, disabled }: Props) {
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<[number, number]>(() => viewAround(duration, range[0], range[1]));
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
  const len = b - a;
  const long = len > LONG_STEP;

  // keep the window still while a handle is dragged; follow the selection otherwise
  // (adjusted during render, React's pattern for state that follows props)
  const [v0, v1] = view;
  if (!dragging) {
    const margin = 0.05 * (v1 - v0);
    const want = viewAround(duration, a, b);
    if ((want[0] !== v0 || want[1] !== v1) && (duration <= VIEW_ALL || a < v0 + margin || b > v1 - margin)) setView(want);
  }

  // moving one end into the other pushes it along, keeping at least MIN_STEP
  const setStart = (x: number) => {
    x = Math.max(0, Math.min(x, duration - MIN_STEP));
    onChange([x, Math.min(duration, Math.max(b, x + MIN_STEP))]);
  };
  const setEnd = (y: number) => {
    y = Math.min(duration, Math.max(y, MIN_STEP));
    onChange([Math.max(0, Math.min(a, y - MIN_STEP)), y]);
  };
  // at the playhead: if the other end is in the way, it moves to make a DEFAULT_STEP step
  const startHere = () => {
    const x = Math.max(0, Math.min(now, duration - MIN_STEP));
    onChange([x, b - x >= MIN_STEP ? b : Math.min(duration, x + DEFAULT_STEP)]);
  };
  const endHere = () => {
    const y = Math.min(duration, Math.max(now, MIN_STEP));
    onChange([y - a >= MIN_STEP ? a : Math.max(0, y - DEFAULT_STEP), y]);
  };

  const frac = (t: number) => Math.max(0, Math.min(1, (t - v0) / Math.max(1e-6, v1 - v0)));
  // a range thumb's centre runs from half a thumb in from each edge
  const pos = (t: number) => `calc(7px + (100% - 14px) * ${frac(t)})`;

  const seekTo = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const el = getVideo();
    const box = e.currentTarget.getBoundingClientRect();
    if (!el || box.width <= 14) return;
    const f = Math.max(0, Math.min(1, (e.clientX - box.left - 7) / (box.width - 14)));
    el.currentTime = v0 + f * (v1 - v0);
  };

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

  const small =
    "mono inline-flex items-center justify-center gap-1.5 rounded-full border border-foreground/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-foreground/70 transition-colors hover:border-primary/60 hover:text-primary disabled:opacity-40";
  const nudge =
    "grid h-7 w-7 place-items-center rounded-full border border-foreground/15 text-foreground/70 transition-colors hover:border-primary/60 hover:text-primary disabled:opacity-40";

  const endField = (which: "start" | "end") => {
    const t = which === "start" ? a : b;
    const set = which === "start" ? setStart : setEnd;
    const name = which === "start" ? "Start" : "End";
    return (
      <div className="rounded-sm border border-foreground/12 bg-foreground/[0.02] p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="mono text-[9px] uppercase tracking-[0.18em] text-foreground/45">{name}</p>
            <p className="mono mt-1 text-base tabular-nums text-foreground">{fmt(t)}</p>
          </div>
          <div className="flex gap-1.5">
            <button type="button" className={nudge} disabled={disabled} aria-label={`${name} 0.5 s earlier`} onClick={() => set(t - 0.5)}>
              <Minus size={12} />
            </button>
            <button type="button" className={nudge} disabled={disabled} aria-label={`${name} 0.5 s later`} onClick={() => set(t + 0.5)}>
              <Plus size={12} />
            </button>
          </div>
        </div>
        <button
          type="button"
          className={`${small} mt-3 w-full`}
          disabled={disabled}
          aria-label={`Set the ${which} to where the video is now`}
          onClick={which === "start" ? startHere : endHere}
        >
          <Crosshair size={12} /> {name} here
        </button>
      </div>
    );
  };

  const sliderProps = {
    min: v0,
    max: v1,
    step: 0.1,
    disabled,
    onPointerDown: () => setDragging(true),
    onPointerUp: () => setDragging(false),
    onPointerCancel: () => setDragging(false),
    onBlur: () => setDragging(false),
  };

  return (
    <div className="space-y-4" role="group" aria-label="Mark the step">
      <div className="flex items-baseline justify-between gap-3">
        <p className="mono text-[10px] uppercase tracking-[0.18em] text-foreground/55">Mark the part to compare</p>
        <p className="mono text-[11px] tabular-nums">
          <span className="text-foreground">{fmtLen(len)}</span>
          <span className="text-foreground/40"> selected</span>
        </p>
      </div>

      <div>
        <div className="relative h-11">
          <div
            className="absolute inset-0 cursor-pointer overflow-hidden rounded-sm border border-foreground/12 bg-foreground/[0.03]"
            onPointerDown={seekTo}
            aria-hidden
          >
            <div
              className="absolute inset-y-0 bg-primary/20"
              style={{ left: pos(a), width: `calc((100% - 14px) * ${frac(b) - frac(a)})` }}
            />
            {now >= v0 && now <= v1 && <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/80" style={{ left: pos(now) }} />}
          </div>
          <input
            type="range"
            className="dual-range absolute inset-0 h-full w-full"
            aria-label="Start of the step"
            aria-valuetext={fmt(a)}
            value={a}
            onChange={(e) => setStart(Number(e.target.value))}
            {...sliderProps}
          />
          <input
            type="range"
            className="dual-range absolute inset-0 h-full w-full"
            aria-label="End of the step"
            aria-valuetext={fmt(b)}
            value={b}
            onChange={(e) => setEnd(Number(e.target.value))}
            {...sliderProps}
          />
        </div>
        <div className="mono mt-1.5 flex justify-between text-[9px] tabular-nums text-foreground/40">
          <span>{fmt(v0)}</span>
          {v1 - v0 < duration && <span>Showing part of a {fmt(duration)} video</span>}
          <span>{fmt(v1)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {endField("start")}
        {endField("end")}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={`${small} py-2`} disabled={disabled} onClick={playSelection}>
          {playing ? <Square size={12} /> : <Play size={12} />} {playing ? "Stop" : "Play selection"}
        </button>
        <button type="button" className={`${small} py-2`} disabled={disabled} onClick={() => onChange([0, duration])}>
          <Expand size={12} /> Whole video
        </button>
      </div>

      <p className={`flex items-start gap-2 text-[0.85rem] leading-snug ${long ? "text-primary" : "text-foreground/50"}`} aria-live="polite">
        <Info size={14} className="mt-0.5 shrink-0" />
        {long
          ? "A long part takes about as long to prepare as it plays, and needs more memory. Fine on a computer; an older phone may struggle."
          : "One step or the whole dance, from 2 s. Play or scrub the video, then set the start and end, or drag the handles."}
      </p>
    </div>
  );
}
