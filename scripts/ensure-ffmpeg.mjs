#!/usr/bin/env node
/**
 * Garante ffmpeg e ffprobe em src-tauri/binaries/ com o nome que o Tauri exige
 * (nome-<target triple>[.exe]). Roda sozinho no `npm install` (postinstall).
 *
 * - Windows: baixa o build LGPL do FFmpeg 8.1 (BtbN/FFmpeg-Builds), sem libx264/libx265.
 * - Linux/macOS (desenvolvimento): cria links para o ffmpeg do PATH.
 *
 * No postinstall, uma falha só avisa (o npm install não quebra); `npm run ffmpeg` falha de verdade.
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
const fromPostinstall = process.env.npm_lifecycle_event === "postinstall";
const names = ["ffmpeg", "ffprobe"];

function targetTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    return /host: (\S+)/.exec(out)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Extrai um .zip no Windows. Usa o tar do próprio Windows (bsdtar, abre .zip) pelo
 * caminho completo, porque o `tar` do Git que costuma estar no PATH não abre .zip.
 * Se não existir, cai para o Expand-Archive do PowerShell (mais lento).
 */
function extractZipWindows(zip, dest) {
  const systemTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  if (existsSync(systemTar)) {
    try {
      execFileSync(systemTar, ["-xf", zip, "-C", dest], { stdio: "inherit" });
      return;
    } catch (e) {
      console.warn(`[ffmpeg] tar do Windows falhou (${e.message}); tentando o PowerShell…`);
    }
  }
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`],
    { stdio: "inherit" },
  );
}

async function installWindows(target) {
  const work = mkdtempSync(join(tmpdir(), "ffmpeg-"));
  try {
    const zip = join(work, "ffmpeg.zip");
    console.log(`[ffmpeg] baixando FFmpeg ${FFMPEG_VERSION} LGPL (~160 MB)…`);
    const res = await fetch(WIN_URL);
    if (!res.ok) throw new Error(`download falhou: HTTP ${res.status} em ${WIN_URL}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    console.log("[ffmpeg] extraindo…");
    extractZipWindows(zip, work);
    const bin = join(work, WIN_ZIP, "bin");
    for (const n of names) copyFileSync(join(bin, `${n}.exe`), target(n));
    copyFileSync(join(work, WIN_ZIP, "LICENSE.txt"), join(binDir, "FFMPEG-LICENSE.txt"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function linkFromPath(target) {
  for (const n of names) {
    const found = execFileSync("which", [n], { encoding: "utf8" }).trim();
    rmSync(target(n), { force: true });
    symlinkSync(found, target(n));
  }
}

async function main() {
  const triple = targetTriple();
  if (!triple) throw new Error("rustc não encontrado. Instale o Rust (rustup.rs) e rode `npm run ffmpeg`.");
  const ext = triple.includes("windows") ? ".exe" : "";
  const target = (name) => join(binDir, `${name}-${triple}${ext}`);

  if (names.every((n) => existsSync(target(n)))) {
    console.log(`[ffmpeg] já instalado em src-tauri/binaries (${triple}).`);
    return;
  }
  mkdirSync(binDir, { recursive: true });

  if (process.platform === "win32") {
    await installWindows(target);
    console.log("[ffmpeg] pronto.");
  } else {
    linkFromPath(target);
    console.log(`[ffmpeg] links criados para o FFmpeg do sistema (${triple}).`);
  }
}

try {
  await main();
} catch (e) {
  console.error(`\n[ffmpeg] Não foi possível preparar o FFmpeg: ${e.message}`);
  console.error("[ffmpeg] O app não compila sem ele. Corrija e rode: npm run ffmpeg\n");
  process.exit(fromPostinstall ? 0 : 1);
}
