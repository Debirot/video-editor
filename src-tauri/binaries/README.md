# Sidecars

FFmpeg 8.1 (build LGPL do BtbN/FFmpeg-Builds, sem libx264/libx265), com o nome que o Tauri exige:

- `ffmpeg-x86_64-pc-windows-msvc.exe`
- `ffprobe-x86_64-pc-windows-msvc.exe`
- `FFMPEG-LICENSE.txt`

`npm install` baixa sozinho (scripts/ensure-ffmpeg.mjs). Para baixar de novo, apague os
arquivos e rode `npm run ffmpeg`. No Linux e no macOS o script cria links para o FFmpeg do PATH.
Não são versionados no git (ver .gitignore).
