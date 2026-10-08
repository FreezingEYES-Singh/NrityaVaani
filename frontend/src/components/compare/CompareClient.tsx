"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  Download,
  Info,
  Loader2,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Save,
  ScanLine,
  Scissors,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Upload,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import VideoPanel, { type VideoPanelHandle } from "@/components/compare/VideoPanel";
import TrimBar, { LONG_STEP, MIN_STEP } from "@/components/compare/TrimBar";
import DropZone from "@/components/compare/DropZone";
import YouTubeCapture from "@/components/compare/YouTubeCapture";
import Results from "@/components/compare/Results";
import { LessonGaps, LessonNav } from "@/components/compare/LessonSteps";
import { Eyebrow, Headline, Rule } from "@/components/ui/editorial";
import {
  ALL_PARTS_ON,
  ExtractError,
  type CompareResult,
  type ExtractProgress,
  type LessonResult,
  type PartSwitches,
  type PoseTrack,
  type Tip,
} from "@/lib/compare/types";
import { MODEL_DOWNLOAD_MB, extractPose, preloadModels, primeVideo } from "@/lib/compare/extract";
import { suggestMovingPart } from "@/lib/compare/motionScan";
import { runAnalysis, runLesson, stopAnalysisWorker } from "@/lib/compare/runAnalysis";
import { recordElement, resolveDuration } from "@/lib/compare/tabRecord";
import { mapTime, slopeAt } from "@/lib/compare/timemap";
import {
  deleteSavedSteps,
  fingerprint,
  forgetSessionStep,
  loadTeacherStep,
  rememberSessionStep,
  saveTeacherStep,
  sessionStepKey,
  sweepSessionSteps,
} from "@/lib/compare/store";

/**
 * /compare: "Compare with teacher" (docs/video-compare/05-mvp.md, Phase 1).
 *
 * 1. The teacher's video: mark one step, find the body in every frame on this device.
 * 2. Your video: choose one, or record with the phone's own camera.
 * 3. The result: both videos side by side, up to three corrections, Show me.
 *
 * Videos are only ever object URLs in this tab. Nothing is uploaded, and
 * everything is released when the page is left or hidden for good.
 */

type Busy = null | { who: "teacher" | "student" | "analysis" | "suggest"; p: ExtractProgress | null };

const fmtEta = (s: number | null) => (s === null ? "" : s > 90 ? `about ${Math.round(s / 60)} min left` : `about ${Math.max(1, Math.round(s))} s left`);

/** A marked teacher part at least this long suggests a class video: the dance is compared step by step. */
const CLASS_MODE_FROM = 45;

/** What the results show when class mode found no step. */
function emptyResult(message: string | null, warnings: string[]): CompareResult {
  const na = { level: "na" as const, note: "Not judged" };
  return {
    kind: "movement",
    found: false,
    reading: "none",
    coverage: 0,
    mirrored: false,
    tries: [],
    pauses: [],
    timing: { ratio: null, text: null },
    tips: [],
    strength: null,
    bands: { arms: na, legs: na, torso: na, timing: na },
    notChecked: [],
    warnings,
    map: [],
    message,
  };
}

/** Running out of memory surfaces as a RangeError about an array; say what to do instead. */
function friendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/allocation failed|invalid (typed )?array length|out of memory|array buffer/i.test(m))
    return "This device ran out of memory comparing such long videos. Mark a shorter part of the teacher's video, or use a shorter video of yourself.";
  return m;
}


