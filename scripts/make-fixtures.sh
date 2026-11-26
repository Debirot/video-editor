#!/usr/bin/env bash
# Gera os vídeos curtos de teste em tests/fixtures/ (não versionados).
# Requer um ffmpeg de desenvolvimento com libx264 e libx265 (só para gerar fixtures;
# o app distribui um build LGPL sem esses encoders).
set -euo pipefail
cd "$(dirname "$0")/../tests/fixtures"
FF="ffmpeg -hide_banner -loglevel error -y"
SRC="testsrc2=size=%s:rate=%s,drawtext=text='%%{pts\\:hms} %%{n}':fontsize=%s:fontcolor=white:box=1:boxcolor=black@0.6:x=40:y=40"
tone="sine=frequency=440:sample_rate=48000"

# 4K H.264 30 fps com áudio AAC (alvo principal da prova técnica).
$FF -f lavfi -i "$(printf "$SRC" 3840x2160 30 96)" -f lavfi -i "$tone" -t 12 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 60 -c:a aac -shortest h264_4k_30.mp4
# Vertical de celular 1080×1920, 29,97 fps.
$FF -f lavfi -i "$(printf "$SRC" 1080x1920 30000/1001 64)" -f lavfi -i "$tone" -t 12 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -shortest h264_vertical_2997.mp4
# 1080p HEVC (o WebView2 só decodifica se o Windows tiver a extensão HEVC).
$FF -f lavfi -i "$(printf "$SRC" 1920x1080 30 64)" -t 12 -c:v libx265 -preset fast -x265-params log-level=error -tag:v hvc1 -pix_fmt yuv420p -an hevc_1080_30.mp4 || echo "sem libx265, pulando HEVC"
# Taxa de quadros variável.
$FF -f lavfi -i "$(printf "$SRC" 1280x720 30 48)" -t 12 -vf "setpts='if(lt(mod(N,10),5),N/30/TB,(N+0.5)/30/TB)'" \
  -fps_mode vfr -c:v libx264 -preset veryfast -pix_fmt yuv420p -an h264_720_vfr.mp4
# Sem áudio, 23,976 fps.
$FF -f lavfi -i "$(printf "$SRC" 1920x1080 24000/1001 64)" -t 12 -c:v libx264 -preset veryfast -pix_fmt yuv420p -an h264_1080_23976_noaudio.mp4
# VP9 em WebM (decodifica em qualquer Chromium, útil fora do Windows).
$FF -f lavfi -i "$(printf "$SRC" 1920x1080 30 64)" -t 12 -c:v libvpx-vp9 -b:v 4M -deadline realtime -cpu-used 8 -an vp9_1080_30.webm

ls -lh
