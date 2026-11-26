# Sidecars

Binários do FFmpeg 8.x (build LGPL, sem libx264/libx265) entram aqui na tarefa T1.04,
nomeados com o target triple, como o Tauri exige:

- `ffmpeg-x86_64-pc-windows-msvc.exe`
- `ffprobe-x86_64-pc-windows-msvc.exe`

Não são versionados no git (ver .gitignore). O script de download fica em `scripts/`.
