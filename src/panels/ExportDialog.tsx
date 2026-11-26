/**
 * Diálogo de exportação: formato, progresso com cancelar, e resultado.
 * As escolhas valem só para o arquivo exportado (não mudam o projeto).
 */
import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, Field, Select } from "@/components/ui/dialog";
import { useProject } from "@/app/useProject";
import { cancelExport, closeExportDialog, startExport, useExport } from "@/app/exportFlow";
import { bitrateFor, estimateBytes, fpsOptions, resolutionOptions, type Quality } from "@/app/exportPresets";
import { formatTimecode } from "@/lib/time";
import { projectDuration } from "@/project/queries";

const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(bytes < 100 * 2 ** 20 ? 1 : 0)} MB`;
const mbps = (bps: number) => `${(bps / 1_000_000).toFixed(1).replace(".", ",")} Mb/s`;

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

export function ExportDialog() {
  const open = useExport((s) => s.open);
  const status = useExport((s) => s.status);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeExportDialog()}>
      <DialogContent
        onEscapeKeyDown={(e) => status.kind === "running" && e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {status.kind === "setup" && <Setup />}
        {(status.kind === "running" || status.kind === "cancelling") && <Progress />}
        {status.kind === "done" && <Done />}
        {status.kind === "error" && <Failed message={status.message} />}
      </DialogContent>
    </Dialog>
  );
}

function Setup() {
  const settings = useProject((s) => s.project.settings);
  const total = useProject((s) => projectDuration(s.project));
  const hasAudio = useProject((s) => s.project.tracks.some((t) => t.kind === "audio" && t.clips.length > 0));
  const caps = useExport((s) => s.caps);
  const resolutions = useMemo(() => resolutionOptions(settings.width, settings.height), [settings.width, settings.height]);
  const fpsList = useMemo(() => fpsOptions(settings.fps), [settings.fps]);

  const [res, setRes] = useState(() => resolutions.findIndex((r) => r.width === settings.width && r.height === settings.height));
  const [fpsIndex, setFpsIndex] = useState(0);
  const [quality, setQuality] = useState<Quality>("alta");
  const [codec, setCodec] = useState<"avc" | "hevc">("avc");
  const [audio, setAudio] = useState(true);

  const r = resolutions[res] ?? resolutions[0]!;
  const fps = fpsList[fpsIndex]!.fps;
  const bitrate = bitrateFor(r.width, r.height, fps, quality, codec);
  const withAudio = audio && hasAudio;

  return (
    <>
      <DialogHeader
        title="Exportar vídeo"
        description={`MP4 · duração ${formatTimecode(total, settings.fps)} · tamanho estimado ${mb(estimateBytes(bitrate, withAudio, total))}`}
      />
      <div className="flex flex-col gap-3">
        <Field label="Codec de vídeo" hint={caps && !caps.hevc ? "H.265 não está disponível neste computador." : undefined}>
          <Select value={codec} onChange={(e) => setCodec(e.target.value as "avc" | "hevc")}>
            <option value="avc">H.264 (compatível com tudo)</option>
            <option value="hevc" disabled={!caps?.hevc}>
              H.265 (arquivo menor)
            </option>
          </Select>
        </Field>
        <Field label="Resolução">
          <Select value={res} onChange={(e) => setRes(Number(e.target.value))}>
            {resolutions.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quadros/s">
          <Select value={fpsIndex} onChange={(e) => setFpsIndex(Number(e.target.value))}>
            {fpsList.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Qualidade" hint={`Taxa de bits ${mbps(bitrate)}`}>
          <Select value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa (arquivo pequeno)</option>
          </Select>
        </Field>
        <Field label="Áudio" hint={!hasAudio ? "A timeline não tem clipes de áudio." : caps?.aac === false ? "AAC indisponível; será Opus." : undefined}>
          <span className="flex h-8 items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={audio && hasAudio}
              disabled={!hasAudio}
              onChange={(e) => setAudio(e.target.checked)}
            />
            <span className="text-body text-text-1">AAC 48 kHz estéreo</span>
          </span>
        </Field>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeExportDialog}>
          Cancelar
        </Button>
        <Button
          variant="accent"
          disabled={caps === null}
          onClick={() => void startExport({ width: r.width, height: r.height, fps, bitrate, videoCodec: codec, audio: withAudio })}
        >
          Exportar…
        </Button>
      </DialogFooter>
    </>
  );
}

function Progress() {
  const status = useExport((s) => s.status);
  const running = status.kind === "running" ? status : null;
  const fraction = running && running.total > 0 ? running.done / running.total : 0;
  const elapsed = running?.elapsedMs ?? 0;
  const remaining = fraction > 0.02 ? (elapsed / fraction) * (1 - fraction) : null;
  return (
    <>
      <DialogHeader title="Exportando…" description="A interface continua livre. Não feche o app até terminar." />
      <div className="flex flex-col gap-2">
        <div className="h-2 overflow-hidden rounded-full bg-bg-2" role="progressbar" aria-valuenow={Math.round(fraction * 100)}>
          <div className="h-full bg-accent transition-[width] duration-[var(--duration-fast)]" style={{ width: `${fraction * 100}%` }} />
        </div>
        <div className="flex justify-between text-label text-text-2">
          <span className="tabular">
            {running ? `${running.done} de ${running.total || "…"} quadros · ${Math.round(fraction * 100)}%` : "Cancelando…"}
          </span>
          <span className="tabular">{remaining !== null ? `faltam ~${duration(remaining)}` : ""}</span>
        </div>
      </div>
      <DialogFooter>
        <Button variant="danger" disabled={status.kind === "cancelling"} onClick={cancelExport}>
          {status.kind === "cancelling" ? <Loader2 className="animate-spin" /> : null} Cancelar exportação
        </Button>
      </DialogFooter>
    </>
  );
}

function Done() {
  const status = useExport((s) => s.status);
  if (status.kind !== "done") return null;
  const { result } = status;
  return (
    <>
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-5 text-accent" />
        <DialogHeader title="Vídeo exportado" />
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-body">
        <dt className="text-label text-text-2">Arquivo</dt>
        <dd className="break-all text-text-1">{status.path}</dd>
        <dt className="text-label text-text-2">Tamanho</dt>
        <dd className="tabular">{mb(status.bytes)}</dd>
        <dt className="text-label text-text-2">Tempo</dt>
        <dd className="tabular">
          {duration(result.elapsedMs)} ({Math.round(result.fps)} quadros/s)
        </dd>
        <dt className="text-label text-text-2">Codificação</dt>
        <dd>
          {result.codec.startsWith("hvc") ? "H.265" : result.codec.startsWith("avc") ? "H.264" : result.codec} ·{" "}
          {result.hardwareEncode === "prefer-hardware" ? "hardware" : "software"}
          {result.audioCodec ? ` · áudio ${result.audioCodec.startsWith("mp4a") ? "AAC" : result.audioCodec}` : " · sem áudio"}
        </dd>
      </dl>
      <DialogFooter>
        <Button variant="accent" onClick={closeExportDialog}>
          Fechar
        </Button>
      </DialogFooter>
    </>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-5 text-danger" />
        <DialogHeader title="A exportação falhou" />
      </div>
      <p className="break-words text-body text-text-2">{message}</p>
      <p className="text-label text-text-2">O arquivo parcial foi apagado.</p>
      <DialogFooter>
        <Button onClick={closeExportDialog}>Fechar</Button>
      </DialogFooter>
    </>
  );
}
