/// <reference lib="webworker" />
/** Runs analyze() or analyzeLesson() off the main thread, so a long take doesn't freeze the page. */
import { analyze, analyzeLesson } from "./analyze";
import type { PartSwitches, PoseTrack } from "./types";

self.onmessage = (e: MessageEvent<{ id: number; mode: "one" | "class"; teacher: PoseTrack; student: PoseTrack; parts: PartSwitches }>) => {
  const { id, mode, teacher, student, parts } = e.data;
  try {
    const result = mode === "class" ? analyzeLesson(teacher, student, parts) : analyze(teacher, student, parts);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
