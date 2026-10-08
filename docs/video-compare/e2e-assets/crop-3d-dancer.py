"""Crops a record-3d-dancer.mjs recording to the 3D view, as VP9 WebM at 25 fps.

    python3 crop-3d-dancer.py <recorder JSON> <seconds> <out.webm>

Playwright's page video lags the page by a second or so, so the clip doesn't start at
the recorder's tPlay: it starts at the first frame after it where the 3D studio's bright
floor fills the lower half of the crop (the page around the player is dark).
"""
import json
import subprocess
import sys

info, dur, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
d = json.load(open(info))
b = d["box"]
x, y = int(round(b["x"])), max(0, int(round(b["y"])))
w, h = int(b["width"]) // 2 * 2, int(b["height"]) // 2 * 2
crop = f"crop={w}:{h}:{x}:{y}"


def floor_brightness(t: float) -> float:
    px = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(t), "-i", d["video"], "-vf", crop + ",scale=40:22,format=gray", "-frames:v", "1", "-f", "rawvideo", "-"],
        capture_output=True,
        check=True,
    ).stdout
    lower = px[len(px) // 2 :]
    return sum(lower) / max(1, len(lower))


start = d["tPlay"]
while floor_brightness(start) < 40:
    start += 0.1
    if start > d["tPlay"] + 5:
        sys.exit("the 3D view never appeared in the recording")
start += 0.2  # past the first repaint
subprocess.run(
    ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.2f}", "-t", str(dur), "-i", d["video"], "-vf", crop + ",fps=25",
     "-c:v", "libvpx-vp9", "-b:v", "1200k", "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "8", "-an", out],
    check=True,
)
print(f"{out}: {dur:.1f} s from {start:.2f} s of the recording")
