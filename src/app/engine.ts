/**
 * Cliente do Worker do motor para o app. Um Worker só, criado na primeira chamada.
 * Hoje só verifica se uma mídia é decodificável; o preview (T1.07) usa o mesmo Worker.
 */
import type { DecodeCheck, FromWorker, ToWorker } from "@/engine/messages";

let worker: Worker | null = null;
let nextRequest = 1;
const waiting = new Map<number, (r: DecodeCheck) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const msg = ev.data;
    if (msg.type === "media:checked") {
      waiting.get(msg.requestId)?.(msg.result);
      waiting.delete(msg.requestId);
    }
  };
  return worker;
}

export function checkDecodable(url: string): Promise<DecodeCheck> {
  const requestId = nextRequest++;
  return new Promise((resolve) => {
    waiting.set(requestId, resolve);
    getWorker().postMessage({ type: "media:check", requestId, url } satisfies ToWorker);
  });
}
