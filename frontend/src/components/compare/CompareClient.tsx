"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  Hand,
  Info,
  Layers,
  Loader2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Save,
  ScanLine,
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
import TrimBar, { MIN_STEP } from "@/components/compare/TrimBar";
import DropZone from "@/components/compare/DropZone";
import YouTubeCapture from "@/components/compare/YouTubeCapture";
import Results from "@/components/compare/Results";
import { LessonGaps, LessonNav } from "@/components/compare/LessonSteps";
import { Eyebrow, Headline } from "@/components/ui/editorial";
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
 * /compare: "Compare with your teacher" (docs/video-compare/05-mvp.md, Phase 1),
 * laid out as one workspace rather than numbered steps:
 * - Reference (the teacher's video, a file or a YouTube recording) and Your
 *   performance side by side; the reference segment is marked on its timeline;
 * - one "Run analysis" does whatever is missing: finds the body and hands in the
 *   reference segment, then in the performance, then compares (one segment, or
 *   every segment of a class);
 * - the inputs then fold into a summary and the analysis report opens: segments
 *   (class mode), both videos synced, the assessment by body part, corrections
 *   with Show me.
 *
 * Videos are only ever object URLs in this tab. Nothing is uploaded, and
 * everything is released when the page is left or hidden for good.
 */

type Busy = null | { who: "teacher" | "student" | "analysis" | "suggest"; p: ExtractProgress | null };

const fmtEta = (s: number | null) => (s === null ? "" : s > 90 ? `about ${Math.round(s / 60)} min left` : `about ${Math.max(1, Math.round(s))} s left`);

/** A saved teacher step made by this version of the extractor (with the hand pass), so it can be reused. */
const isCurrent = (t: PoseTrack) => t.handPass !== undefined;

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
  // the inputs are folded into a summary while the report is open, unless being edited
  const [editing, setEditing] = useState(false);

  const teacherRef = useRef<VideoPanelHandle>(null);
  const studentRef = useRef<VideoPanelHandle>(null);
  const tPlayRef = useRef<VideoPanelHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlsRef = useRef<string[]>([]);
  const syncRef = useRef<number | null>(null);
  const videosRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const scrollToReport = useRef(false);

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
    setEditing(false);
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
        if (t && isCurrent(t)) setRestored(t);
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

  /** The reference segment's track: reused when this version saved it on this device, else found now. */
  const ensureTeacher = async (v: HTMLVideoElement, ac: AbortController): Promise<PoseTrack> => {
    if (tTrack) return tTrack;
    if (!tFile) throw new Error("Add the reference video first.");
    const key = await fingerprint(tFile, range, v);
    let t: PoseTrack | null = null;
    // a segment saved before hands were tracked is analysed again, so it has the fingers
    if (restored && key === sessionStepKey() && isCurrent(restored)) t = restored;
    if (!t) t = await loadTeacherStep(key).then((x) => (x && isCurrent(x) ? x : null)).catch(() => null);
    if (t) setNote("This reference segment was already analysed on this device, so it wasn't processed again.");
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
    return t;
  };

  /** "Analyse reference": the reference alone, ahead of the performance. */
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
        await ensureTeacher(v, ac);
      } catch (err) {
        if (!(err instanceof ExtractError && err.code === "aborted")) setError(friendly(err));
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

  /** "Run analysis": the reference (if needed), the performance (if needed), then the comparison. */
  const runAll = () => {
    const tv = teacherRef.current?.video;
    const sv = studentRef.current?.video;
    if (!tv || !sv || !tFile) return;
    // inside the tap, before any await: iPhones may refuse play() otherwise
    if (!tTrack) primeVideo(tv);
    if (!sTrack) primeVideo(sv);
    void (async () => {
      setError(null);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const t = await ensureTeacher(tv, ac);
        let st = sTrack;
        if (!st) {
          setBusy({ who: "student", p: null });
          const dur = await resolveDuration(sv);
          if (!Number.isFinite(dur) || dur <= 0) throw new Error("This browser can't tell how long your video is. Try another video.");
          st = await extractPose(sv, [0, dur], { onProgress: onProgress("student"), signal: ac.signal });
          setSTrack(st);
        }
        setBusy({ who: "analysis", p: null });
        scrollToReport.current = true;
        await compareTracks(t, st, parts, mode);
        setEditing(false);
      } catch (err) {
        if (!(err instanceof ExtractError && err.code === "aborted")) setError(friendly(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  /** One segment, or class mode; in class mode the first segment is shown. */
  const compareTracks = async (t: PoseTrack, st: PoseTrack, p: PartSwitches, m: "one" | "class") => {
    if (m === "class") {
      setBusy({
        who: "analysis",
        p: { stage: "processing", fraction: 0.05, etaSec: null, message: "Finding each segment of your performance in the class (a long class takes a minute)" },
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

  // a new report scrolls into view
  useEffect(() => {
    if (result && scrollToReport.current) {
      scrollToReport.current = false;
      reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  const ghostInfo = useMemo(
    () => (ghost && tTrack && result?.found ? { track: tTrack, timeAt: (s: number) => mapTime(result.map, s), mirrored: result.mirrored } : null),
    [ghost, tTrack, result],
  );

  const busyLine = (who: NonNullable<Busy>["who"]) =>
    busy?.who === who ? (
      <div className="space-y-2.5 rounded-md border border-foreground/12 bg-background/40 p-4" role="status">
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-[0.85rem] text-foreground/75">
            <Loader2 size={14} className="shrink-0 animate-spin text-primary" />
            <span className="truncate">
              {busy.p?.message ?? (who === "analysis" ? "Comparing" : who === "suggest" ? "Looking for the movement" : "Starting")}
            </span>
          </p>
          {(who === "teacher" || who === "student") && (
            <button
              type="button"
              className="mono shrink-0 text-[10px] uppercase tracking-[0.14em] text-foreground/50 underline-offset-4 hover:text-primary hover:underline"
              onClick={() => abortRef.current?.abort()}
            >
              Cancel
            </button>
          )}
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round((busy.p?.fraction ?? 0.02) * 100)}%` }} />
        </div>
        {busy.p?.etaSec !== undefined && busy.p?.etaSec !== null && <p className="mono text-[10px] text-foreground/45">{fmtEta(busy.p.etaSec)}</p>}
      </div>
    ) : null;

  const pill =
    "mono inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[10px] uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const solid = `${pill} bg-primary font-medium text-white hover:bg-primary/85 dark:text-black`;
  const ghostBtn = `${pill} border border-foreground/20 text-foreground/70 hover:border-primary/60 hover:text-primary`;
  const stepLen = range[1] - range[0];
  const mode: "one" | "class" = modeChoice ?? (stepLen >= CLASS_MODE_FROM ? "class" : "one");
  const notAVideo = () => setError("That file isn't a video. Choose an MP4, MOV or WebM file.");
  const pct = (p: ExtractProgress | null | undefined) => `${Math.round((p?.fraction ?? 0) * 100)}%`;
  const showReport = !!(result && tUrl && sUrl && !editing);
  const canRun = !!(tUrl && sUrl && tDur > 0 && stepLen >= MIN_STEP && !busy);

  const refState: Readiness =
    busy?.who === "teacher" ? { tone: "busy", text: `Analysing ${pct(busy.p)}` } : tTrack ? { tone: "ready", text: "Analysed" } : tUrl ? { tone: "idle", text: "Loaded" } : { tone: "empty", text: "Not added" };
  const perfState: Readiness =
    busy?.who === "student" ? { tone: "busy", text: `Analysing ${pct(busy.p)}` } : sTrack ? { tone: "ready", text: "Analysed" } : sUrl ? { tone: "idle", text: "Loaded" } : { tone: "empty", text: "Not added" };

  const alerts =
    error || note ? (
      <div className="mt-8 space-y-3">
        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-md border border-rose-500/40 bg-rose-500/[0.06] px-4 py-3 text-[0.95rem] text-foreground/85">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-400" />
            <p className="flex-1">{error}</p>
            <button type="button" aria-label="Dismiss" className="text-foreground/45 hover:text-foreground" onClick={() => setError(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        {note && (
          <div className="flex items-start gap-3 rounded-md border border-foreground/12 bg-foreground/[0.02] px-4 py-3 text-[0.95rem] text-foreground/75">
            <Info size={16} className="mt-0.5 shrink-0 text-primary" />
            <p className="flex-1">{note}</p>
            <button type="button" aria-label="Dismiss" className="text-foreground/45 hover:text-foreground" onClick={() => setNote(null)}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    ) : null;

  const guidelines = (
    <ul className="grid gap-3 sm:grid-cols-3">
      <Guideline icon={<ScanLine size={15} />} title="Whole body in view">
        Head to feet, good light.
      </Guideline>
      <Guideline icon={<UserRound size={15} />} title="Face the camera">
        Like your teacher; mirroring is handled.
      </Guideline>
      <Guideline icon={<Timer size={15} />} title="Any length">
        Pauses and repeats are fine.
      </Guideline>
    </ul>
  );

  const modeSwitch = (
    <Segmented
      label="Performance contains"
      value={mode}
      onChange={changeMode}
      disabled={!!busy}
      options={[
        { value: "one", label: "One segment", testId: "mode-one" },
        { value: "class", label: "Full class", testId: "mode-class" },
      ]}
    />
  );

  const fmtClock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const headline = !result
    ? ""
    : !result.found
      ? "No matching movement found"
      : result.tips.length
        ? `${result.tips.length} correction${result.tips.length > 1 ? "s" : ""} to work on`
        : "Close to the reference";

  return (
    <div className="min-h-screen px-4 pt-28 pb-24 sm:px-6 sm:pt-32">
      <div className="mx-auto max-w-7xl">
        {/* ---------------- header ---------------- */}
        <header className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-end lg:gap-14">
          <div className="space-y-5">
            <Eyebrow tone="primary">NrityaVaani Compare · Beta</Eyebrow>
            <Headline as="h1">Compare with your teacher</Headline>
            <p className="serif max-w-[60ch] text-[1.02rem] leading-[1.66] text-foreground/65 sm:text-[1.09rem]">
              Add your teacher&apos;s video and a video of yourself. The matching movement is found in both, the body, hands and
              fingers are traced, and you get clear corrections for each segment you danced.
            </p>
          </div>
          <ul className="grid gap-4 rounded-md border border-foreground/12 bg-foreground/[0.02] p-5 sm:grid-cols-3 lg:grid-cols-1">
            <Feature icon={<ShieldCheck size={16} />} title="Private by design">
              Processed on this device. Videos are never uploaded.
            </Feature>
            <Feature icon={<Hand size={16} />} title="Body, hands and mudras">
              Posture, timing, fingers and mudra shapes.
            </Feature>
            <Feature icon={<Layers size={16} />} title="A segment or a full class">
              Every segment of a class, found and checked.
            </Feature>
          </ul>
        </header>

        {alerts}

        {/* ---------------- workspace ---------------- */}
        {showReport ? (
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-foreground/12 bg-foreground/[0.02] px-5 py-4">
            <Summary label="Reference" value={tFile?.name ?? ""} meta={`${fmtClock(range[0])}–${fmtClock(range[1])}`} />
            <Summary label="Performance" value={sName} meta={sTrack ? fmtClock(sTrack.range[1]) : ""} />
            <Summary label="Mode" value={mode === "class" ? "Full class" : "One segment"} />
            <span className="flex-1" />
            <button type="button" className={ghostBtn} onClick={() => setEditing(true)}>
              <Pencil size={13} /> Edit inputs
            </button>
          </div>
        ) : (
          <>
            <section aria-label="Videos" className="mt-10 grid gap-5 lg:grid-cols-2">
              {/* reference */}
              <Panel
                kicker="Reference"
                title="Teacher's video"
                status={
                  tTrack ? (
                    <Status tone="ready" testId="teacher-ready">
                      Analysed · {tTrack.frames.filter((f) => f.img).length} frames
                    </Status>
                  ) : (
                    <Status tone={refState.tone}>{refState.text}</Status>
                  )
                }
              >
                {restored && !tTrack && (
                  <p className="flex items-start gap-2 rounded-md border border-foreground/12 bg-background/40 px-3 py-2.5 text-[0.88rem] text-foreground/70">
                    <Info size={15} className="mt-0.5 shrink-0 text-primary" />A reference segment from this session was kept. Add the same video
                    again to reuse it.
                  </p>
                )}
                {!tUrl ? (
                  <>
                    <DropZone
                      className="min-h-[220px]"
                      icon={<Upload size={20} />}
                      title="Add the teacher's video"
                      hint="Drop a file or browse · MP4, MOV or WebM · any length"
                      onFile={chooseTeacher}
                      onReject={notAVideo}
                      testId="teacher-file"
                    />
                    <YouTubeCapture onFile={chooseTeacher} />
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <VideoPanel
                        ref={teacherRef}
                        src={tUrl}
                        track={tTrack}
                        label={tTrack ? "Reference · traced on this device" : "Reference"}
                        aspect={tAspect}
                        onLoaded={onTeacherLoaded}
                      />
                      <FileRow name={tFile?.name ?? ""} label="Replace" onFile={chooseTeacher} onReject={notAVideo} testId="teacher-file" disabled={!!busy} />
                    </div>
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
                          }
                        }}
                        disabled={!!busy}
                      />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={ghostBtn} onClick={suggest} disabled={!!busy || !tDur}>
                        <Wand2 size={14} /> Auto-detect movement
                      </button>
                      {tTrack ? (
                        <button type="button" className={ghostBtn} onClick={saveStep} disabled={saved}>
                          <Save size={14} /> {saved ? "Saved on this device" : "Save reference"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={ghostBtn}
                          onClick={prepareTeacher}
                          disabled={!!busy || stepLen < MIN_STEP}
                          data-testid="prepare-teacher"
                        >
                          <Sparkles size={14} /> Analyse reference
                        </button>
                      )}
                    </div>
                    {busyLine("suggest")}
                    {busyLine("teacher")}
                  </>
                )}
              </Panel>

              {/* performance */}
              <Panel
                kicker="Your performance"
                title="Your video"
                status={<Status tone={perfState.tone}>{perfState.text}</Status>}
              >
                {!sUrl ? (
                  <>
                    <DropZone
                      className="min-h-[220px]"
                      icon={<Upload size={20} />}
                      title="Add your video"
                      hint="From your gallery, Google Drive or Files · MP4, MOV or WebM"
                      onFile={chooseStudent}
                      onReject={notAVideo}
                      testId="student-file"
                    />
                    {isPhone && (
                      <label className={`${solid} w-full cursor-pointer`}>
                        <Camera size={14} /> Record yourself now
                        <input
                          type="file"
                          accept="video/*"
                          capture="user"
                          className="sr-only"
                          onChange={(e: ChangeEvent<HTMLInputElement>) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) chooseStudent(f);
                          }}
                        />
                      </label>
                    )}
                    {guidelines}
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <VideoPanel
                        ref={studentRef}
                        src={sUrl}
                        track={sTrack}
                        label={sTrack ? "Performance · traced on this device" : "Performance"}
                        aspect={sAspect}
                        onLoaded={(v) => {
                          setSAspect(v.videoWidth / v.videoHeight);
                          void resolveDuration(v);
                        }}
                      />
                      <FileRow name={sName} label="Replace" onFile={chooseStudent} onReject={notAVideo} testId="student-file" disabled={!!busy} />
                    </div>
                    {modeSwitch}
                    <p className="text-[0.85rem] leading-snug text-foreground/55">
                      {mode === "class"
                        ? "Each segment of your performance is found wherever it appears in the class video, and checked on its own."
                        : "The reference segment is found in your video: extra bits, pauses and a different speed are fine."}
                    </p>
                    {busyLine("student")}
                    {guidelines}
                  </>
                )}
              </Panel>
            </section>

            {/* action bar */}
            <div className="sticky bottom-3 z-20 mt-5">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-md border border-foreground/12 bg-background/85 px-3 py-2.5 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.55)] backdrop-blur sm:px-4 sm:py-3">
                <span className="hidden flex-wrap items-center gap-x-5 gap-y-2 sm:flex">
                  <ReadinessItem label="Reference" state={refState} />
                  <ReadinessItem label="Performance" state={perfState} />
                </span>
                {busy?.who === "analysis" && (
                  <span className="flex min-w-0 items-center gap-2 text-[0.85rem] text-foreground/70" role="status">
                    <Loader2 size={14} className="shrink-0 animate-spin text-primary" />
                    <span className="truncate">{busy.p?.message ?? "Comparing"}</span>
                  </span>
                )}
                <span className="hidden flex-1 sm:block" />
                {result && editing && (
                  <button type="button" className={ghostBtn} onClick={() => setEditing(false)} disabled={!!busy}>
                    Back to report
                  </button>
                )}
                <button type="button" className={`${solid} flex-1 px-6 sm:flex-none`} onClick={runAll} disabled={!canRun} data-testid="analyse-student">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Run analysis
                </button>
              </div>
            </div>
          </>
        )}

        {/* ---------------- report ---------------- */}
        {showReport && result && tUrl && sUrl && (
          <section ref={reportRef} className="mt-10 scroll-mt-28 space-y-8" data-testid="results" aria-labelledby="report-title">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div className="space-y-2">
                <Eyebrow tone="primary">
                  Analysis report{lesson && lesson.steps.length ? ` · segment ${activeStep + 1} of ${lesson.steps.length}` : ""}
                </Eyebrow>
                <h2 id="report-title" className="text-[clamp(1.6rem,3vw,2.2rem)] font-medium leading-tight">
                  {headline}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {result.found && result.timing.text && <MetaChip>{result.timing.text}</MetaChip>}
                  {result.mirrored && <MetaChip>Compared mirrored</MetaChip>}
                  {result.found && result.tries.length > 1 && <MetaChip>{result.tries.length} repetitions found</MetaChip>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {modeSwitch}
                <FilePick className={ghostBtn} label="New performance" icon={<Upload size={13} />} onFile={chooseStudent} onReject={notAVideo} />
                <button
                  type="button"
                  className={ghostBtn}
                  onClick={() => {
                    resetAll();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <RotateCcw size={13} /> New analysis
                </button>
              </div>
            </div>

            {lesson && sTrack && <LessonNav lesson={lesson} duration={sTrack.range[1]} active={activeStep} onSelect={selectStep} />}

            <div className="space-y-3">
              <div ref={videosRef} className="grid gap-4 md:grid-cols-2">
                <VideoPanel
                  ref={tPlayRef}
                  src={tUrl}
                  track={tTrack}
                  label="Reference"
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
                  label={result.mirrored ? "Your performance (compared mirrored)" : "Your performance"}
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
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-foreground/12 bg-foreground/[0.02] p-2">
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
                  Teacher overlay
                </label>
                <button type="button" className={ghostBtn} onClick={() => setTeacherSound((x) => !x)}>
                  Audio: {teacherSound ? "reference" : "yours"}
                </button>
              </div>
            </div>

            <Results result={result} parts={parts} onParts={changeParts} onShowMe={showMe} activeTip={activeTip?.id ?? null} />
            {busyLine("analysis")}
            {lesson && <LessonGaps lesson={lesson} onWatchClass={(sp) => watchOne("teacher", sp)} onWatchYou={(sp) => watchOne("student", sp)} />}
          </section>
        )}

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-foreground/10 pt-6 text-[0.85rem] text-foreground/50">
          <p className="flex items-start gap-2">
            <ShieldCheck size={15} className="mt-0.5 shrink-0" />
            Videos stay on this device. Saved references hold the traced figure only, never video. The first analysis downloads about{" "}
            {MODEL_DOWNLOAD_MB} MB of models.
          </p>
          <button
            type="button"
            className={ghostBtn}
            onClick={async () => {
              await deleteSavedSteps().catch(() => undefined);
              forgetSessionStep();
              setRestored(null);
              setSaved(false);
              setNote("Saved references were deleted from this device.");
            }}
          >
            <Trash2 size={13} /> Delete saved references
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page furniture                                                       */
/* ------------------------------------------------------------------ */

type Tone = "empty" | "idle" | "busy" | "ready";
interface Readiness {
  tone: Tone;
  text: string;
}

const TONE: Record<Tone, string> = {
  empty: "border-foreground/15 text-foreground/45",
  idle: "border-foreground/25 text-foreground/70",
  busy: "border-primary/50 text-primary",
  ready: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
};

function Status({ tone, children, testId }: { tone: Tone; children: ReactNode; testId?: string }) {
  return (
    <span className={`mono inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] ${TONE[tone]}`} data-testid={testId}>
      {tone === "ready" ? <Check size={11} strokeWidth={3} /> : tone === "busy" ? <Loader2 size={11} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** A card of the workspace: a header bar (kicker, title, status) over its content. */
function Panel({ kicker, title, status, children }: { kicker: string; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-md border border-foreground/12 bg-foreground/[0.02]" aria-label={kicker}>
      <header className="flex items-center justify-between gap-3 border-b border-foreground/10 px-5 py-3.5">
        <div className="min-w-0">
          <p className="mono text-[9px] uppercase tracking-[0.2em] text-primary">{kicker}</p>
          <h2 className="mt-0.5 truncate text-[1.05rem] font-medium">{title}</h2>
        </div>
        {status}
      </header>
      <div className="flex-1 space-y-5 p-5">{children}</div>
    </section>
  );
}

function ReadinessItem({ label, state }: { label: string; state: Readiness }) {
  return (
    <span className="flex items-center gap-2">
      <span className="mono text-[9px] uppercase tracking-[0.18em] text-foreground/45">{label}</span>
      <Status tone={state.tone}>{state.text}</Status>
    </span>
  );
}

function Summary({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="min-w-0">
      <p className="mono text-[9px] uppercase tracking-[0.18em] text-foreground/45">{label}</p>
      <p className="mt-0.5 max-w-[26ch] truncate text-[0.92rem] text-foreground/85" title={value}>
        {value}
        {meta && <span className="mono ml-2 text-[10px] text-foreground/45">{meta}</span>}
      </p>
    </div>
  );
}

function MetaChip({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-foreground/15 px-3 py-1 text-[0.8rem] text-foreground/65">{children}</span>;
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/10 text-primary">{icon}</span>
      <div>
        <p className="text-[0.95rem] font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[0.85rem] leading-snug text-foreground/55">{children}</p>
      </div>
    </li>
  );
}

function Guideline({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 rounded-md border border-foreground/10 px-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <span>
        <span className="block text-[0.85rem] font-medium text-foreground/85">{title}</span>
        <span className="block text-[0.8rem] leading-snug text-foreground/50">{children}</span>
      </span>
    </li>
  );
}

/** A two-way switch, as a row of buttons (radio semantics). */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; testId?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex min-w-0 flex-col gap-1.5">
      <span className="mono text-[9px] uppercase tracking-[0.18em] text-foreground/45">{label}</span>
      <div className="inline-flex rounded-full border border-foreground/15 p-0.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={disabled}
            data-testid={o.testId}
            onClick={() => value !== o.value && onChange(o.value)}
            className={`mono rounded-full px-3.5 py-1.5 text-[10px] uppercase tracking-[0.12em] transition-colors disabled:opacity-50 ${
              value === o.value ? "bg-primary text-white dark:text-black" : "text-foreground/65 hover:text-primary"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
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
