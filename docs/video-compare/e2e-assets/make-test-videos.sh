#!/usr/bin/env bash
# Rebuilds the /compare end-to-end test videos from the site's own 3D dancer.
#   ./make-test-videos.sh <out dir> [base url]
# Needs a running site (npm run build && npx next start -p 3200), Playwright with Chromium,
# python3 and ffmpeg (with libvpx). Videos are VP9/VP8 WebM: Playwright's Chromium can't
# play H.264, while real Chrome, Safari and Firefox play these too.
set -euo pipefail
OUT=${1:?out dir}
BASE=${2:-http://localhost:3200}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT/raw"
VP9=(-c:v libvpx-vp9 -b:v 600k -row-mt 1 -deadline good -cpu-used 4 -an)

node "$HERE/record-3d-dancer.mjs" namaskaram 88.5 18 "$OUT/raw" "$BASE" | tail -1 > "$OUT/namaskaram.json"
python3 "$HERE/crop-3d-dancer.py" "$OUT/namaskaram.json" 16 "$OUT/teacher-namaskaram.webm"
node "$HERE/record-3d-dancer.mjs" thattadavu 52 20 "$OUT/raw" "$BASE" | tail -1 > "$OUT/thattadavu.json"
python3 "$HERE/crop-3d-dancer.py" "$OUT/thattadavu.json" 18 "$OUT/teacher-thattadavu.webm"

T="$OUT/teacher-namaskaram.webm"
# the same take, 3 s of a still frame first, 1.3x slower, 2 s still at the end
ffmpeg -y -v error -i "$T" -vf "setpts=1.3*PTS,fps=25,tpad=start_mode=clone:start_duration=3:stop_mode=clone:stop_duration=2" "${VP9[@]}" "$OUT/student-namaskaram-slow-padded.webm"
ffmpeg -y -v error -i "$T" -vf hflip "${VP9[@]}" "$OUT/student-namaskaram-mirrored.webm"
ffmpeg -y -v error -i "$T" -c:v libvpx -b:v 800k -an "$OUT/student-namaskaram-vp8.webm"
ls -la "$OUT"/*.webm
