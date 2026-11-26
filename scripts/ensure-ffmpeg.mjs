#!/usr/bin/env node
/**
 * Garante ffmpeg e ffprobe em src-tauri/binaries/ com o nome que o Tauri exige
 * (nome-<target triple>[.exe]). Roda sozinho no `npm install` (postinstall).
 *
 * - Windows: baixa o build LGPL do FFmpeg 8.1 (BtbN/FFmpeg-Builds), sem libx264/libx265.
 * - Linux/macOS (desenvolvimento): cria links para o ffmpeg do PATH.
 *
 * Forçar novo download: apagar src-tauri/binaries/ffmpeg-* e rodar `npm run ffmpeg`.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FFMPEG_VERSION = "8.1";
const WIN_ZIP = `ffmpeg-n${FFMPEG_VERSION}-latest-win64-lgpl-${FFMPEG_VERSION}`;
const WIN_URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${WIN_ZIP}.zip`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "src-tauri", "binaries");

function targetTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    return /host: (\S+)/.exec(out)?.[1];
  } catch {
    return undefined;
  }
}

const triple = targetTriple();
if (!triple) {
  console.warn("[ffmpeg] rustc não encontrado; instale o Rust e rode `npm run ffmpeg`.");
  process.exit(0);
}
const ext = triple.includes("windows") ? ".exe" : "";
const target = (name) => join(binDir, `${name}-${triple}${ext}`);
const names = ["ffmpeg", "ffprobe"];

if (names.every((n) => existsSync(target(n)))) {
  console.log(`[ffmpeg] já instalado em src-tauri/binaries (${triple}).`);
  process.exit(0);
}
mkdirSync(binDir, { recursive: true });

if (process.platform === "win32") {
  const work = mkdtempSync(join(tmpdir(), "ffmpeg-"));
  const zip = join(work, "ffmpeg.zip");
  console.log(`[ffmpeg] baixando FFmpeg ${FFMPEG_VERSION} LGPL (~160 MB)…`);
  const res = await fetch(WIN_URL);
  if (!res.ok) throw new Error(`download falhou: ${res.status} ${WIN_URL}`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // O tar do Windows 10+ (bsdtar) extrai .zip.
  execFileSync("tar", ["-xf", zip, "-C", work], { stdio: "inherit" });
  for (const n of names) copyFileSync(join(work, WIN_ZIP, "bin", `${n}.exe`), target(n));
  copyFileSync(join(work, WIN_ZIP, "LICENSE.txt"), join(binDir, "FFMPEG-LICENSE.txt"));
  rmSync(work, { recursive: true, force: true });
  console.log("[ffmpeg] pronto.");
} else {
  for (const n of names) {
    let found;
    try {
      found = execFileSync("which", [n], { encoding: "utf8" }).trim();
    } catch {
      console.warn(`[ffmpeg] ${n} não está no PATH. Instale o FFmpeg (apt, brew) e rode \`npm run ffmpeg\`.`);
      process.exit(0);
    }
    rmSync(target(n), { force: true });
    symlinkSync(found, target(n));
  }
  console.log(`[ffmpeg] links criados para o FFmpeg do sistema (${triple}).`);
}
