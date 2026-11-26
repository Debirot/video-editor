/**
 * Relógio e laço de reprodução do preview (roda no Worker).
 *
 * A cada quadro de tela: calcula o tempo pelo relógio, descobre as camadas
 * (evaluate.ts), busca as imagens (pool.ts) e compõe no WebGL2 (compositor).
 * Se a composição anterior ainda não terminou, o quadro é descartado (contado).
 * Até T1.08 o relógio é performance.now(); depois passa a ser o do áudio.
 *
 * Parado, cada pedido de seek redesenha só o último tempo pedido (os intermediários
 * são descartados), e os quadros guardados são soltos depois de IDLE_RELEASE_MS.
 */
import type { Project } from "@/project/types";
import { projectDuration } from "@/project/queries";
import { frameToUs, type Us } from "@/lib/time";
import { Compositor } from "./compositor/compositor";
import { drawLayers, gatherPictures } from "./compose";
import { PicturePool } from "./decode/pool";
import { frameStart, videoLayersAt } from "./evaluate";
import { openFrameCount } from "./frames";
import type { FromWorker, PreviewQuality, PreviewSource } from "./messages";

const IDLE_RELEASE_MS = 1500;

const nextTick: (cb: () => void) => void =
  typeof requestAnimationFrame === "function" ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(cb, 16);

export class Playback {
  private compositor: Compositor | null = null;
  private project: Project | null = null;
  private pool = new PicturePool();
  private quality: PreviewQuality = 1;

  private playing = false;
  private rate = 1;
  private startT: Us = 0;
  private startWall = 0;
  private target: Us = 0;

  private rendering = false;
  private renderAgain = false;
  private dropped = 0;
  private lastRenderMs = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private warned = new Set<string>();

  constructor(private readonly post: (msg: FromWorker) => void) {}

  attach(canvas: OffscreenCanvas): void {
    this.compositor = new Compositor(canvas);
    this.resize();
    this.requestRender();
  }

  setProject(project: Project, sources: Record<string, PreviewSource>): void {
    this.project = project;
    this.pool.setSources(sources);
    this.resize();
    if (!this.playing) this.requestRender();
  }

  setQuality(scale: PreviewQuality): void {
    this.quality = scale;
    this.resize();
    if (!this.playing) this.requestRender();
  }

  seek(t: Us): void {
    this.target = Math.max(0, t);
    if (this.playing) {
      this.startT = this.target;
      this.startWall = performance.now();
    } else {
      this.requestRender();
    }
  }

  /** `at` em ms absolutos (performance.timeOrigin + now): quando o áudio começa a tocar `from`. */
  play(from: Us, rate: number, at?: number): void {
    if (!this.project || this.duration() === 0) return;
    const end = this.duration();
    // Tocar no fim volta ao começo (e tocar para trás no começo vai para o fim).
    let start = from;
    if (rate > 0 && from >= end - this.frameUs()) start = 0;
    if (rate < 0 && from <= 0) start = end - this.frameUs();
    this.startT = start;
    this.startWall = at !== undefined ? at - performance.timeOrigin : performance.now();
    this.rate = rate;
    this.dropped = 0;
    if (!this.playing) {
      this.playing = true;
      this.clearIdle();
      nextTick(this.tick);
    }
  }

  /** Correção pelo relógio do áudio, que manda: o vídeo segue o som. */
  clock(t: Us, at: number): void {
    if (!this.playing) return;
    this.startT = t;
    this.startWall = at - performance.timeOrigin;
  }

  pause(): void {
    if (!this.playing) return;
    this.target = this.now();
    this.playing = false;
    const t = this.snapped(this.target);
    this.post({ type: "preview:time", t, playing: false });
    this.requestRender();
  }

  private duration(): Us {
    return this.project ? projectDuration(this.project) : 0;
  }

  private frameUs(): Us {
    return this.project ? frameToUs(1, this.project.settings.fps) : 33_333;
  }

  private snapped(t: Us): Us {
    return this.project ? frameStart(t, this.project.settings.fps) : t;
  }

  private now(): Us {
    if (!this.playing) return this.target;
    // Antes do início agendado (o áudio ainda vai começar), fica no ponto de partida.
    const elapsed = Math.max(0, performance.now() - this.startWall);
    return Math.round(this.startT + elapsed * 1000 * this.rate);
  }

  private resize(): void {
    if (!this.compositor || !this.project) return;
    const { width, height } = this.project.settings;
    this.compositor.resize(Math.max(2, Math.round(width * this.quality)), Math.max(2, Math.round(height * this.quality)));
  }

  private tick = (): void => {
    if (!this.playing) return;
    let t = this.now();
    const end = this.duration();
    let finished = false;
    if (this.rate > 0 && t >= end) {
      t = Math.max(0, end - this.frameUs());
      finished = true;
    } else if (this.rate < 0 && t <= 0) {
      t = 0;
      finished = true;
    }
    const shown = this.snapped(t);
    if (this.rendering) this.dropped++;
    else void this.render(shown);
    this.post({ type: "preview:time", t: shown, playing: !finished });
    if (finished) {
      this.playing = false;
      this.target = shown;
      this.requestRender();
      this.postStats();
      return;
    }
    nextTick(this.tick);
  };

  private requestRender(): void {
    if (this.playing) return;
    if (this.rendering) {
      this.renderAgain = true;
      return;
    }
    void this.render(this.snapped(this.target));
  }

  private async render(t: Us): Promise<void> {
    if (!this.compositor || !this.project) return;
    this.rendering = true;
    const started = performance.now();
    try {
      const project = this.project;
      const layers = videoLayersAt(project, t);
      const pictures = await gatherPictures(this.pool, layers, (mediaId, e) => {
        if (this.warned.has(mediaId)) return;
        this.warned.add(mediaId);
        this.post({ type: "error", context: "preview", message: e instanceof Error ? e.message : String(e) });
      });
      const c = this.compositor;
      drawLayers(c, project.settings.background, layers, pictures);
      c.gl.flush();
    } finally {
      this.rendering = false;
      this.lastRenderMs = performance.now() - started;
      if (!this.playing) {
        if (this.renderAgain) {
          this.renderAgain = false;
          void this.render(this.snapped(this.target));
        } else {
          this.scheduleIdleRelease();
        }
      }
      this.postStats();
    }
  }

  private postStats(): void {
    this.post({ type: "preview:stats", droppedFrames: this.dropped, openFrames: openFrameCount(), renderMs: this.lastRenderMs });
  }

  private scheduleIdleRelease(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      if (this.playing || this.rendering) return;
      void this.pool.releaseFrames().then(() => this.postStats());
    }, IDLE_RELEASE_MS);
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
