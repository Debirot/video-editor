/**
 * Compositor WebGL2. O mesmo código desenha o preview e a exportação.
 *
 * Cada camada é um quadrilátero texturizado posicionado por uma matriz (transform.ts):
 * posição, escala, rotação e recorte. Efeitos e transições entram como novos shaders
 * atrás desta mesma interface.
 */
import { placementMatrix, type Placement } from "../transform";
import { QUAD_VERTEX, TEXTURE_FRAGMENT } from "./shaders";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompositorOptions {
  /** Necessário quando o canvas vira VideoFrame depois de desenhar (exportação). */
  preserveDrawingBuffer?: boolean;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Erro ao compilar shader: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Erro ao ligar programa: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function parseHexColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Retângulo que encaixa (contain) uma imagem w×h num destino W×H, centralizado. */
export function fitContain(w: number, h: number, W: number, H: number): Rect {
  const scale = Math.min(W / w, H / h);
  const rw = w * scale;
  const rh = h * scale;
  return { x: (W - rw) / 2, y: (H - rh) / 2, w: rw, h: rh };
}

/** Texturas guardadas de imagens fixas e formas (as menos usadas são apagadas). */
const STATIC_TEXTURES = 8;

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** ImageBitmap e OffscreenCanvas de forma não mudam depois de criados: a textura pode ser reaproveitada. */
function isStatic(frame: TexImageSource): frame is ImageBitmap | OffscreenCanvas {
  return (
    (typeof ImageBitmap !== "undefined" && frame instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== "undefined" && frame instanceof OffscreenCanvas)
  );
}

export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uMatrix: WebGLUniformLocation;
  private readonly uUv: WebGLUniformLocation;
  private readonly uViewport: WebGLUniformLocation;
  private readonly uOpacity: WebGLUniformLocation;
  private readonly statics = new Map<ImageBitmap | OffscreenCanvas, WebGLTexture>();

  constructor(
    readonly canvas: OffscreenCanvas,
    options: CompositorOptions = {},
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 indisponível neste WebView.");
    this.gl = gl;

    this.program = link(gl, QUAD_VERTEX, TEXTURE_FRAGMENT);
    this.uMatrix = gl.getUniformLocation(this.program, "uMatrix")!;
    this.uUv = gl.getUniformLocation(this.program, "uUv")!;
    this.uViewport = gl.getUniformLocation(this.program, "uViewport")!;
    this.uOpacity = gl.getUniformLocation(this.program, "uOpacity")!;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.texture = createTexture(gl);
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  clear(color = "#000000"): void {
    const gl = this.gl;
    const [r, g, b] = parseHexColor(color);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Desenha a imagem inteira, sem girar, no retângulo `rect` (usado pela prova técnica). */
  drawFrame(frame: TexImageSource, rect: Rect, opacity = 1, blend = opacity < 1): void {
    this.drawPlaced(
      frame,
      { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, w: rect.w, h: rect.h, angle: 0, uv: [0, 0, 1, 1] },
      opacity,
      blend,
    );
  }

  /**
   * Põe a imagem na unidade de textura 0. Quadros de vídeo vão direto para a textura
   * comum (um VideoFrame não passa por bitmap na CPU); imagens fixas e formas são
   * enviadas uma vez e a textura é reaproveitada nos quadros seguintes.
   */
  private bindImage(frame: TexImageSource): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    if (!isStatic(frame)) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      return;
    }
    const cached = this.statics.get(frame);
    if (cached) {
      this.statics.delete(frame);
      this.statics.set(frame, cached);
      gl.bindTexture(gl.TEXTURE_2D, cached);
      return;
    }
    const texture = createTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    this.statics.set(frame, texture);
    if (this.statics.size > STATIC_TEXTURES) {
      const [oldest, tex] = this.statics.entries().next().value!;
      this.statics.delete(oldest);
      gl.deleteTexture(tex);
    }
  }

  /**
   * Desenha a imagem conforme `p` (transform.ts). `blend` liga a mistura alfa (PNG com
   * transparência, formas, opacidade < 1).
   */
  drawPlaced(frame: TexImageSource, p: Placement, opacity = 1, blend = opacity < 1): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    this.bindImage(frame);
    gl.uniformMatrix3fv(this.uMatrix, false, placementMatrix(p));
    gl.uniform4f(this.uUv, p.uv[0], p.uv[1], p.uv[2], p.uv[3]);
    gl.uniform2f(this.uViewport, this.width, this.height);
    gl.uniform1f(this.uOpacity, opacity);
    if (blend || opacity < 1) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.viewport(0, 0, this.width, this.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Desenha o quadro inteiro encaixado no canvas, com faixas na cor de fundo. */
  drawFrameContain(frame: VideoFrame, background = "#000000"): void {
    this.clear(background);
    this.drawFrame(frame, fitContain(frame.displayWidth, frame.displayHeight, this.width, this.height));
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    for (const texture of this.statics.values()) gl.deleteTexture(texture);
    this.statics.clear();
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
