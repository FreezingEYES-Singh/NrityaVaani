/**
 * Record one element of this tab as a video file, in the browser.
 *
 * getDisplayMedia() with preferCurrentTab offers only this tab, and Region
 * Capture (CropTarget + cropTo) crops the frames to the element, so the file
 * holds just that box (here, the YouTube player). Chrome and Edge on a
 * computer have both; elsewhere canRecordTab() is false.
 */

type CropTargetApi = { fromElement(el: Element): Promise<unknown> };
type CroppableTrack = MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> };

const cropTargetApi = (): CropTargetApi | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { CropTarget?: CropTargetApi }).CropTarget;

export function canRecordTab(): boolean {
  if (typeof navigator === "undefined" || typeof MediaRecorder === "undefined") return false;
  if (!navigator.mediaDevices?.getDisplayMedia || !cropTargetApi()) return false;
  // phones and tablets don't share a tab
  return !window.matchMedia("(pointer: coarse)").matches;
}

export interface TabRecording {
  /** Stops and returns the video. */
  stop(): Promise<Blob>;
  /** Stops and throws the video away. */
  cancel(): void;
  /** Called if sharing ends from the browser's own "Stop sharing" bar. */
  onEnded?: () => void;
}

const MIME = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];

export async function recordElement(el: Element, fps = 30): Promise<TabRecording> {
  const api = cropTargetApi();
  if (!api || !navigator.mediaDevices?.getDisplayMedia) throw new Error("Recording needs Chrome or Edge on a computer.");
  const target = await api.fromElement(el);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps } },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      monitorTypeSurfaces: "exclude",
    } as DisplayMediaStreamOptions);
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") throw new Error("Recording was cancelled. Tap Record again and choose “This tab”.");
    throw err;
  }
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  const track = stream.getVideoTracks()[0] as CroppableTrack | undefined;
  try {
    if (!track?.cropTo) throw new Error();
    await track.cropTo(target);
  } catch {
    stopTracks();
    throw new Error("Choose “This tab” when the browser asks what to share, so only the video is recorded.");
  }

  const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stopTracks();
      resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" }));
    };
  });
  const rec: TabRecording = {
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
      return done;
    },
    cancel: () => {
      chunks.length = 0;
      if (recorder.state !== "inactive") recorder.stop();
      stopTracks();
    },
  };
  track.addEventListener("ended", () => rec.onEnded?.());
  recorder.start(1000);
  return rec;
}

/**
 * A MediaRecorder WebM has no duration in its header, so the <video> says Infinity
 * until it has read to the end. Seeking far past the end makes it read the length.
 */
export function resolveDuration(video: HTMLVideoElement, timeoutMs = 8000): Promise<number> {
  if (Number.isFinite(video.duration)) return Promise.resolve(video.duration);
  return new Promise((resolve) => {
    const finish = () => {
      video.removeEventListener("durationchange", check);
      video.removeEventListener("timeupdate", check);
      window.clearTimeout(timer);
      const d = video.duration;
      video.currentTime = 0;
      resolve(d);
    };
    const check = () => {
      if (Number.isFinite(video.duration)) finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    video.addEventListener("durationchange", check);
    video.addEventListener("timeupdate", check);
    video.currentTime = 1e101;
  });
}
