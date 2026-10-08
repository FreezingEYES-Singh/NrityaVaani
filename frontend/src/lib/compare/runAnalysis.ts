/** Browser-only: analyze() or analyzeLesson() in a Web Worker, or on the page if workers aren't available. */
import { analyze, analyzeLesson } from "./analyze";
import type { CompareResult, LessonResult, PartSwitches, PoseTrack } from "./types";

let worker: Worker | null = null;
let failed = false;
let seq = 0;
/** Teacher frames x student frames past which a crashed worker isn't retried on the page. */
const HUGE = 1.5e8;

type Mode = "one" | "class";
const onPage = (mode: Mode, teacher: PoseTrack, student: PoseTrack, parts: PartSwitches) =>
  mode === "class" ? analyzeLesson(teacher, student, parts) : analyze(teacher, student, parts);

function run(mode: Mode, teacher: PoseTrack, student: PoseTrack, parts: PartSwitches): Promise<CompareResult | LessonResult> {
  if (!failed && typeof Worker !== "undefined") {
    try {
      worker ??= new Worker(new URL("./analyze.worker.ts", import.meta.url), { type: "module" });
      const w = worker;
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const onMsg = (e: MessageEvent<{ id: number; result?: CompareResult | LessonResult; error?: string }>) => {
          if (e.data.id !== id) return;
          w.removeEventListener("message", onMsg);
          w.removeEventListener("error", onErr);
          if (e.data.result) resolve(e.data.result);
          else reject(new Error(e.data.error ?? "analysis failed"));
        };
        const onErr = () => {
          w.removeEventListener("message", onMsg);
          w.removeEventListener("error", onErr);
          failed = true;
          worker = null;
          // a worker that died on very long videos most likely ran out of memory: running it
          // again on the page would freeze or crash the tab, so say so instead
          if (teacher.frames.length * student.frames.length > HUGE) reject(new Error("out of memory"));
          else resolve(onPage(mode, teacher, student, parts));
        };
        w.addEventListener("message", onMsg);
        w.addEventListener("error", onErr);
        w.postMessage({ id, mode, teacher, student, parts });
      });
    } catch {
      failed = true;
    }
  }
  return new Promise((resolve) => setTimeout(() => resolve(onPage(mode, teacher, student, parts)), 0));
}

/** One step: the teacher's marked step, found in the student's video. */
export function runAnalysis(teacher: PoseTrack, student: PoseTrack, parts: PartSwitches): Promise<CompareResult> {
  return run("one", teacher, student, parts) as Promise<CompareResult>;
}

/** Class mode: the student's dance, found step by step in the teacher's (long) video. */
export function runLesson(teacher: PoseTrack, student: PoseTrack, parts: PartSwitches): Promise<LessonResult> {
  return run("class", teacher, student, parts) as Promise<LessonResult>;
}

export function stopAnalysisWorker(): void {
  worker?.terminate();
  worker = null;
}
