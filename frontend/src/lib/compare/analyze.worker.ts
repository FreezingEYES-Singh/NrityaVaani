/// <reference lib="webworker" />
/** Runs analyze() off the main thread, so a long take doesn't freeze the page. */
import { analyze } from "./analyze";
import type { PartSwitches, PoseTrack } from "./types";

self.onmessage = (e: MessageEvent<{ id: number; teacher: PoseTrack; student: PoseTrack; parts: PartSwitches }>) => {
  const { id, teacher, student, parts } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, result: analyze(teacher, student, parts) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
