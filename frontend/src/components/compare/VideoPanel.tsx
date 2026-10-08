"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { JointMarker, PoseFrame, PoseTrack, Pt } from "@/lib/compare/types";

/**
 * A <video> with the stick figure drawn over it (05-mvp.md §3.6, "Marking joints").
 *
 * - The canvas has the video's own aspect ratio, so landmarks line up with no letterboxing.
 * - Joints the model isn't sure about are drawn faded, never red.
 * - "Show me" marks a joint with a thick limb, a ring and an arrow, so it doesn't rely on colour.
 * - The ghost is the teacher's figure fitted onto the student's hips and torso.
 */

const BODY: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];
const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];

export interface Ghost {
  track: PoseTrack;
  /** Teacher time for the student's current time. */
  timeAt: (s: number) => number;
  /** Draw the teacher's figure mirrored (the student was compared mirrored). */
  mirrored: boolean;
}

export interface VideoPanelHandle {
  video: HTMLVideoElement | null;
}

/** Nearest frame to time t (frames sorted by t), or null if none is within 0.2 s. */
export function frameAt(track: PoseTrack | null, t: number): PoseFrame | null {
  const f = track?.frames;
  if (!f?.length) return null;
  let lo = 0;
  let hi = f.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (f[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const cand = [f[lo], f[Math.max(0, lo - 1)]].filter(Boolean);
  let best = cand[0];
  for (const c of cand) if (Math.abs(c.t - t) < Math.abs(best.t - t)) best = c;
  return Math.abs(best.t - t) <= 0.2 ? best : null;
}

function readColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  H: number,
  color: string,
  width: number,
  alpha: number,
) {
  ctx.lineCap = "round";
  for (const [a, b] of BODY) {
    const p = pts[a];
    const q = pts[b];
    const sure = Math.min(p.v, q.v) >= 0.5;
    ctx.globalAlpha = alpha * (sure ? 0.95 : 0.25);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(p.x * H, p.y * H);
    ctx.lineTo(q.x * H, q.y * H);
    ctx.stroke();
  }
  for (const j of JOINTS) {
    const p = pts[j];
    ctx.globalAlpha = alpha * (p.v >= 0.5 ? 1 : 0.25);
    ctx.fillStyle = "#ffe0a8";
    ctx.beginPath();
    ctx.arc(p.x * H, p.y * H, width * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMarker(ctx: CanvasRenderingContext2D, pts: Pt[], H: number, m: JointMarker, joints: number[], scale: number) {
  if (!joints.length) return;
  ctx.save();
  ctx.lineCap = "round";
  // the limb, thick, with a dark outline so it reads on any background
  for (let i = 0; i + 1 < joints.length; i++) {
    const p = pts[joints[i]];
    const q = pts[joints[i + 1]];
    for (const [w, c] of [[10 * scale, "rgba(0,0,0,0.65)"], [6 * scale, "#ffffff"]] as const) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(p.x * H, p.y * H);
      ctx.lineTo(q.x * H, q.y * H);
      ctx.stroke();
    }
  }
  const end = pts[joints[joints.length - 1]];
  const ex = end.x * H;
  const ey = end.y * H;
  const r = 16 * scale;
  ctx.lineWidth = 4 * scale;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.beginPath();
  ctx.arc(ex, ey, r + 2 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.arc(ex, ey, r, 0, Math.PI * 2);
  ctx.stroke();
  if (m.arrow) {
    const len = 46 * scale;
    const ax = ex + m.arrow.dx * (r + 4 * scale);
    const ay = ey + m.arrow.dy * (r + 4 * scale);
    const bx = ax + m.arrow.dx * len;
    const by = ay + m.arrow.dy * len;
    const ang = Math.atan2(by - ay, bx - ax);
    for (const [w, c] of [[8 * scale, "rgba(0,0,0,0.65)"], [4 * scale, "#ffffff"]] as const) {
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(ang) * w, by + Math.sin(ang) * w);
      ctx.lineTo(bx - Math.cos(ang - 0.5) * 14 * scale, by - Math.sin(ang - 0.5) * 14 * scale);
      ctx.lineTo(bx - Math.cos(ang + 0.5) * 14 * scale, by - Math.sin(ang + 0.5) * 14 * scale);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** The teacher's pose fitted to the student's: same mid-hip, scaled by torso length, optionally mirrored. */
function fitGhost(teacher: Pt[], student: Pt[], mirrored: boolean): Pt[] {
  const mid = (p: Pt[], a: number, b: number) => ({ x: (p[a].x + p[b].x) / 2, y: (p[a].y + p[b].y) / 2 });
  const tor = (p: Pt[]) => {
    const h = mid(p, 23, 24);
    const s = mid(p, 11, 12);
    return { h, len: Math.hypot(s.x - h.x, s.y - h.y) || 1e-3 };
  };
  const T = tor(teacher);
  const S = tor(student);
  const k = S.len / T.len;
  const src = mirrored ? teacher.map((_, i) => teacher[swap(i)]) : teacher;
  return src.map((p) => ({
    x: S.h.x + (mirrored ? -1 : 1) * (p.x - T.h.x) * k,
    y: S.h.y + (p.y - T.h.y) * k,
    z: p.z,
    v: p.v,
  }));
}
function swap(i: number): number {
  if (i === 0) return 0;
  if (i <= 3) return i + 3;
  if (i <= 6) return i - 3;
  return i % 2 === 1 ? i + 1 : i - 1;
}

interface Props {
  src: string;
  track: PoseTrack | null;
  label: string;
  muted?: boolean;
  marker?: { marker: JointMarker; joints: number[] } | null;
  ghost?: Ghost | null;
  controls?: boolean;
  onLoaded?: (v: HTMLVideoElement) => void;
  aspect?: number;
}

const VideoPanel = forwardRef<VideoPanelHandle, Props>(function VideoPanel(
  { src, track, label, muted = true, marker = null, ghost = null, controls = true, onLoaded, aspect },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ track, marker, ghost });
  stateRef.current = { track, marker, ghost };
  useImperativeHandle(ref, () => ({
    get video() {
      return videoRef.current;
    },
  }));

  useEffect(() => {
    let raf = 0;
    const primary = readColor("--primary", "#FF9933");
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || !v.videoWidth) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(c.clientWidth * dpr);
      const Hc = Math.round(c.clientHeight * dpr);
      if (c.width !== W || c.height !== Hc) {
        c.width = W;
        c.height = Hc;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, W, Hc);
      const { track: tr, marker: mk, ghost: gh } = stateRef.current;
      const f = frameAt(tr, v.currentTime);
      const scale = Hc / 720;
      const lw = Math.max(2, 3.2 * scale);
      if (gh && f?.img) {
        const tf = frameAt(gh.track, gh.timeAt(v.currentTime));
        if (tf?.img) drawFigure(ctx, fitGhost(tf.img, f.img, gh.mirrored), Hc, "#4fd8ff", lw, 0.7);
      }
      if (f?.img) {
        drawFigure(ctx, f.img, Hc, primary, lw, 1);
        if (mk) drawMarker(ctx, f.img, Hc, mk.marker, mk.joints, Math.max(0.6, scale));
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <figure className="m-0">
      <div
        className="relative mx-auto overflow-hidden rounded-2xl border border-card-border bg-black"
        style={{
          aspectRatio: aspect ? `${aspect}` : "16 / 9",
          width: aspect ? `min(100%, calc(62vh * ${aspect}))` : "100%",
        }}
      >
        <video
          ref={videoRef}
          src={src}
          className="absolute inset-0 h-full w-full"
          playsInline
          muted={muted}
          controls={controls}
          preload="auto"
          onLoadedMetadata={(e) => onLoaded?.(e.currentTarget)}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      </div>
      <figcaption className="mono mt-2 text-[10px] uppercase tracking-[0.18em] text-foreground/45">{label}</figcaption>
    </figure>
  );
});

export default VideoPanel;
