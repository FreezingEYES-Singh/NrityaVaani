/** Browser-only: analyze() in a Web Worker, or on the page if workers aren't available. */
import { analyze } from "./analyze";
import type { CompareResult, PartSwitches, PoseTrack } from "./types";

let worker: Worker | null = null;
let failed = false;
let seq = 0;
/** Teacher frames x student frames past which a crashed worker isn't retried on the page. */
const HUGE = 1.5e8;

export function runAnalysis(teacher: PoseTrack, student: PoseTrack, parts: PartSwitches): Promise<CompareResult> {
  if (!failed && typeof Worker !== "undefined") {
    try {
      worker ??= new Worker(new URL("./analyze.worker.ts", import.meta.url), { type: "module" });
      const w = worker;
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const onMsg = (e: MessageEvent<{ id: number; result?: CompareResult; error?: string }>) => {
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
          else resolve(analyze(teacher, student, parts));
        };
        w.addEventListener("message", onMsg);
        w.addEventListener("error", onErr);
        w.postMessage({ id, teacher, student, parts });
      });
    } catch {
      failed = true;
    }
  }
  return new Promise((resolve) => setTimeout(() => resolve(analyze(teacher, student, parts)), 0));
}

export function stopAnalysisWorker(): void {
  worker?.terminate();
  worker = null;
}
