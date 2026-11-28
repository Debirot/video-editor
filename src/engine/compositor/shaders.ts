/**
 * Shaders do compositor. Módulo estável depois de validado: mudanças aqui
 * exigem atualizar os quadros de referência em tests/golden/.
 */

/**
 * Quadrilátero da imagem: aPos percorre 0..1; uUv escolhe a parte visível (recorte);
 * uMatrix leva (u, v) a px do destino (posição, escala e rotação, transform.ts).
 */
export const QUAD_VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
uniform mat3 uMatrix;
uniform vec4 uUv;
uniform vec2 uViewport;
out vec2 vUv;
void main() {
  vec2 uv = mix(uUv.xy, uUv.zw, aPos);
  vUv = uv;
  vec2 px = (uMatrix * vec3(uv, 1.0)).xy;
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
