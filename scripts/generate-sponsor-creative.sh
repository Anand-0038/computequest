#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_file="${project_dir}/public/media/monad-parallel-execution.mp4"
generated_dir="${project_dir}/public/media/.generated"
render_file="${generated_dir}/monad-promo-render.mp4"

mkdir -p "${generated_dir}"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=55:duration=40:sample_rate=48000" \
  -f lavfi -i "sine=frequency=110:duration=40:sample_rate=48000" \
  -filter_complex "[0:a]volume=0.035[a0];[1:a]volume=0.014[a1];[a0][a1]amix=inputs=2,afade=t=in:st=0:d=1.5,afade=t=out:st=37.5:d=2.5" \
  -ar 48000 -ac 2 -c:a pcm_s16le "${generated_dir}/monad-promo-bed.wav"

cd "${project_dir}"
corepack pnpm exec remotion render \
  video/index.ts \
  MonadPromo \
  "${render_file}" \
  --codec=h264 \
  --crf=18 \
  --pixel-format=yuv420p \
  --overwrite

# AAC encoder padding can make the container slightly longer than the 1,200-frame composition.
ffmpeg -hide_banner -loglevel error -y -i "${render_file}" -t 40 -c copy "${output_file}"

ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt:format=duration \
  -of default=noprint_wrappers=1 "${output_file}"
