#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_file="${project_dir}/public/media/payzoll-global-payments.mp4"
generated_dir="${project_dir}/public/media/.generated"
render_file="${generated_dir}/payzoll-promo-render.mp4"

mkdir -p "${generated_dir}"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=64:duration=18:sample_rate=48000" \
  -f lavfi -i "sine=frequency=128:duration=18:sample_rate=48000" \
  -filter_complex "[0:a]volume=0.025[a0];[1:a]volume=0.009[a1];[a0][a1]amix=inputs=2,afade=t=in:st=0:d=1,afade=t=out:st=16:d=2" \
  -ar 48000 -ac 2 -c:a pcm_s16le "${generated_dir}/payzoll-promo-bed.wav"

cd "${project_dir}"
corepack pnpm exec remotion render \
  video/index.ts \
  PayZollPromo \
  "${render_file}" \
  --codec=h264 \
  --crf=20 \
  --pixel-format=yuv420p \
  --overwrite

ffmpeg -hide_banner -loglevel error -y -i "${render_file}" -t 18 -c copy "${output_file}"
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt:format=duration \
  -of default=noprint_wrappers=1 "${output_file}"
