/**
 * Ponto de entrada do Worker do motor. Só roteia mensagens (messages.ts).
 * Não importa React nem nada de src/panels.
 */
import { Compositor } from "./compositor/compositor";
import { ExportCancelled } from "./export";
import { openFrameCount } from "./frames";
import type { FromWorker, ToWorker } from "./messages";
import { exportProof, openSource, playProof } from "./proof";

// No contexto do Worker, `self` tem postMessage(message, transfer).
const ctx = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<ToWorker>) => void) | null;
};

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

let preview: Compositor | null = null;
let source: Awaited<ReturnType<typeof openSource>> | null = null;
let playback: AbortController | null = null;
let exporting: AbortController | null = null;

async function handle(msg: ToWorker): Promise<void> {
  switch (msg.type) {
    case "init": {
      let webgl2 = true;
      try {
        preview = new Compositor(msg.canvas);
        preview.clear();
      } catch {
        webgl2 = false;
      }
      post({ type: "ready", webgl2, webcodecs: typeof VideoDecoder !== "undefined" && typeof VideoEncoder !== "undefined" });
      setInterval(() => post({ type: "stats", openFrames: openFrameCount() }), 500);
      return;
    }

    case "proof:open": {
      playback?.abort();
      source?.input.dispose();
      source = null;
      try {
        source = await openSource(msg.source);
        post({ type: "proof:info", info: source.info });
      } catch (e) {
        const info = (e as { info?: import("./messages").SourceInfo }).info;
        if (info) post({ type: "proof:info", info });
        post({ type: "error", context: "abrir", message: errorMessage(e) });
      }
      return;
    }

    case "proof:play": {
      if (!source || !preview) {
        post({ type: "error", context: "reproduzir", message: "Abra um vídeo primeiro." });
        return;
      }
      playback?.abort();
      const controller = new AbortController();
      playback = controller;
      try {
        const stats = await playProof(source, preview, msg.mode, msg.durationUs, controller.signal, (s) =>
          post({ type: "proof:playStats", stats: s }),
        );
        post({ type: "proof:playStats", stats });
      } catch (e) {
        post({ type: "error", context: "reproduzir", message: errorMessage(e) });
      } finally {
        if (playback === controller) playback = null;
      }
      return;
    }

    case "proof:stop":
      playback?.abort();
      return;

    case "proof:export": {
      exporting?.abort();
      const controller = new AbortController();
      exporting = controller;
      try {
        const { result, buffer } = await exportProof(msg.source, msg.target, msg.settings, controller.signal, (done, total) =>
          post({ type: "proof:exportProgress", done, total }),
        );
        post({ type: "proof:exportDone", result, buffer }, buffer ? [buffer] : []);
      } catch (e) {
        if (e instanceof ExportCancelled) post({ type: "proof:exportCancelled" });
        else post({ type: "error", context: "exportar", message: errorMessage(e) });
      } finally {
        if (exporting === controller) exporting = null;
      }
      return;
    }

    case "proof:cancelExport":
      exporting?.abort();
      return;
  }
}

ctx.onmessage = (ev) => {
  void handle(ev.data);
};
