/**
 * Dono explícito de cada VideoFrame.
 *
 * Todo VideoFrame que entra no motor passa por adopt() e sai por release().
 * Esquecer de fechar um quadro é a causa mais comum de vazamento de memória
 * de GPU com WebCodecs; o contador aparece no preview em desenvolvimento e
 * precisa voltar a zero quando a reprodução para.
 */

let openFrames = 0;

export function adopt(frame: VideoFrame): VideoFrame {
  openFrames++;
  return frame;
}

export function release(frame: VideoFrame | null | undefined): void {
  if (!frame) return;
  frame.close();
  openFrames--;
}

export function openFrameCount(): number {
  return openFrames;
}
