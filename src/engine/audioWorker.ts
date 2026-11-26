/**
 * Worker de áudio: decodifica os trechos pedidos pela interface (src/app/audio.ts).
 * Fica separado do Worker de vídeo para que composição e decodificação de imagem
 * nunca atrasem o som. Pedidos são atendidos em ordem, um de cada vez.
 */
import type { Project } from "@/project/types";
import { AudioPool } from "./audio/decode";
import { audioSegmentsIn } from "./evaluate";
import type { FromAudioWorker, PcmChunk, ToAudioWorker } from "./messages";

const ctx = self as unknown as {
  postMessage(message: FromAudioWorker, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<ToAudioWorker>) => void) | null;
};

const pool = new AudioPool();
let project: Project | null = null;
let queue: Promise<void> = Promise.resolve();
const warned = new Set<string>();

async function render(session: number, from: number, to: number): Promise<void> {
  const chunks: PcmChunk[] = [];
  if (project) {
    for (const seg of audioSegmentsIn(project, from, to)) {
      try {
        const chunk = await pool.render(seg);
        if (chunk) chunks.push(chunk);
      } catch (e) {
        if (warned.has(seg.mediaId)) continue;
        warned.add(seg.mediaId);
        ctx.postMessage({ type: "error", context: "áudio", message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  const transfer = chunks.flatMap((c) => c.channels.map((ch) => ch.buffer as ArrayBuffer));
  ctx.postMessage({ type: "audio:pcm", session, from, to, chunks }, transfer);
}

ctx.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "audio:project") {
    project = msg.project;
    pool.setSources(msg.sources);
  } else {
    queue = queue.then(() => render(msg.session, msg.from, msg.to));
  }
};
