/**
 * Tela da prova técnica (T1.01). Temporária: some quando o layout real (T1.02)
 * e o preview (T1.07) existirem. Mostra os números que decidem o Portão 0.
 */
import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Gauge, Play, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc, isTauri, mediaReadUrl, mediaWriteUrl } from "@/lib/ipc";
import { formatTimecode, secondsToUs } from "@/lib/time";
import type {
  ExportResult,
  ExportSettings,
  FromWorker,
  MediaRef,
  PlaybackStats,
  SourceInfo,
  ToWorker,
} from "@/engine/messages";

const PROOF_SECONDS = 10;
const PREVIEW_W = 960;
const PREVIEW_H = 540;
const EXPORT_SETTINGS: ExportSettings = {
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  bitrate: 12_000_000,
  durationUs: secondsToUs(PROOF_SECONDS),
};

type ExportState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number }
  | { status: "done"; result: ExportResult; path: string; downloadUrl?: string }
  | { status: "cancelled" };

interface LogLine {
  time: string;
  text: string;
  error?: boolean;
}

export function ProofPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const exportIdRef = useRef<number | null>(null);
  const exportPathRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [env, setEnv] = useState<{ webgl2: boolean; webcodecs: boolean } | null>(null);
  const [source, setSource] = useState<MediaRef | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [info, setInfo] = useState<SourceInfo | null>(null);
  const [play, setPlay] = useState<PlaybackStats | null>(null);
  const [exp, setExp] = useState<ExportState>({ status: "idle" });
  const [openFrames, setOpenFrames] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const tauri = isTauri();

  const addLog = (text: string, error = false) =>
    setLog((l) => [{ time: new Date().toLocaleTimeString(), text, error }, ...l].slice(0, 50));

  const send = (msg: ToWorker, transfer: Transferable[] = []) => workerRef.current?.postMessage(msg, transfer);

  async function finishExport(result: ExportResult, buffer?: ArrayBuffer) {
    if (buffer) {
      const url = URL.createObjectURL(new Blob([buffer], { type: "video/mp4" }));
      setExp({ status: "done", result: { ...result, bytes: buffer.byteLength }, path: "prova.mp4", downloadUrl: url });
    } else if (exportIdRef.current !== null) {
      const bytes = await ipc.finishExport(exportIdRef.current);
      exportIdRef.current = null;
      setExp({ status: "done", result: { ...result, bytes }, path: exportPathRef.current });
    }
    addLog(`Exportado: ${result.frames} quadros em ${(result.elapsedMs / 1000).toFixed(1)} s (${result.codec})`);
  }

  async function abortExport() {
    if (exportIdRef.current !== null) {
      const id = exportIdRef.current;
      exportIdRef.current = null;
      await ipc.cancelExport(id).catch((e) => addLog(String(e), true));
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    // O canvas só pode ser transferido uma vez (o StrictMode monta o efeito duas vezes).
    if (!canvas || workerRef.current || canvas.dataset.transferred) return;
    canvas.dataset.transferred = "1";
    const worker = new Worker(new URL("../../engine/worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const offscreen = canvas.transferControlToOffscreen();
    offscreen.width = PREVIEW_W;
    offscreen.height = PREVIEW_H;
    worker.postMessage({ type: "init", canvas: offscreen } satisfies ToWorker, [offscreen]);

    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const msg = ev.data;
      switch (msg.type) {
        case "ready":
          setEnv({ webgl2: msg.webgl2, webcodecs: msg.webcodecs });
          break;
        case "stats":
          setOpenFrames(msg.openFrames);
          break;
        case "proof:info":
          setInfo(msg.info);
          addLog(`Aberto: ${msg.info.codecString ?? msg.info.codec} ${msg.info.width}×${msg.info.height}`);
          break;
        case "proof:playStats":
          setPlay(msg.stats);
          if (msg.stats.done) addLog(`Reprodução (${msg.stats.mode}): ${msg.stats.fps.toFixed(1)} qps`);
          break;
        case "proof:exportProgress":
          setExp({ status: "running", done: msg.done, total: msg.total });
          break;
        case "proof:exportDone":
          void finishExport(msg.result, msg.buffer);
          break;
        case "proof:exportCancelled":
          void abortExport();
          setExp({ status: "cancelled" });
          addLog("Exportação cancelada, arquivo parcial apagado.");
          break;
        case "error":
          addLog(`Erro ao ${msg.context}: ${msg.message}`, true);
          if (msg.context === "exportar") {
            void abortExport();
            setExp({ status: "idle" });
          }
          break;
      }
    };
    // O worker vive enquanto a janela existir; não há desmontagem nesta tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openRef(ref: MediaRef, name: string) {
    setSource(ref);
    setSourceName(name);
    setInfo(null);
    setPlay(null);
    setExp({ status: "idle" });
    send({ type: "proof:open", source: ref });
  }

  async function pickFile() {
    if (!tauri) {
      fileInputRef.current?.click();
      return;
    }
    const path = await open({
      multiple: false,
      filters: [{ name: "Vídeo", extensions: ["mp4", "mov", "mkv", "webm", "m4v"] }],
    });
    if (typeof path !== "string") return;
    await ipc.allowMedia(path);
    openRef({ kind: "url", url: mediaReadUrl(path) }, path);
  }

  async function startExport() {
    if (!source) return;
    if (tauri) {
      const path = await save({ defaultPath: "prova-tecnica.mp4", filters: [{ name: "MP4", extensions: ["mp4"] }] });
      if (!path) return;
      exportPathRef.current = path;
      exportIdRef.current = await ipc.beginExport(path);
      send({
        type: "proof:export",
        source,
        target: { kind: "url", url: mediaWriteUrl(exportIdRef.current) },
        settings: EXPORT_SETTINGS,
      });
    } else {
      send({ type: "proof:export", source, target: { kind: "memory" }, settings: EXPORT_SETTINGS });
    }
    setExp({ status: "running", done: 0, total: 0 });
  }

  const running = play !== null && !play.done;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[var(--topbar-height)] items-center gap-4 border-b border-border bg-bg-1 px-4">
        <span className="text-title font-semibold">Prova técnica</span>
        <span className="text-label text-text-2">Fase 1 · T1.01 · Portão 0</span>
        <div className="ml-auto flex gap-3 text-label">
          <Flag ok={tauri} label={tauri ? "Tauri" : "Navegador (sem Tauri)"} neutral={!tauri} />
          <Flag ok={env?.webcodecs} label="WebCodecs" />
          <Flag ok={env?.webgl2} label="WebGL2" />
          <span className={openFrames === 0 ? "text-text-2" : "text-accent"}>
            VideoFrames abertos: <span className="tabular">{openFrames}</span>
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[360px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-bg-1 p-4">
          <Step n={1} title="Abrir vídeo">
            <Button onClick={pickFile} data-testid="open">
              <FolderOpen /> Escolher vídeo
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              data-testid="file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) openRef({ kind: "file", file }, file.name);
              }}
            />
            {sourceName && <p className="break-all text-label text-text-2">{sourceName}</p>}
            {info && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label" data-testid="info">
                <Item k="Container" v={info.container} />
                <Item k="Codec" v={info.codecString ?? info.codec ?? "?"} />
                <Item k="Resolução" v={`${info.width}×${info.height}${info.rotation ? ` (rot. ${info.rotation}°)` : ""}`} />
                <Item k="FPS" v={info.fps ? info.fps.toFixed(2) : "?"} />
                <Item k="Duração" v={formatTimecode(info.durationUs, { num: 30, den: 1 })} />
                <Item k="Áudio" v={info.hasAudio ? "sim" : "não"} />
                <Item k="Decodifica" v={info.canDecode ? "sim" : "não (precisa proxy)"} bad={!info.canDecode} />
                <Item k="Aceleração" v={info.hardwareDecode === "prefer-hardware" ? "hardware" : "software"} />
              </dl>
            )}
          </Step>

          <Step n={2} title={`Reproduzir ${PROOF_SECONDS} s`}>
            <div className="flex gap-2">
              <Button
                disabled={!info?.canDecode || running}
                onClick={() => send({ type: "proof:play", mode: "realtime", durationUs: secondsToUs(PROOF_SECONDS) })}
                data-testid="play"
              >
                <Play /> Tempo real
              </Button>
              <Button
                disabled={!info?.canDecode || running}
                onClick={() => send({ type: "proof:play", mode: "benchmark", durationUs: secondsToUs(PROOF_SECONDS) })}
                data-testid="bench"
              >
                <Gauge /> Velocidade máx.
              </Button>
              <Button variant="ghost" size="icon" disabled={!running} onClick={() => send({ type: "proof:stop" })} aria-label="Parar">
                <Square />
              </Button>
            </div>
            {play && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label" data-testid="play-stats">
                <Item k="Modo" v={play.mode === "realtime" ? "tempo real" : "velocidade máxima"} />
                <Item k="Quadros exibidos" v={String(play.framesShown)} />
                <Item k="Descartados" v={String(play.framesDropped)} bad={play.framesDropped > 0} />
                <Item k="Quadros/s" v={play.fps.toFixed(1)} />
                {play.mode === "realtime" && <Item k="Maior atraso" v={`${play.maxLateMs.toFixed(1)} ms`} />}
                <Item k="Estado" v={play.done ? "concluído" : "rodando"} />
              </dl>
            )}
          </Step>

          <Step n={3} title={`Exportar ${PROOF_SECONDS} s em MP4 1080p30`}>
            <div className="flex gap-2">
              <Button variant="accent" disabled={!info?.canDecode || exp.status === "running"} onClick={startExport} data-testid="export">
                <Download /> Exportar
              </Button>
              <Button
                variant="ghost"
                disabled={exp.status !== "running"}
                onClick={() => send({ type: "proof:cancelExport" })}
              >
                <X /> Cancelar
              </Button>
            </div>
            {exp.status === "running" && (
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-2">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${exp.total ? (100 * exp.done) / exp.total : 0}%` }}
                />
              </div>
            )}
            {exp.status === "done" && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label" data-testid="export-result">
                <Item k="Codec" v={exp.result.codec} />
                <Item k="Codificação" v={exp.result.hardwareEncode === "prefer-hardware" ? "hardware" : "software"} />
                <Item k="Quadros" v={String(exp.result.frames)} />
                <Item k="Tempo" v={`${(exp.result.elapsedMs / 1000).toFixed(2)} s (${exp.result.fps.toFixed(0)} qps)`} />
                <Item k="Tamanho" v={`${(exp.result.bytes / 2 ** 20).toFixed(2)} MB`} />
                <Item k="Arquivo" v={exp.path} />
              </dl>
            )}
            {exp.status === "done" && exp.downloadUrl && (
              <a className="text-label text-accent underline" href={exp.downloadUrl} download="prova-tecnica.mp4">
                Baixar MP4
              </a>
            )}
          </Step>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-panel border border-border bg-black">
            <canvas ref={canvasRef} className="aspect-video max-h-full max-w-full" data-testid="preview" />
          </div>
          <section className="h-40 shrink-0 overflow-y-auto rounded-panel border border-border bg-bg-1 p-3 font-mono text-label">
            {log.length === 0 && <p className="text-text-2">Escolha um vídeo para começar. Use um MP4 4K H.264.</p>}
            {log.map((l, i) => (
              <p key={i} className={l.error ? "text-danger" : "text-text-2"}>
                <span className="tabular">{l.time}</span> {l.text}
              </p>
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-panel border border-border bg-bg-0 p-3">
      <h2 className="text-title font-semibold">
        <span className="text-text-2">{n}.</span> {title}
      </h2>
      {children}
    </section>
  );
}

function Item({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <>
      <dt className="text-text-2">{k}</dt>
      <dd className={bad ? "break-all text-danger" : "break-all tabular"}>{v}</dd>
    </>
  );
}

function Flag({ ok, label, neutral }: { ok: boolean | undefined; label: string; neutral?: boolean }) {
  const color = ok === undefined || neutral ? "text-text-2" : ok ? "text-text-1" : "text-danger";
  return (
    <span className={color}>
      {ok === undefined ? "…" : neutral ? "○" : ok ? "●" : "✕"} {label}
    </span>
  );
}
