"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Camera, FileVideo, Loader2, Pause, Play, Save, Sparkles, Trash2, Wand2 } from "lucide-react";
import VideoPanel, { type VideoPanelHandle } from "@/components/compare/VideoPanel";
import TrimBar, { MAX_STEP, MIN_STEP } from "@/components/compare/TrimBar";
import Results from "@/components/compare/Results";
import { Eyebrow, Headline, Prose, Rule } from "@/components/ui/editorial";
import { ALL_PARTS_ON, ExtractError, type CompareResult, type ExtractProgress, type PartSwitches, type PoseTrack, type Tip } from "@/lib/compare/types";
import { MODEL_DOWNLOAD_MB, extractPose, preloadModels, primeVideo } from "@/lib/compare/extract";
import { suggestMovingPart } from "@/lib/compare/motionScan";
import { runAnalysis, stopAnalysisWorker } from "@/lib/compare/runAnalysis";
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

const MAX_STUDENT_SEC = 180;

type Busy = null | { who: "teacher" | "student" | "analysis" | "suggest"; p: ExtractProgress | null };

const fmtEta = (s: number | null) => (s === null ? "" : s > 90 ? `about ${Math.round(s / 60)} min left` : `about ${Math.max(1, Math.round(s))} s left`);

/** Student time -> teacher time along the smoothed map (straight-line beyond its ends). */
function mapTime(map: CompareResult["map"], s: number): number {
  if (!map.length) return s;
  if (map.length === 1) return map[0].t + (s - map[0].s);
  let i = 0;
  while (i < map.length - 2 && s > map[i + 1].s) i++;
  const a = map[i];
  const b = map[i + 1];
  const k = (b.t - a.t) / Math.max(1e-6, b.s - a.s);
  return a.t + (s - a.s) * k;
}
function slopeAt(map: CompareResult["map"], s: number): number {
  if (map.length < 2) return 1;
  let i = 0;
  while (i < map.length - 2 && s > map[i + 1].s) i++;
  return (map[i + 1].t - map[i].t) / Math.max(1e-6, map[i + 1].s - map[i].s);
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
  const [sAspect, setSAspect] = useState<number | undefined>();
  const [sTrack, setSTrack] = useState<PoseTrack | null>(null);
  // result
  const [result, setResult] = useState<CompareResult | null>(null);
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
    setSTrack(null);
    setResult(null);
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

  const chooseTeacher = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setTFile(f);
    setTUrl(track(URL.createObjectURL(f)));
    setTTrack(null);
    setTKey(null);
    setSaved(false);
    setResult(null);
    // start downloading the model while the step is being marked
    void preloadModels().catch(() => undefined);
  };

  const getTeacherVideo = useCallback(() => teacherRef.current?.video ?? null, []);

  const onTeacherLoaded = (v: HTMLVideoElement) => {
    setTVideo(v);
    setTDur(v.duration);
    setTAspect(v.videoWidth / v.videoHeight);
    if (restored && restored.range[1] <= v.duration + 0.5) setRange(restored.range);
    else setRange([0, Math.min(v.duration, 8)]);
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

  const chooseStudent = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setSUrl(track(URL.createObjectURL(f)));
    setSTrack(null);
    setResult(null);
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
        const dur = Number.isFinite(v.duration) ? v.duration : MAX_STUDENT_SEC;
        if (dur > MAX_STUDENT_SEC) setNote(`Only the first ${MAX_STUDENT_SEC / 60} minutes of your video are used.`);
        const s = await extractPose(v, [0, Math.min(dur, MAX_STUDENT_SEC)], { onProgress: onProgress("student"), signal: ac.signal });
        setSTrack(s);
        setBusy({ who: "analysis", p: null });
        setResult(await runAnalysis(tTrack, s, parts));
      } catch (err) {
        if (!(err instanceof ExtractError && err.code === "aborted")) setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  const changeParts = async (p: PartSwitches) => {
    setParts(p);
    if (!tTrack || !sTrack) return;
    setBusy({ who: "analysis", p: null });
    try {
      setResult(await runAnalysis(tTrack, sTrack, p));
      setActiveTip(null);
    } finally {
      setBusy(null);
    }
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

  useEffect(
    () => () => {
      if (syncRef.current !== null) window.clearInterval(syncRef.current);
    },
    [],
  );

  // ?debug=1 exposes the tracks and the result to tests (they never leave the tab)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("debug") === "1")
      (window as unknown as { __compare: unknown }).__compare = { teacher: tTrack, student: sTrack, result };
  }, [tTrack, sTrack, result]);

  const ghostInfo = useMemo(
    () => (ghost && tTrack && result?.found ? { track: tTrack, timeAt: (s: number) => mapTime(result.map, s), mirrored: result.mirrored } : null),
    [ghost, tTrack, result],
  );

  const busyLine = (who: NonNullable<Busy>["who"]) =>
    busy?.who === who ? (
      <div className="space-y-2" role="status">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-border">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round((busy.p?.fraction ?? 0.02) * 100)}%` }} />
        </div>
        <p className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-foreground/55">
          <Loader2 size={12} className="animate-spin" />
          {busy.p?.message ?? (who === "analysis" ? "Comparing" : who === "suggest" ? "Looking for the moving part" : "Starting")}
          {busy.p?.etaSec !== undefined ? ` · ${fmtEta(busy.p?.etaSec ?? null)}` : ""}
        </p>
        {(who === "teacher" || who === "student") && (
          <button type="button" className="mono text-[10px] uppercase tracking-[0.14em] text-foreground/45 underline" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        )}
      </div>
    ) : null;

  const pill =
    "mono inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.14em] transition-colors disabled:opacity-40";
  const solid = `${pill} bg-primary text-white dark:text-black hover:opacity-90`;
  const ghostBtn = `${pill} border border-card-border text-foreground/75 hover:border-primary hover:text-primary`;
  const stepLen = range[1] - range[0];

  return (
    <div className="min-h-screen px-4 pt-28 pb-24 sm:px-6 sm:pt-32">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="space-y-4">
          <Eyebrow tone="primary">Compare · beta</Eyebrow>
          <Headline as="h1">Compare with your teacher</Headline>
          <Prose>
            <p>
              Mark one step in your teacher&apos;s video, then add a video of yourself doing it. The body is found in every
              frame <strong>on this device</strong>: no video or frame is uploaded, and NrityaVaani doesn&apos;t keep your videos.
              The first time, about {MODEL_DOWNLOAD_MB} MB of pose model is downloaded.
            </p>
            <p>
              A YouTube link can&apos;t be used: YouTube doesn&apos;t allow drawing on its player or reading its video. If it is your
              teacher&apos;s own video, they can download it from YouTube Studio and you can choose that file here.
            </p>
          </Prose>
        </header>

        {error && (
          <p role="alert" className="rounded-xl border border-primary/50 px-4 py-3 text-foreground/85">
            {error}
          </p>
        )}
        {note && <p className="serif text-foreground/70">{note}</p>}

        {/* ---------------- 1 ---------------- */}
        <section className="space-y-4" aria-labelledby="step1">
          <Eyebrow>Step 1</Eyebrow>
          <h2 id="step1" className="serif text-2xl">The teacher&apos;s video</h2>
          {restored && !tTrack && (
            <p className="serif text-foreground/70">
              A teacher step from this session was kept. Choose the same teacher video again to continue without processing it again.
            </p>
          )}
          <label className={ghostBtn + " cursor-pointer"}>
            <FileVideo size={14} /> {tUrl ? "Choose another teacher video" : "Choose the teacher video"}
            <input type="file" accept="video/*" className="sr-only" onChange={chooseTeacher} data-testid="teacher-file" />
          </label>
          {tUrl && (
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <VideoPanel
                ref={teacherRef}
                src={tUrl}
                track={tTrack}
                label={tTrack ? "Teacher · stick figure from this device" : "Teacher"}
                aspect={tAspect}
                onLoaded={onTeacherLoaded}
              />
              <div className="space-y-4">
                {tDur > 0 && (
                  <TrimBar
                    video={tVideo}
                    getVideo={getTeacherVideo}
                    duration={tDur}
                    range={range}
                    onChange={(r) => {
                      setRange(r);
                      if (tTrack) {
                        setTTrack(null);
                        setResult(null);
                      }
                    }}
                    disabled={!!busy}
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={ghostBtn} onClick={suggest} disabled={!!busy || !tDur}>
                    <Wand2 size={14} /> Suggest the moving part here
                  </button>
                  <button
                    type="button"
                    className={solid}
                    onClick={prepareTeacher}
                    disabled={!!busy || stepLen < MIN_STEP || stepLen > MAX_STEP + 1e-6}
                    data-testid="prepare-teacher"
                  >
                    <Sparkles size={14} /> {tTrack ? "Prepared" : "Prepare this step"}
                  </button>
                  {tTrack && (
                    <button type="button" className={ghostBtn} onClick={saveStep} disabled={saved}>
                      <Save size={14} /> {saved ? "Saved on this device" : "Save this teacher step"}
                    </button>
                  )}
                </div>
                {busyLine("suggest")}
                {busyLine("teacher")}
                {tTrack && (
                  <p className="mono text-[10px] uppercase tracking-[0.14em] text-foreground/55" data-testid="teacher-ready">
                    Teacher step ready · {tTrack.frames.filter((f) => f.img).length} frames with the dancer
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <Rule />

        {/* ---------------- 2 ---------------- */}
        <section className="space-y-4" aria-labelledby="step2">
          <Eyebrow>Step 2</Eyebrow>
          <h2 id="step2" className="serif text-2xl">Your video</h2>
          <Prose>
            <p>
              Extra bits at the start and end, pauses, doing the step several times, or a different speed are all fine. Stand
              where your whole body is in view, facing the camera the way the teacher does.
            </p>
          </Prose>
          <div className="flex flex-wrap gap-2">
            <label className={ghostBtn + (tTrack ? " cursor-pointer" : " pointer-events-none opacity-40")}>
              <FileVideo size={14} /> Choose a video
              <input type="file" accept="video/*" className="sr-only" onChange={chooseStudent} disabled={!tTrack} data-testid="student-file" />
            </label>
            {isPhone && (
              <label className={ghostBtn + (tTrack ? " cursor-pointer" : " pointer-events-none opacity-40")}>
                <Camera size={14} /> Record
                <input type="file" accept="video/*" capture="user" className="sr-only" onChange={chooseStudent} disabled={!tTrack} />
              </label>
            )}
          </div>
          {!tTrack && <p className="text-sm text-foreground/50">Prepare the teacher step first.</p>}
          {sUrl && !result && (
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <VideoPanel ref={studentRef} src={sUrl} track={sTrack} label="You" aspect={sAspect} onLoaded={(v) => setSAspect(v.videoWidth / v.videoHeight)} />
              <div className="space-y-3">
                <button type="button" className={solid} onClick={analyseStudent} disabled={!!busy || !tTrack} data-testid="analyse-student">
                  <Sparkles size={14} /> Analyse my video
                </button>
                {busyLine("student")}
                {busyLine("analysis")}
              </div>
            </div>
          )}
        </section>

        {/* ---------------- 3 ---------------- */}
        {result && tUrl && sUrl && (
          <>
            <Rule />
            <section className="space-y-6" aria-labelledby="step3" data-testid="results">
              <Eyebrow>Step 3</Eyebrow>
              <h2 id="step3" className="serif text-2xl">How it compares</h2>
              <div className="grid gap-4 md:grid-cols-2">
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
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={solid} onClick={playBoth} disabled={!result.found} data-testid="play-both">
                  {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause" : "Play both"}
                </button>
                <label className={ghostBtn + " cursor-pointer"}>
                  <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} className="accent-[var(--primary)]" disabled={!result.found} />
                  Ghost
                </label>
                <button type="button" className={ghostBtn} onClick={() => setTeacherSound((x) => !x)}>
                  Sound: {teacherSound ? "teacher's" : "mine"}
                </button>
                {result.tries.length > 1 && (
                  <span className="mono text-[10px] uppercase tracking-[0.14em] text-foreground/50">
                    {result.tries.length} tries found
                  </span>
                )}
              </div>
              <Results result={result} parts={parts} onParts={changeParts} onShowMe={showMe} activeTip={activeTip?.id ?? null} />
              {busyLine("analysis")}
              <div className="flex flex-wrap gap-2">
                <label className={ghostBtn + " cursor-pointer"}>
                  <FileVideo size={14} /> Try another video of yourself
                  <input type="file" accept="video/*" className="sr-only" onChange={chooseStudent} />
                </label>
              </div>
            </section>
          </>
        )}

        <Rule />
        <footer className="flex flex-wrap items-center gap-3 text-sm text-foreground/55">
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