export default function CompareClient() {
  // teacher
  const [tFile, setTFile] = useState<File | null>(null);
  const [tUrl, setTUrl] = useState<string | null>(null);
  const [tDur, setTDur] = useState(0);
  const [tAspect, setTAspect] = useState<number | undefined>();
  const [tVideo, setTVideo] = useState<HTMLVideoElement | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 8]);
  const [tTrack, setTTrack] = useState<PoseTrack | null>(null);
  const [tKey, setTKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [restored, setRestored] = useState<PoseTrack | null>(null);
  // student
  const [sUrl, setSUrl] = useState<string | null>(null);
  const [sName, setSName] = useState("");
  const [sAspect, setSAspect] = useState<number | undefined>();
  const [sTrack, setSTrack] = useState<PoseTrack | null>(null);
  // result
  const [result, setResult] = useState<CompareResult | null>(null);
  // class mode: the student's dance, step by step; `result` is then the chosen step's
  const [lesson, setLesson] = useState<LessonResult | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [modeChoice, setModeChoice] = useState<"one" | "class" | null>(null);
  const [parts, setParts] = useState<PartSwitches>(ALL_PARTS_ON);
  const [activeTip, setActiveTip] = useState<Tip | null>(null);
  const [ghost, setGhost] = useState(false);
  const [teacherSound, setTeacherSound] = useState(false);
  const [playing, setPlaying] = useState(false);
  // ui
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [isPhone, setIsPhone] = useState(false);

  const teacherRef = useRef<VideoPanelHandle>(null);
  const studentRef = useRef<VideoPanelHandle>(null);
  const tPlayRef = useRef<VideoPanelHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlsRef = useRef<string[]>([]);
  const syncRef = useRef<number | null>(null);
  const videosRef = useRef<HTMLDivElement>(null);

  const track = (u: string) => {
    urlsRef.current.push(u);
    return u;
  };

  const resetAll = useCallback(() => {
    abortRef.current?.abort();
    for (const u of urlsRef.current) URL.revokeObjectURL(u);
    urlsRef.current = [];
    setTFile(null);
    setTUrl(null);
    setTTrack(null);
    setTKey(null);
    setSaved(false);
    setSUrl(null);
    setSName("");
    setSTrack(null);
    setResult(null);
    setLesson(null);
    setModeChoice(null);
    setActiveTip(null);
    setBusy(null);
    setError(null);
    setNote(null);
  }, []);

  // privacy: release everything when the page goes away; a page restored from the
  // back/forward cache starts again at step 1, so the next person can't press Back to see a take
  useEffect(() => {
    const onHide = () => resetAll();
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) resetAll();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
      abortRef.current?.abort();
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
      urlsRef.current = [];
      stopAnalysisWorker();
    };
  }, [resetAll]);

  // a teacher step kept for this session (the phone may have reloaded the page for the camera)
  useEffect(() => {
    setIsPhone(window.matchMedia("(pointer: coarse)").matches);
    void sweepSessionSteps().catch(() => undefined);
    const key = sessionStepKey();
    if (!key) return;
    loadTeacherStep(key)
      .then((t) => {
        if (t) setRestored(t);
      })
      .catch(() => undefined);
  }, []);

  const onProgress = (who: "teacher" | "student") => (p: ExtractProgress) => setBusy({ who, p });

  /* ---------------- step 1: teacher ---------------- */

  const chooseTeacher = (f: File) => {
    setError(null);
    setNote(null);
    setTFile(f);
    setTUrl(track(URL.createObjectURL(f)));
    setTTrack(null);
    setTKey(null);
    setSaved(false);
    setResult(null);
    setLesson(null);
    // start downloading the model while the step is being marked
    void preloadModels().catch(() => undefined);
  };

  const getTeacherVideo = useCallback(() => teacherRef.current?.video ?? null, []);

  const onTeacherLoaded = async (v: HTMLVideoElement) => {
    // a recording (YouTube, or some phones) may not say how long it is until asked
    const dur = await resolveDuration(v);
    if (!Number.isFinite(dur) || dur <= 0) {
      setError("This browser can't tell how long that video is. Try another video.");
      return;
    }
    setTVideo(v);
    setTDur(dur);
    setTAspect(v.videoWidth / v.videoHeight);
    if (restored && restored.range[1] <= dur + 0.5) setRange(restored.range);
    else setRange([0, Math.min(dur, 8)]);
  };

  const suggest = async () => {
    const v = teacherRef.current?.video;
    if (!v) return;
    setBusy({ who: "suggest", p: null });
    try {
      const r = await suggestMovingPart(v, v.currentTime);
      if (r) setRange(r);
      else setNote("Nothing seems to move around here. Play to the step, pause, and try again.");
    } finally {
      setBusy(null);
    }
  };

  const prepareTeacher = () => {
    const v = teacherRef.current?.video;
    if (!v || !tFile) return;
    primeVideo(v); // inside the tap, before any await
    void (async () => {
      setError(null);
      setNote(null);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const key = await fingerprint(tFile, range, v);
        let t: PoseTrack | null = null;
        if (restored && key === sessionStepKey()) t = restored;
        if (!t) t = await loadTeacherStep(key).catch(() => null);
        if (t) setNote("This step was already prepared on this device, so it wasn't processed again.");
        if (!t) {
          setBusy({ who: "teacher", p: null });
          t = await extractPose(v, range, { onProgress: onProgress("teacher"), signal: ac.signal });
        }
        // kept for this session before any camera opens
        await saveTeacherStep(key, t, { name: tFile.name, session: true }).catch(() => undefined);
        rememberSessionStep(key);
        setTKey(key);
        setTTrack(t);
        v.currentTime = range[0];
      } catch (err) {
        if (!(err instanceof ExtractError && err.code === "aborted")) setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  const saveStep = async () => {
    if (!tKey || !tTrack || !tFile) return;
    await saveTeacherStep(tKey, tTrack, { name: tFile.name, session: false });
    setSaved(true);
  };

  /* ---------------- step 2: student ---------------- */

  const chooseStudent = (f: File) => {
    setError(null);
    setNote(null);
    pauseBoth();
    setActiveTip(null);
    setSName(f.name);
    setSUrl(track(URL.createObjectURL(f)));
    setSTrack(null);
    setResult(null);
    setLesson(null);
  };

  const analyseStudent = () => {
    const v = studentRef.current?.video;
    if (!v || !tTrack) return;
    primeVideo(v); // its own tap: iPhones may refuse play() otherwise
    void (async () => {
      setError(null);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        setBusy({ who: "student", p: null });
        const dur = await resolveDuration(v);
        if (!Number.isFinite(dur) || dur <= 0) throw new Error("This browser can't tell how long your video is. Try another video.");
        const s = await extractPose(v, [0, dur], { onProgress: onProgress("student"), signal: ac.signal });
        setSTrack(s);
        setBusy({ who: "analysis", p: null });
        await compareTracks(tTrack, s, parts, mode);
      } catch (err) {
        if (!(err instanceof ExtractError && err.code === "aborted")) setError(friendly(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  /** One step, or class mode; in class mode the first step is shown. */
  const compareTracks = async (t: PoseTrack, st: PoseTrack, p: PartSwitches, m: "one" | "class") => {
    if (m === "class") {
      setBusy({
        who: "analysis",
        p: { stage: "processing", fraction: 0.05, etaSec: null, message: "Finding each step of your dance in the class video (a long class takes a minute)" },
      });
      const L = await runLesson(t, st, p);
      setLesson(L);
      setActiveStep(0);
      setResult(L.steps[0]?.result ?? emptyResult(L.message, L.warnings));
    } else {
      setLesson(null);
      setResult(await runAnalysis(t, st, p));
    }
    setActiveTip(null);
  };

  const rerun = async (p: PartSwitches, m: "one" | "class") => {
    if (!tTrack || !sTrack) return;
    pauseBoth();
    setBusy({ who: "analysis", p: null });
    try {
      await compareTracks(tTrack, sTrack, p, m);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(null);
    }
  };

  const changeParts = (p: PartSwitches) => {
    setParts(p);
    void rerun(p, mode);
  };

  const changeMode = (m: "one" | "class") => {
    setModeChoice(m);
    void rerun(parts, m);
  };

  /* ---------------- step 3: synced playback and Show me ---------------- */

  const stopSync = () => {
    if (syncRef.current !== null) window.clearInterval(syncRef.current);
    syncRef.current = null;
  };

  const pauseBoth = () => {
    stopSync();
    tPlayRef.current?.video?.pause();
    studentRef.current?.video?.pause();
    setPlaying(false);
  };

  const playBoth = () => {
    const sv = studentRef.current?.video;
    const tv = tPlayRef.current?.video;
    if (!sv || !tv || !result) return;
    if (playing) return pauseBoth();
    const tr = result.tries[0];
    let s0 = sv.currentTime;
    if (tr && (s0 < tr.start || s0 >= tr.end - 0.2)) s0 = tr.start;
    sv.currentTime = s0;
    tv.currentTime = Math.max(0, mapTime(result.map, s0));
    // one Play tap starts both; iPhones won't play two videos with sound, so one is muted
    tv.muted = !teacherSound;
    sv.muted = teacherSound;
    void sv.play().catch(() => undefined);
    void tv.play().catch(() => undefined);
    setActiveTip(null);
    setPlaying(true);
    stopSync();
    const end = tr ? tr.end + 0.5 : Infinity;
    // a smoothed speed map, updated at most twice a second
    syncRef.current = window.setInterval(() => {
      const s = sv.currentTime;
      if (sv.paused || sv.ended || s >= end) return pauseBoth();
      const target = mapTime(result.map, s);
      tv.playbackRate = Math.min(2, Math.max(0.5, slopeAt(result.map, s)));
      if (Math.abs(tv.currentTime - target) > 0.3) tv.currentTime = Math.max(0, target);
    }, 500);
  };

  const showMe = (tip: Tip) => {
    pauseBoth();
    setActiveTip(tip);
    const sv = studentRef.current?.video;
    const tv = tPlayRef.current?.video;
    if (sv) sv.currentTime = tip.at.student;
    if (tv && result) tv.currentTime = Math.max(0, tip.at.teacher ?? mapTime(result.map, tip.at.student));
  };

  /** Class mode: show one step (both videos go to its start). */
  const selectStep = (i: number) => {
    const st = lesson?.steps[i];
    if (!st) return;
    pauseBoth();
    setActiveStep(i);
    setResult(st.result);
    setActiveTip(null);
    const s0 = st.result.tries[0]?.start ?? st.student[0];
    const sv = studentRef.current?.video;
    const tv = tPlayRef.current?.video;
    if (sv) sv.currentTime = s0;
    if (tv) tv.currentTime = Math.max(0, st.result.map.length ? mapTime(st.result.map, s0) : st.teacher[0]);
  };

  /** Play one video alone over a span (class mode's "Watch"). */
  const watchOne = (which: "teacher" | "student", [from, until]: [number, number]) => {
    pauseBoth();
    const v = which === "teacher" ? tPlayRef.current?.video : studentRef.current?.video;
    if (!v) return;
    v.currentTime = from;
    void v.play().catch(() => undefined);
    setPlaying(true);
    syncRef.current = window.setInterval(() => {
      if (v.paused || v.ended || v.currentTime >= until) pauseBoth();
    }, 250);
    videosRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  useEffect(
    () => () => {
      if (syncRef.current !== null) window.clearInterval(syncRef.current);
    },
    [],
  );

  // ?debug=1 exposes the tracks and the result to tests (they never leave the tab)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("debug") === "1")
      (window as unknown as { __compare: unknown }).__compare = { teacher: tTrack, student: sTrack, result, lesson, recordElement, resolveDuration };
  }, [tTrack, sTrack, result, lesson]);

  const ghostInfo = useMemo(
    () => (ghost && tTrack && result?.found ? { track: tTrack, timeAt: (s: number) => mapTime(result.map, s), mirrored: result.mirrored } : null),
    [ghost, tTrack, result],
  );

  const busyLine = (who: NonNullable<Busy>["who"]) =>
    busy?.who === who ? (
      <div className="space-y-2.5 rounded-sm border border-foreground/12 bg-foreground/[0.02] p-4" role="status">
        <div className="flex items-center justify-between gap-3">
          <p className="mono flex min-w-0 items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-foreground/65">
            <Loader2 size={12} className="shrink-0 animate-spin text-primary" />
            <span className="truncate">
              {busy.p?.message ?? (who === "analysis" ? "Comparing" : who === "suggest" ? "Looking for the moving part" : "Starting")}
            </span>
          </p>
          {(who === "teacher" || who === "student") && (
            <button
              type="button"
              className="mono shrink-0 text-[10px] uppercase tracking-[0.14em] text-foreground/45 underline-offset-4 hover:text-primary hover:underline"
              onClick={() => abortRef.current?.abort()}
            >
              Stop
            </button>
          )}
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round((busy.p?.fraction ?? 0.02) * 100)}%` }} />
        </div>
        {busy.p?.etaSec !== undefined && <p className="mono text-[10px] text-foreground/45">{fmtEta(busy.p?.etaSec ?? null)}</p>}
      </div>
    ) : null;

  const pill =
    "mono inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[10px] uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const solid = `${pill} bg-primary font-medium text-white hover:bg-primary/85 dark:text-black`;
  const ghostBtn = `${pill} border border-foreground/20 text-foreground/70 hover:border-primary/60 hover:text-primary`;
  const stepLen = range[1] - range[0];
  const stage: 1 | 2 | 3 = result ? 3 : tTrack ? 2 : 1;
  const mode: "one" | "class" = modeChoice ?? (stepLen >= CLASS_MODE_FROM ? "class" : "one");
  const notAVideo = () => setError("That file isn't a video. Choose an MP4, MOV or WebM file.");

  const alerts =
    error || note ? (
      <div className="mb-6 space-y-3">
        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-sm border border-rose-500/40 bg-rose-500/[0.06] px-4 py-3 text-[0.95rem] text-foreground/85">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-400" />
            <p className="flex-1">{error}</p>
            <button type="button" aria-label="Dismiss" className="text-foreground/45 hover:text-foreground" onClick={() => setError(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        {note && (
          <div className="flex items-start gap-3 rounded-sm border border-foreground/12 bg-foreground/[0.02] px-4 py-3 text-[0.95rem] text-foreground/75">
            <Info size={16} className="mt-0.5 shrink-0 text-primary" />
            <p className="serif flex-1">{note}</p>
            <button type="button" aria-label="Dismiss" className="text-foreground/45 hover:text-foreground" onClick={() => setNote(null)}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    ) : null;

  const recordingTips = (
    <ul className="space-y-5">
      <Hint icon={<ScanLine size={16} />} title="Your whole body in view">
        Head to feet, in every frame, with good light.
      </Hint>
      <Hint icon={<UserRound size={16} />} title="Face the camera like your teacher">
        If you face the other way, it&apos;s compared mirrored by itself.
      </Hint>
      <Hint icon={<Timer size={16} />} title="Extra bits are fine">
        Walking in, pauses, doing the step a few times, or a different speed. Any length.
      </Hint>
    </ul>
  );

  return (
    <div className="min-h-screen px-4 pt-28 pb-24 sm:px-6 sm:pt-32">
      <div className="mx-auto max-w-6xl">
        {/* ---------------- header ---------------- */}
        <header className="space-y-4">
          <Eyebrow tone="primary">Compare · beta</Eyebrow>
          <Headline as="h1">Compare with your teacher</Headline>
          <p className="serif max-w-[62ch] text-[1.02rem] leading-[1.66] text-foreground/65 sm:text-[1.09rem]">
            Mark a step, or a whole class, in your teacher&apos;s video, add a video of yourself dancing it, and see the two side by side
            with the body, hands and fingers traced on each, and <strong className="font-semibold text-foreground">corrections</strong> for
            each step.
          </p>
        </header>

        <div className="mt-10 grid gap-5 rounded-sm border border-foreground/12 bg-foreground/[0.02] p-5 sm:grid-cols-3">
          <Fact icon={<ShieldCheck size={18} />} label="Private" value="Stays on this device">
            No video or frame is uploaded or kept.
          </Fact>
          <Fact icon={<Scissors size={18} />} label="You choose the length" value="A step or a whole dance">
            Long parts take longer to prepare.
          </Fact>
          <Fact icon={<Download size={18} />} label="First time" value={`${MODEL_DOWNLOAD_MB} MB`}>
            The pose model downloads once.
          </Fact>
        </div>

        {/* ---------------- progress ---------------- */}
        <ol className="mt-12 flex items-center gap-2 sm:gap-4" aria-label="Progress">
          {(["Teacher's step", "Your video", "Your tips"] as const).map((name, i) => {
            const n = i + 1;
            const done = n < stage;
            const current = n === stage;
            return (
              <li key={name} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3" aria-current={current ? "step" : undefined}>
                <span
                  className={`mono grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] ${
                    done
                      ? "border-primary bg-primary text-white dark:text-black"
                      : current
                        ? "border-primary text-primary"
                        : "border-foreground/20 text-foreground/40"
                  }`}
                >
                  {done ? <Check size={13} strokeWidth={3} /> : n}
                </span>
                <span
                  className={`mono truncate text-[10px] uppercase tracking-[0.16em] ${current ? "text-foreground" : "hidden text-foreground/45 sm:inline"}`}
                >
                  {name}
                </span>
                {n < 3 && <span className={`hidden h-px flex-1 sm:block ${done ? "bg-primary/50" : "bg-foreground/12"}`} />}
              </li>
            );
          })}
        </ol>

        <div className="mt-6 space-y-6">
          {/* ---------------- 1 ---------------- */}
          <StepPanel
            n={1}
            id="step1"
            title="Your teacher's video"
            state={stage === 1 ? "current" : "done"}
            desc={tUrl ? undefined : "Choose a video of your teacher, or use a YouTube link. Then mark the part you want to practise."}
            status={tTrack ? <Chip tone="ready">Step ready</Chip> : undefined}
          >
            {stage === 1 && alerts}
            {restored && !tTrack && (
              <p className="mb-6 flex items-start gap-3 rounded-sm border border-foreground/12 bg-foreground/[0.02] px-4 py-3 text-[0.95rem] text-foreground/75">
                <Info size={16} className="mt-0.5 shrink-0 text-primary" />
                <span className="serif">A teacher step from this session was kept. Choose the same teacher video again to continue without processing it again.</span>
              </p>
            )}
            {!tUrl ? (
              <div className="grid gap-8 lg:grid-cols-[3fr_2fr] lg:gap-12">
                <DropZone
                  className="min-h-[260px]"
                  icon={<Upload size={20} />}
                  title="Choose or drop the teacher's video"
                  hint="MP4, MOV or WebM · any length"
                  onFile={chooseTeacher}
                  onReject={notAVideo}
                  testId="teacher-file"
                />
                <ul className="space-y-5 self-center">
                  <Hint icon={<Scissors size={16} />} title="Mark the part to compare">
                    One step, or the whole class: from {MIN_STEP} s to the whole video. For a long class, mark it all and choose
                    &ldquo;Several steps from the class&rdquo; in step 2: each step of your dance is found in it. A part over{" "}
                    {LONG_STEP / 60} minute takes longer to prepare.
                  </Hint>
                  <Hint icon={<Wand2 size={16} />} title="Not sure where it starts?">
                    Pause near the step and tap &ldquo;Find the moving part&rdquo;.
                  </Hint>
                </ul>
                <div className="border-t border-foreground/10 pt-6 lg:col-span-2">
                  <YouTubeCapture onFile={chooseTeacher} />
                </div>
              </div>
            ) : (
              <div className="grid gap-8 lg:grid-cols-[3fr_2fr] lg:gap-10">
                <div className="min-w-0 space-y-3">
                  <VideoPanel
                    ref={teacherRef}
                    src={tUrl}
                    track={tTrack}
                    label={tTrack ? "Teacher · stick figure found on this device" : "Teacher"}
                    aspect={tAspect}
                    onLoaded={onTeacherLoaded}
                  />
                  <FileRow name={tFile?.name ?? ""} label="Change video" onFile={chooseTeacher} onReject={notAVideo} testId="teacher-file" disabled={!!busy} />
                </div>
                <div className="space-y-5">
                  {tDur > 0 && (
                    <TrimBar
                      key={tUrl}
                      video={tVideo}
                      getVideo={getTeacherVideo}
                      duration={tDur}
                      range={range}
                      onChange={(r) => {
                        setRange(r);
                        if (tTrack) {
                          setTTrack(null);
                          setResult(null);
                          setLesson(null);
    setLesson(null);
                        }
                      }}
                      disabled={!!busy}
                    />
                  )}
                  {tTrack ? (
                    <div className="space-y-3">
                      <p
                        className="mono flex items-center gap-2 rounded-sm border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-[10px] uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400"
                        data-testid="teacher-ready"
                      >
                        <Check size={14} /> Teacher step ready · {tTrack.frames.filter((f) => f.img).length} frames with the dancer
                      </p>
                      <button type="button" className={`${ghostBtn} w-full`} onClick={saveStep} disabled={saved}>
                        <Save size={14} /> {saved ? "Saved on this device" : "Save this step for next time"}
                      </button>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <button type="button" className={ghostBtn} onClick={suggest} disabled={!!busy || !tDur}>
                        <Wand2 size={14} /> Find the moving part
                      </button>
                      <button
                        type="button"
                        className={solid}
                        onClick={prepareTeacher}
                        disabled={!!busy || stepLen < MIN_STEP}
                        data-testid="prepare-teacher"
                      >
                        <Sparkles size={14} /> Prepare this step
                      </button>
                    </div>
                  )}
                  {busyLine("suggest")}
                  {busyLine("teacher")}
                </div>
              </div>
            )}
          </StepPanel>

          {/* ---------------- 2 ---------------- */}
          <StepPanel
            n={2}
            id="step2"
            title="Your video"
            state={stage === 2 ? "current" : stage > 2 ? "done" : "locked"}
            desc={stage < 2 ? "Unlocks when the teacher's step is ready." : sUrl ? undefined : "Choose a video of yourself doing the same step, or record one."}
            status={stage < 2 ? <Chip tone="locked">Locked</Chip> : result ? <Chip tone="ready">Compared</Chip> : undefined}
          >
            {stage === 2 && alerts}
            {tTrack && (
              <fieldset className="mb-6 space-y-2.5">
                <legend className="mono mb-2.5 text-[10px] uppercase tracking-[0.18em] text-foreground/55">What&apos;s in your video?</legend>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                  <ModeOption
                    active={mode === "one"}
                    title="The part I marked"
                    onClick={() => changeMode("one")}
                    disabled={!!busy}
                    testId="mode-one"
                  >
                    The same step or dance as the teacher&apos;s marked part, once or a few times.
                  </ModeOption>
                  <ModeOption
                    active={mode === "class"}
                    title="Several steps from the class"
                    onClick={() => changeMode("class")}
                    disabled={!!busy}
                    testId="mode-class"
                  >
                    Your dance has steps taught across the teacher&apos;s video. Each one is found in it and checked.
                  </ModeOption>
                </div>
              </fieldset>
            )}
            {!sUrl ? (
              <div className="grid gap-8 lg:grid-cols-[3fr_2fr] lg:gap-12">
                <div className="space-y-3">
                  <DropZone
                    className="min-h-[220px]"
                    icon={tTrack ? <Upload size={20} /> : <Lock size={18} />}
                    title={tTrack ? "Choose or drop your video" : "Prepare the teacher's step first"}
                    hint="From your gallery, Google Drive or Files · MP4, MOV or WebM"
                    onFile={chooseStudent}
                    onReject={notAVideo}
                    disabled={!tTrack}
                    testId="student-file"
                  />
                  {isPhone && (
                    <label className={`${solid} w-full ${tTrack ? "cursor-pointer" : "pointer-events-none opacity-40"}`}>
                      <Camera size={14} /> Record yourself now
                      <input
                        type="file"
                        accept="video/*"
                        capture="user"
                        className="sr-only"
                        disabled={!tTrack}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) chooseStudent(f);
                        }}
                      />
                    </label>
                  )}
                </div>
                <div className="self-center">{recordingTips}</div>
              </div>
            ) : !result ? (
              <div className="grid gap-8 lg:grid-cols-[3fr_2fr] lg:gap-10">
                <div className="min-w-0 space-y-3">
                  <VideoPanel ref={studentRef} src={sUrl} track={sTrack} label="You" aspect={sAspect} onLoaded={(v) => {
                      setSAspect(v.videoWidth / v.videoHeight);
                      void resolveDuration(v);
                    }}
                  />
                  <FileRow name={sName} label="Change video" onFile={chooseStudent} onReject={notAVideo} testId="student-file" disabled={!!busy} />
                </div>
                <div className="space-y-6">
                  {recordingTips}
                  <button type="button" className={`${solid} w-full py-3`} onClick={analyseStudent} disabled={!!busy || !tTrack} data-testid="analyse-student">
                    <Sparkles size={14} /> Compare with the teacher
                  </button>
                  {busyLine("student")}
                  {busyLine("analysis")}
                </div>
              </div>
            ) : (
              <FileRow name={sName} label="Try another video" onFile={chooseStudent} onReject={notAVideo} testId="student-file" disabled={!!busy} />
            )}
          </StepPanel>

          {/* ---------------- 3 ---------------- */}
          <StepPanel
            n={3}
            id="step3"
            title="How it compares"
            state={stage === 3 ? "current" : "locked"}
            desc={stage < 3 ? "Both videos side by side, with up to three corrections and a “Show me” for each." : undefined}
            status={stage < 3 ? <Chip tone="locked">Locked</Chip> : undefined}
          >
            {result && tUrl && sUrl ? (
              <div className="space-y-6" data-testid="results">
                {alerts}
                {lesson && sTrack && <LessonNav lesson={lesson} duration={sTrack.range[1]} active={activeStep} onSelect={selectStep} />}
                <div ref={videosRef} className="grid gap-4 md:grid-cols-2">
                  <VideoPanel
                    ref={tPlayRef}
                    src={tUrl}
                    track={tTrack}
                    label="Teacher"
                    aspect={tAspect}
                    muted={!teacherSound}
                    controls={false}
                    marker={activeTip ? { marker: activeTip.marker, joints: activeTip.marker.teacherJoints ?? activeTip.marker.joints } : null}
                    onLoaded={(v) => (v.currentTime = result.found ? mapTime(result.map, result.tries[0]?.start ?? 0) : range[0])}
                  />
                  <VideoPanel
                    ref={studentRef}
                    src={sUrl}
                    track={sTrack}
                    label={result.mirrored ? "You (compared mirrored)" : "You"}
                    aspect={sAspect}
                    muted={teacherSound}
                    controls={false}
                    marker={activeTip ? { marker: activeTip.marker, joints: activeTip.marker.joints } : null}
                    ghost={ghostInfo}
                    onLoaded={(v) => {
                      setSAspect(v.videoWidth / v.videoHeight);
                      v.currentTime = result.tries[0]?.start ?? 0;
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-sm border border-foreground/12 bg-foreground/[0.02] p-2">
                  <button type="button" className={solid} onClick={playBoth} disabled={!result.found} data-testid="play-both">
                    {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause" : "Play both"}
                  </button>
                  <label className={`${ghostBtn} ${result.found ? "cursor-pointer" : "opacity-40"}`}>
                    <input
                      type="checkbox"
                      checked={ghost}
                      onChange={(e) => setGhost(e.target.checked)}
                      className="accent-[var(--primary)]"
                      disabled={!result.found}
                    />
                    Teacher&apos;s ghost
                  </label>
                  <button type="button" className={ghostBtn} onClick={() => setTeacherSound((x) => !x)}>
                    Sound: {teacherSound ? "teacher's" : "mine"}
                  </button>
                  {result.tries.length > 1 && (
                    <span className="mono ml-auto px-3 text-[10px] uppercase tracking-[0.14em] text-foreground/50">{result.tries.length} tries found</span>
                  )}
                </div>
                <Results result={result} parts={parts} onParts={changeParts} onShowMe={showMe} activeTip={activeTip?.id ?? null} />
                {busyLine("analysis")}
                {lesson && (
                  <LessonGaps lesson={lesson} onWatchClass={(sp) => watchOne("teacher", sp)} onWatchYou={(sp) => watchOne("student", sp)} />
                )}
                <div className="flex flex-wrap gap-2 border-t border-foreground/10 pt-6">
                  <FilePick className={solid} label="Try another video of yourself" icon={<Upload size={14} />} onFile={chooseStudent} onReject={notAVideo} />
                  <button
                    type="button"
                    className={ghostBtn}
                    onClick={() => {
                      resetAll();
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <RotateCcw size={14} /> Start again
                  </button>
                </div>
              </div>
            ) : null}
          </StepPanel>
        </div>

        <Rule className="mt-16" />
        <footer className="mt-8 flex flex-wrap items-center gap-3 text-sm text-foreground/55">
          <button
            type="button"
            className={ghostBtn}
            onClick={async () => {
              await deleteSavedSteps().catch(() => undefined);
              forgetSessionStep();
              setRestored(null);
              setSaved(false);
              setNote("Saved teacher steps were deleted from this device.");
            }}
          >
            <Trash2 size={14} /> Delete saved steps
          </button>
          <span>Saved steps hold the stick figure only, never video.</span>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page furniture                                                       */
/* ------------------------------------------------------------------ */

function StepPanel({
  n,
  id,
  title,
  desc,
  state,
  status,
  children,
}: {
  n: number;
  id: string;
  title: string;
  desc?: ReactNode;
  state: "current" | "done" | "locked";
  status?: ReactNode;
  children?: ReactNode;
}) {
  const box =
    state === "current"
      ? "border-foreground/15 bg-gradient-to-br from-primary/[0.06] via-foreground/[0.01] to-transparent"
      : state === "done"
        ? "border-foreground/12 bg-foreground/[0.02]"
        : "border-foreground/10";
  const tile =
    state === "locked" ? "border-foreground/15 text-foreground/35" : "border-primary/20 bg-primary/10 text-primary";
  return (
    <section aria-labelledby={id} className={`rounded-sm border p-5 sm:p-8 ${box}`}>
      <div className="flex items-start gap-4">
        <span className={`mono grid h-10 w-10 shrink-0 place-items-center rounded-sm border text-sm ${tile}`}>
          {state === "done" ? <Check size={16} strokeWidth={2.5} /> : `0${n}`}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="mono text-[10px] uppercase tracking-[0.2em] text-foreground/45">Step {n}</p>
            {status}
          </div>
          <h2 id={id} className={`serif mt-1 text-[1.6rem] leading-tight ${state === "locked" ? "text-foreground/50" : ""}`}>
            {title}
          </h2>
          {desc && <p className="serif mt-1.5 max-w-[60ch] text-[1rem] leading-relaxed text-foreground/55">{desc}</p>}
        </div>
      </div>
      {children ? <div className="mt-6 sm:mt-8">{children}</div> : null}
    </section>
  );
}

function ModeOption({
  active,
  title,
  children,
  onClick,
  disabled,
  testId,
}: {
  active: boolean;
  title: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`flex items-start gap-3 rounded-sm border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
        active ? "border-primary bg-primary/[0.07]" : "border-foreground/12 hover:border-primary/50"
      }`}
    >
      <span className={`mt-1 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${active ? "border-primary" : "border-foreground/30"}`}>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </span>
      <span>
        <span className="mono block text-[10px] uppercase tracking-[0.16em] text-foreground/85">{title}</span>
        <span className="serif mt-1 block text-[0.95rem] leading-snug text-foreground/60">{children}</span>
      </span>
    </button>
  );
}

function Chip({ tone, children }: { tone: "ready" | "locked"; children: ReactNode }) {
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[9px] uppercase tracking-[0.16em] ${
        tone === "ready"
          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          : "border-foreground/15 text-foreground/40"
      }`}
    >
      {tone === "ready" ? <Check size={11} strokeWidth={3} /> : <Lock size={10} />}
      {children}
    </span>
  );
}

function Fact({ icon, label, value, children }: { icon: ReactNode; label: string; value: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-primary/20 bg-primary/10 text-primary">{icon}</span>
      <div className="min-w-0">
        <p className="mono text-[9px] uppercase tracking-[0.18em] text-foreground/45">{label}</p>
        <p className="mono mt-1 text-[0.95rem] text-foreground">{value}</p>
        <p className="mt-1 text-[0.82rem] leading-snug text-foreground/50">{children}</p>
      </div>
    </div>
  );
}

function Hint({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3.5">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-foreground/12 text-primary">{icon}</span>
      <div>
        <p className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/80">{title}</p>
        <p className="serif mt-1 text-[0.98rem] leading-relaxed text-foreground/60">{children}</p>
      </div>
    </li>
  );
}

/** A button that opens the file picker. */
function FilePick({
  label,
  icon,
  onFile,
  onReject,
  className,
  testId,
  disabled,
}: {
  label: string;
  icon?: ReactNode;
  onFile: (f: File) => void;
  onReject: () => void;
  className: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`${className} ${disabled ? "pointer-events-none opacity-40" : "cursor-pointer"}`}>
      {icon} {label}
      <input
        type="file"
        accept="video/*"
        className="sr-only"
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.type === "" || f.type.startsWith("video/")) onFile(f);
          else onReject();
        }}
      />
    </label>
  );
}

/** The chosen file's name, with a way to choose another. */
function FileRow(props: { name: string; label: string; onFile: (f: File) => void; onReject: () => void; testId?: string; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="mono min-w-0 truncate text-[10px] text-foreground/45" title={props.name}>
        {props.name}
      </p>
      <FilePick
        {...props}
        icon={<Upload size={12} />}
        className="mono inline-flex shrink-0 items-center gap-1.5 rounded-full border border-foreground/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-foreground/70 transition-colors hover:border-primary/60 hover:text-primary"
      />
    </div>
  );
}
