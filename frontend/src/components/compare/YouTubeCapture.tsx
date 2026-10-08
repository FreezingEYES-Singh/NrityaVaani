"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, Link2, Loader2, Square, X } from "lucide-react";
import { canRecordTab, recordElement, type TabRecording } from "@/lib/compare/tabRecord";
import { youTubeId } from "@/lib/compare/youtube";

/**
 * Use a YouTube video: paste a link, play it here in YouTube's own player, and
 * record the part you need from this tab (Region Capture, Chrome and Edge on a
 * computer). Nothing is downloaded from YouTube and nothing is drawn on its
 * player: the recording is a video file in this tab, used like a chosen file.
 */

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}
type YTWindow = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };

const ENDED = 0;

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  const w = window as YTWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (w.YT) resolve(w.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      s.remove();
      reject(new Error("YouTube didn't load. Check your connection, or allow youtube.com in your blocker."));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

const PLAYER_ERRORS: Record<number, string> = {
  2: "That link doesn't point to a YouTube video.",
  5: "This video can't play in the browser's player.",
  100: "This video wasn't found. It may be private or removed.",
  101: "The video's owner doesn't allow it to be played on other sites, so it can't be used here.",
  150: "The video's owner doesn't allow it to be played on other sites, so it can't be used here.",
};

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

interface Props {
  /** Called with the recording, as a video file. */
  onFile: (f: File) => void;
  disabled?: boolean;
  /** Whose video this is, for the wording. */
  who: "teacher" | "student";
}

export default function YouTubeCapture({ onFile, disabled, who }: Props) {
  const [link, setLink] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rec, setRec] = useState<{ since: number; from: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [supported, setSupported] = useState(true);

  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const recRef = useRef<TabRecording | null>(null);
  // the player's callbacks are made once per video; they call the latest stop()
  const stopRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => setSupported(canRecordTab()), []);

  // the player lives in a node React doesn't own, since YouTube replaces it with an iframe
  useEffect(() => {
    if (!id) return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        const target = document.createElement("div");
        host.appendChild(target);
        playerRef.current = new YT.Player(target, {
          videoId: id,
          host: "https://www.youtube-nocookie.com",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
          events: {
            onReady: () => setLoading(false),
            onStateChange: (e) => {
              if (e.data === ENDED) void stopRef.current();
            },
            onError: (e) => {
              setLoading(false);
              setError(PLAYER_ERRORS[e.data] ?? "YouTube couldn't play this video.");
            },
          },
        });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoading(false);
        setError(err.message);
      });
    return () => {
      cancelled = true;
      recRef.current?.cancel();
      recRef.current = null;
      playerRef.current?.destroy();
      playerRef.current = null;
      host.replaceChildren();
    };
  }, [id]);

  useEffect(() => {
    if (!rec) return;
    const t = window.setInterval(() => setElapsed((performance.now() - rec.since) / 1000), 250);
    return () => window.clearInterval(t);
  }, [rec]);

  const load = () => {
    const v = youTubeId(link);
    if (!v) {
      setError("Paste a YouTube link, like https://www.youtube.com/watch?v=… or https://youtu.be/…");
      return;
    }
    setError(null);
    setId(v);
  };

  const start = async () => {
    const frame = frameRef.current;
    const player = playerRef.current;
    if (!frame || !player || recRef.current) return;
    setError(null);
    frame.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    try {
      const r = await recordElement(frame);
      recRef.current = r;
      r.onEnded = () => void stopRef.current();
      setElapsed(0);
      setRec({ since: performance.now(), from: player.getCurrentTime() });
      player.playVideo();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const stop = async () => {
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    playerRef.current?.pauseVideo();
    const from = playerRef.current?.getCurrentTime() ?? 0;
    setRec(null);
    try {
      const blob = await r.stop();
      if (blob.size < 1000) throw new Error("Nothing was recorded. Try again, and keep this tab in front while it records.");
      onFile(new File([blob], `youtube-${id}-${fmt(from).replace(":", "m")}s.webm`, { type: blob.type || "video/webm" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    stopRef.current = stop;
  });

  const input =
    "mono min-w-0 flex-1 rounded-full border border-foreground/15 bg-foreground/[0.03] px-4 py-2.5 text-[11px] text-foreground placeholder:text-foreground/35 focus:border-primary/70 focus:outline-none disabled:opacity-40";
  const pill =
    "mono inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[10px] uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-foreground/12 text-primary">
          <Link2 size={16} />
        </span>
        <p className="mono text-[10px] uppercase tracking-[0.16em] text-foreground/80">Or use a YouTube video</p>
      </div>

      {!id && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input
            type="url"
            inputMode="url"
            className={input}
            placeholder="Paste a YouTube link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={disabled}
            aria-label="YouTube link"
            data-testid={`${who}-youtube-link`}
          />
          <button type="submit" className={`${pill} border border-foreground/20 text-foreground/75 hover:border-primary/60 hover:text-primary`} disabled={disabled || !link.trim()}>
            Load video
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-[0.9rem] leading-snug text-rose-500 dark:text-rose-400">
          {error}
        </p>
      )}

      {id && (
        <div className="space-y-3">
          <div ref={frameRef} className="relative mx-auto aspect-video w-full overflow-hidden rounded-sm border border-foreground/12 bg-black">
            <div ref={hostRef} className="absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full" />
            {loading && (
              <div className="absolute inset-0 grid place-items-center text-foreground/60">
                <Loader2 size={20} className="animate-spin" />
              </div>
            )}
          </div>

          {supported ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {rec ? (
                  <button type="button" className={`${pill} bg-rose-600 font-medium text-white hover:bg-rose-600/85`} onClick={() => void stop()}>
                    <Square size={12} /> Stop · {fmt(elapsed)}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`${pill} bg-primary font-medium text-white hover:bg-primary/85 dark:text-black`}
                    onClick={() => void start()}
                    disabled={disabled || loading}
                  >
                    <Circle size={12} className="fill-current" /> Record from here
                  </button>
                )}
                <button
                  type="button"
                  className={`${pill} border border-foreground/20 text-foreground/70 hover:border-primary/60 hover:text-primary`}
                  onClick={() => {
                    setId(null);
                    setRec(null);
                  }}
                  disabled={!!rec}
                >
                  <X size={12} /> Other link
                </button>
                {rec && (
                  <span className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-rose-500">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> Recording this tab
                  </span>
                )}
              </div>
              <p className="serif text-[0.95rem] leading-relaxed text-foreground/60">
                Play the video to just before the {who === "teacher" ? "step" : "part"}, then tap <strong className="font-semibold text-foreground">Record from here</strong>{" "}
                and choose <strong className="font-semibold text-foreground">This tab</strong> when the browser asks. Tap Stop when it&apos;s done; you can
                trim it next. Keep this tab in front and don&apos;t scroll while it records. The recording stays on this device.
              </p>
            </>
          ) : (
            <p className="flex items-start gap-2 text-[0.9rem] leading-snug text-foreground/65">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              Recording a YouTube video needs Chrome or Edge on a computer. On this browser you can watch it here, or choose a video file instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
