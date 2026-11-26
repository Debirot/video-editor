/**
 * Saída de áudio do preview (Web Audio, thread da interface). O relógio do áudio é o
 * relógio mestre: o Worker recebe correções periódicas e o vídeo segue o som.
 *
 * Funcionamento: ao tocar, cria uma "sessão" ancorada em (t0 na timeline, ctxStart no
 * AudioContext). Pede ao Worker o PCM em blocos à frente do playhead (primeiro 1 s, depois
 * 4 s, mantendo ~6 s agendados) e agenda cada trecho num AudioBufferSourceNode com o
 * envelope de volume (ganho + fades). Parar ou pular encerra a sessão; respostas de
 * sessões antigas são descartadas.
 */
import type { PcmChunk } from "@/engine/messages";
import type { Us } from "@/lib/time";
import { envelopePoints, fadeFactor } from "@/engine/audio/envelope";

const LEAD_S = 0.2;
/** Folga mínima ao reagendar o início quando o primeiro bloco chega atrasado. */
const RESTART_S = 0.05;
const FIRST_CHUNK_US = 1_000_000;
const CHUNK_US = 4_000_000;
const HORIZON_US = 6_000_000;
const PUMP_MS = 200;

export interface AudioHost {
  requestPcm: (session: number, from: Us, to: Us) => void;
  sendClock: (t: Us, at: number) => void;
  /** Fim da timeline (não pede além disso). */
  duration: () => Us;
}

export class AudioOut {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private session = 0;
  private t0: Us = 0;
  private ctxStart = 0;
  private scheduledUntil: Us = 0;
  private pending = false;
  private nodes = new Set<AudioBufferSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly host: AudioHost) {}

  get active(): boolean {
    return this.timer !== null;
  }

  /**
   * Começa a tocar `from` daqui a LEAD_S. Devolve o instante absoluto (ms, base
   * performance.timeOrigin) em que `from` sai na caixa de som, para o Worker se alinhar.
   */
  start(from: Us): number {
    this.stop();
    const ctx = (this.ctx ??= new AudioContext({ latencyHint: "playback" }));
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    }
    void ctx.resume();
    this.session++;
    this.t0 = from;
    this.ctxStart = ctx.currentTime + LEAD_S;
    this.scheduledUntil = from;
    this.pending = false;
    this.pump();
    this.timer = setInterval(() => this.pump(), PUMP_MS);
    return this.absoluteTimeOf(this.ctxStart);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.session++;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        // ainda não tinha começado
      }
      node.disconnect();
    }
    this.nodes.clear();
  }

  /** Recebe o PCM de [from, to) e agenda. Ignora sessões antigas. */
  receive(session: number, to: Us, chunks: PcmChunk[]): void {
    if (session !== this.session || !this.ctx || !this.master) return;
    this.pending = false;
    // Primeiro bloco atrasado (abrir o arquivo demorou): em vez de cortar o começo do som,
    // adia o início da sessão e avisa o Worker, que segura a imagem em t0 até lá.
    const first = this.scheduledUntil === this.t0;
    if (first && this.ctxStart < this.ctx.currentTime + RESTART_S / 2) {
      this.ctxStart = this.ctx.currentTime + RESTART_S;
      this.host.sendClock(this.t0, this.absoluteTimeOf(this.ctxStart));
    }
    this.scheduledUntil = Math.max(this.scheduledUntil, to);
    for (const chunk of chunks) this.schedule(chunk);
  }

  /** Posição atual da timeline pelo relógio do áudio. */
  timelineNow(): Us {
    if (!this.ctx) return this.t0;
    return this.t0 + Math.max(0, Math.round((this.ctx.currentTime - this.ctxStart) * 1_000_000));
  }

  private ctxTimeOf(t: Us): number {
    return this.ctxStart + (t - this.t0) / 1_000_000;
  }

  /** Converte um tempo do AudioContext em ms absolutos (timeOrigin + performance.now). */
  private absoluteTimeOf(ctxTime: number): number {
    const ctx = this.ctx!;
    const stamp = ctx.getOutputTimestamp?.();
    const contextTime = stamp?.contextTime ?? ctx.currentTime;
    const perfTime = stamp?.performanceTime ?? performance.now();
    return performance.timeOrigin + perfTime + (ctxTime - contextTime) * 1000;
  }

  private pump(): void {
    if (!this.ctx) return;
    const now = this.timelineNow();
    // Correção do relógio do vídeo: o que está saindo na caixa de som agora.
    const stamp = this.ctx.getOutputTimestamp?.();
    if (stamp?.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.contextTime >= this.ctxStart) {
      const t = this.t0 + Math.round((stamp.contextTime - this.ctxStart) * 1_000_000);
      this.host.sendClock(t, performance.timeOrigin + stamp.performanceTime);
    }
    const end = this.host.duration();
    if (this.pending || this.scheduledUntil >= end || this.scheduledUntil >= now + HORIZON_US) return;
    const size = this.scheduledUntil === this.t0 ? FIRST_CHUNK_US : CHUNK_US;
    const to = Math.min(end, this.scheduledUntil + size);
    this.pending = true;
    this.host.requestPcm(this.session, this.scheduledUntil, to);
  }

  private schedule(chunk: PcmChunk): void {
    const ctx = this.ctx!;
    const length = chunk.channels[0]!.length;
    const buffer = ctx.createBuffer(chunk.channels.length, length, chunk.sampleRate);
    chunk.channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = chunk.speed;
    const gain = ctx.createGain();
    source.connect(gain).connect(this.master!);

    // Envelope: ganho × fade, linear entre os pontos onde a inclinação muda.
    const points = envelopePoints(chunk);
    gain.gain.setValueAtTime(chunk.gain * fadeFactor(points[0]!, chunk), Math.max(0, this.ctxTimeOf(points[0]!)));
    for (const p of points.slice(1)) {
      gain.gain.linearRampToValueAtTime(chunk.gain * fadeFactor(p, chunk), Math.max(0, this.ctxTimeOf(p)));
    }

    const when = this.ctxTimeOf(chunk.start);
    const late = ctx.currentTime - when;
    if (late >= buffer.duration / chunk.speed) return; // chegou tarde demais
    if (late > 0) source.start(ctx.currentTime, late * chunk.speed);
    else source.start(when);
    this.nodes.add(source);
    source.onended = () => {
      this.nodes.delete(source);
      source.disconnect();
      gain.disconnect();
    };
  }
}
