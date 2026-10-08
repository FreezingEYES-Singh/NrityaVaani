"use client";

import { Eye, Info, Play } from "lucide-react";
import type { BandLevel, LessonResult } from "@/lib/compare/types";

/**
 * Class mode (analyzeLesson): the steps of the student's dance, each found in the
 * class video, as a timeline of the student's video and a row of steps to pick;
 * then what wasn't found either way.
 */

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const span = ([a, b]: [number, number]) => `${fmt(a)}–${fmt(b)}`;

const RANK: Record<BandLevel, number> = { needs: 3, getting: 2, close: 1, partly: 0, na: 0 };
const LEVEL_TEXT: Record<BandLevel, string> = { needs: "Needs work", getting: "Getting there", close: "Close match", partly: "Partly checked", na: "Not checked" };
const DOT: Record<BandLevel, string> = {
  needs: "bg-primary",
  getting: "bg-amber-500",
  close: "bg-emerald-500",
  partly: "bg-foreground/30",
  na: "bg-foreground/20",
};

function worst(r: LessonResult["steps"][number]["result"]): BandLevel {
  if (!r.found) return "na";
  const levels = (["arms", "legs", "torso", "hands"] as const).map((k) => r.bands[k]?.level).filter((l): l is BandLevel => !!l);
  return levels.reduce<BandLevel>((w, l) => (RANK[l] > RANK[w] ? l : w), "partly");
}

export function LessonNav({
  lesson,
  duration,
  active,
  onSelect,
}: {
  lesson: LessonResult;
  /** Length of the student's video, seconds. */
  duration: number;
  active: number;
  onSelect: (i: number) => void;
}) {
  const n = lesson.steps.length;
  const pos = (t: number) => `${(Math.max(0, Math.min(duration, t)) / Math.max(1e-6, duration)) * 100}%`;
  const width = ([a, b]: [number, number]) => `${(Math.max(0, Math.min(duration, b) - Math.max(0, a)) / Math.max(1e-6, duration)) * 100}%`;
  return (
    <div className="space-y-4" data-testid="lesson-steps">
      <p className="mono text-[10px] uppercase tracking-[0.18em] text-foreground/55">
        {n ? `${n} segment${n > 1 ? "s" : ""} of your performance found in the class` : "No segment of your performance was found in the class"}
      </p>
      {n > 0 && (
        <>
          <div className="relative h-8 overflow-hidden rounded-sm border border-foreground/12 bg-foreground/[0.03]" aria-hidden>
            {lesson.unmatched.map((u, i) => (
              <div
                key={`u${i}`}
                className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgba(127,127,127,0.25)_4px_6px)]"
                style={{ left: pos(u[0]), width: width(u) }}
              />
            ))}
            {lesson.steps.map((s, i) => (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                onClick={() => onSelect(i)}
                className={`mono absolute inset-y-1 grid place-items-center overflow-hidden rounded-[2px] text-[9px] ${
                  i === active ? "bg-primary text-white dark:text-black" : "bg-primary/25 text-foreground/80 hover:bg-primary/40"
                }`}
                style={{ left: pos(s.student[0]), width: width(s.student) }}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {lesson.steps.map((s, i) => {
              const w = worst(s.result);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelect(i)}
                  aria-pressed={i === active}
                  className={`shrink-0 rounded-sm border px-3 py-2 text-left transition-colors ${
                    i === active ? "border-primary bg-primary/[0.07]" : "border-foreground/12 hover:border-primary/50"
                  }`}
                >
                  <span className="mono block text-[10px] uppercase tracking-[0.16em] text-foreground/80">Segment {i + 1}</span>
                  <span className="mono mt-1 block text-[10px] text-foreground/55">
                    You {span(s.student)} · class {span(s.teacher)}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-foreground/70">
                    <span className={`h-1.5 w-1.5 rounded-full ${DOT[w]}`} />
                    {s.result.found ? LEVEL_TEXT[w] : "Not judged"}
                    {s.result.tips.length > 0 && <span className="text-foreground/45">· {s.result.tips.length} tip{s.result.tips.length > 1 ? "s" : ""}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function LessonGaps({
  lesson,
  onWatchClass,
  onWatchYou,
}: {
  lesson: LessonResult;
  onWatchClass: (span: [number, number]) => void;
  onWatchYou: (span: [number, number]) => void;
}) {
  const row = "flex items-center justify-between gap-3 rounded-sm border border-foreground/12 px-3 py-2";
  const btn =
    "mono inline-flex shrink-0 items-center gap-1.5 rounded-full border border-foreground/15 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-foreground/70 hover:border-primary/60 hover:text-primary";
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-2">
        <p className="mono text-[10px] uppercase tracking-[0.18em] text-foreground/45">Your dancing not found in the class</p>
        {lesson.unmatched.length ? (
          lesson.unmatched.map((u, i) => (
            <div key={i} className={row}>
              <span className="mono text-[11px] text-foreground/75">You {span(u)}</span>
              <button type="button" className={btn} onClick={() => onWatchYou(u)}>
                <Play size={11} /> Watch
              </button>
            </div>
          ))
        ) : (
          <p className="text-[0.9rem] text-foreground/55">None: every part of your dancing was found in the class.</p>
        )}
      </div>
      <div className="space-y-2">
        <p className="mono text-[10px] uppercase tracking-[0.18em] text-foreground/45">Class dancing not found in your video</p>
        {lesson.missed.length ? (
          lesson.missed.map((m, i) => (
            <div key={i} className={row}>
              <span className="mono text-[11px] text-foreground/75">Class {span(m)}</span>
              <button type="button" className={btn} onClick={() => onWatchClass(m)}>
                <Eye size={11} /> Watch
              </button>
            </div>
          ))
        ) : (
          <p className="text-[0.9rem] text-foreground/55">None that we could tell apart from what you danced.</p>
        )}
      </div>
      <p className="flex items-start gap-2 text-[0.82rem] leading-snug text-foreground/50 md:col-span-2">
        <Info size={13} className="mt-0.5 shrink-0" />
        Footwork patterns (which foot strikes when) aren&apos;t compared yet, so two steps danced in the same posture, like two Thattadavu
        variations, can be matched to each other&apos;s demonstration, and won&apos;t be listed as missed.
      </p>
    </div>
  );
}
