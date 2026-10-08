"use client";

/**
 * A lesson, played.
 *
 * The other end of `tools/blender/namaskaram.py`: that keys the take against
 * the teaching video, this plays it back. The figure is driven from the clip
 * frame by frame rather than handed to an `AnimationMixer`, because everything
 * else on the page — the step, her words, the scrubber — has to agree with the
 * pose on screen, and the only way to guarantee that is for one clock to drive
 * all four.
 *
 * That clock is the wall clock, not a frame counter, so the lesson runs at the
 * speed it was danced whatever the display is doing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Globe,
  Mic,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { MocapApi } from "@/components/three/MocapFigure";
import type { Sex } from "@/components/three/figureRig";
import { decodeClip, samplePose, type Clip } from "@/lib/motion/clip";
import { DIMS } from "@/lib/motion/poseCodec";
import {
  clipFor,
  lineAt,
  lineText,
  linesIn,
  loadManifest,
  loadVoice,
  readingFor,
  stepAt,
  type Language,
  type LessonManifest,
  type SpokenLine,
  SUPPORTED_LANGUAGES,
} from "@/lib/lesson/manifest";
import {
  getBestPersonaForLanguage,
  getVoiceModelsForLanguage,
  getPersona,
  type GuruPersona,
  type GuruVoiceModelOption,
} from "@/lib/voice/guruPersonas";
import { GuruAudioEngine } from "@/lib/voice/guruAudioEngine";
import { Eyebrow, Rule } from "@/components/ui/editorial";

const MocapFigure = dynamic(() => import("@/components/three/MocapFigure"), {
  ssr: false,
  loading: () => null,
});

const SPEEDS = [0.5, 1] as const;

function clock(t: number) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const chip =
  "mono rounded-full border px-3 py-1.5 sm:px-4 sm:py-2 text-[10px] uppercase tracking-[0.14em] sm:tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";
const chipOn = "border-primary/70 bg-primary/10 text-primary";
const chipOff =
  "border-foreground/20 text-foreground/60 hover:border-primary/50 hover:text-primary";

export default function LessonPlayer({
  slug,
  dance,
  part,
}: {
  slug: string;
  /** The dance this lesson is a part of, which is where "back" goes; null if unknown. */
  dance: { slug: string; name: string } | null;
  /** Its place in that dance's sequence — "Part 1" — or null if it is not published. */
  part: number | null;
}) {
  const backHref = dance ? `/learn/${dance.slug}` : "/learn";

  const [manifest, setManifest] = useState<LessonManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [line, setLine] = useState<SpokenLine | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [loop, setLoop] = useState(false);
  const [sex, setSex] = useState<Sex>("female");
  const [lang, setLang] = useState<Language>("en");
  const [skeleton, setSkeleton] = useState(false);

  // 3D Guru Voice Persona automatically calibrated to the selected language
  const [persona, setPersona] = useState<GuruPersona>(() => getBestPersonaForLanguage("en", "female"));
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showGuruMenu, setShowGuruMenu] = useState(false);
  const [activePreset, setActivePreset] = useState<"full" | "face" | "mudras" | "feet">("full");
  const voiceModels = useMemo(() => getVoiceModelsForLanguage(lang), [lang]);

  // Voice narration — pre-loaded Audio elements, one per spoken line.
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);

  const audioEngineRef = useRef<GuruAudioEngine | null>(null);
  if (!audioEngineRef.current) {
    audioEngineRef.current = new GuruAudioEngine(persona.id, lang, {
      volume,
      muted,
      rate: speed,
      onSpeakingChange: (val) => setIsSpeaking(val),
      onLoadingChange: (val) => setIsLoadingAudio(val),
    });
  }

  useEffect(() => {
    audioEngineRef.current?.setPersona(persona.id);
  }, [persona]);

  useEffect(() => {
    audioEngineRef.current?.setLanguage(lang);
  }, [lang]);

  useEffect(() => {
    audioEngineRef.current?.setVolume(volume);
    audioEngineRef.current?.setMuted(muted);
    audioEngineRef.current?.setRate(speed);
  }, [volume, muted, speed]);

  // The pose on screen changes sixty times a second; the step and her words
  // change eleven and nineteen times in the whole lesson. So the scrubber and
  // the clock are written straight to the DOM, and only the things that
  // genuinely change get to re-render the page.
  const apiRef = useRef<MocapApi | null>(null);
  // Every take the lesson ships, by path — one per figure when it has them.
  const clipsRef = useRef(new Map<string, Clip>());
  const manRef = useRef<LessonManifest | null>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const stepRef = useRef(0);
  // The showing line's start time, which identifies it; -1 while she is silent.
  const lineRef = useRef(-1);
  // Scratch for the interpolated pose, reused every frame.
  const poseRef = useRef(new Float32Array(DIMS));

  const rafRef = useRef(0);
  const tRef = useRef(0);
  const originRef = useRef(0);
  const startedRef = useRef(0);
  const speedRef = useRef(1);
  const loopRef = useRef(false);
  const sexRef = useRef<Sex>("female");
  const langRef = useRef<Language>("en");
  speedRef.current = speed;
  loopRef.current = loop;
  sexRef.current = sex;
  langRef.current = lang;

  const volumeRef = useRef(0.8);
  const mutedRef = useRef(false);
  // Active line tracker to eliminate 60fps object allocations and enable 0ms fast-path
  const activeLineTrackRef = useRef<{ start: number; lang: Language } | null>(null);
  volumeRef.current = volume;
  mutedRef.current = muted;

  /** Puts the figure, the scrubber, the step and the caption at `t`. */
  const applyTime = useCallback((t: number) => {
    const man = manRef.current;
    // The take for the figure on screen, read each time so a swap mid-lesson
    // picks up that figure's own clip on the very next pose.
    const clip = man && clipsRef.current.get(clipFor(man, sexRef.current));
    if (!clip || !man) return;
    tRef.current = t;

    // Slerped, not the nearest stored frame: the clip is kept at 15 fps on the
    // understanding that playback fills in between.
    apiRef.current?.show(samplePose(clip, t, poseRef.current));

    if (scrubRef.current) scrubRef.current.value = String(t);
    if (clockRef.current) clockRef.current.textContent = clock(t);

    const s = stepAt(man.steps, t);
    if (s !== stepRef.current) {
      stepRef.current = s;
      setStep(s);
    }
    const l = lineAt(man.lines, t);
    const id = l?.start ?? -1;
    if (id !== lineRef.current) {
      lineRef.current = id;
      setLine(l);
    }
  }, []);

  /** Retire whatever line is speaking. */
  const stopVoice = useCallback(() => {
    activeLineTrackRef.current = null;
    audioEngineRef.current?.stop();
    setIsSpeaking(false);
    setIsLoadingAudio(false);
  }, []);

  /**
   * Keep the narration on the clock.
   * Single-source audio via GuruAudioEngine: prevents double voice playback, cracking, and dropped frames.
   */
  const syncVoice = useCallback(
    (t: number) => {
      const man = manRef.current;
      if (!man) return;

      const l = lineAt(man.lines, t);
      if (!l) {
        if (activeLineTrackRef.current) stopVoice();
        return;
      }

      // Fast path: Zero allocations and 0ms cost when continuing the active line
      if (
        activeLineTrackRef.current &&
        activeLineTrackRef.current.start === l.start &&
        activeLineTrackRef.current.lang === langRef.current
      ) {
        return;
      }

      activeLineTrackRef.current = {
        start: l.start,
        lang: langRef.current,
      };

      const textToSpeak = lineText(l, langRef.current);
      const lineDuration = l.end - l.start;

      // Delegate all playback lifecycle exclusively to Goonj GuruAudioEngine
      void audioEngineRef.current?.syncLine(
        l.start,
        lineDuration,
        textToSpeak,
        t
      );
    },
    [stopVoice],
  );

  const tick = useCallback(() => {
    const man = manRef.current;
    if (!man) return;
    let t =
      originRef.current +
      ((performance.now() - startedRef.current) / 1000) * speedRef.current;

    // Looping a step is how a step is learnt — the whole reason to sit with one
    // of these. The current step is read fresh each frame, so turning the loop
    // on mid-step catches the step you are actually watching.
    const s = man.steps[stepRef.current];
    const end = loopRef.current && s ? s.end : man.duration;
    const back = loopRef.current && s ? s.start : 0;
    if (t >= end) {
      t = back;
      originRef.current = back;
      startedRef.current = performance.now();
    }

    applyTime(t);
    syncVoice(t);
    rafRef.current = requestAnimationFrame(tick);
  }, [applyTime, syncVoice]);

  const play = useCallback(() => {
    if (!manRef.current) return;
    cancelAnimationFrame(rafRef.current);
    const duration = manRef.current?.duration ?? 0;
    originRef.current = tRef.current >= duration - 0.05 ? 0 : tRef.current;
    startedRef.current = performance.now();
    setPlaying(true);
    // Start the narration inside the click, so the browser's autoplay rules
    // are satisfied by a real gesture rather than a timer a frame later.
    syncVoice(originRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick, syncVoice]);

  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setPlaying(false);
    stopVoice();
  }, [stopVoice]);

  /** Move the playhead without disturbing whether it is running. */
  const seek = useCallback(
    (t: number) => {
      applyTime(t);
      originRef.current = t;
      startedRef.current = performance.now();
      // Silence the narration until the next frame re-syncs it (or until Play,
      // if it was paused) — the figure and her voice should not disagree.
      stopVoice();
    },
    [applyTime, stopVoice],
  );

  const handleSelectLanguage = useCallback((newLang: Language) => {
    setLang(newLang);
    langRef.current = newLang;
    const best = getBestPersonaForLanguage(newLang, sexRef.current);
    setPersona(best);
    setShowLangMenu(false);
    const man = manRef.current;
    if (man) {
      audioEngineRef.current?.preloadLanguage(man.lines);
      const curLine = lineAt(man.lines, tRef.current);
      if (curLine) {
        seek(curLine.start);
      }
    }
  }, [seek]);

  const handleSelectVoiceModel = useCallback((model: GuruVoiceModelOption) => {
    const p = getPersona(model.id);
    setPersona(p);
    if (model.sex !== sexRef.current) {
      setSex(model.sex);
      sexRef.current = model.sex;
    }
    setShowGuruMenu(false);
    const man = manRef.current;
    if (man) {
      audioEngineRef.current?.preloadLanguage(man.lines);
      const curLine = lineAt(man.lines, tRef.current);
      if (curLine) {
        seek(curLine.start);
      }
    }
  }, [seek]);

  // Load the lesson and its clips together — neither is any use alone.
  useEffect(() => {
    const abort = new AbortController();
    let dead = false;
    (async () => {
      try {
        const man = await loadManifest(slug, abort.signal);
        // Every figure's take up front, so swapping the figure mid-lesson never
        // leaves the new body waiting on the network in the other one's pose.
        // All the downloads start at once; they are only read back in turn.
        const paths = [...new Set([man.clip, ...Object.values(man.clips ?? {})])].filter(
          (p): p is string => !!p,
        );
        const pending = paths.map((path) => fetch(path, { signal: abort.signal }));
        // Awaiting one still throws; this only stops a later one that fails
        // while an earlier one is being read from surfacing as uncaught.
        pending.forEach((p) => p.catch(() => {}));
        const clips = new Map<string, Clip>();
        for (let i = 0; i < paths.length; i++) {
          const res = await pending[i];
          if (!res.ok) throw new Error(`Lesson clip missing (${res.status})`);
          clips.set(paths[i], await decodeClip(await res.blob()));
        }

        if (dead) return;
        manRef.current = man;
        clipsRef.current = clips;
        audioEngineRef.current?.preloadLanguage(man.lines);
        setManifest(man);
      } catch (err) {
        if (dead || abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      dead = true;
      abort.abort();
      cancelAnimationFrame(rafRef.current);
    };
  }, [slug]);

  // Two moments need the figure re-posed without the clock having moved: when
  // the clip and the model have both arrived, so the page opens on the first
  // pose rather than an empty stage; and after a figure swap, which builds a
  // fresh body at rest and does not call `onReady` again — so nothing else
  // would put the new figure back where the playhead is, in its own take.
  useEffect(() => {
    if (ready && manifest) applyTime(tRef.current);
  }, [sex, ready, manifest, applyTime]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      audioEngineRef.current?.stop();
    },
    [],
  );

  // Space to play, arrows to scrub, the way any player behaves. Skipped while a
  // control has focus, so the keys keep their normal meaning there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|BUTTON|SELECT)$/.test(el.tagName)) return;
      const man = manRef.current;
      if (!man) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (playing) pause();
        else play();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seek(Math.max(0, tRef.current - 2));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seek(Math.min(man.duration, tRef.current + 2));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, play, pause, seek]);

  if (error) {
    return (
      <div className="min-h-screen px-6 pt-40 pb-32">
        <div className="mx-auto max-w-md">
          <Eyebrow>not found</Eyebrow>
          <h1 className="serif mt-4 text-[2rem] leading-tight">
            That lesson isn&rsquo;t here.
          </h1>
          <p className="serif mt-3 text-[1rem] leading-[1.6] text-foreground/60">
            {error}
          </p>
          <Link
            href={backHref}
            className="mono mt-8 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to {dance?.name ?? "all dances"}
          </Link>
        </div>
      </div>
    );
  }

  const current = manifest?.steps[step];

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden px-3 pt-18 pb-20 sm:px-6 sm:pt-32 sm:pb-24">
      <div className="mx-auto w-full max-w-6xl min-w-0">
        {/* Navigation Breadcrumb / Top Bar */}
        <div className="flex items-center justify-between gap-2">
          <Link
            href={backHref}
            className="mono inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-foreground/50 transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {dance?.name ?? "All dances"}
          </Link>
          {dance && part && (
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-primary sm:hidden">
              {dance.name} · Part {part}
            </span>
          )}
        </div>

        {/* Desktop Header: shown on sm+ screens */}
        <div className="hidden sm:block mt-8">
          <Eyebrow tone="primary">
            {dance && part ? `${dance.name} · Part ${part}` : "lesson"}
          </Eyebrow>
          <h1 className="serif mt-3 text-[2.4rem] leading-[1.05] sm:text-[3rem]">
            {manifest?.title ?? " "}
          </h1>
          <p className="serif mt-2 text-[1.05rem] leading-[1.6] text-foreground/60">
            {manifest?.subtitle ?? "Loading the take…"}
          </p>
        </div>

        <Rule className="hidden sm:block mt-8" />

        <div className="mt-3 sm:mt-8 grid w-full min-w-0 gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="w-full min-w-0">
            {/* 3D Studio Canvas: Portrait almost full screen on mobile (h-[68vh] sm:h-auto sm:aspect-video) */}
            <div className="relative h-[68vh] sm:h-auto sm:aspect-video w-full min-w-0 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
              <MocapFigure
                sex={sex}
                showBody
                showSkeleton={skeleton}
                showOverlayControls={false}
                className="h-full w-full"
                onReady={(api) => {
                  apiRef.current = api;
                  setReady(true);
                }}
              />
              {/* Step label on canvas */}
              {current && (
                <div className="pointer-events-none absolute top-3 left-3 sm:top-4 sm:left-4 z-10">
                  <p className="mono text-[10px] uppercase tracking-[0.22em] text-primary">
                    Step {step + 1} of {manifest?.steps.length}
                  </p>
                  <p className="serif mt-0.5 sm:mt-1 text-[1.05rem] sm:text-[1.15rem] leading-tight text-foreground/90">
                    {current.name}
                  </p>
                </div>
              )}
              {/* Guru Voice Persona & Live Speaking / Loading indicator */}
              <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 flex items-center gap-2 pointer-events-auto">
                {isLoadingAudio && (
                  <div className="flex items-center gap-1.5 rounded-full bg-primary/20 backdrop-blur-md px-2.5 py-1 border border-primary/40 shadow-sm animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-primary animate-ping"></span>
                    <span className="mono text-[9px] uppercase tracking-[0.16em] text-primary font-semibold">
                      Generating Voice...
                    </span>
                  </div>
                )}
                {isSpeaking && !isLoadingAudio && (
                  <div className="flex items-center gap-1.5 rounded-full bg-primary/25 backdrop-blur-md px-2.5 py-1 border border-primary/50 shadow-md animate-pulse">
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                    <span className="mono text-[9px] uppercase tracking-[0.16em] text-primary font-semibold">
                      {persona.name} Speaking
                    </span>
                  </div>
                )}
                <div
                  className="mono inline-flex items-center gap-1.5 rounded-full bg-background/85 backdrop-blur-md px-3 py-1 border border-foreground/20 text-[10px] uppercase tracking-[0.14em] text-foreground/90 shadow-md"
                  title={`Instruction Language: ${SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.native ?? "English"} (${persona.name})`}
                >
                  <Globe className="h-3 w-3 text-primary" />
                  <span>{SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.native ?? "English"}</span>
                  <span className="opacity-40">·</span>
                  <span className="text-primary font-medium">{persona.name}</span>
                </div>
              </div>
              {!manifest && (
                <div className="mono absolute inset-0 grid place-items-center text-[11px] uppercase tracking-[0.16em] text-foreground/40">
                  Loading the lesson&hellip;
                </div>
              )}
            </div>

            {/* Mobile Header: below 3D studio on phone devices */}
            <div className="sm:hidden mt-4 min-w-0">
              <Eyebrow tone="primary">
                {dance && part ? `${dance.name} · Part ${part}` : "lesson"}
              </Eyebrow>
              <h1 className="serif mt-1 text-[1.85rem] leading-[1.1] break-words">
                {manifest?.title ?? " "}
              </h1>
              <p className="serif mt-1 text-[0.95rem] leading-[1.5] text-foreground/60 break-words">
                {manifest?.subtitle ?? "Loading the take…"}
              </p>
            </div>

            {/* Her words narration */}
            <p className="serif mt-3 sm:mt-4 min-h-[3rem] text-[0.95rem] sm:text-[1.05rem] leading-[1.55] text-foreground/80 break-words">
              {line ? lineText(line, lang) : ""}
            </p>

            {/* Player controls */}
            <div className="mt-2 w-full min-w-0 rounded-2xl border border-card-border bg-card p-3 sm:p-4 shadow-sm">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
                {/* Row 1 on mobile: Play Button + mobile quick chips */}
                <div className="flex items-center justify-between sm:justify-start gap-3">
                  <button
                    type="button"
                    onClick={() => (playing ? pause() : play())}
                    disabled={!manifest || !ready}
                    aria-label={playing ? "Pause" : "Play"}
                    className="grid h-12 w-12 sm:h-11 sm:w-11 shrink-0 place-items-center rounded-full bg-primary text-black shadow-md transition-transform active:scale-95 hover:opacity-85 disabled:opacity-30"
                  >
                    {playing ? (
                      <Pause className="h-5 w-5 sm:h-4 sm:w-4" />
                    ) : (
                      <Play className="ml-0.5 h-5 w-5 sm:h-4 sm:w-4" />
                    )}
                  </button>

                  <div className="flex sm:hidden items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => seek(current?.start ?? 0)}
                      className={`${chip} ${chipOff}`}
                      title="Restart current step"
                    >
                      <RotateCcw className="mr-1 inline h-3 w-3" />
                      Restart
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoop((v) => !v)}
                      aria-pressed={loop}
                      className={`${chip} ${loop ? chipOn : chipOff}`}
                      title="Loop step"
                    >
                      <Repeat className="mr-1 inline h-3 w-3" />
                      Loop
                    </button>
                  </div>
                </div>

                {/* Scrubber slider: ON ITS OWN NEXT LINE on mobile for full width! */}
                <div className="flex flex-1 items-center gap-2 w-full min-w-0">
                  <span
                    ref={clockRef}
                    className="mono w-9 shrink-0 text-[11px] text-foreground/60"
                  >
                    0:00
                  </span>

                  <div className="relative flex-1 min-w-0">
                    <input
                      ref={scrubRef}
                      type="range"
                      min={0}
                      max={manifest?.duration ?? 1}
                      step={0.01}
                      defaultValue={0}
                      disabled={!manifest}
                      aria-label="Position in the lesson"
                      onChange={(e) => seek(Number(e.target.value))}
                      className="w-full h-2 accent-primary cursor-pointer"
                    />
                    {/* Where one step becomes the next. */}
                    {manifest?.steps.slice(1).map((s) => (
                      <span
                        key={s.start}
                        aria-hidden
                        className="pointer-events-none absolute top-0 h-2 w-px bg-foreground/30"
                        style={{ left: `${(s.start / manifest.duration) * 100}%` }}
                      />
                    ))}
                  </div>

                  <span className="mono w-9 shrink-0 text-right text-[11px] text-foreground/40">
                    {clock(manifest?.duration ?? 0)}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1.5 sm:gap-2">
                {/* 1. Camera View Framing Controls (repositioned cleanly outside 3D learning canvas) */}
                <div className="flex items-center gap-1 rounded-full border border-foreground/15 bg-background/50 p-0.5">
                  <span className="mono text-[9px] uppercase tracking-[0.14em] text-foreground/50 px-2 select-none">
                    View:
                  </span>
                  {(["full", "face", "mudras", "feet"] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setActivePreset(preset);
                        apiRef.current?.focusPreset(preset);
                      }}
                      className={`rounded-full px-2.5 py-1 text-[10px] uppercase font-mono tracking-wider transition-colors ${
                        activePreset === preset
                          ? "bg-primary text-black font-semibold shadow-sm"
                          : "text-foreground/70 hover:bg-white/10 hover:text-foreground"
                      }`}
                      title={
                        preset === "full"
                          ? "Full body framing"
                          : preset === "face"
                          ? "Zoom to face & abhinaya"
                          : preset === "mudras"
                          ? "Zoom to hands & mudras"
                          : "Zoom to feet & footwork"
                      }
                    >
                      {preset === "full" && "Full"}
                      {preset === "face" && "Face"}
                      {preset === "mudras" && "Mudras"}
                      {preset === "feet" && "Feet"}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setActivePreset("full");
                      apiRef.current?.fitToScreen();
                    }}
                    className="rounded-full px-2 py-1 text-[10px] uppercase font-mono tracking-wider text-amber-400 hover:bg-amber-400/10 hover:text-amber-300 transition-colors inline-flex items-center gap-1"
                    title="Reset 3D camera to front view (Fit to screen)"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    <span>Fit</span>
                  </button>
                </div>

                <span aria-hidden className="mx-1 h-4 w-px bg-foreground/15" />

                {/* 2. Playback & Speeds */}
                <button
                  type="button"
                  onClick={() => seek(current?.start ?? 0)}
                  className={`${chip} ${chipOff}`}
                >
                  <RotateCcw className="mr-1.5 inline h-3 w-3" />
                  Restart step
                </button>
                <button
                  type="button"
                  onClick={() => setLoop((v) => !v)}
                  aria-pressed={loop}
                  className={`${chip} ${loop ? chipOn : chipOff}`}
                >
                  <Repeat className="mr-1.5 inline h-3 w-3" />
                  Loop step
                </button>
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    aria-pressed={speed === s}
                    className={`${chip} ${speed === s ? chipOn : chipOff}`}
                  >
                    {s}&times;
                  </button>
                ))}

                <span aria-hidden className="mx-1 h-4 w-px bg-foreground/15" />

                {/* 3. Multi-Language Dropdown Selector */}
                <div className="relative inline-block">
                  <button
                    type="button"
                    onClick={() => {
                      setShowLangMenu((v) => !v);
                      setShowGuruMenu(false);
                    }}
                    className={`${chip} ${lang !== "en" ? chipOn : chipOff} inline-flex items-center gap-1.5`}
                    title="Change Guru Language & Vernacular"
                  >
                    <Globe className="h-3 w-3 text-primary" />
                    <span>{SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.native ?? "English"}</span>
                    <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
                  </button>

                  {showLangMenu && (
                    <div className="absolute left-0 bottom-full mb-2 z-50 w-64 max-h-72 overflow-y-auto rounded-xl border border-card-border bg-card/95 backdrop-blur-md p-1.5 shadow-xl">
                      <p className="mono px-2 py-1 text-[9px] uppercase tracking-[0.18em] text-foreground/40 border-b border-foreground/10 mb-1">
                        Select Language (भाषा)
                      </p>
                      {SUPPORTED_LANGUAGES.map((l) => (
                        <button
                          key={l.code}
                          type="button"
                          onClick={() => handleSelectLanguage(l.code)}
                          className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                            lang === l.code
                              ? "bg-primary/15 text-primary font-medium"
                              : "text-foreground/75 hover:bg-foreground/5 hover:text-foreground"
                          }`}
                        >
                          <div>
                            <div className="font-medium leading-tight">{l.native}</div>
                            <div className="mono text-[9px] text-foreground/50">{l.label} · {l.region}</div>
                          </div>
                          {lang === l.code && <Check className="h-3.5 w-3.5 text-primary" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 4. Guru Voice Model Dropdown Selector (with specific strengths and best-for guidance) */}
                <div className="relative inline-block">
                  <button
                    type="button"
                    onClick={() => {
                      setShowGuruMenu((v) => !v);
                      setShowLangMenu(false);
                    }}
                    className={`${chip} ${showGuruMenu ? chipOn : chipOff} inline-flex items-center gap-1.5`}
                    title="Select Guru Voice Model for this language"
                  >
                    <Mic className="h-3 w-3 text-primary shrink-0" />
                    <span className="font-medium">{persona.name}</span>
                    <span className="hidden sm:inline opacity-60 text-[9px]">({persona.badge})</span>
                    <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
                  </button>

                  {showGuruMenu && (
                    <div className="absolute left-0 bottom-full mb-2 z-50 w-72 sm:w-84 max-h-80 overflow-y-auto rounded-xl border border-card-border bg-card/95 backdrop-blur-md p-2 shadow-2xl">
                      <div className="px-2 py-1 border-b border-foreground/10 mb-1.5 flex items-center justify-between">
                        <p className="mono text-[9px] uppercase tracking-[0.18em] text-foreground/50">
                          Guru Voice Models ({voiceModels.length})
                        </p>
                        <span className="mono text-[8px] uppercase tracking-wider text-primary font-medium">
                          {SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.label ?? lang}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {voiceModels.map((vm) => {
                          const isSelected = persona.id === vm.id;
                          return (
                            <button
                              key={vm.id}
                              type="button"
                              onClick={() => handleSelectVoiceModel(vm)}
                              className={`w-full flex flex-col items-start rounded-lg p-2 text-left transition-colors ${
                                isSelected
                                  ? "bg-primary/15 border border-primary/40 shadow-sm"
                                  : "text-foreground/80 hover:bg-foreground/5 hover:text-foreground border border-transparent"
                              }`}
                            >
                              <div className="w-full flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-xs font-semibold ${isSelected ? "text-primary" : "text-foreground"}`}>
                                    {vm.name}
                                  </span>
                                  <span className="mono text-[9px] px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground/70">
                                    {vm.badge}
                                  </span>
                                  <span className="mono text-[9px] text-foreground/50">
                                    {vm.sex === "female" ? "♀" : "♂"}
                                  </span>
                                </div>
                                {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                              </div>
                              <p className="text-[11px] leading-tight text-foreground/80 mt-1">
                                <span className="text-primary font-medium">Best for: </span>
                                {vm.bestFor}
                              </p>
                              <p className="text-[10px] text-foreground/50 leading-tight mt-0.5 italic">
                                {vm.tone}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <span aria-hidden className="mx-1 h-4 w-px bg-foreground/15" />

                {/* 5. Figure Sex & Display toggles */}
                {(["female", "male"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSex(s);
                      sexRef.current = s;
                      const best = getBestPersonaForLanguage(langRef.current, s);
                      setPersona(best);

                      const man = manRef.current;
                      if (man) {
                        const curLine = lineAt(man.lines, tRef.current);
                        if (curLine) {
                          seek(curLine.start);
                        }
                      }
                    }}
                    aria-pressed={sex === s}
                    className={`${chip} ${sex === s ? chipOn : chipOff}`}
                  >
                    {s === "female" ? "Woman" : "Man"}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSkeleton((v) => !v)}
                  aria-pressed={skeleton}
                  className={`${chip} ${skeleton ? chipOn : chipOff}`}
                >
                  Bones
                </button>

                <span aria-hidden className="mx-1 h-4 w-px bg-foreground/15" />

                {/* 6. Voice Narration Mute & Volume */}
                <button
                  type="button"
                  onClick={() => setMuted((v) => !v)}
                  disabled={!manifest?.voice}
                  aria-pressed={muted}
                  aria-label={muted ? "Unmute narration" : "Mute narration"}
                  className={`${chip} ${muted ? chipOn : chipOff} disabled:opacity-40`}
                >
                  {muted ? (
                    <VolumeX className="mr-1.5 inline h-3 w-3" />
                  ) : (
                    <Volume2 className="mr-1.5 inline h-3 w-3" />
                  )}
                  {muted ? "Muted" : "Voice"}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  disabled={!manifest?.voice}
                  aria-label="Narration volume"
                  title="Narration volume"
                  className="h-1 w-24 cursor-pointer accent-primary disabled:opacity-40"
                />
              </div>
            </div>
          </div>

          <aside>
            <Eyebrow>the steps</Eyebrow>
            <ol className="mt-4 space-y-1">
              {manifest?.steps.map((s, i) => (
                <li key={s.start}>
                  <button
                    type="button"
                    onClick={() => seek(s.start)}
                    aria-current={i === step ? "step" : undefined}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      i === step ? "bg-primary/10" : "hover:bg-foreground/5"
                    }`}
                  >
                    <span className="flex items-baseline gap-2">
                      <span
                        className={`mono text-[10px] tabular-nums ${
                          i === step ? "text-primary" : "text-foreground/35"
                        }`}
                      >
                        {clock(s.start)}
                      </span>
                      <span
                        className={`serif text-[0.98rem] leading-tight ${
                          i === step ? "text-foreground" : "text-foreground/65"
                        }`}
                      >
                        {s.name}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            {current && (
              <div className="mt-6 rounded-2xl border border-card-border bg-card p-4">
                <Eyebrow tone="primary">{current.name}</Eyebrow>
                <p className="serif mt-2 text-[0.98rem] leading-[1.55] text-foreground/70">
                  {current.gloss}
                </p>
                <Rule className="my-3" />
                <ul className="space-y-2">
                  {current.cues.map((cue) => (
                    <li
                      key={cue}
                      className="serif flex gap-2 text-[0.95rem] leading-[1.5] text-foreground/75"
                    >
                      <span
                        aria-hidden
                        className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-primary"
                      />
                      {cue}
                    </li>
                  ))}
                </ul>

                {/* Everything she says during this step, readable while the
                    clip is stopped. The caption under the figure only shows
                    the line for the instant you are on, which is no use when
                    you want to know what a step is about before playing it. */}
                {manifest && (
                  <>
                    <Rule className="my-3" />
                    <Eyebrow>in her words</Eyebrow>
                    <ul className="mt-2 space-y-1">
                      {linesIn(manifest.lines, current).map((l) => (
                        <li key={l.start}>
                          <button
                            type="button"
                            onClick={() => seek(l.start)}
                            className={`serif w-full rounded-md px-2 py-1 text-left text-[0.92rem] leading-[1.45] transition-colors ${
                              l.start === line?.start
                                ? "bg-primary/10 text-foreground"
                                : "text-foreground/55 hover:bg-foreground/5 hover:text-foreground/80"
                            }`}
                          >
                            {lineText(l, lang)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
