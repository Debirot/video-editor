/**
 * Shaders do compositor. Módulo estável depois de validado: mudanças aqui
 * exigem atualizar os quadros de referência em tests/golden/.
 */

/** Quadro em coordenadas de pixel do destino; uRect = x, y, largura, altura. */
export const QUAD_VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec4 uRect;
uniform vec2 uViewport;
out vec2 vUv;
void main() {
  vUv = aPos;
  vec2 px = uRect.xy + aPos * uRect.zw;
  vec2 clip = (px / uViewport) * 2.0 - 1.0;
  // Origem no canto superior esquerdo, como no canvas 2D e no VideoFrame.
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const TEXTURE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uOpacity;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUv);
  outColor = vec4(c.rgb, c.a * uOpacity);
}`;
